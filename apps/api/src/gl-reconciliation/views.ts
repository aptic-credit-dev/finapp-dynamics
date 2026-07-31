import type {
  GlAccountRow,
  GlRulesetRow,
  GlRuleRow,
  GlRulesetHistoryRow,
  GlImportRow,
  GlImportErrorRow,
  GlBalanceRow,
  GlLineRow,
  GlSourceImportRow,
  GlSourceLineRow,
  GlRunRow,
  GlRunStatusHistoryRow,
  GlRunBalanceRow,
  GlMatchRow,
  GlMatchLineRow,
  GlMatchCandidateRow,
  GlReconcilingItemRow,
  GlExceptionRow,
  GlManualDecisionRow,
  GlCertificationRow,
  GlCertificationHistoryRow,
  GlRecommendationRow,
  GlRunSummaryRow,
  GlNoteRow,
} from '@finapp/m20-glrecon';

/**
 * Response shapes for the GL-reconciliation API (m20). Persistence rows are snake_case; these map to camelCase DTOs.
 * The tenant is implicit (x-tenant-id + RLS FORCE), never re-exposed, and neither is `correlation_id`.
 *
 * MONEY IS INTEGER MINOR UNITS. Every `*_minor` field arrives from the repository as a STRING (`amount_minor::text`
 * etc.) and is emitted AS A STRING — never `Number()`/coerced to a float (ADR-007, CLAUDE.md money rule). The
 * text-similarity `description_score` (0..1, NOT money) is likewise carried as a string. Every mutable view carries
 * `version` for optimistic concurrency. GL account numbers are never stored raw nor echoed (only opaque refs).
 */

export function accountView(row: GlAccountRow) {
  return {
    id: row.id,
    glAccountRef: row.gl_account_ref,
    currencyRef: row.currency_ref,
    sourceSystem: row.source_system,
    code: row.code,
    name: row.name,
    normalSide: row.normal_side,
    status: row.status,
    version: row.version,
  };
}

export function rulesetView(row: GlRulesetRow) {
  return {
    id: row.id,
    code: row.code,
    versionNumber: row.version_number,
    name: row.name,
    status: row.status,
    dateWindowDays: row.date_window_days,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountToleranceMinor: row.amount_tolerance_minor,
    requireOppositeDirection: row.require_opposite_direction,
    contentHash: row.content_hash,
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    version: row.version,
  };
}

export function ruleView(row: GlRuleRow) {
  return {
    id: row.id,
    rulesetId: row.ruleset_id,
    ruleCode: row.rule_code,
    ruleKind: row.rule_kind,
    weight: row.weight,
    priority: row.priority,
    version: row.version,
  };
}

export function rulesetHistoryView(row: GlRulesetHistoryRow) {
  return {
    id: row.id,
    rulesetId: row.ruleset_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    byUser: row.by_user,
  };
}

export function importView(row: GlImportRow) {
  return {
    id: row.id,
    glAccountId: row.gl_account_id,
    sourceFormat: row.source_format,
    fileHash: row.file_hash,
    fileName: row.file_name,
    documentRef: row.document_ref,
    status: row.status,
    lineCount: row.line_count,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    idempotencyKey: row.idempotency_key,
    version: row.version,
  };
}

export function importErrorView(row: GlImportErrorRow) {
  return {
    id: row.id,
    importId: row.import_id,
    importKind: row.import_kind,
    lineNo: row.line_no,
    errorCode: row.error_code,
    detail: row.detail,
  };
}

export function balanceView(row: GlBalanceRow) {
  return {
    id: row.id,
    glAccountId: row.gl_account_id,
    importId: row.import_id,
    currencyRef: row.currency_ref,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    // INTEGER MINOR UNITS — kept as STRINGS end-to-end, never parsed to a float (ADR-007).
    openingBalanceMinor: row.opening_balance_minor,
    debitsMinor: row.debits_minor,
    creditsMinor: row.credits_minor,
    closingBalanceMinor: row.closing_balance_minor,
    status: row.status,
    version: row.version,
  };
}

