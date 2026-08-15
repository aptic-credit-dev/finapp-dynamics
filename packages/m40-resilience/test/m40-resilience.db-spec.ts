import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M40 Resilience DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the guarantees across the 13
 * resilience_ tables: RLS ENABLE+FORCE + tenant_isolation everywhere; tenant isolation holds; NO DELETE and INSERT+SELECT only
 * on the 7 append-only ledgers; NO float (RTO/RPO/latency/size are integer/bigint); ZERO secret-value columns. THE INVARIANTS
 * ARE DB-ENFORCED: an offline request is 'applied' ONLY when validated_online (finalize_ck — no offline finalization of a
 * controlled action); an offline request carries a 3-segment m02 permission (perm_ck); a terminal restore/failover decision is
 * IMMUTABLE (trigger); a restore/DR-test approver differs from the requester (SoD CHECK); one active DR plan per (tenant,
 * scope); the resilience.* permissions are seeded; one outbox (m06 — m40 owns none); PostgreSQL 16.
 */
const M40_TABLES = [
  'resilience_device',
  'resilience_offline_request',
  'resilience_offline_evidence',
  'resilience_check',
  'resilience_health_signal',
  'resilience_backup_policy',
  'resilience_backup_run',
  'resilience_restore_request',
  'resilience_dr_plan',
  'resilience_dr_test',
  'resilience_review',
  'resilience_history',
  'resilience_idempotency',
];
const APPEND_ONLY = [
  'resilience_offline_evidence',
  'resilience_health_signal',
  'resilience_backup_run',
  'resilience_dr_test',
  'resilience_review',
  'resilience_history',
  'resilience_idempotency',
];

