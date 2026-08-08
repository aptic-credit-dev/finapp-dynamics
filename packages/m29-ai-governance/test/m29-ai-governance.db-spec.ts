import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M29 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the AI-GOVERNANCE
 * guarantees across the 7 ai_governance_* tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation
 * holds; the application role has NO DELETE anywhere and only INSERT+SELECT on the 4 append-only ledgers; confidence/
 * accuracy are INTEGER basis-points columns bounded 0..10000; there is NO float column and ZERO secret column. THE
 * GOVERNANCE INVARIANTS ARE DB-ENFORCED: a release can NEVER be approved/released without a HUMAN approver
 * (ai_governance_release_human_ck) who is NOT the proposer (ai_governance_release_sod_ck — no AI/self approval); a
 * non-waiver release can never be approved without a passing evaluation (ai_governance_release_evidence_ck); a policy
 * can never disable human approval or evaluation and can never blanket-allow a restricted provider; a governed use case
 * can never permit an AI-executed controlled action; a governance decision's decider is NOT NULL; the idempotency ledger
 * is unique; composite FKs; a single outbox (m06 — m29 owns none); PostgreSQL 16.
 */
const M29_TABLES = [
  'ai_governance_policy',
  'ai_governance_use_case',
  'ai_governance_release',
  'ai_governance_evaluation',
  'ai_governance_decision',
  'ai_governance_history',
  'ai_governance_idempotency',
];
const APPEND_ONLY = [
  'ai_governance_evaluation',
  'ai_governance_decision',
  'ai_governance_history',
  'ai_governance_idempotency',
];

