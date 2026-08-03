import type {
  JournalTypeRow,
  JournalConfigRow,
  JournalReasonCodeRow,
  JournalRecommendationRow,
  JournalRecommendationLineRow,
  JournalDraftRow,
  JournalLineRow,
  JournalStatusHistoryRow,
  JournalNoteRow,
  JournalValidationRow,
  JournalValidationFindingRow,
  PostingRequestRow,
  PostingResultRow,
} from '@finapp/m21-journal';

/**
 * Response shapes for the journals API (m21). Persistence rows are snake_case; these map to camelCase DTOs. The tenant
 * is implicit (x-tenant-id + RLS FORCE), never re-exposed, and neither is `correlation_id`.
 *
 * MONEY IS INTEGER MINOR UNITS. Every `*_minor` field arrives from the repository as a STRING (`amount_minor::text`
 * etc.) and is emitted AS A STRING — never `Number()`/coerced to a float (ADR-007, CLAUDE.md money rule). Every
 * mutable view carries `version` for optimistic concurrency. Account/entity/period/currency refs are opaque m19 ids;
 * approval refs are opaque m22 ids — echoed as-is, never resolved.
 */

export function journalTypeView(row: JournalTypeRow) {
  return {
    id: row.id,
    code: row.code,
    versionNumber: row.version_number,
    name: row.name,
    kind: row.kind,
    status: row.status,
    requiresBalance: row.requires_balance,
    version: row.version,
  };
}
export function journalConfigView(row: JournalConfigRow) {
  return {
    id: row.id,
    scope: row.scope,
    versionNumber: row.version_number,
    name: row.name,
    status: row.status,
    requireBalanced: row.require_balanced,
    allowManualDraft: row.allow_manual_draft,
    maxLines: row.max_lines,
    version: row.version,
  };
}
export function reasonCodeView(row: JournalReasonCodeRow) {
  return {
    id: row.id,
    code: row.code,
    category: row.category,
    severity: row.severity,
    description: row.description,
    active: row.active,
    version: row.version,
  };
}
export function recommendationView(row: JournalRecommendationRow) {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    handoffRef: row.handoff_ref,
    entityRef: row.entity_ref,
    currencyRef: row.currency_ref,
    amountMinor: row.amount_minor,
    description: row.description,
    reasonCode: row.reason_code,
    confidenceBand: row.confidence_band,
    status: row.status,
    draftId: row.draft_id,
    version: row.version,
  };
}
export function recommendationLineView(row: JournalRecommendationLineRow) {
  return {
    id: row.id,
    recommendationId: row.recommendation_id,
    lineNo: row.line_no,
    accountRef: row.account_ref,
    direction: row.direction,
    amountMinor: row.amount_minor,
    currencyRef: row.currency_ref,
    description: row.description,
  };
}
export function draftView(row: JournalDraftRow) {
  return {
    id: row.id,
    journalTypeId: row.journal_type_id,
    entityRef: row.entity_ref,
    periodRef: row.period_ref,
    periodStatus: row.period_status,
    currencyRef: row.currency_ref,
    journalDate: row.journal_date,
    description: row.description,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    recommendationId: row.recommendation_id,
    reference: row.reference,
    totalDebitsMinor: row.total_debits_minor,
    totalCreditsMinor: row.total_credits_minor,
    isBalanced: row.is_balanced,
    lineCount: row.line_count,
    status: row.status,
    requestedBy: row.requested_by,
    version: row.version,
  };
}
export function lineView(row: JournalLineRow) {
  return {
    id: row.id,
    draftId: row.draft_id,
    lineNo: row.line_no,
    accountRef: row.account_ref,
    direction: row.direction,
    amountMinor: row.amount_minor,
    currencyRef: row.currency_ref,
    costCentreRef: row.cost_centre_ref,
    dimensionRef: row.dimension_ref,
    taxCodeRef: row.tax_code_ref,
    description: row.description,
    status: row.status,
    version: row.version,
  };
}
export function statusHistoryView(row: JournalStatusHistoryRow) {
  return {
    id: row.id,
    draftId: row.draft_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    reasonCode: row.reason_code,
  };
}
export function noteView(row: JournalNoteRow) {
  return { id: row.id, draftId: row.draft_id, noteType: row.note_type, content: row.content };
}
export function validationView(row: JournalValidationRow) {
  return {
    id: row.id,
    draftId: row.draft_id,
    isValid: row.is_valid,
    debitsMinor: row.debits_minor,
    creditsMinor: row.credits_minor,
    balanced: row.balanced,
    errorCount: row.error_count,
    warningCount: row.warning_count,
  };
}
export function findingView(row: JournalValidationFindingRow) {
  return {
    id: row.id,
    validationId: row.validation_id,
    draftId: row.draft_id,
    lineRef: row.line_ref,
    severity: row.severity,
    reasonCode: row.reason_code,
    detail: row.detail,
  };
}
export function postingRequestView(row: PostingRequestRow) {
  return {
    id: row.id,
    draftId: row.draft_id,
    status: row.status,
    approvalRef: row.approval_ref,
    approvedBy: row.approved_by,
    requestedBy: row.requested_by,
    periodStatus: row.period_status,
    amountMinor: row.amount_minor,
    externalSystem: row.external_system,
    version: row.version,
  };
}
export function postingResultView(row: PostingResultRow) {
  return {
    id: row.id,
    postingRequestId: row.posting_request_id,
    status: row.status,
    externalSystem: row.external_system,
    externalRef: row.external_ref,
    message: row.message,
    reasonCode: row.reason_code,
    version: row.version,
  };
}
