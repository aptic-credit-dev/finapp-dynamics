/**
 * M39 repository — ALL SQL across its 13 saas_ tables. Every query is parameterized; every mutating UPDATE on a mutable
 * aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO tenant_id predicate: RLS FORCE is
 * the isolation guarantee. All methods take the caller's `Tx`. Plan-entitlement, quota-policy, entitlement-assignment,
 * override, usage-event, review, history + the idempotency ledger are append-only. Money is bigint minor units (returned as
 * text to preserve precision); quantities are bigint. THE RACE-SAFE quota reservation is a single atomic conditional UPDATE
 * (`reserved + $qty <= limit_hard`) — concurrent consumers can never oversubscribe.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m39 repository: expected a row from ${what}`);
  return row;
}

export interface PlanRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly plan_key: string;
  readonly name: string;
  readonly state: string;
  readonly current_version_no: number;
  readonly version: number;
}
export interface PlanVersionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly plan_id: string;
  readonly version_no: number;
  readonly state: string;
  readonly currency: string;
  readonly base_amount_minor: string;
  readonly billing_interval: string;
  readonly validation_passed: boolean;
  readonly version: number;
}
export interface SubscriptionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly subscription_key: string;
  readonly plan_id: string;
  readonly plan_version_id: string;
  readonly state: string;
  readonly current_period_key: string | null;
  readonly version: number;
}
export interface QuotaPeriodRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly capability_key: string;
  readonly meter_key: string;
  readonly period_key: string;
  readonly limit_hard: string;
  readonly reserved_qty: string;
  readonly version: number;
}
export interface EntitlementRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly capability_key: string;
  readonly allowance: string;
  readonly source_kind: string;
}
export interface BillingCycleRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly subscription_id: string;
  readonly status: string;
  readonly version: number;
}
export interface UsageRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly capability_key: string;
  readonly meter_key: string;
  readonly quantity: string;
  readonly period_key: string;
}
// Read-model rows for the admin read surfaces (usage / overrides / billing detail). Kept SEPARATE from the
// write-path rows above so broadening a read DTO never changes an insert/update RETURNING contract. quantity /
// quota_delta are exact integers emitted as text (never float). No secret/credential/raw-payload column exists.
export interface UsageEventRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly capability_key: string;
  readonly meter_key: string;
  readonly quantity: string;
  readonly period_key: string;
  readonly source_ref: string | null;
  readonly occurred_at: string;
  readonly idempotency_key: string;
}
export interface OverrideRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_kind: string;
  readonly capability_key: string;
  readonly allowance: string | null;
  readonly quota_delta: string | null;
  readonly requested_by: string;
  readonly approved_by: string;
  readonly reason_code: string;
  readonly valid_from: string;
  readonly valid_to: string | null;
}
export interface BillingCycleDetailRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly subscription_id: string;
  readonly status: string;
  readonly version: number;
  readonly cycle_start: string;
  readonly cycle_end: string;
  readonly next_renewal: string | null;
  readonly provider_ref: string | null;
}

export class SaasRepository {
  // ---- plan (mutable aggregate) ----
  async insertPlan(
    tx: Tx,
    p: {
      tenantId: string;
      scope: string;
      planKey: string;
      name: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PlanRow> {
    const { rows } = await tx.query<PlanRow>(
      `INSERT INTO saas_plan (tenant_id, scope, plan_key, name, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)
       RETURNING tenant_id, id, scope, plan_key, name, state, current_version_no, version`,
      [p.tenantId, p.scope, p.planKey, p.name, p.correlationId, p.by],
    );
    return firstRow(rows, 'insertPlan');
  }
  async getPlan(tx: Tx, id: string): Promise<PlanRow | null> {
    const { rows } = await tx.query<PlanRow>(
      `SELECT tenant_id, id, scope, plan_key, name, state, current_version_no, version FROM saas_plan WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updatePlan(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; currentVersionNo: number; by: string | null },
  ): Promise<PlanRow | null> {
    const { rows } = await tx.query<PlanRow>(
      `UPDATE saas_plan SET state=$3, current_version_no=$4, version=version+1, updated_at=now(), updated_by=$5
       WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, plan_key, name, state, current_version_no, version`,
      [id, expectedVersion, patch.state, patch.currentVersionNo, patch.by],
    );
    return rows[0] ?? null;
  }
  async listPlans(tx: Tx, limit: number, offset: number): Promise<PlanRow[]> {
    const { rows } = await tx.query<PlanRow>(
      `SELECT tenant_id, id, scope, plan_key, name, state, current_version_no, version FROM saas_plan ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- plan version (mutable aggregate; published-immutable trigger) ----
  async insertPlanVersion(
    tx: Tx,
    v: {
      tenantId: string;
      planId: string;
      versionNo: number;
      currency: string;
      baseAmountMinor: bigint;
      billingInterval: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PlanVersionRow> {
    const { rows } = await tx.query<PlanVersionRow>(
      `INSERT INTO saas_plan_version (tenant_id, plan_id, version_no, currency, base_amount_minor, billing_interval, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING tenant_id, id, plan_id, version_no, state, currency, base_amount_minor::text, billing_interval, validation_passed, version`,
      [
        v.tenantId,
        v.planId,
        v.versionNo,
        v.currency,
        v.baseAmountMinor.toString(),
        v.billingInterval,
        v.correlationId,
        v.by,
      ],
    );
    return firstRow(rows, 'insertPlanVersion');
  }
  async getPlanVersion(tx: Tx, id: string): Promise<PlanVersionRow | null> {
    const { rows } = await tx.query<PlanVersionRow>(
      `SELECT tenant_id, id, plan_id, version_no, state, currency, base_amount_minor::text, billing_interval, validation_passed, version FROM saas_plan_version WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  // Read surface (RLS-scoped): list a plan's versions oldest-first. No tenant_id predicate — FORCE RLS isolates.
  async listPlanVersions(tx: Tx, planId: string): Promise<PlanVersionRow[]> {
    const { rows } = await tx.query<PlanVersionRow>(
      `SELECT tenant_id, id, plan_id, version_no, state, currency, base_amount_minor::text, billing_interval, validation_passed, version FROM saas_plan_version WHERE plan_id=$1 ORDER BY version_no`,
      [planId],
    );
    return rows;
  }
  async updatePlanVersion(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; published: boolean; by: string | null },
  ): Promise<PlanVersionRow | null> {
    const { rows } = await tx.query<PlanVersionRow>(
      `UPDATE saas_plan_version
         SET state=$3, validation_passed=$4,
             published_at = CASE WHEN $5 THEN now() ELSE published_at END,
             published_by = CASE WHEN $5 THEN $6 ELSE published_by END,
             version=version+1, updated_at=now(), updated_by=$6
       WHERE id=$1 AND version=$2
       RETURNING tenant_id, id, plan_id, version_no, state, currency, base_amount_minor::text, billing_interval, validation_passed, version`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.published, patch.by],
    );
    return rows[0] ?? null;
  }
  async countRequiredEntitlements(tx: Tx, planVersionId: string): Promise<number> {
    const { rows } = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM saas_plan_entitlement WHERE plan_version_id=$1`,
      [planVersionId],
    );
    return Number(rows[0]?.n ?? '0');
  }

  // ---- plan entitlement (append-only) ----
  async insertPlanEntitlement(
    tx: Tx,
    e: {
      tenantId: string;
      planVersionId: string;
      capabilityKey: string;
      allowance: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<EntitlementRow> {
    const { rows } = await tx.query<EntitlementRow>(
      `INSERT INTO saas_plan_entitlement (tenant_id, plan_version_id, capability_key, allowance, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING tenant_id, id, capability_key, allowance, 'plan'::text AS source_kind`,
      [e.tenantId, e.planVersionId, e.capabilityKey, e.allowance, e.correlationId, e.by],
    );
    return firstRow(rows, 'insertPlanEntitlement');
  }
  async listPlanEntitlements(tx: Tx, planVersionId: string): Promise<EntitlementRow[]> {
    const { rows } = await tx.query<EntitlementRow>(
      `SELECT tenant_id, id, capability_key, allowance, 'plan'::text AS source_kind
       FROM saas_plan_entitlement WHERE plan_version_id=$1 ORDER BY created_at`,
      [planVersionId],
    );
    return rows;
  }
  async findPlanEntitlement(
    tx: Tx,
    planVersionId: string,
    capabilityKey: string,
  ): Promise<EntitlementRow | null> {
    const { rows } = await tx.query<EntitlementRow>(
      `SELECT tenant_id, id, capability_key, allowance, 'plan'::text AS source_kind
       FROM saas_plan_entitlement WHERE plan_version_id=$1 AND capability_key=$2 LIMIT 1`,
      [planVersionId, capabilityKey],
    );
    return rows[0] ?? null;
  }

  // ---- quota policy (append-only) ----
  async insertQuotaPolicy(
    tx: Tx,
    q: {
      tenantId: string;
      planVersionId: string;
      capabilityKey: string;
      meterKey: string;
      period: string;
      limitHard: bigint;
      thresholdSoft: bigint | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO saas_quota_policy (tenant_id, plan_version_id, capability_key, meter_key, period, limit_hard, threshold_soft, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        q.tenantId,
        q.planVersionId,
        q.capabilityKey,
        q.meterKey,
        q.period,
        q.limitHard.toString(),
        q.thresholdSoft?.toString() ?? null,
        q.correlationId,
        q.by,
      ],
    );
    return firstRow(rows, 'insertQuotaPolicy');
  }
  async findQuotaPolicy(
    tx: Tx,
    planVersionId: string,
    capabilityKey: string,
    meterKey: string,
  ): Promise<{ limit_hard: string; period: string } | null> {
    const { rows } = await tx.query<{ limit_hard: string; period: string }>(
      `SELECT limit_hard::text, period FROM saas_quota_policy WHERE plan_version_id=$1 AND capability_key=$2 AND meter_key=$3 LIMIT 1`,
      [planVersionId, capabilityKey, meterKey],
    );
    return rows[0] ?? null;
  }

  // ---- subscription (mutable aggregate) ----
  async insertSubscription(
    tx: Tx,
    s: {
      tenantId: string;
      subscriptionKey: string;
      planId: string;
      planVersionId: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SubscriptionRow> {
    const { rows } = await tx.query<SubscriptionRow>(
      `INSERT INTO saas_subscription (tenant_id, subscription_key, plan_id, plan_version_id, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)
       RETURNING tenant_id, id, subscription_key, plan_id, plan_version_id, state, current_period_key, version`,
      [s.tenantId, s.subscriptionKey, s.planId, s.planVersionId, s.correlationId, s.by],
    );
    return firstRow(rows, 'insertSubscription');
  }
  async getSubscription(tx: Tx, id: string): Promise<SubscriptionRow | null> {
    const { rows } = await tx.query<SubscriptionRow>(
      `SELECT tenant_id, id, subscription_key, plan_id, plan_version_id, state, current_period_key, version FROM saas_subscription WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateSubscription(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: {
      state: string;
      planId: string;
      planVersionId: string;
      currentPeriodKey: string | null;
      by: string | null;
    },
  ): Promise<SubscriptionRow | null> {
    const { rows } = await tx.query<SubscriptionRow>(
      `UPDATE saas_subscription SET state=$3, plan_id=$4, plan_version_id=$5, current_period_key=$6,
             started_at = COALESCE(started_at, CASE WHEN $3 IN ('trial','active') THEN now() ELSE started_at END),
             version=version+1, updated_at=now(), updated_by=$7
       WHERE id=$1 AND version=$2
       RETURNING tenant_id, id, subscription_key, plan_id, plan_version_id, state, current_period_key, version`,
      [id, expectedVersion, patch.state, patch.planId, patch.planVersionId, patch.currentPeriodKey, patch.by],
    );
    return rows[0] ?? null;
  }
  async listSubscriptions(tx: Tx, limit: number, offset: number): Promise<SubscriptionRow[]> {
    const { rows } = await tx.query<SubscriptionRow>(
      `SELECT tenant_id, id, subscription_key, plan_id, plan_version_id, state, current_period_key, version FROM saas_subscription ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- entitlement assignment (append-only ledger) ----
  async insertEntitlementAssignment(
    tx: Tx,
    a: {
      tenantId: string;
      capabilityKey: string;
      allowance: string;
      sourceKind: string;
      sourceRef: string | null;
      reasonCode: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<EntitlementRow> {
    const { rows } = await tx.query<EntitlementRow>(
      `INSERT INTO saas_entitlement_assignment (tenant_id, capability_key, allowance, source_kind, source_ref, reason_code, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING tenant_id, id, capability_key, allowance, source_kind`,
      [
        a.tenantId,
        a.capabilityKey,
        a.allowance,
        a.sourceKind,
        a.sourceRef,
        a.reasonCode,
        a.correlationId,
        a.by,
      ],
    );
    return firstRow(rows, 'insertEntitlementAssignment');
  }
  /** The tenant's current effective entitlement for a capability (latest assignment wins). */
  async currentEntitlement(tx: Tx, capabilityKey: string): Promise<EntitlementRow | null> {
    const { rows } = await tx.query<EntitlementRow>(
      `SELECT tenant_id, id, capability_key, allowance, source_kind FROM saas_entitlement_assignment
       WHERE capability_key=$1 AND (valid_to IS NULL OR valid_to > now()) ORDER BY created_at DESC LIMIT 1`,
      [capabilityKey],
    );
    return rows[0] ?? null;
  }

  // ---- override (append-only; maker-checker) ----
  async listOverrides(tx: Tx, limit: number, offset: number): Promise<OverrideRow[]> {
    const { rows } = await tx.query<OverrideRow>(
      `SELECT tenant_id, id, target_kind, capability_key, allowance, quota_delta::text, requested_by, approved_by, reason_code, valid_from, valid_to
         FROM saas_override ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }
  async insertOverride(
    tx: Tx,
    o: {
      tenantId: string;
      targetKind: string;
      capabilityKey: string;
      allowance: string | null;
      quotaDelta: bigint | null;
      requestedBy: string;
      approvedBy: string;
      reasonCode: string;
      validTo: Date | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO saas_override (tenant_id, target_kind, capability_key, allowance, quota_delta, requested_by, approved_by, reason_code, valid_to, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        o.tenantId,
        o.targetKind,
        o.capabilityKey,
        o.allowance,
        o.quotaDelta?.toString() ?? null,
        o.requestedBy,
        o.approvedBy,
        o.reasonCode,
        o.validTo,
        o.correlationId,
      ],
    );
    return firstRow(rows, 'insertOverride');
  }

  // ---- quota period (mutable; RACE-SAFE reservation) ----
  /** Ensure the counter row exists for (capability, meter, period) with the given hard limit. Idempotent. */
  async ensureQuotaPeriod(
    tx: Tx,
    q: {
      tenantId: string;
      capabilityKey: string;
      meterKey: string;
      periodKey: string;
      limitHard: bigint;
      correlationId: string;
      by: string | null;
    },
  ): Promise<QuotaPeriodRow> {
    await tx.query(
      `INSERT INTO saas_quota_period (tenant_id, capability_key, meter_key, period_key, limit_hard, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (tenant_id, capability_key, meter_key, period_key) DO NOTHING`,
      [q.tenantId, q.capabilityKey, q.meterKey, q.periodKey, q.limitHard.toString(), q.correlationId, q.by],
    );
    const { rows } = await tx.query<QuotaPeriodRow>(
      `SELECT tenant_id, id, capability_key, meter_key, period_key, limit_hard::text, reserved_qty::text, version
       FROM saas_quota_period WHERE capability_key=$1 AND meter_key=$2 AND period_key=$3`,
      [q.capabilityKey, q.meterKey, q.periodKey],
    );
    return firstRow(rows, 'ensureQuotaPeriod');
  }
  /**
   * THE RACE-SAFE reservation. A single atomic conditional UPDATE: increment reserved_qty by $qty ONLY IF it stays within
   * limit_hard. Concurrent callers serialize on the row lock, so no oversubscription is possible; a rejected reservation
   * changes nothing. Returns the new row, or null if the limit would be exceeded (or the row is gone).
   */
  async reserveQuota(
    tx: Tx,
    q: { capabilityKey: string; meterKey: string; periodKey: string; quantity: bigint; by: string | null },
  ): Promise<QuotaPeriodRow | null> {
    const { rows } = await tx.query<QuotaPeriodRow>(
      `UPDATE saas_quota_period
         SET reserved_qty = reserved_qty + $4, version = version + 1, updated_at = now(), updated_by = $5
       WHERE capability_key=$1 AND meter_key=$2 AND period_key=$3 AND reserved_qty + $4 <= limit_hard
       RETURNING tenant_id, id, capability_key, meter_key, period_key, limit_hard::text, reserved_qty::text, version`,
      [q.capabilityKey, q.meterKey, q.periodKey, q.quantity.toString(), q.by],
    );
    return rows[0] ?? null;
  }
  async getQuotaPeriod(
    tx: Tx,
    capabilityKey: string,
    meterKey: string,
    periodKey: string,
  ): Promise<QuotaPeriodRow | null> {
    const { rows } = await tx.query<QuotaPeriodRow>(
      `SELECT tenant_id, id, capability_key, meter_key, period_key, limit_hard::text, reserved_qty::text, version
       FROM saas_quota_period WHERE capability_key=$1 AND meter_key=$2 AND period_key=$3`,
      [capabilityKey, meterKey, periodKey],
    );
    return rows[0] ?? null;
  }

  // ---- usage event (append-only; idempotent) ----
  async listUsageEvents(tx: Tx, limit: number, offset: number): Promise<UsageEventRow[]> {
    const { rows } = await tx.query<UsageEventRow>(
      `SELECT tenant_id, id, capability_key, meter_key, quantity::text, period_key, source_ref, occurred_at, idempotency_key
         FROM saas_usage_event ORDER BY occurred_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }
  /** Insert a usage event; ON CONFLICT (idempotency_key) DO NOTHING. Returns the row iff it was newly inserted (counted once). */
  async insertUsageIfNew(
    tx: Tx,
    u: {
      tenantId: string;
      capabilityKey: string;
      meterKey: string;
      quantity: bigint;
      periodKey: string;
      sourceRef: string | null;
      idempotencyKey: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<UsageRow | null> {
    const { rows } = await tx.query<UsageRow>(
      `INSERT INTO saas_usage_event (tenant_id, capability_key, meter_key, quantity, period_key, source_ref, idempotency_key, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING tenant_id, id, capability_key, meter_key, quantity::text, period_key`,
      [
        u.tenantId,
        u.capabilityKey,
        u.meterKey,
        u.quantity.toString(),
        u.periodKey,
        u.sourceRef,
        u.idempotencyKey,
        u.correlationId,
        u.by,
      ],
    );
    return rows[0] ?? null;
  }

  // ---- billing cycle (mutable aggregate) ----
  async insertBillingCycle(
    tx: Tx,
    b: {
      tenantId: string;
      subscriptionId: string;
      cycleStart: Date;
      cycleEnd: Date;
      nextRenewal: Date | null;
      providerRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<BillingCycleRow> {
    const { rows } = await tx.query<BillingCycleRow>(
      `INSERT INTO saas_billing_cycle (tenant_id, subscription_id, cycle_start, cycle_end, next_renewal, provider_ref, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING tenant_id, id, subscription_id, status, version`,
      [
        b.tenantId,
        b.subscriptionId,
        b.cycleStart,
        b.cycleEnd,
        b.nextRenewal,
        b.providerRef,
        b.correlationId,
        b.by,
      ],
    );
    return firstRow(rows, 'insertBillingCycle');
  }
  async getBillingCycle(tx: Tx, id: string): Promise<BillingCycleRow | null> {
    const { rows } = await tx.query<BillingCycleRow>(
      `SELECT tenant_id, id, subscription_id, status, version FROM saas_billing_cycle WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async listBillingCycles(tx: Tx, subscriptionId: string): Promise<BillingCycleDetailRow[]> {
    const { rows } = await tx.query<BillingCycleDetailRow>(
      `SELECT tenant_id, id, subscription_id, status, version, cycle_start, cycle_end, next_renewal, provider_ref
         FROM saas_billing_cycle WHERE subscription_id=$1 ORDER BY cycle_start DESC`,
      [subscriptionId],
    );
    return rows;
  }
  async updateBillingCycle(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; by: string | null },
  ): Promise<BillingCycleRow | null> {
    const { rows } = await tx.query<BillingCycleRow>(
      `UPDATE saas_billing_cycle SET status=$3, version=version+1, updated_at=now(), updated_by=$4
       WHERE id=$1 AND version=$2 RETURNING tenant_id, id, subscription_id, status, version`,
      [id, expectedVersion, patch.status, patch.by],
    );
    return rows[0] ?? null;
  }

  // ---- review + history + idempotency (append-only) ----
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      targetKind: string;
      targetId: string;
      decision: string;
      requestedBy: string;
      decidedBy: string;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO saas_review (tenant_id, target_kind, target_id, decision, requested_by, decided_by, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        r.tenantId,
        r.targetKind,
        r.targetId,
        r.decision,
        r.requestedBy,
        r.decidedBy,
        r.reasonCode,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReview');
  }
  async insertHistory(
    tx: Tx,
    h: {
      tenantId: string;
      subjectKind: string;
      subjectId: string;
      fromState: string | null;
      toState: string;
      reasonCode: string | null;
      actor: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO saas_history (tenant_id, subject_kind, subject_id, from_state, to_state, reason_code, actor, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        h.tenantId,
        h.subjectKind,
        h.subjectId,
        h.fromState,
        h.toState,
        h.reasonCode,
        h.actor,
        h.correlationId,
      ],
    );
  }
  async claimIdempotency(
    tx: Tx,
    i: { tenantId: string; key: string; operation: string; correlationId: string; by: string | null },
  ): Promise<boolean> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO saas_idempotency (tenant_id, idempotency_key, operation, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`,
      [i.tenantId, i.key, i.operation, i.correlationId, i.by],
    );
    return rows[0] !== undefined;
  }
}
