import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M04 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform guarantees
 * the migrations must deliver for the FOUR M04-owned tables: RLS ENABLE+FORCE + tenant_isolation on each; tenant
 * isolation holds; NO DELETE anywhere and only INSERT+SELECT on the append-only operation history; the admin-operation
 * lifecycle / type / scope CHECKs; the idempotency ledger is unique (no duplicate admin action); composite FKs; the
 * admin.* catalogue (30 permissions, 17 privileged, the 2 platform permissions privileged); and — the orchestration
 * invariant — M04 mirrors NO core table (it owns only admin_* console state; tenants/roles/audit_events/etc. exist once,
 * owned by their modules). M04 owns no outbox.
 *
 * Harness note: each as* block is ONE transaction; a constraint violation poisons it. Every `t.rejects(...)` is the
 * last statement in its block.
 */
const M04_TABLES = [
  'admin_saved_view',
  'admin_preference',
  'admin_operation_request',
  'admin_operation_history',
];

export default defineDbSpec('m04-admin', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M04_TABLES],
    );
    t.equal(r.rows.length, M04_TABLES.length, 'all 4 admin tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M04_TABLES],
    );
    t.equal(p.rows.length, M04_TABLES.length, 'every admin table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only history no UPDATE -------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M04_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any admin table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name='admin_operation_history'`,
      [ctx.appRole],
    );
    t.equal(upd.rows.length, 0, 'admin_operation_history is append-only (no UPDATE)');
  });

  // --- admin.* catalogue: 30 permissions, 17 privileged, platform perms privileged ---------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m04-admin'`,
    );
    t.equal(c.rows[0]?.c, '30', 'm04 seeds 30 admin.* permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m04-admin' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '17', 'm04 seeds 17 privileged permissions');
    const plat = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m04-admin' AND privileged=true AND code IN ('admin.platform_audit.read','admin.platform.administer')`,
    );
    t.equal(plat.rows.length, 2, 'both platform (control-plane) permissions are privileged');
    const threeSeg = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m04-admin' AND array_length(string_to_array(code,'.'),1) <> 3`,
    );
    t.equal(threeSeg.rows[0]?.c, '0', 'every admin permission is a 3-segment code');
  });

  // --- NO MIRROR TABLES: m04 owns ONLY admin_* console state; core tables exist once --------------
  await ctx.asSuperuser(null, async (tx) => {
    // m04 did NOT create a duplicate of any core table under an admin_ name.
    const mirrors = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relkind='r' AND relname IN ('admin_tenant','admin_account','admin_role','admin_role_assignment','admin_sod_rule','admin_audit_event','admin_workflow_definition','admin_rule_set','admin_notification_template')`,
    );
    t.equal(
      mirrors.rows.length,
      0,
      'm04 created NO mirror of a tenant/identity/RBAC/audit/workflow/rules/notification table',
    );
    // the canonical tables exist exactly once (owned by their real modules), not duplicated by m04.
    for (const canonical of ['tenants', 'roles', 'role_assignments', 'sod_rules', 'audit_events']) {
      const r = await tx.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM pg_class WHERE relkind='r' AND relname=$1`,
        [canonical],
      );
      t.equal(
        r.rows[0]?.c,
        '1',
        `${canonical} exists exactly once (owned by its module, not mirrored by m04)`,
      );
    }
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let opId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const d = await tx.query<{ id: string }>(
      `INSERT INTO admin_operation_request (tenant_id, operation_type, correlation_id, requested_by) VALUES ($1,'tenant_suspend',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), randomUUID()],
    );
    opId = d.rows[0]?.id ?? '';
    t.ok(opId !== '', 'tenant A seeds an admin operation');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM admin_operation_request WHERE id=$1`,
      [opId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's operation (RLS)");
  });

  // --- lifecycle / type / scope CHECKs ----------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO admin_operation_request (tenant_id, operation_type, status, correlation_id) VALUES ($1,'tenant_suspend','teleported',$2)`,
        [tenantA, randomUUID()],
      ),
      'an unknown operation status is rejected (lifecycle CHECK)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO admin_operation_request (tenant_id, operation_type, correlation_id) VALUES ($1,'delete_everything',$2)`,
        [tenantA, randomUUID()],
      ),
      'an unknown operation type is rejected (type CHECK)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO admin_operation_request (tenant_id, operation_type, scope, correlation_id) VALUES ($1,'tenant_suspend','galaxy',$2)`,
        [tenantA, randomUUID()],
      ),
      'an unknown scope is rejected (scope CHECK)',
    );
  });

  // --- idempotency ledger is unique -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `op-${randomUUID()}`;
    await tx.query(
      `INSERT INTO admin_operation_request (tenant_id, operation_type, idempotency_key, correlation_id) VALUES ($1,'tenant_suspend',$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO admin_operation_request (tenant_id, operation_type, idempotency_key, correlation_id) VALUES ($1,'tenant_suspend',$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'a duplicate operation idempotency key is rejected (no duplicate admin action)',
    );
  });

  // --- saved view: one per (owner, area, name); area CHECK ---------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const owner = randomUUID();
    await tx.query(
      `INSERT INTO admin_saved_view (tenant_id, owner_ref, area, name, correlation_id) VALUES ($1,$2,'tenants','favourites',$3)`,
      [tenantA, owner, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO admin_saved_view (tenant_id, owner_ref, area, name, correlation_id) VALUES ($1,$2,'tenants','favourites',$3)`,
        [tenantA, owner, randomUUID()],
      ),
      'a duplicate saved view (owner, area, name) is rejected',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO admin_saved_view (tenant_id, owner_ref, area, name, correlation_id) VALUES ($1,$2,'nonsense','x',$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'an unknown saved-view area is rejected (area CHECK)',
    );
  });

  // --- composite FK: history cannot reference a non-existent operation ---------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO admin_operation_history (tenant_id, operation_id, to_status, correlation_id) VALUES ($1,$2,'requested',$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'operation history cannot reference a non-existent operation (composite FK)',
    );
  });

  // --- m04 owns no outbox -----------------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m04 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });
});
