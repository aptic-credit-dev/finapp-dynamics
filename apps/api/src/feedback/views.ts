import type {
  SpecRow,
  FeedbackRow,
  QueueItemRow,
  ContactAttemptRow,
  ActivityRow,
  ResolutionRow,
  SlaInstanceRow,
  CaseHandoffRow,
  RelationshipRow,
} from '@finapp/m12-feedback';

/**
 * Response shapes for the feedback API (m12). Persistence rows are snake_case; these map to camelCase DTOs. The
 * tenant is implicit (x-tenant-id + RLS), never re-exposed. Deliberate REDACTIONS (ADR-055, prompt §G):
 * `customerContact` is exposed only when the caller holds `feedback.customer_contact.read`; the confidential
 * internal response is exposed only to callers who may submit responses. Every mutable view carries `version`.
 */

export function specView(row: SpecRow) {
  return {
    id: row.id,
    code: row.code,
    versionNumber: row.version_number,
    name: row.name,
    scope: row.scope,
    status: row.status,
    spec: row.spec,
    contentHash: row.content_hash,
    version: row.version,
  };
}

export function feedbackView(row: FeedbackRow, canReadContact: boolean) {
  return {
    id: row.id,
    code: row.code,
    sourceTransactionId: row.source_transaction_id,
    customerRef: row.customer_ref,
    customerContact: canReadContact
      ? row.customer_contact
      : row.customer_contact === null
        ? null
        : '[redacted]',
    product: row.product,
    branch: row.branch,
    department: row.department,
    responsibleOfficer: row.responsible_officer,
    channel: row.channel,
    feedbackType: row.feedback_type,
    rating: row.rating,
    ratingScale: row.rating_scale,
    sentiment: row.sentiment,
    category: row.category,
    severity: row.severity,
    narrative: row.narrative,
    csat: row.csat,
    nps: row.nps,
    questionnaireCode: row.questionnaire_code,
    questionnaireVersion: row.questionnaire_version,
    slaPolicyCode: row.sla_policy_code,
    escalationRef: row.escalation_ref,
    currentOwner: row.current_owner,
    status: row.status,
    resolutionStatus: row.resolution_status,
    closureStatus: row.closure_status,
    caseHandoffStatus: row.case_handoff_status,
    customerConfirmed: row.customer_confirmed,
    customerInformed: row.customer_informed,
    version: row.version,
  };
}

export function queueView(row: QueueItemRow) {
  return {
    id: row.id,
    sourceTransactionId: row.source_transaction_id,
    feedbackId: row.feedback_id,
    product: row.product,
    branch: row.branch,
    department: row.department,
    priority: row.priority,
    contactStatus: row.contact_status,
    attempts: row.attempts,
    assignedOfficer: row.assigned_officer,
    status: row.status,
    version: row.version,
  };
}

export function attemptView(row: ContactAttemptRow) {
  return {
    id: row.id,
    queueItemId: row.queue_item_id,
    feedbackId: row.feedback_id,
    attemptNumber: row.attempt_number,
    outcome: row.outcome,
    reached: row.reached,
  };
}

export function activityView(row: ActivityRow) {
  return {
    id: row.id,
    feedbackId: row.feedback_id,
    activityType: row.activity_type,
    headline: row.headline,
    mandatory: row.mandatory,
    completed: row.completed,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function resolutionView(row: ResolutionRow, canReadConfidential: boolean) {
  return {
    id: row.id,
    feedbackId: row.feedback_id,
    resolutionType: row.resolution_type,
    summary: row.summary,
    approvalStatus: row.approval_status,
    rootCauseCategory: row.root_cause_category,
    responseCustomerFacing: row.response_customer_facing,
    // The confidential internal response is never returned to unauthorized callers.
    ...(canReadConfidential ? { canViewConfidential: true } : {}),
    version: row.version,
  };
}

export function slaView(row: SlaInstanceRow) {
  return {
    id: row.id,
    feedbackId: row.feedback_id,
    slaPolicyCode: row.sla_policy_code,
    slaPolicyVersion: row.sla_policy_version,
    startedAt: row.started_at,
    resolutionDueAt: row.resolution_due_at,
    breached: row.breached,
    breachStage: row.breach_stage,
    waived: row.waived,
    dispositionRecorded: row.disposition_recorded,
    version: row.version,
  };
}

export function handoffView(row: CaseHandoffRow) {
  return {
    id: row.id,
    feedbackId: row.feedback_id,
    recommendedCaseType: row.recommended_case_type,
    severity: row.severity,
    status: row.status,
    caseRef: row.case_ref,
    version: row.version,
  };
}

export function relationshipView(row: RelationshipRow) {
  return {
    id: row.id,
    fromFeedbackId: row.from_feedback_id,
    toFeedbackId: row.to_feedback_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
  };
}
