/**
 * M33 repository — ALL SQL for the integration foundation across its 9 connector_* tables. Every query is parameterized;
 * every mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries
 * carry NO tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Run-attempt/
 * review/history + the idempotency ledger are append-only. There is NO secret VALUE column — connection_secret holds an
 * opaque `secretref:` pointer only. No float.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m33 repository: expected a row from ${what}`);
  return row;
}

export interface ConnectorDefinitionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly connector_key: string;
  readonly name: string;
  readonly vendor: string | null;
  readonly category: string;
  readonly auth_kind: string;
  readonly state: string;
  readonly validation_passed: boolean;
  readonly content_hash: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ConnectorCapabilityRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly connector_id: string;
  readonly capability_key: string;
  readonly name: string;
  readonly direction: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
}
export interface ConnectionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly connector_id: string;
  readonly scope: string;
  readonly connection_key: string;
  readonly name: string;
  readonly config: unknown;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ConnectionSecretRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly connection_id: string;
  readonly purpose: string;
  readonly secret_ref: string;
  readonly status: string;
  readonly version: number;
}
export interface ConnectorRunRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly connection_id: string;
  readonly capability_id: string;
  readonly direction: string;
  readonly status: string;
  readonly row_count: number | null;
  readonly reason_code: string | null;
  readonly runtime_kind: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly kind: string;
  readonly requested_by: string;
  readonly decided_by: string | null;
  readonly reason_code: string | null;
}

export class IntegrationRepository {
  // ---- connector definition ----
  async insertConnector(
    tx: Tx,
    c: {
      tenantId: string;
      scope: string;
      connectorKey: string;
      name: string;
      vendor: string | null;
      category: string;
      authKind: string;
      description: string | null;
      contentHash: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConnectorDefinitionRow> {
    const { rows } = await tx.query<ConnectorDefinitionRow>(
      `INSERT INTO connector_definition (tenant_id, scope, connector_key, name, vendor, category, auth_kind, description, content_hash, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
      [
        c.tenantId,
        c.scope,
        c.connectorKey,
        c.name,
        c.vendor,
        c.category,
        c.authKind,
        c.description,
        c.contentHash,
        c.idempotencyKey,
        c.correlationId,
        c.by,
      ],
    );
    return firstRow(rows, 'insertConnector');
  }
  async findConnectorByIdempotencyKey(tx: Tx, key: string): Promise<ConnectorDefinitionRow | null> {
    const { rows } = await tx.query<ConnectorDefinitionRow>(
      `SELECT * FROM connector_definition WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getConnector(tx: Tx, id: string): Promise<ConnectorDefinitionRow | null> {
    const { rows } = await tx.query<ConnectorDefinitionRow>(
      `SELECT * FROM connector_definition WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async getPublishedConnectorByKey(
    tx: Tx,
    scope: string,
    connectorKey: string,
  ): Promise<ConnectorDefinitionRow | null> {
    const { rows } = await tx.query<ConnectorDefinitionRow>(
      `SELECT * FROM connector_definition WHERE scope=$1 AND connector_key=$2 AND state='published' LIMIT 1`,
      [scope, connectorKey],
    );
    return rows[0] ?? null;
  }
  async updateConnectorState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; by: string | null },
  ): Promise<ConnectorDefinitionRow | null> {
    const { rows } = await tx.query<ConnectorDefinitionRow>(
      `UPDATE connector_definition SET state=$3, validation_passed=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING *`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.by],
    );
    return rows[0] ?? null;
  }
  async listConnectors(tx: Tx, limit: number, offset: number): Promise<ConnectorDefinitionRow[]> {
    const { rows } = await tx.query<ConnectorDefinitionRow>(
      `SELECT * FROM connector_definition ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- capability ----
  async insertCapability(
    tx: Tx,
    c: {
      tenantId: string;
      connectorId: string;
      capabilityKey: string;
      name: string;
      direction: string;
      kind: string;
      inputSchema: unknown;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConnectorCapabilityRow> {
    const { rows } = await tx.query<ConnectorCapabilityRow>(
      `INSERT INTO connector_capability (tenant_id, connector_id, capability_key, name, direction, kind, input_schema, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$10) RETURNING tenant_id, id, connector_id, capability_key, name, direction, kind, status, version`,
      [
        c.tenantId,
        c.connectorId,
        c.capabilityKey,
        c.name,
        c.direction,
        c.kind,
        JSON.stringify(c.inputSchema ?? {}),
        c.idempotencyKey,
        c.correlationId,
        c.by,
      ],
    );
    return firstRow(rows, 'insertCapability');
  }
  async listCapabilities(tx: Tx, connectorId: string): Promise<ConnectorCapabilityRow[]> {
    const { rows } = await tx.query<ConnectorCapabilityRow>(
      `SELECT tenant_id, id, connector_id, capability_key, name, direction, kind, status, version FROM connector_capability WHERE connector_id=$1 ORDER BY capability_key`,
      [connectorId],
    );
    return rows;
  }
  /** Resolve a capability the m31 catalog references: available iff it belongs to a PUBLISHED connector + active capability. */
  async findAvailableCapability(
    tx: Tx,
    connectorKey: string,
    capabilityKey: string,
  ): Promise<ConnectorCapabilityRow | null> {
    const { rows } = await tx.query<ConnectorCapabilityRow>(
      `SELECT cap.tenant_id, cap.id, cap.connector_id, cap.capability_key, cap.name, cap.direction, cap.kind, cap.status, cap.version
       FROM connector_capability cap JOIN connector_definition def ON def.id = cap.connector_id
       WHERE def.connector_key=$1 AND def.state='published' AND cap.capability_key=$2 AND cap.status='active' LIMIT 1`,
      [connectorKey, capabilityKey],
    );
    return rows[0] ?? null;
  }
  async getCapability(tx: Tx, id: string): Promise<ConnectorCapabilityRow | null> {
    const { rows } = await tx.query<ConnectorCapabilityRow>(
      `SELECT tenant_id, id, connector_id, capability_key, name, direction, kind, status, version FROM connector_capability WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }

  // ---- connection ----
  async insertConnection(
    tx: Tx,
    c: {
      tenantId: string;
      connectorId: string;
      scope: string;
      connectionKey: string;
      name: string;
      config: unknown;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConnectionRow> {
    const { rows } = await tx.query<ConnectionRow>(
      `INSERT INTO connection (tenant_id, connector_id, scope, connection_key, name, config, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$9) RETURNING *`,
      [
        c.tenantId,
        c.connectorId,
        c.scope,
        c.connectionKey,
        c.name,
        JSON.stringify(c.config ?? {}),
        c.idempotencyKey,
        c.correlationId,
        c.by,
      ],
    );
    return firstRow(rows, 'insertConnection');
  }
  async findConnectionByIdempotencyKey(tx: Tx, key: string): Promise<ConnectionRow | null> {
    const { rows } = await tx.query<ConnectionRow>(
      `SELECT * FROM connection WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getConnection(tx: Tx, id: string): Promise<ConnectionRow | null> {
    const { rows } = await tx.query<ConnectionRow>(`SELECT * FROM connection WHERE id=$1`, [id]);
    return rows[0] ?? null;
  }
  async updateConnection(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { name: string; config: unknown; status: string; by: string | null },
  ): Promise<ConnectionRow | null> {
    const { rows } = await tx.query<ConnectionRow>(
      `UPDATE connection SET name=$3, config=$4::jsonb, status=$5, version=version+1, updated_at=now(), updated_by=$6 WHERE id=$1 AND version=$2 RETURNING *`,
      [id, expectedVersion, patch.name, JSON.stringify(patch.config ?? {}), patch.status, patch.by],
    );
    return rows[0] ?? null;
  }

  // ---- connection secret (opaque secretref only) ----
  async insertConnectionSecret(
    tx: Tx,
    s: {
      tenantId: string;
      connectionId: string;
      purpose: string;
      secretRef: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConnectionSecretRow> {
    const { rows } = await tx.query<ConnectionSecretRow>(
      `INSERT INTO connection_secret (tenant_id, connection_id, purpose, secret_ref, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING tenant_id, id, connection_id, purpose, secret_ref, status, version`,
      [s.tenantId, s.connectionId, s.purpose, s.secretRef, s.idempotencyKey, s.correlationId, s.by],
    );
    return firstRow(rows, 'insertConnectionSecret');
  }
  async listConnectionSecrets(tx: Tx, connectionId: string): Promise<ConnectionSecretRow[]> {
    const { rows } = await tx.query<ConnectionSecretRow>(
      `SELECT tenant_id, id, connection_id, purpose, secret_ref, status, version FROM connection_secret WHERE connection_id=$1 ORDER BY purpose`,
      [connectionId],
    );
    return rows;
  }

  // ---- run ----
  async insertRun(
    tx: Tx,
    r: {
      tenantId: string;
      connectionId: string;
      capabilityId: string;
      direction: string;
      runtimeKind: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConnectorRunRow> {
    const { rows } = await tx.query<ConnectorRunRow>(
      `INSERT INTO connector_run (tenant_id, connection_id, capability_id, direction, runtime_kind, status, started_at, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'running',now(),$6,$7,$8,$8) RETURNING tenant_id, id, connection_id, capability_id, direction, status, row_count, reason_code, runtime_kind, version, correlation_id`,
      [
        r.tenantId,
        r.connectionId,
        r.capabilityId,
        r.direction,
        r.runtimeKind,
        r.idempotencyKey,
        r.correlationId,
        r.by,
      ],
    );
    return firstRow(rows, 'insertRun');
  }
  async findRunByIdempotencyKey(tx: Tx, key: string): Promise<ConnectorRunRow | null> {
    const { rows } = await tx.query<ConnectorRunRow>(
      `SELECT tenant_id, id, connection_id, capability_id, direction, status, row_count, reason_code, runtime_kind, version, correlation_id FROM connector_run WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async completeRun(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; rowCount: number; reasonCode: string; by: string | null },
  ): Promise<ConnectorRunRow | null> {
    const { rows } = await tx.query<ConnectorRunRow>(
      `UPDATE connector_run SET status=$3, row_count=$4, reason_code=$5, finished_at=now(), version=version+1, updated_at=now(), updated_by=$6 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, connection_id, capability_id, direction, status, row_count, reason_code, runtime_kind, version, correlation_id`,
      [id, expectedVersion, patch.status, patch.rowCount, patch.reasonCode, patch.by],
    );
    return rows[0] ?? null;
  }
  async insertRunAttempt(
    tx: Tx,
    a: {
      tenantId: string;
      runId: string;
      attemptNo: number;
      status: string;
      reasonCode: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO connector_run_attempt (tenant_id, run_id, attempt_no, status, reason_code, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [a.tenantId, a.runId, a.attemptNo, a.status, a.reasonCode, a.correlationId, a.by],
    );
  }

  // ---- review (append-only maker-checker) ----
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      targetType: string;
      targetId: string;
      kind: string;
      requestedBy: string;
      decidedBy: string | null;
      reason: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<ReviewRow> {
    const { rows } = await tx.query<ReviewRow>(
      `INSERT INTO connector_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, reason, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING tenant_id, id, target_type, target_id, kind, requested_by, decided_by, reason_code`,
      [
        r.tenantId,
        r.targetType,
        r.targetId,
        r.kind,
        r.requestedBy,
        r.decidedBy,
        r.reason,
        r.reasonCode,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReview');
  }
  async findOpenReviewRequest(tx: Tx, targetType: string, targetId: string): Promise<ReviewRow | null> {
    const { rows } = await tx.query<ReviewRow>(
      `SELECT tenant_id, id, target_type, target_id, kind, requested_by, decided_by, reason_code FROM connector_review WHERE target_type=$1 AND target_id=$2 AND kind='requested' ORDER BY created_at DESC LIMIT 1`,
      [targetType, targetId],
    );
    return rows[0] ?? null;
  }

  // ---- history + idempotency (append-only) ----
  async insertHistory(
    tx: Tx,
    h: {
      tenantId: string;
      targetType: string;
      targetId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO connector_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        h.tenantId,
        h.targetType,
        h.targetId,
        h.fromStatus,
        h.toStatus,
        h.reason,
        h.reasonCode,
        h.by,
        h.correlationId,
      ],
    );
  }
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      targetType: string | null;
      targetId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO connector_idempotency (tenant_id, idempotency_key, target_type, target_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [i.tenantId, i.idempotencyKey, i.targetType, i.targetId, i.correlationId, i.by],
    );
  }
}
