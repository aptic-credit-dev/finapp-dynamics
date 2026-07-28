/**
 * M17 audit codes — the authoritative constant map. Every controlled recovery mutation records one of these
 * through the kernel `AUDIT` port (m03 AuditService) in the SAME transaction as the state change. Codes are
 * SCREAMING_SNAKE `RECOVERY_<ENTITY>_<ACTION>` (>= 3 segments) and MUST be registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads never carry debtor contact
 * details, negotiation strategy, settlement terms, bank/payment details, security valuations, document contents,
 * secrets, or notification destinations (ADR-072).
 */
export const M17_AUDIT_CODES = {
  recoveryTypeCreated: 'RECOVERY_TYPE_CREATED',
  recoveryTypePublished: 'RECOVERY_TYPE_PUBLISHED',
  slaPolicyPublished: 'RECOVERY_SLA_PUBLISHED',
  recoveryCreated: 'RECOVERY_CASE_CREATED',
  recoveryReferred: 'RECOVERY_CASE_REFERRED',
  recoveryAssigned: 'RECOVERY_CASE_ASSIGNED',
  recoveryReassigned: 'RECOVERY_CASE_REASSIGNED',
  recoverySuspended: 'RECOVERY_CASE_SUSPENDED',
  partyAdded: 'RECOVERY_PARTY_ADDED',
  partyUpdated: 'RECOVERY_PARTY_UPDATED',
  partyRemoved: 'RECOVERY_PARTY_REMOVED',
  partyContactAccessed: 'RECOVERY_PARTY_CONTACT_ACCESSED',
  instrumentRegistered: 'RECOVERY_INSTRUMENT_REGISTERED',
  instrumentUpdated: 'RECOVERY_INSTRUMENT_UPDATED',
  strategySelected: 'RECOVERY_STRATEGY_SELECTED',
  demandIssued: 'RECOVERY_DEMAND_ISSUED',
  demandResponded: 'RECOVERY_DEMAND_RESPONDED',
  negotiationOpened: 'RECOVERY_NEGOTIATION_OPENED',
  negotiationClosed: 'RECOVERY_NEGOTIATION_CLOSED',
  arrangementCreated: 'RECOVERY_ARRANGEMENT_CREATED',
  arrangementApproved: 'RECOVERY_ARRANGEMENT_APPROVED',
  arrangementActivated: 'RECOVERY_ARRANGEMENT_ACTIVATED',
  arrangementDefaulted: 'RECOVERY_ARRANGEMENT_DEFAULTED',
  arrangementCompleted: 'RECOVERY_ARRANGEMENT_COMPLETED',
  installmentRecorded: 'RECOVERY_INSTALLMENT_RECORDED',
  enforcementInitiated: 'RECOVERY_ENFORCEMENT_INITIATED',
  enforcementUpdated: 'RECOVERY_ENFORCEMENT_UPDATED',
  enforcementCompleted: 'RECOVERY_ENFORCEMENT_COMPLETED',
  securityRegistered: 'RECOVERY_SECURITY_REGISTERED',
  securityRealized: 'RECOVERY_SECURITY_REALIZED',
  agentInstructed: 'RECOVERY_AGENT_INSTRUCTED',
  agentReportReceived: 'RECOVERY_AGENT_REPORT_RECEIVED',
  agentTerminated: 'RECOVERY_AGENT_TERMINATED',
  receiptRecorded: 'RECOVERY_RECEIPT_RECORDED',
  waiverGranted: 'RECOVERY_WAIVER_GRANTED',
  writeoffRecommended: 'RECOVERY_WRITEOFF_RECOMMENDED',
  writeoffApproved: 'RECOVERY_WRITEOFF_APPROVED',
  outcomeRecorded: 'RECOVERY_OUTCOME_RECORDED',
  costRecorded: 'RECOVERY_COST_RECORDED',
  deadlineCreated: 'RECOVERY_DEADLINE_CREATED',
  deadlineExtended: 'RECOVERY_DEADLINE_EXTENDED',
  deadlineBreached: 'RECOVERY_DEADLINE_BREACHED',
  noteCreated: 'RECOVERY_NOTE_CREATED',
  relationshipCreated: 'RECOVERY_RELATIONSHIP_CREATED',
  closureEvaluated: 'RECOVERY_CLOSURE_EVALUATED',
  recoveryResolved: 'RECOVERY_CASE_RESOLVED',
  recoveryClosed: 'RECOVERY_CASE_CLOSED',
  recoveryReopened: 'RECOVERY_CASE_REOPENED',
  recoveryArchived: 'RECOVERY_CASE_ARCHIVED',
  privilegedAccessed: 'RECOVERY_PRIVILEGED_ACCESSED',
  confidentialAccessed: 'RECOVERY_CONFIDENTIAL_ACCESSED',
  exportRequested: 'RECOVERY_EXPORT_REQUESTED',
  slaStarted: 'RECOVERY_SLA_STARTED',
  slaBreached: 'RECOVERY_SLA_BREACHED',
  escalationTriggered: 'RECOVERY_ESCALATION_TRIGGERED',
} as const;

export type M17AuditCode = (typeof M17_AUDIT_CODES)[keyof typeof M17_AUDIT_CODES];

export const ALL_M17_AUDIT_CODES: readonly M17AuditCode[] = Object.values(M17_AUDIT_CODES);

export const RECOVERY_AUDIT_PREFIX = 'RECOVERY_';
