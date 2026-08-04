/**
 * M04 repository — ALL SQL for the FOUR M04-owned admin-console tables (saved views, preferences, operation request +
 * append-only history). Every query is parameterized; every mutating UPDATE on a mutable aggregate is optimistic-lock
 * guarded (`WHERE id=$1 AND version=$expected`) so a stale command changes zero rows (single-winner / stale-version
 * rejection). Queries carry NO tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's
 * `Tx`. `admin_operation_history` is append-only. M04 owns ONLY these four tables — it reads/writes NO other module's
 * tables (tenant/identity/role/audit/workflow/rules/notification state is reached through those modules' public
 * services). `target_ref` is an OPAQUE id in the module the operation delegates to (no FK).
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m04 repository: expected a row from ${what}`);
  return row;
}

export interface SavedViewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly owner_ref: string;
  readonly area: string;
  readonly name: string;
  readonly filter: unknown;
  readonly version: number;
  readonly correlation_id: string;
}
export interface PreferenceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly owner_ref: string;
  readonly pref_key: string;
  readonly pref_value: unknown;
  readonly version: number;
  readonly correlation_id: string;
}
export interface OperationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly operation_type: string;
  readonly scope: string;
  readonly target_type: string | null;
  readonly target_ref: string | null;
  readonly summary: string | null;
  readonly status: string;
  readonly requested_by: string | null;
  readonly reason_code: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface OperationHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly operation_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

const VIEW_COLS = `tenant_id, id, owner_ref, area, name, filter, version, correlation_id`;
const PREF_COLS = `tenant_id, id, owner_ref, pref_key, pref_value, version, correlation_id`;
const OP_COLS = `tenant_id, id, operation_type, scope, target_type, target_ref, summary, status, requested_by, reason_code, idempotency_key, version, correlation_id`;
const OPH_COLS = `tenant_id, id, operation_id, from_status, to_status, reason, reason_code, by_user, correlation_id`;

export class AdminRepository {
  // --- saved view -----------------------------------------------------------------------------
  async insertSavedView(
    tx: Tx,
    i: {
      tenantId: string;
      ownerRef: string;
      area: string;
      name: string;
      filter: unknown;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SavedViewRow> {
    const r = await tx.query<SavedViewRow>(
      `INSERT INTO admin_saved_view (tenant_id, owner_ref, area, name, filter, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$7) RETURNING ${VIEW_COLS}`,
      [i.tenantId, i.ownerRef, i.area, i.name, JSON.stringify(i.filter ?? {}), i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert saved view');
  }
  async updateSavedView(
    tx: Tx,
    i: { id: string; expectedVersion: number; name: string; filter: unknown; by: string | null },
  ): Promise<SavedViewRow | null> {
    const r = await tx.query<SavedViewRow>(
      `UPDATE admin_saved_view SET name=$3, filter=$4::jsonb, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${VIEW_COLS}`,
      [i.id, i.expectedVersion, i.name, JSON.stringify(i.filter ?? {}), i.by],
    );
    return r.rows[0] ?? null;
  }
  async listSavedViews(tx: Tx, ownerRef: string, area?: string): Promise<SavedViewRow[]> {
    if (area !== undefined) {
      const r = await tx.query<SavedViewRow>(
        `SELECT ${VIEW_COLS} FROM admin_saved_view WHERE owner_ref=$1 AND area=$2 ORDER BY name`,
        [ownerRef, area],
      );
      return r.rows;
    }
    const r = await tx.query<SavedViewRow>(
      `SELECT ${VIEW_COLS} FROM admin_saved_view WHERE owner_ref=$1 ORDER BY area, name`,
      [ownerRef],
    );
    return r.rows;
  }

  // --- preference -----------------------------------------------------------------------------
  async upsertPreference(
    tx: Tx,
    i: {
      tenantId: string;
      ownerRef: string;
      prefKey: string;
      prefValue: unknown;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PreferenceRow> {
    const r = await tx.query<PreferenceRow>(
      `INSERT INTO admin_preference (tenant_id, owner_ref, pref_key, pref_value, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$6)
       ON CONFLICT (tenant_id, owner_ref, pref_key) DO UPDATE SET pref_value=EXCLUDED.pref_value, updated_by=EXCLUDED.updated_by, updated_at=now(), version=admin_preference.version+1
       RETURNING ${PREF_COLS}`,
      [i.tenantId, i.ownerRef, i.prefKey, JSON.stringify(i.prefValue ?? {}), i.correlationId, i.by],
    );
    return firstRow(r.rows, 'upsert preference');
  }
  async listPreferences(tx: Tx, ownerRef: string): Promise<PreferenceRow[]> {
    const r = await tx.query<PreferenceRow>(
      `SELECT ${PREF_COLS} FROM admin_preference WHERE owner_ref=$1 ORDER BY pref_key`,
      [ownerRef],
    );
    return r.rows;
  }

  // --- operation ------------------------------------------------------------------------------
  async insertOperation(
    tx: Tx,
    i: {
      tenantId: string;
      operationType: string;
      scope: string;
      targetType: string | null;
      targetRef: string | null;
      summary: string | null;
      requestedBy: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<OperationRow> {
    const r = await tx.query<OperationRow>(
      `INSERT INTO admin_operation_request (tenant_id, operation_type, scope, target_type, target_ref, summary, requested_by, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${OP_COLS}`,
      [
        i.tenantId,
        i.operationType,
        i.scope,
        i.targetType,
        i.targetRef,
        i.summary,
        i.requestedBy,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert operation');
  }
  async findOperation(tx: Tx, id: string): Promise<OperationRow | null> {
    const r = await tx.query<OperationRow>(`SELECT ${OP_COLS} FROM admin_operation_request WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findOperationByIdempotencyKey(tx: Tx, key: string): Promise<OperationRow | null> {
    const r = await tx.query<OperationRow>(
      `SELECT ${OP_COLS} FROM admin_operation_request WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async setOperationStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; reasonCode?: string | null; by: string | null },
  ): Promise<OperationRow | null> {
    const r = await tx.query<OperationRow>(
      `UPDATE admin_operation_request SET status=$3, reason_code=COALESCE($4, reason_code), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${OP_COLS}`,
      [i.id, i.expectedVersion, i.status, i.reasonCode ?? null, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listOperations(tx: Tx, status?: string): Promise<OperationRow[]> {
    if (status !== undefined) {
      const r = await tx.query<OperationRow>(
        `SELECT ${OP_COLS} FROM admin_operation_request WHERE status=$1 ORDER BY created_at DESC`,
        [status],
      );
      return r.rows;
    }
    const r = await tx.query<OperationRow>(
      `SELECT ${OP_COLS} FROM admin_operation_request ORDER BY created_at DESC`,
    );
    return r.rows;
  }
  async insertOperationHistory(
    tx: Tx,
    i: {
      tenantId: string;
      operationId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO admin_operation_history (tenant_id, operation_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.operationId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async listOperationHistory(tx: Tx, operationId: string): Promise<OperationHistoryRow[]> {
    const r = await tx.query<OperationHistoryRow>(
      `SELECT ${OPH_COLS} FROM admin_operation_history WHERE operation_id=$1 ORDER BY created_at`,
      [operationId],
    );
    return r.rows;
  }
  async countOperationsByStatus(tx: Tx): Promise<{ status: string; c: string }[]> {
    const r = await tx.query<{ status: string; c: string }>(
      `SELECT status, count(*)::text AS c FROM admin_operation_request GROUP BY status ORDER BY status`,
    );
    return r.rows;
  }
}
