import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M26 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the LEGAL-ADVISORY
 * guarantees the migrations must deliver across the 11 legal-AI tables: RLS ENABLE+FORCE + tenant_isolation everywhere;
 * tenant isolation holds; the application role has NO DELETE anywhere and only INSERT+SELECT on the 7 append-only
 * ledgers; confidence is an INTEGER basis-points column bounded 0..10000 and there is NO float column; ZERO secret
 * column. THE GOVERNANCE INVARIANTS ARE DB-ENFORCED: an analysis / a suggestion can NEVER reach a decided state without
 * a HUMAN reviewer (no autonomous legal action); an accepted citations-required analysis must have a citation; a finding
 * is 'extracted' or 'inferred' — NEVER a verified legal fact; config can never turn human review off or enable
 * auto-apply; the idempotency ledger is unique; composite FKs; a single outbox (m06 — m26 owns none); PostgreSQL 16.
 *
 * Harness note: each as* block is ONE transaction; every `t.rejects(...)` is the last statement in its block.
 */
const M26_TABLES = [
  'legal_ai_config',
  'legal_ai_subject',
  'legal_ai_analysis',
  'legal_ai_analysis_history',
  'legal_ai_finding',
  'legal_ai_citation',
  'legal_ai_suggestion',
  'legal_ai_suggestion_history',
  'legal_ai_review',
  'legal_ai_evidence',
  'legal_ai_idempotency',
];
const APPEND_ONLY = [
  'legal_ai_analysis_history',
  'legal_ai_finding',
  'legal_ai_citation',
  'legal_ai_suggestion_history',
  'legal_ai_review',
  'legal_ai_evidence',
  'legal_ai_idempotency',
];

export default defineDbSpec('m26-legal-ai', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M26_TABLES],
    );
    t.equal(r.rows.length, M26_TABLES.length, 'all 11 legal-AI tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M26_TABLES],
    );
    t.equal(p.rows.length, M26_TABLES.length, 'every legal-AI table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; confidence integer; no float; ZERO secret column --------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'legal_ai_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any legal-AI table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the seven evidence ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'legal_ai_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no legal-AI column uses a binary float');
    const conf = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='legal_ai_analysis' AND column_name='confidence_bps'`,
    );
    t.equal(conf.rows[0]?.data_type, 'integer', 'confidence_bps is an integer basis-points column');
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'legal_ai_%' AND column_name ~ '(secret|credential|password|passphrase|api_key|access_token|auth_token)'`,
    );
    t.equal(secrets.rows.length, 0, 'there is ZERO credential/secret column (m26 stores opaque refs only)');
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let subjectId = '';
  let analysisId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO legal_ai_subject (tenant_id, subject_type, matter_ref, correlation_id) VALUES ($1,'matter',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), randomUUID()],
    );
    subjectId = s.rows[0]?.id ?? '';
    const a = await tx.query<{ id: string }>(
      `INSERT INTO legal_ai_analysis (tenant_id, subject_id, analysis_kind, status, correlation_id) VALUES ($1,$2,'matter_summary','review_pending',$3) RETURNING id`,
      [tenantA, subjectId, randomUUID()],
    );
    analysisId = a.rows[0]?.id ?? '';
    t.ok(subjectId !== '' && analysisId !== '', 'tenant A seeds a subject + analysis');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM legal_ai_analysis WHERE id=$1`, [
      analysisId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's analysis (RLS)");
  });

  // --- NO AUTONOMOUS ACTION: an analysis cannot be decided without a human reviewer --------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE legal_ai_analysis SET status='accepted' WHERE id=$1`, [analysisId]),
      'an analysis can NEVER be accepted without a human reviewer (legal_ai_analysis_human_ck)',
    );
  });

  // --- CITATIONS WHERE REQUIRED: an accepted citations-required analysis must have a citation -----
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legal_ai_analysis (tenant_id, subject_id, analysis_kind, status, reviewed_by, citations_required, citation_count, correlation_id) VALUES ($1,$2,'chronology','accepted',$3,true,0,$4)`,
        [tenantA, subjectId, randomUUID(), randomUUID()],
      ),
      'an accepted citations-required analysis with 0 citations is refused (legal_ai_analysis_cite_ck)',
    );
  });

  // --- FACT vs INFERENCE: a finding is never a "verified" legal fact -----------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legal_ai_finding (tenant_id, analysis_id, finding_type, fact_status, correlation_id) VALUES ($1,$2,'extracted_fact','verified',$3)`,
        [tenantA, analysisId, randomUUID()],
      ),
      'an AI finding cannot be labelled a verified legal fact (legal_ai_finding_factstatus_ck)',
    );
  });

  // --- RECOMMENDS ONLY: a suggestion cannot be decided without a human ---------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO legal_ai_suggestion (tenant_id, analysis_id, suggestion_type, correlation_id) VALUES ($1,$2,'procedural',$3) RETURNING id`,
      [tenantA, analysisId, randomUUID()],
    );
    const suggestionId = s.rows[0]?.id ?? '';
    t.ok(suggestionId !== '', 'a suggestion can be created in suggested');
    await t.rejects(
      tx.query(`UPDATE legal_ai_suggestion SET status='accepted' WHERE id=$1`, [suggestionId]),
      'a suggestion can NEVER be accepted without a human (legal_ai_suggestion_human_ck)',
    );
  });

  // --- config: human review can never be turned off; auto-apply can never be enabled ------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legal_ai_config (tenant_id, scope, version_number, require_human_review, correlation_id) VALUES ($1,'no-review',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable human review (legal_ai_config_review_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legal_ai_config (tenant_id, scope, version_number, auto_apply, correlation_id) VALUES ($1,'auto',1,true,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot enable auto-apply (legal_ai_config_autoapply_ck — advisory only)',
    );
  });

  // --- confidence is bounded 0..10000 -----------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legal_ai_analysis (tenant_id, subject_id, analysis_kind, confidence_bps, correlation_id) VALUES ($1,$2,'matter_summary',10001,$3)`,
        [tenantA, subjectId, randomUUID()],
      ),
      'confidence over 10000 basis points is rejected (legal_ai_analysis_conf_ck)',
    );
  });

  // --- privilege classification CHECK -----------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legal_ai_subject (tenant_id, subject_type, matter_ref, privilege_classification, correlation_id) VALUES ($1,'matter',$2,'top_secret',$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'an unknown privilege classification is rejected (legal_ai_subject_priv_ck)',
    );
  });

  // --- idempotency ledger is unique -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `an-${randomUUID()}`;
    await tx.query(
      `INSERT INTO legal_ai_idempotency (tenant_id, idempotency_key, analysis_id, correlation_id) VALUES ($1,$2,$3,$4)`,
      [tenantA, key, analysisId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO legal_ai_idempotency (tenant_id, idempotency_key, analysis_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, key, analysisId, randomUUID()],
      ),
      'a duplicate idempotency key is rejected (no duplicate analysis)',
    );
  });

  // --- composite FK: a finding cannot reference a non-existent analysis --------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legal_ai_finding (tenant_id, analysis_id, finding_type, correlation_id) VALUES ($1,$2,'risk_flag',$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'a finding cannot reference a non-existent analysis (composite FK)',
    );
  });

  // --- single outbox: m26 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m26 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });
});
