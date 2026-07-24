import type { DefinitionRow, VersionRow, InstanceRow, TaskRow, IncidentRow } from '@finapp/m06-workflow';

/**
 * Response shapes for the workflow API (m06). The persistence rows are snake_case and carry columns the wire
 * has no business seeing shaped as-is; these map to the camelCase DTOs the API contracts. Every view carries
 * `version` — a caller needs it for the optimistic-lock `expectedVersion` on the follow-up mutation. The
 * tenant is implicit in the request (x-tenant-id) and RLS, so `tenant_id` is not re-exposed here.
 */

export function definitionView(row: DefinitionRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
  };
}

export function versionView(row: VersionRow) {
  return {
    id: row.id,
    definitionId: row.definition_id,
    versionNumber: row.version_number,
    status: row.status,
    spec: row.spec,
    contentHash: row.content_hash,
    version: row.version,
  };
}

export function instanceView(row: InstanceRow) {
  return {
    id: row.id,
    definitionId: row.definition_id,
    versionId: row.version_id,
    businessKey: row.business_key,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    status: row.status,
    variables: row.variables,
    startedBy: row.started_by,
    version: row.version,
  };
}

export function taskView(row: TaskRow) {
  return {
    id: row.id,
    instanceId: row.instance_id,
    nodeKey: row.node_key,
    taskType: row.task_type,
    status: row.status,
    assigneeKind: row.assignee_kind,
    assigneeRef: row.assignee_ref,
    claimedBy: row.claimed_by,
    makerId: row.maker_id,
    version: row.version,
  };
}

export function incidentView(row: IncidentRow) {
  return {
    id: row.id,
    instanceId: row.instance_id,
    taskId: row.task_id,
    errorCode: row.error_code,
    status: row.status,
    retryCount: row.retry_count,
    version: row.version,
  };
}
