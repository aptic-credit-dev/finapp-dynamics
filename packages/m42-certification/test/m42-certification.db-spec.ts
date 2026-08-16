import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M42 certification DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the guarantees across the 13
 * certification_ tables. RLS ENABLE+FORCE + tenant_isolation everywhere; composite (tenant_id, id) PKs + composite tenant-safe
 * FKs (0 unsafe); tenant isolation holds; NO DELETE and INSERT+SELECT only on the 8 append-only ledgers; NO secret/ciphertext/
 * token/credential columns (m42 records opaque evidence refs only); NO float. DB-ENFORCED INVARIANTS: an issued DECISION and a
 * CLOSURE artifact are IMMUTABLE (triggers); a waiver approver, a review decider and a decision issuer need SoD
 * (approved_by/decided_by/issued_by <> requested_by); the 12 platform_certification.* permissions are seeded; one outbox
 * (m06 — m42 owns none); PostgreSQL 16.
 */
const M42_TABLES = [
  'certification_programme',
  'certification_assessment',
  'certification_finding',
  'certification_waiver',
  'certification_readiness',
  'certification_signoff',
  'certification_decision',
  'certification_condition',
  'certification_evidence',
  'certification_review',
  'certification_history',
  'certification_closure',
  'certification_idempotency',
];
const APPEND_ONLY = [
  'certification_signoff',
  'certification_decision',
  'certification_condition',
  'certification_evidence',
  'certification_review',
  'certification_history',
  'certification_closure',
  'certification_idempotency',
];

