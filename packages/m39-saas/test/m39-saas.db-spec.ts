import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M39 Commercial-SaaS DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the guarantees across the
 * 13 saas_ tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation holds; NO DELETE and INSERT+SELECT only on
 * the 8 append-only ledgers; NO float (money is bigint minor units); ZERO secret-value columns. THE INVARIANTS ARE DB-ENFORCED:
 * a PUBLISHED plan version is IMMUTABLE (trigger — pricing frozen); a quota counter can NEVER exceed its hard limit (reserved
 * <= limit CHECK); a tenant holds at most ONE live subscription (partial unique index); a review/override needs SoD
 * (decided_by/approved_by <> requested_by); usage is idempotent (UNIQUE idempotency key); the saas.* permissions are seeded;
 * one outbox (m06 — m39 owns none); PostgreSQL 16.
 */
const M39_TABLES = [
  'saas_plan',
  'saas_plan_version',
  'saas_plan_entitlement',
  'saas_quota_policy',
  'saas_subscription',
  'saas_entitlement_assignment',
  'saas_override',
  'saas_quota_period',
  'saas_usage_event',
  'saas_billing_cycle',
  'saas_review',
  'saas_history',
  'saas_idempotency',
];
const APPEND_ONLY = [
  'saas_plan_entitlement',
  'saas_quota_policy',
  'saas_entitlement_assignment',
  'saas_override',
  'saas_usage_event',
  'saas_review',
  'saas_history',
  'saas_idempotency',
];

