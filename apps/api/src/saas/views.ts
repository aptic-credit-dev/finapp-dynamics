/**
 * Safe DTO shapers for `/api/v1/saas`. They expose ids, keys, states, plan/version references, meter/quantity metadata and
 * amounts (minor units, as text — no float). They NEVER expose a secret, a credential or a raw customer payload. RLS keeps a
 * caller to its own tenant's rows.
 */
import type {
  PlanRow,
  PlanVersionRow,
  SubscriptionRow,
  QuotaPeriodRow,
  BillingCycleRow,
  BillingCycleDetailRow,
  UsageEventRow,
  OverrideRow,
  EntitlementRow,
} from '@finapp/m39-saas';

// A capability entitlement bundled in a plan version (catalogue data — not a tenant's effective grant). Allowance
// is a bounded string (e.g. a quantity or 'included'); never a raw customer payload.
export function entitlementView(e: EntitlementRow) {
  return {
    id: e.id,
    capabilityKey: e.capability_key,
    allowance: e.allowance,
    sourceKind: e.source_kind,
  };
}

export function planView(p: PlanRow) {
  return {
    id: p.id,
    scope: p.scope,
    planKey: p.plan_key,
    name: p.name,
    state: p.state,
    currentVersionNo: p.current_version_no,
    version: p.version,
  };
}

export function planVersionView(v: PlanVersionRow) {
  return {
    id: v.id,
    planId: v.plan_id,
    versionNo: v.version_no,
    state: v.state,
    currency: v.currency,
    baseAmountMinor: v.base_amount_minor,
    billingInterval: v.billing_interval,
    validationPassed: v.validation_passed,
    version: v.version,
  };
}

export function subscriptionView(s: SubscriptionRow) {
  return {
    id: s.id,
    subscriptionKey: s.subscription_key,
    planId: s.plan_id,
    planVersionId: s.plan_version_id,
    state: s.state,
    version: s.version,
  };
}

export function quotaView(q: QuotaPeriodRow) {
  return {
    id: q.id,
    capabilityKey: q.capability_key,
    meterKey: q.meter_key,
    periodKey: q.period_key,
    limitHard: q.limit_hard,
    reservedQty: q.reserved_qty,
    version: q.version,
  };
}

export function billingCycleView(b: BillingCycleRow) {
  return {
    id: b.id,
    subscriptionId: b.subscription_id,
    status: b.status,
    version: b.version,
  };
}

// Usage evidence (append-only). quantity is an exact integer emitted as text. No raw payload/credential exists.
export function usageView(u: UsageEventRow) {
  return {
    id: u.id,
    capabilityKey: u.capability_key,
    meterKey: u.meter_key,
    quantity: u.quantity,
    periodKey: u.period_key,
    sourceRef: u.source_ref,
    occurredAt: u.occurred_at,
    idempotencyKey: u.idempotency_key,
  };
}

// Commercial override (append-only, maker-checker). Exposes requester/approver/reason/validity — no secret.
// quotaDelta is an exact integer as text (nullable). approvedBy is always a different identity than requestedBy.
export function overrideView(o: OverrideRow) {
  return {
    id: o.id,
    targetKind: o.target_kind,
    capabilityKey: o.capability_key,
    allowance: o.allowance,
    quotaDelta: o.quota_delta,
    requestedBy: o.requested_by,
    approvedBy: o.approved_by,
    reasonCode: o.reason_code,
    validFrom: o.valid_from,
    validTo: o.valid_to,
  };
}

// Fuller billing-cycle read (metadata only). No amount is stored on the cycle (inherited from the plan version
// at close). providerRef is an OPAQUE, framework-only external reference (no provider bound) — never a secret.
export function billingCycleDetailView(b: BillingCycleDetailRow) {
  return {
    id: b.id,
    subscriptionId: b.subscription_id,
    status: b.status,
    version: b.version,
    cycleStart: b.cycle_start,
    cycleEnd: b.cycle_end,
    nextRenewal: b.next_renewal,
    providerRef: b.provider_ref,
  };
}
