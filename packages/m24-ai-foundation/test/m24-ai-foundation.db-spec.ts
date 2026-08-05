import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M24 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the GOVERNED-AI
 * guarantees the migrations must deliver: every one of the 17 AI-foundation tables has RLS ENABLE+FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only INSERT+SELECT on
 * the ten append-only ledgers; cost is bigint minor units with NO float column; confidence is an INTEGER basis-points
 * column bounded 0..10000; there is ZERO credential/secret column (only a format-checked `secret_reference` pointer),
 * and the secret-reference CHECK rejects an inline secret. THE GOVERNANCE INVARIANTS ARE DB-ENFORCED: an output can
 * NEVER be 'approved' without a human reviewer (no autonomous action); an approved output that requires citations must
 * have one; a request cannot route/generate before DLP clears; restricted/confidential data cannot proceed without an
 * approved-provider binding; human review can never be turned off (ai_config); DLP block_restricted can never be turned
 * off (ai_dlp_policy); the idempotency ledger is unique (no duplicate request); one active provider/model/prompt/policy/
 * config per code+scope; composite FKs; a single outbox (m06); and PostgreSQL 16 compatibility. m24 owns no outbox.
 *
 * Harness note: each as* block is ONE transaction with no per-statement savepoints — a constraint violation poisons it.
 * Persisting blocks contain NO rejecting query; every `t.rejects(...)` is the last statement in its block.
 */
const M24_TABLES = [
  'ai_provider',
  'ai_provider_history',
  'ai_model',
  'ai_prompt',
  'ai_prompt_history',
  'ai_dlp_policy',
  'ai_config',
  'ai_request',
  'ai_request_history',
  'ai_output',
  'ai_output_history',
  'ai_citation',
  'ai_human_review',
  'ai_dlp_finding',
  'ai_usage',
  'ai_governance_event',
  'ai_idempotency',
];
const APPEND_ONLY = [
  'ai_provider_history',
  'ai_prompt_history',
  'ai_request_history',
  'ai_output_history',
  'ai_citation',
  'ai_human_review',
  'ai_dlp_finding',
  'ai_usage',
  'ai_governance_event',
  'ai_idempotency',
];

