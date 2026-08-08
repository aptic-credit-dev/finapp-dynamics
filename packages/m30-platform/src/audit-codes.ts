/**
 * M30 audit codes — the `PLATFORM_` prefix (naming-map; already registered to m30). Every platform mutation and every
 * sensitive secret-reference read is audited through the kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE
 * `PLATFORM_<ENTITY>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml (unregistered codes
 * fail CI). Payloads carry safe ids, keys, scopes, states and reason codes ONLY — never configuration values, secret
 * values, resolved secret references or personal data.
 */
export const M30_AUDIT_CODES = {
  metadataUpdated: 'PLATFORM_METADATA_UPDATED',
  configDefined: 'PLATFORM_CONFIG_DEFINED',
  configPublished: 'PLATFORM_CONFIG_PUBLISHED',
  configValueSet: 'PLATFORM_CONFIG_VALUE_SET',
  featureDefined: 'PLATFORM_FEATURE_DEFINED',
  featureAssigned: 'PLATFORM_FEATURE_ASSIGNED',
  secretReferenceRegistered: 'PLATFORM_SECRET_REFERENCE_REGISTERED',
  secretReferenceRotated: 'PLATFORM_SECRET_REFERENCE_ROTATED',
  secretReferenceRevoked: 'PLATFORM_SECRET_REFERENCE_REVOKED',
  secretReferenceAccessed: 'PLATFORM_SECRET_REFERENCE_ACCESSED',
  configAbsoluteBlocked: 'PLATFORM_FEATURE_OVERRIDE_BLOCKED',
} as const;

export type M30AuditCode = (typeof M30_AUDIT_CODES)[keyof typeof M30_AUDIT_CODES];
export const ALL_M30_AUDIT_CODES: readonly M30AuditCode[] = Object.values(M30_AUDIT_CODES);
export const PLATFORM_AUDIT_PREFIX = 'PLATFORM_';
