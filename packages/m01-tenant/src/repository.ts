import type { Tx } from '@finapp/kernel';
import type { TenantStatus } from './domain/tenant-status.ts';

/**
 * Unwraps the row an `INSERT ... RETURNING` must have produced.
 *
 * `rows[0]!` would silence the compiler and, on the day the assumption breaks, hand the caller a
 * TypeError about a property of undefined from somewhere far away. This throws where the assumption
 * actually failed.
 */
export function firstRow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`${what}: expected exactly one row, got none.`);
  }
  return row;
}

/**
 * M01 persistence. Every method takes the caller's `Tx` — the repository never opens a transaction, so
 * a read and the write that depends on it cannot drift into separate ones.
 */

export interface TenantRow {
  readonly id: string;
  readonly code: string;
  readonly legal_name: string;
  readonly trading_name: string | null;
  readonly tenant_type: string;
  readonly default_timezone: string;
  readonly default_currency: string;
  readonly country: string;
  readonly status: TenantStatus;
  readonly activated_at: Date | null;
  readonly suspended_at: Date | null;
  readonly closed_at: Date | null;
  readonly metadata: Record<string, unknown>;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface CreateTenantRow {
  readonly id: string;
  readonly code: string;
  readonly legalName: string;
  readonly tradingName: string | null;
  readonly tenantType: string;
  readonly defaultTimezone: string;
  readonly defaultCurrency: string;
  readonly country: string;
  readonly metadata: Record<string, unknown>;
  readonly createdBy: string | null;
}

export class TenantRepository {
  async insert(tx: Tx, input: CreateTenantRow): Promise<TenantRow> {
    const result = await tx.query<TenantRow>(
      `INSERT INTO tenants
         (id, code, legal_name, trading_name, tenant_type, default_timezone, default_currency,
          country, status, metadata, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9::jsonb, $10, $10)
       RETURNING *`,
      [
        input.id,
        input.code,
        input.legalName,
        input.tradingName,
        input.tenantType,
        input.defaultTimezone,
        input.defaultCurrency,
        input.country,
        JSON.stringify(input.metadata),
        input.createdBy,
      ],
    );
    return firstRow(result.rows, 'insert tenant');
  }

  async findById(tx: Tx, id: string): Promise<TenantRow | null> {
    const result = await tx.query<TenantRow>('SELECT * FROM tenants WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async findByCode(tx: Tx, code: string): Promise<TenantRow | null> {
    const result = await tx.query<TenantRow>('SELECT * FROM tenants WHERE code = $1', [code]);
    return result.rows[0] ?? null;
  }

  /**
   * Lists tenants visible in the current context. RLS decides the row set: in tenant context that is at
   * most the caller's own tenant; in system context it is all of them. The query carries no tenant
   * filter of its own — the isolation is the database's job, not this method's (ADR-001).
   */
  async list(tx: Tx, opts: { status?: string; limit: number; offset: number }): Promise<TenantRow[]> {
    const result = await tx.query<TenantRow>(
      `SELECT * FROM tenants
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY created_at DESC, id
       LIMIT $2 OFFSET $3`,
      [opts.status ?? null, opts.limit, opts.offset],
    );
    return result.rows;
  }

  async count(tx: Tx, opts: { status?: string }): Promise<number> {
    const result = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tenants WHERE ($1::text IS NULL OR status = $1)`,
      [opts.status ?? null],
    );
    return Number.parseInt(result.rows[0]?.n ?? '0', 10);
  }

  /**
   * Applies a status transition under optimistic concurrency.
   *
   * The `version = $x` predicate is the lock. Returns null when nothing matched, which the service turns
   * into a 409 — it means someone else moved this tenant while we were deciding, and our decision was
   * made against a state that no longer exists.
   */
  async applyStatus(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      toStatus: TenantStatus;
      updatedBy: string | null;
    },
  ): Promise<TenantRow | null> {
    const result = await tx.query<TenantRow>(
      `UPDATE tenants SET
         status       = $3,
         version      = version + 1,
         updated_by   = $4,
         updated_at   = now(),
         activated_at = CASE WHEN $3 = 'active'    AND activated_at IS NULL THEN now() ELSE activated_at END,
         suspended_at = CASE WHEN $3 = 'suspended' THEN now()
                             WHEN $3 = 'active'    THEN NULL
                             ELSE suspended_at END,
         closed_at    = CASE WHEN $3 = 'closed'    THEN now() ELSE closed_at END
       WHERE id = $1 AND version = $2
       RETURNING *`,
      [input.id, input.expectedVersion, input.toStatus, input.updatedBy],
    );
    return result.rows[0] ?? null;
  }

  async updateProfile(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      legalName?: string | undefined;
      tradingName?: string | null | undefined;
      defaultTimezone?: string | undefined;
      defaultCurrency?: string | undefined;
      country?: string | undefined;
      metadata?: Record<string, unknown> | undefined;
      updatedBy: string | null;
    },
  ): Promise<TenantRow | null> {
    // COALESCE($n, column) leaves an omitted field untouched. `tradingName` is deliberately excluded
    // from that trick below because null is a meaningful value for it — "clear the trading name" and
    // "do not change the trading name" are different requests and must not collapse into one.
    const result = await tx.query<TenantRow>(
      `UPDATE tenants SET
         legal_name       = COALESCE($3, legal_name),
         trading_name     = CASE WHEN $4::boolean THEN $5 ELSE trading_name END,
         default_timezone = COALESCE($6, default_timezone),
         default_currency = COALESCE($7, default_currency),
         country          = COALESCE($8, country),
         metadata         = COALESCE($9::jsonb, metadata),
         version          = version + 1,
         updated_by       = $10,
         updated_at       = now()
       WHERE id = $1 AND version = $2
       RETURNING *`,
      [
        input.id,
        input.expectedVersion,
        input.legalName ?? null,
        input.tradingName !== undefined,
        input.tradingName ?? null,
        input.defaultTimezone ?? null,
        input.defaultCurrency ?? null,
        input.country ?? null,
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
        input.updatedBy,
      ],
    );
    return result.rows[0] ?? null;
  }

  /** Append-only. There is no update or delete counterpart, and the app role holds no privilege for one. */
  async appendStatusHistory(
    tx: Tx,
    input: {
      tenantId: string;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      reason: string | null;
      correlationId: string;
      changedBy: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO tenant_status_history
         (tenant_id, from_status, to_status, action, reason, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.tenantId,
        input.fromStatus,
        input.toStatus,
        input.action,
        input.reason,
        input.correlationId,
        input.changedBy,
      ],
    );
  }

  async statusHistory(tx: Tx, tenantId: string): Promise<Record<string, unknown>[]> {
    const result = await tx.query(
      `SELECT * FROM tenant_status_history WHERE tenant_id = $1 ORDER BY changed_at ASC, id`,
      [tenantId],
    );
    return result.rows;
  }
}
