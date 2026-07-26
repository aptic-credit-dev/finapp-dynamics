import type {
  SpecRow,
  CaseRow,
  PartyRow,
  ActivityRow,
  TaskRow,
  IssueRow,
  InvestigationRow,
  FindingRow,
  DocumentRow,
  EvidenceRow,
  DeadlineRow,
  HearingRow,
  DecisionRow,
  SettlementRow,
  NoteRow,
  RelationshipRow,
} from '@finapp/m13-case';

/**
 * Response shapes for the cases API (m13). Persistence rows are snake_case; these map to camelCase DTOs. The
 * tenant is implicit (x-tenant-id + RLS), never re-exposed. Deliberate REDACTIONS (ADR-060): for a case whose
 * confidentiality is not `standard`, the free-text summary/description/subject are exposed only to a caller
 * holding `cases.confidential.read`; a party's contact reference only to `cases.party_contact.read`; a
 * settlement's confidential terms + amount only to a confidential reader; privileged notes are filtered out
 * entirely in the service before they reach the view. Every mutable view carries `version`.
 */

function redactIf(hidden: boolean, value: string | null): string | null {
  return hidden ? (value === null ? null : '[redacted]') : value;
}

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

export function caseView(row: CaseRow, canReadConfidential: boolean) {
  const hide = row.confidentiality !== 'standard' && !canReadConfidential;
  return {
    id: row.id,
    caseNumber: row.case_number,
    caseTypeCode: row.case_type_code,
    caseTypeVersion: row.case_type_version,
    title: row.title,
    summary: redactIf(hide, row.summary),
    description: redactIf(hide, row.description),
    source: row.source,
    originatingModule: row.originating_module,
    originatingFeedbackId: row.originating_feedback_id,
    customerRef: row.customer_ref,
    subjectRef: redactIf(hide, row.subject_ref),
    productRef: row.product_ref,
    classification: row.classification,
    confidentiality: row.confidentiality,
    severity: row.severity,
    priority: row.priority,
    riskRating: row.risk_rating,
    currentOwner: row.current_owner,
    responsibleTeam: row.responsible_team,
    branch: row.branch,
    department: row.department,
    slaPolicyCode: row.sla_policy_code,
    escalationRef: row.escalation_ref,
    status: row.status,
    currentStage: row.current_stage,
    legalStatus: row.legal_status,
    courtReference: row.court_reference,
    recoveryState: row.recovery_state,
    recoveryClaimedMinor: row.recovery_claimed_minor,
    recoveryRecoveredMinor: row.recovery_recovered_minor,
    recoveryCurrency: row.recovery_currency,
    legalHold: row.legal_hold,
    subjectInformed: row.subject_informed,
    triageStatus: row.triage_status,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    version: row.version,
  };
}

export function partyView(row: PartyRow, canReadContact: boolean) {
  return {
    id: row.id,
    caseId: row.case_id,
    partyType: row.party_type,
    role: row.role,
    entityRef: row.entity_ref,
    displayLabel: row.display_label,
    contactRef: canReadContact ? row.contact_ref : row.contact_ref === null ? null : '[redacted]',
    confidentiality: row.confidentiality,
    active: row.active,
    version: row.version,
  };
}

export function activityView(row: ActivityRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    activityType: row.activity_type,
    headline: row.headline,
    status: row.status,
    direction: row.direction,
    confidentiality: row.confidentiality,
    outcome: row.outcome,
    version: row.version,
  };
}

export function taskView(row: TaskRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    taskType: row.task_type,
    headline: row.headline,
    status: row.status,
    priority: row.priority,
    mandatory: row.mandatory,
    outcome: row.outcome,
    version: row.version,
  };
}

export function issueView(row: IssueRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    issueCode: row.issue_code,
    category: row.category,
    description: row.description,
    severity: row.severity,
    mandatory: row.mandatory,
    finding: row.finding,
    outcome: row.outcome,
    resolved: row.resolved,
    version: row.version,
  };
}

export function investigationView(row: InvestigationRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    scope: row.scope,
    investigator: row.investigator,
    substantiation: row.substantiation,
    rootCause: row.root_cause,
    status: row.status,
    version: row.version,
  };
}

export function findingView(row: FindingRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    issueId: row.issue_id,
    findingType: row.finding_type,
    summary: row.summary,
    reviewStatus: row.review_status,
    confidentiality: row.confidentiality,
  };
}

export function documentView(row: DocumentRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    documentRef: row.document_ref,
    documentRole: row.document_role,
    evidenceCategory: row.evidence_category,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
    exhibitReference: row.exhibit_reference,
    version: row.version,
  };
}

export function evidenceView(row: EvidenceRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    documentRef: row.document_ref,
    evidenceType: row.evidence_type,
    description: row.description,
    verificationStatus: row.verification_status,
    custodyStatus: row.custody_status,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
  };
}

export function deadlineView(row: DeadlineRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    deadlineType: row.deadline_type,
    dueAt: row.due_at,
    status: row.status,
    waived: row.waived,
    version: row.version,
  };
}

export function hearingView(row: HearingRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    hearingType: row.hearing_type,
    title: row.title,
    scheduledAt: row.scheduled_at,
    status: row.status,
    outcome: row.outcome,
    nextAt: row.next_at,
    version: row.version,
  };
}

export function decisionView(row: DecisionRow, canReadConfidential: boolean) {
  const hide = row.confidentiality !== 'standard' && !canReadConfidential;
  return {
    id: row.id,
    caseId: row.case_id,
    decisionType: row.decision_type,
    summary: redactIf(hide, row.summary),
    remedyType: row.remedy_type,
    approvalStatus: row.approval_status,
    submittedBy: row.submitted_by,
    approvedBy: row.approved_by,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function settlementView(row: SettlementRow, canReadConfidential: boolean) {
  const hide = !canReadConfidential;
  return {
    id: row.id,
    caseId: row.case_id,
    settlementType: row.settlement_type,
    // Confidential settlement terms + amount are exposed only to a confidential reader.
    amountMinor: hide ? null : row.amount_minor,
    currency: row.currency,
    approvalStatus: row.approval_status,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    confidentiality: row.confidentiality,
    performanceStatus: row.performance_status,
    version: row.version,
  };
}

export function noteView(row: NoteRow, canReadPrivileged: boolean) {
  const hide = row.privileged && !canReadPrivileged;
  return {
    id: row.id,
    caseId: row.case_id,
    noteType: row.note_type,
    headline: row.headline,
    content: hide ? '[redacted]' : row.content,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
  };
}

export function relationshipView(row: RelationshipRow) {
  return {
    id: row.id,
    fromCaseId: row.from_case_id,
    toCaseId: row.to_case_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
  };
}
