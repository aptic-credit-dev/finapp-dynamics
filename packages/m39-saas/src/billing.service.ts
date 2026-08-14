/**
 * BillingService — commercial billing-cycle METADATA only. It opens/closes a billing cycle for a subscription and emits
 * billing.lifecycle events; it POSTS NO JOURNAL, mutates no GL and creates no payment. Actual settlement with an external
 * provider goes through the fail-closed `BillingProviderPort` (deferred, OPEN_QUESTIONS #2) — nothing is collected here. The
 * cycle amount/currency are inherited from the subscription's plan version (bigint minor units; no float). provider_ref is an
 * OPAQUE external reference, never a secret.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M39_PERMISSIONS } from './permissions.ts';
import { M39_AUDIT_CODES } from './audit-codes.ts';
import { notFound, versionConflict } from './errors.ts';
import { SaasRepository, type BillingCycleRow } from './repository.ts';
import type { M39Emitter } from './emit.ts';
import type { BillingProviderPort } from './ports.ts';

export class BillingService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M39Emitter;
  private readonly provider: BillingProviderPort;
  private readonly repo: SaasRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M39Emitter,
    provider: BillingProviderPort,
    repo: SaasRepository = new SaasRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.provider = provider;
    this.repo = repo;
  }

  async openCycle(
    ctx: RequestContext,
    subscriptionId: string,
    input: { cycleStart: Date; cycleEnd: Date; nextRenewal?: Date | null; providerRef?: string | null },
  ): Promise<BillingCycleRow> {
    await this.authz.require(ctx, M39_PERMISSIONS.subscriptionManage);
    return this.db.withTenant(ctx, async (tx) => {
      const sub = await this.repo.getSubscription(tx, subscriptionId);
      if (!sub) throw notFound('subscription not found.', ctx.correlationId);
      const cycle = await this.repo.insertBillingCycle(tx, {
        tenantId: ctx.tenantId,
        subscriptionId,
        cycleStart: input.cycleStart,
        cycleEnd: input.cycleEnd,
        nextRenewal: input.nextRenewal ?? null,
        providerRef: input.providerRef ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.billingCycleOpened,
        entityType: 'saas_billing_cycle',
        entityId: cycle.id,
        detail: { subscriptionId },
      });
      await this.emitter.publishBilling(tx, 'BillingCycleOpened', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { billingCycleId: cycle.id, subscriptionId, status: 'open' },
      });
      return cycle;
    });
  }

  /**
   * Close a billing cycle (metadata). Settlement with an external provider is delegated to the fail-closed `BillingProviderPort`
   * (deferred, OPEN_QUESTIONS #2) — the default returns not-settled, and the cycle still closes as internal metadata (nothing is
   * collected externally, no journal is posted). The amount/currency come from the subscription's plan version (bigint minor).
   */
  async closeCycle(ctx: RequestContext, id: string, expectedVersion: number): Promise<BillingCycleRow> {
    await this.authz.require(ctx, M39_PERMISSIONS.subscriptionManage);
    return this.db.withTenant(ctx, async (tx) => {
      const cycle = await this.repo.getBillingCycle(tx, id);
      if (!cycle) throw notFound('billing cycle not found.', ctx.correlationId);
      const sub = await this.repo.getSubscription(tx, cycle.subscription_id);
      const version = sub ? await this.repo.getPlanVersion(tx, sub.plan_version_id) : null;
      // Framework-only settlement attempt (fail-closed default collects nothing; the cycle closes as metadata regardless).
      await this.provider.settleCycle(ctx, {
        subscriptionId: cycle.subscription_id,
        amountMinor: version ? BigInt(version.base_amount_minor) : 0n,
        currency: version?.currency ?? 'USD',
      });
      const updated = await this.repo.updateBillingCycle(tx, id, expectedVersion, {
        status: 'closed',
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.billingCycleClosed,
        entityType: 'saas_billing_cycle',
        entityId: id,
        detail: { subscriptionId: updated.subscription_id },
      });
      await this.emitter.publishBilling(tx, 'BillingCycleClosed', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { billingCycleId: id, subscriptionId: updated.subscription_id, status: 'closed' },
      });
      return updated;
    });
  }
}