export function lineView(row: GlLineRow) {
  return {
    id: row.id,
    importId: row.import_id,
    glAccountId: row.gl_account_id,
    lineNo: row.line_no,
    txnDate: row.txn_date,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountMinor: row.amount_minor,
    direction: row.direction,
    reference: row.reference,
    description: row.description,
    sourceRef: row.source_ref,
    status: row.status,
    version: row.version,
  };
}

export function sourceImportView(row: GlSourceImportRow) {
  return {
    id: row.id,
    glAccountId: row.gl_account_id,
    sourceSystem: row.source_system,
    sourceFormat: row.source_format,
    fileHash: row.file_hash,
    documentRef: row.document_ref,
    status: row.status,
    entryCount: row.entry_count,
    idempotencyKey: row.idempotency_key,
    version: row.version,
  };
}

export function sourceLineView(row: GlSourceLineRow) {
  return {
    id: row.id,
    sourceImportId: row.source_import_id,
    glAccountId: row.gl_account_id,
    lineNo: row.line_no,
    entryDate: row.entry_date,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountMinor: row.amount_minor,
    direction: row.direction,
    reference: row.reference,
    description: row.description,
    sourceRef: row.source_ref,
    status: row.status,
    version: row.version,
  };
}

export function runView(row: GlRunRow) {
  return {
    id: row.id,
    glAccountId: row.gl_account_id,
    rulesetId: row.ruleset_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    // INTEGER MINOR UNITS — kept as STRINGS end-to-end, never parsed to a float (ADR-007).
    openingBalanceMinor: row.opening_balance_minor,
    closingBalanceMinor: row.closing_balance_minor,
    status: row.status,
    matchedCount: row.matched_count,
    unmatchedCount: row.unmatched_count,
    exceptionCount: row.exception_count,
    itemCount: row.item_count,
    version: row.version,
  };
}

export function statusHistoryView(row: GlRunStatusHistoryRow) {
  return {
    id: row.id,
    runId: row.run_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    reasonCode: row.reason_code,
    byUser: row.by_user,
  };
}

export function runBalanceView(row: GlRunBalanceRow) {
  return {
    id: row.id,
    runId: row.run_id,
    // INTEGER MINOR UNITS — kept as STRINGS end-to-end, never parsed to a float (ADR-007).
    openingMinor: row.opening_minor,
    debitsMinor: row.debits_minor,
    creditsMinor: row.credits_minor,
    calculatedClosingMinor: row.calculated_closing_minor,
    sourceClosingMinor: row.source_closing_minor,
    varianceMinor: row.variance_minor,
    balanced: row.balanced,
  };
}

export function matchView(row: GlMatchRow) {
  return {
    id: row.id,
    runId: row.run_id,
    matchType: row.match_type,
    status: row.status,
    confidenceBand: row.confidence_band,
    colourStatus: row.colour_status,
    score: row.score,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountVarianceMinor: row.amount_variance_minor,
    matchedBy: row.matched_by,
    rulesetId: row.ruleset_id,
    rulesetVersion: row.ruleset_version,
    idempotencyKey: row.idempotency_key,
    version: row.version,
  };
}

export function matchLineView(row: GlMatchLineRow) {
  return {
    id: row.id,
    matchId: row.match_id,
    side: row.side,
    glLineId: row.gl_line_id,
    sourceLineId: row.source_line_id,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountMinor: row.amount_minor,
  };
}

export function candidateView(row: GlMatchCandidateRow) {
  return {
    id: row.id,
    runId: row.run_id,
    glLineId: row.gl_line_id,
    sourceLineId: row.source_line_id,
    score: row.score,
    confidenceBand: row.confidence_band,
    colourStatus: row.colour_status,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountVarianceMinor: row.amount_variance_minor,
    dateVarianceDays: row.date_variance_days,
    referenceMatch: row.reference_match,
    // Text-similarity ratio 0..1 (NOT money) — carried as a STRING for exact fidelity.
    descriptionScore: row.description_score,
    directionCompatible: row.direction_compatible,
    reasonCodes: row.reason_codes,
    ruleCodes: row.rule_codes,
    rulesetId: row.ruleset_id,
    rulesetVersion: row.ruleset_version,
  };
}

