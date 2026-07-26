/**
 * M12 audit codes — the authoritative constant map. Every controlled feedback mutation records one of these
 * through the kernel `AUDIT` port (m03 AuditService) in the SAME transaction as the state change. Codes are
 * SCREAMING_SNAKE `FEEDBACK_<ENTITY>_<ACTION>` (>= 3 segments) and MUST be registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads never carry customer
 * contacts, full narratives, confidential internal responses, document contents, or notification destinations
 * (ADR-055).
 */
export const M12_AUDIT_CODES = {
  transactionIngested: 'FEEDBACK_TRANSACTION_INGESTED',
  queueCreated: 'FEEDBACK_QUEUE_CREATED',
  queueClaimed: 'FEEDBACK_QUEUE_CLAIMED',
  contactAttempted: 'FEEDBACK_CONTACT_ATTEMPTED',
  contactAccessed: 'FEEDBACK_CONTACT_ACCESSED',
  recordCreated: 'FEEDBACK_RECORD_CREATED',
  recordCaptured: 'FEEDBACK_RECORD_CAPTURED',
  recordClassified: 'FEEDBACK_RECORD_CLASSIFIED',
  recordAssigned: 'FEEDBACK_RECORD_ASSIGNED',
  activityCreated: 'FEEDBACK_ACTIVITY_CREATED',
  activityCompleted: 'FEEDBACK_ACTIVITY_COMPLETED',
  responseSubmitted: 'FEEDBACK_RESPONSE_SUBMITTED',
  rootCauseRecorded: 'FEEDBACK_ROOT_CAUSE_RECORDED',
  resolutionSubmitted: 'FEEDBACK_RESOLUTION_SUBMITTED',
  resolutionApproved: 'FEEDBACK_RESOLUTION_APPROVED',
  confirmationRecorded: 'FEEDBACK_CONFIRMATION_RECORDED',
  slaStarted: 'FEEDBACK_SLA_STARTED',
  slaPaused: 'FEEDBACK_SLA_PAUSED',
  slaResumed: 'FEEDBACK_SLA_RESUMED',
  slaBreached: 'FEEDBACK_SLA_BREACHED',
  escalationTriggered: 'FEEDBACK_ESCALATION_TRIGGERED',
  closureEvaluated: 'FEEDBACK_CLOSURE_EVALUATED',
  recordClosed: 'FEEDBACK_RECORD_CLOSED',
  recordReopened: 'FEEDBACK_RECORD_REOPENED',
  duplicateLinked: 'FEEDBACK_DUPLICATE_LINKED',
  relatedLinked: 'FEEDBACK_RELATED_LINKED',
  caseHandoffRequested: 'FEEDBACK_CASE_HANDOFF_REQUESTED',
  caseHandoffCompleted: 'FEEDBACK_CASE_HANDOFF_COMPLETED',
  positiveRecognized: 'FEEDBACK_POSITIVE_RECOGNIZED',
  questionnaireCreated: 'FEEDBACK_QUESTIONNAIRE_CREATED',
  questionnairePublished: 'FEEDBACK_QUESTIONNAIRE_PUBLISHED',
  categoryConfigured: 'FEEDBACK_CATEGORY_CONFIGURED',
  slaPolicyPublished: 'FEEDBACK_SLA_POLICY_PUBLISHED',
  sourceConfigured: 'FEEDBACK_SOURCE_CONFIGURED',
  exportRequested: 'FEEDBACK_EXPORT_REQUESTED',
} as const;

export type M12AuditCode = (typeof M12_AUDIT_CODES)[keyof typeof M12_AUDIT_CODES];

export const ALL_M12_AUDIT_CODES: readonly M12AuditCode[] = Object.values(M12_AUDIT_CODES);

export const FEEDBACK_AUDIT_PREFIX = 'FEEDBACK_';
