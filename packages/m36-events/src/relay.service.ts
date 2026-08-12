/**
 * RelayService — the governed OUTBOUND fan-out. m06 owns THE ONE outbox/event-delivery path; its platform dispatcher hands
 * each domain event to `deliverEvent` (a SYSTEM relay — not a user-facing mutation, so no user permission; it is tenant-
 * scoped under the caller ctx). For each ACTIVE subscription of an ACTIVE endpoint that matches the event's family/type, the
 * relay attempts EXTERNAL delivery through the fail-closed `WebhookDeliveryPort` (framework-only; an unavailable runtime
 * yields a durable BLOCKED outcome — never guessed as delivered) and records append-only `webhook_delivery` evidence.
 * Delivery is IDEMPOTENT (at most one 'delivered' per endpoint per event) and bounded (dead_letter past max attempts). m36
 * owns no outbox and performs no arbitrary network — the real HTTP runtime drops in behind the port when proven.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M36_PERMISSIONS } from './permissions.ts';
import { M36_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { M36_LIMITS, REASON_CODES } from './domain.ts';
import { EventsRepository, type DeliveryRow } from './repository.ts';
import type { M36Emitter } from './emit.ts';
import type { RelayEvent, WebhookDeliveryPort } from './ports.ts';

export class RelayService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M36Emitter;
  private readonly delivery: WebhookDeliveryPort;
  private readonly repo: EventsRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M36Emitter,
    delivery: WebhookDeliveryPort,
    repo: EventsRepository = new EventsRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.delivery = delivery;
    this.repo = repo;
  }

  private outcomeStatus(
    delivered: boolean,
    reasonCode: string,
  ): { status: DeliveryRow['status']; code: string } {
    if (delivered) return { status: 'delivered', code: M36_AUDIT_CODES.deliverySucceeded };
    if (
      reasonCode === REASON_CODES.deliveryRuntimeUnavailable ||
      reasonCode === 'delivery_runtime_unavailable'
    )
      return { status: 'blocked', code: M36_AUDIT_CODES.deliveryBlocked };
    return { status: 'failed', code: M36_AUDIT_CODES.deliveryFailed };
  }

  /** Fan an event out to every matching active subscription (dispatcher-invoked; tenant-scoped). Idempotent + fail-closed. */
  async deliverEvent(ctx: RequestContext, event: RelayEvent): Promise<DeliveryRow[]> {
    // Resolve matching subscriptions + attempt delivery OUTSIDE the write tx (the port is external egress), then record.
    const subs = await this.db.withTenant(ctx, (tx) =>
      this.repo.listActiveSubscriptionsForEvent(tx, event.family, event.type),
    );
    const results: DeliveryRow[] = [];
    for (const sub of subs) {
      const record = await this.db.withTenant(ctx, async (tx) => {
        if (await this.repo.hasDelivered(tx, sub.endpoint_id, event.dedupeKey)) return null; // idempotent — already delivered
        const endpoint = await this.repo.getEndpoint(tx, sub.endpoint_id);
        if (endpoint?.state !== 'active') return null;
        const attempts = await this.repo.countDeliveryAttempts(tx, sub.endpoint_id, event.dedupeKey);
        return { endpoint, attempts };
      });
      if (record === null) continue;
      const outcome = await this.delivery.deliver({
        url: record.endpoint.url,
        signingSecretRef: record.endpoint.signing_secret_ref,
        event,
      });
      const capped = !outcome.delivered && record.attempts + 1 >= M36_LIMITS.maxDeliveryAttempts;
      const mapped = this.outcomeStatus(outcome.delivered, outcome.reasonCode);
      const status: DeliveryRow['status'] = capped ? 'dead_letter' : mapped.status;
      const delivery = await this.db.withTenant(ctx, async (tx) => {
        const d = await this.repo.insertDelivery(tx, {
          tenantId: ctx.tenantId,
          endpointId: sub.endpoint_id,
          eventId: event.eventId,
          eventFamily: event.family,
          eventType: event.type,
          dedupeKey: event.dedupeKey,
          status,
          attemptNo: record.attempts + 1,
          reasonCode: outcome.reasonCode,
          statusHint: outcome.statusHint ?? null,
          correlationId: ctx.correlationId,
          by: null,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: outcome.delivered ? M36_AUDIT_CODES.deliverySucceeded : mapped.code,
          entityType: 'webhook_delivery',
          entityId: d.id,
          detail: { endpointId: sub.endpoint_id, family: event.family, type: event.type, status },
        });
        await this.emitter.publishWebhook(tx, outcome.delivered ? 'DeliverySucceeded' : 'DeliveryFailed', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          payload: {
            recordId: d.id,
            recordType: 'delivery',
            eventFamily: event.family,
            eventType: event.type,
            toStatus: status,
            reasonCode: outcome.reasonCode,
          },
        });
        return d;
      });
      results.push(delivery);
    }
    return results;
  }

  /** Re-attempt a failed/blocked delivery — a controlled action (events.delivery.replay). Idempotent + bounded. */
  async replayDelivery(ctx: RequestContext, actor: string | null, deliveryId: string): Promise<DeliveryRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.deliveryReplay);
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const prior = await this.repo.getDelivery(tx, deliveryId);
      if (prior === null) throw badRequest('unknown delivery.', ctx.correlationId);
      if (prior.status === 'delivered')
        throw badRequest('the event was already delivered to this endpoint.', ctx.correlationId);
      if (await this.repo.hasDelivered(tx, prior.endpoint_id, prior.dedupe_key))
        throw badRequest('the event was already delivered to this endpoint.', ctx.correlationId);
      const endpoint = await this.repo.getEndpoint(tx, prior.endpoint_id);
      if (endpoint?.state !== 'active') throw badRequest('the endpoint is not active.', ctx.correlationId);
      const attempts = await this.repo.countDeliveryAttempts(tx, prior.endpoint_id, prior.dedupe_key);
      return { prior, endpoint, attempts };
    });
    const event: RelayEvent = {
      eventId: prepared.prior.event_id,
      family: prepared.prior.event_family,
      type: prepared.prior.event_type,
      aggregateId: prepared.prior.event_id,
      dedupeKey: prepared.prior.dedupe_key,
    };
    const outcome = await this.delivery.deliver({
      url: prepared.endpoint.url,
      signingSecretRef: prepared.endpoint.signing_secret_ref,
      event,
    });
    const capped = !outcome.delivered && prepared.attempts + 1 >= M36_LIMITS.maxDeliveryAttempts;
    const mapped = this.outcomeStatus(outcome.delivered, outcome.reasonCode);
    const status: DeliveryRow['status'] = capped ? 'dead_letter' : mapped.status;
    return this.db.withTenant(ctx, async (tx) => {
      const d = await this.repo.insertDelivery(tx, {
        tenantId: ctx.tenantId,
        endpointId: prepared.prior.endpoint_id,
        eventId: prepared.prior.event_id,
        eventFamily: prepared.prior.event_family,
        eventType: prepared.prior.event_type,
        dedupeKey: prepared.prior.dedupe_key,
        status,
        attemptNo: prepared.attempts + 1,
        reasonCode: outcome.reasonCode,
        statusHint: outcome.statusHint ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.deliveryReplayed,
        entityType: 'webhook_delivery',
        entityId: d.id,
        detail: { endpointId: prepared.prior.endpoint_id, status },
      });
      return d;
    });
  }

  async getDelivery(ctx: RequestContext, id: string): Promise<DeliveryRow | null> {
    await this.authz.require(ctx, M36_PERMISSIONS.webhookRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getDelivery(tx, id));
  }
}
