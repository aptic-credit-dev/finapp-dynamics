/**
 * M23 repository — ALL SQL for the finance-integration foundation across its 8 tables. Every query is parameterized;
 * every mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`) so a
 * stale command changes zero rows and the caller reacts (single-winner / stale-version rejection). Queries carry NO
 * tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Destination/execution
 * history, attempts, external references and the idempotency ledger are append-only (INSERT + SELECT). Money
 * (`amount_minor`) is INTEGER MINOR UNITS (bigint), PROJECTED `::text` and carried as a STRING — OPAQUE evidence that
 * M23 NEVER transforms (ADR-007). M23 owns only its 8 tables; m21/m22 posting-request/approval refs are OPAQUE ids
 * (no FK); the destination secret is a REFERENCE only. It reaches no external system.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m23 repository: expected a row from ${what}`);
  return row;
}

export interface DestinationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly system_code: string;
  readonly scope: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly destination_type: string;
  readonly status: string;
  readonly allowlisted: boolean;
  readonly secret_reference: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ConfigRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly status: string;
  readonly max_attempts: number;
  readonly base_delay_ms: number;
  readonly backoff: number;
  readonly enforce_allowlist: boolean;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ExecutionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly destination_id: string | null;
  readonly posting_request_ref: string | null;
  readonly approval_ref: string | null;
  readonly subject_type: string;
  /** INTEGER MINOR UNITS — opaque evidence, carried as a STRING, never transformed (ADR-007). */
  readonly amount_minor: string;
  readonly currency_ref: string | null;
  readonly status: string;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly last_reason_code: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface HistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface AttemptRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly execution_id: string;
  readonly attempt_no: number;
  readonly result: string;
  readonly reason_code: string | null;
  readonly external_ref: string | null;
  readonly message: string | null;
  readonly framework_only: boolean;
  readonly correlation_id: string;
}
export interface ExternalReferenceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly execution_id: string;
  readonly external_system: string | null;
  readonly external_ref: string;
  readonly ref_type: string;
  readonly correlation_id: string;
}
export interface IdempotencyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly idempotency_key: string;
  readonly purpose: string;
  readonly execution_id: string | null;
  readonly correlation_id: string;
}

const DEST_COLS = `tenant_id, id, system_code, scope, version_number, name, destination_type, status, allowlisted, secret_reference, version, correlation_id`;
const CONFIG_COLS = `tenant_id, id, scope, version_number, name, status, max_attempts, base_delay_ms, backoff, enforce_allowlist, idempotency_key, version, correlation_id`;
const EXEC_COLS = `tenant_id, id, destination_id, posting_request_ref, approval_ref, subject_type, amount_minor::text AS amount_minor, currency_ref, status, attempt_count, max_attempts, last_reason_code, idempotency_key, version, correlation_id`;
const HIST_COLS = `tenant_id, id, from_status, to_status, reason, reason_code, by_user, correlation_id`;
const ATTEMPT_COLS = `tenant_id, id, execution_id, attempt_no, result, reason_code, external_ref, message, framework_only, correlation_id`;
const EXTREF_COLS = `tenant_id, id, execution_id, external_system, external_ref, ref_type, correlation_id`;
const IDEM_COLS = `tenant_id, id, idempotency_key, purpose, execution_id, correlation_id`;

