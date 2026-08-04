import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M22 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform guarantees
 * the migrations must deliver: every one of the 24 approval tables has RLS ENABLE+FORCE + a tenant_isolation policy;
 * tenant isolation holds; the application role has NO DELETE anywhere and only INSERT+SELECT on the eighteen append-only
 * ledgers; money is bigint minor units with NO float column; the maker-checker + SoD invariants are DB-enforced (a
 * request's final approver is never its requester; an approving decision's actor is never the maker; a delegate is
 * never the delegator; an override actor is never the maker); a request cannot be 'approved' without meeting quorum and
 * naming a final approver; escalation is single-fire per level and depth-bounded; the idempotency ledger is unique (no
 * duplicate action); SoD enforcement (enforce_sod) can never be disabled; one active policy per subject_type+scope; a
 * released outcome must be an approval with an approver; composite FKs; and m22's 25 permissions seeded with the
 * 12-strong privileged set.
 *
 * Harness note: each as* block is ONE transaction with no per-statement savepoints — a constraint violation poisons it.
 * Persisting blocks contain NO rejecting query; every `t.rejects(...)` is the last statement in its block.
 */
const M22_TABLES = [
  'approval_policy',
  'approval_policy_step',
  'approval_policy_history',
  'approval_config',
  'approval_reason_code',
  'approval_request',
  'approval_request_step',
  'approval_decision',
  'approval_status_history',
  'approval_step_history',
  'approval_assignment',
  'approval_delegation',
  'approval_delegation_history',
  'approval_sod_check',
  'approval_participant',
  'approval_escalation',
  'approval_timer',
  'approval_notification',
  'approval_workflow_link',
  'approval_idempotency',
  'approval_note',
  'approval_evidence',
  'approval_outcome',
  'approval_override',
];
const APPEND_ONLY = [
  'approval_policy_step',
  'approval_policy_history',
  'approval_status_history',
  'approval_step_history',
  'approval_decision',
  'approval_assignment',
  'approval_delegation_history',
  'approval_sod_check',
  'approval_participant',
  'approval_escalation',
  'approval_timer',
  'approval_notification',
  'approval_workflow_link',
  'approval_idempotency',
  'approval_note',
  'approval_evidence',
  'approval_outcome',
  'approval_override',
];

