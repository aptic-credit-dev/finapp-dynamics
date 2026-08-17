/**
 * Stage-7 DR executor SAFETY self-test — pure (no DB). Verifies the load-bearing ADR-127/131 guards. Exits
 * non-zero on any failure. These are the invariants that must hold before the executor is ever pointed at a DB.
 */
import {
  StagingBackupExecutor,
  UnavailableStagingExecutor,
  executorEnabled,
  validIdent,
  manifestChecksum,
  verifyChecksum,
  BACKUP_TABLES,
} from './backup-executor.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

// 1) production-mode refusal
{
  const save = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.STAGING_DR_EXECUTOR_ENABLED = '1';
  check('production_refusal_enabled_flag', executorEnabled() === false);
  const ex = new StagingBackupExecutor();
  const b = await ex.runBackup(null, { sourceUrl: 'postgresql://x/y' });
  check(
    'production_refusal_runBackup_blocked',
    b.outcome.executed === false && b.outcome.reasonCode === 'executor_unavailable',
  );
  const r = await ex.runRestore(null, { targetUrl: 'postgresql://x/y', manifest: {} });
  check(
    'production_refusal_runRestore_blocked',
    r.outcome.executed === false && r.outcome.reasonCode === 'executor_unavailable',
  );
  process.env.NODE_ENV = save;
}

// 2) disabled-by-default (fail closed)
{
  const save = process.env.STAGING_DR_EXECUTOR_ENABLED;
  delete process.env.STAGING_DR_EXECUTOR_ENABLED;
  process.env.NODE_ENV = 'staging';
  check('disabled_by_default', executorEnabled() === false);
  const b = await new StagingBackupExecutor().runBackup(null, { sourceUrl: 'postgresql://x/y' });
  check(
    'disabled_runBackup_blocked',
    b.outcome.executed === false && b.outcome.reasonCode === 'executor_unavailable',
  );
  if (save !== undefined) process.env.STAGING_DR_EXECUTOR_ENABLED = save;
}

// 3) identifier / injection rejection
{
  const bad = [
    'tenants; DROP TABLE x',
    'a-b',
    'Tenants',
    'a b',
    '1t',
    'x"y',
    "x'y",
    'a'.repeat(70),
    '',
    'public.tenants',
  ];
  check(
    'rejects_unsafe_identifiers',
    bad.every((s) => validIdent(s) === false),
    `n=${bad.length}`,
  );
  const good = ['tenants', 'identities', 'platform_role_assignments', 'a_b_c'];
  check(
    'accepts_safe_identifiers',
    good.every((s) => validIdent(s) === true),
  );
  check('backup_whitelist_all_safe', BACKUP_TABLES.every(validIdent));
}

// 4) checksum determinism + tamper detection
{
  const manifest = {
    tableChecksums: { tenants: 'aaa', identities: 'bbb', platform_role_assignments: 'ccc' },
    controlTotals: { tenants: 2, identities: 2, platform_role_assignments: 1 },
    migrationChecksums: [{ filename: '0001.sql', checksum: 'z' }],
  };
  const c1 = manifestChecksum(manifest);
  const c2 = manifestChecksum({ ...manifest });
  check('checksum_deterministic', c1 === c2);
  check('checksum_verify_ok', verifyChecksum(manifest, c1));
  const tampered = { ...manifest, controlTotals: { ...manifest.controlTotals, tenants: 3 } };
  check('checksum_tamper_detected', verifyChecksum(tampered, c1) === false);
}

// 5) failure paths (enabled, but missing inputs) — must not throw, must report a typed blocked reason
{
  process.env.NODE_ENV = 'staging';
  process.env.STAGING_DR_EXECUTOR_ENABLED = '1';
  const ex = new StagingBackupExecutor();
  const b = await ex.runBackup(null, {});
  const savedSrc = process.env.DR_SOURCE_URL;
  delete process.env.DR_SOURCE_URL;
  const b2 = await ex.runBackup(null, {});
  check(
    'missing_source_typed',
    b2.outcome.executed === false && b2.outcome.reasonCode === 'source_url_missing',
  );
  if (savedSrc !== undefined) process.env.DR_SOURCE_URL = savedSrc;
  const r = await ex.runRestore(null, {});
  check(
    'missing_target_manifest_typed',
    r.outcome.executed === false && r.outcome.reasonCode === 'target_or_manifest_missing',
  );
  void b;
}

// 6) the fail-closed default always blocks
{
  const u = new UnavailableStagingExecutor();
  const b = await u.runBackup();
  const r = await u.runRestore();
  check('unavailable_default_blocks', b.outcome.executed === false && r.outcome.executed === false);
}

console.log(`DR EXECUTOR SAFETY SELF-TEST — failures=${failed}`);
process.exit(failed > 0 ? 1 : 0);
