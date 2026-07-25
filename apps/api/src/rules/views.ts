import type {
  RuleSetRow,
  RuleSetVersionRow,
  RuleEvaluationRow,
  RuleTestCaseRow,
  RuleSetHistoryRow,
} from '@finapp/m07-rules';

/**
 * Response shapes for the rules API (m07). Persistence rows are snake_case; these map to the camelCase DTOs
 * the API contracts. Every mutable view carries `version` — a caller needs it for the optimistic-lock
 * `expectedVersion` on the follow-up mutation. The tenant is implicit in the request (x-tenant-id) and RLS,
 * so `tenant_id` is never re-exposed. Evaluation views expose the input HASH and the redacted outcome only —
 * never raw inputs (ADR-035).
 */

export function ruleSetView(row: RuleSetRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    scope: row.scope,
    status: row.status,
    version: row.version,
  };
}

export function versionView(row: RuleSetVersionRow) {
  return {
    id: row.id,
    ruleSetId: row.rule_set_id,
    versionNumber: row.version_number,
    status: row.status,
    spec: row.spec,
    contentHash: row.content_hash,
    notes: row.notes,
    version: row.version,
  };
}

export function evaluationView(row: RuleEvaluationRow) {
  return {
    id: row.id,
    ruleSetId: row.rule_set_id,
    versionId: row.version_id,
    versionNumber: row.version_number,
    status: row.status,
    inputHash: row.input_hash,
    engineVersion: row.engine_version,
    outcome: row.outcome,
    reasonCodes: row.reason_codes,
    mode: row.mode,
    evaluatedAt: row.evaluated_at,
  };
}

export function testCaseView(row: RuleTestCaseRow) {
  return {
    id: row.id,
    ruleSetId: row.rule_set_id,
    name: row.name,
    description: row.description,
    input: row.input,
    expected: row.expected,
    enabled: row.enabled,
    version: row.version,
  };
}

export function historyView(row: RuleSetHistoryRow) {
  return {
    id: row.id,
    ruleSetId: row.rule_set_id,
    versionId: row.version_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    action: row.action,
    reason: row.reason,
    at: row.at,
  };
}
