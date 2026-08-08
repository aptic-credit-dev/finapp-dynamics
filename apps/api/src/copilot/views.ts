import type {
  ConfigRow,
  SessionRow,
  QueryRow,
  ResponseRow,
  CitationRow,
  FeedbackRow,
} from '@finapp/m28-executive-ai';

/**
 * Response shapes for the Executive-Copilot API (m28), under `/api/v1/copilot`. Persistence rows are snake_case; these
 * map to camelCase DTOs. The tenant is implicit (x-tenant-id + RLS), never re-exposed, and neither is `correlation_id`.
 *
 * The copilot carries NO business content: the full question/answer/comment text is NEVER stored (only opaque m09
 * references are), and a citation is a REFERENCE only (opaque record/document id) — never copied restricted content.
 * Views therefore emit ids, refs, statuses, intent/source classes, reason codes, confidence (integer basis points) and
 * counts only. Every mutable view carries `version` for optimistic concurrency.
 */

export function configView(row: ConfigRow) {
  return {
    id: row.id,
    scope: row.scope,
    versionNumber: row.version_number,
    status: row.status,
    readOnly: row.read_only,
    citationsRequired: row.citations_required,
    requireHumanReviewForExport: row.require_human_review_for_export,
    minConfidenceBps: row.min_confidence_bps,
    maxSources: row.max_sources,
    version: row.version,
  };
}

export function sessionView(row: SessionRow) {
  return {
    id: row.id,
    scopeLevel: row.scope_level,
    subjectLabel: row.subject_label,
    classification: row.classification,
    status: row.status,
    queryCount: row.query_count,
    version: row.version,
  };
}

export function queryView(row: QueryRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    intentClass: row.intent_class,
    scopeLevel: row.scope_level,
    classification: row.classification,
    questionRef: row.question_ref,
    readOnly: row.read_only,
    status: row.status,
    confidenceBps: row.confidence_bps,
    sourceCount: row.source_count,
    refusalReasonCode: row.refusal_reason_code,
    aiRequestRef: row.ai_request_ref,
    version: row.version,
  };
}

export function responseView(row: ResponseRow) {
  return {
    id: row.id,
    queryId: row.query_id,
    answerRef: row.answer_ref,
    aiOutputRef: row.ai_output_ref,
    status: row.status,
    confidenceBps: row.confidence_bps,
    citationCount: row.citation_count,
    citationsRequired: row.citations_required,
    reviewRequired: row.review_required,
    reasonCode: row.reason_code,
    version: row.version,
  };
}

export function citationView(row: CitationRow) {
  return {
    id: row.id,
    responseId: row.response_id,
    sourceType: row.source_type,
    sourceModule: row.source_module,
    recordRef: row.record_ref,
    documentRef: row.document_ref,
    documentVersion: row.document_version,
    location: row.location,
    confidenceBps: row.confidence_bps,
    entitlementResult: row.entitlement_result,
  };
}

export function feedbackView(row: FeedbackRow) {
  return {
    id: row.id,
    responseId: row.response_id,
    rating: row.rating,
    reasonCode: row.reason_code,
    commentRef: row.comment_ref,
  };
}
