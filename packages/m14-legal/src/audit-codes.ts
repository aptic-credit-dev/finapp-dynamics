/**
 * M14 audit codes — the authoritative constant map. Every controlled legal-matter mutation records one of these
 * through the kernel `AUDIT` port (m03 AuditService) in the SAME transaction as the state change. Codes are
 * SCREAMING_SNAKE `LEGAL_<ENTITY>_<ACTION>` (>= 3 segments) and MUST be registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads never carry legal advice,
 * legal strategy, full opinions, privileged notes, private party contacts, document contents, confidential
 * settlement terms, counsel bank/payment details, raw correspondence, secrets, or notification destinations
 * (ADR-064).
 */
export const M14_AUDIT_CODES = {
  matterTypeCreated: 'LEGAL_MATTER_TYPE_CREATED',
  matterTypePublished: 'LEGAL_MATTER_TYPE_PUBLISHED',
  slaPolicyPublished: 'LEGAL_SLA_POLICY_PUBLISHED',
  jurisdictionConfigured: 'LEGAL_JURISDICTION_CONFIGURED',
  matterCreated: 'LEGAL_MATTER_CREATED',
  matterConverted: 'LEGAL_MATTER_CONVERTED',
  matterOpened: 'LEGAL_MATTER_OPENED',
  matterAssigned: 'LEGAL_MATTER_ASSIGNED',
  matterReassigned: 'LEGAL_MATTER_REASSIGNED',
  instructionReceived: 'LEGAL_INSTRUCTION_RECEIVED',
  instructionAccepted: 'LEGAL_INSTRUCTION_ACCEPTED',
  instructionRejected: 'LEGAL_INSTRUCTION_REJECTED',
  partyAdded: 'LEGAL_PARTY_ADDED',
  partyRemoved: 'LEGAL_PARTY_REMOVED',
  partyContactAccessed: 'LEGAL_PARTY_CONTACT_ACCESSED',
  activityCreated: 'LEGAL_ACTIVITY_CREATED',
  activityCompleted: 'LEGAL_ACTIVITY_COMPLETED',
  taskCreated: 'LEGAL_TASK_CREATED',
  taskCompleted: 'LEGAL_TASK_COMPLETED',
  pleadingRegistered: 'LEGAL_PLEADING_REGISTERED',
  pleadingFiled: 'LEGAL_PLEADING_FILED',
  documentLinked: 'LEGAL_DOCUMENT_LINKED',
  courtEventScheduled: 'LEGAL_COURT_EVENT_SCHEDULED',
  courtEventUpdated: 'LEGAL_COURT_EVENT_UPDATED',
  courtEventCompleted: 'LEGAL_COURT_EVENT_COMPLETED',
  deadlineCreated: 'LEGAL_DEADLINE_CREATED',
  deadlineExtended: 'LEGAL_DEADLINE_EXTENDED',
  deadlineBreached: 'LEGAL_DEADLINE_BREACHED',
  issueCreated: 'LEGAL_ISSUE_CREATED',
  positionRecorded: 'LEGAL_POSITION_RECORDED',
  opinionRegistered: 'LEGAL_OPINION_REGISTERED',
  researchAdded: 'LEGAL_RESEARCH_ADDED',
  counselInstructed: 'LEGAL_COUNSEL_INSTRUCTED',
  counselReportReceived: 'LEGAL_COUNSEL_REPORT_RECEIVED',
  costRecorded: 'LEGAL_COST_RECORDED',
  exposureUpdated: 'LEGAL_EXPOSURE_UPDATED',
  settlementProposed: 'LEGAL_SETTLEMENT_PROPOSED',
  settlementApproved: 'LEGAL_SETTLEMENT_APPROVED',
  judgmentRecorded: 'LEGAL_JUDGMENT_RECORDED',
  appealInitiated: 'LEGAL_APPEAL_INITIATED',
  enforcementUpdated: 'LEGAL_ENFORCEMENT_UPDATED',
  correspondenceRecorded: 'LEGAL_CORRESPONDENCE_RECORDED',
  noteCreated: 'LEGAL_NOTE_CREATED',
  relationshipCreated: 'LEGAL_RELATIONSHIP_CREATED',
  closureEvaluated: 'LEGAL_CLOSURE_EVALUATED',
  matterResolved: 'LEGAL_MATTER_RESOLVED',
  matterClosed: 'LEGAL_MATTER_CLOSED',
  matterReopened: 'LEGAL_MATTER_REOPENED',
  matterArchived: 'LEGAL_MATTER_ARCHIVED',
  privilegedAccessed: 'LEGAL_PRIVILEGED_ACCESSED',
  confidentialAccessed: 'LEGAL_CONFIDENTIAL_ACCESSED',
  exportRequested: 'LEGAL_EXPORT_REQUESTED',
  slaStarted: 'LEGAL_SLA_STARTED',
  slaBreached: 'LEGAL_SLA_BREACHED',
  escalationTriggered: 'LEGAL_ESCALATION_TRIGGERED',
} as const;

export type M14AuditCode = (typeof M14_AUDIT_CODES)[keyof typeof M14_AUDIT_CODES];

export const ALL_M14_AUDIT_CODES: readonly M14AuditCode[] = Object.values(M14_AUDIT_CODES);

export const LEGAL_AUDIT_PREFIX = 'LEGAL_';
