/**
 * M42 audit codes — the `CERT_` prefix. Every controlled certification action (programme lifecycle, assessment, finding, waiver
 * decision, sign-off, readiness, decision issuance, closure) is audited through the kernel AUDIT port in the SAME transaction.
 * SCREAMING_SNAKE `CERT_<ENTITY>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml (unregistered codes
 * fail CI). A payload carries ids/states/domain/aspect/verdict/reason codes + OPAQUE evidence refs ONLY — NEVER a secret, a
 * credential, a full log or a raw report/evidence body.
 */
export const M42_AUDIT_CODES = {
  programmeOpened: 'CERT_PROGRAMME_OPENED',
  programmeUpdated: 'CERT_PROGRAMME_UPDATED',
  assessmentRecorded: 'CERT_ASSESSMENT_RECORDED',
  findingRaised: 'CERT_FINDING_RAISED',
  findingResolved: 'CERT_FINDING_RESOLVED',
  waiverRequested: 'CERT_WAIVER_REQUESTED',
  waiverApproved: 'CERT_WAIVER_APPROVED',
  waiverRejected: 'CERT_WAIVER_REJECTED',
  signoffRecorded: 'CERT_SIGNOFF_RECORDED',
  migrationRecorded: 'CERT_MIGRATION_RECORDED',
  uatRecorded: 'CERT_UAT_RECORDED',
  pilotRecorded: 'CERT_PILOT_RECORDED',
  releaseRecorded: 'CERT_RELEASE_RECORDED',
  evidenceAdded: 'CERT_EVIDENCE_ADDED',
  decisionIssued: 'CERT_DECISION_ISSUED',
  closureIssued: 'CERT_CLOSURE_ISSUED',
  sodBlocked: 'CERT_SOD_BLOCKED',
  decisionBlocked: 'CERT_DECISION_BLOCKED',
} as const;

export type M42AuditCode = (typeof M42_AUDIT_CODES)[keyof typeof M42_AUDIT_CODES];
export const ALL_M42_AUDIT_CODES: readonly M42AuditCode[] = Object.values(M42_AUDIT_CODES);
export const CERT_AUDIT_PREFIX = 'CERT_';
