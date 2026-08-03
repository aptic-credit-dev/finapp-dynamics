import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M21 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform guarantees
 * the migrations must deliver: every one of the 18 journal tables has RLS ENABLE+FORCE + a tenant_isolation policy;
 * tenant isolation holds; the application role has NO DELETE anywhere and only INSERT+SELECT on the ten append-only
 * ledgers; money is bigint minor units with NO float column; the balanced-before-advance invariant is DB-enforced (a
 * draft cannot leave 'draft' unless debits == credits); draft-balance evidence is balanced iff debits == credits; a
 * posting request cannot become postable without an approval reference (no posting without approval), into a closed/
 * locked period (no closed-period posting), or with the approver == requester (SoD); the posting idempotency ledger is
 * unique (no duplicate posting); one active journal type/config per code/scope; composite FKs; line direction/amount
 * CHECKs; and m21's 27 permissions seeded with the 9-strong privileged set.
 *
 * Harness note: each as* block is ONE transaction with no per-statement savepoints — a constraint violation poisons
 * it. Persisting blocks contain NO rejecting query; every `t.rejects(...)` is the last statement in its block.
 */
const M21_TABLES = [
  'journal_type',
  'journal_config',
  'journal_reason_code',
  'journal_recommendation',
  'journal_recommendation_line',
  'journal_recommendation_history',
  'journal_draft',
  'journal_line',
  'journal_status_history',
  'journal_draft_balance',
  'journal_note',
  'journal_validation',
  'journal_validation_finding',
  'posting_request',
  'posting_request_history',
  'posting_result',
  'posting_result_history',
  'posting_idempotency',
];
const APPEND_ONLY = [
  'journal_recommendation_line',
  'journal_recommendation_history',
  'journal_status_history',
  'journal_draft_balance',
  'journal_note',
  'journal_validation',
  'journal_validation_finding',
  'posting_request_history',
  'posting_result_history',
  'posting_idempotency',
];