export default defineDbSpec('m22-approval', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M22_TABLES],
    );
    t.equal(r.rows.length, M22_TABLES.length, 'all 24 approval tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M22_TABLES],
    );
    t.equal(p.rows.length, M22_TABLES.length, 'every approval table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; money bigint, no float ---------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M22_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any approval table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the eighteen evidence ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'approval_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(
      floats.rows[0]?.c,
      '0',
      'no approval column uses a binary float (money is bigint minor units, ADR-007)',
    );
    const money = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'approval_%' AND column_name LIKE '%_minor' AND data_type='bigint'`,
    );
    t.ok(Number(money.rows[0]?.c) >= 2, 'money columns are bigint minor units');
  });

  // --- 25 permissions, 12 privileged ------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m22-approval'`,
    );
    t.equal(c.rows[0]?.c, '25', 'm22 seeds 25 permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m22-approval' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '12', 'm22 seeds 12 privileged permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m22-approval' AND privileged=true AND code IN ('approvals.decision.approve','approvals.decision.reject','approvals.decision.override','approvals.policy.publish','approvals.delegation.manage')`,
    );
    t.equal(
      priv.rows.length,
      5,
      'decision approve/reject/override, policy publish and delegation manage are privileged',
    );
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let requestId = '';
  const maker = randomUUID();
  await ctx.asTenant(tenantA, async (tx) => {
    const d = await tx.query<{ id: string }>(
      `INSERT INTO approval_request (tenant_id, subject_type, requested_by, correlation_id) VALUES ($1,'journal_posting',$2,$3) RETURNING id`,
      [tenantA, maker, randomUUID()],
    );
    requestId = d.rows[0]?.id ?? '';
    t.ok(requestId !== '', 'tenant A seeds an approval request');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM approval_request WHERE id=$1`, [
      requestId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's request (RLS)");
  });

  // --- MAKER != CHECKER (SoD): final approver cannot be the requester ----------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO approval_request (tenant_id, subject_type, requested_by, final_approver, approvals_count, required_approvals, status, correlation_id) VALUES ($1,'journal_posting',$2,$2,1,1,'approved',$3)`,
        [tenantA, maker, randomUUID()],
      ),
      'a request whose final approver is its requester is rejected (maker != checker / SoD)',
    );
  });

  // --- NO APPROVAL WITHOUT QUORUM: cannot be 'approved' below the required approvals -------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO approval_request (tenant_id, subject_type, requested_by, final_approver, approvals_count, required_approvals, status, correlation_id) VALUES ($1,'journal_posting',$2,$3,1,2,'approved',$4)`,
        [tenantA, maker, randomUUID(), randomUUID()],
      ),
      'a request cannot be approved below its required-approvals quorum (no approval without quorum)',
    );
  });

  // --- an approving DECISION's actor is never the request's maker --------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO approval_decision (tenant_id, request_id, decision, actor, maker, correlation_id) VALUES ($1,$2,'approve',$3,$3,$4)`,
        [tenantA, requestId, maker, randomUUID()],
      ),
      'an approve decision whose actor is the maker is rejected (maker != checker)',
    );
  });

  // --- a delegate can never be the delegator ----------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const who = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO approval_delegation (tenant_id, delegator, delegate, subject_type, correlation_id) VALUES ($1,$2,$2,'journal_posting',$3)`,
        [tenantA, who, randomUUID()],
      ),
      'a self-delegation (delegate == delegator) is rejected',
    );
  });

  // --- an OVERRIDE actor is never the maker (SoD still applies) ----------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO approval_override (tenant_id, request_id, override_type, actor, maker, justification, correlation_id) VALUES ($1,$2,'override_approve',$3,$3,'x',$4)`,
        [tenantA, requestId, maker, randomUUID()],
      ),
      'an override whose actor is the maker is rejected (SoD applies to overrides)',
    );
  });

  // --- enforce_sod can never be disabled --------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO approval_config (tenant_id, scope, version_number, enforce_sod, correlation_id) VALUES ($1,'no-sod',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable Segregation of Duties (enforce_sod CHECK)',
    );
  });

  // --- one active policy per subject_type+scope -------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO approval_policy (tenant_id, subject_type, scope, version_number, status, correlation_id) VALUES ($1,'journal_posting','default',1,'active',$2)`,
      [tenantA, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO approval_policy (tenant_id, subject_type, scope, version_number, status, correlation_id) VALUES ($1,'journal_posting','default',2,'active',$2)`,
        [tenantA, randomUUID()],
      ),
      'a second active policy for a subject_type+scope is rejected (one active)',
    );
  });

  // --- escalation: single-fire per level --------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO approval_escalation (tenant_id, request_id, to_level, depth, correlation_id) VALUES ($1,$2,2,1,$3)`,
      [tenantA, requestId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO approval_escalation (tenant_id, request_id, to_level, depth, correlation_id) VALUES ($1,$2,2,2,$3)`,
        [tenantA, requestId, randomUUID()],
      ),
      'a second escalation to the same level is rejected (single-fire; no duplicate escalation)',
    );
  });

  // --- escalation: bounded depth ----------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO approval_escalation (tenant_id, request_id, to_level, depth, correlation_id) VALUES ($1,$2,99,21,$3)`,
        [tenantA, requestId, randomUUID()],
      ),
      'an escalation past the maximum depth is rejected (bounded escalation)',
    );
  });

  // --- idempotency ledger is unique -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `req-${randomUUID()}`;
    await tx.query(
      `INSERT INTO approval_idempotency (tenant_id, idempotency_key, purpose, request_id, correlation_id) VALUES ($1,$2,'request',$3,$4)`,
      [tenantA, key, requestId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO approval_idempotency (tenant_id, idempotency_key, purpose, request_id, correlation_id) VALUES ($1,$2,'request',$3,$4)`,
        [tenantA, key, requestId, randomUUID()],
      ),
      'a duplicate idempotency key is rejected (no duplicate action)',
    );
  });

  // --- outcome: a released outcome must be an approval with an approver --------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO approval_outcome (tenant_id, request_id, outcome, released, correlation_id) VALUES ($1,$2,'rejected',true,$3)`,
        [tenantA, requestId, randomUUID()],
      ),
      'a released outcome that is not an approval-with-approver is rejected (nothing releases without an approver)',
    );
  });

  // --- participant: unique per (request, actor, role) -------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const who = randomUUID();
    await tx.query(
      `INSERT INTO approval_participant (tenant_id, request_id, actor, role, correlation_id) VALUES ($1,$2,$3,'checker',$4)`,
      [tenantA, requestId, who, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO approval_participant (tenant_id, request_id, actor, role, correlation_id) VALUES ($1,$2,$3,'checker',$4)`,
        [tenantA, requestId, who, randomUUID()],
      ),
      'a duplicate (request, actor, role) participant is rejected',
    );
  });

  // --- composite FK: a decision cannot reference a non-existent request -------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO approval_decision (tenant_id, request_id, decision, actor, maker, correlation_id) VALUES ($1,$2,'reject',$3,$4,$5)`,
        [tenantA, randomUUID(), randomUUID(), randomUUID(), randomUUID()],
      ),
      'a decision cannot reference a non-existent request (composite FK)',
    );
  });

  // --- single outbox: m22 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m22 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });
});
