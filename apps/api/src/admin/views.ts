import type { OperationRow, SavedViewRow, PreferenceRow, OperationHistoryRow } from '@finapp/m04-admin';

/**
 * Response shapes for the admin console API (m04). M04 owns only its console state (operations, saved views,
 * preferences); tenant/identity/role/audit views are the OWNING modules' shapes, echoed through. The tenant is
 * implicit (x-tenant-id + RLS FORCE), never re-exposed, and neither is `correlation_id`. Payloads carry safe
 * identifiers, states and reason codes only — never secrets, tokens, contacts or confidential narratives.
 */
export function operationView(row: OperationRow) {
  return {
    id: row.id,
    operationType: row.operation_type,
    scope: row.scope,
    targetType: row.target_type,
    targetRef: row.target_ref,
    summary: row.summary,
    status: row.status,
    requestedBy: row.requested_by,
    reasonCode: row.reason_code,
    version: row.version,
  };
}
export function operationHistoryView(row: OperationHistoryRow) {
  return {
    id: row.id,
    operationId: row.operation_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reasonCode: row.reason_code,
  };
}
export function savedViewView(row: SavedViewRow) {
  return { id: row.id, area: row.area, name: row.name, filter: row.filter, version: row.version };
}
export function preferenceView(row: PreferenceRow) {
  return { id: row.id, prefKey: row.pref_key, prefValue: row.pref_value, version: row.version };
}
