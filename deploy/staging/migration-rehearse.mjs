/**
 * Stage-7 Tier-1 SYNTHETIC migration rehearsal + rollback — NON-PRODUCTION. Runs the 11-step procedure and exits
 * non-zero on any unexplained control-total mismatch. Synthetic fixtures only. NOT the real-data migration.
 */
import pg from 'pg';
import {
  dryRun,
  rehearse,
  reconcile,
  rollback,
  countForRun,
  migrationEnabled,
} from './migration-framework.mjs';
import { validateMapping, mappingChecksum, MAPPING } from './migration-mapping.mjs';
import { SOURCE_DATA, SOURCE_INVENTORY, EXPECTED } from './migration-fixtures.mjs';

const steps = [];
const rec = (name, ok, detail, critical = true) => {
  steps.push({ name, ok, critical });
  console.log(`[${ok ? 'PASS' : critical ? 'FAIL' : 'INFO'}] ${name} — ${detail}`);
};

async function main() {
  if (!migrationEnabled()) throw new Error('refuses NODE_ENV=production');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const runId = 'stg_mig_rehearsal_1';
  const pool = new pg.Pool({ connectionString: url });
  try {
    // 0) start clean for this runId (repeatable regardless of prior partial runs)
    const { ensureSchema } = await import('./migration-framework.mjs');
    await ensureSchema(pool);
    await rollback(pool, runId);
    // 1) source validation + inventory
    rec(
      'source_inventory',
      SOURCE_INVENTORY.length >= 1 && SOURCE_INVENTORY[0].authoritative === false,
      `${SOURCE_INVENTORY.length} synthetic source(s); real sources TBD (OQ#14)`,
    );
    // 2) mapping validation + checksum
    const mapErrs = validateMapping(MAPPING);
    rec('mapping_valid', mapErrs.length === 0, `errors=${mapErrs.length}`);
    rec('mapping_checksum', true, `v${MAPPING.version} ${mappingChecksum().slice(0, 16)}`, false);

    // 3) dry-run
    const dr = dryRun(SOURCE_DATA);
    rec(
      'dry_run',
      dr.accepted_counts.tenant === EXPECTED.tenant_count &&
        dr.accepted_counts.identity === EXPECTED.identity_count &&
        dr.accepted_counts.ledger === EXPECTED.ledger_count,
      `accepted ${JSON.stringify(dr.accepted_counts)} rejected=${dr.rejected_count} dup=${dr.duplicate_count}`,
    );

    // 4) rehearsal
    const reh = await rehearse(pool, runId, SOURCE_DATA);
    rec(
      'rehearsal_insert',
      reh.inserted.tenant === 2 && reh.inserted.identity === 2 && reh.inserted.ledger === 3,
      `inserted ${JSON.stringify(reh.inserted)}`,
    );
    // 7) exception register
    rec(
      'exception_register',
      reh.exceptions.length === 2 && reh.duplicates.length === 1,
      `exceptions=${JSON.stringify(reh.exceptions)} duplicates=${reh.duplicates.length}`,
    );

    // 5) destination validation + 6) control-total reconciliation
    const dest = await countForRun(pool, runId);
    rec(
      'destination_counts',
      dest.tenant === 2 && dest.identity === 2 && dest.ledger === 3,
      JSON.stringify(dest),
    );
    const rc = await reconcile(pool, runId, SOURCE_DATA);
    rec(
      'reconcile_control_totals',
      rc.match,
      `destLedger=${JSON.stringify(rc.destLedger)} match=${rc.match}`,
    );
    rec(
      'money_exactness_bigint',
      rc.destLedger.stg_mig_a === '152599' && rc.destLedger.stg_mig_b === '999999',
      `A=${rc.destLedger.stg_mig_a} B=${rc.destLedger.stg_mig_b} (integer minor units)`,
    );

    // 8) second idempotent rerun
    const reh2 = await rehearse(pool, runId, SOURCE_DATA);
    rec(
      'idempotent_rerun',
      reh2.inserted.tenant === 0 && reh2.inserted.identity === 0 && reh2.inserted.ledger === 0,
      `re-inserted ${JSON.stringify(reh2.inserted)} (expect all 0)`,
    );

    // 9) rollback + 10) post-rollback reconciliation
    const rb = await rollback(pool, runId);
    const afterRb = await countForRun(pool, runId);
    rec(
      'rollback',
      rb.deleted.tenant === 2 && rb.deleted.identity === 2 && rb.deleted.ledger === 3,
      `deleted ${JSON.stringify(rb.deleted)}`,
    );
    rec(
      'post_rollback_empty',
      afterRb.tenant === 0 && afterRb.identity === 0 && afterRb.ledger === 0,
      JSON.stringify(afterRb),
    );

    // 11) reapply (repeatability)
    const reh3 = await rehearse(pool, runId, SOURCE_DATA);
    rec(
      'reapply_repeatable',
      reh3.inserted.tenant === 2 && reh3.inserted.identity === 2 && reh3.inserted.ledger === 3,
      `re-applied ${JSON.stringify(reh3.inserted)}`,
    );
    await rollback(pool, runId); // leave clean

    const failed = steps.filter((s) => !s.ok && s.critical);
    console.log(
      `TIER-1 SYNTHETIC MIGRATION REHEARSAL — NOT REAL-DATA MIGRATION / NOT CFO OR LEGAL SIGN-OFF. critical_failures=${failed.length}`,
    );
    process.exit(failed.length > 0 ? 1 : 0);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('rehearsal error:', e.message);
  process.exit(1);
});
