/**
 * M22 audit codes — every controlled approval-workflow mutation records one through the kernel `AUDIT` port in the SAME
 * transaction as the state change + event. SCREAMING_SNAKE `APPROVAL_<ENTITY>_<ACTION>` (>= 3 segments), registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads carry ids, states, levels, reason
 * codes and opaque references only — never subject narratives, counterparty PII or secrets. Blocked SoD attempts are
 * audited too (APPROVAL_SOD_BLOCKED): a refused controlled action never disappears silently (fail closed, CLAUDE.md).
 */
export const M22_AUDIT_CODES = {
  policyCreated: 'APPROVAL_POLICY_CREATED',
  policyPublished: 'APPROVAL_POLICY_PUBLISHED',
  configCreated: 'APPROVAL_CONFIG_CREATED',
  configPublished: 'APPROVAL_CONFIG_PUBLISHED',
  reasonCodeRegistered: 'APPROVAL_REASON_CODE_REGISTERED',
  requestCreated: 'APPROVAL_REQUEST_CREATED',
  requestSubmitted: 'APPROVAL_REQUEST_SUBMITTED',
  requestApproved: 'APPROVAL_REQUEST_APPROVED',
  requestRejected: 'APPROVAL_REQUEST_REJECTED',
  requestReturned: 'APPROVAL_REQUEST_RETURNED',
  requestCancelled: 'APPROVAL_REQUEST_CANCELLED',
  requestEscalated: 'APPROVAL_REQUEST_ESCALATED',
  decisionRecorded: 'APPROVAL_DECISION_RECORDED',
  stepApproved: 'APPROVAL_STEP_APPROVED',
  stepRejected: 'APPROVAL_STEP_REJECTED',
  delegationGranted: 'APPROVAL_DELEGATION_GRANTED',
  delegationRevoked: 'APPROVAL_DELEGATION_REVOKED',
  escalationFired: 'APPROVAL_ESCALATION_FIRED',
  notificationDispatched: 'APPROVAL_NOTIFICATION_DISPATCHED',
  overrideApplied: 'APPROVAL_OVERRIDE_APPLIED',
  outcomeReleased: 'APPROVAL_OUTCOME_RELEASED',
  sodBlocked: 'APPROVAL_SOD_BLOCKED',
  timerRegistered: 'APPROVAL_TIMER_REGISTERED',
} as const;

export type M22AuditCode = (typeof M22_AUDIT_CODES)[keyof typeof M22_AUDIT_CODES];
export const ALL_M22_AUDIT_CODES: readonly M22AuditCode[] = Object.values(M22_AUDIT_CODES);
export const APPROVAL_AUDIT_PREFIX = 'APPROVAL_';
