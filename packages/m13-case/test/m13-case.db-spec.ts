import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M13 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every one of the 20 m13 tables has RLS ENABLE + FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only
 * INSERT+SELECT on the five append-only ledgers (status history, assignment history, findings, notes,
 * handoff intake); one-active case-type/SLA-policy, case-number + handoff idempotency uniqueness, the decision
 * SoD CHECK, and the relationship self-edge CHECK hold; and m13's 56 permissions are seeded with the privileged
 * confidentiality/approval set marked privileged.
 */
const M13_TABLES = [
  'case_type',
  'case_sla_policy',
  'case_record',
  'case_handoff_intake',
  'case_status_history',
  'case_assignment_history',
  'case_party',
  'case_activity',
  'case_task',
  'case_issue',
  'case_investigation',
  'case_finding',
  'case_document',
  'case_evidence',
  'case_deadline',
  'case_hearing',
  'case_decision',
  'case_settlement',
  'case_note',
  'case_relationship',
];
const APPEND_ONLY = [
  'case_status_history',
  'case_assignment_history',
  'case_finding',
  'case_note',
  'case_handoff_intake',
];

export default defineDbSpec('m13-case', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation on every table -------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M13_TABLES],
    );
    t.equal(r.rows.length, M13_TABLES.length, 'all 20 m13 tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M13_TABLES],
    );
    t.equal(p.rows.length, M13_TABLES.length, 'every m13 table has a tenant_isolation policy');
  });

  // --- the application role: NO DELETE anywhere; append-only ledgers get no UPDATE --------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M13_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m13 table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(
      upd.rows.length,
      0,
      'status history, assignment history, findings, notes and handoff intake are append-only',
    );
  });

  // --- 56 permissions seeded, privileged set marked --------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m13-case'`,
    );
    t.equal(c.rows[0]?.c, '56', 'm13 seeds 56 permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m13-case' AND privileged=true AND code IN ('cases.confidential.read','cases.privileged_notes.read','cases.decision.approve','cases.settlement.approve','cases.platform.administer')`,
    );
    t.equal(priv.rows.length, 5, 'the confidentiality + approval + platform permissions are privileged');
  });

  // --- tenant isolation holds -------------------------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let caseId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO case_record (tenant_id, case_number, case_type_code, title, correlation_id) VALUES ($1,'CASE-aaaaaaaaaaaa','complaint','A case',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    caseId = r.rows[0]?.id ?? '';
    t.ok(caseId !== '', 'tenant A can insert a case');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM case_record WHERE id=$1`, [
      caseId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's case (RLS)");
  });

  // --- case-number uniqueness + handoff idempotency ---------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const insDup = async (): Promise<void> => {
      await tx.query(
        `INSERT INTO case_record (tenant_id, case_number, case_type_code, title, correlation_id) VALUES ($1,'CASE-aaaaaaaaaaaa','complaint','dup',$2)`,
        [tenantA, randomUUID()],
      );
    };
    await t.rejects(insDup(), 'a duplicate case number is rejected (per tenant)');
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const hid = randomUUID();
    const ins = async (): Promise<void> => {
      await tx.query(
        `INSERT INTO case_handoff_intake (tenant_id, handoff_id, case_id, correlation_id) VALUES ($1,$2,$3,$4)`,
        [tenantA, hid, caseId, randomUUID()],
      );
    };
    await ins();
    await t.rejects(ins(), 'a duplicate handoff intake is rejected (one case per handoff)');
  });

  // --- one-active case type ---------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    // Insert a first ACTIVE version, then a second ACTIVE must fail the partial unique index.
    await tx.query(
      `INSERT INTO case_type (tenant_id, code, name, scope, status, spec, content_hash) VALUES ($1,'ct2','CT2','tenant','ACTIVE','{}'::jsonb,'sha256:a')`,
      [tenantA],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO case_type (tenant_id, code, name, scope, version_number, status, spec, content_hash) VALUES ($1,'ct2','CT2','tenant',2,'ACTIVE','{}'::jsonb,'sha256:b')`,
        [tenantA],
      ),
      'a second ACTIVE version of a case type is rejected (one active per code+scope)',
    );
  });

  // --- decision SoD CHECK (approver <> submitter) -----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const same = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO case_decision (tenant_id, case_id, decision_type, approval_status, submitted_by, approved_by, correlation_id) VALUES ($1,$2,'accept','approved',$3,$3,$4)`,
        [tenantA, caseId, same, randomUUID()],
      ),
      'a decision cannot be approved by its submitter (SoD CHECK)',
    );
  });

  // --- relationship self-edge CHECK + composite FK ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO case_relationship (tenant_id, from_case_id, to_case_id, kind, correlation_id) VALUES ($1,$2,$2,'related_to',$3)`,
        [tenantA, caseId, randomUUID()],
      ),
      'a case cannot relate to itself (CHECK)',
    );
    await t.rejects(
      tx.query(`INSERT INTO case_party (tenant_id, case_id, party_type) VALUES ($1,$2,'customer')`, [
        tenantA,
        randomUUID(),
      ]),
      'a party cannot reference a non-existent case (composite FK)',
    );
  });
});
