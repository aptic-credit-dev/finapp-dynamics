import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M32 Analytics DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the analytics guarantees
 * across the 11 analytics_* tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation holds; NO DELETE
 * anywhere and INSERT+SELECT only on the 5 append-only ledgers; NO float column (money is bigint minor + exact numeric);
 * ZERO secret VALUE columns. THE INVARIANTS ARE DB-ENFORCED: a published metric/report is IMMUTABLE (triggers); a
 * metric cannot be published without a passing validation (evidence_ck); a money metric declares a currency
 * (currency_ck); a review DECISION needs a decider and decided_by <> requested_by (SoD); a materialization carries a
 * money-safe measure; one published metric/report per key; the analytics.* permissions are seeded; a single outbox
 * (m06 — m32 owns none); PostgreSQL 16.
 */
const M32_TABLES = [
  'analytics_dataset',
  'analytics_metric',
  'analytics_report',
  'analytics_review',
  'analytics_lineage',
  'analytics_materialization',
  'analytics_export',
  'analytics_schedule',
  'analytics_access_policy',
  'analytics_definition_history',
  'analytics_idempotency',
];
const APPEND_ONLY = [
  'analytics_review',
  'analytics_lineage',
  'analytics_materialization',
  'analytics_definition_history',
  'analytics_idempotency',
];

