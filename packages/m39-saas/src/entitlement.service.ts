/**
 * EntitlementQuotaService — the LOAD-BEARING runtime controls:
 *
 *  - THE ACCESS STACK (`evaluateAccess`): m02 RBAC (does the ctx hold the permission) AND m39 ENTITLEMENT (does the tenant's
 *    plan include the capability) AND m30 FEATURE/ABSOLUTE control (is it enabled, and no platform-absolute block) — composed by
 *    the pure `evaluateEffectiveAccess`. An entitlement can NEVER grant what RBAC denies; a feature flag can NEVER override an
 *    entitlement denial; nothing overrides an m30 platform-absolute block. Any deny denies.
 *  - RACE-SAFE QUOTA + IDEMPOTENT USAGE (`recordUsage`): the reservation is a single atomic conditional UPDATE, so concurrent
 *    consumers can never oversubscribe; a usage event is counted ONCE (UNIQUE idempotency key); an over-quota reservation
 *    rejects and records NOTHING (the transaction rolls back).
 *  - COMMERCIAL OVERRIDE (`applyOverride`): privileged (saas.override.administer) + maker-checker/SoD (approver != requester,
 *    human) + bounded validity + reason. No silent permanent override; AI/system/automation never approve.
 *  - `checkQuota`: the READ-ONLY quota decision m35-devportal consumes (entitlement ∧ remaining quota). No mutation.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M39_PERMISSIONS } from './permissions.ts';
import { M39_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  evaluateEffectiveAccess,
  evaluateSodGate,
  isHumanActor,
  canReserve,
  clampPage,
  REASON_CODES,
  type GateResult,
} from './domain.ts';
import { SaasRepository, type UsageEventRow, type OverrideRow } from './repository.ts';
import type { M39Emitter } from './emit.ts';
import type { FeatureControlPort } from './ports.ts';

export interface QuotaCheck {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

export class EntitlementQuotaService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M39Emitter;
  private readonly feature: FeatureControlPort;
  private readonly repo: SaasRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M39Emitter,
    feature: FeatureControlPort,
    repo: SaasRepository = new SaasRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.feature = feature;
    this.repo = repo;
  }

  private hasEntitlement(allowance: string | null | undefined): boolean {
    return allowance === 'included' || allowance === 'metered';
  }

  /**
   * THE ACCESS STACK. RBAC ∧ ENTITLEMENT ∧ FEATURE/ABSOLUTE. `rbacAllowed` reads the resolved permission set on the request
   * context (m02 authoritative); the entitlement leg reads the tenant's current assignment; the feature leg consults m30
   * through the fail-closed port. Returns the pure decision; a denial is audited (SAAS_ACCESS_BLOCKED).
   */
  /**
   * SELF entitlement check — "is MY tenant entitled to this capability?" (RLS-scoped via withTenant; the caller
   * sees only its own tenant's entitlement). No permission gate: like /auth/tenants it exposes only the caller's
   * own commercial-surface availability, so a menu/route can be gated WITHOUT granting a broad read. Entitlement
   * decides the vertical's AVAILABILITY; M02 RBAC still decides actions inside it (unchanged).
   */
  async resolveEntitlement(
    ctx: RequestContext,
    capabilityKey: string,
  ): Promise<{ capabilityKey: string; entitled: boolean }> {
    return this.db.withTenant(ctx, async (tx) => {
      const ent = await this.repo.currentEntitlement(tx, capabilityKey);
      return { capabilityKey, entitled: this.hasEntitlement(ent?.allowance) };
    });
  }

  async evaluateAccess(
    ctx: RequestContext,
    input: { capabilityKey: string; requiredPermission: string },
  ): Promise<GateResult> {
    const rbacAllowed = ctx.permissions.includes(input.requiredPermission);
    const decision = await this.db.withTenant(ctx, async (tx) => {
      const ent = await this.repo.currentEntitlement(tx, input.capabilityKey);
      const feature = await this.feature.evaluateFeature(ctx, input.capabilityKey);
      const gate = evaluateEffectiveAccess({
        rbacAllowed,
        entitlementAllowed: this.hasEntitlement(ent?.allowance),
        featureAllowed: feature.enabled,
        absoluteBlocked: feature.absoluteBlocked,
      });
      if (!gate.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M39_AUDIT_CODES.accessBlocked,
          entityType: 'saas_entitlement_assignment',
          entityId: ctx.tenantId,
          detail: { capabilityKey: input.capabilityKey, reasonCode: gate.reasonCode },
        });
      }
      return gate;
    });
    return decision;
  }

  /** The READ-ONLY quota decision m35 consumes: entitled AND a reservation of `quantity` would fit. No mutation. */
  async checkQuota(
    ctx: RequestContext,
    input: { capabilityKey: string; meterKey: string; periodKey: string; quantity?: bigint | number },
  ): Promise<QuotaCheck> {
    await this.authz.require(ctx, M39_PERMISSIONS.quotaRead);
    const qty = BigInt(input.quantity ?? 1);
    return this.db.withTenant(ctx, async (tx) => {
      const ent = await this.repo.currentEntitlement(tx, input.capabilityKey);
      if (!this.hasEntitlement(ent?.allowance))
        return { allowed: false, reasonCode: REASON_CODES.entitlementDenied };
      const period = await this.repo.getQuotaPeriod(tx, input.capabilityKey, input.meterKey, input.periodKey);
      if (!period) return { allowed: false, reasonCode: REASON_CODES.quotaUnavailable };
      const can = canReserve({
        reserved: BigInt(period.reserved_qty),
        limit: BigInt(period.limit_hard),
        quantity: qty,
      });
      return { allowed: can.allowed, reasonCode: can.reasonCode };
    });
  }

  /** Provision (or top up the existence of) a quota-period counter for a (capability, meter, period). Idempotent. */
  async provisionQuota(
    ctx: RequestContext,
    input: { capabilityKey: string; meterKey: string; periodKey: string; limitHard: bigint | number },
  ): Promise<{ id: string; limitHard: string }> {
    await this.authz.require(ctx, M39_PERMISSIONS.quotaManage);
    const limit = BigInt(input.limitHard);
    if (limit < 0n) throw badRequest('limit must be non-negative.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.ensureQuotaPeriod(tx, {
        tenantId: ctx.tenantId,
        capabilityKey: input.capabilityKey,
        meterKey: input.meterKey,
        periodKey: input.periodKey,
        limitHard: limit,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      return { id: row.id, limitHard: row.limit_hard };
    });
  }

  /**
   * Record usage — RACE-SAFE + IDEMPOTENT. A usage event with a seen idempotency key is counted ONCE (no double reserve). A new
   * event first reserves quota atomically (`reserved + qty <= limit_hard` in one UPDATE); if the limit would be exceeded the
   * whole transaction rolls back — nothing is reserved and no usage is recorded. Requires the tenant to be entitled (metered/
   * included) to the capability.
   */
  async recordUsage(
    ctx: RequestContext,
    input: {
      capabilityKey: string;
      meterKey: string;
      periodKey: string;
      quantity: bigint | number;
      idempotencyKey: string;
      sourceRef?: string | null;
    },
  ): Promise<{ recorded: boolean; reasonCode: string }> {
    await this.authz.require(ctx, M39_PERMISSIONS.usageRecord);
    const qty = BigInt(input.quantity);
    if (qty <= 0n) throw badRequest('quantity must be a positive integer.', ctx.correlationId);
    if (!input.idempotencyKey) throw badRequest('idempotencyKey is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const ent = await this.repo.currentEntitlement(tx, input.capabilityKey);
      if (!this.hasEntitlement(ent?.allowance))
        throw governanceForbidden(REASON_CODES.entitlementDenied, ctx.correlationId);
      // 1) Idempotent insert — a duplicate source event is counted ONCE (returns null on conflict).
      const usage = await this.repo.insertUsageIfNew(tx, {
        tenantId: ctx.tenantId,
        capabilityKey: input.capabilityKey,
        meterKey: input.meterKey,
        quantity: qty,
        periodKey: input.periodKey,
        sourceRef: input.sourceRef ?? null,
        idempotencyKey: input.idempotencyKey,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      if (!usage) return { recorded: false, reasonCode: 'duplicate_counted_once' };
      // 2) Race-safe reservation — atomic conditional increment. On overflow the whole tx rolls back (nothing recorded).
      const period = await this.repo.getQuotaPeriod(tx, input.capabilityKey, input.meterKey, input.periodKey);
      if (!period) throw governanceForbidden(REASON_CODES.quotaUnavailable, ctx.correlationId);
      const reserved = await this.repo.reserveQuota(tx, {
        capabilityKey: input.capabilityKey,
        meterKey: input.meterKey,
        periodKey: input.periodKey,
        quantity: qty,
        by: ctx.userId ?? null,
      });
      if (!reserved) {
        // Over the hard limit — reject; the transaction rolls back so the usage row is NOT persisted.
        await this.emitter.recordAudit(tx, ctx, {
          code: M39_AUDIT_CODES.quotaRejected,
          entityType: 'saas_quota_period',
          entityId: period.id,
          detail: {
            capabilityKey: input.capabilityKey,
            meterKey: input.meterKey,
            reasonCode: REASON_CODES.quotaExceeded,
          },
        });
        throw governanceForbidden(REASON_CODES.quotaExceeded, ctx.correlationId);
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.usageRecorded,
        entityType: 'saas_usage_event',
        entityId: usage.id,
        detail: { capabilityKey: input.capabilityKey, meterKey: input.meterKey, quantity: qty.toString() },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.quotaReserved,
        entityType: 'saas_quota_period',
        entityId: reserved.id,
        detail: { reservedQty: reserved.reserved_qty, limitHard: reserved.limit_hard },
      });
      await this.emitter.publishUsage(tx, 'UsageRecorded', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: {
          capabilityKey: input.capabilityKey,
          meterKey: input.meterKey,
          quantity: qty.toString(),
          periodKey: input.periodKey,
        },
      });
      return { recorded: true, reasonCode: REASON_CODES.quotaAvailable };
    });
  }

  /**
   * Apply a commercial OVERRIDE — PRIVILEGED (saas.override.administer) + maker-checker/SoD (approver is a human who is not the
   * requester; AI/system/automation refused) + bounded validity + reason. An entitlement override writes an append-only
   * entitlement assignment (source_kind='override'); a quota override adjusts the counter's limit is out of scope here (a new
   * quota policy governs limits).
   */
  async applyOverride(
    ctx: RequestContext,
    approver: string | null,
    input: {
      targetKind: 'entitlement' | 'quota';
      capabilityKey: string;
      allowance?: string;
      quotaDelta?: bigint | number | null;
      requestedBy: string;
      reasonCode: string;
      validTo?: Date | null;
    },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M39_PERMISSIONS.overrideAdminister);
    if (!input.reasonCode) throw badRequest('a reason code is required for an override.', ctx.correlationId);
    const gate = evaluateSodGate(input.requestedBy, approver);
    if (!gate.allowed) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M39_AUDIT_CODES.sodBlocked,
          entityType: 'saas_override',
          entityId: ctx.tenantId,
          detail: { capabilityKey: input.capabilityKey, reasonCode: gate.reasonCode },
        }),
      );
      throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    }
    // The gate guarantees a human approver; narrow the type for the append-only override + review records.
    if (!isHumanActor(approver)) throw governanceForbidden(REASON_CODES.notHumanApprover, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const override = await this.repo.insertOverride(tx, {
        tenantId: ctx.tenantId,
        targetKind: input.targetKind,
        capabilityKey: input.capabilityKey,
        allowance: input.allowance ?? null,
        quotaDelta: input.quotaDelta != null ? BigInt(input.quotaDelta) : null,
        requestedBy: input.requestedBy,
        approvedBy: approver,
        reasonCode: input.reasonCode,
        validTo: input.validTo ?? null,
        correlationId: ctx.correlationId,
      });
      if (input.targetKind === 'entitlement') {
        await this.repo.insertEntitlementAssignment(tx, {
          tenantId: ctx.tenantId,
          capabilityKey: input.capabilityKey,
          allowance: input.allowance ?? 'included',
          sourceKind: 'override',
          sourceRef: override.id,
          reasonCode: input.reasonCode,
          correlationId: ctx.correlationId,
          by: ctx.userId ?? null,
        });
      }
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetKind: 'override',
        targetId: override.id,
        decision: 'approved',
        requestedBy: input.requestedBy,
        decidedBy: approver,
        reasonCode: input.reasonCode,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M39_AUDIT_CODES.overrideApplied,
        entityType: 'saas_override',
        entityId: override.id,
        detail: { targetKind: input.targetKind, capabilityKey: input.capabilityKey },
      });
      return { id: override.id };
    });
  }

  // --- read models (admin read surfaces) --------------------------------------------------------
  /** List usage events (append-only evidence). RLS-scoped; gated by the read permission (first enforcer of the
   * previously-declared saas.usage.read). Exposes meter/quantity(text)/period/source-ref/time only — no payload. */
  async listUsageEvents(ctx: RequestContext, page?: number, size?: number): Promise<UsageEventRow[]> {
    await this.authz.require(ctx, M39_PERMISSIONS.usageRead);
    const { limit, offset } = clampPage(page, size);
    return this.db.withTenant(ctx, (tx) => this.repo.listUsageEvents(tx, limit, offset));
  }
  /** List commercial overrides (append-only, maker-checker). Privileged — gated by saas.override.administer (no
   * separate override.read code exists). Exposes requester/approver/reason/validity metadata only — no secret. */
  async listOverrides(ctx: RequestContext, page?: number, size?: number): Promise<OverrideRow[]> {
    await this.authz.require(ctx, M39_PERMISSIONS.overrideAdminister);
    const { limit, offset } = clampPage(page, size);
    return this.db.withTenant(ctx, (tx) => this.repo.listOverrides(tx, limit, offset));
  }
}
