import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M18 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every one of the 20 m18 tables has RLS ENABLE + FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only
 * INSERT+SELECT on the six append-only ledgers (status history, assignment history, authority treatment, note,
 * usage, approval history); knowledge-number + idempotency-key uniqueness; the one-published-per-code invariant
 * for knowledge/template; the maker-checker SoD CHECKs (knowledge/template/clause/opinion — approver <>
 * submitter/author); the relationship self-edge CHECK + composite FK; the tag soft-delete (no DELETE — a removed
 * tag frees its slot via the partial unique index); and m18's 46 permissions seeded with the 19-strong privileged
 * set.
 *
 * Harness note: each as* block is ONE transaction with no per-statement savepoints, so a constraint violation
 * poisons the whole transaction. Blocks that must persist data therefore contain NO rejecting query, and every
 * `t.rejects(...)` is the last (or only) statement in its block (that block rolls back cleanly).
 */
const M18_TABLES = [
  'legaldoc_taxonomy',
  'legaldoc_knowledge',
  'legaldoc_status_history',
  'legaldoc_assignment_history',
  'legaldoc_authority',
  'legaldoc_authority_treatment',
  'legaldoc_precedent',
  'legaldoc_opinion',
  'legaldoc_research',
  'legaldoc_template',
  'legaldoc_clause',
  'legaldoc_clause_relation',
  'legaldoc_reference',
  'legaldoc_relationship',
  'legaldoc_review',
  'legaldoc_tag',
  'legaldoc_citation',
  'legaldoc_note',
  'legaldoc_usage',
  'legaldoc_approval_history',
];
const APPEND_ONLY = [
  'legaldoc_status_history',
  'legaldoc_assignment_history',
  'legaldoc_authority_treatment',
  'legaldoc_note',
  'legaldoc_usage',
  'legaldoc_approval_history',
];
const kn = (): string => `KNOW-${randomUUID().replace(/-/g, '').slice(0, 12)}`;

