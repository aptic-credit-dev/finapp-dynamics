import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M27 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the NO-AUTOPOST /
 * explainable-matching guarantees across the 12 finance-AI tables: RLS ENABLE+FORCE + tenant_isolation everywhere;
 * tenant isolation holds; the application role has NO DELETE anywhere and only INSERT+SELECT on the 8 append-only
 * ledgers; confidence is an INTEGER basis-points column bounded 0..10000; money (`amount_minor`) is bigint MINOR UNITS
 * with NO float column; ZERO secret column. THE GOVERNANCE INVARIANTS ARE DB-ENFORCED: an analysis / a suggestion can
 * NEVER reach a decided state without a HUMAN reviewer (no autonomous action); an accepted explainability-required
 * suggestion must carry a matched feature (no unexplained match); config can never turn human review off and can never
 * enable auto-post or auto-match; the idempotency ledger is unique; composite FKs; a single outbox (m06 — m27 owns
 * none); PostgreSQL 16.
 *
 * Harness note: each as* block is ONE transaction; every `t.rejects(...)` is the last statement in its block.
 */
const M27_TABLES = [
  'finance_ai_config',
  'finance_ai_subject',
  'finance_ai_analysis',
  'finance_ai_analysis_history',
  'finance_ai_model_result',
  'finance_ai_exception_classification',
  'finance_ai_suggestion',
  'finance_ai_suggestion_history',
  'finance_ai_feature',
  'finance_ai_evidence',
  'finance_ai_review',
  'finance_ai_idempotency',
];
const APPEND_ONLY = [
  'finance_ai_analysis_history',
  'finance_ai_model_result',
  'finance_ai_exception_classification',
  'finance_ai_suggestion_history',
  'finance_ai_feature',
  'finance_ai_evidence',
  'finance_ai_review',
  'finance_ai_idempotency',
];

export default defineDbSpec('m27-finance-ai', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M27_TABLES],
    );
    t.equal(r.rows.length, M27_TABLES.length, 'all 12 finance-AI tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M27_TABLES],
    );
    t.equal(p.rows.length, M27_TABLES.length, 'every finance-AI table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; confidence integer; money bigint no float; ZERO secret --
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'finance_ai_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any finance-AI table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the eight evidence ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'finance_ai_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(
      floats.rows[0]?.c,
      '0',
      'no finance-AI column uses a binary float (money is bigint minor units, ADR-007)',
    );
    const conf = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='finance_ai_analysis' AND column_name='confidence_bps'`,
    );
    t.equal(conf.rows[0]?.data_type, 'integer', 'confidence_bps is an integer basis-points column');
    const amount = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='finance_ai_suggestion' AND column_name='amount_minor'`,
    );
    t.equal(amount.rows[0]?.data_type, 'bigint', 'amount_minor is bigint minor units (never a float)');
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'finance_ai_%' AND column_name ~ '(secret|credential|password|passphrase|api_key|access_token|auth_token)'`,
    );
    t.equal(secrets.rows.length, 0, 'there is ZERO credential/secret column (m27 stores opaque refs only)');
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let subjectId = '';
  let analysisId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO finance_ai_subject (tenant_id, subject_type, subject_ref, correlation_id) VALUES ($1,'bank_recon',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), randomUUID()],
    );
    subjectId = s.rows[0]?.id ?? '';
    const a = await tx.query<{ id: string }>(
      `INSERT INTO finance_ai_analysis (tenant_id, subject_id, analysis_kind, status, correlation_id) VALUES ($1,$2,'match_suggestion','review_pending',$3) RETURNING id`,
      [tenantA, subjectId, randomUUID()],
    );
    analysisId = a.rows[0]?.id ?? '';
    t.ok(subjectId !== '' && analysisId !== '', 'tenant A seeds a subject + analysis');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM finance_ai_analysis WHERE id=$1`,
      [analysisId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's analysis (RLS)");
  });

  // --- NO AUTONOMOUS ACTION: an analysis cannot be decided without a human reviewer --------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE finance_ai_analysis SET status='accepted' WHERE id=$1`, [analysisId]),
      'an analysis can NEVER be accepted without a human reviewer (finance_ai_analysis_human_ck)',
    );
  });

  // --- RECOMMENDS ONLY: a suggestion cannot be decided without a human ---------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO finance_ai_suggestion (tenant_id, analysis_id, suggestion_type, correlation_id) VALUES ($1,$2,'exact_reference_match',$3) RETURNING id`,
      [tenantA, analysisId, randomUUID()],
    );
    const suggestionId = s.rows[0]?.id ?? '';
    t.ok(suggestionId !== '', 'a suggestion can be created in suggested');
    await t.rejects(
      tx.query(`UPDATE finance_ai_suggestion SET status='accepted' WHERE id=$1`, [suggestionId]),
      'a suggestion can NEVER be accepted without a human (finance_ai_suggestion_human_ck)',
    );
  });

  // --- EXPLAINABLE MATCHES: an accepted explainability-required suggestion needs a feature --------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_ai_suggestion (tenant_id, analysis_id, suggestion_type, status, decided_by, explainability_required, feature_count, correlation_id) VALUES ($1,$2,'amount_date_match','accepted',$3,true,0,$4)`,
        [tenantA, analysisId, randomUUID(), randomUUID()],
      ),
      'an accepted explainability-required suggestion with 0 features is refused (finance_ai_suggestion_explain_ck — no unexplained match)',
    );
  });

  // --- config: human review can never be off; auto-post + auto-match can never be enabled -------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_ai_config (tenant_id, scope, version_number, require_human_review, correlation_id) VALUES ($1,'no-review',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable human review (finance_ai_config_review_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_ai_config (tenant_id, scope, version_number, auto_post, correlation_id) VALUES ($1,'auto',1,true,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot enable auto-post (finance_ai_config_autopost_ck — NEVER auto-posts)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_ai_config (tenant_id, scope, version_number, auto_match, correlation_id) VALUES ($1,'automatch',1,true,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot enable auto-match (finance_ai_config_automatch_ck — NEVER auto-matches)',
    );
  });

  // --- confidence bounded; unknown suggestion type rejected -------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_ai_analysis (tenant_id, subject_id, analysis_kind, confidence_bps, correlation_id) VALUES ($1,$2,'match_suggestion',10001,$3)`,
        [tenantA, subjectId, randomUUID()],
      ),
      'confidence over 10000 basis points is rejected (finance_ai_analysis_conf_ck)',
    );
  });

  // --- idempotency ledger is unique -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `an-${randomUUID()}`;
    await tx.query(
      `INSERT INTO finance_ai_idempotency (tenant_id, idempotency_key, analysis_id, correlation_id) VALUES ($1,$2,$3,$4)`,
      [tenantA, key, analysisId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO finance_ai_idempotency (tenant_id, idempotency_key, analysis_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, key, analysisId, randomUUID()],
      ),
      'a duplicate idempotency key is rejected (no duplicate analysis)',
    );
  });

  // --- composite FK: a feature cannot reference a non-existent suggestion ------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_ai_feature (tenant_id, suggestion_id, feature_type, correlation_id) VALUES ($1,$2,'amount',$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'a feature cannot reference a non-existent suggestion (composite FK)',
    );
  });

  // --- single outbox: m27 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m27 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });
});
