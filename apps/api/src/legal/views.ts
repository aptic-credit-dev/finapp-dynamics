import type {
  SpecRow,
  MatterRow,
  InstructionRow,
  PartyRow,
  ActivityRow,
  TaskRow,
  IssueRow,
  PositionRow,
  OpinionRow,
  ResearchRow,
  PleadingRow,
  CourtEventRow,
  DeadlineRow,
  CounselRow,
  CounselReportRow,
  CostRow,
  SettlementRow,
  OutcomeRow,
  NoteRow,
  RelationshipRow,
} from '@finapp/m14-legal';

/**
 * Response shapes for the legal API (m14). Persistence rows are snake_case; these map to camelCase DTOs. The
 * tenant is implicit (x-tenant-id + RLS), never re-exposed. Deliberate REDACTIONS (ADR-064): a matter whose
 * confidentiality is not `standard` (or is privileged) exposes its legal description only to a caller holding
 * `legal.confidential.read`; a party's contact reference only to `legal.party_contact.read`; legal positions are
 * gated behind `legal.position.read` in the service; a settlement's confidential terms + amount only to a
 * confidential reader; privileged notes are filtered out entirely in the service. Every mutable view carries
 * `version`.
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

export function matterView(row: MatterRow, canReadConfidential: boolean) {
  const hide = (row.confidentiality !== 'standard' || row.privileged) && !canReadConfidential;
  return {
    id: row.id,
    matterNumber: row.matter_number,
    matterTypeCode: row.matter_type_code,
    matterTypeVersion: row.matter_type_version,
    source: row.source,
    sourceCaseId: row.source_case_id,
    originatingModule: row.originating_module,
    title: row.title,
    summary: redactIf(hide, row.summary),
    legalDescription: redactIf(hide, row.legal_description),
    jurisdiction: row.jurisdiction,
    forum: row.forum,
    station: row.station,
    externalCaseNumber: row.external_case_number,
    courtReference: row.court_reference,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
    legalRisk: row.legal_risk,
    priority: row.priority,
    claimAmountMinor: hide ? null : row.claim_amount_minor,
    exposureAmountMinor: hide ? null : row.exposure_amount_minor,
    currency: row.currency,
    causeOfAction: redactIf(hide, row.cause_of_action),
    reliefSought: redactIf(hide, row.relief_sought),
    currentOwner: row.current_owner,
    legalTeam: row.legal_team,
    businessOwner: row.business_owner,
    branch: row.branch,
    department: row.department,
    slaPolicyCode: row.sla_policy_code,
    escalationRef: row.escalation_ref,
    status: row.status,
    currentStage: row.current_stage,
    legalHold: row.legal_hold,
    limitationAt: row.limitation_at,
    appealStatus: row.appeal_status,
    enforcementStage: row.enforcement_stage,
    finalOutcome: row.final_outcome,
    openedAt: row.opened_at,
    filedAt: row.filed_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    version: row.version,
  };
}

export function instructionView(row: InstructionRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    instructionType: row.instruction_type,
    summary: row.summary,
    acceptanceStatus: row.acceptance_status,
    acceptedBy: row.accepted_by,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
    version: row.version,
  };
}
export function partyView(row: PartyRow, canReadContact: boolean) {
  return {
    id: row.id,
    matterId: row.matter_id,
    partyRole: row.party_role,
    entityRef: row.entity_ref,
    displayLabel: row.display_label,
    advocateRef: row.advocate_ref,
    lawFirmRef: row.law_firm_ref,
    contactRef: canReadContact ? row.contact_ref : row.contact_ref === null ? null : '[redacted]',
    confidentiality: row.confidentiality,
    active: row.active,
    version: row.version,
  };
}
export function activityView(row: ActivityRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    activityType: row.activity_type,
    headline: row.headline,
    status: row.status,
    direction: row.direction,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
    outcome: row.outcome,
    version: row.version,
  };
}
export function taskView(row: TaskRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
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
    matterId: row.matter_id,
    issueCode: row.issue_code,
    category: row.category,
    statement: row.statement,
    causeOfAction: row.cause_of_action,
    risk: row.risk,
    mandatory: row.mandatory,
    outcome: row.outcome,
    status: row.status,
    version: row.version,
  };
}
export function positionView(row: PositionRow) {
  // The service already gates legal positions behind legal.position.read; this view returns the metadata envelope.
  return {
    id: row.id,
    matterId: row.matter_id,
    approvalStatus: row.approval_status,
    reviewer: row.reviewer,
    privileged: row.privileged,
    confidentiality: row.confidentiality,
  };
}
export function opinionView(row: OpinionRow, canReadConfidential: boolean) {
  const hide = row.confidentiality !== 'standard' && !canReadConfidential;
  return {
    id: row.id,
    matterId: row.matter_id,
    opinionType: row.opinion_type,
    summaryConclusion: redactIf(hide, row.summary_conclusion),
    riskRating: row.risk_rating,
    approvalStatus: row.approval_status,
    documentRef: row.document_ref,
    privileged: row.privileged,
    confidentiality: row.confidentiality,
  };
}
export function researchView(row: ResearchRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    referenceType: row.reference_type,
    citation: row.citation,
    title: row.title,
    verified: row.verified,
    version: row.version,
  };
}
export function pleadingView(row: PleadingRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    documentRole: row.document_role,
    documentRef: row.document_ref,
    filingStatus: row.filing_status,
    serviceStatus: row.service_status,
    courtStampReference: row.court_stamp_reference,
    privileged: row.privileged,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}
export function courtEventView(row: CourtEventRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    eventType: row.event_type,
    title: row.title,
    scheduledAt: row.scheduled_at,
    forum: row.forum,
    status: row.status,
    outcome: row.outcome,
    nextAt: row.next_at,
    version: row.version,
  };
}
export function deadlineView(row: DeadlineRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    deadlineType: row.deadline_type,
    dueAt: row.due_at,
    status: row.status,
    waived: row.waived,
    version: row.version,
  };
}
export function counselView(row: CounselRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    lawFirmRef: row.law_firm_ref,
    advocateRef: row.advocate_ref,
    status: row.status,
    nextReportDue: row.next_report_due,
    version: row.version,
  };
}
export function counselReportView(row: CounselReportRow, canReadConfidential: boolean) {
  const hide = row.confidentiality !== 'standard' && !canReadConfidential;
  return {
    id: row.id,
    matterId: row.matter_id,
    reportingPeriod: row.reporting_period,
    statusSummary: redactIf(hide, row.status_summary),
    reportDate: row.report_date,
    documentRef: row.document_ref,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
  };
}
export function costView(row: CostRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    costType: row.cost_type,
    amountMinor: row.amount_minor,
    currency: row.currency,
    approvalStatus: row.approval_status,
    recoverable: row.recoverable,
    version: row.version,
  };
}
export function settlementView(row: SettlementRow, canReadConfidential: boolean) {
  const hide = !canReadConfidential;
  return {
    id: row.id,
    matterId: row.matter_id,
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
export function outcomeView(row: OutcomeRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    outcomeType: row.outcome_type,
    outcomeDate: row.outcome_date,
    summary: row.summary,
    amountAwardedMinor: row.amount_awarded_minor,
    currency: row.currency,
    appealable: row.appealable,
    status: row.status,
  };
}
export function noteView(row: NoteRow, canReadPrivileged: boolean) {
  const hide = row.privileged && !canReadPrivileged;
  return {
    id: row.id,
    matterId: row.matter_id,
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
    fromMatterId: row.from_matter_id,
    toMatterId: row.to_matter_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
  };
}