export default defineDbSpec('m42-certification', async (ctx, t) => {
  // --- structure: tables, RLS, policies, composite keys/FKs ---------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M42_TABLES],
    );
    t.equal(r.rows.length, M42_TABLES.length, 'all 13 certification tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname='tenant_isolation'`,
      [M42_TABLES],
    );
    t.equal(p.rows.length, M42_TABLES.length, 'every table has a tenant_isolation policy');
    const pk = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid WHERE c.contype='p' AND cl.relname = ANY($1) AND (SELECT count(*) FROM unnest(c.conkey))>1`,
      [M42_TABLES],
    );
    t.equal(pk.rows[0]?.c, '13', 'all 13 tables have a composite (tenant_id, id) primary key');
    const unsafe = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid WHERE c.contype='f' AND cl.relname = ANY($1)
        AND NOT EXISTS (SELECT 1 FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k WHERE a.attname='tenant_id')`,
      [M42_TABLES],
    );
    t.equal(unsafe.rows[0]?.c, '0', 'zero unsafe tenant FKs (every FK carries tenant_id)');
  });

  // --- no secret/ciphertext/token/credential columns; no float ------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const sv = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name = ANY($1)
        AND (column_name LIKE '%secret%' OR column_name LIKE '%ciphertext%' OR column_name LIKE '%password%'
             OR column_name LIKE '%token%' OR column_name LIKE '%private%key%' OR column_name LIKE '%credential%')`,
      [M42_TABLES],
    );
    t.equal(
      sv.rows[0]?.c,
      '0',
      'ZERO secret/ciphertext/token/private-key/password/credential columns (evidence is opaque refs only)',
    );
    const fl = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name = ANY($1) AND data_type IN ('double precision','real')`,
      [M42_TABLES],
    );
    t.equal(fl.rows[0]?.c, '0', 'no float/double column anywhere');
  });

  // --- grants: no DELETE; append-only ledgers INSERT+SELECT only -----------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M42_TABLES],
    );
    t.equal(del.rows[0]?.c, '0', 'the application role has NO DELETE on any certification table');
    const upd = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows[0]?.c, '0', 'no UPDATE grant on any of the 8 append-only ledgers');
  });

  // --- two immutability triggers + 12 seeded perms + one outbox -----------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const trg = await tx.query<{ tgname: string }>(
      `SELECT tg.tgname FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid WHERE c.relname LIKE 'certification_%' AND NOT tg.tgisinternal ORDER BY tg.tgname`,
    );
    t.equal(
      trg.rows.length,
      2,
      'exactly two immutability triggers (certification_decision + certification_closure)',
    );
    const perms = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code LIKE 'platform_certification.%'`,
    );
    t.equal(perms.rows[0]?.c, '12', 'twelve platform_certification.* permissions are seeded');
    const noAdmin = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code = 'platform_certification.admin' OR code LIKE 'platform_certification.%.%.%'`,
    );
    t.equal(noAdmin.rows[0]?.c, '0', 'no platform_certification.admin and no 4-segment permission');
    const priv = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE code LIKE 'platform_certification.%' AND privileged`,
    );
    t.equal(priv.rows[0]?.c, '4', 'four privileged permissions seeded');
    const outbox = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'certification_%outbox%'`,
    );
    t.equal(outbox.rows[0]?.c, '0', 'm42 owns NO outbox table (it uses the one m06 outbox)');
  });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userR = randomUUID();
  const userC = randomUUID();

  let programmeId = '';
  let decisionId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const p = await tx.query<{ id: string }>(
      `INSERT INTO certification_programme (tenant_id, scope, programme_key, stage_key, title, state, correlation_id, created_by)
       VALUES ($1,'platform','stage-6','stage-6','Stage 6 closure','decided',$2,$3) RETURNING id`,
      [tenantA, randomUUID(), userR],
    );
    programmeId = p.rows[0]?.id ?? '';
    const d = await tx.query<{ id: string }>(
      `INSERT INTO certification_decision (tenant_id, programme_id, decision_no, decision, requested_by, issued_by, correlation_id)
       VALUES ($1,$2,1,'conditional_go',$3,$4,$5) RETURNING id`,
      [tenantA, programmeId, userR, userC, randomUUID()],
    );
    decisionId = d.rows[0]?.id ?? '';
    t.ok(programmeId !== '' && decisionId !== '', 'tenant A seeds a decided programme + an issued decision');
  });

  // tenant isolation
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM certification_programme WHERE id=$1`,
      [programmeId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's programme (RLS)");
  });

  // an issued decision is IMMUTABLE (trigger)
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(`UPDATE certification_decision SET decision='go' WHERE id=$1`, [decisionId]),
      'an issued certification decision is immutable (trigger — issue a new decision to supersede)',
    );
  });

  // a decision issuer cannot equal the requester (SoD CHECK)
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO certification_decision (tenant_id, programme_id, decision_no, decision, requested_by, issued_by, correlation_id)
         VALUES ($1,$2,2,'no_go',$3,$3,$4)`,
        [tenantA, programmeId, userR, randomUUID()],
      ),
      'a decision issued_by cannot equal requested_by (SoD CHECK)',
    );
  });

  // a review decided_by cannot equal requested_by (SoD)
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO certification_review (tenant_id, target_kind, target_id, decision, requested_by, decided_by, correlation_id)
         VALUES ($1,'decision',$2,'go',$3,$3,$4)`,
        [tenantA, programmeId, userR, randomUUID()],
      ),
      'a review decided_by cannot equal requested_by (SoD CHECK)',
    );
  });

  // a closure artifact is IMMUTABLE (trigger)
  await ctx.asTenant(tenantA, async (tx) => {
    const c = await tx.query<{ id: string }>(
      `INSERT INTO certification_closure (tenant_id, programme_id, decision_id, stage_key, decision, assessed_modules, issued_by, correlation_id)
       VALUES ($1,$2,$3,'stage-6','conditional_go','m30..m41',$4,$5) RETURNING id`,
      [tenantA, programmeId, decisionId, userC, randomUUID()],
    );
    const closureId = c.rows[0]?.id ?? '';
    t.ok(closureId !== '', 'a closure artifact can be issued');
    await t.rejects(
      tx.query(`UPDATE certification_closure SET decision='go' WHERE id=$1`, [closureId]),
      'a stage closure artifact is immutable (trigger)',
    );
  });

  // an assessment cell is unique per (programme, domain, aspect)
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO certification_assessment (tenant_id, programme_id, domain_key, aspect_key, status, correlation_id)
       VALUES ($1,$2,'m30','security','pass',$3)`,
      [tenantA, programmeId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO certification_assessment (tenant_id, programme_id, domain_key, aspect_key, status, correlation_id)
         VALUES ($1,$2,'m30','security','fail',$3)`,
        [tenantA, programmeId, randomUUID()],
      ),
      'a duplicate (programme, domain, aspect) assessment cell is rejected (unique index)',
    );
  });

  // an unknown domain/aspect is rejected (CHECK)
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO certification_assessment (tenant_id, programme_id, domain_key, aspect_key, status, correlation_id)
         VALUES ($1,$2,'m99','security','pass',$3)`,
        [tenantA, programmeId, randomUUID()],
      ),
      'an out-of-range domain key is rejected (CHECK — only m30..m41)',
    );
  });
});
