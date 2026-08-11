/**
 * M35 audit codes — the `DEVPORTAL_` prefix. Every controlled app/product/credential/subscription action is audited through
 * the kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE `DEVPORTAL_<ENTITY>_<ACTION>` (>= 3 segments), registered
 * in manifests/audit-code-registry.yaml (unregistered codes fail CI). Payloads carry safe ids, keys, an opaque source
 * reference, statuses and reason codes ONLY — never a secret value/reference content, an API credential, a config value, an
 * external payload or personal data.
 */
export const M35_AUDIT_CODES = {
  appRegistered: 'DEVPORTAL_APP_REGISTERED',
  appSuspended: 'DEVPORTAL_APP_SUSPENDED',
  productDefined: 'DEVPORTAL_PRODUCT_DEFINED',
  productValidated: 'DEVPORTAL_PRODUCT_VALIDATED',
  productPublished: 'DEVPORTAL_PRODUCT_PUBLISHED',
  productDeprecated: 'DEVPORTAL_PRODUCT_DEPRECATED',
  scopeAdded: 'DEVPORTAL_SCOPE_ADDED',
  reviewRequested: 'DEVPORTAL_REVIEW_REQUESTED',
  reviewRejected: 'DEVPORTAL_REVIEW_REJECTED',
  credentialIssued: 'DEVPORTAL_CREDENTIAL_ISSUED',
  credentialRotated: 'DEVPORTAL_CREDENTIAL_ROTATED',
  credentialRevoked: 'DEVPORTAL_CREDENTIAL_REVOKED',
  subscriptionRequested: 'DEVPORTAL_SUBSCRIPTION_REQUESTED',
  subscriptionActivated: 'DEVPORTAL_SUBSCRIPTION_ACTIVATED',
  subscriptionSuspended: 'DEVPORTAL_SUBSCRIPTION_SUSPENDED',
  publishBlocked: 'DEVPORTAL_PUBLISH_BLOCKED',
  sodBlocked: 'DEVPORTAL_SOD_BLOCKED',
  exposureBlocked: 'DEVPORTAL_EXPOSURE_BLOCKED',
} as const;

export type M35AuditCode = (typeof M35_AUDIT_CODES)[keyof typeof M35_AUDIT_CODES];
export const ALL_M35_AUDIT_CODES: readonly M35AuditCode[] = Object.values(M35_AUDIT_CODES);
export const DEVPORTAL_AUDIT_PREFIX = 'DEVPORTAL_';
