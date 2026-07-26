/**
 * NotificationService — request creation and the dispatch/retry lifecycle (prompt §E3/§E5/§E7/§E12/§E13).
 *
 * Creation resolves the ACTIVE template version, normalizes the destination, validates the variables against
 * the template schema, applies preferences/suppression (mandatory categories bypass), is idempotent per key,
 * and durably enqueues the request with audit + outbox in one transaction. Dispatch is worker-safe: a
 * compare-and-set LEASE claim means two workers racing produce exactly one dispatcher; the attempt is recorded
 * as append-only evidence; success/retry/exhaustion follow the PURE retry policy; every step audits and emits.
 * Rendering uses the safe deterministic renderer — no eval, no host code. Delivery is performed by a provider
 * adapter (test double by default); a failure never corrupts state.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M08_PERMISSIONS } from './permissions.ts';
import { M08_AUDIT_CODES } from './audit-codes.ts';
import { isRequestTerminal } from './domain/lifecycles.ts';
import {
  channelEscapes,
  channelHasSubject,
  isChannel,
  requireDestination,
  type Channel,
} from './domain/channels.ts';
import { validateVariables } from './domain/variables.ts';
import { renderTemplate, type RenderValue } from './domain/render.ts';
import { NotifyError } from './domain/limits.ts';
import {
  DEFAULT_RETRY_POLICY,
  retryDecision,
  validateRetryPolicy,
  type ErrorCategory,
  type RetryPolicy,
} from './domain/retry.ts';
import { evaluateDelivery, type NotificationCategory } from './domain/preferences.ts';
import type { TemplateSpec } from './domain/template.ts';
import { contentHashOf } from './hash.ts';
import { NotifyRepository, type DeliveryRow, type RequestRow } from './repository.ts';
import type { M08Emitter } from './emit.ts';
import { ProviderRegistry } from './provider.ts';
import { badRequest, invalidVariables } from './errors.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateRequestInput {
  readonly templateKey: string;
  readonly destination: string;
  readonly recipientRef?: string | null;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly category?: NotificationCategory;
  readonly priority?: string;
  readonly idempotencyKey?: string | null;
  readonly scheduledAt?: string | null;
  readonly expiresAt?: string | null;
  readonly retryPolicy?: RetryPolicy;
  readonly originModule?: string | null;
  readonly originEntityType?: string | null;
  readonly originEntityId?: string | null;
  readonly causationId?: string | null;
}

export interface DispatchOutcome {
  readonly claimed: boolean;
  readonly request?: RequestRow;
  readonly delivery?: DeliveryRow;
  readonly finalStatus?: string;
}

export class NotificationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M08Emitter;
  private readonly repo: NotifyRepository;
  private readonly providers: ProviderRegistry;
  private readonly leaseSeconds: number;

  constructor(
    db: Db,
    authz: Authz,
    emitter: M08Emitter,
    repo: NotifyRepository = new NotifyRepository(),
    providers: ProviderRegistry = new ProviderRegistry(),
    leaseSeconds = 120,
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.providers = providers;
    this.leaseSeconds = leaseSeconds;
  }

  private static minuteOfDay(): number {
    const now = new Date();
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  /** Create (enqueue) a notification request against the active version of a template. Idempotent per key. */
  async create(ctx: RequestContext, actor: string | null, input: CreateRequestInput): Promise<RequestRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.requestCreate);
    const category: NotificationCategory = input.category ?? 'operational';
    const priority = input.priority ?? 'normal';
    const retryPolicy = input.retryPolicy ?? DEFAULT_RETRY_POLICY;
    try {
      validateRetryPolicy(retryPolicy);
    } catch (e) {
      throw badRequest(e instanceof NotifyError ? e.message : 'invalid retry policy', ctx.correlationId);
    }

    return this.db.withTenant(ctx, async (tx) => {
      const template = await this.repo.findTemplateByKey(tx, input.templateKey);
      if (template === null) throw ProblemError.notFound('Template not found.', ctx.correlationId);
      if (!isChannel(template.channel))
        throw badRequest('template has an invalid channel', ctx.correlationId);
      const channel: Channel = template.channel;
      const active = await this.repo.findActiveVersion(tx, template.id);
      if (active === null)
        throw ProblemError.conflict('Template has no ACTIVE version to send.', ctx.correlationId);

      // Destination + variables validation (fail closed).
      let destination: string;
      try {
        destination = requireDestination(channel, input.destination);
      } catch (e) {
        throw badRequest(e instanceof NotifyError ? e.message : 'invalid destination', ctx.correlationId);
      }
      const spec = active.spec as TemplateSpec;
      const vres = validateVariables(spec.variables, input.variables ?? {});
      if (!vres.ok) throw invalidVariables(vres.errors, ctx.correlationId);
      const variablesHash = contentHashOf(vres.values);

      // Idempotency: a repeated key returns the stored request iff the payload matches; else 409.
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findRequestByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) {
          if (
            existing.variables_hash !== variablesHash ||
            existing.template_version_id !== active.id ||
            existing.destination !== destination
          ) {
            throw ProblemError.conflict(
              'Idempotency key reused with a different payload.',
              ctx.correlationId,
            );
          }
          return existing;
        }
      }

      // Preferences + suppression. Mandatory categories (security/legal) always deliver.
      const suppression = await this.repo.findDestinationSuppression(tx, destination, channel);
      let preference;
      const subjectId =
        typeof input.recipientRef === 'string' && UUID_RE.test(input.recipientRef)
          ? input.recipientRef
          : null;
      if (subjectId !== null) {
        const pref = await this.repo.findSubjectPreference(tx, subjectId, channel);
        if (pref !== null) {
          preference = {
            channel,
            optIn: pref.opt_in,
            suppressed: pref.suppressed,
            ...(pref.quiet_hours !== null
              ? { quietHours: pref.quiet_hours as { startMinute: number; endMinute: number } }
              : {}),
          };
        }
      }
      const decision = evaluateDelivery({
        category,
        channel,
        minuteOfDay: NotificationService.minuteOfDay(),
        ...(preference !== undefined ? { preference } : {}),
        destinationSuppressed: suppression?.suppressed === true,
      });

      const suppressed = !decision.deliver && !decision.defer;
      const status = suppressed ? 'suppressed' : 'queued';
      const nextAttemptAt = suppressed ? null : (input.scheduledAt ?? null);

      const request = await this.repo.insertRequest(tx, {
        tenantId: ctx.tenantId,
        templateVersionId: active.id,
        channel,
        destination,
        recipientRef: input.recipientRef ?? null,
        category,
        priority,
        variables: vres.values,
        variablesHash,
        retryPolicy,
        maxAttempts: retryPolicy.maxAttempts,
        status,
        nextAttemptAt,
        scheduledAt: input.scheduledAt ?? null,
        expiresAt: input.expiresAt ?? null,
        suppressedReason: suppressed ? decision.reason : null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        causationId: input.causationId ?? null,
        originModule: input.originModule ?? null,
        originEntityType: input.originEntityType ?? null,
        originEntityId: input.originEntityId ?? null,
        createdBy: actor,
      });

      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.requestCreated,
        entityType: 'notification_request',
        entityId: request.id,
        detail: { channel, category, status },
      });
      await this.emitter.publish(tx, {
        type: 'NotificationRequested',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(input.causationId != null ? { causationId: input.causationId } : {}),
        ...(actor !== null ? { actor } : {}),
        payload: { id: request.id, channel, status, ...(suppressed ? { reasonCode: decision.reason } : {}) },
      });

      if (suppressed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M08_AUDIT_CODES.requestSuppressed,
          entityType: 'notification_request',
          entityId: request.id,
          detail: { reason: decision.reason },
        });
        await this.emitter.publish(tx, {
          type: 'NotificationSuppressed',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: { id: request.id, channel, status: 'suppressed', reasonCode: decision.reason },
        });
      } else {
        await this.emitter.publish(tx, {
          type: 'NotificationQueued',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: { id: request.id, channel, status: 'queued' },
        });
      }
      return request;
    });
  }

  /**
   * Dispatch one request through its channel provider. Worker-safe: claims a lease first (one winner), records
   * an append-only attempt, and applies the retry policy. All in one transaction so state + evidence + audit +
   * outbox commit atomically. `workerId` identifies the leaseholder.
   */
  async dispatch(
    ctx: RequestContext,
    workerId: string,
    requestId: string,
    actor: string | null = null,
  ): Promise<DispatchOutcome> {
    return this.db.withTenant(ctx, async (tx) => {
      const claim = await this.repo.claimRequest(tx, requestId, workerId, this.leaseSeconds);
      if (claim === null) return { claimed: false };
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.deliveryClaimed,
        entityType: 'notification_request',
        entityId: requestId,
        detail: { attempt: claim.attempt_count, worker: workerId },
      });

      const channel = claim.channel as Channel;
      const version = await this.repo.findVersion(tx, claim.template_version_id);
      if (version === null) throw ProblemError.notFound('Template version not found.', ctx.correlationId);
      const spec = version.spec as TemplateSpec;

      // Render safely. A render failure is a permanent (non-retryable) failure of this request.
      let subject: string | null = null;
      let body: string;
      let renderFailed = false;
      const values = claim.variables as Readonly<Record<string, RenderValue>>;
      try {
        body = renderTemplate(spec.bodyTemplate, values, { escape: channelEscapes(channel) });
        if (channelHasSubject(channel) && spec.subjectTemplate !== undefined) {
          subject = renderTemplate(spec.subjectTemplate, values, { escape: channelEscapes(channel) });
        }
      } catch {
        renderFailed = true;
        body = '';
      }

      const attemptNumber = claim.attempt_count;
      let outcome: 'succeeded' | 'failed';
      let providerCode = 'none';
      let responseCode: string | null = null;
      let errorCategory: ErrorCategory | null = null;
      let retryable = false;
      let providerRef: string | null = null;

      if (renderFailed) {
        outcome = 'failed';
        responseCode = 'RENDER_ERROR';
        errorCategory = 'permanent';
        retryable = false;
      } else {
        const provider = this.providers.for(channel);
        if (provider === null) {
          outcome = 'failed';
          providerCode = 'unconfigured';
          responseCode = 'NO_PROVIDER';
          errorCategory = 'provider_error';
          retryable = true;
        } else {
          const result = await provider.dispatch({
            channel,
            destination: claim.destination,
            subject,
            body,
            correlationId: claim.correlation_id,
          });
          outcome = result.outcome;
          providerCode = result.providerCode;
          responseCode = result.responseCode ?? null;
          errorCategory = result.errorCategory ?? null;
          retryable = result.retryable ?? false;
          providerRef = result.providerRef ?? null;
        }
      }

      // Decide the next state before recording, so the delivery row can carry next_retry_at.
      const policy = claim.retry_policy as RetryPolicy;
      let finalStatus: string;
      let nextAttemptAt: string | null = null;
      if (outcome === 'succeeded') {
        finalStatus = 'delivered';
      } else {
        const decision = retryDecision(policy, attemptNumber, errorCategory ?? 'permanent');
        if (decision.retry) {
          finalStatus = 'retry_scheduled';
          nextAttemptAt = new Date(Date.now() + decision.delayMs).toISOString();
        } else {
          finalStatus = 'exhausted';
        }
      }

      const delivery = await this.repo.insertDelivery(tx, {
        tenantId: ctx.tenantId,
        requestId,
        attemptNumber,
        providerCode,
        outcome,
        responseCode,
        errorCategory,
        retryable,
        providerRef,
        completedAt: new Date().toISOString(),
        nextRetryAt: nextAttemptAt,
        correlationId: claim.correlation_id,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.deliveryAttempted,
        entityType: 'notification_delivery',
        entityId: delivery.id,
        detail: { attempt: attemptNumber, outcome },
      });

      const updated = await this.repo.updateRequestStatus(tx, {
        id: requestId,
        expectedVersion: claim.version,
        toStatus: finalStatus,
        nextAttemptAt,
        lastErrorCategory: errorCategory,
        clearLease: true,
        updatedBy: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Request changed concurrently during dispatch.', ctx.correlationId);

      if (finalStatus === 'delivered') {
        await this.emitter.recordAudit(tx, ctx, {
          code: M08_AUDIT_CODES.deliverySucceeded,
          entityType: 'notification_request',
          entityId: requestId,
          detail: { attempt: attemptNumber },
        });
        await this.emitter.publish(tx, {
          type: 'NotificationDelivered',
          tenantId: ctx.tenantId,
          correlationId: claim.correlation_id,
          ...(actor !== null ? { actor } : {}),
          payload: { id: requestId, channel, status: 'delivered', attempt: attemptNumber },
        });
        // In-app deliveries land in the recipient's inbox.
        if (channel === 'in_app') {
          const inbox = await this.repo.insertInbox(tx, {
            tenantId: ctx.tenantId,
            recipientId: claim.destination,
            requestId,
            severity: 'info',
            title: subject ?? spec.name,
            body,
            deepLink: null,
            originModule: claim.origin_module,
            originEntityType: claim.origin_entity_type,
            originEntityId: claim.origin_entity_id,
            expiresAt: null,
          });
          await this.emitter.publish(tx, {
            type: 'InboxNotificationCreated',
            tenantId: ctx.tenantId,
            correlationId: claim.correlation_id,
            payload: { id: inbox.id, recipientId: claim.destination, severity: 'info', status: 'unread' },
          });
        }
      } else if (finalStatus === 'retry_scheduled') {
        await this.emitter.recordAudit(tx, ctx, {
          code: M08_AUDIT_CODES.retryScheduled,
          entityType: 'notification_request',
          entityId: requestId,
          detail: { attempt: attemptNumber, category: errorCategory },
        });
        await this.emitter.publish(tx, {
          type: 'NotificationRetryScheduled',
          tenantId: ctx.tenantId,
          correlationId: claim.correlation_id,
          ...(actor !== null ? { actor } : {}),
          payload: {
            id: requestId,
            channel,
            status: 'retry_scheduled',
            attempt: attemptNumber,
            ...(errorCategory !== null ? { reasonCode: errorCategory } : {}),
          },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M08_AUDIT_CODES.retryExhausted,
          entityType: 'notification_request',
          entityId: requestId,
          detail: { attempt: attemptNumber, category: errorCategory },
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M08_AUDIT_CODES.deliveryFailed,
          entityType: 'notification_request',
          entityId: requestId,
          detail: { attempt: attemptNumber },
        });
        await this.emitter.publish(tx, {
          type: 'NotificationExhausted',
          tenantId: ctx.tenantId,
          correlationId: claim.correlation_id,
          ...(actor !== null ? { actor } : {}),
          payload: {
            id: requestId,
            channel,
            status: 'exhausted',
            attempt: attemptNumber,
            ...(errorCategory !== null ? { reasonCode: errorCategory } : {}),
          },
        });
      }
      return { claimed: true, request: updated, delivery, finalStatus };
    });
  }

  /** Cancel a non-terminal request. */
  async cancel(
    ctx: RequestContext,
    actor: string | null,
    requestId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<RequestRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.requestCancel);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findRequest(tx, requestId);
      if (existing === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      if (isRequestTerminal(existing.status))
        throw ProblemError.conflict(
          `Request is ${existing.status} and cannot be cancelled.`,
          ctx.correlationId,
        );
      const updated = await this.repo.updateRequestStatus(tx, {
        id: requestId,
        expectedVersion,
        toStatus: 'cancelled',
        nextAttemptAt: null,
        clearLease: true,
        updatedBy: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Request was modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.requestCancelled,
        entityType: 'notification_request',
        entityId: requestId,
        ...(reason !== null ? { reason } : {}),
        detail: { fromStatus: existing.status },
      });
      await this.emitter.publish(tx, {
        type: 'NotificationCancelled',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { id: requestId, channel: existing.channel, status: 'cancelled' },
      });
      return updated;
    });
  }

  /** Manually re-queue a failed/exhausted request for another attempt (authorized retry). */
  async retryNow(
    ctx: RequestContext,
    actor: string | null,
    requestId: string,
    expectedVersion: number,
  ): Promise<RequestRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.requestRetry);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findRequest(tx, requestId);
      if (existing === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
      if (!['failed', 'exhausted', 'retry_scheduled'].includes(existing.status))
        throw ProblemError.conflict(
          `Request in status ${existing.status} cannot be manually retried.`,
          ctx.correlationId,
        );
      const updated = await this.repo.updateRequestStatus(tx, {
        id: requestId,
        expectedVersion,
        toStatus: 'queued',
        nextAttemptAt: new Date().toISOString(),
        clearLease: true,
        updatedBy: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Request was modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.retryRequested,
        entityType: 'notification_request',
        entityId: requestId,
        detail: { fromStatus: existing.status },
      });
      return updated;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async get(ctx: RequestContext, requestId: string): Promise<RequestRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.requestView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findRequest(tx, requestId));
    if (row === null) throw ProblemError.notFound('Request not found.', ctx.correlationId);
    return row;
  }
  async list(ctx: RequestContext, limit = 50, offset = 0): Promise<RequestRow[]> {
    await this.authz.require(ctx, M08_PERMISSIONS.requestView);
    return this.db.withTenant(ctx, (tx) => this.repo.listRequests(tx, Math.min(limit, 200), offset));
  }
  async deliveries(ctx: RequestContext, requestId: string): Promise<DeliveryRow[]> {
    await this.authz.require(ctx, M08_PERMISSIONS.deliveryView);
    return this.db.withTenant(ctx, (tx) => this.repo.listDeliveries(tx, requestId));
  }
}
