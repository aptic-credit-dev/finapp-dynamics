/**
 * M41 audit codes — the `SEC_` / `GRC_` / `PRIV_` prefixes. Every controlled security/GRC/privacy action (secret/key lifecycle,
 * rotation, reveal, DLP policy/decision, GRC control/assessment, privacy policy/record, incident) is audited through the kernel
 * AUDIT port in the SAME transaction. SCREAMING_SNAKE `<PREFIX>_<ENTITY>_<ACTION>` (>= 3 segments), registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI). A payload carries safe ids, a state, a classification, an
 * approved algorithm id and reason codes ONLY — NEVER a secret value, ciphertext, a token, a credential or raw restricted
 * content.
 */
export const M41_AUDIT_CODES = {
  secretDefined: 'SEC_SECRET_DEFINED',
  secretVersionAdded: 'SEC_SECRET_VERSION_ADDED',
  secretActivated: 'SEC_SECRET_ACTIVATED',
  secretRotated: 'SEC_SECRET_ROTATED',
  secretRevoked: 'SEC_SECRET_REVOKED',
  secretDestroyed: 'SEC_SECRET_DESTROYED',
  revealRequested: 'SEC_REVEAL_REQUESTED',
  revealGranted: 'SEC_REVEAL_GRANTED',
  dlpPolicySet: 'SEC_DLP_POLICY_SET',
  dlpDecision: 'SEC_DLP_DECISION',
  incidentRecorded: 'SEC_INCIDENT_RECORDED',
  sodBlocked: 'SEC_SOD_BLOCKED',
  accessBlocked: 'SEC_ACCESS_BLOCKED',
  grcControlDefined: 'GRC_CONTROL_DEFINED',
  grcControlRetired: 'GRC_CONTROL_RETIRED',
  grcAssessmentRecorded: 'GRC_ASSESSMENT_RECORDED',
  privacyClassificationSet: 'PRIV_CLASSIFICATION_SET',
  privacyRecordAdded: 'PRIV_RECORD_ADDED',
} as const;

export type M41AuditCode = (typeof M41_AUDIT_CODES)[keyof typeof M41_AUDIT_CODES];
export const ALL_M41_AUDIT_CODES: readonly M41AuditCode[] = Object.values(M41_AUDIT_CODES);
export const SEC_AUDIT_PREFIX = 'SEC_';
export const GRC_AUDIT_PREFIX = 'GRC_';
export const PRIV_AUDIT_PREFIX = 'PRIV_';
