/**
 * M13 audit codes — the authoritative constant map. Every controlled case mutation records one of these through
 * the kernel `AUDIT` port (m03 AuditService) in the SAME transaction as the state change. Codes are SCREAMING_SNAKE
 * `CASE_<ENTITY>_<ACTION>` and MUST be registered in manifests/audit-code-registry.yaml (unregistered codes fail
 * CI, ADR-005). Payloads never carry privileged note contents, private party contacts, correspondence bodies,
 * document contents, confidential settlement terms, storage references, secrets, or notification destinations
 * (ADR-060).
 */
export const M13_AUDIT_CODES = {
  typeCreated: 'CASE_TYPE_CREATED',
  typePublished: 'CASE_TYPE_PUBLISHED',
  slaPolicyPublished: 'CASE_SLA_POLICY_PUBLISHED',
  caseCreated: 'CASE_RECORD_CREATED',
  caseOpened: 'CASE_RECORD_OPENED',
  handoffConsumed: 'CASE_HANDOFF_CONSUMED',
  triageCompleted: 'CASE_TRIAGE_COMPLETED',
  caseAssigned: 'CASE_RECORD_ASSIGNED',
  caseReassigned: 'CASE_RECORD_REASSIGNED',
  partyAdded: 'CASE_PARTY_ADDED',
  partyRemoved: 'CASE_PARTY_REMOVED',
  partyContactAccessed: 'CASE_PARTY_CONTACT_ACCESSED',
  activityCreated: 'CASE_ACTIVITY_CREATED',
  activityCompleted: 'CASE_ACTIVITY_COMPLETED',
  taskCreated: 'CASE_TASK_CREATED',
  taskCompleted: 'CASE_TASK_COMPLETED',
  documentLinked: 'CASE_DOCUMENT_LINKED',
  evidenceRegistered: 'CASE_EVIDENCE_REGISTERED',
  evidenceVerified: 'CASE_EVIDENCE_VERIFIED',
  issueAdded: 'CASE_ISSUE_ADDED',
  investigationStarted: 'CASE_INVESTIGATION_STARTED',
  investigationCompleted: 'CASE_INVESTIGATION_COMPLETED',
  findingRecorded: 'CASE_FINDING_RECORDED',
  decisionSubmitted: 'CASE_DECISION_SUBMITTED',
  decisionApproved: 'CASE_DECISION_APPROVED',
  deadlineCreated: 'CASE_DEADLINE_CREATED',
  deadlineExtended: 'CASE_DEADLINE_EXTENDED',
  deadlineBreached: 'CASE_DEADLINE_BREACHED',
  hearingScheduled: 'CASE_HEARING_SCHEDULED',
  hearingUpdated: 'CASE_HEARING_UPDATED',
  hearingCompleted: 'CASE_HEARING_COMPLETED',
  legalUpdated: 'CASE_LEGAL_UPDATED',
  settlementProposed: 'CASE_SETTLEMENT_PROPOSED',
  settlementApproved: 'CASE_SETTLEMENT_APPROVED',
  recoveryUpdated: 'CASE_RECOVERY_UPDATED',
  correspondenceRecorded: 'CASE_CORRESPONDENCE_RECORDED',
  noteCreated: 'CASE_NOTE_CREATED',
  relationshipCreated: 'CASE_RELATIONSHIP_CREATED',
  closureEvaluated: 'CASE_CLOSURE_EVALUATED',
  caseResolved: 'CASE_RECORD_RESOLVED',
  caseClosed: 'CASE_RECORD_CLOSED',
  caseReopened: 'CASE_RECORD_REOPENED',
  caseArchived: 'CASE_RECORD_ARCHIVED',
  convertedToMatter: 'CASE_CONVERTED_TO_MATTER',
  privilegedAccessed: 'CASE_PRIVILEGED_ACCESSED',
  confidentialAccessed: 'CASE_CONFIDENTIAL_ACCESSED',
  exportRequested: 'CASE_EXPORT_REQUESTED',
  slaStarted: 'CASE_SLA_STARTED',
  slaBreached: 'CASE_SLA_BREACHED',
  escalationTriggered: 'CASE_ESCALATION_TRIGGERED',
} as const;

export type M13AuditCode = (typeof M13_AUDIT_CODES)[keyof typeof M13_AUDIT_CODES];

export const ALL_M13_AUDIT_CODES: readonly M13AuditCode[] = Object.values(M13_AUDIT_CODES);

export const CASE_AUDIT_PREFIX = 'CASE_';
