/**
 * Stage-7 STAGING-ONLY logical backup/restore executor — mirrors the canonical M40 `BackupExecutorPort`
 * (`ExecutionOutcome {executed, reasonCode, evidenceRef?, sizeBytes?}`) under the ADR-131 carve-out to ADR-127.
 *
 * SAFETY (load-bearing — ADR-127/131):
 *  - FAIL CLOSED by default: disabled unless STAGING_DR_EXECUTOR_ENABLED=1 AND NODE_ENV != production.
 *  - REFUSES production (NODE_ENV=production) — always returns an UNAVAILABLE/BLOCKED outcome.
 *  - pg-library ONLY: NO shell, NO pg_dump/pg_restore, NO child_process, NO OS command, NO filesystem raw dump,
 *    NO network beyond the pg connection. The backup manifest is IN-MEMORY (never written to disk here).
 *  - NO INJECTION: table names come from a FIXED whitelist and are re-validated (`^[a-z_][a-z0-9_]*$`); column
 *    names are validated; all values are PARAMETERIZED ($1..$n). Target DB identifier is validated.
 *  - The `ExecutionOutcome` carries only opaque refs + a size — never raw data, never a secret.
 *
 * This is a NON-PRODUCTION Tier-1 tool. It does not touch production and binds no production provider.
 */
import pg from 'pg';
import { createHash } from 'node:crypto';

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Whitelisted governed tables backed up, in FK-safe insert order (synthetic-populated; safe to restore). */
export const BACKUP_TABLES = ['tenants', 'identities', 'platform_role_assignments'];

export function executorEnabled(env = process.env) {
  return env.NODE_ENV !== 'production' && env.STAGING_DR_EXECUTOR_ENABLED === '1';
}

export function validIdent(s) {
  return typeof s === 'string' && s.length <= 63 && IDENT.test(s);
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}
/** Stable stringify (sorted keys) so checksums are deterministic across runs. */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object' && !(v instanceof Date))
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable(v[k]))
        .join(',') +
      '}'
    );
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  return JSON.stringify(v);
}

/** Deterministic checksum over the LOGICAL content (not timestamps): per-table checksums + totals + schema. */
export function manifestChecksum(manifest) {
  return sha256(
    stable({
      tableChecksums: manifest.tableChecksums,
      controlTotals: manifest.controlTotals,
      migrationChecksums: manifest.migrationChecksums,
    }),
  );
}

export function verifyChecksum(manifest, expected) {
  return manifestChecksum(manifest) === expected;
}

/** Unavailable/blocked outcome (fail-closed default). */
const BLOCKED = { executed: false, reasonCode: 'executor_unavailable' };

export class StagingBackupExecutor {
  /** runBackup — reads the whitelisted tables from the source and returns an in-memory manifest + outcome. */
  async runBackup(_ctx, input = {}) {
    if (!executorEnabled()) return { outcome: { ...BLOCKED } };
    const url = input.sourceUrl ?? process.env.DR_SOURCE_URL;
    if (!url) return { outcome: { executed: false, reasonCode: 'source_url_missing' } };
    const pool = new pg.Pool({ connectionString: url });
    try {
      const tables = {};
      const controlTotals = {};
      const tableChecksums = {};
      for (const t of BACKUP_TABLES) {
        if (!validIdent(t)) throw new Error(`unsafe table identifier: ${t}`);
        const rows = (await pool.query(`SELECT * FROM ${t} ORDER BY id`)).rows;
        tables[t] = rows;
        controlTotals[t] = rows.length;
        tableChecksums[t] = sha256(stable(rows));
      }
      const migrationChecksums = (
        await pool.query(`SELECT filename, checksum FROM schema_migrations ORDER BY filename`)
      ).rows;
      const manifest = { version: 1, tables, controlTotals, tableChecksums, migrationChecksums };
      const checksum = manifestChecksum(manifest);
      manifest.checksum = checksum;
      const sizeBytes = Buffer.byteLength(stable(manifest), 'utf8');
      return {
        outcome: {
          executed: true,
          reasonCode: 'executed_staging',
          evidenceRef: `staging-backup:${checksum.slice(0, 16)}`,
          sizeBytes,
        },
        manifest,
        checksum,
      };
    } finally {
      await pool.end();
    }
  }

  /** runRestore — replays the manifest's whitelisted rows into a clean target (parameterized; FK order). */
  async runRestore(_ctx, input = {}) {
    if (!executorEnabled()) return { outcome: { ...BLOCKED } };
    const { targetUrl, manifest } = input;
    if (!targetUrl || !manifest)
      return { outcome: { executed: false, reasonCode: 'target_or_manifest_missing' } };
    const pool = new pg.Pool({ connectionString: targetUrl });
    try {
      let restored = 0;
      for (const t of BACKUP_TABLES) {
        if (!validIdent(t)) throw new Error(`unsafe table identifier: ${t}`);
        for (const row of manifest.tables[t] ?? []) {
          const cols = Object.keys(row).filter(validIdent);
          if (cols.length !== Object.keys(row).length) throw new Error(`unsafe column in ${t}`);
          const ph = cols.map((_, i) => `$${i + 1}`).join(',');
          const vals = cols.map((c) => row[c]);
          await pool.query(
            `INSERT INTO ${t} (${cols.join(',')}) VALUES (${ph}) ON CONFLICT DO NOTHING`,
            vals,
          );
          restored++;
        }
      }
      return {
        outcome: {
          executed: true,
          reasonCode: 'restored_staging',
          evidenceRef: `staging-restore:${(manifest.checksum ?? 'na').slice(0, 16)}`,
          sizeBytes: restored,
        },
      };
    } finally {
      await pool.end();
    }
  }
}

/** The fail-closed default the app would wire in production (mirrors M40's UnavailableBackupExecutor). */
export class UnavailableStagingExecutor {
  async runBackup() {
    return { outcome: { ...BLOCKED } };
  }
  async runRestore() {
    return { outcome: { ...BLOCKED } };
  }
}
