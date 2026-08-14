/**
 * SubscriptionService — the governed tenant SUBSCRIPTION lifecycle. A subscription binds an EXPLICIT plan/version (which must
 * be PUBLISHED). Lifecycle draft -> trial -> active -> grace -> suspended -> cancelled/expired, with only governed transitions
 * (`isSubscriptionTransitionAllowed`); a tenant holds ONE live subscription (DB partial unique index). Activation DERIVES the
 * tenant's entitlement assignments from the bound plan version (append-only). Lifecycle changes are a PRIVILEGED controlled
 * action (saas.subscription.manage); AI/system/automation never autonomously change commercial terms. Every transition emits a
 * subscription.lifecycle event through the ONE m06 outbox and is audited through m03 in the same transaction.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M39_PERMISSIONS } from './permissions.ts';
import { M39_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
import {
  isHumanActor,
  isSubscriptionTransitionAllowed,
  clampPage,
  REASON_CODES,
  type SubscriptionState,
} from './domain.ts';
import { SaasRepository, type SubscriptionRow } from './repository.ts';
import type { M39Emitter } from './emit.ts';

export class SubscriptionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M39Emitter;
  private readonly repo: SaasRepository;
  constructor(db: Db, authz: Authz, emitter: M39Emitter, repo: SaasRepository = new SaasRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async createSubscription(
    ctx: RequestContext,
    input: { subscriptionKey: string; planId: string; planVersionId: string },
  ): Promise<SubscriptionRow> {
    await this.authz.require(ctx, M39_PERMISSIONS.subscriptionManage);
    if (!input.subscriptionKey) throw badRequest('subscriptionKey is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getPlanVersion(tx, input.planVersionId);
      if (version?.plan_id !== input.planId) throw notFound('plan version not found.', ctx.correlationId);
      if (version.state !== 'published')
        throw governanceForbidden(REASON_CODES.planNotPublished, ctx.correlationId);
      const sub = await this.repo.insertSubscription(tx, {
        tenantId: ctx.tenantId,
        subscriptionKey: input.subscriptionKey,
        planId: input.planId,
        planVersionId: input.planVersionId,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.subscriptionCreated,
        entityType: 'saas_subscription',
        entityId: sub.id,
        detail: { planId: input.planId, planVersionId: input.planVersionId },
      });
      return sub;
    });
  }

  /** Activate (draft/trial -> active). Derives the tenant's entitlement assignments from the bound plan version. */
  async activateSubscription(
    ctx: RequestContext,
    id: string,
    expectedVersion: number,
  ): Promise<SubscriptionRow> {
    return this.transition(
      ctx,
      id,
      expectedVersion,
      'active',
      M39_AUDIT_CODES.subscriptionActivated,
      'SubscriptionActivated',
      true,
    );
  }
  async suspendSubscription(
    ctx: RequestContext,
    id: string,
    expectedVersion: number,
  ): Promise<SubscriptionRow> {
    return this.transition(
      ctx,
      id,
      expectedVersion,
      'suspended',
      M39_AUDIT_CODES.subscriptionSuspended,
      'SubscriptionSuspended',
      false,
    );
  }
  async cancelSubscription(
    ctx: RequestContext,
    id: string,
    expectedVersion: number,
  ): Promise<SubscriptionRow> {
    return this.transition(
      ctx,
      id,
      expectedVersion,
      'cancelled',
      M39_AUDIT_CODES.subscriptionCancelled,
      'SubscriptionCancelled',
      false,
    );
  }
  async renewSubscription(
    ctx: RequestContext,
    id: string,
    expectedVersion: number,
  ): Promise<SubscriptionRow> {
    return this.transition(
      ctx,
      id,
      expectedVersion,
      'active',
      M39_AUDIT_CODES.subscriptionRenewed,
      'SubscriptionActivated',
      false,
    );
  }

  /** Change the bound plan/version on an active subscription (upgrade/downgrade). The new version must be published. */
  async changePlan(
    ctx: RequestContext,
    id: string,
    expectedVersion: number,
    input: { planId: string; planVersionId: string },
  ): Promise<SubscriptionRow> {
    await this.authz.require(ctx, M39_PERMISSIONS.subscriptionManage);
    return this.db.withTenant(ctx, async (tx) => {
      const sub = await this.repo.getSubscription(tx, id);
      if (!sub) throw notFound('subscription not found.', ctx.correlationId);
      const version = await this.repo.getPlanVersion(tx, input.planVersionId);
      if (version?.plan_id !== input.planId) throw notFound('plan version not found.', ctx.correlationId);
      if (version.state !== 'published')
        throw governanceForbidden(REASON_CODES.planNotPublished, ctx.correlationId);
      if (!isSubscriptionTransitionAllowed(sub.state as SubscriptionState, 'active'))
        throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const updated = await this.repo.updateSubscription(tx, id, expectedVersion, {
        state: 'active',
        planId: input.planId,
        planVersionId: input.planVersionId,
        currentPeriodKey: sub.current_period_key,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.deriveEntitlements(tx, ctx, input.planVersionId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        subjectKind: 'subscription',
        subjectId: id,
        fromState: sub.state,
        toState: 'active',
        reasonCode: 'plan_changed',
        actor: ctx.userId ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.subscriptionPlanChanged,
        entityType: 'saas_subscription',
        entityId: id,
        detail: { planId: input.planId, planVersionId: input.planVersionId },
      });
      await this.emitter.publishSubscription(tx, 'SubscriptionPlanChanged', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: {
          subscriptionId: id,
          planId: input.planId,
          planVersionId: input.planVersionId,
          toState: 'active',
        },
      });
      return updated;
    });
  }

  private async transition(
    ctx: RequestContext,
    id: string,
    expectedVersion: number,
    to: SubscriptionState,
    auditCode: string,
    eventType: 'SubscriptionActivated' | 'SubscriptionSuspended' | 'SubscriptionCancelled',
    derive: boolean,
  ): Promise<SubscriptionRow> {
    await this.authz.require(ctx, M39_PERMISSIONS.subscriptionManage);
    // A system/ai/automation actor can never drive a commercial lifecycle change.
    if (!isHumanActor(ctx.userId))
      throw governanceForbidden(REASON_CODES.notHumanApprover, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const sub = await this.repo.getSubscription(tx, id);
      if (!sub) throw notFound('subscription not found.', ctx.correlationId);
      if (!isSubscriptionTransitionAllowed(sub.state as SubscriptionState, to))
        throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const updated = await this.repo.updateSubscription(tx, id, expectedVersion, {
        state: to,
        planId: sub.plan_id,
        planVersionId: sub.plan_version_id,
        currentPeriodKey: sub.current_period_key,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      if (derive) await this.deriveEntitlements(tx, ctx, sub.plan_version_id);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        subjectKind: 'subscription',
        subjectId: id,
        fromState: sub.state,
        toState: to,
        reasonCode: null,
        actor: ctx.userId ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'saas_subscription',
        entityId: id,
        detail: { fromState: sub.state, toState: to },
      });
      await this.emitter.publishSubscription(tx, eventType, {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: {
          subscriptionId: id,
          planId: sub.plan_id,
          planVersionId: sub.plan_version_id,
          fromState: sub.state,
          toState: to,
        },
      });
      return updated;
    });
  }

  /** Derive entitlement assignments from a plan version's entitlement catalogue (append-only; source_kind='plan'). */
  private async deriveEntitlements(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    ctx: RequestContext,
    planVersionId: string,
  ): Promise<void> {
    const entitlements = await this.repo.listPlanEntitlements(tx, planVersionId);
    for (const e of entitlements) {
      const row = await this.repo.insertEntitlementAssignment(tx, {
        tenantId: ctx.tenantId,
        capabilityKey: e.capability_key,
        allowance: e.allowance,
        sourceKind: 'plan',
        sourceRef: planVersionId,
        reasonCode: null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.entitlementAssigned,
        entityType: 'saas_entitlement_assignment',
        entityId: row.id,
        detail: { capabilityKey: e.capability_key, source: 'plan' },
      });
    }
  }

  async getSubscription(ctx: RequestContext, id: string): Promise<SubscriptionRow | null> {
    await this.authz.require(ctx, M39_PERMISSIONS.subscriptionRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getSubscription(tx, id));
  }
  async listSubscriptions(ctx: RequestContext, page?: number, size?: number): Promise<SubscriptionRow[]> {
    await this.authz.require(ctx, M39_PERMISSIONS.subscriptionRead);
    const { limit, offset } = clampPage(page, size);
    return this.db.withTenant(ctx, (tx) => this.repo.listSubscriptions(tx, limit, offset));
  }
}
