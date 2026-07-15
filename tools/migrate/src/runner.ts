import type pg from 'pg';
import { checksum, type PlannedMigration } from './plan.ts';

/**
 * Applies the migration plan.
 *
 * Guarantees, all of which Stage 0 exists to establish before any real schema depends on them:
 *  - **Idempotent** — an applied migration is skipped, so a retry after a partial failure is safe
 *    (CLAUDE.md: migrations are high-risk actions and must be keyed and safe to retry).
 *  - **Atomic per migration** — the DDL and the `schema_migrations` row commit together, so the ledger
 *    can never claim a migration that did not apply.
 *  - **Tamper-evident** — an applied migration whose checksum changed is a hard failure. Editing shipped
 *    SQL silently forks environments; add a new migration instead.
 *  - **Serialised** — a session advisory lock means two deployers racing produce one applier and one
 *    waiter, not two half-applied schemas.
 */

/** Arbitrary but fixed: the lock key this project uses for schema changes. */
const ADVISORY_LOCK_KEY = 4_115_072_026;

export interface AppliedMigration {
  readonly module: string;
  readonly filename: string;
  readonly durationMs: number;
}

export interface MigrateResult {
  readonly applied: AppliedMigration[];
  readonly skipped: number;
}

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    module      text        NOT NULL,
    filename    text        NOT NULL,
    checksum    text        NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    applied_by  text        NOT NULL DEFAULT current_user,
    duration_ms integer     NOT NULL,
    CONSTRAINT schema_migrations_pkey PRIMARY KEY (module, filename)
  );
`;

/**
 * The ledger is global — it is infrastructure, not tenant data, and it is not one of the enumerated
 * global business tables (ADR-001), so it needs no RLS policy and no tenant_id.
 */
export async function ensureLedger(client: pg.PoolClient | pg.Client): Promise<void> {
  await client.query(LEDGER_DDL);
}

async function appliedChecksums(client: pg.PoolClient | pg.Client): Promise<Map<string, string>> {
  const result = await client.query<{ module: string; filename: string; checksum: string }>(
    'SELECT module, filename, checksum FROM schema_migrations',
  );
  return new Map(result.rows.map((row) => [`${row.module}/${row.filename}`, row.checksum]));
}

export async function migrate(pool: pg.Pool, plan: readonly PlannedMigration[]): Promise<MigrateResult> {
  const client = await pool.connect();
  const applied: AppliedMigration[] = [];
  let skipped = 0;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureLedger(client);
    const already = await appliedChecksums(client);

    for (const migration of plan) {
      const key = `${migration.module}/${migration.filename}`;
      const previous = already.get(key);

      if (previous !== undefined) {
        if (previous !== migration.checksum) {
          throw new Error(
            `${key} was already applied but its checksum changed (${previous.slice(0, 12)} -> ` +
              `${migration.checksum.slice(0, 12)}). Applied migrations are immutable — add a new one.`,
          );
        }
        skipped += 1;
        continue;
      }

      const startedAt = process.hrtime.bigint();
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
        await client.query(
          'INSERT INTO schema_migrations (module, filename, checksum, duration_ms) VALUES ($1, $2, $3, $4)',
          [migration.module, migration.filename, migration.checksum, durationMs],
        );
        await client.query('COMMIT');
        applied.push({ module: migration.module, filename: migration.filename, durationMs });
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${key} failed and was rolled back: ${reason}`);
      }
    }

    return { applied, skipped };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/** Applies one SQL script outside the plan — used by the RLS convention proof. */
export async function applyScript(client: pg.PoolClient | pg.Client, sql: string): Promise<string> {
  await client.query(sql);
  return checksum(sql);
}
