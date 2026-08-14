/**
 * M39 domain — the PURE, side-effect-free commercial rules (no DB, no clock). These are the load-bearing controls proven in
 * the smoke suite and enforced by the services:
 *
 *  - THE CONTROL STACK (`evaluateEffectiveAccess`): access = m02 RBAC (WHO) AND m39 ENTITLEMENT (plan includes capability) AND
 *    m30 FEATURE/ABSOLUTE control (enabled) — ANY deny denies. An entitlement is NEVER an authorization substitute (it cannot
 *    grant what RBAC denies) and can never override an m30 platform-ABSOLUTE control.
 *  - MAKER-CHECKER / SoD (`evaluateSodGate` + `isHumanActor`): plan publication / subscription lifecycle / override are decided
 *    by a HUMAN who is not the requester; `system`/`ai`/`automation`/null are never approvers.
 *  - SUBSCRIPTION LIFECYCLE (`isSubscriptionTransitionAllowed`): only governed transitions.
 *  - RACE-SAFE QUOTA math (`canReserve`): a reservation is allowed iff reserved + qty <= limit (the DB enforces it atomically).
 *  - MONEY: bigint minor units + a 3-letter currency; no float anywhere.
 */

export const M39_LIMITS = { maxPageSize: 200 } as const;

export const PLAN_STATES = ['draft', 'active', 'retired'] as const;
export type PlanState = (typeof PLAN_STATES)[number];

export const PLAN_VERSION_STATES = ['draft', 'published', 'retired'] as const;
export type PlanVersionState = (typeof PLAN_VERSION_STATES)[number];

export const SUBSCRIPTION_STATES = [
  'draft',
  'trial',
  'active',
  'grace',
  'suspended',
  'cancelled',
  'expired',
] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** A subscription is "live" (holds the one-active slot) in trial/active/grace. */
export const LIVE_SUBSCRIPTION_STATES: readonly SubscriptionState[] = ['trial', 'active', 'grace'];
/** Terminal subscription states. */
export const TERMINAL_SUBSCRIPTION_STATES: readonly SubscriptionState[] = ['cancelled', 'expired'];

export const ALLOWANCES = ['included', 'excluded', 'metered'] as const;
export type Allowance = (typeof ALLOWANCES)[number];

export const QUOTA_PERIODS = ['daily', 'monthly', 'annual', 'total'] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

