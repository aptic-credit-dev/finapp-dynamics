/**
 * M29 audit codes — new codes under the SHARED `AI_` prefix (naming-map: m29 shares m24's audit prefix). Every
 * governance mutation and every HUMAN decision is audited through the kernel AUDIT port in the SAME transaction.
 * SCREAMING_SNAKE `AI_GOVERNANCE_<ENTITY>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml
 * (unregistered codes fail CI). Payloads carry safe ids, status, subject kind, risk tier, reason codes, confidence/
 * accuracy (basis points), decision, decider id and timestamps ONLY — never prompts, outputs, restricted content,
 * document content, provider credentials or secrets.
 */
export const M29_AUDIT_CODES = {
  policyPublished: 'AI_GOVERNANCE_POLICY_PUBLISHED',
  useCaseRegistered: 'AI_GOVERNANCE_USE_CASE_REGISTERED',
  releaseProposed: 'AI_GOVERNANCE_RELEASE_PROPOSED',
  evaluationRecorded: 'AI_GOVERNANCE_EVALUATION_RECORDED',
  approvalRequested: 'AI_GOVERNANCE_APPROVAL_REQUESTED',
  releaseApproved: 'AI_GOVERNANCE_RELEASE_APPROVED',
  releaseRejected: 'AI_GOVERNANCE_RELEASE_REJECTED',
  releaseReleased: 'AI_GOVERNANCE_RELEASE_RELEASED',
  releaseSuspended: 'AI_GOVERNANCE_RELEASE_SUSPENDED',
  releaseWithdrawn: 'AI_GOVERNANCE_RELEASE_WITHDRAWN',
  waiverRequested: 'AI_GOVERNANCE_WAIVER_REQUESTED',
  waiverApproved: 'AI_GOVERNANCE_WAIVER_APPROVED',
  waiverRejected: 'AI_GOVERNANCE_WAIVER_REJECTED',
  overrideBlocked: 'AI_GOVERNANCE_OVERRIDE_BLOCKED',
  sensitiveRead: 'AI_GOVERNANCE_SENSITIVE_READ',
  exportRequested: 'AI_GOVERNANCE_EXPORT_REQUESTED',
} as const;

export type M29AuditCode = (typeof M29_AUDIT_CODES)[keyof typeof M29_AUDIT_CODES];
export const ALL_M29_AUDIT_CODES: readonly M29AuditCode[] = Object.values(M29_AUDIT_CODES);
export const AI_GOVERNANCE_AUDIT_PREFIX = 'AI_GOVERNANCE_';
