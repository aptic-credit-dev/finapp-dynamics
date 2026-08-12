/**
 * WebhookService — external webhook ENDPOINTS + their event SUBSCRIPTIONS. Registering an endpoint validates its URL against
 * the SSRF allow-list (https, PUBLIC host only — fail closed). Activating an endpoint (that egresses tenant data) is a
 * CONTROLLED action: maker-checker/SoD (the approver must be a HUMAN who is NOT the requester; AI never approves) over a
 * passing validation; an approved endpoint's url/key is immutable (DB trigger). A subscription may only target a REGISTERED
 * domain-event family. Every mutation authorizes an `events.*` permission (default deny) and is audited through m03 in the
 * same transaction. The signing secret is an opaque m30 `secretref:` pointer only.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M36_PERMISSIONS } from './permissions.ts';
import { M36_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  validateEndpoint,
  validateEndpointUrl,
  isRegisteredEventFamily,
  evaluateApprovalGate,
  evaluateSodGate,
  clampPage,
  REASON_CODES,
} from './domain.ts';
import { EventsRepository, type EndpointRow, type SubscriptionRow } from './repository.ts';
import type { M36Emitter } from './emit.ts';

export class WebhookService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M36Emitter;
  private readonly repo: EventsRepository;
  constructor(db: Db, authz: Authz, emitter: M36Emitter, repo: EventsRepository = new EventsRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M36_PERMISSIONS.administer);
  }

  async registerEndpoint(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      endpointKey: string;
      url: string;
      description?: string | null;
      signingSecretRef?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<EndpointRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.webhookManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (input.endpointKey.trim() === '') throw badRequest('an endpoint key is required.', ctx.correlationId);
    // SSRF allow-list — an insecure or private/loopback URL is refused at registration (fail closed).
    const urlFindings = validateEndpointUrl(input.url);
    if (urlFindings.length > 0)
      throw governanceForbidden(urlFindings[0]?.code ?? REASON_CODES.privateUrl, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findEndpointByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const endpoint = await this.repo.insertEndpoint(tx, {
        tenantId: ctx.tenantId,
        scope,
        endpointKey: input.endpointKey,
        url: input.url,
        description: input.description ?? null,
        signingSecretRef: input.signingSecretRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'endpoint',
        targetId: endpoint.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.endpointRegistered,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.endpointRegistered,
        entityType: 'webhook_endpoint',
        entityId: endpoint.id,
        detail: { endpointKey: input.endpointKey, scope },
      });
      return endpoint;
    });
  }

  async requestReview(
    ctx: RequestContext,
    actor: string | null,
    endpointId: string,
    expectedVersion: number,
  ): Promise<EndpointRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.webhookManage);
    if (actor === null || actor.trim() === '')
      throw badRequest('an identified requester is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const endpoint = await this.repo.getEndpoint(tx, endpointId);
      if (endpoint === null) throw badRequest('unknown endpoint.', ctx.correlationId);
      if (endpoint.state !== 'draft')
        throw badRequest('only a draft endpoint can be sent for review.', ctx.correlationId);
      const outcome = validateEndpoint({ url: endpoint.url, signingSecretRef: endpoint.signing_secret_ref });
      if (!outcome.passed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M36_AUDIT_CODES.approvalBlocked,
          entityType: 'webhook_endpoint',
          entityId: endpointId,
          detail: { reasonCode: outcome.findings[0]?.code ?? REASON_CODES.structuralInvalid },
        });
        throw governanceForbidden(
          outcome.findings[0]?.code ?? REASON_CODES.structuralInvalid,
          ctx.correlationId,
        );
      }
      const moved = await this.repo.updateEndpointState(tx, endpointId, expectedVersion, {
        state: 'review_pending',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'endpoint',
        targetId: endpointId,
        kind: 'requested',
        requestedBy: actor,
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.reviewRequested,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.endpointReviewRequested,
        entityType: 'webhook_endpoint',
        entityId: endpointId,
        detail: { endpointKey: endpoint.endpoint_key },
      });
      return moved;
    });
  }

  /** Approve (activate) an endpoint — a controlled action (maker-checker/SoD over a passing validation). AI never approves. */
  async approveEndpoint(
    ctx: RequestContext,
    actor: string | null,
    endpointId: string,
    expectedVersion: number,
  ): Promise<EndpointRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.webhookApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const endpoint = await this.repo.getEndpoint(tx, endpointId);
      if (endpoint === null) throw badRequest('unknown endpoint.', ctx.correlationId);
      await this.authorizeScope(ctx, endpoint.scope);
      if (endpoint.state !== 'review_pending')
        throw badRequest('only an endpoint in review can be approved.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'endpoint', endpointId);
      const gate = evaluateApprovalGate({
        validationPassed: endpoint.validation_passed,
        requestedBy: request?.requested_by ?? '',
        approver: actor,
      });
      if (!gate.allowed) {
        const code =
          gate.reasonCode === REASON_CODES.selfApproval || gate.reasonCode === REASON_CODES.notHumanApprover
            ? M36_AUDIT_CODES.sodBlocked
            : M36_AUDIT_CODES.approvalBlocked;
        await this.emitter.recordAudit(tx, ctx, {
          code,
          entityType: 'webhook_endpoint',
          entityId: endpointId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateEndpointState(tx, endpointId, expectedVersion, {
        state: 'active',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'endpoint',
        targetId: endpointId,
        kind: 'approved',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.endpointApproved,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'endpoint',
        targetId: endpointId,
        fromStatus: 'review_pending',
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.endpointApproved,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.endpointApproved,
        entityType: 'webhook_endpoint',
        entityId: endpointId,
        detail: { endpointKey: endpoint.endpoint_key },
      });
      await this.emitter.publishWebhook(tx, 'EndpointApproved', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: endpointId,
          recordType: 'endpoint',
          toStatus: 'active',
          reasonCode: REASON_CODES.endpointApproved,
        },
      });
      return moved;
    });
  }

  async rejectReview(
    ctx: RequestContext,
    actor: string | null,
    endpointId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<EndpointRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.webhookApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const endpoint = await this.repo.getEndpoint(tx, endpointId);
      if (endpoint === null) throw badRequest('unknown endpoint.', ctx.correlationId);
      if (endpoint.state !== 'review_pending')
        throw badRequest('only an endpoint in review can be rejected.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'endpoint', endpointId);
      const sod = evaluateSodGate(request?.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M36_AUDIT_CODES.sodBlocked,
          entityType: 'webhook_endpoint',
          entityId: endpointId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateEndpointState(tx, endpointId, expectedVersion, {
        state: 'rejected',
        validationPassed: endpoint.validation_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'endpoint',
        targetId: endpointId,
        kind: 'rejected',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason,
        reasonCode: REASON_CODES.endpointRejected,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.endpointRejected,
        entityType: 'webhook_endpoint',
        entityId: endpointId,
        detail: {},
      });
      return moved;
    });
  }

  async suspendEndpoint(ctx: RequestContext, actor: string | null, endpointId: string): Promise<EndpointRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.webhookManage);
    return this.db.withTenant(ctx, async (tx) => {
      const endpoint = await this.repo.getEndpoint(tx, endpointId);
      if (endpoint === null) throw badRequest('unknown endpoint.', ctx.correlationId);
      if (endpoint.state !== 'active')
        throw badRequest('only an active endpoint can be suspended.', ctx.correlationId);
      const moved = await this.repo.updateEndpointState(tx, endpointId, endpoint.version, {
        state: 'suspended',
        validationPassed: endpoint.validation_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'endpoint',
        targetId: endpointId,
        fromStatus: 'active',
        toStatus: 'suspended',
        reason: null,
        reasonCode: REASON_CODES.endpointSuspended,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.endpointSuspended,
        entityType: 'webhook_endpoint',
        entityId: endpointId,
        detail: {},
      });
      await this.emitter.publishWebhook(tx, 'EndpointSuspended', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: endpointId,
          recordType: 'endpoint',
          toStatus: 'suspended',
          reasonCode: REASON_CODES.endpointSuspended,
        },
      });
      return moved;
    });
  }

  /** Subscribe an endpoint to a REGISTERED event family/type ('*' = all types in the family). */
  async addSubscription(
    ctx: RequestContext,
    actor: string | null,
    endpointId: string,
    input: { eventFamily: string; eventType?: string },
  ): Promise<SubscriptionRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.subscriptionManage);
    const eventType = input.eventType ?? '*';
    if (!isRegisteredEventFamily(input.eventFamily))
      throw governanceForbidden(REASON_CODES.unknownEventFamily, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const endpoint = await this.repo.getEndpoint(tx, endpointId);
      if (endpoint === null) throw badRequest('unknown endpoint.', ctx.correlationId);
      const sub = await this.repo.insertSubscription(tx, {
        tenantId: ctx.tenantId,
        endpointId,
        eventFamily: input.eventFamily,
        eventType,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.subscriptionAdded,
        entityType: 'webhook_subscription',
        entityId: sub.id,
        detail: { endpointId, eventFamily: input.eventFamily, eventType },
      });
      return sub;
    });
  }

  async getEndpoint(ctx: RequestContext, id: string): Promise<EndpointRow | null> {
    await this.authz.require(ctx, M36_PERMISSIONS.webhookRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getEndpoint(tx, id));
  }
  async listEndpoints(
    ctx: RequestContext,
    page?: { limit?: number; offset?: number },
  ): Promise<EndpointRow[]> {
    await this.authz.require(ctx, M36_PERMISSIONS.webhookRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listEndpoints(tx, limit, offset));
  }
}
