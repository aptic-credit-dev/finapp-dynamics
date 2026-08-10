/**
 * M34 audit codes — the `MARKETPLACE_` prefix. Every controlled listing/install/consent/upgrade action is audited through
 * the kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE `MARKETPLACE_<ENTITY>_<ACTION>` (>= 3 segments),
 * registered in manifests/audit-code-registry.yaml (unregistered codes fail CI). Payloads carry safe ids, keys, an opaque
 * connector reference, statuses and reason codes ONLY — never a config value, a secret value/reference content, an
 * external payload or personal data.
 */
export const M34_AUDIT_CODES = {
  listingDefined: 'MARKETPLACE_LISTING_DEFINED',
  listingValidated: 'MARKETPLACE_LISTING_VALIDATED',
  listingPublished: 'MARKETPLACE_LISTING_PUBLISHED',
  listingDeprecated: 'MARKETPLACE_LISTING_DEPRECATED',
  capabilityAdded: 'MARKETPLACE_CAPABILITY_ADDED',
  installRequested: 'MARKETPLACE_INSTALL_REQUESTED',
  installActivated: 'MARKETPLACE_INSTALL_ACTIVATED',
  installSuspended: 'MARKETPLACE_INSTALL_SUSPENDED',
  installSecretSet: 'MARKETPLACE_INSTALL_SECRET_SET',
  consentGranted: 'MARKETPLACE_CONSENT_GRANTED',
  consentRevoked: 'MARKETPLACE_CONSENT_REVOKED',
  upgradeApplied: 'MARKETPLACE_UPGRADE_APPLIED',
  reviewRequested: 'MARKETPLACE_REVIEW_REQUESTED',
  reviewRejected: 'MARKETPLACE_REVIEW_REJECTED',
  publishBlocked: 'MARKETPLACE_PUBLISH_BLOCKED',
  sodBlocked: 'MARKETPLACE_SOD_BLOCKED',
} as const;

export type M34AuditCode = (typeof M34_AUDIT_CODES)[keyof typeof M34_AUDIT_CODES];
export const ALL_M34_AUDIT_CODES: readonly M34AuditCode[] = Object.values(M34_AUDIT_CODES);
export const MARKETPLACE_AUDIT_PREFIX = 'MARKETPLACE_';