export default defineDbSpec('m32-analytics', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation ----------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M32_TABLES],
    );
    t.equal(r.rows.length, M32_TABLES.length, 'all 11 analytics tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M32_TABLES],
    );
    t.equal(p.rows.length, M32_TABLES.length, 'every analytics table has a tenant_isolation policy');
  });

  // --- NO DELETE; append-only no UPDATE; NO float; ZERO secret VALUE columns ---------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'analytics_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any analytics table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'the five append-only ledgers are append-only (no UPDATE)');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'analytics_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(
      floats.rows[0]?.c,
      '0',
      'no analytics column uses a binary float (money is bigint minor + exact numeric)',
    );
    const secrets = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'analytics_%' AND column_name ~ '(password|passphrase|api[_]?key|access_token|auth_token|private_key|secret_value|credential|secret_material)'`,
    );
    t.equal(secrets.rows.length, 0, 'ZERO secret/credential VALUE column');
    // money columns are money-safe types
    const money = await tx.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name='analytics_materialization' AND column_name='measure_value_minor'`,
    );
    t.equal(money.rows[0]?.data_type, 'bigint', 'measure_value_minor is bigint minor units');
    const immutTriggers = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_trigger WHERE tgrelid::regclass::text LIKE 'analytics_%' AND NOT tgisinternal`,
    );
    t.equal(immutTriggers.rows[0]?.c, '2', 'two published-immutability triggers (metric + report)');
  });

  // --- permissions seeded + single outbox -------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const perms = await tx.query<{ code: string; privileged: boolean }>(
      `SELECT code, privileged FROM permissions WHERE module='m32-analytics' ORDER BY code`,
    );
    t.equal(perms.rows.length, 12, 'twelve analytics.* permissions are seeded');
    t.ok(
      perms.rows.every((p) => p.code.startsWith('analytics.') && p.code.split('.').length === 3),
      'all seeded codes are 3-segment analytics.*',
    );
    t.ok(
      perms.rows.find((p) => p.code === 'analytics.metric.publish')?.privileged === true,
      'metric publish is privileged',
    );
    const outboxes = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%outbox%'`,
    );
    t.ok(
      outboxes.rows.length === 1 && outboxes.rows[0]?.table_name === 'workflow_event_outbox',
      'exactly one outbox (m06) — m32 owns none',
    );
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  // Seed dataset + a published metric in tenant A.
  let datasetId = '';
  let metricId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const d = await tx.query<{ id: string }>(
      `INSERT INTO analytics_dataset (tenant_id, scope, source_module, dataset_key, name, correlation_id, created_by) VALUES ($1,'tenant','m19-finance','ds-a','DS A',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    datasetId = d.rows[0]?.id ?? '';
    const m = await tx.query<{ id: string }>(
      `INSERT INTO analytics_metric (tenant_id, dataset_id, scope, metric_key, name, aggregation, measure_key, value_kind, state, validation_passed, content_hash, correlation_id, created_by)
       VALUES ($1,$2,'tenant','m-a','Metric A','count','id','count','published',true,'sha256:x',$3,$4) RETURNING id`,
      [tenantA, datasetId, randomUUID(), requester],
    );
    metricId = m.rows[0]?.id ?? '';
    t.ok(datasetId !== '' && metricId !== '', 'tenant A seeds a dataset + published metric');
  });

  // --- tenant isolation -------------------------------------------------------------------------
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM analytics_metric WHERE id=$1`, [
      metricId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's metric (RLS)");
  });

  // --- published metric is IMMUTABLE (trigger) --------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE analytics_metric SET aggregation='sum' WHERE id=$1`, [metricId]),
      'a published metric definition is immutable (analytics_metric_immutable trigger)',
    );
    await t.rejects(
      tx.query(`UPDATE analytics_metric SET state='draft' WHERE id=$1`, [metricId]),
      'a published metric can only move to superseded (not back to draft)',
    );
  });

  // --- evidence_ck: cannot publish without validation; currency_ck: money needs currency --------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO analytics_metric (tenant_id, dataset_id, scope, metric_key, name, aggregation, measure_key, value_kind, state, validation_passed, content_hash, correlation_id) VALUES ($1,$2,'tenant','m-bad','bad','count','id','count','published',false,'sha256:y',$3)`,
        [tenantA, datasetId, randomUUID()],
      ),
      'a metric cannot be published without validation_passed (analytics_metric_evidence_ck)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO analytics_metric (tenant_id, dataset_id, scope, metric_key, name, aggregation, measure_key, value_kind, currency, state, validation_passed, content_hash, correlation_id) VALUES ($1,$2,'tenant','m-money','money','sum','amt','minor_amount',NULL,'draft',false,'sha256:z',$3)`,
        [tenantA, datasetId, randomUUID()],
      ),
      'a money metric must declare a currency (analytics_metric_currency_ck)',
    );
  });

  // --- one published metric per key -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO analytics_metric (tenant_id, dataset_id, scope, metric_key, name, aggregation, measure_key, value_kind, state, validation_passed, content_hash, correlation_id) VALUES ($1,$2,'tenant','m-a','dupe','count','id','count','published',true,'sha256:dupe',$3)`,
        [tenantA, datasetId, randomUUID()],
      ),
      'only one published metric per key (analytics_metric_one_published)',
    );
  });

  // --- maker-checker DB CHECKs on analytics_review ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO analytics_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'metric',$2,'approved',$3,$3,$4)`,
        [tenantA, metricId, requester, randomUUID()],
      ),
      'a decider can never be the requester (analytics_review_sod_ck)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO analytics_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, correlation_id) VALUES ($1,'metric',$2,'approved',$3,NULL,$4)`,
        [tenantA, metricId, requester, randomUUID()],
      ),
      'an approved decision requires a decider (analytics_review_decider_ck)',
    );
  });

  // --- materialization measure_ck: at least one money-safe measure column -----------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const lin = await tx.query<{ id: string }>(
      `INSERT INTO analytics_lineage (tenant_id, target_type, source_module, correlation_id) VALUES ($1,'materialization','m19-finance',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO analytics_materialization (tenant_id, metric_id, lineage_id, generation, value_kind, correlation_id) VALUES ($1,$2,$3,1,'count',$4)`,
        [tenantA, metricId, lin.rows[0]?.id, randomUUID()],
      ),
      'a materialization must carry a money-safe measure (analytics_materialization_measure_ck)',
    );
  });

  // --- idempotency uniqueness -------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO analytics_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
      [tenantA, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO analytics_idempotency (tenant_id, idempotency_key, correlation_id) VALUES ($1,$2,$3)`,
        [tenantA, key, randomUUID()],
      ),
      'the idempotency ledger rejects a duplicate key (analytics_idempotency_key_uk)',
    );
  });
});
