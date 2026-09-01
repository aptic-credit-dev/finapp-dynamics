/**
 * SubscriptionService — an app SUBSCRIBES to a published product and a human APPROVES it (the public-exposure grant). THE
 * CONTROLS: the product must be PUBLISHED; approval is maker-checker (the approver must be a HUMAN who is NOT the requester);
 * a PUBLIC product additionally requires the m39-saas quota to permit it (consumed through the fail-closed UsageQuotaPort —
 * m39 is unbuilt, so public approval FAILS CLOSED by default); suspension withdraws access. Every mutation authorizes a
 * `devportal.*` permission (default deny) and is audited through m03 in the same transaction. m35 owns no quota engine.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M35_PERMISSIONS } from './permissions.ts';
import { M35_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import { isPublicVisibility, evaluateSodGate, REASON_CODES, clampPage } from './domain.ts';
import { DevportalRepository, type SubscriptionRow, type SubscriptionReadRow } from './repository.ts';
import type { M35Emitter } from './emit.ts';
import type { UsageQuotaPort } from './ports.ts';

export class SubscriptionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M35Emitter;
  private readonly quota: UsageQuotaPort;
  private readonly repo: DevportalRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M35Emitter,
    quota: UsageQuotaPort,
    repo: DevportalRepository = new DevportalRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.quota = quota;
    this.repo = repo;
  }

  /** Request a subscription of an app to a PUBLISHED product (awaits maker-checker approval). */
  async requestSubscription(
    ctx: RequestContext,
    actor: string | null,
    input: { appId: string; productId: string; idempotencyKey?: string | null },
  ): Promise<SubscriptionRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.subscriptionManage);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findSubscriptionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const app = await this.repo.getApp(tx, input.appId);
      if (app === null) throw badRequest('unknown app.', ctx.correlationId);
      if (app.status !== 'active') throw badRequest('only an active app can subscribe.', ctx.correlationId);
      const product = await this.repo.getProduct(tx, input.productId);
      if (product === null) throw badRequest('unknown product.', ctx.correlationId);
      if (product.state !== 'published')
        throw governanceForbidden(REASON_CODES.productNotPublished, ctx.correlationId);
      const sub = await this.repo.insertSubscription(tx, {
        tenantId: ctx.tenantId,
        appId: input.appId,
        productId: input.productId,
        requestedBy: actor,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'subscription',
        targetId: sub.id,
        kind: 'requested',
        requestedBy: actor ?? '',
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.subscriptionRequested,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'subscription',
        targetId: sub.id,
        fromStatus: null,
        toStatus: 'requested',
        reason: null,
        reasonCode: REASON_CODES.subscriptionRequested,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.subscriptionRequested,
        entityType: 'devportal_subscription',
        entityId: sub.id,
        detail: { appId: input.appId, productId: input.productId },
      });
      return sub;
    });
  }

  /** Approve a subscription — maker-checker (approver != requester, human); a PUBLIC product also needs the m39 quota. */
  async approveSubscription(
    ctx: RequestContext,
    actor: string | null,
    subscriptionId: string,
  ): Promise<SubscriptionRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.subscriptionManage);
    // Phase 1 — load + SoD gate.
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const sub = await this.repo.getSubscription(tx, subscriptionId);
      if (sub === null) throw badRequest('unknown subscription.', ctx.correlationId);
      if (sub.status !== 'requested')
        throw badRequest('only a requested subscription can be approved.', ctx.correlationId);
      const product = await this.repo.getProduct(tx, sub.product_id);
      if (product === null) throw badRequest('unknown product.', ctx.correlationId);
      const sod = evaluateSodGate(sub.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M35_AUDIT_CODES.sodBlocked,
          entityType: 'devportal_subscription',
          entityId: subscriptionId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      return { sub, product };
    });

    // Phase 2 — a PUBLIC product's exposure is gated by the m39 quota (fail closed while m39 is unbuilt).
    if (isPublicVisibility(prepared.product.visibility)) {
      const decision = await this.quota.checkSubscriptionQuota(ctx, {
        appRef: prepared.sub.app_id,
        productRef: prepared.sub.product_id,
        visibility: prepared.product.visibility,
      });
      if (!decision.allowed) {
        await this.db.withTenant(ctx, (tx) =>
          this.emitter.recordAudit(tx, ctx, {
            code: M35_AUDIT_CODES.exposureBlocked,
            entityType: 'devportal_subscription',
            entityId: subscriptionId,
            detail: { reasonCode: decision.reasonCode },
          }),
        );
        throw governanceForbidden(decision.reasonCode, ctx.correlationId);
      }
    }

    // Phase 3 — activate.
    return this.db.withTenant(ctx, async (tx) => {
      const sub = await this.repo.getSubscription(tx, subscriptionId);
      if (sub?.status !== 'requested') throw versionConflict(ctx.correlationId);
      const activated = await this.repo.updateSubscriptionStatus(tx, subscriptionId, sub.version, {
        status: 'active',
        approvedBy: actor,
        by: actor,
      });
      if (activated === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'subscription',
        targetId: subscriptionId,
        kind: 'approved',
        requestedBy: sub.requested_by ?? '',
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.subscriptionActivated,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'subscription',
        targetId: subscriptionId,
        fromStatus: 'requested',
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.subscriptionActivated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.subscriptionActivated,
        entityType: 'devportal_subscription',
        entityId: subscriptionId,
        detail: { appId: sub.app_id, productId: sub.product_id },
      });
      await this.emitter.publishDevportal(tx, 'SubscriptionActivated', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: subscriptionId,
          recordType: 'subscription',
          toStatus: 'active',
          reasonCode: REASON_CODES.subscriptionActivated,
        },
      });
      return activated;
    });
  }

  /** Suspend an active subscription (withdraw public API access). */
  async suspendSubscription(
    ctx: RequestContext,
    actor: string | null,
    subscriptionId: string,
  ): Promise<SubscriptionRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.subscriptionManage);
    return this.db.withTenant(ctx, async (tx) => {
      const sub = await this.repo.getSubscription(tx, subscriptionId);
      if (sub === null) throw badRequest('unknown subscription.', ctx.correlationId);
      if (sub.status !== 'active')
        throw badRequest('only an active subscription can be suspended.', ctx.correlationId);
      const suspended = await this.repo.updateSubscriptionStatus(tx, subscriptionId, sub.version, {
        status: 'suspended',
        approvedBy: null,
        by: actor,
      });
      if (suspended === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'subscription',
        targetId: subscriptionId,
        fromStatus: 'active',
        toStatus: 'suspended',
        reason: null,
        reasonCode: REASON_CODES.subscriptionSuspended,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.subscriptionSuspended,
        entityType: 'devportal_subscription',
        entityId: subscriptionId,
        detail: {},
      });
      await this.emitter.publishDevportal(tx, 'SubscriptionSuspended', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: subscriptionId,
          recordType: 'subscription',
          toStatus: 'suspended',
          reasonCode: REASON_CODES.subscriptionSuspended,
        },
      });
      return suspended;
    });
  }

  async getSubscription(ctx: RequestContext, id: string): Promise<SubscriptionRow | null> {
    await this.authz.require(ctx, M35_PERMISSIONS.subscriptionManage);
    return this.db.withTenant(ctx, (tx) => this.repo.getSubscription(tx, id));
  }
  /** Read-model: the tenant's app→product subscriptions (requested/active/suspended). Gated on subscription.manage —
   * mirrors getSubscription; there is NO separate subscription-read permission, so viewing subscriptions is a
   * privileged capability (a pure read-only developer does not see them). */
  async listSubscriptions(
    ctx: RequestContext,
    page?: { limit?: number; offset?: number },
  ): Promise<SubscriptionReadRow[]> {
    await this.authz.require(ctx, M35_PERMISSIONS.subscriptionManage);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listSubscriptions(tx, limit, offset));
  }
  async listSubscriptionsByApp(ctx: RequestContext, appId: string): Promise<SubscriptionReadRow[]> {
    await this.authz.require(ctx, M35_PERMISSIONS.subscriptionManage);
    return this.db.withTenant(ctx, (tx) => this.repo.listSubscriptionsByApp(tx, appId));
  }
}