export default defineDbSpec('m39-saas', async (ctx, t) => {
  // --- structure: tables, RLS, policies ------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M39_TABLES],
    );
    t.equal(r.rows.length, M39_TABLES.length, 'all 13 saas_ tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname='tenant_isolation'`,
      [M39_TABLES],
    );
    t.equal(p.rows.length, M39_TABLES.length, 'every saas_ table has a tenant_isolation policy');
  });

  // --- grants: no DELETE; append-only ledgers are INSERT+SELECT only -------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'saas_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any saas_ table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'no UPDATE grant on any of the 8 append-only ledgers');
  });

  // --- no float; zero secret-value columns --------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const fl = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name = ANY($1) AND data_type IN ('double precision','real')`,
      [M39_TABLES],
    );
    t.equal(fl.rows[0]?.c, '0', 'no float/double column anywhere (money is bigint minor units)');
    const sv = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name = ANY($1)
        AND (column_name LIKE '%secret%value%' OR column_name LIKE '%plaintext%' OR column_name='secret' OR column_name LIKE '%password%')`,
      [M39_TABLES],
    );
    t.equal(sv.rows[0]?.c, '0', 'zero secret-value columns');
  });

  // --- one immutability trigger (saas_plan_version) + 12 seeded permissions + one outbox -----------
  await ctx.asSuperuser(null, async (tx) => {
    const trg = await tx.query<{ tgname: string }>(
      `SELECT tg.tgname FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid WHERE c.relname LIKE 'saas_%' AND NOT tg.tgisinternal`,
    );
    t.equal(trg.rows.length, 1, 'exactly one immutability trigger (saas_plan_version published-immutable)');
    const perms = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code LIKE 'saas.%'`,
    );
    t.equal(perms.rows[0]?.c, '12', 'twelve saas.* permissions are seeded');
    const noAdmin = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code = 'saas.admin' OR code LIKE 'saas.%.%.%'`,
    );
    t.equal(noAdmin.rows[0]?.c, '0', 'no saas.admin and no 4-segment permission');
    const outbox = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'saas_%outbox%'`,
    );
    t.equal(
      outbox.rows[0]?.c,
      '0',
      'm39 owns NO outbox table (it uses the one m06 outbox; saas_usage_event is a usage ledger, not an outbox)',
    );
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  let planId = '';
  let versionId = '';
  let subId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const p = await tx.query<{ id: string }>(
      `INSERT INTO saas_plan (tenant_id, scope, plan_key, name, state, current_version_no, correlation_id, created_by)
       VALUES ($1,'tenant','pro','Pro','active',1,$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    planId = p.rows[0]?.id ?? '';
    const v = await tx.query<{ id: string }>(
      `INSERT INTO saas_plan_version (tenant_id, plan_id, version_no, state, currency, base_amount_minor, validation_passed, published_at, correlation_id, created_by)
       VALUES ($1,$2,1,'published','USD',1999,true,now(),$3,$4) RETURNING id`,
      [tenantA, planId, randomUUID(), requester],
    );
    versionId = v.rows[0]?.id ?? '';
    const sub = await tx.query<{ id: string }>(
      `INSERT INTO saas_subscription (tenant_id, subscription_key, plan_id, plan_version_id, state, correlation_id, created_by)
       VALUES ($1,'sub-1',$2,$3,'active',$4,$5) RETURNING id`,
      [tenantA, planId, versionId, randomUUID(), requester],
    );
    subId = sub.rows[0]?.id ?? '';
    t.ok(
      planId && versionId && subId,
      'tenant A seeds a plan, a published version and an active subscription',
    );
  });

  // tenant isolation
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM saas_subscription WHERE id=$1`, [
      subId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's subscription (RLS)");
  });

  // published plan version is IMMUTABLE (trigger) — pricing frozen
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE saas_plan_version SET base_amount_minor=9999 WHERE id=$1`, [versionId]),
      'a published plan version price is frozen (trigger)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE saas_plan_version SET state='draft' WHERE id=$1`, [versionId]),
      'a published plan version cannot revert to draft (trigger)',
    );
  });

  // one live subscription per tenant (partial unique index)
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO saas_subscription (tenant_id, subscription_key, plan_id, plan_version_id, state, correlation_id, created_by)
         VALUES ($1,'sub-2',$2,$3,'active',$4,$5)`,
        [tenantA, planId, versionId, randomUUID(), requester],
      ),
      'a second LIVE subscription for the same tenant is rejected (one-active index)',
    );
  });

  // quota counter can NEVER exceed its hard limit (reserved <= limit CHECK)
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO saas_quota_period (tenant_id, capability_key, meter_key, period_key, limit_hard, reserved_qty, correlation_id, created_by)
       VALUES ($1,'reports.export','api_calls','2026-08',10,0,$2,$3)`,
      [tenantA, randomUUID(), requester],
    );
    await t.rejects(
      tx.query(
        `UPDATE saas_quota_period SET reserved_qty=11 WHERE capability_key='reports.export' AND period_key='2026-08'`,
      ),
      'reserved_qty can never exceed limit_hard (CHECK — no oversubscription)',
    );
  });

  // review + override require SoD
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO saas_review (tenant_id, target_kind, target_id, decision, requested_by, decided_by, correlation_id)
         VALUES ($1,'plan_version',$2,'approved',$3,$3,$4)`,
        [tenantA, versionId, requester, randomUUID()],
      ),
      'a review with decided_by = requested_by is rejected (SoD CHECK)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO saas_override (tenant_id, target_kind, capability_key, requested_by, approved_by, reason_code, correlation_id)
         VALUES ($1,'entitlement','reports.export',$2,$2,'grant',$3)`,
        [tenantA, requester, randomUUID()],
      ),
      'an override with approved_by = requested_by is rejected (SoD CHECK)',
    );
  });

  // usage is idempotent (UNIQUE idempotency key)
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO saas_usage_event (tenant_id, capability_key, meter_key, quantity, period_key, idempotency_key, correlation_id, created_by)
       VALUES ($1,'reports.export','api_calls',1,'2026-08','evt-1',$2,$3)`,
      [tenantA, randomUUID(), requester],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO saas_usage_event (tenant_id, capability_key, meter_key, quantity, period_key, idempotency_key, correlation_id, created_by)
         VALUES ($1,'reports.export','api_calls',1,'2026-08','evt-1',$2,$3)`,
        [tenantA, randomUUID(), requester],
      ),
      'a duplicate usage idempotency key is rejected (counted once)',
    );
    // a negative/zero amount is impossible (money/quantity CHECKs)
    await t.rejects(
      tx.query(
        `INSERT INTO saas_plan_version (tenant_id, plan_id, version_no, currency, base_amount_minor, correlation_id, created_by)
         VALUES ($1,$2,9,'USD',-1,$3,$4)`,
        [tenantA, planId, randomUUID(), requester],
      ),
      'a negative price is rejected (amount >= 0 CHECK — no negative money)',
    );
  });
});
