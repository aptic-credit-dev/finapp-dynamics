import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M14 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every one of the 25 m14 tables has RLS ENABLE + FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only
 * INSERT+SELECT on the six append-only ledgers (status history, assignment history, case conversion, counsel
 * report, outcome, note); one-active matter-type/SLA-policy, matter-number + case-conversion idempotency
 * uniqueness, the settlement SoD CHECK, and the relationship self-edge CHECK hold; and m14's 70 permissions are
 * seeded with the 23-strong privileged (confidentiality / approval / platform) set marked privileged.
 */
const M14_TABLES = [
  'legal_matter_type',
  'legal_sla_policy',
  'legal_jurisdiction',
  'legal_matter',
  'legal_case_conversion',
  'legal_matter_status_history',
  'legal_assignment_history',
  'legal_instruction',
  'legal_party',
  'legal_activity',
  'legal_task',
  'legal_issue',
  'legal_position',
  'legal_opinion',
  'legal_research_reference',
  'legal_pleading',
  'legal_court_event',
  'legal_deadline',
  'legal_external_counsel',
  'legal_counsel_report',
  'legal_cost_reference',
  'legal_settlement',
  'legal_outcome',
  'legal_note',
  'legal_relationship',
];
const APPEND_ONLY = [
  'legal_matter_status_history',
  'legal_assignment_history',
  'legal_case_conversion',
  'legal_counsel_report',
  'legal_outcome',
  'legal_note',
];

export default defineDbSpec('m14-legal', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation on every table -------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M14_TABLES],
    );
    t.equal(r.rows.length, M14_TABLES.length, 'all 25 m14 tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M14_TABLES],
    );
    t.equal(p.rows.length, M14_TABLES.length, 'every m14 table has a tenant_isolation policy');
  });

  // --- the application role: NO DELETE anywhere; append-only ledgers get no UPDATE --------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M14_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m14 table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(
      upd.rows.length,
      0,
      'status history, assignment history, conversion, counsel report, outcome, note are append-only',
    );
  });

  // --- 70 permissions seeded, 23 privileged incl. the key privileged codes ----------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m14-legal'`,
    );
    t.equal(c.rows[0]?.c, '70', 'm14 seeds 70 permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m14-legal' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '23', 'm14 seeds 23 privileged permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m14-legal' AND privileged=true AND code IN ('legal.confidential.read','legal.privileged.read','legal.settlement.approve','legal.instruction.accept','legal.platform.administer')`,
    );
    t.equal(priv.rows.length, 5, 'the confidentiality + approval + platform permissions are privileged');
  });

  // --- tenant isolation holds -------------------------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let matterId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO legal_matter (tenant_id, matter_number, matter_type_code, title, correlation_id) VALUES ($1,'MATTER-aaaaaaaaaaaa','litigation','A matter',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    matterId = r.rows[0]?.id ?? '';
    t.ok(matterId !== '', 'tenant A can insert a matter');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM legal_matter WHERE id=$1`, [
      matterId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's matter (RLS)");
  });

  // --- matter-number uniqueness + case-conversion idempotency -----------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const insDup = async (): Promise<void> => {
      await tx.query(
        `INSERT INTO legal_matter (tenant_id, matter_number, matter_type_code, title, correlation_id) VALUES ($1,'MATTER-aaaaaaaaaaaa','litigation','dup',$2)`,
        [tenantA, randomUUID()],
      );
    };
    await t.rejects(insDup(), 'a duplicate matter number is rejected (per tenant)');
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const sourceCase = randomUUID();
    const ins = async (): Promise<void> => {
      await tx.query(
        `INSERT INTO legal_case_conversion (tenant_id, source_case_id, matter_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, sourceCase, matterId, randomUUID()],
      );
    };
    await ins();
    await t.rejects(ins(), 'a duplicate case conversion is rejected (exactly one matter per source case)');
  });

  // --- one-active matter type -------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO legal_matter_type (tenant_id, code, name, scope, status, spec, content_hash) VALUES ($1,'mt2','MT2','tenant','ACTIVE','{}'::jsonb,'sha256:a')`,
      [tenantA],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO legal_matter_type (tenant_id, code, name, scope, version_number, status, spec, content_hash) VALUES ($1,'mt2','MT2','tenant',2,'ACTIVE','{}'::jsonb,'sha256:b')`,
        [tenantA],
      ),
      'a second ACTIVE version of a matter type is rejected (one active per code+scope)',
    );
  });

  // --- settlement SoD CHECK (approver <> proposer) ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const same = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO legal_settlement (tenant_id, matter_id, approval_status, proposed_by, approved_by, correlation_id) VALUES ($1,$2,'approved',$3,$3,$4)`,
        [tenantA, matterId, same, randomUUID()],
      ),
      'a settlement cannot be approved by its proposer (SoD CHECK)',
    );
  });

  // --- relationship self-edge CHECK + composite FK ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legal_relationship (tenant_id, from_matter_id, to_matter_id, kind, correlation_id) VALUES ($1,$2,$2,'related_to',$3)`,
        [tenantA, matterId, randomUUID()],
      ),
      'a matter cannot relate to itself (CHECK)',
    );
    await t.rejects(
      tx.query(`INSERT INTO legal_party (tenant_id, matter_id, party_role) VALUES ($1,$2,'defendant')`, [
        tenantA,
        randomUUID(),
      ]),
      'a party cannot reference a non-existent matter (composite FK)',
    );
  });
});
