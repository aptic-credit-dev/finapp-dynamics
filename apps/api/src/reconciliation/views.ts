import type {
  BankAccountRow,
  MatchingRulesetRow,
  MatchingRuleRow,
  RulesetHistoryRow,
  StatementImportRow,
  StatementLineRow,
  LedgerImportRow,
  LedgerEntryRow,
  RunRow,
  StatusHistoryRow,
  MatchRow,
  MatchLineRow,
  MatchCandidateRow,
  ExceptionRow,
  ManualDecisionRow,
  RunSummaryRow,
  NoteRow,
  ImportErrorRow,
} from '@finapp/m15-recon';

/**
 * Response shapes for the bank-reconciliation API (m15). Persistence rows are snake_case; these map to camelCase
 * DTOs. The tenant is implicit (x-tenant-id + RLS FORCE), never re-exposed, and neither is `correlation_id`.
 *
 * MONEY IS INTEGER MINOR UNITS. Every `*_minor` field arrives from the repository as a STRING (`amount_minor::text`
 * etc.) and is emitted AS A STRING — never `Number()`/coerced to a float (ADR-007, CLAUDE.md money rule). The
 * text-similarity `description_score` (0..1, NOT money) is likewise carried as a string for exact fidelity. There is
 * no privileged/confidential text here beyond the already-masked `account_ref_masked`; the raw account number is
 * never stored nor echoed. Every mutable view carries `version` for optimistic concurrency.
 */

export function bankAccountView(row: BankAccountRow) {
  return {
    id: row.id,
    entityRef: row.entity_ref,
    currencyRef: row.currency_ref,
    bankName: row.bank_name,
    accountLabel: row.account_label,
    accountRefMasked: row.account_ref_masked,
    branch: row.branch,
    status: row.status,
    version: row.version,
  };
}

export function rulesetView(row: MatchingRulesetRow) {
  return {
    id: row.id,
    code: row.code,
    versionNumber: row.version_number,
    name: row.name,
    status: row.status,
    dateWindowDays: row.date_window_days,
    // Amount tolerance in INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountToleranceMinor: row.amount_tolerance_minor,
    requireOppositeDirection: row.require_opposite_direction,
    contentHash: row.content_hash,
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    version: row.version,
  };
}

export function ruleView(row: MatchingRuleRow) {
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

export function rulesetHistoryView(row: RulesetHistoryRow) {
  return {
    id: row.id,
    rulesetId: row.ruleset_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    byUser: row.by_user,
  };
}

export function statementImportView(row: StatementImportRow) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
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

export function statementLineView(row: StatementLineRow) {
  return {
    id: row.id,
    importId: row.import_id,
    bankAccountId: row.bank_account_id,
    lineNo: row.line_no,
    txnDate: row.txn_date,
    valueDate: row.value_date,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountMinor: row.amount_minor,
    direction: row.direction,
    reference: row.reference,
    description: row.description,
    counterpartyRef: row.counterparty_ref,
    status: row.status,
    version: row.version,
  };
}

export function ledgerImportView(row: LedgerImportRow) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    sourceFormat: row.source_format,
    fileHash: row.file_hash,
    documentRef: row.document_ref,
    status: row.status,
    entryCount: row.entry_count,
    idempotencyKey: row.idempotency_key,
    version: row.version,
  };
}

export function ledgerEntryView(row: LedgerEntryRow) {
  return {
    id: row.id,
    ledgerImportId: row.ledger_import_id,
    bankAccountId: row.bank_account_id,
    entryNo: row.entry_no,
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

export function runView(row: RunRow) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
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
    version: row.version,
  };
}

export function statusHistoryView(row: StatusHistoryRow) {
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

export function matchView(row: MatchRow) {
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

export function matchLineView(row: MatchLineRow) {
  return {
    id: row.id,
    matchId: row.match_id,
    side: row.side,
    statementLineId: row.statement_line_id,
    ledgerEntryId: row.ledger_entry_id,
    // INTEGER MINOR UNITS — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    amountMinor: row.amount_minor,
  };
}

export function candidateView(row: MatchCandidateRow) {
  return {
    id: row.id,
    runId: row.run_id,
    statementLineId: row.statement_line_id,
    ledgerEntryId: row.ledger_entry_id,
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

export function exceptionView(row: ExceptionRow) {
  return {
    id: row.id,
    runId: row.run_id,
    statementLineId: row.statement_line_id,
    ledgerEntryId: row.ledger_entry_id,
    exceptionType: row.exception_type,
    status: row.status,
    ageDays: row.age_days,
    reason: row.reason,
    required: row.required,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    version: row.version,
  };
}

export function manualDecisionView(row: ManualDecisionRow) {
  return {
    id: row.id,
    runId: row.run_id,
    decisionType: row.decision_type,
    matchId: row.match_id,
    statementLineId: row.statement_line_id,
    ledgerEntryId: row.ledger_entry_id,
    exceptionId: row.exception_id,
    byUser: row.by_user,
    reason: row.reason,
  };
}

export function runSummaryView(row: RunSummaryRow) {
  return {
    id: row.id,
    runId: row.run_id,
    matchedCount: row.matched_count,
    unmatchedCount: row.unmatched_count,
    exceptionCount: row.exception_count,
    // INTEGER MINOR UNITS — kept as STRINGS end-to-end, never parsed to a float (ADR-007).
    matchedAmountMinor: row.matched_amount_minor,
    unmatchedAmountMinor: row.unmatched_amount_minor,
    colourStatus: row.colour_status,
  };
}

export function noteView(row: NoteRow) {
  return {
    id: row.id,
    runId: row.run_id,
    noteType: row.note_type,
    content: row.content,
    byUser: row.by_user,
  };
}

export function importErrorView(row: ImportErrorRow) {
  return {
    id: row.id,
    importId: row.import_id,
    importKind: row.import_kind,
    lineNo: row.line_no,
    errorCode: row.error_code,
    detail: row.detail,
  };
}
