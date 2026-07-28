import type {
  SpecRow,
  ProceedingRow,
  PartyRow,
  ClaimRow,
  FilingRow,
  ServiceRow,
  AppearanceRow,
  ProceedingRecordRow,
  WitnessRow,
  ExpertRow,
  ExhibitRow,
  BundleRow,
  BundleItemRow,
  OrderRow,
  ComplianceRow,
  OutcomeRow,
  AppealRow,
  DeadlineRow,
  CostRow,
  NoteRow,
  RelationshipRow,
} from '@finapp/m16-litigation';

/**
 * Response shapes for the litigation API (m16). Persistence rows are snake_case; these map to camelCase DTOs. The
 * tenant is implicit (x-tenant-id + RLS), never re-exposed. Deliberate REDACTIONS (ADR-068): a proceeding whose
 * confidentiality is not `standard` (or is privileged) exposes its summary/description/claim amount only to a
 * caller holding `litigation.confidential.read`; a party's/witness's contact reference only to the matching
 * contact-read permission; privileged notes are redacted unless the caller holds `litigation.privileged.read`.
 * Every mutable view carries `version`.
 */
const REDACTED = '[redacted]';
function redactIf(hidden: boolean, value: string | null): string | null {
  return hidden ? (value === null ? null : REDACTED) : value;
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

export function proceedingView(row: ProceedingRow, canReadConfidential: boolean) {
  const hide = (row.confidentiality !== 'standard' || row.privileged) && !canReadConfidential;
  return {
    id: row.id,
    proceedingNumber: row.proceeding_number,
    proceedingTypeCode: row.proceeding_type_code,
    proceedingTypeVersion: row.proceeding_type_version,
    source: row.source,
    sourceMatterId: row.source_matter_id,
    sourceReference: row.source_reference,
    originatingModule: row.originating_module,
    title: row.title,
    summary: redactIf(hide, row.summary),
    description: redactIf(hide, row.description),
    jurisdiction: row.jurisdiction,
    forum: row.forum,
    forumType: row.forum_type,
    court: row.court,
    station: row.station,
    division: row.division,
    externalCaseNumber: row.external_case_number,
    organizationRole: row.organization_role,
    claimAmountMinor: hide ? null : row.claim_amount_minor,
    currency: row.currency,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
    litigationRisk: row.litigation_risk,
    priority: row.priority,
    legalOwner: row.legal_owner,
    litigationTeam: row.litigation_team,
    businessOwner: row.business_owner,
    externalCounselRef: row.external_counsel_ref,
    slaPolicyCode: row.sla_policy_code,
    escalationRef: row.escalation_ref,
    status: row.status,
    proceduralStage: row.procedural_stage,
    legalHold: row.legal_hold,
    matterUpdateEmitted: row.matter_update_emitted,
    limitationAt: row.limitation_at,
    appealStatus: row.appeal_status,
    enforcementReferralReady: row.enforcement_referral_ready,
    finalOutcome: row.final_outcome,
    filedAt: row.filed_at,
    servedAt: row.served_at,
    commencedAt: row.commenced_at,
    concludedAt: row.concluded_at,
    closedAt: row.closed_at,
    reopenedAt: row.reopened_at,
    archivedAt: row.archived_at,
    version: row.version,
  };
}

export function partyView(row: PartyRow, canReadContact: boolean) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    partyRole: row.party_role,
    entityRef: row.entity_ref,
    displayLabel: row.display_label,
    representationRef: row.representation_ref,
    advocateRef: row.advocate_ref,
    lawFirmRef: row.law_firm_ref,
    leadCounselRef: row.lead_counsel_ref,
    serviceStatus: row.service_status,
    contactRef: canReadContact ? row.contact_ref : row.contact_ref === null ? null : REDACTED,
    confidentiality: row.confidentiality,
    active: row.active,
    version: row.version,
  };
}

