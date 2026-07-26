import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M08 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every m08 table has RLS ENABLE + FORCE with a tenant_isolation
 * policy; tenant isolation actually holds (a second tenant sees nothing); the application role has NO DELETE
 * anywhere and only INSERT+SELECT on the append-only delivery evidence; the one-ACTIVE-version and idempotency
 * unique indexes hold; and m08's 21 permissions are seeded with the right privileged set.
 */
const M08_TABLES = [
  'notification_template',
  'notification_template_version',
  'notification_request',
  'notification_delivery',
  'escalation_policy',
  'escalation_instance',
  'notification_preference',
  'inbox_notification',
];

export default defineDbSpec('m08-notify', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation on every table ------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname = ANY($1) ORDER BY relname`,
      [M08_TABLES],
    );
    t.equal(r.rows.length, M08_TABLES.length, 'all 8 m08 tables exist');
    for (const row of r.rows) {
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    }
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M08_TABLES],
    );
    t.equal(p.rows.length, M08_TABLES.length, 'every m08 table has a tenant_isolation policy');
  });

  // --- application-role grants: NO DELETE anywhere; delivery is append-only (no UPDATE) ---------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants
       WHERE grantee = $1 AND privilege_type = 'DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M08_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m08 table');
    const upd = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.role_table_grants
       WHERE grantee = $1 AND privilege_type = 'UPDATE' AND table_name = 'notification_delivery'`,
      [ctx.appRole],
    );
    t.equal(upd.rows[0]?.c, '0', 'delivery evidence is append-only (no UPDATE grant)');
    const ins = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.role_table_grants
       WHERE grantee = $1 AND privilege_type = 'INSERT' AND table_name = 'notification_delivery'`,
      [ctx.appRole],
    );
    t.equal(ins.rows[0]?.c, '1', 'delivery evidence is INSERT-able (append)');
  });

  // --- permissions seeded (21, with the expected privileged set) --------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module = 'm08-notify'`,
    );
    t.equal(r.rows[0]?.c, '21', 'm08 seeds 21 permissions');
    const priv = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module = 'm08-notify' AND privileged = true`,
    );
    t.equal(
      priv.rows[0]?.c,
      '7',
      'seven m08 permissions are privileged (publish/activate/retire, request.retry, escalation.manage, suppression.manage, platform.administer)',
    );
    const admin = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code = 'notifications.platform.administer' AND privileged = true`,
    );
    t.equal(admin.rows[0]?.c, '1', 'notifications.platform.administer is privileged');
  });

  // --- tenant isolation: a second tenant sees nothing (through the app role) --------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let templateId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO notification_template (tenant_id, key, name, channel) VALUES ($1, 'welcome', 'Welcome', 'email') RETURNING id`,
      [tenantA],
    );
    templateId = r.rows[0]?.id ?? '';
    t.ok(templateId !== '', 'tenant A inserts a template');
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query(`SELECT id FROM notification_template WHERE key = 'welcome'`);
    t.equal(r.rows.length, 1, 'tenant A reads its own template');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query(`SELECT id FROM notification_template WHERE key = 'welcome'`);
    t.equal(r.rows.length, 0, 'tenant B sees NONE of tenant A rows (RLS isolation)');
  });
  // Fail-closed: no tenant bound => no rows visible.
  await ctx.asTenant(null, async (tx) => {
    const r = await tx.query(`SELECT id FROM notification_template`);
    t.equal(r.rows.length, 0, 'with no tenant bound, the app role sees nothing (fail closed)');
  });

  // --- one ACTIVE version per template (partial unique index) -----------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO notification_template_version (tenant_id, template_id, version_number, status, spec, content_hash)
       VALUES ($1, $2, 1, 'ACTIVE', '{}'::jsonb, 'sha256:x')`,
      [tenantA, templateId],
    );
  });
  let secondActiveRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO notification_template_version (tenant_id, template_id, version_number, status, spec, content_hash)
         VALUES ($1, $2, 2, 'ACTIVE', '{}'::jsonb, 'sha256:y')`,
        [tenantA, templateId],
      );
    });
  } catch {
    secondActiveRejected = true;
  }
  t.ok(secondActiveRejected, 'a second ACTIVE version for the same template is rejected (one-active index)');

  // --- idempotency unique index on notification_request -----------------------------------------
  let versionId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM notification_template_version WHERE template_id = $1 AND status = 'ACTIVE'`,
      [templateId],
    );
    versionId = r.rows[0]?.id ?? '';
  });
  const idemKey = `idem-${randomUUID()}`;
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO notification_request
         (tenant_id, template_version_id, channel, destination, variables_hash, retry_policy, max_attempts, correlation_id, idempotency_key)
       VALUES ($1, $2, 'email', 'a@x.com', 'sha256:v', '{}'::jsonb, 5, $3, $4)`,
      [tenantA, versionId, randomUUID(), idemKey],
    );
  });
  let dupRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO notification_request
           (tenant_id, template_version_id, channel, destination, variables_hash, retry_policy, max_attempts, correlation_id, idempotency_key)
         VALUES ($1, $2, 'email', 'a@x.com', 'sha256:v', '{}'::jsonb, 5, $3, $4)`,
        [tenantA, versionId, randomUUID(), idemKey],
      );
    });
  } catch {
    dupRejected = true;
  }
  t.ok(dupRejected, 'a duplicate idempotency_key on notification_request is rejected (idempotency index)');

  // --- CHECK constraints hold -------------------------------------------------------------------
  let badChannelRejected = false;
  try {
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO notification_template (tenant_id, key, name, channel) VALUES ($1, 'x', 'X', 'pigeon')`,
        [tenantA],
      );
    });
  } catch {
    badChannelRejected = true;
  }
  t.ok(badChannelRejected, 'an invalid channel is rejected by the CHECK constraint');
});
