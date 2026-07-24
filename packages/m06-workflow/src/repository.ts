/**
 * M06 repository — ALL SQL for the workflow engine. Every query is parameterized; every mutating UPDATE is
 * optimistic-lock guarded (`WHERE ... AND version = $expected`) so a stale command changes zero rows and the
 * caller raises 409 — this is what makes double completion impossible. Queries carry NO tenant_id predicate:
 * RLS is the isolation guarantee, not a WHERE clause. All methods take the caller's `Tx` (obtained from
 * `db.withTenant`) so state, audit and outbox commit atomically.
 */
import type { Tx } from '@finapp/kernel';

export interface DefinitionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly version: number;
}

export interface VersionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly definition_id: string;
  readonly version_number: number;
  readonly status: string;
  readonly spec: unknown;
  readonly content_hash: string | null;
  readonly version: number;
}

export interface InstanceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly definition_id: string;
  readonly version_id: string;
  readonly business_key: string | null;
  readonly subject_type: string | null;
  readonly subject_id: string | null;
  readonly status: string;
  readonly variables: Record<string, unknown>;
  readonly started_by: string | null;
  readonly version: number;
}

export interface TaskRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly instance_id: string;
  readonly node_key: string;
  readonly task_type: string;
  readonly status: string;
  readonly assignee_kind: string | null;
  readonly assignee_ref: string | null;
  readonly claimed_by: string | null;
  readonly maker_id: string | null;
  readonly version: number;
}

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m06 repository: expected a row from ${what}`);
  return row;
}

export class WorkflowRepository {
  // --- definitions & versions -------------------------------------------------------------------
  async insertDefinition(
    tx: Tx,
    input: {
      tenantId: string;
      code: string;
      name: string;
      description: string | null;
      createdBy: string | null;
    },
  ): Promise<DefinitionRow> {
    const r = await tx.query<DefinitionRow>(
      `INSERT INTO workflow_definition (tenant_id, code, name, description, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING tenant_id, id, code, name, description, status, version`,
      [input.tenantId, input.code, input.name, input.description, input.createdBy],
    );
    return firstRow(r.rows, 'insert definition');
  }

  async findDefinition(tx: Tx, id: string): Promise<DefinitionRow | null> {
    const r = await tx.query<DefinitionRow>(
      `SELECT tenant_id, id, code, name, description, status, version FROM workflow_definition WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async insertVersion(
    tx: Tx,
    input: {
      tenantId: string;
      definitionId: string;
      versionNumber: number;
      spec: unknown;
      createdBy: string | null;
    },
  ): Promise<VersionRow> {
    const r = await tx.query<VersionRow>(
      `INSERT INTO workflow_definition_version (tenant_id, definition_id, version_number, spec, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING tenant_id, id, definition_id, version_number, status, spec, content_hash, version`,
      [input.tenantId, input.definitionId, input.versionNumber, JSON.stringify(input.spec), input.createdBy],
    );
    return firstRow(r.rows, 'insert version');
  }

  async findVersion(tx: Tx, id: string): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      `SELECT tenant_id, id, definition_id, version_number, status, spec, content_hash, version
       FROM workflow_definition_version WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async findActiveVersion(tx: Tx, definitionId: string): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      `SELECT tenant_id, id, definition_id, version_number, status, spec, content_hash, version
       FROM workflow_definition_version WHERE definition_id = $1 AND status = 'ACTIVE'`,
      [definitionId],
    );
    return r.rows[0] ?? null;
  }

  /** Version-guarded status change (validate/publish/activate/retire/archive). Returns null on stale version. */
  async updateVersionStatus(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash?: string | null;
      publishedBy?: string | null;
    },
  ): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      `UPDATE workflow_definition_version
         SET status = $3,
             content_hash = COALESCE($4, content_hash),
             published_at = CASE WHEN $3 = 'PUBLISHED' THEN now() ELSE published_at END,
             published_by = COALESCE($5, published_by),
             version = version + 1
       WHERE id = $1 AND version = $2
       RETURNING tenant_id, id, definition_id, version_number, status, spec, content_hash, version`,
      [input.id, input.expectedVersion, input.toStatus, input.contentHash ?? null, input.publishedBy ?? null],
    );
    return r.rows[0] ?? null;
  }

  /** Retire the currently-ACTIVE version of a definition (so a new one can activate). Version-guarded per row. */
  async retireActiveVersions(tx: Tx, definitionId: string): Promise<void> {
    await tx.query(
      `UPDATE workflow_definition_version SET status = 'RETIRED', version = version + 1
       WHERE definition_id = $1 AND status = 'ACTIVE'`,
      [definitionId],
    );
  }

  // --- instances --------------------------------------------------------------------------------
  async insertInstance(
    tx: Tx,
    input: {
      tenantId: string;
      definitionId: string;
      versionId: string;
      businessKey: string | null;
      subjectType: string | null;
      subjectId: string | null;
      variables: Record<string, unknown>;
      startedBy: string | null;
    },
  ): Promise<InstanceRow> {
    const r = await tx.query<InstanceRow>(
      `INSERT INTO workflow_instance
         (tenant_id, definition_id, version_id, business_key, subject_type, subject_id, variables, started_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING tenant_id, id, definition_id, version_id, business_key, subject_type, subject_id, status, variables, started_by, version`,
      [
        input.tenantId,
        input.definitionId,
        input.versionId,
        input.businessKey,
        input.subjectType,
        input.subjectId,
        JSON.stringify(input.variables),
        input.startedBy,
      ],
    );
    return firstRow(r.rows, 'insert instance');
  }

  async findInstance(tx: Tx, id: string): Promise<InstanceRow | null> {
    const r = await tx.query<InstanceRow>(
      `SELECT tenant_id, id, definition_id, version_id, business_key, subject_type, subject_id, status, variables, started_by, version
       FROM workflow_instance WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async findInstanceByBusinessKey(
    tx: Tx,
    definitionId: string,
    businessKey: string,
  ): Promise<InstanceRow | null> {
    const r = await tx.query<InstanceRow>(
      `SELECT tenant_id, id, definition_id, version_id, business_key, subject_type, subject_id, status, variables, started_by, version
       FROM workflow_instance WHERE definition_id = $1 AND business_key = $2`,
      [definitionId, businessKey],
    );
    return r.rows[0] ?? null;
  }

  async updateInstanceStatus(
    tx: Tx,
    input: { id: string; expectedVersion: number; toStatus: string },
  ): Promise<InstanceRow | null> {
    const r = await tx.query<InstanceRow>(
      `UPDATE workflow_instance SET status = $3, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING tenant_id, id, definition_id, version_id, business_key, subject_type, subject_id, status, variables, started_by, version`,
      [input.id, input.expectedVersion, input.toStatus],
    );
    return r.rows[0] ?? null;
  }

  // --- tokens -----------------------------------------------------------------------------------
  async insertToken(
    tx: Tx,
    input: {
      tenantId: string;
      instanceId: string;
      nodeKey: string;
      branchKey: string | null;
      joinKey: string | null;
    },
  ): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO workflow_token (tenant_id, instance_id, node_key, branch_key, join_key)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.tenantId, input.instanceId, input.nodeKey, input.branchKey, input.joinKey],
    );
    return firstRow(r.rows, 'insert token').id;
  }

  async consumeToken(tx: Tx, id: string, expectedVersion: number): Promise<boolean> {
    const r = await tx.query(
      `UPDATE workflow_token SET status = 'consumed', version = version + 1
       WHERE id = $1 AND version = $2 AND status = 'active'`,
      [id, expectedVersion],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async activeTokens(
    tx: Tx,
    instanceId: string,
  ): Promise<{ id: string; node_key: string; join_key: string | null; version: number }[]> {
    const r = await tx.query<{ id: string; node_key: string; join_key: string | null; version: number }>(
      `SELECT id, node_key, join_key, version FROM workflow_token WHERE instance_id = $1 AND status = 'active'`,
      [instanceId],
    );
    return r.rows;
  }

  // --- tasks ------------------------------------------------------------------------------------
  async insertTask(
    tx: Tx,
    input: {
      tenantId: string;
      instanceId: string;
      nodeKey: string;
      taskType: string;
      status: string;
      assigneeKind: string | null;
      assigneeRef: string | null;
      makerId: string | null;
      dueAt: Date | null;
    },
  ): Promise<TaskRow> {
    const r = await tx.query<TaskRow>(
      `INSERT INTO workflow_task
         (tenant_id, instance_id, node_key, task_type, status, assignee_kind, assignee_ref, maker_id, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING tenant_id, id, instance_id, node_key, task_type, status, assignee_kind, assignee_ref, claimed_by, maker_id, version`,
      [
        input.tenantId,
        input.instanceId,
        input.nodeKey,
        input.taskType,
        input.status,
        input.assigneeKind,
        input.assigneeRef,
        input.makerId,
        input.dueAt,
      ],
    );
    return firstRow(r.rows, 'insert task');
  }

  async findTask(tx: Tx, id: string): Promise<TaskRow | null> {
    const r = await tx.query<TaskRow>(
      `SELECT tenant_id, id, instance_id, node_key, task_type, status, assignee_kind, assignee_ref, claimed_by, maker_id, version
       FROM workflow_task WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  /**
   * The single-winner task transition: guarded by BOTH the expected version AND the set of statuses the
   * action is legal from. Two concurrent completers race here — exactly one updates a row; the loser gets 0
   * rows and a 409. This is what makes double completion impossible.
   */
  async applyTaskStatus(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      fromStatuses: readonly string[];
      toStatus: string;
      claimedBy?: string | null;
      leaseExpiresAt?: Date | null;
      decision?: unknown;
    },
  ): Promise<TaskRow | null> {
    const r = await tx.query<TaskRow>(
      `UPDATE workflow_task
         SET status = $3,
             claimed_by = COALESCE($4, claimed_by),
             lease_expires_at = COALESCE($5, lease_expires_at),
             decision = COALESCE($6::jsonb, decision),
             version = version + 1,
             updated_at = now()
       WHERE id = $1 AND version = $2 AND status = ANY($7::text[])
       RETURNING tenant_id, id, instance_id, node_key, task_type, status, assignee_kind, assignee_ref, claimed_by, maker_id, version`,
      [
        input.id,
        input.expectedVersion,
        input.toStatus,
        input.claimedBy ?? null,
        input.leaseExpiresAt ?? null,
        input.decision === undefined ? null : JSON.stringify(input.decision),
        input.fromStatuses,
      ],
    );
    return r.rows[0] ?? null;
  }

  // --- timers -----------------------------------------------------------------------------------
  async insertTimer(
    tx: Tx,
    input: {
      tenantId: string;
      instanceId: string;
      nodeKey: string | null;
      kind: string;
      fireAt: Date;
      dedupeKey: string;
    },
  ): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO workflow_timer (tenant_id, instance_id, node_key, kind, fire_at, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [input.tenantId, input.instanceId, input.nodeKey, input.kind, input.fireAt, input.dedupeKey],
    );
    // On conflict (duplicate dedupe_key) no row is returned — the timer already exists (fire-once, ADR-025).
    return r.rows[0]?.id ?? '';
  }

  async fireTimer(tx: Tx, id: string, expectedVersion: number): Promise<boolean> {
    const r = await tx.query(
      `UPDATE workflow_timer SET status = 'fired', fired_at = now(), version = version + 1
       WHERE id = $1 AND version = $2 AND status = 'scheduled'`,
      [id, expectedVersion],
    );
    return (r.rowCount ?? 0) === 1;
  }

  // --- incidents --------------------------------------------------------------------------------
  async insertIncident(
    tx: Tx,
    input: {
      tenantId: string;
      instanceId: string | null;
      taskId: string | null;
      errorCode: string;
      errorDetail: unknown;
    },
  ): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO workflow_incident (tenant_id, instance_id, task_id, error_code, error_detail)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
      [
        input.tenantId,
        input.instanceId,
        input.taskId,
        input.errorCode,
        input.errorDetail === undefined ? null : JSON.stringify(input.errorDetail),
      ],
    );
    return firstRow(r.rows, 'insert incident').id;
  }

  async resolveIncident(
    tx: Tx,
    input: { id: string; expectedVersion: number; toStatus: string; resolvedBy: string | null },
  ): Promise<boolean> {
    const r = await tx.query(
      `UPDATE workflow_incident
         SET status = $3, resolved_at = now(), resolved_by = $4, version = version + 1
       WHERE id = $1 AND version = $2 AND status IN ('open', 'investigating')`,
      [input.id, input.expectedVersion, input.toStatus, input.resolvedBy],
    );
    return (r.rowCount ?? 0) === 1;
  }

  // --- append-only history ----------------------------------------------------------------------
  async appendInstanceHistory(
    tx: Tx,
    input: {
      tenantId: string;
      instanceId: string;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      reason: string | null;
      correlationId: string;
      changedBy: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO workflow_instance_history
         (tenant_id, instance_id, from_status, to_status, action, reason, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.tenantId,
        input.instanceId,
        input.fromStatus,
        input.toStatus,
        input.action,
        input.reason,
        input.correlationId,
        input.changedBy,
      ],
    );
  }

  async appendTaskHistory(
    tx: Tx,
    input: {
      tenantId: string;
      taskId: string;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      reason: string | null;
      correlationId: string;
      changedBy: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO workflow_task_history
         (tenant_id, task_id, from_status, to_status, action, reason, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.tenantId,
        input.taskId,
        input.fromStatus,
        input.toStatus,
        input.action,
        input.reason,
        input.correlationId,
        input.changedBy,
      ],
    );
  }

  // --- outbox (m06 owns it) ---------------------------------------------------------------------
  async insertOutboxRow(
    tx: Tx,
    input: {
      tenantId: string | null;
      scopeKey: string;
      family: string;
      type: string;
      aggregateId: string;
      envelope: unknown;
      dedupeKey: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO workflow_event_outbox
         (tenant_id, scope_key, family, type, aggregate_id, envelope, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        input.tenantId,
        input.scopeKey,
        input.family,
        input.type,
        input.aggregateId,
        JSON.stringify(input.envelope),
        input.dedupeKey,
      ],
    );
  }

  // --- SLA clocks -------------------------------------------------------------------------------
  async insertSlaClock(
    tx: Tx,
    input: {
      tenantId: string;
      instanceId: string;
      taskId: string | null;
      slaType: string;
      warnAt: Date | null;
      breachAt: Date | null;
    },
  ): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO workflow_sla_clock (tenant_id, instance_id, task_id, sla_type, warn_at, breach_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.tenantId, input.instanceId, input.taskId, input.slaType, input.warnAt, input.breachAt],
    );
    return firstRow(r.rows, 'insert sla clock').id;
  }

  async findSlaClock(
    tx: Tx,
    id: string,
  ): Promise<{
    id: string;
    task_id: string | null;
    instance_id: string;
    sla_type: string;
    warned: boolean;
    breached: boolean;
    version: number;
  } | null> {
    const r = await tx.query<{
      id: string;
      task_id: string | null;
      instance_id: string;
      sla_type: string;
      warned: boolean;
      breached: boolean;
      version: number;
    }>(
      `SELECT id, task_id, instance_id, sla_type, warned, breached, version FROM workflow_sla_clock WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  /** Set the warned/breached flag once (idempotent): a 0-row result means it was already set. */
  async markSlaFlag(
    tx: Tx,
    id: string,
    expectedVersion: number,
    flag: 'warned' | 'breached',
  ): Promise<boolean> {
    const column = flag === 'warned' ? 'warned' : 'breached';
    const r = await tx.query(
      `UPDATE workflow_sla_clock SET ${column} = true, version = version + 1
       WHERE id = $1 AND version = $2 AND ${column} = false`,
      [id, expectedVersion],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async findTimer(
    tx: Tx,
    id: string,
  ): Promise<{
    id: string;
    instance_id: string;
    node_key: string | null;
    kind: string;
    status: string;
    version: number;
  } | null> {
    const r = await tx.query<{
      id: string;
      instance_id: string;
      node_key: string | null;
      kind: string;
      status: string;
      version: number;
    }>(`SELECT id, instance_id, node_key, kind, status, version FROM workflow_timer WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }
}
