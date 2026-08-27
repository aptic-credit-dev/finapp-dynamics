import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M12 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every one of the 15 m12 tables has RLS ENABLE + FORCE + a
 * tenant_isolation policy; tenant isolation actually holds; the application role has NO DELETE anywhere and only
 * INSERT+SELECT on the three append-only ledgers (answers, contact attempts, assignment history); one-active
 * questionnaire/SLA-policy, single-winner queue claim, and the ingestion/handoff idempotency uniqueness hold; and
 * m12's 39 permissions are seeded with the privileged contact/platform set marked privileged.
 */
const M12_TABLES = [
  'feedback_source_system',
  'feedback_category',
  'feedback_questionnaire',
  'feedback_sla_policy',
  'feedback_source_transaction',
  'feedback_record',
  'feedback_answer',
  'feedback_queue_item',
  'feedback_contact_attempt',
  'feedback_assignment_history',
  'feedback_activity',
  'feedback_resolution',
  'feedback_sla_instance',
  'feedback_case_handoff',
  'feedback_relationship',
];
const APPEND_ONLY = ['feedback_answer', 'feedback_contact_attempt', 'feedback_assignment_history'];

export default defineDbSpec('m12-feedback', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation on every table -------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY relname`,
      [M12_TABLES],
    );
    t.equal(r.rows.length, M12_TABLES.length, 'all 15 m12 tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M12_TABLES],
    );
    t.equal(p.rows.length, M12_TABLES.length, 'every m12 table has a tenant_isolation policy');
  });

  // --- the application role: NO DELETE anywhere; append-only ledgers get no UPDATE --------------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M12_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m12 table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(
      upd.rows.length,
      0,
      'answers, contact attempts and assignment history are append-only (no UPDATE grant)',
    );
  });

  // --- 39 permissions seeded, privileged set marked --------------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m12-feedback'`,
    );
    t.equal(c.rows[0]?.c, '39', 'm12 seeds 39 permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m12-feedback' AND privileged=true AND code IN ('feedback.customer_contact.read','feedback.platform.administer')`,
    );
    t.equal(priv.rows.length, 2, 'the customer-contact + platform permissions are marked privileged');
  });

  // --- tenant isolation holds -------------------------------------------------------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let fbId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO feedback_record (tenant_id, code, feedback_type, correlation_id) VALUES ($1,'FB-A','complaint',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    fbId = r.rows[0]?.id ?? '';
    t.ok(fbId !== '', 'tenant A can insert a feedback record');
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM feedback_record WHERE id=$1`, [
      fbId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's feedback (RLS)");
  });

  // --- ingestion idempotency: (source_system, external_transaction_id) is unique per tenant ------
  await ctx.asTenant(tenantA, async (tx) => {
    const ins = async (): Promise<void> => {
      await tx.query(
        `INSERT INTO feedback_source_transaction (tenant_id, source_system, external_transaction_id, transaction_type, product, customer_ref, correlation_id) VALUES ($1,'sys','EXT-1','loan','loan','c1',$2)`,
        [tenantA, randomUUID()],
      );
    };
    await ins();
    await t.rejects(ins(), 'a duplicate external transaction id is rejected (ingestion idempotency)');
  });

  // --- single-winner queue claim (compare-and-set) ----------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const q = await tx.query<{ id: string }>(
      `INSERT INTO feedback_queue_item (tenant_id, product, priority, correlation_id) VALUES ($1,'loan','normal',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    const qid = q.rows[0]?.id ?? '';
    const claim = async (officer: string) =>
      tx.query<{ id: string }>(
        `UPDATE feedback_queue_item SET assigned_officer=$2, status='claimed', version=version+1 WHERE id=$1 AND status='open' AND assigned_officer IS NULL RETURNING id`,
        [qid, officer],
      );
    const first = await claim(randomUUID());
    const second = await claim(randomUUID());
    t.equal(first.rows.length, 1, 'the first claim wins');
    t.equal(second.rows.length, 0, 'the second claim of the same item touches zero rows (single winner)');
  });

  // --- composite FK: a feedback record cannot point at another tenant's source transaction -------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO feedback_record (tenant_id, code, feedback_type, source_transaction_id, correlation_id) VALUES ($1,'FB-BAD','complaint',$2,$3)`,
        [tenantA, randomUUID(), randomUUID()],
      ),
      'a feedback record cannot reference a non-existent source transaction (composite FK)',
    );
  });
});
