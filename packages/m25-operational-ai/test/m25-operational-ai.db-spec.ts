import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M25 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the RECOMMENDS-ONLY
 * guarantees the migrations must deliver across the 9 operational-AI tables: every table has RLS ENABLE+FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only INSERT+SELECT on
 * the 5 append-only ledgers; confidence is an INTEGER basis-points column bounded 0..10000 and there is NO float column;
 * there is ZERO secret column. THE GOVERNANCE INVARIANTS ARE DB-ENFORCED: an analysis / a suggestion can NEVER reach a
 * decided state (accepted/rejected/dismissed) without a HUMAN reviewer (no autonomous action); config can never turn
 * human review off and can never enable auto-apply; the idempotency ledger is unique; composite FKs; a single outbox
 * (m06 — m25 owns none); and PostgreSQL 16 compatibility.
 *
 * Harness note: each as* block is ONE transaction; every `t.rejects(...)` is the last statement in its block.
 */
const M25_TABLES = [
  'ops_ai_config',
  'ops_ai_subject',
  'ops_ai_analysis',
  'ops_ai_analysis_history',
  'ops_ai_suggestion',
  'ops_ai_suggestion_history',
  'ops_ai_evidence',
  'ops_ai_review',
  'ops_ai_idempotency',
];
const APPEND_ONLY = [
  'ops_ai_analysis_history',
  'ops_ai_suggestion_history',
  'ops_ai_evidence',
  'ops_ai_review',
  'ops_ai_idempotency',
];

export default defineDbSpec('m25-operational-ai', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M25_TABLES],
    );
    t.equal(r.rows.length, M25_TABLES.length, 'all 9 operational-AI tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M25_TABLES],
    );
    t.equal(p.rows.length, M25_TABLES.length, 'every operational-AI table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; confidence integer; no float; ZERO secret column --------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'ops_ai_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any operational-AI table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the five evidence ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'ops_ai_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no operational-AI column uses a binary float');
    const conf = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='ops_ai_analysis' AND column_name='confidence_bps'`,
    );
    t.equal(
      conf.rows[0]?.data_type,
      'integer',
      'confidence_bps is an integer basis-points column (never a float)',
    );
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'ops_ai_%' AND column_name ~ '(secret|credential|password|passphrase|api_key|access_token|auth_token)'`,
    );
    t.equal(secrets.rows.length, 0, 'there is ZERO credential/secret column (m25 stores opaque refs only)');
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let subjectId = '';
  let analysisId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO ops_ai_subject (tenant_id, subject_type, subject_ref, correlation_id) VALUES ($1,'feedback',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), randomUUID()],
    );
    subjectId = s.rows[0]?.id ?? '';
    const a = await tx.query<{ id: string }>(
      `INSERT INTO ops_ai_analysis (tenant_id, subject_id, analysis_kind, status, correlation_id) VALUES ($1,$2,'summary','review_pending',$3) RETURNING id`,
      [tenantA, subjectId, randomUUID()],
    );
    analysisId = a.rows[0]?.id ?? '';
    t.ok(subjectId !== '' && analysisId !== '', 'tenant A seeds a subject + analysis');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM ops_ai_analysis WHERE id=$1`, [
      analysisId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's analysis (RLS)");
  });

  // --- NO AUTONOMOUS ACTION: an analysis cannot be decided without a human reviewer --------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE ops_ai_analysis SET status='accepted' WHERE id=$1`, [analysisId]),
      'an analysis can NEVER be accepted without a human reviewer (ops_ai_analysis_human_ck — no autonomous action)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ops_ai_analysis (tenant_id, subject_id, analysis_kind, status, reviewed_by, correlation_id) VALUES ($1,$2,'sentiment','rejected',NULL,$3)`,
        [tenantA, subjectId, randomUUID()],
      ),
      'a rejected analysis with no reviewer is refused (human accountability)',
    );
  });

  // --- RECOMMENDS ONLY: a suggestion cannot be decided without a human ---------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO ops_ai_suggestion (tenant_id, analysis_id, suggestion_type, correlation_id) VALUES ($1,$2,'escalation',$3) RETURNING id`,
      [tenantA, analysisId, randomUUID()],
    );
    const suggestionId = s.rows[0]?.id ?? '';
    t.ok(suggestionId !== '', 'a suggestion can be created in suggested');
    await t.rejects(
      tx.query(`UPDATE ops_ai_suggestion SET status='accepted' WHERE id=$1`, [suggestionId]),
      'a suggestion can NEVER be accepted without a human (ops_ai_suggestion_human_ck — recommends only)',
    );
  });

  // --- config: human review can never be turned off ---------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ops_ai_config (tenant_id, scope, version_number, require_human_review, correlation_id) VALUES ($1,'no-review',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable human review (ops_ai_config_review_ck)',
    );
  });

  // --- config: auto-apply can never be enabled (NO autonomous action) ---------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ops_ai_config (tenant_id, scope, version_number, auto_apply, correlation_id) VALUES ($1,'auto',1,true,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot enable auto-apply (ops_ai_config_autoapply_ck — m25 recommends only)',
    );
  });

  // --- confidence is bounded 0..10000 -----------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ops_ai_analysis (tenant_id, subject_id, analysis_kind, confidence_bps, correlation_id) VALUES ($1,$2,'summary',10001,$3)`,
        [tenantA, subjectId, randomUUID()],
      ),
      'confidence over 10000 basis points is rejected (ops_ai_analysis_conf_ck)',
    );
  });

  // --- idempotency ledger is unique -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `an-${randomUUID()}`;
    await tx.query(
      `INSERT INTO ops_ai_idempotency (tenant_id, idempotency_key, analysis_id, correlation_id) VALUES ($1,$2,$3,$4)`,
      [tenantA, key, analysisId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO ops_ai_idempotency (tenant_id, idempotency_key, analysis_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, key, analysisId, randomUUID()],
      ),
      'a duplicate idempotency key is rejected (no duplicate analysis)',
    );
  });

  // --- composite FK: an analysis cannot reference a non-existent subject -------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ops_ai_analysis (tenant_id, subject_id, analysis_kind, correlation_id) VALUES ($1,$2,'summary',$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'an analysis cannot reference a non-existent subject (composite FK)',
    );
  });

  // --- single outbox: m25 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m25 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });
});