export class IntegrationRepository {
  // --- destination ----------------------------------------------------------------------------
  async insertDestination(
    tx: Tx,
    i: {
      tenantId: string;
      systemCode: string;
      scope: string;
      name: string | null;
      destinationType: string;
      allowlisted: boolean;
      secretReference: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DestinationRow> {
    const r = await tx.query<DestinationRow>(
      `INSERT INTO integration_destination (tenant_id, system_code, scope, name, destination_type, allowlisted, secret_reference, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${DEST_COLS}`,
      [
        i.tenantId,
        i.systemCode,
        i.scope,
        i.name,
        i.destinationType,
        i.allowlisted,
        i.secretReference,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert destination');
  }
  async findDestination(tx: Tx, id: string): Promise<DestinationRow | null> {
    const r = await tx.query<DestinationRow>(`SELECT ${DEST_COLS} FROM integration_destination WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findEnabledDestination(tx: Tx, systemCode: string, scope: string): Promise<DestinationRow | null> {
    const r = await tx.query<DestinationRow>(
      `SELECT ${DEST_COLS} FROM integration_destination WHERE system_code=$1 AND scope=$2 AND status='enabled'`,
      [systemCode, scope],
    );
    return r.rows[0] ?? null;
  }
  async setDestinationStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<DestinationRow | null> {
    const r = await tx.query<DestinationRow>(
      `UPDATE integration_destination SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${DEST_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listDestinations(tx: Tx): Promise<DestinationRow[]> {
    const r = await tx.query<DestinationRow>(
      `SELECT ${DEST_COLS} FROM integration_destination ORDER BY system_code, scope, version_number`,
    );
    return r.rows;
  }
  async insertDestinationHistory(
    tx: Tx,
    i: {
      tenantId: string;
      destinationId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO integration_destination_history (tenant_id, destination_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.destinationId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }

  // --- config ---------------------------------------------------------------------------------
  async insertConfig(
    tx: Tx,
    i: {
      tenantId: string;
      scope: string;
      name: string | null;
      maxAttempts: number;
      baseDelayMs: number;
      backoff: number;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConfigRow> {
    const r = await tx.query<ConfigRow>(
      `INSERT INTO integration_config (tenant_id, scope, name, max_attempts, base_delay_ms, backoff, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${CONFIG_COLS}`,
      [
        i.tenantId,
        i.scope,
        i.name,
        i.maxAttempts,
        i.baseDelayMs,
        i.backoff,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert config');
  }
  async findConfig(tx: Tx, id: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(`SELECT ${CONFIG_COLS} FROM integration_config WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findConfigByIdempotencyKey(tx: Tx, key: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM integration_config WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async setConfigStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `UPDATE integration_config SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CONFIG_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listConfigs(tx: Tx): Promise<ConfigRow[]> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM integration_config ORDER BY scope, version_number`,
    );
    return r.rows;
  }

  // --- execution ------------------------------------------------------------------------------
  async insertExecution(
    tx: Tx,
    i: {
      tenantId: string;
      destinationId: string | null;
      postingRequestRef: string | null;
      approvalRef: string | null;
      subjectType: string;
      amountMinor: number;
      currencyRef: string | null;
      maxAttempts: number;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ExecutionRow> {
    const r = await tx.query<ExecutionRow>(
      `INSERT INTO integration_execution (tenant_id, destination_id, posting_request_ref, approval_ref, subject_type, amount_minor, currency_ref, max_attempts, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING ${EXEC_COLS}`,
      [
        i.tenantId,
        i.destinationId,
        i.postingRequestRef,
        i.approvalRef,
        i.subjectType,
        i.amountMinor,
        i.currencyRef,
        i.maxAttempts,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert execution');
  }
  async findExecution(tx: Tx, id: string): Promise<ExecutionRow | null> {
    const r = await tx.query<ExecutionRow>(`SELECT ${EXEC_COLS} FROM integration_execution WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findExecutionByIdempotencyKey(tx: Tx, key: string): Promise<ExecutionRow | null> {
    const r = await tx.query<ExecutionRow>(
      `SELECT ${EXEC_COLS} FROM integration_execution WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async updateExecution(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      attemptCount?: number | null;
      lastReasonCode?: string | null;
      by: string | null;
    },
  ): Promise<ExecutionRow | null> {
    const r = await tx.query<ExecutionRow>(
      `UPDATE integration_execution SET status=$3, attempt_count=COALESCE($4, attempt_count), last_reason_code=COALESCE($5, last_reason_code), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${EXEC_COLS}`,
      [i.id, i.expectedVersion, i.status, i.attemptCount ?? null, i.lastReasonCode ?? null, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listExecutions(tx: Tx, status?: string): Promise<ExecutionRow[]> {
    if (status !== undefined) {
      const r = await tx.query<ExecutionRow>(
        `SELECT ${EXEC_COLS} FROM integration_execution WHERE status=$1 ORDER BY created_at DESC`,
        [status],
      );
      return r.rows;
    }
    const r = await tx.query<ExecutionRow>(
      `SELECT ${EXEC_COLS} FROM integration_execution ORDER BY created_at DESC`,
    );
    return r.rows;
  }
  async insertExecutionHistory(
    tx: Tx,
    i: {
      tenantId: string;
      executionId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO integration_execution_history (tenant_id, execution_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.executionId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async listExecutionHistory(tx: Tx, executionId: string): Promise<HistoryRow[]> {
    const r = await tx.query<HistoryRow>(
      `SELECT ${HIST_COLS} FROM integration_execution_history WHERE execution_id=$1 ORDER BY created_at`,
      [executionId],
    );
    return r.rows;
  }

  // --- attempt (append-only) ------------------------------------------------------------------
  async insertAttempt(
    tx: Tx,
    i: {
      tenantId: string;
      executionId: string;
      attemptNo: number;
      result: string;
      reasonCode: string | null;
      externalRef: string | null;
      message: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<AttemptRow> {
    const r = await tx.query<AttemptRow>(
      `INSERT INTO integration_attempt (tenant_id, execution_id, attempt_no, result, reason_code, external_ref, message, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${ATTEMPT_COLS}`,
      [
        i.tenantId,
        i.executionId,
        i.attemptNo,
        i.result,
        i.reasonCode,
        i.externalRef,
        i.message,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert attempt');
  }
  async listAttempts(tx: Tx, executionId: string): Promise<AttemptRow[]> {
    const r = await tx.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLS} FROM integration_attempt WHERE execution_id=$1 ORDER BY attempt_no`,
      [executionId],
    );
    return r.rows;
  }

  // --- external reference (append-only) -------------------------------------------------------
  async insertExternalReference(
    tx: Tx,
    i: {
      tenantId: string;
      executionId: string;
      externalSystem: string | null;
      externalRef: string;
      refType: string;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ExternalReferenceRow> {
    const r = await tx.query<ExternalReferenceRow>(
      `INSERT INTO external_reference (tenant_id, execution_id, external_system, external_ref, ref_type, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${EXTREF_COLS}`,
      [i.tenantId, i.executionId, i.externalSystem, i.externalRef, i.refType, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert external reference');
  }
  async listExternalReferences(tx: Tx, executionId: string): Promise<ExternalReferenceRow[]> {
    const r = await tx.query<ExternalReferenceRow>(
      `SELECT ${EXTREF_COLS} FROM external_reference WHERE execution_id=$1 ORDER BY created_at`,
      [executionId],
    );
    return r.rows;
  }

  // --- idempotency (append-only; unique per key) ----------------------------------------------
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      purpose: string;
      executionId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<IdempotencyRow> {
    const r = await tx.query<IdempotencyRow>(
      `INSERT INTO integration_idempotency (tenant_id, idempotency_key, purpose, execution_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${IDEM_COLS}`,
      [i.tenantId, i.idempotencyKey, i.purpose, i.executionId, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert idempotency');
  }
  async findIdempotency(tx: Tx, key: string): Promise<IdempotencyRow | null> {
    const r = await tx.query<IdempotencyRow>(
      `SELECT ${IDEM_COLS} FROM integration_idempotency WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
}
