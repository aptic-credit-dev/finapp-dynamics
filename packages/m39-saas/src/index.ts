/**
 * @finapp/m39-saas — Commercial SaaS (Stage 6F, mvp:false). The canonical owner of commercial plan/subscription/entitlement/
 * quota/usage/billing state. Exposes the `saas.*` permissions, the `SAAS_` audit codes, the pure domain gates (the RBAC ∧
 * entitlement ∧ feature access stack, maker-checker/SoD, subscription lifecycle, race-safe quota math), the fail-closed ports
 * (m30 feature control, deferred billing provider), the repository, the emitter, and the four services. It declares
 * /api/v1/saas, owns the subscription.lifecycle + usage.lifecycle + billing.lifecycle families, and publishes through the ONE
 * m06 outbox — it owns no outbox, no second tenancy/RBAC/feature/analytics/quota engine, posts no journal and holds no secret
 * value.
 */
export {
  M39_PERMISSIONS,
  ALL_M39_PERMISSIONS,
  M39_PLATFORM_PERMISSIONS,
  M39_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M39Permission } from './permissions.ts';
export { M39_AUDIT_CODES, ALL_M39_AUDIT_CODES, SAAS_AUDIT_PREFIX } from './audit-codes.ts';
export type { M39AuditCode } from './audit-codes.ts';

export {
  M39_LIMITS,
  PLAN_STATES,
  PLAN_VERSION_STATES,
  SUBSCRIPTION_STATES,
  LIVE_SUBSCRIPTION_STATES,
  TERMINAL_SUBSCRIPTION_STATES,
  ALLOWANCES,
  QUOTA_PERIODS,
  BILLING_INTERVALS,
  SCOPES,
  isPlatformScope,
  REASON_CODES,
  ALL_REASON_CODES,
  evaluateEffectiveAccess,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  isSubscriptionTransitionAllowed,
  isSubscriptionTerminal,
  canReserve,
  isThreeSegmentPermission,
  isCurrencyCode,
  validatePlanVersion,
  clampPage,
} from './domain.ts';
export type {
  PlanState,
  PlanVersionState,
  SubscriptionState,
  Allowance,
  QuotaPeriod,
  BillingInterval,
  Scope,
  ReasonCodeKey,
  GateResult,
  EffectiveAccessInput,
  ReservationInput,
  PlanVersionDraft,
  ValidationResult,
} from './domain.ts';

export { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
export { M39Emitter } from './emit.ts';

export {
  UnavailableFeatureControl,
  FixtureFeatureControl,
  UnavailableBillingProvider,
  FixtureBillingProvider,
} from './ports.ts';
export type { FeatureControlPort, FeatureDecision, BillingProviderPort, BillingSettlement } from './ports.ts';

export { SaasRepository } from './repository.ts';
export type {
  PlanRow,
  PlanVersionRow,
  SubscriptionRow,
  QuotaPeriodRow,
  EntitlementRow,
  BillingCycleRow,
  UsageRow,
} from './repository.ts';

export { PlanService } from './plan.service.ts';
export { SubscriptionService } from './subscription.service.ts';
export { EntitlementQuotaService } from './entitlement.service.ts';
export type { QuotaCheck } from './entitlement.service.ts';
export { BillingService } from './billing.service.ts';