export default defineDbSpec('m29-ai-governance', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M29_TABLES],
    );
    t.equal(r.rows.length, M29_TABLES.length, 'all 7 ai_governance tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M29_TABLES],
    );
    t.equal(p.rows.length, M29_TABLES.length, 'every ai_governance table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; confidence integer; no float; ZERO secret --------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'ai_governance_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any ai_governance table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(
      upd.rows.length,
      0,
      'the four evidence/decision/history/idempotency ledgers are append-only (no UPDATE)',
    );
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'ai_governance_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no ai_governance column uses a binary float');
    const acc = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='ai_governance_evaluation' AND column_name='accuracy_bps'`,
    );
    t.equal(acc.rows[0]?.data_type, 'integer', 'accuracy_bps is an integer basis-points column');
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'ai_governance_%' AND column_name ~ '(secret|credential|password|passphrase|api_key|access_token|auth_token)'`,
    );
    t.equal(secrets.rows.length, 0, 'there is ZERO credential/secret column (m29 stores opaque refs only)');
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const maker = randomUUID();
  let releaseId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO ai_governance_release (tenant_id, subject_kind, status, proposed_by, evaluation_passed, correlation_id) VALUES ($1,'model_version','review_pending',$2,true,$3) RETURNING id`,
      [tenantA, maker, randomUUID()],
    );
    releaseId = r.rows[0]?.id ?? '';
    t.ok(releaseId !== '', 'tenant A seeds a release in review_pending');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM ai_governance_release WHERE id=$1`,
      [releaseId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's release (RLS)");
  });

  // --- NO AI SELF-APPROVAL: an approved release must carry a human approver ----------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE ai_governance_release SET status='approved' WHERE id=$1`, [releaseId]),
      'a release can NEVER be approved without an approver (ai_governance_release_human_ck)',
    );
  });
  // --- maker != checker: the proposer can never be the approver ---------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE ai_governance_release SET status='approved', approved_by=$2 WHERE id=$1`, [
        releaseId,
        maker,
      ]),
      'the proposer can NEVER approve their own release (ai_governance_release_sod_ck)',
    );
  });
  // --- a human checker CAN approve --------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const checker = randomUUID();
    const r = await tx.query<{ status: string }>(
      `UPDATE ai_governance_release SET status='approved', approved_by=$2 WHERE id=$1 RETURNING status`,
      [releaseId, checker],
    );
    t.equal(
      r.rows[0]?.status,
      'approved',
      'an independent human checker can approve (approved_by != proposed_by)',
    );
  });

  // --- EVIDENCE GATE: a non-waiver release cannot be approved without a passing evaluation -------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_governance_release (tenant_id, subject_kind, status, proposed_by, approved_by, evaluation_passed, correlation_id) VALUES ($1,'model_version','approved',$2,$3,false,$4)`,
        [tenantA, randomUUID(), randomUUID(), randomUUID()],
      ),
      'a non-waiver release cannot be approved without a passing evaluation (ai_governance_release_evidence_ck)',
    );
  });
  // --- a WAIVER is exempt from the evaluation gate (still needs human approver != proposer) ------
  await ctx.asTenant(tenantA, async (tx) => {
    const w = await tx.query<{ status: string }>(
      `INSERT INTO ai_governance_release (tenant_id, subject_kind, status, proposed_by, approved_by, evaluation_passed, correlation_id) VALUES ($1,'waiver_exception','approved',$2,$3,false,$4) RETURNING status`,
      [tenantA, randomUUID(), randomUUID(), randomUUID()],
    );
    t.equal(
      w.rows[0]?.status,
      'approved',
      'a waiver can be approved without an evaluation (exempt), with a human approver',
    );
  });

  // --- policy: human approval + evaluation can never be off; restricted provider never allowed --
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_governance_policy (tenant_id, scope, version_number, require_human_approval, correlation_id) VALUES ($1,'no-human',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a policy cannot disable human approval (ai_governance_policy_human_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_governance_policy (tenant_id, scope, version_number, require_evaluation, correlation_id) VALUES ($1,'no-eval',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a policy cannot disable evaluation (ai_governance_policy_eval_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_governance_policy (tenant_id, scope, version_number, allow_restricted_provider, correlation_id) VALUES ($1,'allow-restricted',1,true,$2)`,
        [tenantA, randomUUID()],
      ),
      'a policy can never blanket-allow a restricted provider (ai_governance_policy_restricted_ck)',
    );
  });

  // --- use case: a governed use case can never permit an AI-executed controlled action ----------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_governance_use_case (tenant_id, module_ref, controlled_action_prohibited, correlation_id) VALUES ($1,'m27-finance-ai',false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a use case can never permit an AI-executed controlled action (ai_governance_use_case_noaction_ck)',
    );
  });

  // --- decision decider is NOT NULL (a human decides; AI never decides) -------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_governance_decision (tenant_id, target_type, target_id, decision, correlation_id) VALUES ($1,'release',$2,'approve',$3)`,
        [tenantA, releaseId, randomUUID()],
      ),
      'a governance decision must record a decider (decider NOT NULL — AI never decides)',
    );
  });

  // --- accuracy bounded; idempotency unique -----------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_governance_evaluation (tenant_id, release_id, accuracy_bps, correlation_id) VALUES ($1,$2,10001,$3)`,
        [tenantA, releaseId, randomUUID()],
      ),
      'accuracy over 10000 basis points is rejected (ai_governance_evaluation_acc_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `gov-${randomUUID()}`;
    await tx.query(
      `INSERT INTO ai_governance_idempotency (tenant_id, idempotency_key, release_id, correlation_id) VALUES ($1,$2,$3,$4)`,
      [tenantA, key, releaseId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO ai_governance_idempotency (tenant_id, idempotency_key, release_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, key, releaseId, randomUUID()],
      ),
      'a duplicate idempotency key is rejected (no duplicate release/decision)',
    );
  });

  // --- composite FK: an evaluation cannot reference a non-existent release -----------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO ai_governance_evaluation (tenant_id, release_id, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'an evaluation cannot reference a non-existent release (composite FK)',
    );
  });

  // --- single outbox: m29 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m29 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });

  // --- m29 permissions seeded into the shared ai.* namespace ------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m29-ai-governance' ORDER BY code`,
    );
    t.equal(
      perms.rows.length,
      3,
      'm29 seeds 3 NEW ai.governance.* permissions (read/manage already seeded by m24)',
    );
    t.ok(
      perms.rows.every((p) => p.code.startsWith('ai.governance.') && p.privileged),
      'every new m29 permission is a privileged ai.governance.* code',
    );
  });
});
