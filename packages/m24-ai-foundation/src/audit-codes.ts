/**
 * M24 audit codes — the `AI_` prefix. Every controlled AI-foundation mutation AND every AI output is audited through
 * the kernel `AUDIT` port in the SAME transaction. SCREAMING_SNAKE `AI_<ENTITY>_<ACTION>` (>= 3 segments), registered
 * in manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads carry ids, states, reason
 * codes, confidence (basis points) and opaque references ONLY — never prompt/output content, secrets, provider
 * credentials or restricted data (large content lives behind m09 document references). A blocked DLP attempt is audited
 * (AI_DLP_BLOCKED): no governed AI decision disappears silently.
 */
export const M24_AUDIT_CODES = {
  providerRegistered: 'AI_PROVIDER_REGISTERED',
  providerApproved: 'AI_PROVIDER_APPROVED',
  modelRegistered: 'AI_MODEL_REGISTERED',
  promptPublished: 'AI_PROMPT_PUBLISHED',
  configPublished: 'AI_CONFIG_PUBLISHED',
  dlpPolicyPublished: 'AI_DLP_POLICY_PUBLISHED',
  requestReceived: 'AI_REQUEST_RECEIVED',
  requestDlpChecked: 'AI_REQUEST_DLP_CHECKED',
  requestRouted: 'AI_REQUEST_ROUTED',
  requestCompleted: 'AI_REQUEST_COMPLETED',
  requestRejected: 'AI_REQUEST_REJECTED',
  requestFailed: 'AI_REQUEST_FAILED',
  requestCancelled: 'AI_REQUEST_CANCELLED',
  outputDrafted: 'AI_OUTPUT_DRAFTED',
  outputValidated: 'AI_OUTPUT_VALIDATED',
  outputApproved: 'AI_OUTPUT_APPROVED',
  outputRejected: 'AI_OUTPUT_REJECTED',
  humanReviewRecorded: 'AI_HUMAN_REVIEW_RECORDED',
  citationRecorded: 'AI_CITATION_RECORDED',
  dlpBlocked: 'AI_DLP_BLOCKED',
  usageRecorded: 'AI_USAGE_RECORDED',
  governanceControlUpdated: 'AI_GOVERNANCE_CONTROL_UPDATED',
} as const;

export type M24AuditCode = (typeof M24_AUDIT_CODES)[keyof typeof M24_AUDIT_CODES];
export const ALL_M24_AUDIT_CODES: readonly M24AuditCode[] = Object.values(M24_AUDIT_CODES);
export const AI_AUDIT_PREFIX = 'AI_';
