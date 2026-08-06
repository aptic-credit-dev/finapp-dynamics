/**
 * M26 audit codes — new codes under the SHARED `AI_` prefix (naming-map: m26 shares m24's audit prefix). Every
 * legal-AI mutation, every human legal decision AND every privileged-material read is audited through the kernel AUDIT
 * port in the SAME transaction. SCREAMING_SNAKE `AI_LEGAL_<ENTITY>_<ACTION>` (>= 3 segments), registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI). Payloads carry safe ids, subject type, status,
 * classification, confidence (basis points), reason codes, timestamps and opaque evidence references ONLY — NEVER legal
 * text, privileged narrative, raw prompt/output, document content, contacts, secrets or credentials.
 */
export const M26_AUDIT_CODES = {
  subjectBound: 'AI_LEGAL_SUBJECT_BOUND',
  analysisRequested: 'AI_LEGAL_ANALYSIS_REQUESTED',
  analysisCompleted: 'AI_LEGAL_ANALYSIS_COMPLETED',
  analysisBlocked: 'AI_LEGAL_ANALYSIS_BLOCKED',
  analysisAccepted: 'AI_LEGAL_ANALYSIS_ACCEPTED',
  analysisRejected: 'AI_LEGAL_ANALYSIS_REJECTED',
  analysisDismissed: 'AI_LEGAL_ANALYSIS_DISMISSED',
  findingRecorded: 'AI_LEGAL_FINDING_RECORDED',
  citationLinked: 'AI_LEGAL_CITATION_LINKED',
  evidenceRecorded: 'AI_LEGAL_EVIDENCE_RECORDED',
  suggestionCreated: 'AI_LEGAL_SUGGESTION_CREATED',
  suggestionReviewed: 'AI_LEGAL_SUGGESTION_REVIEWED',
  privilegedRead: 'AI_LEGAL_PRIVILEGED_READ',
  configUpdated: 'AI_LEGAL_CONFIG_UPDATED',
} as const;

export type M26AuditCode = (typeof M26_AUDIT_CODES)[keyof typeof M26_AUDIT_CODES];
export const ALL_M26_AUDIT_CODES: readonly M26AuditCode[] = Object.values(M26_AUDIT_CODES);
export const AI_LEGAL_AUDIT_PREFIX = 'AI_LEGAL_';