export function claimView(row: ClaimRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    claimType: row.claim_type,
    statement: row.statement,
    causeReference: row.cause_reference,
    reliefSought: row.relief_sought,
    amountMinor: row.amount_minor,
    currency: row.currency,
    counterclaim: row.counterclaim,
    admissionStatus: row.admission_status,
    risk: row.risk,
    status: row.status,
    outcome: row.outcome,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function filingView(row: FilingRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    filingRole: row.filing_role,
    documentRef: row.document_ref,
    filingStatus: row.filing_status,
    filedDate: row.filed_date,
    preparedBy: row.prepared_by,
    approvedBy: row.approved_by,
    courtStampReference: row.court_stamp_reference,
    privileged: row.privileged,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function serviceView(row: ServiceRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    itemServed: row.item_served,
    partyRef: row.party_ref,
    serviceMethod: row.service_method,
    serviceDate: row.service_date,
    serviceStatus: row.service_status,
    verificationStatus: row.verification_status,
    verifiedBy: row.verified_by,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function appearanceView(row: AppearanceRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    appearanceType: row.appearance_type,
    scheduledAt: row.scheduled_at,
    forum: row.forum,
    venue: row.venue,
    presidingRef: row.presiding_ref,
    status: row.status,
    outcome: row.outcome,
    nextAt: row.next_at,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function recordView(row: ProceedingRecordRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    appearanceId: row.appearance_id,
    attendance: row.attendance,
    directions: row.directions,
    ordersSummary: row.orders_summary,
    nextAt: row.next_at,
    privileged: row.privileged,
    confidentiality: row.confidentiality,
    approvalStatus: row.approval_status,
  };
}

export function witnessView(row: WitnessRow, canReadContact: boolean) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    witnessRef: row.witness_ref,
    witnessType: row.witness_type,
    role: row.role,
    relevance: row.relevance,
    contactRef: canReadContact ? row.contact_ref : row.contact_ref === null ? null : REDACTED,
    attendanceStatus: row.attendance_status,
    summonsStatus: row.summons_status,
    examinationStatus: row.examination_status,
    protectionFlag: row.protection_flag,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
    version: row.version,
  };
}

export function expertView(row: ExpertRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    expertRef: row.expert_ref,
    expertise: row.expertise,
    engagementReference: row.engagement_reference,
    reportStatus: row.report_status,
    reportDueDate: row.report_due_date,
    attendanceStatus: row.attendance_status,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
    version: row.version,
  };
}

export function exhibitView(row: ExhibitRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    exhibitNumber: row.exhibit_number,
    description: row.description,
    source: row.source,
    relatedWitness: row.related_witness,
    admittedStatus: row.admitted_status,
    admissionDate: row.admission_date,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
    version: row.version,
  };
}

export function bundleView(row: BundleRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    bundleType: row.bundle_type,
    title: row.title,
    bundleVersion: row.bundle_version,
    compilationStatus: row.compilation_status,
    approvalStatus: row.approval_status,
    filingStatus: row.filing_status,
    preparedBy: row.prepared_by,
    approvedBy: row.approved_by,
    privileged: row.privileged,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function bundleItemView(row: BundleItemRow) {
  return {
    id: row.id,
    bundleId: row.bundle_id,
    documentRef: row.document_ref,
    tab: row.tab,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    description: row.description,
    sortOrder: row.sort_order,
  };
}

export function orderView(row: OrderRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    orderType: row.order_type,
    orderDate: row.order_date,
    issuingForum: row.issuing_forum,
    summary: row.summary,
    effectiveDate: row.effective_date,
    expiryDate: row.expiry_date,
    status: row.status,
    privileged: row.privileged,
    confidentiality: row.confidentiality,
  };
}

export function complianceView(row: ComplianceRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    orderId: row.order_id,
    obligation: row.obligation,
    responsibleRef: row.responsible_ref,
    dueDate: row.due_date,
    status: row.status,
    completionDate: row.completion_date,
    breachDate: row.breach_date,
    outcome: row.outcome,
    version: row.version,
  };
}

export function outcomeView(row: OutcomeRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    outcomeType: row.outcome_type,
    outcomeDate: row.outcome_date,
    forum: row.forum,
    summary: row.summary,
    disposition: row.disposition,
    amountAwardedMinor: row.amount_awarded_minor,
    currency: row.currency,
    costsAwardedMinor: row.costs_awarded_minor,
    appealable: row.appealable,
    appealDeadline: row.appeal_deadline,
    status: row.status,
    confidentiality: row.confidentiality,
  };
}

export function appealView(row: AppealRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    appealType: row.appeal_type,
    forum: row.forum,
    approvalStatus: row.approval_status,
    approvedBy: row.approved_by,
    deadline: row.deadline,
    filingStatus: row.filing_status,
    appealNumber: row.appeal_number,
    status: row.status,
    outcome: row.outcome,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function deadlineView(row: DeadlineRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    deadlineType: row.deadline_type,
    dueAt: row.due_at,
    status: row.status,
    waived: row.waived,
    completedAt: row.completed_at,
    version: row.version,
  };
}

export function costView(row: CostRow) {
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    costType: row.cost_type,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    approvalStatus: row.approval_status,
    recoverable: row.recoverable,
    taxed: row.taxed,
    version: row.version,
  };
}

export function noteView(row: NoteRow, canReadPrivileged: boolean) {
  const hide = row.privileged && !canReadPrivileged;
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    noteType: row.note_type,
    headline: row.headline,
    content: hide ? REDACTED : row.content,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
  };
}

export function relationshipView(row: RelationshipRow) {
  return {
    id: row.id,
    fromProceedingId: row.from_proceeding_id,
    toProceedingId: row.to_proceeding_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
  };
}
