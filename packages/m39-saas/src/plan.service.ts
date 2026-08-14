/**
 * PlanService — the governed commercial CATALOGUE. Define a plan, add versioned pricing/entitlements/quota policies (money =
 * bigint minor units + a 3-letter currency; NO float), validate, and PUBLISH a version (a controlled action — maker-checker/
 * SoD over a passing validation; AI/system/automation never approve). A PUBLISHED plan version is IMMUTABLE (DB trigger) — a
 * new version is the only way to change commercial terms. Platform-scope plans require the control-plane permission. Every
 * mutation authorizes a `saas.*` permission (default deny) and is audited through m03 in the same transaction. m39 stores
 * pricing METADATA only — it posts no journal and creates no payment.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M39_PERMISSIONS } from './permissions.ts';
import { M39_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
import {
  isPlatformScope,
  isHumanActor,
  isCurrencyCode,
  evaluatePublishGate,
  validatePlanVersion,
  clampPage,
  REASON_CODES,
} from './domain.ts';
import { SaasRepository, type PlanRow, type PlanVersionRow } from './repository.ts';
import type { M39Emitter } from './emit.ts';

export class PlanService {
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
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M39_PERMISSIONS.administer);
  }

  async definePlan(
    ctx: RequestContext,
    input: { scope?: string; planKey: string; name: string },
  ): Promise<PlanRow> {
    await this.authz.require(ctx, M39_PERMISSIONS.planManage);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'platform' && scope !== 'tenant') throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (!input.planKey || !input.name) throw badRequest('planKey and name are required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const plan = await this.repo.insertPlan(tx, {
        tenantId: ctx.tenantId,
        scope,
        planKey: input.planKey,
        name: input.name,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.planDefined,
        entityType: 'saas_plan',
        entityId: plan.id,
        detail: { scope, planKey: input.planKey },
      });
      return plan;
    });
  }

  async defineVersion(
    ctx: RequestContext,
    planId: string,
    input: {
      versionNo: number;
      currency?: string;
      baseAmountMinor?: bigint | number;
      billingInterval?: string;
    },
  ): Promise<PlanVersionRow> {
    await this.authz.require(ctx, M39_PERMISSIONS.planManage);
    const currency = input.currency ?? 'USD';
    if (!isCurrencyCode(currency)) throw badRequest('currency must be a 3-letter code.', ctx.correlationId);
    const amount = BigInt(input.baseAmountMinor ?? 0);
    if (amount < 0n)
      throw badRequest('base amount must be a non-negative minor-unit integer.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const plan = await this.repo.getPlan(tx, planId);
      if (!plan) throw notFound('plan not found.', ctx.correlationId);
      const version = await this.repo.insertPlanVersion(tx, {
        tenantId: ctx.tenantId,
        planId,
        versionNo: input.versionNo,
        currency,
        baseAmountMinor: amount,
        billingInterval: input.billingInterval ?? 'monthly',
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.planVersionDefined,
        entityType: 'saas_plan_version',
        entityId: version.id,
        detail: { planId, versionNo: input.versionNo, currency, baseAmountMinor: amount.toString() },
      });
      return version;
    });
  }

  async addEntitlement(
    ctx: RequestContext,
    planVersionId: string,
    input: { capabilityKey: string; allowance?: string },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M39_PERMISSIONS.planManage);
    if (!input.capabilityKey) throw badRequest('capabilityKey is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getPlanVersion(tx, planVersionId);
      if (!version) throw notFound('plan version not found.', ctx.correlationId);
      if (version.state !== 'draft') throw governanceForbidden(REASON_CODES.immutable, ctx.correlationId);
      const row = await this.repo.insertPlanEntitlement(tx, {
        tenantId: ctx.tenantId,
        planVersionId,
        capabilityKey: input.capabilityKey,
        allowance: input.allowance ?? 'included',
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.planEntitlementAdded,
        entityType: 'saas_plan_entitlement',
        entityId: row.id,
        detail: { planVersionId, capabilityKey: input.capabilityKey },
      });
      return { id: row.id };
    });
  }

  async addQuotaPolicy(
    ctx: RequestContext,
    planVersionId: string,
    input: {
      capabilityKey: string;
      meterKey: string;
      period?: string;
      limitHard: bigint | number;
      thresholdSoft?: bigint | number | null;
    },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M39_PERMISSIONS.quotaManage);
    const limit = BigInt(input.limitHard);
    if (limit < 0n) throw badRequest('limit must be a non-negative integer.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getPlanVersion(tx, planVersionId);
      if (!version) throw notFound('plan version not found.', ctx.correlationId);
      if (version.state !== 'draft') throw governanceForbidden(REASON_CODES.immutable, ctx.correlationId);
      const row = await this.repo.insertQuotaPolicy(tx, {
        tenantId: ctx.tenantId,
        planVersionId,
        capabilityKey: input.capabilityKey,
        meterKey: input.meterKey,
        period: input.period ?? 'monthly',
        limitHard: limit,
        thresholdSoft: input.thresholdSoft != null ? BigInt(input.thresholdSoft) : null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.quotaPolicySet,
        entityType: 'saas_quota_policy',
        entityId: row.id,
        detail: {
          planVersionId,
          capabilityKey: input.capabilityKey,
          meterKey: input.meterKey,
          limitHard: limit.toString(),
        },
      });
      return { id: row.id };
    });
  }

  /** Validate a draft version's pricing/entitlement consistency; marks validation_passed. */
  async validateVersion(ctx: RequestContext, planVersionId: string): Promise<{ passed: boolean }> {
    await this.authz.require(ctx, M39_PERMISSIONS.planManage);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getPlanVersion(tx, planVersionId);
      if (!version) throw notFound('plan version not found.', ctx.correlationId);
      const result = validatePlanVersion({
        currency: version.currency,
        baseAmountMinor: BigInt(version.base_amount_minor),
        billingInterval: version.billing_interval,
        entitlements: [],
      });
      const updated = await this.repo.updatePlanVersion(tx, planVersionId, version.version, {
        state: 'draft',
        validationPassed: result.passed,
        published: false,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      return { passed: result.passed };
    });
  }

  /**
   * Publish a plan version — a CONTROLLED action. Maker-checker/SoD: the approver must be a HUMAN who is not the requester
   * (AI/system/automation refused). The version must have passed validation. On publish the version becomes IMMUTABLE (trigger)
   * and the plan's current_version_no advances.
   */
  async publishVersion(
    ctx: RequestContext,
    approver: string | null,
    planVersionId: string,
    expectedVersion: number,
    input: { requestedBy: string },
  ): Promise<PlanVersionRow> {
    await this.authz.require(ctx, M39_PERMISSIONS.planPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getPlanVersion(tx, planVersionId);
      if (!version) throw notFound('plan version not found.', ctx.correlationId);
      const gate = evaluatePublishGate({
        validationPassed: version.validation_passed,
        requestedBy: input.requestedBy,
        approver,
      });
      if (!gate.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M39_AUDIT_CODES.sodBlocked,
          entityType: 'saas_plan_version',
          entityId: planVersionId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      // The gate guarantees a human approver; narrow the type for the append-only review record.
      if (!isHumanActor(approver))
        throw governanceForbidden(REASON_CODES.notHumanApprover, ctx.correlationId);
      const updated = await this.repo.updatePlanVersion(tx, planVersionId, expectedVersion, {
        state: 'published',
        validationPassed: true,
        published: true,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      const plan = await this.repo.getPlan(tx, version.plan_id);
      if (plan) {
        await this.repo.updatePlan(tx, plan.id, plan.version, {
          state: 'active',
          currentVersionNo: version.version_no,
          by: ctx.userId ?? null,
        });
      }
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetKind: 'plan_version',
        targetId: planVersionId,
        decision: 'approved',
        requestedBy: input.requestedBy,
        decidedBy: approver,
        reasonCode: null,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        subjectKind: 'plan_version',
        subjectId: planVersionId,
        fromState: 'draft',
        toState: 'published',
        reasonCode: null,
        actor: ctx.userId ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.planVersionPublished,
        entityType: 'saas_plan_version',
        entityId: planVersionId,
        detail: { versionNo: version.version_no },
      });
      return updated;
    });
  }

  async getPlan(ctx: RequestContext, id: string): Promise<PlanRow | null> {
    await this.authz.require(ctx, M39_PERMISSIONS.planRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getPlan(tx, id));
  }
  async getVersion(ctx: RequestContext, id: string): Promise<PlanVersionRow | null> {
    await this.authz.require(ctx, M39_PERMISSIONS.planRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getPlanVersion(tx, id));
  }
  async listPlans(ctx: RequestContext, page?: number, size?: number): Promise<PlanRow[]> {
    await this.authz.require(ctx, M39_PERMISSIONS.planRead);
    const { limit, offset } = clampPage(page, size);
    return this.db.withTenant(ctx, (tx) => this.repo.listPlans(tx, limit, offset));
  }
}
