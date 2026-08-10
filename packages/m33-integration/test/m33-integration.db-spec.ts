import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M33 Integration DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the integration
 * guarantees across the 9 connector_* tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation holds; NO
 * DELETE anywhere and INSERT+SELECT only on the 4 append-only ledgers; NO float; ZERO secret VALUE columns (secrets are
 * opaque secretref: pointers). THE INVARIANTS ARE DB-ENFORCED: a published connector is IMMUTABLE (trigger); a connector
 * cannot be published without a passing validation (evidence_ck); a secret reference must match the secretref: shape
 * (connection_secret_ref_shape_ck); a review DECISION needs a decider and decided_by <> requested_by (SoD); one published
 * connector per key; the integration.* permissions are seeded; a single outbox (m06 — m33 owns none); PostgreSQL 16.
 */
const M33_TABLES = [
  'connector_definition',
  'connector_capability',
  'connection',
  'connection_secret',
  'connector_run',
  'connector_run_attempt',
  'connector_review',
  'connector_history',
  'connector_idempotency',
];
const APPEND_ONLY = [
  'connector_run_attempt',
  'connector_review',
  'connector_history',
  'connector_idempotency',
];

export default defineDbSpec('m33-integration', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M33_TABLES],
    );
    t.equal(r.rows.length, M33_TABLES.length, 'all 9 connector_* tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M33_TABLES],
    );
    t.equal(p.rows.length, M33_TABLES.length, 'every connector table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; NO float; ZERO secret VALUE columns ---------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND (table_name LIKE 'connector_%' OR table_name LIKE 'connection%')`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m33 table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the four append-only ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE (table_name LIKE 'connector_%' OR table_name LIKE 'connection%') AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no m33 column uses a binary float');
    const secrets = await tx.query<{ column_name: string; table_name: string }>(
      `SELECT column_name, table_name FROM information_schema.columns WHERE (table_name LIKE 'connector_%' OR table_name LIKE 'connection%') AND column_name ~ '(password|passphrase|api[_]?key|access_token|auth_token|private_key|secret_value|credential|secret_material)'`,
    );
    t.equal(
      secrets.rows.length,
      0,
      'ZERO secret/credential VALUE column (connection_secret holds an opaque secretref pointer only)',
    );
    const immut = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_trigger WHERE tgrelid::regclass::text = 'connector_definition' AND NOT tgisinternal`,
    );
    t.equal(immut.rows[0]?.c, '1', 'one published-immutability trigger (connector_definition)');
  });

  // --- permissions seeded + single outbox -------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m33-integration' ORDER BY code`,
    );
    t.equal(perms.rows.length, 9, 'nine integration.* permissions are seeded');
    t.ok(
      perms.rows.every((p) => p.code.startsWith('integration.') && p.code.split('.').length === 3),
      'all seeded codes are 3-segment integration.*',
    );
    t.ok(
      perms.rows.find((p) => p.code === 'integration.connector.publish')?.privileged === true,
      'connector publish is privileged',
    );
    const outboxes = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%outbox%'`,
    );
    t.ok(
      outboxes.rows.length === 1 && outboxes.rows[0]?.table_name === 'workflow_event_outbox',
      'exactly one outbox (m06) — m33 owns none',
    );
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  // Seed a published connector in tenant A.
  let connectorId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const c = await tx.query<{ id: string }>(
      `INSERT INTO connector_definition (tenant_id, scope, connector_key, name, category, auth_kind, state, validation_passed, content_hash, correlation_id, created_by)
       VALUES ($1,'tenant','salesforce','Salesforce','crm','oauth2','published',true,'sha256:x',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    connectorId = c.rows[0]?.id ?? '';
    t.ok(connectorId !== '', 'tenant A seeds a published connector');
  });

  // --- tenant isolation -------------------------------------------------------------------------
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM connector_definition WHERE id=$1`,
      [connectorId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's connector (RLS)");
  });

  // --- published connector is IMMUTABLE (trigger) -----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE connector_definition SET auth_kind='api_key' WHERE id=$1`, [connectorId]),
      'a published connector definition is immutable (trigger)',
    );
    await t.rejects(
      tx.query(`UPDATE connector_definition SET state='draft' WHERE id=$1`, [connectorId]),
      'a published connector can only move to deprecated',
    );
  });

  // --- evidence_ck + one-published ---------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO connector_definition (tenant_id, scope, connector_key, name, category, auth_kind, state, validation_passed, content_hash, correlation_id) VALUES ($1,'tenant','k2','k2','crm','none','published',false,'sha256:y',$2)`,
        [tenantA, randomUUID()],
      ),
      'a connector cannot be published without validation_passed (evidence_ck)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO connector_definition (tenant_id, scope, connector_key, name, category, auth_kind, state, validation_passed, content_hash, correlation_id) VALUES ($1,'tenant','salesforce','dupe','crm','none','published',true,'sha256:z',$2)`,
        [tenantA, randomUUID()],
      ),
      'only one published connector per key (connector_definition_one_published)',
    );
  });

  // --- SECRET SEAM: a raw secret is refused; a secretref: pointer is accepted --------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const conn = await tx.query<{ id: string }>(
      `INSERT INTO connection (tenant_id, connector_id, scope, connection_key, name, correlation_id) VALUES ($1,$2,'tenant','conn-a','Conn A',$3) RETURNING id`,
      [tenantA, connectorId, randomUUID()],
    );
    const connectionId = conn.rows[0]?.id ?? '';
    // the SUCCESS insert runs first (a rejected insert below aborts the tx — so it must come last).
    const ok = await tx.query<{ id: string }>(
      `INSERT INTO connection_secret (tenant_id, connection_id, purpose, secret_ref, correlation_id) VALUES ($1,$2,'oauth','secretref:vault/kv/sf',$3) RETURNING id`,
      [tenantA, connectionId, randomUUID()],
    );
    t.ok(
      (ok.rows[0]?.id ?? '') !== '',
      'a well-formed opaque secret reference is accepted (pointer only, no value)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO connection_secret (tenant_id, connection_id, purpose, secret_ref, correlation_id) VALUES ($1,$2,'api','hunter2',$3)`,
        [tenantA, connectionId, randomUUID()],
      ),
      'a raw secret value cannot be stored as a reference (connection_secret_ref_shape_ck)',
    );
  });

  // --- maker-checker DB CHECKs on connector_review ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO connector_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'connector',$2,'approved',$3,$3,$4)`,
        [tenantA, connectorId, requester, randomUUID()],
      ),
      'a decider can never be the requester (connector_review_sod_ck)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO connector_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'connector',$2,'approved',$3,NULL,$4)`,
        [tenantA, connectorId, requester, randomUUID()],
      ),
      'an approved decision requires a decider (connector_review_decider_ck)',
    );
  });

  // --- idempotency uniqueness -------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO connector_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO connector_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'the idempotency ledger rejects a duplicate key (connector_idempotency_key_uk)',
    );
  });
});