export function reconcilingItemView(row: GlReconcilingItemRow) {
  return {
    id: row.id,
    runId: row.run_id,
    itemType: row.item_type,
    glLineId: row.gl_line_id,
    sourceLineId: row.source_line_id,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountMinor: row.amount_minor,
    direction: row.direction,
    status: row.status,
    ageDays: row.age_days,
    reason: row.reason,
    clearedBy: row.cleared_by,
    clearedAt: row.cleared_at,
    version: row.version,
  };
}

export function exceptionView(row: GlExceptionRow) {
  return {
    id: row.id,
    runId: row.run_id,
    glLineId: row.gl_line_id,
    sourceLineId: row.source_line_id,
    exceptionType: row.exception_type,
    status: row.status,
    assignedTo: row.assigned_to,
    ageDays: row.age_days,
    reason: row.reason,
    required: row.required,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    version: row.version,
  };
}

export function manualDecisionView(row: GlManualDecisionRow) {
  return {
    id: row.id,
    runId: row.run_id,
    decisionType: row.decision_type,
    matchId: row.match_id,
    glLineId: row.gl_line_id,
    sourceLineId: row.source_line_id,
    exceptionId: row.exception_id,
    itemId: row.item_id,
    byUser: row.by_user,
    reason: row.reason,
  };
}

export function certificationView(row: GlCertificationRow) {
  return {
    id: row.id,
    runId: row.run_id,
    glAccountId: row.gl_account_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currencyRef: row.currency_ref,
    // INTEGER MINOR UNITS — kept as STRINGS end-to-end, never parsed to a float (ADR-007).
    calculatedBalanceMinor: row.calculated_balance_minor,
    sourceBalanceMinor: row.source_balance_minor,
    varianceMinor: row.variance_minor,
    unresolvedExceptionCount: row.unresolved_exception_count,
    openItemCount: row.open_item_count,
    status: row.status,
    isOverride: row.is_override,
    overrideReason: row.override_reason,
    certifiedBy: row.certified_by,
    certifiedAt: row.certified_at,
    version: row.version,
  };
}

export function certificationHistoryView(row: GlCertificationHistoryRow) {
  return {
    id: row.id,
    certificationId: row.certification_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    isOverride: row.is_override,
    byUser: row.by_user,
  };
}

export function recommendationView(row: GlRecommendationRow) {
  return {
    id: row.id,
    runId: row.run_id,
    exceptionId: row.exception_id,
    reconcilingItemId: row.reconciling_item_id,
    debitAccountRef: row.debit_account_ref,
    creditAccountRef: row.credit_account_ref,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountMinor: row.amount_minor,
    currencyRef: row.currency_ref,
    description: row.description,
    reasonCode: row.reason_code,
    confidenceBand: row.confidence_band,
    status: row.status,
    // DRAFT ONLY — m20 never posts or approves a journal.
    isDraft: row.is_draft,
    handoffRef: row.handoff_ref,
    version: row.version,
  };
}

export function runSummaryView(row: GlRunSummaryRow) {
  return {
    id: row.id,
    runId: row.run_id,
    matchedCount: row.matched_count,
    unmatchedCount: row.unmatched_count,
    exceptionCount: row.exception_count,
    itemCount: row.item_count,
    // INTEGER MINOR UNITS — kept as STRINGS end-to-end, never parsed to a float (ADR-007).
    matchedAmountMinor: row.matched_amount_minor,
    unmatchedAmountMinor: row.unmatched_amount_minor,
    balanceVarianceMinor: row.balance_variance_minor,
    balanced: row.balanced,
    colourStatus: row.colour_status,
  };
}

export function noteView(row: GlNoteRow) {
  return {
    id: row.id,
    runId: row.run_id,
    noteType: row.note_type,
    content: row.content,
    byUser: row.by_user,
  };
}