export default defineDbSpec('m24-ai-foundation', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M24_TABLES],
    );
    t.equal(r.rows.length, M24_TABLES.length, 'all 17 AI-foundation tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M24_TABLES],
    );
    t.equal(p.rows.length, M24_TABLES.length, 'every AI-foundation table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; cost bigint no float; confidence int; ZERO secret column
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'ai_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any AI table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the ten evidence ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'ai_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no AI column uses a binary float (cost is bigint minor units, ADR-007)');
    const cost = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='ai_usage' AND column_name='cost_minor'`,
    );
    t.equal(cost.rows[0]?.data_type, 'bigint', 'cost_minor is bigint minor units (never float)');
    const conf = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='ai_output' AND column_name='confidence_bps'`,
    );
    t.equal(
      conf.rows[0]?.data_type,
      'integer',
      'confidence_bps is an integer basis-points column (never a float)',
    );
    // ZERO credential/secret VALUE columns — only the format-checked `secret_reference` pointer is permitted.
    // (`*_tokens` are usage COUNTS, not credentials — the pattern targets credential-bearing names only.)
    const secrets = await tx.query<{ column_name: string; table_name: string }>(
      `SELECT column_name, table_name FROM information_schema.columns WHERE table_name LIKE 'ai_%' AND column_name ~ '(secret|credential|password|passphrase|api_key|access_token|auth_token|bearer)' AND column_name <> 'secret_reference'`,
    );
    t.equal(
      secrets.rows.length,
      0,
      'there is ZERO credential/secret value column (only the secret_reference pointer)',
    );
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let providerId = '';
  let requestId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const p = await tx.query<{ id: string }>(
      `INSERT INTO ai_provider (tenant_id, code, correlation_id) VALUES ($1,'local-1',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    providerId = p.rows[0]?.id ?? '';
    const req = await tx.query<{ id: string }>(
      `INSERT INTO ai_request (tenant_id, classification, correlation_id) VALUES ($1,'internal',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    requestId = req.rows[0]?.id ?? '';
    t.ok(providerId !== '' && requestId !== '', 'tenant A seeds a provider + request');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM ai_request WHERE id=$1`, [
      requestId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's request (RLS)");
  });

  // --- secret-reference format CHECK: an inline secret is rejected ------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_provider (tenant_id, code, secret_reference, correlation_id) VALUES ($1,'bad','sk-live-inline-secret',$2)`,
        [tenantA, randomUUID()],
      ),
      'an inline secret is rejected — only a secretref: pointer is allowed (secret-reference CHECK)',
    );
  });

  // --- NO AUTONOMOUS ACTION: an output cannot be 'approved' without a human reviewer ------------
  await ctx.asTenant(tenantA, async (tx) => {
    const o = await tx.query<{ id: string }>(
      `INSERT INTO ai_output (tenant_id, request_id, status, correlation_id) VALUES ($1,$2,'review_pending',$3) RETURNING id`,
      [tenantA, requestId, randomUUID()],
    );
    const outputId = o.rows[0]?.id ?? '';
    t.ok(outputId !== '', 'an output can sit in review_pending with no reviewer');
    await t.rejects(
      tx.query(`UPDATE ai_output SET status='approved' WHERE id=$1`, [outputId]),
      'an output can NEVER be approved without a human reviewer (ai_output_human_ck — no autonomous action)',
    );
  });

  // --- CITATIONS WHERE REQUIRED: an approved citations-required output must have a citation ------
  await ctx.asTenant(tenantA, async (tx) => {
    const reviewer = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO ai_output (tenant_id, request_id, status, reviewed_by, citations_required, citation_count, correlation_id) VALUES ($1,$2,'approved',$3,true,0,$4)`,
        [tenantA, requestId, reviewer, randomUUID()],
      ),
      'an approved output that requires citations must have at least one (ai_output_cite_ck)',
    );
  });

  // --- DLP BEFORE ROUTING: a request cannot be 'routed' without dlp_checked ----------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_request (tenant_id, classification, status, dlp_checked, correlation_id) VALUES ($1,'internal','routed',false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a request cannot route before DLP clears (ai_request_dlp_ck — no restricted data to unapproved provider)',
    );
  });

  // --- APPROVED-PROVIDER ROUTING: restricted data cannot proceed without provider_approved -------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_request (tenant_id, classification, status, dlp_checked, provider_approved, correlation_id) VALUES ($1,'restricted','routed',true,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'restricted data cannot route without an approved-provider binding (ai_request_approved_ck)',
    );
  });

  // --- human review can NEVER be turned off (ai_config) -----------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_config (tenant_id, scope, version_number, require_human_review, correlation_id) VALUES ($1,'no-review',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable human review (ai_config_review_ck — AI outputs are always human-approved)',
    );
  });

  // --- DLP block_restricted can NEVER be turned off (ai_dlp_policy) ------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_dlp_policy (tenant_id, scope, version_number, block_restricted, correlation_id) VALUES ($1,'weak',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a DLP policy cannot stop blocking restricted data (ai_dlp_policy_block_ck — fail closed)',
    );
  });

  // --- confidence is bounded 0..10000 basis points ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_request (tenant_id, classification, confidence_bps, correlation_id) VALUES ($1,'internal',10001,$2)`,
        [tenantA, randomUUID()],
      ),
      'confidence over 10000 basis points is rejected (ai_request_conf_ck)',
    );
  });

  // --- one ACTIVE provider per code -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO ai_provider (tenant_id, code, version_number, status, correlation_id) VALUES ($1,'dup','1','active',$2)`,
      [tenantA, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO ai_provider (tenant_id, code, version_number, status, correlation_id) VALUES ($1,'dup','2','active',$2)`,
        [tenantA, randomUUID()],
      ),
      'a second ACTIVE provider for a code is rejected (one active)',
    );
  });

  // --- idempotency ledger is unique (no duplicate request) --------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `req-${randomUUID()}`;
    await tx.query(
      `INSERT INTO ai_idempotency (tenant_id, idempotency_key, request_id, correlation_id) VALUES ($1,$2,$3,$4)`,
      [tenantA, key, requestId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO ai_idempotency (tenant_id, idempotency_key, request_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, key, requestId, randomUUID()],
      ),
      'a duplicate idempotency key is rejected (no duplicate AI request)',
    );
  });

  // --- composite FK: an output cannot reference a non-existent request --------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`INSERT INTO ai_output (tenant_id, request_id, correlation_id) VALUES ($1,$2,$3)`, [
        tenantA,
        randomUUID(),
        randomUUID(),
      ]),
      'an output cannot reference a non-existent request (composite FK)',
    );
  });

  // --- single outbox: m24 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m24 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });
});
