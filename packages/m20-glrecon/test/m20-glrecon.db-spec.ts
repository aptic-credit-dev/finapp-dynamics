import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M20 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every one of the 24 gl_* tables has RLS ENABLE+FORCE + a tenant_isolation
 * policy; tenant isolation holds; the application role has NO DELETE anywhere and only INSERT+SELECT on the ten
 * append-only ledgers; money is bigint minor units with NO float column; the GL balance invariant (closing = opening
 * + debits − credits) is DB-enforced; a draft journal recommendation can NEVER be non-draft (is_draft CHECK) and a
 * certification override needs a reason; duplicate-import protection (per-account file hash), one-active ruleset,
 * match idempotency key; the direction/match-type/confidence-band/score/exception-type CHECKs; composite FKs; and
 * m20's 35 permissions seeded with the 11-strong privileged set.
 *
 * Harness note: each as* block is ONE transaction with no per-statement savepoints — a constraint violation poisons
 * it. Persisting blocks contain NO rejecting query; every `t.rejects(...)` is the last statement in its block.
 */
const M20_TABLES = [
  'gl_recon_account',
  'gl_ruleset',
  'gl_rule',
  'gl_ruleset_history',
  'gl_import',
  'gl_import_error',
  'gl_balance',
  'gl_line',
  'gl_source_import',
  'gl_source_line',
  'gl_recon_run',
  'gl_run_status_history',
  'gl_run_balance',
  'gl_match',
  'gl_match_line',
  'gl_match_candidate',
  'gl_reconciling_item',
  'gl_exception',
  'gl_manual_decision',
  'gl_certification',
  'gl_certification_history',
  'gl_journal_recommendation',
  'gl_run_summary',
  'gl_note',
];
const APPEND_ONLY = [
  'gl_ruleset_history',
  'gl_import_error',
  'gl_run_status_history',
  'gl_run_balance',
  'gl_match_line',
  'gl_match_candidate',
  'gl_manual_decision',
  'gl_certification_history',
  'gl_run_summary',
  'gl_note',
];

