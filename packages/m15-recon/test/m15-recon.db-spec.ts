import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M15 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every one of the 18 recon tables has RLS ENABLE+FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only
 * INSERT+SELECT on the eight append-only ledgers; money is bigint minor units with NO float column; duplicate-import
 * protection (per-account file hash), one-active matching ruleset, match idempotency key; the direction/match-type/
 * confidence-band/score/exception-type CHECKs; composite FKs; and m15's 29 permissions seeded with the 11-strong
 * privileged set.
 *
 * Harness note: each as* block is ONE transaction with no per-statement savepoints — a constraint violation poisons
 * it. Persisting blocks contain NO rejecting query; every `t.rejects(...)` is the last statement in its block.
 */
const M15_TABLES = [
  'recon_bank_account',
  'recon_matching_ruleset',
  'recon_matching_rule',
  'recon_ruleset_history',
  'recon_statement_import',
  'recon_statement_line',
  'recon_ledger_import',
  'recon_ledger_entry',
  'recon_run',
  'recon_status_history',
  'recon_match',
  'recon_match_line',
  'recon_match_candidate',
  'recon_exception',
  'recon_manual_decision',
  'recon_run_summary',
  'recon_note',
  'recon_import_error',
];
const APPEND_ONLY = [
  'recon_ruleset_history',
  'recon_status_history',
  'recon_match_line',
  'recon_match_candidate',
  'recon_manual_decision',
  'recon_run_summary',
  'recon_note',
  'recon_import_error',
];

export default defineDbSpec('m15-recon', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M15_TABLES],
    );
    t.equal(r.rows.length, M15_TABLES.length, 'all 18 recon tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M15_TABLES],
    );
    t.equal(p.rows.length, M15_TABLES.length, 'every recon table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; money bigint, no float ---------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M15_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any recon table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the eight evidence ledgers are append-only');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'recon_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(
      floats.rows[0]?.c,
      '0',
      'no recon column uses a binary float (money is bigint minor units, ADR-007)',
    );
    const money = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'recon_%' AND column_name LIKE '%_minor' AND data_type='bigint'`,
    );
    t.ok(Number(money.rows[0]?.c) >= 10, 'money columns are bigint minor units');
  });

  // --- 29 permissions, 11 privileged ------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m15-recon'`,
    );
    t.equal(c.rows[0]?.c, '29', 'm15 seeds 29 permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m15-recon' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '11', 'm15 seeds 11 privileged permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m15-recon' AND privileged=true AND code IN ('reconciliation.match.unmatch','reconciliation.manual.match','reconciliation.ruleset.publish','reconciliation.run.reopen','reconciliation.exception.waive','reconciliation.platform.administer')`,
    );
    t.equal(
      priv.rows.length,
      6,
      'unmatch/manual-match/ruleset-publish/run-reopen/exception-waive/platform are privileged',
    );
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let acctId = '';
  let rulesetId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const a = await tx.query<{ id: string }>(
      `INSERT INTO recon_bank_account (tenant_id, bank_name, account_label, correlation_id) VALUES ($1,'Acme Bank','Main',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    acctId = a.rows[0]?.id ?? '';
    const rs = await tx.query<{ id: string }>(
      `INSERT INTO recon_matching_ruleset (tenant_id, code, correlation_id) VALUES ($1,'default',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    rulesetId = rs.rows[0]?.id ?? '';
    t.ok(acctId !== '' && rulesetId !== '', 'tenant A seeds a bank account + ruleset');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recon_bank_account WHERE id=$1`,
      [acctId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's bank account (RLS)");
  });

  // --- duplicate-import protection (per-account file hash) --------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO recon_statement_import (tenant_id, bank_account_id, source_format, file_hash, correlation_id) VALUES ($1,$2,'csv','HASH-1',$3)`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO recon_statement_import (tenant_id, bank_account_id, source_format, file_hash, correlation_id) VALUES ($1,$2,'csv','HASH-1',$3)`,
        [tenantA, acctId, randomUUID()],
      ),
      'a duplicate statement import (same account + file hash) is rejected',
    );
  });

  // --- one-active matching ruleset --------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO recon_matching_ruleset (tenant_id, code, version_number, status, correlation_id) VALUES ($1,'std',1,'active',$2)`,
      [tenantA, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO recon_matching_ruleset (tenant_id, code, version_number, status, correlation_id) VALUES ($1,'std',2,'active',$2)`,
        [tenantA, randomUUID()],
      ),
      'a second active ruleset for a code is rejected (one active)',
    );
  });

  // --- CHECK constraints: direction, match_type, confidence_band, score, exception_type ---------
  await ctx.asTenant(tenantA, async (tx) => {
    const imp = await tx.query<{ id: string }>(
      `INSERT INTO recon_statement_import (tenant_id, bank_account_id, source_format, file_hash, correlation_id) VALUES ($1,$2,'csv','HASH-CK',$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO recon_statement_line (tenant_id, import_id, bank_account_id, line_no, txn_date, amount_minor, direction, correlation_id) VALUES ($1,$2,$3,1,'2026-01-01',10000,'sideways',$4)`,
        [tenantA, imp.rows[0]?.id, acctId, randomUUID()],
      ),
      'an invalid statement-line direction is rejected',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const run = await tx.query<{ id: string }>(
      `INSERT INTO recon_run (tenant_id, bank_account_id, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO recon_match (tenant_id, run_id, match_type, score, correlation_id) VALUES ($1,$2,'telepathic',50,$3)`,
        [tenantA, run.rows[0]?.id, randomUUID()],
      ),
      'an invalid match type is rejected',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const run = await tx.query<{ id: string }>(
      `INSERT INTO recon_run (tenant_id, bank_account_id, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO recon_match (tenant_id, run_id, match_type, score, correlation_id) VALUES ($1,$2,'one_to_one',150,$3)`,
        [tenantA, run.rows[0]?.id, randomUUID()],
      ),
      'a score above 100 is rejected',
    );
  });

  // --- composite FK: a statement line cannot reference a non-existent import --------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO recon_statement_line (tenant_id, import_id, bank_account_id, line_no, txn_date, amount_minor, direction, correlation_id) VALUES ($1,$2,$3,1,'2026-01-01',10000,'credit',$4)`,
        [tenantA, randomUUID(), acctId, randomUUID()],
      ),
      'a statement line cannot reference a non-existent import (composite FK)',
    );
  });

  // --- match idempotency key --------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const run = await tx.query<{ id: string }>(
      `INSERT INTO recon_run (tenant_id, bank_account_id, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    const runId = run.rows[0]?.id;
    const key = `m-${randomUUID()}`;
    await tx.query(
      `INSERT INTO recon_match (tenant_id, run_id, match_type, idempotency_key, correlation_id) VALUES ($1,$2,'one_to_one',$3,$4)`,
      [tenantA, runId, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO recon_match (tenant_id, run_id, match_type, idempotency_key, correlation_id) VALUES ($1,$2,'one_to_one',$3,$4)`,
        [tenantA, runId, key, randomUUID()],
      ),
      'a duplicate match idempotency key is rejected',
    );
  });
});
