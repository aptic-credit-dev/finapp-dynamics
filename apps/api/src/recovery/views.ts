import type {
  SpecRow,
  RecoveryRow,
  PartyRow,
  InstrumentRow,
  StrategyRow,
  DemandRow,
  NegotiationRow,
  ArrangementRow,
  InstallmentRow,
  EnforcementActionRow,
  SecurityRow,
  AgentRow,
  AgentReportRow,
  ReceiptRow,
  WaiverRow,
  WriteoffRow,
  OutcomeRow,
  DeadlineRow,
  CostRow,
  NoteRow,
  RelationshipRow,
} from '@finapp/m17-recovery';

/**
 * Response shapes for the recovery API (m17). Persistence rows are snake_case; these map to camelCase DTOs. The
 * tenant is implicit (x-tenant-id + RLS), never re-exposed. Deliberate REDACTIONS (ADR-072): a recovery whose
 * confidentiality is not `standard` (or is privileged) exposes its summary/description and all amount references
 * only to a caller holding `recovery.confidential.read`; a party's contact reference only to the matching
 * contact-read permission; privileged notes are redacted unless the caller holds `recovery.privileged.read`;
 * negotiation-strategy rationale is redacted the same way. Every mutable view carries `version`.
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

export function recoveryView(row: RecoveryRow, canReadConfidential: boolean) {
  const hide = (row.confidentiality !== 'standard' || row.privileged) && !canReadConfidential;
  return {
    id: row.id,
    recoveryNumber: row.recovery_number,
    recoveryTypeCode: row.recovery_type_code,
    recoveryTypeVersion: row.recovery_type_version,
    source: row.source,
    sourceProceedingId: row.source_proceeding_id,
    sourceMatterId: row.source_matter_id,
    sourceReference: row.source_reference,
    originatingModule: row.originating_module,
    title: row.title,
    summary: redactIf(hide, row.summary),
    description: redactIf(hide, row.description),
    instrumentType: row.instrument_type,
    jurisdiction: row.jurisdiction,
    forum: row.forum,
    principalAmountMinor: hide ? null : row.principal_amount_minor,
    interestAmountMinor: hide ? null : row.interest_amount_minor,
    costAmountMinor: hide ? null : row.cost_amount_minor,
    recoverableAmountMinor: hide ? null : row.recoverable_amount_minor,
    recoveredAmountMinor: hide ? null : row.recovered_amount_minor,
    outstandingAmountMinor: hide ? null : row.outstanding_amount_minor,
    currency: row.currency,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
    recoveryRisk: row.recovery_risk,
    priority: row.priority,
    strategy: row.strategy,
    legalOwner: row.legal_owner,
    recoveryTeam: row.recovery_team,
    businessOwner: row.business_owner,
    externalAgentRef: row.external_agent_ref,
    workflowInstanceRef: row.workflow_instance_ref,
    slaPolicyCode: row.sla_policy_code,
    escalationRef: row.escalation_ref,
    status: row.status,
    enforcementStage: row.enforcement_stage,
    legalHold: row.legal_hold,
    sourceUpdateEmitted: row.source_update_emitted,
    writeOffRecommended: row.write_off_recommended,
    limitationAt: row.limitation_at,
    finalOutcome: row.final_outcome,
    residualNote: row.residual_note,
    referredAt: row.referred_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    reopenedAt: row.reopened_at,
    archivedAt: row.archived_at,
    version: row.version,
  };
}

export function partyView(row: PartyRow, canReadContact: boolean) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    partyRole: row.party_role,
    entityRef: row.entity_ref,
    displayLabel: row.display_label,
    liabilityBasis: row.liability_basis,
    liabilityAmountMinor: row.liability_amount_minor,
    contactRef: canReadContact ? row.contact_ref : row.contact_ref === null ? null : REDACTED,
    addressRef: row.address_ref,
    authority: row.authority,
    confidentiality: row.confidentiality,
    active: row.active,
    version: row.version,
  };
}

export function instrumentView(row: InstrumentRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    instrumentType: row.instrument_type,
    reference: row.reference,
    issuingForum: row.issuing_forum,
    issueDate: row.issue_date,
    maturityDate: row.maturity_date,
    faceAmountMinor: row.face_amount_minor,
    currency: row.currency,
    enforceable: row.enforceable,
    enforceabilityNote: row.enforceability_note,
    documentRef: row.document_ref,
    sourceProceedingId: row.source_proceeding_id,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function strategyView(row: StrategyRow, canReadPrivileged: boolean) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    strategy: row.strategy,
    rationale: canReadPrivileged ? row.rationale : row.rationale === null ? null : REDACTED,
    selectedBy: row.selected_by,
    ruleEvaluationId: row.rule_evaluation_id,
    ruleVersion: row.rule_version,
    confidentiality: row.confidentiality,
  };
}

export function demandView(row: DemandRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    demandType: row.demand_type,
    partyRef: row.party_ref,
    amountDemandedMinor: row.amount_demanded_minor,
    currency: row.currency,
    issuedDate: row.issued_date,
    responseDue: row.response_due,
    deliveryMethod: row.delivery_method,
    documentRef: row.document_ref,
    status: row.status,
    responseStatus: row.response_status,
    responseDate: row.response_date,
    responseSummary: row.response_summary,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function negotiationView(row: NegotiationRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    partyRef: row.party_ref,
    openedDate: row.opened_date,
    closedDate: row.closed_date,
    positionSummary: row.position_summary,
    counterPosition: row.counter_position,
    offeredAmountMinor: row.offered_amount_minor,
    currency: row.currency,
    status: row.status,
    outcome: row.outcome,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function arrangementView(row: ArrangementRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    arrangementType: row.arrangement_type,
    totalAmountMinor: row.total_amount_minor,
    currency: row.currency,
    installmentCount: row.installment_count,
    installmentAmountMinor: row.installment_amount_minor,
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    termsSummary: row.terms_summary,
    approvalStatus: row.approval_status,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    status: row.status,
    defaultReason: row.default_reason,
    documentRef: row.document_ref,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function installmentView(row: InstallmentRow) {
  return {
    id: row.id,
    arrangementId: row.arrangement_id,
    recoveryId: row.recovery_id,
    sequenceNumber: row.sequence_number,
    dueDate: row.due_date,
    expectedAmountMinor: row.expected_amount_minor,
    currency: row.currency,
    status: row.status,
    receiptRef: row.receipt_ref,
    paidDate: row.paid_date,
    note: row.note,
    version: row.version,
  };
}

export function enforcementActionView(row: EnforcementActionRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    actionType: row.action_type,
    forum: row.forum,
    reference: row.reference,
    initiatedDate: row.initiated_date,
    targetAssetRef: row.target_asset_ref,
    targetPartyRef: row.target_party_ref,
    expectedAmountMinor: row.expected_amount_minor,
    currency: row.currency,
    agentRef: row.agent_ref,
    status: row.status,
    outcome: row.outcome,
    completedDate: row.completed_date,
    documentRef: row.document_ref,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function securityView(row: SecurityRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    securityType: row.security_type,
    description: row.description,
    assetRef: row.asset_ref,
    registrationReference: row.registration_reference,
    chargePriority: row.charge_priority,
    estimatedValueMinor: row.estimated_value_minor,
    forcedSaleValueMinor: row.forced_sale_value_minor,
    currency: row.currency,
    valuationDate: row.valuation_date,
    valuationRef: row.valuation_ref,
    status: row.status,
    realizedAmountMinor: row.realized_amount_minor,
    realizedDate: row.realized_date,
    documentRef: row.document_ref,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function agentView(row: AgentRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    agentRef: row.agent_ref,
    agentType: row.agent_type,
    engagementReference: row.engagement_reference,
    instructionScope: row.instruction_scope,
    feeArrangementReference: row.fee_arrangement_reference,
    reportingFrequency: row.reporting_frequency,
    nextReportDue: row.next_report_due,
    internalOwner: row.internal_owner,
    status: row.status,
    performanceNote: row.performance_note,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function agentReportView(row: AgentReportRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    agentId: row.agent_id,
    reportingPeriod: row.reporting_period,
    statusSummary: row.status_summary,
    actionTaken: row.action_taken,
    nextAction: row.next_action,
    amountCollectedMinor: row.amount_collected_minor,
    currency: row.currency,
    reportDate: row.report_date,
    documentRef: row.document_ref,
    confidentiality: row.confidentiality,
  };
}

export function receiptView(row: ReceiptRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    receiptType: row.receipt_type,
    externalReference: row.external_reference,
    amountMinor: row.amount_minor,
    currency: row.currency,
    receivedDate: row.received_date,
    partyRef: row.party_ref,
    arrangementRef: row.arrangement_ref,
    enforcementActionRef: row.enforcement_action_ref,
    securityRef: row.security_ref,
    financeReference: row.finance_reference,
    documentRef: row.document_ref,
    confidentiality: row.confidentiality,
  };
}

export function waiverView(row: WaiverRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    waiverType: row.waiver_type,
    amountMinor: row.amount_minor,
    currency: row.currency,
    reason: row.reason,
    grantedBy: row.granted_by,
    authority: row.authority,
    grantedDate: row.granted_date,
    documentRef: row.document_ref,
    confidentiality: row.confidentiality,
  };
}

export function writeoffView(row: WriteoffRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    reasonCode: row.reason_code,
    amountMinor: row.amount_minor,
    currency: row.currency,
    narrative: row.narrative,
    recommendedBy: row.recommended_by,
    recommendedDate: row.recommended_date,
    approvalStatus: row.approval_status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    financeReference: row.finance_reference,
    documentRef: row.document_ref,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function outcomeView(row: OutcomeRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    outcomeType: row.outcome_type,
    outcomeDate: row.outcome_date,
    summary: row.summary,
    recoveredAmountMinor: row.recovered_amount_minor,
    waivedAmountMinor: row.waived_amount_minor,
    writtenOffAmountMinor: row.written_off_amount_minor,
    outstandingAmountMinor: row.outstanding_amount_minor,
    currency: row.currency,
    documentRef: row.document_ref,
    confidentiality: row.confidentiality,
  };
}

export function deadlineView(row: DeadlineRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    deadlineType: row.deadline_type,
    source: row.source,
    authority: row.authority,
    startAt: row.start_at,
    dueAt: row.due_at,
    status: row.status,
    waived: row.waived,
    completedAt: row.completed_at,
    relatedDemand: row.related_demand,
    relatedArrangement: row.related_arrangement,
    relatedEnforcement: row.related_enforcement,
    version: row.version,
  };
}

export function costView(row: CostRow) {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    costType: row.cost_type,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    incurredDate: row.incurred_date,
    agentReference: row.agent_reference,
    invoiceReference: row.invoice_reference,
    approvalStatus: row.approval_status,
    paymentReference: row.payment_reference,
    recoverable: row.recoverable,
    documentRef: row.document_ref,
    version: row.version,
  };
}

export function noteView(row: NoteRow, canReadPrivileged: boolean) {
  const hide = row.privileged && !canReadPrivileged;
  return {
    id: row.id,
    recoveryId: row.recovery_id,
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
    fromRecoveryId: row.from_recovery_id,
    toRecoveryId: row.to_recovery_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
  };
}
