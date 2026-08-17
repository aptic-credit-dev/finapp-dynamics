/**
 * Stage-7 migration framework SAFETY self-test. Pure checks always run; DB-backed checks (rollback scoping +
 * idempotency + mismatch failure) run when DATABASE_URL is set. Exits non-zero on any failure.
 */
import pg from 'pg';
import { MAPPING, mappingChecksum, validateMapping, transformRecord } from './migration-mapping.mjs';
import {
  validateSource,
  migrationEnabled,
  rehearse,
  rollback,
  reconcile,
  countForRun,
} from './migration-framework.mjs';
import { SOURCE_DATA } from './migration-fixtures.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

// production refusal
{
  const save = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  check('production_disabled', migrationEnabled() === false);
  let threw = false;
  try {
    await rehearse({ query: async () => ({ rowCount: 0 }) }, 'run_x', SOURCE_DATA);
  } catch {
    threw = true;
  }
  check('production_refusal_throws', threw);
  process.env.NODE_ENV = save ?? 'staging';
}

// mapping checksum determinism + tamper
{
  const c1 = mappingChecksum(MAPPING);
  const c2 = mappingChecksum(structuredClone(MAPPING));
  check('mapping_checksum_deterministic', c1 === c2);
  const tampered = structuredClone(MAPPING);
  tampered.version = '9.9.9';
  check('mapping_checksum_tamper', mappingChecksum(tampered) !== c1);
}

// invalid mapping rejection
{
  const bad = structuredClone(MAPPING);
  bad.entities[0].fields[0].transform = 'evilTransform';
  bad.entities[1].dest = 'DROP TABLE x';
  const errs = validateMapping(bad);
  check('invalid_mapping_rejected', errs.length >= 2, `errs=${errs.length}`);
}

// transform determinism
{
  const e = MAPPING.entities.find((x) => x.key === 'identity');
  const r1 = transformRecord(e, { tenantCode: 'stg_mig_a', email: 'A.B@X.io', name: ' n ' });
  const r2 = transformRecord(e, { tenantCode: 'stg_mig_a', email: 'A.B@X.io', name: ' n ' });
  check('transform_deterministic', JSON.stringify(r1) === JSON.stringify(r2));
  check('transform_lowercases_email', r1.ok && r1.row.email_norm === 'a.b@x.io');
}

// duplicate handling + exception capture + money exactness (pure)
{
  const v = validateSource(SOURCE_DATA);
  check(
    'accepted_counts',
    v.control.accepted_counts.tenant === 2 &&
      v.control.accepted_counts.identity === 2 &&
      v.control.accepted_counts.ledger === 3,
    JSON.stringify(v.control.accepted_counts),
  );
  check('duplicate_detected', v.duplicates.length === 1 && v.duplicates[0].source_id === 'I2');
  check('exceptions_captured', v.exceptions.length === 2, JSON.stringify(v.exceptions.map((e) => e.reason)));
  check(
    'money_exact_bigint',
    v.control.ledger_minor_total_by_tenant.stg_mig_a === '152599' &&
      v.control.ledger_minor_total_by_tenant.stg_mig_b === '999999',
  );
}

// DB-backed: rollback scoping + idempotency + mismatch failure
const url = process.env.DATABASE_URL;
if (url) {
  process.env.NODE_ENV = 'staging';
  const pool = new pg.Pool({ connectionString: url });
  try {
    const A = 'sftest_run_a';
    const B = 'sftest_run_b';
    await rehearse(pool, A, SOURCE_DATA);
    await rehearse(pool, B, SOURCE_DATA);
    // rollback A must NOT touch B (run + tenant scoping)
    await rollback(pool, A);
    const aAfter = await countForRun(pool, A);
    const bAfter = await countForRun(pool, B);
    check(
      'rollback_scoped_to_run',
      aAfter.tenant === 0 && bAfter.tenant === 2,
      `A=${JSON.stringify(aAfter)} B=${JSON.stringify(bAfter)}`,
    );
    // rollback idempotency: second rollback of A deletes 0
    const rb2 = await rollback(pool, A);
    check(
      'rollback_idempotent',
      rb2.deleted.tenant === 0 && rb2.deleted.identity === 0 && rb2.deleted.ledger === 0,
    );
    // mismatch failure: reconcile B against a tampered source (extra accepted tenant) => match false
    const tamperedSource = structuredClone(SOURCE_DATA);
    tamperedSource.tenants.push({ source_id: 'T3', code: 'stg_mig_c', legalName: 'Extra' });
    const rc = await reconcile(pool, B, tamperedSource);
    check('mismatch_detected', rc.match === false, `match=${rc.match}`);
    await rollback(pool, B); // clean
  } finally {
    await pool.end();
  }
} else {
  console.log('[INFO] DATABASE_URL unset — DB-backed rollback/idempotency/mismatch checks skipped');
}

console.log(`MIGRATION FRAMEWORK SAFETY SELF-TEST — failures=${failed}`);
process.exit(failed > 0 ? 1 : 0);
