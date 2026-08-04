import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M23 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the FRAMEWORK-ONLY
 * guarantees the migrations must deliver: every one of the 8 integration tables has RLS ENABLE+FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only INSERT+SELECT on
 * the five append-only ledgers; money is bigint minor units with NO float column (and is never transformed); there is
 * ZERO credential/secret column (only a format-checked `secret_reference` pointer); the secret-reference format CHECK
 * rejects an inline secret; a governed execution cannot be dispatched/acknowledged without an m22 approval reference
 * (no dispatch without approval); retry is bounded (attempt/max CHECKs); the idempotency ledger is unique (no duplicate
 * action); one ENABLED destination per system_code+scope; the allow-list can never be disabled; composite FKs; and
 * PostgreSQL 16 compatibility. m23 owns no outbox.
 *
 * Harness note: each as* block is ONE transaction with no per-statement savepoints — a constraint violation poisons it.
 * Persisting blocks contain NO rejecting query; every `t.rejects(...)` is the last statement in its block.
 */
const M23_TABLES = [
  'integration_destination',
  'integration_destination_history',
  'integration_config',
  'integration_execution',
  'integration_execution_history',
  'integration_attempt',
  'external_reference',
  'integration_idempotency',
];
const APPEND_ONLY = [
  'integration_destination_history',
  'integration_execution_history',
  'integration_attempt',
  'external_reference',
  'integration_idempotency',
];

export default defineDbSpec('m23-finance-integration', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M23_TABLES],
    );
    t.equal(r.rows.length, M23_TABLES.length, 'all 8 integration tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M23_TABLES],
    );
    t.equal(p.rows.length, M23_TABLES.length, 'every integration table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; money bigint no float; ZERO secret columns -------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND (table_name LIKE 'integration_%' OR table_name='external_reference')`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any integration table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the five evidence ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE (table_name LIKE 'integration_%' OR table_name='external_reference') AND data_type IN ('real','double precision')`,
    );
    t.equal(
      floats.rows[0]?.c,
      '0',
      'no integration column uses a binary float (money is bigint minor units, ADR-007)',
    );
    const money = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='integration_execution' AND column_name='amount_minor'`,
    );
    t.equal(
      money.rows[0]?.data_type,
      'bigint',
      'amount_minor is bigint minor units (opaque evidence, never transformed)',
    );
    // ZERO credential/secret VALUE columns — only the format-checked `secret_reference` pointer is permitted.
    const secrets = await tx.query<{ column_name: string; table_name: string }>(
      `SELECT column_name, table_name FROM information_schema.columns WHERE (table_name LIKE 'integration_%' OR table_name='external_reference') AND column_name ~ '(secret|credential|token|password|passphrase|api_key)' AND column_name <> 'secret_reference'`,
    );
    t.equal(
      secrets.rows.length,
      0,
      'there is ZERO credential/secret value column (only the secret_reference pointer, ADR-102)',
    );
  });

  // --- tenant isolation (COMMITS: ids reused) ---------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let execId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const d = await tx.query<{ id: string }>(
      `INSERT INTO integration_execution (tenant_id, approval_ref, correlation_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, randomUUID(), randomUUID()],
    );
    execId = d.rows[0]?.id ?? '';
    t.ok(execId !== '', 'tenant A seeds an integration execution');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM integration_execution WHERE id=$1`,
      [execId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's execution (RLS)");
  });

  // --- secret-reference format CHECK: an inline secret is rejected -------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO integration_destination (tenant_id, system_code, secret_reference, correlation_id) VALUES ($1,'erp','super-secret-inline-value',$2)`,
        [tenantA, randomUUID()],
      ),
      'an inline secret is rejected — only a secretref: pointer is allowed (secret-reference format CHECK)',
    );
  });

  // --- NO DISPATCH WITHOUT APPROVAL: cannot be 'dispatched' with a NULL approval_ref -------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO integration_execution (tenant_id, status, approval_ref, correlation_id) VALUES ($1,'dispatched',NULL,$2)`,
        [tenantA, randomUUID()],
      ),
      'an execution cannot be dispatched without an m22 approval reference (no dispatch without approval)',
    );
  });

  // --- BOUNDED RETRY: attempt_count cannot exceed max_attempts -----------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO integration_execution (tenant_id, approval_ref, attempt_count, max_attempts, correlation_id) VALUES ($1,$2,6,5,$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'attempt_count cannot exceed max_attempts (bounded retry CHECK)',
    );
  });

  // --- BOUNDED RETRY: max_attempts cannot exceed the platform ceiling (10) -----------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO integration_execution (tenant_id, approval_ref, max_attempts, correlation_id) VALUES ($1,$2,11,$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'max_attempts cannot exceed the platform ceiling of 10 (bounded retry)',
    );
  });

  // --- invalid execution status is rejected (lifecycle CHECK) -----------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO integration_execution (tenant_id, approval_ref, status, correlation_id) VALUES ($1,$2,'teleported',$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'an unknown execution status is rejected (lifecycle CHECK)',
    );
  });

  // --- one ENABLED destination per system_code+scope --------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO integration_destination (tenant_id, system_code, scope, version_number, status, correlation_id) VALUES ($1,'core','default',1,'enabled',$2)`,
      [tenantA, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO integration_destination (tenant_id, system_code, scope, version_number, status, correlation_id) VALUES ($1,'core','default',2,'enabled',$2)`,
        [tenantA, randomUUID()],
      ),
      'a second ENABLED destination for a system_code+scope is rejected (one active)',
    );
  });

  // --- config: allow-list can never be disabled -------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO integration_config (tenant_id, scope, version_number, enforce_allowlist, correlation_id) VALUES ($1,'no-allow',1,false,$2)`,
        [tenantA, randomUUID()],
      ),
      'a config cannot disable the destination allow-list (enforce_allowlist CHECK)',
    );
  });

  // --- idempotency ledger is unique -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `exec-${randomUUID()}`;
    await tx.query(
      `INSERT INTO integration_idempotency (tenant_id, idempotency_key, execution_id, correlation_id) VALUES ($1,$2,$3,$4)`,
      [tenantA, key, execId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO integration_idempotency (tenant_id, idempotency_key, execution_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, key, execId, randomUUID()],
      ),
      'a duplicate idempotency key is rejected (no duplicate integration action)',
    );
  });

  // --- composite FK: an attempt cannot reference a non-existent execution ------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO integration_attempt (tenant_id, execution_id, attempt_no, result, correlation_id) VALUES ($1,$2,1,'dispatched',$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'an attempt cannot reference a non-existent execution (composite FK)',
    );
  });

  // --- single outbox: m23 owns none -------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const outboxes = await tx.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE '%outbox%' AND relkind='r' ORDER BY relname`,
    );
    t.equal(outboxes.rows.length, 1, 'exactly one outbox exists (m06); m23 owns none');
    t.equal(
      outboxes.rows[0]?.relname,
      'workflow_event_outbox',
      'the one outbox is m06 workflow_event_outbox',
    );
  });
});
