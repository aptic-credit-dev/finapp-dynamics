/**
 * M25 audit codes — new codes under the SHARED `AI_` prefix (naming-map: m25 shares m24's audit prefix). Every
 * operational-AI mutation AND every human decision is audited through the kernel AUDIT port in the SAME transaction.
 * SCREAMING_SNAKE `AI_OPS_<ENTITY>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml
 * (unregistered codes fail CI). Payloads carry ids, states, reason codes, confidence (basis points) and opaque subject/
 * request/output references ONLY — never feedback/case narrative, customer contact, prompt/output content or secrets.
 */
export const M25_AUDIT_CODES = {
  subjectBound: 'AI_OPS_SUBJECT_BOUND',
  analysisRequested: 'AI_OPS_ANALYSIS_REQUESTED',
  analysisGenerated: 'AI_OPS_ANALYSIS_GENERATED',
  analysisAccepted: 'AI_OPS_ANALYSIS_ACCEPTED',
  analysisRejected: 'AI_OPS_ANALYSIS_REJECTED',
  analysisDismissed: 'AI_OPS_ANALYSIS_DISMISSED',
  analysisFailed: 'AI_OPS_ANALYSIS_FAILED',
  suggestionCreated: 'AI_OPS_SUGGESTION_CREATED',
  suggestionDecided: 'AI_OPS_SUGGESTION_DECIDED',
  configPublished: 'AI_OPS_CONFIG_PUBLISHED',
  evidenceRecorded: 'AI_OPS_EVIDENCE_RECORDED',
} as const;

export type M25AuditCode = (typeof M25_AUDIT_CODES)[keyof typeof M25_AUDIT_CODES];
export const ALL_M25_AUDIT_CODES: readonly M25AuditCode[] = Object.values(M25_AUDIT_CODES);
export const AI_OPS_AUDIT_PREFIX = 'AI_OPS_';
