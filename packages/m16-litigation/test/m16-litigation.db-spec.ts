import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M16 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every one of the 25 m16 tables has RLS ENABLE + FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only
 * INSERT+SELECT on the seven append-only ledgers (referral, status history, assignment history, proceeding
 * records, orders, outcomes, notes); one-active proceeding-type/SLA-policy, proceeding-number + referral-key
 * idempotency uniqueness, the filing + bundle SoD CHECKs, and the relationship self-edge CHECK hold; and m16's
 * 56 permissions are seeded with the 20-strong privileged (confidentiality / approval / verification /
 * configuration) set marked privileged.
 */
const M16_TABLES = [
  'litigation_proceeding_type',
  'litigation_sla_policy',
  'litigation_proceeding',
  'litigation_referral',
  'litigation_status_history',
  'litigation_assignment_history',
  'litigation_party',
  'litigation_claim',
  'litigation_filing',
  'litigation_service',
  'litigation_appearance',
  'litigation_proceeding_record',
  'litigation_witness',
  'litigation_expert',
  'litigation_exhibit',
  'litigation_bundle',
  'litigation_bundle_item',
  'litigation_order',
  'litigation_compliance_obligation',
  'litigation_outcome',
  'litigation_appeal',
  'litigation_deadline',
  'litigation_cost_reference',
  'litigation_note',
  'litigation_relationship',
];
const APPEND_ONLY = [
  'litigation_referral',
  'litigation_status_history',
  'litigation_assignment_history',
  'litigation_proceeding_record',
  'litigation_order',
  'litigation_outcome',
  'litigation_note',
];

export default defineDbSpec('m16-litigation', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation on every table -------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M16_TABLES],
    );
    t.equal(r.rows.length, M16_TABLES.length, 'all 25 m16 tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M16_TABLES],
    );
    t.equal(p.rows.length, M16_TABLES.length, 'every m16 table has a tenant_isolation policy');
  });

  // --- the application role: NO DELETE anywhere; append-only ledgers get no UPDATE --------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M16_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m16 table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'referral, histories, records, orders, outcomes and notes are append-only');
  });

  // --- 56 permissions seeded, 20 privileged incl. the key privileged codes ----------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m16-litigation'`,
    );
    t.equal(c.rows[0]?.c, '56', 'm16 seeds 56 permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m16-litigation' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '20', 'm16 seeds 20 privileged permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m16-litigation' AND privileged=true AND code IN ('litigation.confidential.read','litigation.privileged.read','litigation.filing.approve','litigation.bundle.approve','litigation.service.verify','litigation.platform.administer')`,
    );
    t.equal(
      priv.rows.length,
      6,
      'the confidentiality + approval + verification + platform permissions are privileged',
    );
  });

  // --- tenant isolation holds -------------------------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let procId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO litigation_proceeding (tenant_id, proceeding_number, proceeding_type_code, title, correlation_id) VALUES ($1,'PROC-aaaaaaaaaaaa','civil_suit','A proceeding',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    procId = r.rows[0]?.id ?? '';
    t.ok(procId !== '', 'tenant A can insert a proceeding');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_proceeding WHERE id=$1`,
      [procId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's proceeding (RLS)");
  });

  // --- proceeding-number uniqueness + referral-key idempotency ----------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const insDup = async (): Promise<void> => {
      await tx.query(
        `INSERT INTO litigation_proceeding (tenant_id, proceeding_number, proceeding_type_code, title, correlation_id) VALUES ($1,'PROC-aaaaaaaaaaaa','civil_suit','dup',$2)`,
        [tenantA, randomUUID()],
      );
    };
    await t.rejects(insDup(), 'a duplicate proceeding number is rejected (per tenant)');
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `ref-${randomUUID()}`;
    const ins = async (): Promise<void> => {
      await tx.query(
        `INSERT INTO litigation_referral (tenant_id, referral_key, source_matter_id, proceeding_id, correlation_id) VALUES ($1,$2,$3,$4,$5)`,
        [tenantA, key, randomUUID(), procId, randomUUID()],
      );
    };
    await ins();
    await t.rejects(ins(), 'a duplicate referral key is rejected (one proceeding per referral)');
  });

  // --- one-active proceeding type ---------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO litigation_proceeding_type (tenant_id, code, name, scope, status, spec, content_hash) VALUES ($1,'pt2','PT2','tenant','ACTIVE','{}'::jsonb,'sha256:a')`,
      [tenantA],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO litigation_proceeding_type (tenant_id, code, name, scope, version_number, status, spec, content_hash) VALUES ($1,'pt2','PT2','tenant',2,'ACTIVE','{}'::jsonb,'sha256:b')`,
        [tenantA],
      ),
      'a second ACTIVE version of a proceeding type is rejected (one active per code+scope)',
    );
  });

  // --- filing + bundle SoD CHECK (approver <> preparer) -----------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const same = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO litigation_bundle (tenant_id, proceeding_id, prepared_by, approved_by, correlation_id) VALUES ($1,$2,$3,$3,$4)`,
        [tenantA, procId, same, randomUUID()],
      ),
      'a bundle cannot be approved by its preparer (SoD CHECK)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO litigation_filing (tenant_id, proceeding_id, filing_role, prepared_by, approved_by, correlation_id) VALUES ($1,$2,'affidavit',$3,$3,$4)`,
        [tenantA, procId, same, randomUUID()],
      ),
      'a filing cannot be approved by its preparer (SoD CHECK)',
    );
  });

  // --- relationship self-edge CHECK + composite FK ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO litigation_relationship (tenant_id, from_proceeding_id, to_proceeding_id, kind, correlation_id) VALUES ($1,$2,$2,'related_to',$3)`,
        [tenantA, procId, randomUUID()],
      ),
      'a proceeding cannot relate to itself (CHECK)',
    );
    await t.rejects(
      tx.query(
        `INSERT INTO litigation_party (tenant_id, proceeding_id, party_role) VALUES ($1,$2,'defendant')`,
        [tenantA, randomUUID()],
      ),
      'a party cannot reference a non-existent proceeding (composite FK)',
    );
  });
});
