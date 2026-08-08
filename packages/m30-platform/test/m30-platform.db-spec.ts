import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M30 platform-foundation DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees across the 10 platform_* tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation holds;
 * the application role has NO DELETE anywhere and only INSERT+SELECT on the 4 append-only ledgers; there is NO float
 * column and — the load-bearing SECRETS-SEAM proof — ZERO secret VALUE columns (only opaque secret_ref pointers exist).
 * THE INVARIANTS ARE DB-ENFORCED: a config value is EITHER a plain value OR an opaque secret reference, never both
 * (platform_config_value_secret_ck); a secret reference must match the secretref: shape
 * (platform_secret_reference_shape_ck / platform_config_value_ref_shape_ck); the idempotency ledger is unique; composite
 * FKs; a single outbox (m06 — m30 owns none); PostgreSQL 16.
 */
const M30_TABLES = [
  'platform_metadata',
  'platform_config_definition',
  'platform_config_value',
  'platform_config_history',
  'platform_feature_definition',
  'platform_feature_assignment',
  'platform_feature_history',
  'platform_secret_reference',
  'platform_secret_reference_history',
  'platform_idempotency',
];
const APPEND_ONLY = [
  'platform_config_history',
  'platform_feature_history',
  'platform_secret_reference_history',
  'platform_idempotency',
];

export default defineDbSpec('m30-platform', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M30_TABLES],
    );
    t.equal(r.rows.length, M30_TABLES.length, 'all 10 platform tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M30_TABLES],
    );
    t.equal(p.rows.length, M30_TABLES.length, 'every platform table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; no float; ZERO secret VALUE columns ---------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'platform_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any platform table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the four append-only ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'platform_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no platform column uses a binary float');
    // THE SECRETS-SEAM PROOF: no secret VALUE column exists (opaque secret_ref pointers are references, not values).
    const secrets = await tx.query<{ column_name: string; table_name: string }>(
      `SELECT column_name, table_name FROM information_schema.columns WHERE table_name LIKE 'platform_%' AND column_name ~ '(password|passphrase|api[_]?key|access_token|auth_token|private_key|secret_value|credential|secret_material)'`,
    );
    t.equal(
      secrets.rows.length,
      0,
      'there is ZERO secret/credential VALUE column (m30 stores opaque secret_ref pointers only)',
    );
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let defId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const d = await tx.query<{ id: string }>(
      `INSERT INTO platform_config_definition (tenant_id, scope, config_key, value_type, status, correlation_id) VALUES ($1,'tenant','app.theme','text','active',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    defId = d.rows[0]?.id ?? '';
    t.ok(defId !== '', 'tenant A seeds a config definition');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform_config_definition WHERE id=$1`,
      [defId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's config definition (RLS)");
  });

  // --- SECRETS SEAM: a config value cannot carry BOTH a plain value and a secret reference -------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO platform_config_value (tenant_id, definition_id, scope, value_json, secret_ref, correlation_id) VALUES ($1,$2,'tenant','"x"'::jsonb,'secretref:vault/x',$3)`,
        [tenantA, defId, randomUUID()],
      ),
      'a config value cannot hold both a value and a secret reference (platform_config_value_secret_ck)',
    );
  });
  // --- a secret reference must match the opaque secretref: shape (never a raw value) ------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO platform_config_value (tenant_id, definition_id, scope, secret_ref, correlation_id) VALUES ($1,$2,'tenant','hunter2',$3)`,
        [tenantA, defId, randomUUID()],
      ),
      'a raw secret value cannot be stored as a reference (platform_config_value_ref_shape_ck)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO platform_secret_reference (tenant_id, scope, ref_key, secret_ref, correlation_id) VALUES ($1,'tenant','db-pw','not-a-secretref',$2)`,
        [tenantA, randomUUID()],
      ),
      'a secret reference must match the secretref: shape (platform_secret_reference_shape_ck)',
    );
  });
  // --- a well-formed opaque reference IS accepted (the seam works) ------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const s = await tx.query<{ id: string }>(
      `INSERT INTO platform_secret_reference (tenant_id, scope, ref_key, secret_ref, correlation_id) VALUES ($1,'tenant','db-pw','secretref:vault/kv/db-pw',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    t.ok(
      (s.rows[0]?.id ?? '') !== '',
      'a well-formed opaque secret reference is accepted (pointer only, no value)',
    );
  });

  // --- unknown scope / category / value type rejected -------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO platform_metadata (tenant_id, scope, category, meta_key, correlation_id) VALUES ($1,'tenant','tenants','x',$2)`,
        [tenantA, randomUUID()],
      ),
      'an ungoverned metadata category is rejected (platform_metadata_category_ck — not a tenant mirror)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO platform_config_definition (tenant_id, scope, config_key, value_type, correlation_id) VALUES ($1,'global','k','text',$2)`,
        [tenantA, randomUUID()],
      ),
      'an unknown scope is rejected (platform_config_definition_scope_ck)',
    );
  });

  // --- idempotency unique -----------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `pf-${randomUUID()}`;
    await tx.query(
      `INSERT INTO platform_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO platform_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'a duplicate idempotency key is rejected (no duplicate platform mutation)',
    );
  });

  // --- composite FK: a config value cannot reference a non-existent definition -------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO platform_config_value (tenant_id, definition_id, scope, value_json, correlation_id) VALUES ($1,$2,'tenant','"x"'::jsonb,$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'a config value cannot reference a non-existent definition (composite FK)',
    );
  });

  // --- single outbox: m30 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m30 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });

  // --- m30 permissions seeded (platform.* namespace; GAP-2 resolved) ----------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m30-platform' ORDER BY code`,
    );
    t.equal(perms.rows.length, 9, 'm30 seeds 9 platform.* permissions');
    t.ok(
      perms.rows.every((p) => p.code.startsWith('platform.')),
      'every m30 permission is in the platform.* namespace',
    );
    t.ok(!perms.rows.some((p) => p.code === 'platform.admin'), 'there is NO platform.admin bypass');
    const priv = perms.rows.filter((p) => p.privileged).map((p) => p.code);
    t.ok(
      priv.includes('platform.control.administer') &&
        priv.includes('platform.secret.manage') &&
        !priv.includes('platform.metadata.read'),
      'administer/secret.manage privileged; reads not',
    );
  });
});
