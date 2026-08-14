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
} from '@finapp/m39-saas';

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
