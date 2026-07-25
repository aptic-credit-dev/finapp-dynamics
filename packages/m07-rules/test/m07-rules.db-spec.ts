import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RulesRepository } from '@finapp/m07-rules';

/**
 * M07 DB integration spec. Proves the rules schema's load-bearing guarantees on a REAL PostgreSQL through the
 * non-owner application role (RLS enforced, via PgDb bound to `appRole`): FORCE RLS + tenant isolation on all
 * five tables, append-only evidence + history via GRANT (the app role cannot rewrite a decision or a lifecycle
 * record), optimistic-lock single-winner updates, the one-ACTIVE-version-per-rule-set partial unique index,
 * and idempotency de-duplication of governed evaluations. Isolation is only ever asserted through the app role.
 */
export default defineDbSpec('m07-rules', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const repo = new RulesRepository();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const ctxA: RequestContext = { tenantId: tenantA, correlationId: randomUUID(), permissions: [] };
  const ctxB: RequestContext = { tenantId: tenantB, correlationId: randomUUID(), permissions: [] };

  const SPEC = {
    schemaVersion: 1,
    key: 'credit-limit',
    name: 'Credit limit',
    inputs: [{ name: 'score', type: 'number' }],
    outputs: [{ name: 'decision', type: 'string' }],
    derived: [],
    tables: [],
  };

  // --- RLS FORCE is set on every rules table -----------------------------------------------------
  const rls = await ctx.pool.query<{ relname: string; relforcerowsecurity: boolean }>(
    `SELECT relname, relforcerowsecurity FROM pg_class
     WHERE relname IN ('rule_set','rule_set_version','rule_evaluation','rule_test_case','rule_set_history')
       AND relkind = 'r'`,
  );
  t.equal(rls.rows.length, 5, 'all five rules tables exist');
  t.ok(
    rls.rows.every((r) => r.relforcerowsecurity),
    'every rules table has FORCE ROW LEVEL SECURITY',
  );

  // --- m07 seeds its 13 permissions into the global catalogue ------------------------------------
  const perms = await ctx.pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM permissions WHERE module = 'm07-rules'`,
  );
  t.equal(perms.rows[0]?.n, '13', 'm07 seeded 13 rules.* permissions');
  const privileged = await ctx.pool.query<{ code: string }>(
    `SELECT code FROM permissions WHERE module = 'm07-rules' AND privileged ORDER BY code`,
  );
  t.equal(
    privileged.rows.map((r) => r.code).join(','),
    'rules.engine.activate,rules.engine.publish,rules.engine.retire,rules.platform.administer',
    'publish/activate/retire + platform authority are the privileged permissions',
  );

  // --- seed a rule set + version + evaluation + test case + history in tenant A -------------------
  const seeded = await db.withTenant(ctxA, async (tx) => {
    const rs = await repo.insertRuleSet(tx, {
      tenantId: tenantA,
      key: 'credit-limit',
      name: 'Credit limit',
      description: null,
      scope: 'tenant',
      createdBy: null,
    });
    const num = await repo.nextVersionNumber(tx, rs.id);
    const ver = await repo.insertVersion(tx, {
      tenantId: tenantA,
      ruleSetId: rs.id,
      versionNumber: num,
      spec: SPEC,
      notes: null,
      createdBy: null,
    });
    await repo.appendHistory(tx, {
      tenantId: tenantA,
      ruleSetId: rs.id,
      versionId: ver.id,
      fromStatus: null,
      toStatus: 'DRAFT',
      action: 'create',
      reason: null,
      correlationId: ctxA.correlationId,
      changedBy: null,
    });
    const evalRow = await repo.insertEvaluation(tx, {
      tenantId: tenantA,
      ruleSetId: rs.id,
      versionId: ver.id,
      versionNumber: ver.version_number,
      idempotencyKey: 'idem-1',
      inputHash: 'hash-abc',
      engineVersion: 'm07-rules/1',
      status: 'completed',
      outcome: { outputs: { decision: 'approve' }, reasonCodes: ['R_OK'] },
      reasonCodes: ['R_OK'],
      mode: 'evaluate',
      correlationId: ctxA.correlationId,
      evaluatedBy: null,
    });
    const tc = await repo.insertTestCase(tx, {
      tenantId: tenantA,
      ruleSetId: rs.id,
      name: 'baseline',
      description: null,
      input: { score: 700 },
      expected: { decision: 'approve' },
      createdBy: null,
    });
    return { rsId: rs.id, verId: ver.id, verNum: ver.version_number, evalId: evalRow.id, tcId: tc.id };
  });
  t.equal(seeded.verNum, 1, 'first version is number 1');
  t.ok(seeded.evalId.length > 0, 'seeded a rule set, version, evaluation, test case and history in tenant A');

  // --- evidence stores the hash, NOT raw inputs (ADR-035) ----------------------------------------
  const evidence = await ctx.pool.query<{ input_hash: string; outcome: unknown }>(
    `SELECT input_hash, outcome FROM rule_evaluation WHERE id = $1`,
    [seeded.evalId],
  );
  t.equal(evidence.rows[0]?.input_hash, 'hash-abc', 'evaluation persists the input hash');
  t.ok(
    !JSON.stringify(evidence.rows[0]?.outcome).includes('700'),
    'the redacted outcome does not echo the raw input value',
  );

  // --- cross-tenant isolation (through the app role) ---------------------------------------------
  const rsInB = await db.withTenant(ctxB, (tx) => repo.findRuleSet(tx, seeded.rsId));
  t.equal(rsInB, null, "tenant B cannot see tenant A's rule set (RLS isolates)");
  const evalInB = await db.withTenant(ctxB, (tx) => repo.findEvaluation(tx, seeded.evalId));
  t.equal(evalInB, null, "tenant B cannot see tenant A's evaluation");
  const rsInA = await db.withTenant(ctxA, (tx) => repo.findRuleSet(tx, seeded.rsId));
  t.ok(rsInA !== null && rsInA.key === 'credit-limit', 'tenant A sees its own rule set');
  const rsB = await db.withTenant(ctxB, (tx) =>
    repo.insertRuleSet(tx, {
      tenantId: tenantB,
      key: 'credit-limit',
      name: 'B',
      description: null,
      scope: 'tenant',
      createdBy: null,
    }),
  );
  t.ok(rsB.id !== seeded.rsId, 'the same rule-set key is available in a different tenant');

  // --- append-only evidence + history: the app role cannot rewrite either ------------------------
  await t.rejects(
    db.withTenant(ctxA, (tx) =>
      tx.query(`UPDATE rule_evaluation SET outcome = '{}'::jsonb WHERE id = $1`, [seeded.evalId]),
    ),
    'the app role cannot UPDATE evaluation evidence (append-only via grant)',
  );
  await t.rejects(
    db.withTenant(ctxA, (tx) => tx.query(`DELETE FROM rule_evaluation WHERE id = $1`, [seeded.evalId])),
    'the app role cannot DELETE evaluation evidence',
  );
  await t.rejects(
    db.withTenant(ctxA, (tx) =>
      tx.query(`UPDATE rule_set_history SET reason = 'tampered' WHERE rule_set_id = $1`, [seeded.rsId]),
    ),
    'the app role cannot UPDATE lifecycle history (append-only via grant)',
  );

  // --- idempotency: a duplicate governed evaluation key is rejected by the unique index ----------
  const dup = await db.withTenant(ctxA, (tx) =>
    repo
      .insertEvaluation(tx, {
        tenantId: tenantA,
        ruleSetId: seeded.rsId,
        versionId: seeded.verId,
        versionNumber: seeded.verNum,
        idempotencyKey: 'idem-1',
        inputHash: 'hash-abc',
        engineVersion: 'm07-rules/1',
        status: 'completed',
        outcome: { outputs: {}, reasonCodes: [] },
        reasonCodes: [],
        mode: 'evaluate',
        correlationId: ctxA.correlationId,
        evaluatedBy: null,
      })
      .then(() => 'inserted')
      .catch(() => 'rejected'),
  );
  t.equal(dup, 'rejected', 'a duplicate idempotency key cannot create a second governed evaluation');
  const found = await db.withTenant(ctxA, (tx) =>
    repo.findEvaluationByIdempotencyKey(tx, seeded.rsId, 'idem-1'),
  );
  t.ok(found !== null && found.id === seeded.evalId, 'the stored decision is returned on idempotent replay');

  // --- publish freezes the content hash; activate enforces one ACTIVE per rule set ---------------
  const published = await db.withTenant(ctxA, (tx) =>
    repo.updateVersionStatus(tx, {
      id: seeded.verId,
      expectedVersion: 1,
      toStatus: 'PUBLISHED',
      contentHash: 'sha256:frozen',
      publishedBy: null,
    }),
  );
  t.ok(published !== null && published.content_hash === 'sha256:frozen', 'publish froze the content hash');
  // A stale optimistic version now changes zero rows -> null (409 at the service).
  const stale = await db.withTenant(ctxA, (tx) =>
    repo.updateVersionStatus(tx, { id: seeded.verId, expectedVersion: 1, toStatus: 'ACTIVE' }),
  );
  t.equal(stale, null, 'a stale version number changes zero rows (optimistic lock)');
  const activated = await db.withTenant(ctxA, (tx) =>
    repo.updateVersionStatus(tx, { id: seeded.verId, expectedVersion: 2, toStatus: 'ACTIVE' }),
  );
  t.ok(activated !== null && activated.status === 'ACTIVE', 'the current version activates');

  // A SECOND version cannot also be ACTIVE (partial unique index) -----------------------------------
  const clash = await db.withTenant(ctxA, async (tx) => {
    const num = await repo.nextVersionNumber(tx, seeded.rsId);
    const v2 = await repo.insertVersion(tx, {
      tenantId: tenantA,
      ruleSetId: seeded.rsId,
      versionNumber: num,
      spec: SPEC,
      notes: null,
      createdBy: null,
    });
    return repo
      .updateVersionStatus(tx, {
        id: v2.id,
        expectedVersion: 1,
        toStatus: 'ACTIVE',
        contentHash: 'sha256:frozen2',
      })
      .then(() => 'activated')
      .catch(() => 'rejected');
  });
  t.equal(clash, 'rejected', 'a second version cannot be ACTIVE at the same time (one-active index)');

  // --- history is readable and ordered -----------------------------------------------------------
  const history = await db.withTenant(ctxA, (tx) => repo.listHistory(tx, seeded.rsId));
  t.ok(history.length >= 1 && history[0]?.action === 'create', 'lifecycle history is append-only and readable');
});
