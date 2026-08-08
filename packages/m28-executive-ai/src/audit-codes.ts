/**
 * M28 audit codes — new codes under the SHARED `AI_` prefix (naming-map: m28 shares m24's audit prefix). Every copilot
 * mutation, refusal and sensitive/export access is audited through the kernel AUDIT port in the SAME transaction.
 * SCREAMING_SNAKE `AI_COPILOT_<ENTITY>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml
 * (unregistered codes fail CI). Payloads carry safe ids, status, intent class, reason codes, confidence (basis points),
 * source COUNTS and timestamps ONLY — never the full question, the full answer, restricted finance/legal/customer
 * content, document content, a privileged narrative, secrets or credentials.
 */
export const M28_AUDIT_CODES = {
  sessionCreated: 'AI_COPILOT_SESSION_CREATED',
  querySubmitted: 'AI_COPILOT_QUERY_SUBMITTED',
  queryRefused: 'AI_COPILOT_QUERY_REFUSED',
  responseGenerated: 'AI_COPILOT_RESPONSE_GENERATED',
  citationAccessed: 'AI_COPILOT_CITATION_ACCESSED',
  feedbackRecorded: 'AI_COPILOT_FEEDBACK_RECORDED',
  sensitiveQuery: 'AI_COPILOT_SENSITIVE_QUERY',
  exportRequested: 'AI_COPILOT_EXPORT_REQUESTED',
  configUpdated: 'AI_COPILOT_CONFIG_UPDATED',
} as const;

export type M28AuditCode = (typeof M28_AUDIT_CODES)[keyof typeof M28_AUDIT_CODES];
export const ALL_M28_AUDIT_CODES: readonly M28AuditCode[] = Object.values(M28_AUDIT_CODES);
export const AI_COPILOT_AUDIT_PREFIX = 'AI_COPILOT_';
