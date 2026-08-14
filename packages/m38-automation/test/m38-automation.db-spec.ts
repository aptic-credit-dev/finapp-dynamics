import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M38 Scheduler/Automation/Extensions DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the
 * guarantees across the 10 automation_/extension_ tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation
 * holds; NO DELETE and INSERT+SELECT only on the 6 append-only ledgers; NO float; ZERO secret VALUE columns (a step's config
 * secret is an opaque secretref: pointer). THE INVARIANTS ARE DB-ENFORCED: an active automation + a published extension are
 * IMMUTABLE (triggers); neither can be activated/published without a passing validation (evidence_ck); an automation step +
 * an extension point must carry a 3-segment m02 permission (perm_ck — the facade rule); a step secret must match the
 * secretref: shape; a schedule interval must be >= 60s (frequency floor — no job storm); at most one succeeded run per
 * (automation, run_key); a review DECISION needs a decider and decided_by <> requested_by (SoD); the automation./extensions.
 * permissions are seeded; a single outbox (m06 — m38 owns none); PostgreSQL 16.
 */
const M38_TABLES = [
  'automation_definition',
  'automation_step',
  'automation_schedule',
  'automation_run',
  'automation_review',
  'automation_history',
  'automation_idempotency',
  'extension_definition',
  'extension_point',
  'extension_installation',
];
const APPEND_ONLY = [
  'automation_step',
  'automation_run',
  'automation_review',
  'automation_history',
  'automation_idempotency',
  'extension_point',
];

