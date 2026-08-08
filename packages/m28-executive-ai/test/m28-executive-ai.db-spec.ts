import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M28 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the READ-ONLY / CITED /
 * RLS-MASKED guarantees across the 7 copilot_* tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation
 * holds; the application role has NO DELETE anywhere and only INSERT+SELECT on the 3 append-only ledgers; confidence is
 * an INTEGER basis-points column bounded 0..10000; there is NO float column and ZERO secret column. THE GOVERNANCE
 * INVARIANTS ARE DB-ENFORCED: a config can never disable read_only, citations or human-reviewed export; a query is
 * read_only (CHECK); a COMPLETED response must be CITED (copilot_response_cited_ck — no uncited factual answer); a
 * persisted citation must reference something and be entitlement-GRANTED (never leaks a masked row); the idempotency
 * ledger is unique; composite FKs; a single outbox (m06 — m28 owns none); PostgreSQL 16.
 *
 * Harness note: each as* block is ONE transaction; every `t.rejects(...)` is the last statement in its block.
 */
const M28_TABLES = [
  'copilot_config',
  'copilot_session',
  'copilot_query',
  'copilot_response',
  'copilot_citation',
  'copilot_feedback',
  'copilot_idempotency',
];
const APPEND_ONLY = ['copilot_citation', 'copilot_feedback', 'copilot_idempotency'];

export default defineDbSpec('m28-executive-ai', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M28_TABLES],
    );
    t.equal(r.rows.length, M28_TABLES.length, 'all 7 copilot tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M28_TABLES],
    );
    t.equal(p.rows.length, M28_TABLES.length, 'every copilot table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; confidence integer; no float; ZERO secret --------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'copilot_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any copilot table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the three evidence ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'copilot_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no copilot column uses a binary float');
    const conf = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='copilot_query' AND column_name='confidence_bps'`,
    );
    t.equal(conf.rows[0]?.data_type, 'integer', 'confidence_bps is an integer basis-points column');
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'copilot_%' AND column_name ~ '(secret|credential|password|passphrase|api_key|access_token|auth_token)'`,
    );
    t.equal(secrets.rows.length, 0, 'there is ZERO credential/secret column (m28 stores opaque refs only)');
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let sessionId = '';
  let queryId = '';
  let responseId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO copilot_session (tenant_id, scope_level, classification, correlation_id) VALUES ($1,'tenant','internal',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    sessionId = s.rows[0]?.id ?? '';
    const q = await tx.query<{ id: string }>(
      `INSERT INTO copilot_query (tenant_id, session_id, intent_class, status, correlation_id) VALUES ($1,$2,'executive_question','generated',$3) RETURNING id`,
      [tenantA, sessionId, randomUUID()],
    );
    queryId = q.rows[0]?.id ?? '';
    const r = await tx.query<{ id: string }>(
      `INSERT INTO copilot_response (tenant_id, query_id, confidence_bps, correlation_id) VALUES ($1,$2,8000,$3) RETURNING id`,
      [tenantA, queryId, randomUUID()],
    );
    responseId = r.rows[0]?.id ?? '';
    t.ok(
      sessionId !== '' && queryId !== '' && responseId !== '',
      'tenant A seeds a session + query + response',
    );
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM copilot_query WHERE id=$1`, [
      queryId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's query (RLS)");
  });

  // --- READ-ONLY: a query can never be non-read-only --------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_query (tenant_id, session_id, intent_class, read_only, correlation_id) VALUES ($1,$2,'executive_question',false,$3)`,
        [tenantA, sessionId, randomUUID()],
      ),
      'a query can NEVER be non-read-only (copilot_query_readonly_ck)',
    );
  });

  // --- CITED: a completed response must carry a citation ----------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE copilot_response SET status='complete', citation_count=0 WHERE id=$1`, [responseId]),
      'a completed response with 0 citations is refused (copilot_response_cited_ck — no uncited answer)',
    );
  });

  // --- CITATION must reference something AND be entitlement-granted ------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_citation (tenant_id, response_id, source_type, source_module, correlation_id) VALUES ($1,$2,'record','m19-finance',$3)`,
        [tenantA, responseId, randomUUID()],
      ),
      'a citation with no record/document ref is refused (copilot_citation_ref_ck — no fabricated source)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_citation (tenant_id, response_id, source_type, source_module, record_ref, entitlement_result, correlation_id) VALUES ($1,$2,'record','m19-finance',$3,'masked',$4)`,
        [tenantA, responseId, randomUUID(), randomUUID()],
      ),
      'a masked citation cannot be persisted (copilot_citation_granted_ck — never cite what the caller cannot see)',
    );
  });

  // --- config: read-only / citations / export-review can never be turned off --------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_config (tenant_id, scope, version_number, read_only, correlation_id) VALUES ($1,'no-read-only',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable read-only (copilot_config_readonly_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_config (tenant_id, scope, version_number, citations_required, correlation_id) VALUES ($1,'no-cite',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable citations (copilot_config_citations_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_config (tenant_id, scope, version_number, require_human_review_for_export, correlation_id) VALUES ($1,'no-review',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable human-reviewed export (copilot_config_export_review_ck)',
    );
  });

  // --- confidence bounded; unknown intent rejected ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_query (tenant_id, session_id, intent_class, confidence_bps, correlation_id) VALUES ($1,$2,'executive_question',10001,$3)`,
        [tenantA, sessionId, randomUUID()],
      ),
      'confidence over 10000 basis points is rejected (copilot_query_conf_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_query (tenant_id, session_id, intent_class, correlation_id) VALUES ($1,$2,'post_journal',$3)`,
        [tenantA, sessionId, randomUUID()],
      ),
      'an unknown/controlled intent class is rejected (copilot_query_intent_ck)',
    );
  });

  // --- idempotency ledger is unique -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `cq-${randomUUID()}`;
    await tx.query(
      `INSERT INTO copilot_idempotency (tenant_id, idempotency_key, query_id, correlation_id) VALUES ($1,$2,$3,$4)`,
      [tenantA, key, queryId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_idempotency (tenant_id, idempotency_key, query_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, key, queryId, randomUUID()],
      ),
      'a duplicate idempotency key is rejected (no duplicate query / m24 handoff)',
    );
  });

  // --- composite FK: a query cannot reference a non-existent session ----------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO copilot_query (tenant_id, session_id, intent_class, correlation_id) VALUES ($1,$2,'executive_question',$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'a query cannot reference a non-existent session (composite FK)',
    );
  });

  // --- single outbox: m28 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m28 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });

  // --- m28 permissions seeded into the shared ai.* namespace ------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m28-executive-ai' ORDER BY code`,
    );
    t.equal(perms.rows.length, 7, 'm28 seeds 7 ai.copilot.* permissions');
    t.ok(
      perms.rows.every((p) => p.code.startsWith('ai.copilot.')),
      'every m28 permission is in the shared ai.* namespace',
    );
    const privileged = perms.rows
      .filter((p) => p.privileged)
      .map((p) => p.code)
      .sort();
    t.deepEqual(
      privileged,
      ['ai.copilot.configure', 'ai.copilot.export', 'ai.copilot.platform', 'ai.copilot.sensitive'],
      'export/sensitive/configure/platform are the privileged copilot permissions',
    );
  });
});