export default defineDbSpec('m21-journal', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M21_TABLES],
    );
    t.equal(r.rows.length, M21_TABLES.length, 'all 18 journal tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M21_TABLES],
    );
    t.equal(p.rows.length, M21_TABLES.length, 'every journal table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; money bigint, no float ---------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M21_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any journal table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the ten evidence ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE (table_name LIKE 'journal_%' OR table_name LIKE 'posting_%') AND data_type IN ('real','double precision')`,
    );
    t.equal(
      floats.rows[0]?.c,
      '0',
      'no journal/posting column uses a binary float (money is bigint minor units, ADR-007)',
    );
    const money = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE (table_name LIKE 'journal_%' OR table_name LIKE 'posting_%') AND column_name LIKE '%_minor' AND data_type='bigint'`,
    );
    t.ok(Number(money.rows[0]?.c) >= 8, 'money columns are bigint minor units');
  });

  // --- 27 permissions, 9 privileged -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m21-journal'`,
    );
    t.equal(c.rows[0]?.c, '27', 'm21 seeds 27 permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m21-journal' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '9', 'm21 seeds 9 privileged permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m21-journal' AND privileged=true AND code IN ('journals.posting_request.create','journals.posting_request.authorize','journals.posting_result.record','journals.config.publish','journals.type.manage')`,
    );
    t.equal(
      priv.rows.length,
      5,
      'posting create/authorize, result record, config publish and type manage are privileged',
    );
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let draftId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const d = await tx.query<{ id: string }>(
      `INSERT INTO journal_draft (tenant_id, entity_ref, correlation_id, requested_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [tenantA, randomUUID(), randomUUID(), randomUUID()],
    );
    draftId = d.rows[0]?.id ?? '';
    t.ok(draftId !== '', 'tenant A seeds a draft journal');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM journal_draft WHERE id=$1`, [
      draftId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's draft (RLS)");
  });

  // --- BALANCED BEFORE ADVANCE: a draft cannot leave 'draft' unless debits == credits -----------
  await ctx.asTenant(tenantA, async (tx) => {
    const d = await tx.query<{ id: string }>(
      `INSERT INTO journal_draft (tenant_id, entity_ref, total_debits_minor, total_credits_minor, is_balanced, correlation_id) VALUES ($1,$2,10000,9000,false,$3) RETURNING id`,
      [tenantA, randomUUID(), randomUUID()],
    );
    await t.rejects(
      tx.query(`UPDATE journal_draft SET status='validated' WHERE id=$1`, [d.rows[0]?.id]),
      'an unbalanced draft cannot advance out of draft (balanced-before-advance CHECK)',
    );
  });

  // --- is_balanced must equal (debits == credits) -----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO journal_draft (tenant_id, entity_ref, total_debits_minor, total_credits_minor, is_balanced, correlation_id) VALUES ($1,$2,10000,9000,true,$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'is_balanced cannot claim balanced when debits != credits (CHECK)',
    );
  });

  // --- draft-balance evidence: balanced iff debits == credits -----------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO journal_draft_balance (tenant_id, draft_id, debits_minor, credits_minor, variance_minor, balanced, correlation_id) VALUES ($1,$2,10000,10000,0,true,$3)`,
      [tenantA, draftId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO journal_draft_balance (tenant_id, draft_id, debits_minor, credits_minor, variance_minor, balanced, correlation_id) VALUES ($1,$2,10000,9000,1000,true,$3)`,
        [tenantA, draftId, randomUUID()],
      ),
      'balance evidence cannot claim balanced with a non-zero variance (CHECK)',
    );
  });

  // --- line: amount > 0 and direction --------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO journal_line (tenant_id, draft_id, line_no, account_ref, direction, amount_minor, correlation_id) VALUES ($1,$2,1,$3,'debit',0,$4)`,
        [tenantA, draftId, randomUUID(), randomUUID()],
      ),
      'a non-positive line amount is rejected',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO journal_line (tenant_id, draft_id, line_no, account_ref, direction, amount_minor, correlation_id) VALUES ($1,$2,2,$3,'sideways',10000,$4)`,
        [tenantA, draftId, randomUUID(), randomUUID()],
      ),
      'an invalid line direction is rejected',
    );
  });

  // --- composite FK: a line cannot reference a non-existent draft --------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO journal_line (tenant_id, draft_id, line_no, account_ref, direction, amount_minor, correlation_id) VALUES ($1,$2,1,$3,'debit',10000,$4)`,
        [tenantA, randomUUID(), randomUUID(), randomUUID()],
      ),
      'a line cannot reference a non-existent draft (composite FK)',
    );
  });

  // --- NO POSTING WITHOUT APPROVAL: a request cannot be 'ready' without an approval_ref ----------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO posting_request (tenant_id, draft_id, status, approval_ref, correlation_id) VALUES ($1,$2,'ready',NULL,$3)`,
        [tenantA, draftId, randomUUID()],
      ),
      'a posting request cannot be ready without an approval reference (no posting without approval)',
    );
  });

  // --- NO CLOSED-PERIOD POSTING: a request cannot be 'ready' in a closed period ------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO posting_request (tenant_id, draft_id, status, approval_ref, period_status, correlation_id) VALUES ($1,$2,'ready',$3,'closed',$4)`,
        [tenantA, draftId, randomUUID(), randomUUID()],
      ),
      'a posting request cannot become postable while the period is closed (no closed-period posting)',
    );
  });

  // --- MAKER != CHECKER (SoD): the approver cannot be the requester ------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const who = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO posting_request (tenant_id, draft_id, status, requested_by, approved_by, correlation_id) VALUES ($1,$2,'prepared',$3,$3,$4)`,
        [tenantA, draftId, who, randomUUID()],
      ),
      'a posting request whose approver is its requester is rejected (segregation of duties)',
    );
  });

  // --- NO DUPLICATE POSTING: the idempotency ledger is unique per key ----------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `post-${randomUUID()}`;
    await tx.query(
      `INSERT INTO posting_idempotency (tenant_id, idempotency_key, draft_id, correlation_id) VALUES ($1,$2,$3,$4)`,
      [tenantA, key, draftId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO posting_idempotency (tenant_id, idempotency_key, draft_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, key, draftId, randomUUID()],
      ),
      'a duplicate posting idempotency key is rejected (no duplicate posting)',
    );
  });

  // --- one active journal type per code ---------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO journal_type (tenant_id, code, version_number, status, correlation_id) VALUES ($1,'std',1,'active',$2)`,
      [tenantA, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO journal_type (tenant_id, code, version_number, status, correlation_id) VALUES ($1,'std',2,'active',$2)`,
        [tenantA, randomUUID()],
      ),
      'a second active journal type for a code is rejected (one active)',
    );
  });

  // --- one active journal config per scope ------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO journal_config (tenant_id, scope, version_number, status, correlation_id) VALUES ($1,'default',1,'active',$2)`,
      [tenantA, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO journal_config (tenant_id, scope, version_number, status, correlation_id) VALUES ($1,'default',2,'active',$2)`,
        [tenantA, randomUUID()],
      ),
      'a second active config for a scope is rejected (one active)',
    );
  });

  // --- require_balanced can never be disabled ---------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO journal_config (tenant_id, scope, version_number, require_balanced, correlation_id) VALUES ($1,'no-balance',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable balanced-before-post (require_balanced CHECK)',
    );
  });

  // --- single outbox: m21 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m21 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });
});