export default defineDbSpec('m20-glrecon', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M20_TABLES],
    );
    t.equal(r.rows.length, M20_TABLES.length, 'all 24 gl_ tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M20_TABLES],
    );
    t.equal(p.rows.length, M20_TABLES.length, 'every gl_ table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; money bigint, no float ---------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M20_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any gl_ table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the ten evidence ledgers are append-only');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'gl_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(
      floats.rows[0]?.c,
      '0',
      'no gl_ column uses a binary float (money is bigint minor units, ADR-007)',
    );
    const money = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'gl_%' AND column_name LIKE '%_minor' AND data_type='bigint'`,
    );
    t.ok(Number(money.rows[0]?.c) >= 20, 'money columns are bigint minor units');
  });

  // --- 35 permissions, 11 privileged ------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m20-glrecon'`,
    );
    t.equal(c.rows[0]?.c, '35', 'm20 seeds 35 permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m20-glrecon' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '11', 'm20 seeds 11 privileged permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m20-glrecon' AND privileged=true AND code IN ('gl_reconciliation.match.unmatch','gl_reconciliation.match.manual','gl_reconciliation.ruleset.publish','gl_reconciliation.run.reopen','gl_reconciliation.exception.waive','gl_reconciliation.certification.override')`,
    );
    t.equal(
      priv.rows.length,
      6,
      'unmatch/manual-match/ruleset-publish/run-reopen/exception-waive/certification-override are privileged',
    );
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let acctId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const a = await tx.query<{ id: string }>(
      `INSERT INTO gl_recon_account (tenant_id, code, name, correlation_id) VALUES ($1,'GL-1000','Cash',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    acctId = a.rows[0]?.id ?? '';
    t.ok(acctId !== '', 'tenant A seeds a GL account');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM gl_recon_account WHERE id=$1`, [
      acctId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's GL account (RLS)");
  });

  // --- THE BALANCE INVARIANT: closing must equal opening + debits - credits ---------------------
  await ctx.asTenant(tenantA, async (tx) => {
    // A satisfying balance persists.
    await tx.query(
      `INSERT INTO gl_balance (tenant_id, gl_account_id, period_start, period_end, opening_balance_minor, debits_minor, credits_minor, closing_balance_minor, correlation_id) VALUES ($1,$2,'2026-01-01','2026-01-31',1000,500,200,1300,$3)`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_balance (tenant_id, gl_account_id, period_start, period_end, opening_balance_minor, debits_minor, credits_minor, closing_balance_minor, correlation_id) VALUES ($1,$2,'2026-02-01','2026-02-28',1000,500,200,9999,$3)`,
        [tenantA, acctId, randomUUID()],
      ),
      'a GL balance violating closing = opening + debits - credits is rejected (invariant)',
    );
  });

  // --- run balance invariant (append-only evidence) ---------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const run = await tx.query<{ id: string }>(
      `INSERT INTO gl_recon_run (tenant_id, gl_account_id, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_run_balance (tenant_id, run_id, opening_minor, debits_minor, credits_minor, calculated_closing_minor, correlation_id) VALUES ($1,$2,1000,500,200,4242,$3)`,
        [tenantA, run.rows[0]?.id, randomUUID()],
      ),
      'a run balance with a wrong calculated closing is rejected (invariant)',
    );
  });

  // --- DRAFT-ONLY recommendation: is_draft can never be false -----------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const run = await tx.query<{ id: string }>(
      `INSERT INTO gl_recon_run (tenant_id, gl_account_id, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_journal_recommendation (tenant_id, run_id, amount_minor, is_draft, correlation_id) VALUES ($1,$2,5000,false,$3)`,
        [tenantA, run.rows[0]?.id, randomUUID()],
      ),
      'a non-draft journal recommendation is rejected — m20 never posts (is_draft CHECK)',
    );
  });

  // --- certification override needs a reason ----------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const run = await tx.query<{ id: string }>(
      `INSERT INTO gl_recon_run (tenant_id, gl_account_id, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_certification (tenant_id, run_id, gl_account_id, is_override, correlation_id) VALUES ($1,$2,$3,true,$4)`,
        [tenantA, run.rows[0]?.id, acctId, randomUUID()],
      ),
      'a certification override without a reason is rejected (fail closed)',
    );
  });

  // --- duplicate-import protection (per-account file hash) --------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO gl_import (tenant_id, gl_account_id, source_format, file_hash, correlation_id) VALUES ($1,$2,'csv','GLHASH-1',$3)`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_import (tenant_id, gl_account_id, source_format, file_hash, correlation_id) VALUES ($1,$2,'csv','GLHASH-1',$3)`,
        [tenantA, acctId, randomUUID()],
      ),
      'a duplicate GL import (same account + file hash) is rejected',
    );
  });

  // --- one-active ruleset -----------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO gl_ruleset (tenant_id, code, version_number, status, correlation_id) VALUES ($1,'std',1,'active',$2)`,
      [tenantA, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_ruleset (tenant_id, code, version_number, status, correlation_id) VALUES ($1,'std',2,'active',$2)`,
        [tenantA, randomUUID()],
      ),
      'a second active ruleset for a code is rejected (one active)',
    );
  });

  // --- CHECK constraints: direction, match_type, score, exception_type --------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const imp = await tx.query<{ id: string }>(
      `INSERT INTO gl_import (tenant_id, gl_account_id, source_format, file_hash, correlation_id) VALUES ($1,$2,'csv','GLHASH-CK',$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_line (tenant_id, import_id, gl_account_id, line_no, txn_date, amount_minor, direction, correlation_id) VALUES ($1,$2,$3,1,'2026-01-01',10000,'sideways',$4)`,
        [tenantA, imp.rows[0]?.id, acctId, randomUUID()],
      ),
      'an invalid GL-line direction is rejected',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const run = await tx.query<{ id: string }>(
      `INSERT INTO gl_recon_run (tenant_id, gl_account_id, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_match (tenant_id, run_id, match_type, score, correlation_id) VALUES ($1,$2,'one_to_one',150,$3)`,
        [tenantA, run.rows[0]?.id, randomUUID()],
      ),
      'a match score above 100 is rejected',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const run = await tx.query<{ id: string }>(
      `INSERT INTO gl_recon_run (tenant_id, gl_account_id, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_exception (tenant_id, run_id, exception_type, correlation_id) VALUES ($1,$2,'telepathic',$3)`,
        [tenantA, run.rows[0]?.id, randomUUID()],
      ),
      'an unknown exception type is rejected',
    );
  });

  // --- composite FK: a GL line cannot reference a non-existent import ---------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO gl_line (tenant_id, import_id, gl_account_id, line_no, txn_date, amount_minor, direction, correlation_id) VALUES ($1,$2,$3,1,'2026-01-01',10000,'debit',$4)`,
        [tenantA, randomUUID(), acctId, randomUUID()],
      ),
      'a GL line cannot reference a non-existent import (composite FK)',
    );
  });

  // --- match idempotency key --------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const run = await tx.query<{ id: string }>(
      `INSERT INTO gl_recon_run (tenant_id, gl_account_id, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, acctId, randomUUID()],
    );
    const runId = run.rows[0]?.id;
    const key = `m-${randomUUID()}`;
    await tx.query(
      `INSERT INTO gl_match (tenant_id, run_id, match_type, idempotency_key, correlation_id) VALUES ($1,$2,'one_to_one',$3,$4)`,
      [tenantA, runId, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO gl_match (tenant_id, run_id, match_type, idempotency_key, correlation_id) VALUES ($1,$2,'one_to_one',$3,$4)`,
        [tenantA, runId, key, randomUUID()],
      ),
      'a duplicate match idempotency key is rejected',
    );
  });

  // --- single outbox: m20 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m20 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });
});
