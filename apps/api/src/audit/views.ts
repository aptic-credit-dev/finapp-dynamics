import type { AuditEventRow } from '@finapp/m03-audit';

/**
 * Response shape for an audit event. Audit rows are evidence for AUTHORISED viewers, so the investigative
 * fields are exposed — including the tamper-evidence hashes, so a reviewer can independently confirm the
 * chain. Snapshots are already redacted at write time; nothing sensitive is stored to leak here.
 */
export function auditEventView(row: AuditEventRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    seq: Number(row.seq),
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorAccountId: row.actor_account_id,
    impersonatorId: row.impersonator_id,
    module: row.module,
    action: row.action,
    category: row.category,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    outcome: row.outcome,
    reasonCode: row.reason_code,
    summary: row.summary,
    beforeSnapshot: row.before_snapshot,
    afterSnapshot: row.after_snapshot,
    changedFields: row.changed_fields,
    metadata: row.metadata,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    sessionId: row.session_id,
    sourceSystem: row.source_system,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    integrityVersion: row.integrity_version,
    previousEventHash: row.previous_event_hash,
    eventHash: row.event_hash,
  };
}