export default defineDbSpec('m40-resilience', async (ctx, t) => {
  // --- structure: tables, RLS, policies ------------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M40_TABLES],
    );
    t.equal(r.rows.length, M40_TABLES.length, 'all 13 resilience_ tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname='tenant_isolation'`,
      [M40_TABLES],
    );
    t.equal(p.rows.length, M40_TABLES.length, 'every resilience_ table has a tenant_isolation policy');
  });

  // --- grants: no DELETE; append-only ledgers INSERT+SELECT only -----------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name LIKE 'resilience_%'`,
      [ctx.appRole],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any resilience_ table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'no UPDATE grant on any of the 7 append-only ledgers');
  });

  // --- no float; zero secret-value columns --------------------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const fl = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name = ANY($1) AND data_type IN ('double precision','real')`,
      [M40_TABLES],
    );
    t.equal(fl.rows[0]?.c, '0', 'no float/double column (RTO/RPO/latency/size are integer/bigint)');
    const sv = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name = ANY($1)
        AND (column_name LIKE '%secret%value%' OR column_name LIKE '%plaintext%' OR column_name='secret' OR column_name LIKE '%password%' OR column_name LIKE '%token%')`,
      [M40_TABLES],
    );
    t.equal(sv.rows[0]?.c, '0', 'zero secret-value/token columns (config_secret_ref is an opaque pointer)');
  });

  // --- one immutability trigger + 12 seeded permissions + one outbox ------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const trg = await tx.query<{ tgname: string }>(
      `SELECT tg.tgname FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid WHERE c.relname LIKE 'resilience_%' AND NOT tg.tgisinternal`,
    );
    t.equal(
      trg.rows.length,
      1,
      'exactly one immutability trigger (resilience_restore_request terminal-immutable)',
    );
    const perms = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code LIKE 'resilience.%'`,
    );
    t.equal(perms.rows[0]?.c, '12', 'twelve resilience.* permissions are seeded');
    const noAdmin = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code = 'resilience.admin' OR code LIKE 'resilience.%.%.%'`,
    );
    t.equal(noAdmin.rows[0]?.c, '0', 'no resilience.admin and no 4-segment permission');
    const outbox = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'resilience_%outbox%'`,
    );
    t.equal(outbox.rows[0]?.c, '0', 'm40 owns NO outbox table (it uses the one m06 outbox)');
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const requester = randomUUID();

  let deviceId = '';
  let requestId = '';
  let restoreId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const d = await tx.query<{ id: string }>(
      `INSERT INTO resilience_device (tenant_id, device_key, platform, trust_state, correlation_id, created_by)
       VALUES ($1,'dev-1','ios','registered',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), requester],
    );
    deviceId = d.rows[0]?.id ?? '';
    const o = await tx.query<{ id: string }>(
      `INSERT INTO resilience_offline_request (tenant_id, device_id, request_key, capability_ref, required_permission, controlled, correlation_id, created_by)
       VALUES ($1,$2,'req-1','journal:post','finance.journal.post',true,$3,$4) RETURNING id`,
      [tenantA, deviceId, randomUUID(), requester],
    );
    requestId = o.rows[0]?.id ?? '';
    const rr = await tx.query<{ id: string }>(
      `INSERT INTO resilience_restore_request (tenant_id, request_key, kind, target_ref, state, requested_by, approved_by, correlation_id, created_by)
       VALUES ($1,'rr-1','restore','db-main','executed',$2,$3,$4,$5) RETURNING id`,
      [tenantA, requester, randomUUID(), randomUUID(), requester],
    );
    restoreId = rr.rows[0]?.id ?? '';
    t.ok(
      deviceId && requestId && restoreId,
      'tenant A seeds a device, a controlled offline request and a restore',
    );
  });

  // tenant isolation
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM resilience_offline_request WHERE id=$1`,
      [requestId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's offline request (RLS)");
  });

  // THE OFFLINE FINALIZATION BLOCK: a controlled request cannot be 'applied' without validated_online (finalize_ck)
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `UPDATE resilience_offline_request SET sync_state='applied', validated_online=false WHERE id=$1`,
        [requestId],
      ),
      'an offline request cannot be applied without validated_online (finalize_ck — no offline finalization)',
    );
  });
  // it CAN be applied once validated_online is true (online re-validation)
  await ctx.asTenant(tenantA, async (tx) => {
    const ok = await tx.query<{ sync_state: string }>(
      `UPDATE resilience_offline_request SET sync_state='applied', validated_online=true, downstream_ref='ref:x' WHERE id=$1 RETURNING sync_state`,
      [requestId],
    );
    t.equal(ok.rows[0]?.sync_state, 'applied', 'once validated_online, a request may be applied');
  });

  // a 1-segment required_permission is rejected (perm_ck) at insert
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO resilience_offline_request (tenant_id, device_id, request_key, capability_ref, required_permission, correlation_id, created_by)
         VALUES ($1,$2,'req-bad','x','post',$3,$4)`,
        [tenantA, deviceId, randomUUID(), requester],
      ),
      'an offline request without a 3-segment permission is rejected (perm_ck)',
    );
  });

  // a terminal restore/failover decision is IMMUTABLE (trigger)
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE resilience_restore_request SET state='approved' WHERE id=$1`, [restoreId]),
      'a terminal (executed) restore request is immutable (trigger)',
    );
  });

  // restore SoD: approved_by cannot equal requested_by
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO resilience_restore_request (tenant_id, request_key, kind, target_ref, state, requested_by, approved_by, correlation_id, created_by)
         VALUES ($1,'rr-self','restore','db-main','approved',$2,$2,$3,$4)`,
        [tenantA, requester, randomUUID(), requester],
      ),
      'a restore approver cannot equal the requester (SoD CHECK)',
    );
  });

  // one active DR plan per (tenant, scope)
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO resilience_dr_plan (tenant_id, scope, plan_key, state, correlation_id, created_by) VALUES ($1,'tenant','p1','active',$2,$3)`,
      [tenantA, randomUUID(), requester],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO resilience_dr_plan (tenant_id, scope, plan_key, state, correlation_id, created_by) VALUES ($1,'tenant','p2','active',$2,$3)`,
        [tenantA, randomUUID(), requester],
      ),
      'a second ACTIVE DR plan for the same (tenant, scope) is rejected (one-active index)',
    );
    // a negative RTO is impossible (integer objective CHECK; no float)
    await t.rejects(
      tx.query(
        `INSERT INTO resilience_dr_plan (tenant_id, scope, plan_key, rto_seconds, correlation_id, created_by) VALUES ($1,'tenant','p3',-1,$2,$3)`,
        [tenantA, randomUUID(), requester],
      ),
      'a negative RTO is rejected (rto >= 0 CHECK)',
    );
  });
});