export default defineDbSpec('m38-automation', async (ctx, t) => {
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M38_TABLES],
    );
    t.equal(r.rows.length, M38_TABLES.length, 'all 10 automation/extension tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M38_TABLES],
    );
    t.equal(
      p.rows.length,
      M38_TABLES.length,
      'every automation/extension table has a tenant_isolation policy',
    );
  });

  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND (table_name LIKE 'automation_%' OR table_name LIKE 'extension_%')`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any automation/extension table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the six append-only ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE (table_name LIKE 'automation_%' OR table_name LIKE 'extension_%') AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no automation/extension column uses a binary float');
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE (table_name LIKE 'automation_%' OR table_name LIKE 'extension_%')
         AND column_name ~ '(password|passphrase|api[_]?key|access_token|auth_token|private_key|secret_value|credential|secret_material)'
         AND column_name !~ '(_id|_ref|_hash)$'`,
    );
    t.equal(
      secrets.rows.length,
      0,
      'ZERO secret VALUE column (a step config secret is an opaque secretref pointer)',
    );
    const autoTrig = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_trigger WHERE tgrelid::regclass::text = 'automation_definition' AND NOT tgisinternal`,
    );
    t.equal(autoTrig.rows[0]?.c, '1', 'one immutability trigger (automation_definition)');
    const extTrig = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_trigger WHERE tgrelid::regclass::text = 'extension_definition' AND NOT tgisinternal`,
    );
    t.equal(extTrig.rows[0]?.c, '1', 'one immutability trigger (extension_definition)');
  });

  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m38-automation' ORDER BY code`,
    );
    t.equal(perms.rows.length, 9, 'nine automation.*/extensions.* permissions are seeded');
    t.ok(
      perms.rows.every(
        (p) =>
          (p.code.startsWith('automation.') || p.code.startsWith('extensions.')) &&
          p.code.split('.').length === 3,
      ),
      'all seeded codes are 3-segment automation.*/extensions.*',
    );
    t.ok(
      perms.rows.find((p) => p.code === 'automation.job.activate')?.privileged === true,
      'automation activation is privileged',
    );
    t.ok(
      perms.rows.find((p) => p.code === 'extensions.registry.publish')?.privileged === true,
      'extension publish is privileged',
    );
    const outboxes = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%outbox%'`,
    );
    t.ok(
      outboxes.rows.length === 1 && outboxes.rows[0]?.table_name === 'workflow_event_outbox',
      'exactly one outbox (m06) — m38 owns none',
    );
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  let automationId = '';
  let extensionId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const a = await tx.query<{ id: string }>(
      `INSERT INTO automation_definition (tenant_id, scope, automation_key, name, trigger_kind, state, validation_passed, content_hash, correlation_id, created_by)
       VALUES ($1,'tenant','nightly','Nightly','schedule','active',true,'sha256:x',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    automationId = a.rows[0]?.id ?? '';
    const e = await tx.query<{ id: string }>(
      `INSERT INTO extension_definition (tenant_id, scope, extension_key, name, trust_tier, isolation_level, state, validation_passed, content_hash, correlation_id, created_by)
       VALUES ($1,'tenant','ext1','Ext One','verified','sandboxed','published',true,'sha256:y',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    extensionId = e.rows[0]?.id ?? '';
    // a succeeded run (idempotency anchor).
    await tx.query(
      `INSERT INTO automation_run (tenant_id, automation_id, run_key, attempt_no, status, correlation_id) VALUES ($1,$2,'rk-1',1,'succeeded',$3)`,
      [tenantA, automationId, randomUUID()],
    );
    t.ok(
      automationId !== '' && extensionId !== '',
      'tenant A seeds an active automation, a published extension and a run',
    );
  });

  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM automation_definition WHERE id=$1`,
      [automationId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's automation (RLS)");
  });

  // active automation + published extension are IMMUTABLE (triggers) — each reject in its own tx.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE automation_definition SET automation_key='other' WHERE id=$1`, [automationId]),
      'an active automation key is immutable (trigger)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE extension_definition SET state='draft' WHERE id=$1`, [extensionId]),
      'a published extension may only move to deprecated (trigger)',
    );
  });

  // evidence_ck (automation + extension) + one-active/one-published
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO automation_definition (tenant_id, scope, automation_key, name, state, validation_passed, content_hash, correlation_id) VALUES ($1,'tenant','k2','n','active',false,'sha256:z',$2)`,
        [tenantA, randomUUID()],
      ),
      'an automation cannot be active without validation_passed (evidence_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO extension_definition (tenant_id, scope, extension_key, name, state, validation_passed, content_hash, correlation_id) VALUES ($1,'tenant','ext1','dupe','published',true,'sha256:w',$2)`,
        [tenantA, randomUUID()],
      ),
      'only one published extension per key (extension_definition_one_published)',
    );
  });

  // FACADE rule: a step / extension point without a 3-segment permission is refused.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO automation_step (tenant_id, automation_id, step_no, capability_ref, required_permission, correlation_id) VALUES ($1,$2,1,'cap','post',$3)`,
        [tenantA, automationId, randomUUID()],
      ),
      'a step must carry a 3-segment m02 permission (automation_step_perm_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO extension_point (tenant_id, extension_id, point_key, capability_ref, required_permission, correlation_id) VALUES ($1,$2,'p1','cap','x',$3)`,
        [tenantA, extensionId, randomUUID()],
      ),
      'an extension point must carry a 3-segment m02 permission (extension_point_perm_ck)',
    );
  });

  // step secret must be an opaque secretref (a raw value is refused).
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO automation_step (tenant_id, automation_id, step_no, capability_ref, required_permission, config_secret_ref, correlation_id) VALUES ($1,$2,2,'cap','a.b.c','hunter2',$3)`,
        [tenantA, automationId, randomUUID()],
      ),
      'a step config secret must be an opaque secretref (automation_step_secret_ref_ck)',
    );
  });

  // schedule frequency floor — no job storm.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO automation_schedule (tenant_id, automation_id, schedule_key, recurrence, min_interval_seconds, correlation_id) VALUES ($1,$2,'s1','every:5',5,$3)`,
        [tenantA, automationId, randomUUID()],
      ),
      'a schedule interval below the floor is refused (automation_schedule_freq_ck)',
    );
  });

  // one succeeded run per (automation, run_key).
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO automation_run (tenant_id, automation_id, run_key, attempt_no, status, correlation_id) VALUES ($1,$2,'rk-1',2,'succeeded',$3)`,
        [tenantA, automationId, randomUUID()],
      ),
      'at most one succeeded run per (automation, run_key) (automation_run_one_succeeded)',
    );
  });

  // maker-checker DB CHECKs on automation_review.
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO automation_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'automation',$2,'approved',$3,$3,$4)`,
        [tenantA, automationId, requester, randomUUID()],
      ),
      'a decider can never be the requester (automation_review_sod_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO automation_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'automation',$2,'approved',$3,NULL,$4)`,
        [tenantA, automationId, requester, randomUUID()],
      ),
      'an approved decision requires a decider (automation_review_decider_ck)',
    );
  });

  // idempotency uniqueness: success then reject.
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO automation_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO automation_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'the idempotency ledger rejects a duplicate key (automation_idempotency_key_uk)',
    );
  });
});
