/**
 * M39 audit codes — the `SAAS_` prefix. Every controlled commercial action (plan/version/subscription/entitlement/quota/
 * override/usage/billing) is audited through the kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE
 * `SAAS_<ENTITY>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml (unregistered codes fail CI).
 * Payloads carry safe ids, a plan/version/capability/meter reference, a state, bounded quantities/amounts and reason codes
 * ONLY — never a secret, a credential, a full customer/business payload, or personal data.
 */
export const M39_AUDIT_CODES = {
  planDefined: 'SAAS_PLAN_DEFINED',
  planRetired: 'SAAS_PLAN_RETIRED',
  planVersionDefined: 'SAAS_PLAN_VERSION_DEFINED',
  planVersionPublished: 'SAAS_PLAN_VERSION_PUBLISHED',
  planEntitlementAdded: 'SAAS_PLAN_ENTITLEMENT_ADDED',
  quotaPolicySet: 'SAAS_QUOTA_POLICY_SET',
  subscriptionCreated: 'SAAS_SUBSCRIPTION_CREATED',
  subscriptionActivated: 'SAAS_SUBSCRIPTION_ACTIVATED',
  subscriptionPlanChanged: 'SAAS_SUBSCRIPTION_PLAN_CHANGED',
  subscriptionSuspended: 'SAAS_SUBSCRIPTION_SUSPENDED',
  subscriptionCancelled: 'SAAS_SUBSCRIPTION_CANCELLED',
  subscriptionRenewed: 'SAAS_SUBSCRIPTION_RENEWED',
  entitlementAssigned: 'SAAS_ENTITLEMENT_ASSIGNED',
  overrideApplied: 'SAAS_OVERRIDE_APPLIED',
  quotaReserved: 'SAAS_QUOTA_RESERVED',
  quotaRejected: 'SAAS_QUOTA_REJECTED',
  usageRecorded: 'SAAS_USAGE_RECORDED',
  billingCycleOpened: 'SAAS_BILLING_CYCLE_OPENED',
  billingCycleClosed: 'SAAS_BILLING_CYCLE_CLOSED',
  reviewRequested: 'SAAS_REVIEW_REQUESTED',
  sodBlocked: 'SAAS_SOD_BLOCKED',
  accessBlocked: 'SAAS_ACCESS_BLOCKED',
} as const;

export type M39AuditCode = (typeof M39_AUDIT_CODES)[keyof typeof M39_AUDIT_CODES];
export const ALL_M39_AUDIT_CODES: readonly M39AuditCode[] = Object.values(M39_AUDIT_CODES);
export const SAAS_AUDIT_PREFIX = 'SAAS_';
