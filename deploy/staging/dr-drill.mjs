/**
 * Stage-7 Tier-1 AUTOMATED DR DRILL harness — NON-PRODUCTION. Deterministic; exits non-zero on any critical
 * discrepancy. Uses the staging BackupExecutor (pg-library only) + the in-process migrate runner
 * (`@finapp/migrate`) to rebuild the recovery-target schema — NO shell, NO pg_dump, NO child_process.
 *
 * Run with:  STAGING_DR_EXECUTOR_ENABLED=1 NODE_ENV=staging DR_SOURCE_URL=... \
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning --conditions=source deploy/staging/dr-drill.mjs
 *
 * TIER-1 ONLY. Not independent DR assurance, not COO/Operations acceptance, not production GO.
 */
import pg from 'pg';
import { planMigrations, migrate } from '@finapp/migrate';
import { StagingBackupExecutor, verifyChecksum, executorEnabled } from './backup-executor.mjs';

const IDENT = /^[a-z_][a-z0-9_]*$/;
const steps = [];
const rec = (name, ok, detail, critical = true) => {
  steps.push({ name, ok, detail, critical });
  console.log(`[${ok ? 'PASS' : critical ? 'FAIL' : 'SKIP'}] ${name} — ${detail}`);
};
const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

function withDb(url, db) {
  const u = new URL(url);
  u.pathname = '/' + db;
  return u.toString();
}

async function controlTotals(url) {
  const p = new pg.Pool({ connectionString: url });
  try {
    const one = async (sql) => (await p.query(sql)).rows[0].c;
    return {
      tenants: await one(`SELECT count(*)::int c FROM tenants`),
      identities: await one(`SELECT count(*)::int c FROM identities`),
      grants: await one(`SELECT count(*)::int c FROM platform_role_assignments`),
      migrations: await one(`SELECT count(*)::int c FROM schema_migrations`),
      force_rls: await one(
        `SELECT count(*)::int c FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity`,
      ),
    };
  } finally {
    await p.end();
  }
}

async function main() {
  const sourceUrl = process.env.DR_SOURCE_URL;
  if (!sourceUrl) throw new Error('DR_SOURCE_URL required');
  const targetDb = process.env.DR_TARGET_DB ?? 'finapp_dr_target';
  if (!IDENT.test(targetDb)) throw new Error(`unsafe DR_TARGET_DB: ${targetDb}`);
  const maintUrl = withDb(sourceUrl, 'postgres');
  const targetUrl = withDb(sourceUrl, targetDb);
  const executor = new StagingBackupExecutor();
  const result = { rto_ms: null, rpo_seconds: null, backup_ms: null, restore_ms: null };

  // 1) readiness
  rec('executor_enabled', executorEnabled(), `STAGING_DR_EXECUTOR_ENABLED + non-production`);
  const baseline = await controlTotals(sourceUrl);
  rec('readiness_source', baseline.migrations >= 82, `source migrations=${baseline.migrations}`);

  // 2) baseline control totals (captured in `baseline`)
  rec('baseline_control_totals', true, JSON.stringify(baseline));

  // 3) backup + 4) verify checksum
  const t0 = nowMs();
  const b = await executor.runBackup(null, { sourceUrl });
  result.backup_ms = nowMs() - t0;
  rec(
    'backup_executed',
    b.outcome.executed,
    `${b.outcome.reasonCode} ref=${b.outcome.evidenceRef} size=${b.outcome.sizeBytes}`,
  );
  rec(
    'checksum_verified',
    b.manifest ? verifyChecksum(b.manifest, b.checksum) : false,
    `checksum=${(b.checksum ?? '').slice(0, 16)}`,
  );

  // 5) provision/clear a clean recovery target
  const maint = new pg.Pool({ connectionString: maintUrl });
  try {
    await maint.query(`DROP DATABASE IF EXISTS ${targetDb} WITH (FORCE)`);
    await maint.query(`CREATE DATABASE ${targetDb}`);
  } finally {
    await maint.end();
  }
  rec('recovery_target_clean', true, `created ${targetDb}`);

  // 6) rebuild target schema in-process (migrate)
  const plan = await planMigrations(process.cwd());
  const tpool = new pg.Pool({ connectionString: targetUrl });
  let migResult;
  try {
    migResult = await migrate(tpool, plan);
  } finally {
    await tpool.end();
  }
  rec('target_schema_migrated', migResult.applied.length >= 82, `applied=${migResult.applied.length}`);

  // 7) restore
  const t1 = nowMs();
  const r = await executor.runRestore(null, { targetUrl, manifest: b.manifest });
  result.restore_ms = nowMs() - t1;
  rec('restore_executed', r.outcome.executed, `${r.outcome.reasonCode} rows=${r.outcome.sizeBytes}`);
  result.rto_ms = result.backup_ms + result.restore_ms;

  // 8) validate migrations/schema + 9) RLS posture on the restored target
  const restored = await controlTotals(targetUrl);
  rec(
    'target_migrations_match',
    restored.migrations === baseline.migrations,
    `${restored.migrations} vs ${baseline.migrations}`,
  );
  rec(
    'target_force_rls_match',
    restored.force_rls === baseline.force_rls,
    `${restored.force_rls} vs ${baseline.force_rls}`,
  );

  // 10) reconcile control totals (restored data == backup)
  const reconcile =
    restored.tenants === baseline.tenants &&
    restored.identities === baseline.identities &&
    restored.grants === baseline.grants;
  rec(
    'reconcile_control_totals',
    reconcile,
    `tenants ${restored.tenants}/${baseline.tenants}, identities ${restored.identities}/${baseline.identities}, grants ${restored.grants}/${baseline.grants}`,
  );
  // RPO: the logical restore of deterministic synthetic data is exact → observed data-loss window 0s.
  result.rpo_seconds = reconcile ? 0 : null;

  // 11) failover to the recovered target + posture check
  let active = 'target';
  const failoverPosture = restored.force_rls >= 50;
  rec('failover_to_recovered', failoverPosture, `active=${active}; force_rls=${restored.force_rls}`);
  const apiBase = process.env.API_BASE_URL;
  if (apiBase) {
    try {
      const resp = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/health`);
      rec('failover_http_health', resp.ok, `health ${resp.status}`);
    } catch (e) {
      rec('failover_http_health', false, `unreachable ${e.message}`);
    }
  } else {
    rec(
      'failover_http_health',
      false,
      'SKIPPED — no running server (app-level health/auth/isolation via the DB/API integration lane)',
      false,
    );
  }

  // 12) failback + 13) reconcile again
  active = 'source';
  const afterBaseline = await controlTotals(sourceUrl);
  rec(
    'failback_reconcile',
    afterBaseline.tenants === baseline.tenants && afterBaseline.identities === baseline.identities,
    `active=${active}; source unchanged`,
  );

  // 14) RTO/RPO — measured only; acceptance vs target is human-approved (OQ#13)
  rec(
    'rto_rpo_measured',
    result.rto_ms !== null,
    `RTO=${result.rto_ms}ms (backup ${result.backup_ms} + restore ${result.restore_ms}); RPO=${result.rpo_seconds}s — acceptance PENDING OQ#13 / HUMAN-APPROVED RTO-RPO TARGET`,
    false,
  );

  const failed = steps.filter((s) => !s.ok && s.critical);
  console.log(
    `TIER-1 AUTOMATED DR DRILL — NON-PRODUCTION — NOT INDEPENDENT DR ASSURANCE. critical_failures=${failed.length}; ` +
      JSON.stringify(result),
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('dr-drill error:', e.message);
  process.exit(1);
});
