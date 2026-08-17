/**
 * Stage-7 Tier-1 SYNTHETIC migration framework — NON-PRODUCTION. Provider-neutral; deterministic; idempotent;
 * with a run-scoped, tenant-safe rollback. Operates ONLY on a dedicated sandbox schema (`stage7_migration`) —
 * it NEVER writes to a governed/certified table. Money is integer MINOR UNITS (no float). Values are
 * PARAMETERIZED; table/column identifiers come from the fixed MAPPING (no injection, no eval).
 *
 * This exercises the migration PROCEDURE against synthetic/reference fixtures. It is NOT the real-data migration
 * and does NOT satisfy CFO/Legal/business sign-off (OQ#14). It refuses production.
 */
import { MAPPING, transformRecord, validateMapping } from './migration-mapping.mjs';

const SCHEMA = 'stage7_migration';

export function migrationEnabled(env = process.env) {
  return env.NODE_ENV !== 'production';
}

export async function ensureSchema(pool) {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA}.mig_tenant (
       migration_run_id text NOT NULL, source_id text NOT NULL, tenant_code text NOT NULL, legal_name text NOT NULL,
       PRIMARY KEY (migration_run_id, tenant_code))`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA}.mig_identity (
       migration_run_id text NOT NULL, source_id text NOT NULL, tenant_code text NOT NULL, email_norm text NOT NULL,
       display_name text NOT NULL, PRIMARY KEY (migration_run_id, tenant_code, email_norm))`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA}.mig_ledger (
       migration_run_id text NOT NULL, source_id text NOT NULL, tenant_code text NOT NULL, account text NOT NULL,
       amount_minor bigint NOT NULL, currency char(3) NOT NULL,
       PRIMARY KEY (migration_run_id, tenant_code, source_id),
       CONSTRAINT mig_ledger_amount_int_ck CHECK (amount_minor = trunc(amount_minor)))`,
  );
}

/** Validate + classify the source (no DB). Returns accepted rows, exceptions, duplicates and control totals. */
export function validateSource(sourceData, mapping = MAPPING) {
  const accepted = {};
  const exceptions = [];
  const duplicates = [];
  for (const entity of mapping.entities) {
    accepted[entity.key] = [];
    const seen = new Set();
    for (const rec of sourceData[entity.source] ?? []) {
      const t = transformRecord(entity, rec);
      if (!t.ok) {
        exceptions.push({ entity: entity.key, source_id: rec.source_id, reason: t.reason });
        continue;
      }
      const keyObj = { ...t.row, source_id: rec.source_id };
      const nk = entity.naturalKey.map((k) => String(keyObj[k])).join('|');
      if (seen.has(nk)) {
        duplicates.push({ entity: entity.key, source_id: rec.source_id });
        continue;
      }
      seen.add(nk);
      accepted[entity.key].push({ source_id: rec.source_id, row: t.row });
    }
  }
  const control = {
    source_counts: Object.fromEntries(
      mapping.entities.map((e) => [e.key, (sourceData[e.source] ?? []).length]),
    ),
    accepted_counts: Object.fromEntries(mapping.entities.map((e) => [e.key, accepted[e.key].length])),
    rejected_count: exceptions.length,
    duplicate_count: duplicates.length,
    ledger_minor_total_by_tenant: ledgerTotals(accepted.ledger ?? []),
  };
  return { accepted, exceptions, duplicates, control };
}

function ledgerTotals(ledgerAccepted) {
  const totals = {};
  for (const a of ledgerAccepted) {
    const t = a.row.tenant_code;
    totals[t] = (totals[t] ?? 0n) + BigInt(a.row.amount_minor);
  }
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toString()]));
}

/** Dry-run: validate only, no writes. */
export function dryRun(sourceData, mapping = MAPPING) {
  const mapErrs = validateMapping(mapping);
  if (mapErrs.length) throw new Error(`invalid mapping: ${mapErrs.join('; ')}`);
  return validateSource(sourceData, mapping).control;
}

/** Rehearse: insert accepted rows tagged with runId; ON CONFLICT DO NOTHING (idempotent). Returns inserted counts. */
export async function rehearse(pool, runId, sourceData, mapping = MAPPING) {
  if (!migrationEnabled()) throw new Error('migration framework refuses NODE_ENV=production');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(runId)) throw new Error(`unsafe runId: ${runId}`);
  const mapErrs = validateMapping(mapping);
  if (mapErrs.length) throw new Error(`invalid mapping: ${mapErrs.join('; ')}`);
  await ensureSchema(pool);
  const { accepted, exceptions, duplicates, control } = validateSource(sourceData, mapping);
  const inserted = {};
  for (const entity of mapping.entities) {
    const cols = ['migration_run_id', 'source_id', ...entity.fields.map((f) => f.dst)];
    let n = 0;
    for (const a of accepted[entity.key]) {
      const vals = [runId, a.source_id, ...entity.fields.map((f) => a.row[f.dst])];
      const ph = vals.map((_, i) => `$${i + 1}`).join(',');
      const res = await pool.query(
        `INSERT INTO ${SCHEMA}.${entity.dest} (${cols.join(',')}) VALUES (${ph}) ON CONFLICT DO NOTHING`,
        vals,
      );
      n += res.rowCount;
    }
    inserted[entity.key] = n;
  }
  return { inserted, exceptions, duplicates, control };
}

/** Reconcile destination (this run) against the source accepted control totals. */
export async function reconcile(pool, runId, sourceData, mapping = MAPPING) {
  const { control } = validateSource(sourceData, mapping);
  const destCounts = {};
  for (const entity of mapping.entities) {
    destCounts[entity.key] = Number(
      (
        await pool.query(`SELECT count(*)::int c FROM ${SCHEMA}.${entity.dest} WHERE migration_run_id=$1`, [
          runId,
        ])
      ).rows[0].c,
    );
  }
  const destLedger = {};
  for (const r of (
    await pool.query(
      `SELECT tenant_code, SUM(amount_minor)::text total FROM ${SCHEMA}.mig_ledger WHERE migration_run_id=$1 GROUP BY tenant_code`,
      [runId],
    )
  ).rows)
    destLedger[r.tenant_code] = r.total;

  const countsMatch = mapping.entities.every((e) => destCounts[e.key] === control.accepted_counts[e.key]);
  const totalsMatch = JSON.stringify(destLedger) === JSON.stringify(control.ledger_minor_total_by_tenant);
  return { match: countsMatch && totalsMatch, destCounts, destLedger, expected: control };
}

/** Rollback: delete ONLY this run's rows (run-scoped, tenant-safe; cannot touch another run or a governed table). */
export async function rollback(pool, runId, mapping = MAPPING) {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(runId)) throw new Error(`unsafe runId: ${runId}`);
  const deleted = {};
  for (const entity of mapping.entities) {
    const res = await pool.query(`DELETE FROM ${SCHEMA}.${entity.dest} WHERE migration_run_id=$1`, [runId]);
    deleted[entity.key] = res.rowCount;
  }
  return { deleted };
}

export async function countForRun(pool, runId, mapping = MAPPING) {
  const c = {};
  for (const entity of mapping.entities)
    c[entity.key] = Number(
      (
        await pool.query(`SELECT count(*)::int c FROM ${SCHEMA}.${entity.dest} WHERE migration_run_id=$1`, [
          runId,
        ])
      ).rows[0].c,
    );
  return c;
}
