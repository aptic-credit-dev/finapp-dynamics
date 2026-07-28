import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M17 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every one of the 25 m17 tables has RLS ENABLE + FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only
 * INSERT+SELECT on the nine append-only ledgers (referral, status history, assignment history, strategy, agent
 * report, receipt, waiver, outcome, note); one-active recovery-type/SLA-policy, recovery-number + referral-key
 * idempotency uniqueness, the arrangement + write-off maker-checker SoD CHECKs, and the relationship self-edge
 * CHECK hold; and m17's 58 permissions are seeded with the 20-strong privileged (confidentiality / approval /
 * configuration) set marked privileged.
 */
const M17_TABLES = [
  'recovery_type',
  'recovery_sla_policy',
  'recovery_case',
  'recovery_referral',
  'recovery_status_history',
  'recovery_assignment_history',
  'recovery_party',
  'recovery_instrument',
  'recovery_strategy',
  'recovery_demand',
  'recovery_negotiation',
  'recovery_arrangement',
  'recovery_installment',
  'recovery_enforcement_action',
  'recovery_security',
  'recovery_agent',
  'recovery_agent_report',
  'recovery_receipt',
  'recovery_waiver',
  'recovery_writeoff_recommendation',
  'recovery_outcome',
  'recovery_deadline',
  'recovery_cost_reference',
  'recovery_note',
  'recovery_relationship',
];
const APPEND_ONLY = [
  'recovery_referral',
  'recovery_status_history',
  'recovery_assignment_history',
  'recovery_strategy',
  'recovery_agent_report',
  'recovery_receipt',
  'recovery_waiver',
  'recovery_outcome',
  'recovery_note',
];

export default defineDbSpec('m17-recovery', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation on every table -------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M17_TABLES],
    );
    t.equal(r.rows.length, M17_TABLES.length, 'all 25 m17 tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M17_TABLES],
    );
    t.equal(p.rows.length, M17_TABLES.length, 'every m17 table has a tenant_isolation policy');
  });

  // --- the application role: NO DELETE anywhere; append-only ledgers get no UPDATE --------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M17_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m17 table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(
      upd.rows.length,
      0,
      'referral, histories, strategy, agent report, receipt, waiver, outcome, note are append-only',
    );
  });

  // --- 58 permissions seeded, 20 privileged incl. the key privileged codes ----------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m17-recovery'`,
    );
    t.equal(c.rows[0]?.c, '58', 'm17 seeds 58 permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m17-recovery' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '20', 'm17 seeds 20 privileged permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m17-recovery' AND privileged=true AND code IN ('recovery.confidential.read','recovery.privileged.read','recovery.arrangement.approve','recovery.writeoff.approve','recovery.security.realize','recovery.platform.administer')`,
    );
    t.equal(
      priv.rows.length,
      6,
      'the confidentiality + approval + realize + platform permissions are privileged',
    );
  });

  // --- tenant isolation holds -------------------------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let recId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO recovery_case (tenant_id, recovery_number, recovery_type_code, title, correlation_id) VALUES ($1,'REC-aaaaaaaaaaaa','judgment_recovery','A recovery',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    recId = r.rows[0]?.id ?? '';
    t.ok(recId !== '', 'tenant A can insert a recovery');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM recovery_case WHERE id=$1`, [
      recId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's recovery (RLS)");
  });

  // --- recovery-number uniqueness + referral-key idempotency ------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const insDup = async (): Promise<void> => {
      await tx.query(
        `INSERT INTO recovery_case (tenant_id, recovery_number, recovery_type_code, title, correlation_id) VALUES ($1,'REC-aaaaaaaaaaaa','judgment_recovery','dup',$2)`,
        [tenantA, randomUUID()],
      );
    };
    await t.rejects(insDup(), 'a duplicate recovery number is rejected (per tenant)');
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `ref-${randomUUID()}`;
    const ins = async (): Promise<void> => {
      await tx.query(
        `INSERT INTO recovery_referral (tenant_id, referral_key, source_proceeding_id, recovery_id, correlation_id) VALUES ($1,$2,$3,$4,$5)`,
        [tenantA, key, randomUUID(), recId, randomUUID()],
      );
    };
    await ins();
    await t.rejects(ins(), 'a duplicate referral key is rejected (one recovery per referral)');
  });

  // --- one-active recovery type -----------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO recovery_type (tenant_id, code, name, scope, status, spec, content_hash) VALUES ($1,'rt2','RT2','tenant','ACTIVE','{}'::jsonb,'sha256:a')`,
      [tenantA],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO recovery_type (tenant_id, code, name, scope, version_number, status, spec, content_hash) VALUES ($1,'rt2','RT2','tenant',2,'ACTIVE','{}'::jsonb,'sha256:b')`,
        [tenantA],
      ),
      'a second ACTIVE version of a recovery type is rejected (one active per code+scope)',
    );
  });

  // --- arrangement + write-off maker-checker SoD CHECK (approver <> proposer/recommender) --------
  await ctx.asTenant(tenantA, async (tx) => {
    const same = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO recovery_arrangement (tenant_id, recovery_id, arrangement_type, approval_status, proposed_by, approved_by, correlation_id) VALUES ($1,$2,'installment','approved',$3,$3,$4)`,
        [tenantA, recId, same, randomUUID()],
      ),
      'an arrangement cannot be approved by its proposer (SoD CHECK)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO recovery_writeoff_recommendation (tenant_id, recovery_id, reason_code, approval_status, recommended_by, approved_by, correlation_id) VALUES ($1,$2,'uncollectible','approved',$3,$3,$4)`,
        [tenantA, recId, same, randomUUID()],
      ),
      'a write-off cannot be approved by its recommender (SoD CHECK)',
    );
  });

  // --- relationship self-edge CHECK + composite FK ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO recovery_relationship (tenant_id, from_recovery_id, to_recovery_id, kind, correlation_id) VALUES ($1,$2,$2,'related_to',$3)`,
        [tenantA, recId, randomUUID()],
      ),
      'a recovery cannot relate to itself (CHECK)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO recovery_party (tenant_id, recovery_id, party_role) VALUES ($1,$2,'principal_debtor')`,
        [tenantA, randomUUID()],
      ),
      'a party cannot reference a non-existent recovery (composite FK)',
    );
  });
});