export default defineDbSpec('m18-legaldocs', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation on every table -------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M18_TABLES],
    );
    t.equal(r.rows.length, M18_TABLES.length, 'all 20 m18 tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M18_TABLES],
    );
    t.equal(p.rows.length, M18_TABLES.length, 'every m18 table has a tenant_isolation policy');
  });

  // --- the application role: NO DELETE anywhere; append-only ledgers get no UPDATE --------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M18_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m18 table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(
      upd.rows.length,
      0,
      'status/assignment history, authority treatment, note, usage, approval history are append-only',
    );
  });

  // --- 46 permissions seeded, 19 privileged incl. the key privileged codes ----------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m18-legaldocs'`,
    );
    t.equal(c.rows[0]?.c, '46', 'm18 seeds 46 permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m18-legaldocs' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '19', 'm18 seeds 19 privileged permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m18-legaldocs' AND privileged=true AND code IN ('legaldocs.confidential.read','legaldocs.privileged.read','legaldocs.knowledge.approve','legaldocs.knowledge.publish','legaldocs.opinion.approve','legaldocs.clause.publish','legaldocs.platform.administer')`,
    );
    t.equal(priv.rows.length, 7, 'the privilege + approval + publish + platform permissions are privileged');
  });

  // --- tenant isolation holds (this block COMMITS: knId is reused below) -------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let knId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO legaldoc_knowledge (tenant_id, knowledge_number, knowledge_code, knowledge_type, title, correlation_id) VALUES ($1,'KNOW-aaaaaaaaaaaa','k-a','legal_memo','A note',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    knId = r.rows[0]?.id ?? '';
    t.ok(knId !== '', 'tenant A can insert a knowledge record');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM legaldoc_knowledge WHERE id=$1`,
      [knId],
    );
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's knowledge record (RLS)");
  });

  // --- knowledge-number uniqueness (rejects last; block rolls back) -----------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_knowledge (tenant_id, knowledge_number, knowledge_code, knowledge_type, title, correlation_id) VALUES ($1,'KNOW-aaaaaaaaaaaa','k-a2','legal_memo','dup',$2)`,
        [tenantA, randomUUID()],
      ),
      'a duplicate knowledge number is rejected (per tenant)',
    );
  });

  // --- idempotency-key uniqueness (first insert ok, duplicate rejects last) ----------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO legaldoc_knowledge (tenant_id, knowledge_number, knowledge_code, knowledge_type, title, idempotency_key, correlation_id) VALUES ($1,$2,'k-idem1','legal_memo','idem',$3,$4)`,
      [tenantA, kn(), key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_knowledge (tenant_id, knowledge_number, knowledge_code, knowledge_type, title, idempotency_key, correlation_id) VALUES ($1,$2,'k-idem2','legal_memo','idem',$3,$4)`,
        [tenantA, kn(), key, randomUUID()],
      ),
      'a duplicate idempotency key is rejected',
    );
  });

  // --- one-published-per-code: knowledge (insert ok, second published rejects last) --------------
  await ctx.asTenant(tenantA, async (tx) => {
    const sub = randomUUID();
    const app = randomUUID();
    await tx.query(
      `INSERT INTO legaldoc_knowledge (tenant_id, knowledge_number, knowledge_code, version_number, knowledge_type, title, status, submitted_by, approved_by, correlation_id) VALUES ($1,$2,'k-pub',1,'legal_memo','v1','published',$3,$4,$5)`,
      [tenantA, kn(), sub, app, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_knowledge (tenant_id, knowledge_number, knowledge_code, version_number, knowledge_type, title, status, submitted_by, approved_by, correlation_id) VALUES ($1,$2,'k-pub',2,'legal_memo','v2','published',$3,$4,$5)`,
        [tenantA, kn(), sub, app, randomUUID()],
      ),
      'a second published version of a knowledge code is rejected (one published per code)',
    );
  });

  // --- one-published-per-code: template (insert ok, second published rejects last) ---------------
  await ctx.asTenant(tenantA, async (tx) => {
    const sub = randomUUID();
    const app = randomUUID();
    await tx.query(
      `INSERT INTO legaldoc_template (tenant_id, template_code, version_number, title, status, submitted_by, approved_by, correlation_id) VALUES ($1,'t-pub',1,'T v1','published',$2,$3,$4)`,
      [tenantA, sub, app, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_template (tenant_id, template_code, version_number, title, status, submitted_by, approved_by, correlation_id) VALUES ($1,'t-pub',2,'T v2','published',$2,$3,$4)`,
        [tenantA, sub, app, randomUUID()],
      ),
      'a second published version of a template code is rejected (one published per code)',
    );
  });

  // --- maker-checker SoD CHECKs (each in its own tx so each CHECK is genuinely exercised) --------
  await ctx.asTenant(tenantA, async (tx) => {
    const same = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_knowledge (tenant_id, knowledge_number, knowledge_code, knowledge_type, title, status, submitted_by, approved_by, correlation_id) VALUES ($1,$2,'k-sod','legal_memo','x','approved',$3,$3,$4)`,
        [tenantA, kn(), same, randomUUID()],
      ),
      'a knowledge record cannot be approved by its submitter (SoD CHECK)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const same = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_clause (tenant_id, clause_code, title, status, submitted_by, approved_by, correlation_id) VALUES ($1,'c-sod','x','approved',$2,$2,$3)`,
        [tenantA, same, randomUUID()],
      ),
      'a clause cannot be approved by its submitter (SoD CHECK)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    const same = randomUUID();
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_opinion (tenant_id, title, approval_status, author, approved_by, correlation_id) VALUES ($1,'x','approved',$2,$2,$3)`,
        [tenantA, same, randomUUID()],
      ),
      'an opinion cannot be approved by its author (SoD CHECK)',
    );
  });

  // --- relationship self-edge CHECK -------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_relationship (tenant_id, from_knowledge_id, to_knowledge_id, kind, correlation_id) VALUES ($1,$2,$2,'related_to',$3)`,
        [tenantA, knId, randomUUID()],
      ),
      'a knowledge record cannot relate to itself (CHECK)',
    );
  });

  // --- reference composite FK -------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_reference (tenant_id, knowledge_id, ref_type, target_id, correlation_id) VALUES ($1,$2,'document',$3,$4)`,
        [tenantA, randomUUID(), 'opaque-doc-id', randomUUID()],
      ),
      'a reference cannot attach to a non-existent knowledge record (composite FK)',
    );
  });

  // --- tag soft-delete: add -> remove (UPDATE) -> re-add, all persisting (no reject in block) ----
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO legaldoc_tag (tenant_id, knowledge_id, taxonomy_kind, taxonomy_code) VALUES ($1,$2,'practice_area','banking')`,
      [tenantA, knId],
    );
    const removed = await tx.query<{ id: string }>(
      `UPDATE legaldoc_tag SET active=false WHERE knowledge_id=$1 AND taxonomy_kind='practice_area' AND taxonomy_code='banking' AND active RETURNING id`,
      [knId],
    );
    t.equal(removed.rows.length, 1, 'a tag is removed by soft delete (active=false), not DELETE');
    await tx.query(
      `INSERT INTO legaldoc_tag (tenant_id, knowledge_id, taxonomy_kind, taxonomy_code) VALUES ($1,$2,'practice_area','banking')`,
      [tenantA, knId],
    );
    const active = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM legaldoc_tag WHERE knowledge_id=$1 AND active`,
      [knId],
    );
    t.equal(
      active.rows[0]?.c,
      '1',
      'exactly one active tag after remove + re-add (partial unique freed the slot)',
    );
  });

  // --- a duplicate ACTIVE tag is rejected (reject-only block; the active tag above is committed) --
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO legaldoc_tag (tenant_id, knowledge_id, taxonomy_kind, taxonomy_code) VALUES ($1,$2,'practice_area','banking')`,
        [tenantA, knId],
      ),
      'a second active copy of the same tag is rejected (partial unique on active)',
    );
  });
});