export const BILLING_INTERVALS = ['monthly', 'annual', 'none'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const SCOPES = ['platform', 'tenant'] as const;
export type Scope = (typeof SCOPES)[number];
export function isPlatformScope(scope: string): boolean {
  return scope === 'platform';
}

export const REASON_CODES = {
  // access stack
  rbacDenied: 'rbac_denied',
  entitlementDenied: 'entitlement_denied',
  featureDenied: 'feature_denied',
  absoluteBlocked: 'platform_absolute_blocked',
  accessGranted: 'access_granted',
  // maker-checker
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval',
  approved: 'approved',
  validationNotPassed: 'validation_not_passed',
  // quota
  quotaAvailable: 'quota_available',
  quotaExceeded: 'quota_exceeded',
  quotaUnavailable: 'quota_unavailable',
  // lifecycle / structural
  invalidTransition: 'invalid_transition',
  planNotPublished: 'plan_not_published',
  structuralInvalid: 'structural_invalid',
  immutable: 'published_plan_immutable',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

export interface GateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

// ---- THE CONTROL STACK: RBAC ∧ ENTITLEMENT ∧ FEATURE/ABSOLUTE (load-bearing) ----

export interface EffectiveAccessInput {
  /** m02 RBAC decision — whether the actor holds the required permission. */
  readonly rbacAllowed: boolean;
  /** m39 entitlement decision — whether the tenant's plan/version (or a governed override) INCLUDES the capability. */
  readonly entitlementAllowed: boolean;
  /** m30 feature decision — whether the capability is ENABLED (a flag). */
  readonly featureAllowed: boolean;
  /** m30 platform-ABSOLUTE control — a hard platform block that nothing downstream can weaken. */
  readonly absoluteBlocked?: boolean;
}

/**
 * The effective access gate. ALLOW iff RBAC allows AND entitlement allows AND the feature is enabled AND no platform-absolute
 * block applies. Any deny denies. Order of evaluation surfaces the MOST authoritative denial first: a platform-absolute block,
 * then RBAC (an entitlement can never substitute for a permission), then entitlement, then the feature flag (a flag can never
 * override an entitlement denial). An entitlement is NEVER an authorization substitute.
 */
export function evaluateEffectiveAccess(input: EffectiveAccessInput): GateResult {
  if (input.absoluteBlocked) return { allowed: false, reasonCode: REASON_CODES.absoluteBlocked };
  if (!input.rbacAllowed) return { allowed: false, reasonCode: REASON_CODES.rbacDenied };
  if (!input.entitlementAllowed) return { allowed: false, reasonCode: REASON_CODES.entitlementDenied };
  if (!input.featureAllowed) return { allowed: false, reasonCode: REASON_CODES.featureDenied };
  return { allowed: true, reasonCode: REASON_CODES.accessGranted };
}

// ---- maker-checker (controlled plan publish / subscription change / override) ----

export function isHumanActor(actor: string | null | undefined): actor is string {
  if (actor === null || actor === undefined) return false;
  const a = actor.trim().toLowerCase();
  if (a === '') return false;
  return a !== 'system' && a !== 'ai' && a !== 'automation';
}

export function evaluateSodGate(requestedBy: string, approver: string | null): GateResult {
  if (!isHumanActor(approver)) return { allowed: false, reasonCode: REASON_CODES.notHumanApprover };
  if (approver === requestedBy) return { allowed: false, reasonCode: REASON_CODES.selfApproval };
  return { allowed: true, reasonCode: REASON_CODES.approved };
}

export interface PublishGateInput {
  readonly validationPassed: boolean;
  readonly requestedBy: string;
  readonly approver: string | null;
}
/** Publishing a plan version needs a passing validation + an independent human approver. */
export function evaluatePublishGate(input: PublishGateInput): GateResult {
  if (!input.validationPassed) return { allowed: false, reasonCode: REASON_CODES.validationNotPassed };
  return evaluateSodGate(input.requestedBy, input.approver);
}

// ---- subscription lifecycle ----

const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionState, readonly SubscriptionState[]> = {
  draft: ['trial', 'active', 'cancelled'],
  trial: ['active', 'suspended', 'cancelled', 'expired'],
  active: ['grace', 'suspended', 'cancelled', 'expired', 'active'], // active->active = renewal/plan-change
  grace: ['active', 'suspended', 'cancelled', 'expired'],
  suspended: ['active', 'cancelled', 'expired'],
  cancelled: [],
  expired: [],
};

export function isSubscriptionTransitionAllowed(from: SubscriptionState, to: SubscriptionState): boolean {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}
export function isSubscriptionTerminal(state: SubscriptionState): boolean {
  return TERMINAL_SUBSCRIPTION_STATES.includes(state);
}

// ---- RACE-SAFE quota math (the DB enforces this atomically; this proves the arithmetic) ----

export interface ReservationInput {
  readonly reserved: bigint | number;
  readonly limit: bigint | number;
  readonly quantity: bigint | number;
}
/** A reservation is allowed iff reserved + quantity <= limit and quantity > 0. Never oversubscribe a hard limit. */
export function canReserve(input: ReservationInput): GateResult {
  const reserved = BigInt(input.reserved);
  const limit = BigInt(input.limit);
  const qty = BigInt(input.quantity);
  if (qty <= 0n) return { allowed: false, reasonCode: REASON_CODES.structuralInvalid };
  if (reserved + qty > limit) return { allowed: false, reasonCode: REASON_CODES.quotaExceeded };
  return { allowed: true, reasonCode: REASON_CODES.quotaAvailable };
}

// ---- validation ----

export function isThreeSegmentPermission(p: string): boolean {
  return typeof p === 'string' && p.split('.').length === 3 && !p.split('.').includes('');
}

export function isCurrencyCode(c: string): boolean {
  return /^[A-Z]{3}$/.test(c);
}

export interface PlanVersionDraft {
  readonly currency: string;
  readonly baseAmountMinor: bigint | number;
  readonly billingInterval: string;
  readonly entitlements: readonly { capabilityKey: string; allowance: string }[];
}
export interface ValidationResult {
  readonly passed: boolean;
  readonly findings: readonly { code: string; ref: string }[];
}
/** A plan version is valid iff its currency is a 3-letter code, its amount is a non-negative integer minor unit, its interval
 *  is known, and every entitlement names a non-empty capability with a known allowance (pricing/entitlements consistent). */
export function validatePlanVersion(draft: PlanVersionDraft): ValidationResult {
  const findings: { code: string; ref: string }[] = [];
  if (!isCurrencyCode(draft.currency))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'currency' });
  const amt = BigInt(draft.baseAmountMinor);
  if (amt < 0n) findings.push({ code: REASON_CODES.structuralInvalid, ref: 'base_amount_minor' });
  if (!(BILLING_INTERVALS as readonly string[]).includes(draft.billingInterval))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'billing_interval' });
  for (const e of draft.entitlements) {
    if (!e.capabilityKey)
      findings.push({ code: REASON_CODES.structuralInvalid, ref: 'entitlement.capability_key' });
    if (!(ALLOWANCES as readonly string[]).includes(e.allowance))
      findings.push({ code: REASON_CODES.structuralInvalid, ref: 'entitlement.allowance' });
  }
  return { passed: findings.length === 0, findings };
}

export function clampPage(page?: number, size?: number): { limit: number; offset: number } {
  const s = Math.min(Math.max(1, Math.floor(size ?? 50)), M39_LIMITS.maxPageSize);
  const p = Math.max(1, Math.floor(page ?? 1));
  return { limit: s, offset: (p - 1) * s };
}
