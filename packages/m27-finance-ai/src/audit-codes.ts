/**
 * M27 audit codes — new codes under the SHARED `AI_` prefix (naming-map: m27 shares m24's audit prefix). Every
 * finance-AI mutation and every human decision is audited through the kernel AUDIT port in the SAME transaction.
 * SCREAMING_SNAKE `AI_FINANCE_<ENTITY>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml
 * (unregistered codes fail CI). Payloads carry safe ids, subject type, status, suggestion type, reason codes,
 * confidence (basis points), timestamps and opaque evidence references ONLY — never bank-statement text, raw ledger
 * content, prompt/output, document content, secrets or credentials.
 */
export const M27_AUDIT_CODES = {
  subjectBound: 'AI_FINANCE_SUBJECT_BOUND',
  analysisRequested: 'AI_FINANCE_ANALYSIS_REQUESTED',
  analysisCompleted: 'AI_FINANCE_ANALYSIS_COMPLETED',
  analysisBlocked: 'AI_FINANCE_ANALYSIS_BLOCKED',
  analysisAccepted: 'AI_FINANCE_ANALYSIS_ACCEPTED',
  analysisRejected: 'AI_FINANCE_ANALYSIS_REJECTED',
  analysisDismissed: 'AI_FINANCE_ANALYSIS_DISMISSED',
  suggestionCreated: 'AI_FINANCE_SUGGESTION_CREATED',
  suggestionReviewed: 'AI_FINANCE_SUGGESTION_REVIEWED',
  exceptionClassified: 'AI_FINANCE_EXCEPTION_CLASSIFIED',
  featureRecorded: 'AI_FINANCE_FEATURE_RECORDED',
  evidenceLinked: 'AI_FINANCE_EVIDENCE_LINKED',
  configUpdated: 'AI_FINANCE_CONFIG_UPDATED',
} as const;

export type M27AuditCode = (typeof M27_AUDIT_CODES)[keyof typeof M27_AUDIT_CODES];
export const ALL_M27_AUDIT_CODES: readonly M27AuditCode[] = Object.values(M27_AUDIT_CODES);
export const AI_FINANCE_AUDIT_PREFIX = 'AI_FINANCE_';
