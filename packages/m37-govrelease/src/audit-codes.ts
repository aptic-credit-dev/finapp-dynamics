/**
 * M37 audit codes — the `GOVRELEASE_` prefix (DISTINCT from m33's `INTEGRATION_`; one prefix = one owner). Every controlled
 * artifact/environment/release/gate action is audited through the kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE
 * `GOVRELEASE_<ENTITY>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml (unregistered codes fail
 * CI). Payloads carry safe ids, an artifact kind/opaque ref, a release key, a status and reason codes ONLY — never a
 * signature value/reference content, a QA report body or personal data.
 */
export const M37_AUDIT_CODES = {
  artifactRegistered: 'GOVRELEASE_ARTIFACT_REGISTERED',
  artifactRetired: 'GOVRELEASE_ARTIFACT_RETIRED',
  environmentDefined: 'GOVRELEASE_ENVIRONMENT_DEFINED',
  releaseRequested: 'GOVRELEASE_RELEASE_REQUESTED',
  gateAdded: 'GOVRELEASE_GATE_ADDED',
  checkRecorded: 'GOVRELEASE_CHECK_RECORDED',
  qaPassed: 'GOVRELEASE_QA_PASSED',
  qaFailed: 'GOVRELEASE_QA_FAILED',
  reviewRequested: 'GOVRELEASE_REVIEW_REQUESTED',
  releaseApproved: 'GOVRELEASE_RELEASE_APPROVED',
  releaseRejected: 'GOVRELEASE_RELEASE_REJECTED',
  releaseRolledBack: 'GOVRELEASE_RELEASE_ROLLED_BACK',
  evidenceAdded: 'GOVRELEASE_EVIDENCE_ADDED',
  sodBlocked: 'GOVRELEASE_SOD_BLOCKED',
  qaBlocked: 'GOVRELEASE_QA_BLOCKED',
  artifactUnavailable: 'GOVRELEASE_ARTIFACT_UNAVAILABLE',
} as const;

export type M37AuditCode = (typeof M37_AUDIT_CODES)[keyof typeof M37_AUDIT_CODES];
export const ALL_M37_AUDIT_CODES: readonly M37AuditCode[] = Object.values(M37_AUDIT_CODES);
export const GOVRELEASE_AUDIT_PREFIX = 'GOVRELEASE_';
