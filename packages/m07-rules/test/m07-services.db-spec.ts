import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M07Emitter,
  RulesRepository,
  RuleSetService,
  EvaluationService,
  TestService,
  M07_PERMISSIONS,
  ALL_M07_PERMISSIONS,
} from '@finapp/m07-rules';

/**
 * M07 services DB spec — proves the rules engine works end-to-end on a REAL PostgreSQL and enforces its
 * governance: the authoring lifecycle, default-deny authorization, published-version immutability, deterministic
 * + explainable evaluation, append-only evidence with idempotent retry, hash-verified replay, and stored tests.
 * Authorization is the real RbacAuthz reading ctx.permissions; audit/outbox use the in-memory stand-ins here
 * (their durability/atomicity is proven by m03/m06's own specs).
 */
export default defineDbSpec('m07-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new M07Emitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new RulesRepository();
  const sets = new RuleSetService(db, authz, emitter, repo);
  const evals = new EvaluationService(db, authz, emitter, repo);
  const tests = new TestService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const author = randomUUID();
  const cid = (): string => randomUUID();
  const full: RequestContext = {
    tenantId: tenant,
    userId: author,
    correlationId: cid(),
    permissions: [...ALL_M07_PERMISSIONS],
  };
  const viewerOnly: RequestContext = {
    tenantId: tenant,
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [M07_PERMISSIONS.engineView],
  };
  const noPerm: RequestContext = { tenantId: tenant, userId: author, correlationId: cid(), permissions: [] };

  const spec = {
    schemaVersion: 1,
    code: 'credit_decision',
    name: 'Credit decision',
    inputSchema: [
      { name: 'amount', type: 'decimal', required: true, scale: 2 },
      { name: 'score', type: 'number', required: true },
    ],
    outputSchema: [{ name: 'decision', type: 'string', required: true }],
    derived: [],
    decisionTables: [
      {
        id: 't_decision',
        hitPolicy: 'FIRST',
        inputFields: ['score'],
        outputFields: ['decision'],
        rows: [
          {
            id: 'r_ok',
            when: { type: 'compare', field: 'score', op: 'ge', value: 700, valueType: 'number' },
            outputs: { decision: 'APPROVE' },
            reasonCode: 'SCORE_OK',
          },
          {
            id: 'r_low',
            when: { type: 'compare', field: 'score', op: 'lt', value: 700, valueType: 'number' },
            outputs: { decision: 'REVIEW' },
            reasonCode: 'SCORE_LOW',
          },
        ],
      },
    ],
  };

  // --- authoring lifecycle: create -> validate -> publish -> activate ----------------------------
  const created = await sets.create(full, author, { key: 'credit_decision', name: 'Credit decision', spec });
  t.equal(created.version.status, 'DRAFT', 'a new rule set version starts DRAFT');
  const validated = await sets.validate(full, author, created.version.id, created.version.version);
  t.equal(validated.status, 'VALIDATED', 'a well-formed spec validates');
  const published = await sets.publish(full, author, validated.id, validated.version);
  t.equal(published.status, 'PUBLISHED', 'a validated version publishes');
  t.ok(published.content_hash !== null, 'publishing freezes a content hash');
  const activated = await sets.activate(full, author, published.id, published.version);
  t.equal(activated.status, 'ACTIVE', 'a published version activates');

  // --- default deny -----------------------------------------------------------------------------
  let denied = false;
  try {
    await sets.create(noPerm, author, { key: 'x', name: 'X', spec });
  } catch (e) {
    denied = e instanceof Error && 'status' in e && (e as { status: number }).status === 403;
  }
  t.ok(denied, 'authoring without rules.engine.author is forbidden (default deny)');

  let evalDenied = false;
  try {
    await evals.evaluate(viewerOnly, author, {
      ruleSetId: created.ruleSet.id,
      input: { amount: '100.00', score: 800 },
    });
  } catch (e) {
    evalDenied = e instanceof Error && 'status' in e && (e as { status: number }).status === 403;
  }
  t.ok(evalDenied, 'evaluating with only view permission is forbidden (default deny)');

  // --- a validation failure is a fail-closed 400 -------------------------------------------------
  // A spec whose decision table has two rows sharing an id is malformed; the validator must reject it.
  const brokenSpec = {
    ...spec,
    code: 'bad',
    decisionTables: [
      {
        id: 't_decision',
        hitPolicy: 'FIRST',
        inputFields: ['score'],
        outputFields: ['decision'],
        rows: [
          {
            id: 'dupe',
            when: { type: 'compare', field: 'score', op: 'ge', value: 700, valueType: 'number' },
            outputs: { decision: 'APPROVE' },
            reasonCode: 'A',
          },
          {
            id: 'dupe',
            when: { type: 'compare', field: 'score', op: 'lt', value: 700, valueType: 'number' },
            outputs: { decision: 'REVIEW' },
            reasonCode: 'B',
          },
        ],
      },
    ],
  };
  const draftBad = await sets.create(full, author, { key: 'bad', name: 'Bad', spec: brokenSpec });
  let validationFailed = false;
  try {
    await sets.validate(full, author, draftBad.version.id, draftBad.version.version);
  } catch (e) {
    validationFailed = e instanceof Error && 'status' in e && (e as { status: number }).status === 400;
  }
  t.ok(validationFailed, 'a malformed spec (duplicate row id) fails validation with a 400 (fail closed)');

  // --- deterministic, explainable evaluation of the ACTIVE version -------------------------------
  const decision = await evals.evaluate(full, author, {
    ruleSetId: created.ruleSet.id,
    input: { amount: '2500.00', score: 800 },
    idempotencyKey: 'req-1',
  });
  t.equal(decision.explanation?.outputs['decision'], 'APPROVE', 'score 800 -> APPROVE (matched, explained)');
  t.ok(
    decision.explanation?.reasonCodes.includes('SCORE_OK'),
    'the explanation carries the machine reason code',
  );
  t.equal(decision.idempotent, false, 'the first evaluation is not an idempotent hit');

  // --- evidence stores the input HASH and redacted outcome, NOT the raw input --------------------
  const stored = await evals.getEvaluation(full, decision.evaluation.id);
  t.ok(stored.input_hash.length > 0, 'evidence records an input hash');
  t.ok(!JSON.stringify(stored.outcome).includes('2500'), 'evidence does not echo the raw input amount');

  // --- idempotency: the same key returns the SAME stored decision, no recompute -------------------
  const retry = await evals.evaluate(full, author, {
    ruleSetId: created.ruleSet.id,
    input: { amount: '2500.00', score: 800 },
    idempotencyKey: 'req-1',
  });
  t.equal(retry.idempotent, true, 'a repeated idempotency key is an idempotent hit');
  t.equal(retry.evaluation.id, decision.evaluation.id, 'the idempotent hit returns the original decision');

  // --- replay: re-supply the input, hash must match, result reproduced, original untouched --------
  const replay = await evals.replay(full, author, decision.evaluation.id, { amount: '2500.00', score: 800 });
  t.ok(replay.matches, 'replaying the original immutable version reproduces the same decision');
  t.ok(
    replay.replay.id !== decision.evaluation.id,
    'replay writes a NEW append-only record (original untouched)',
  );
  let mismatchRejected = false;
  try {
    await evals.replay(full, author, decision.evaluation.id, { amount: '2500.00', score: 999 });
  } catch (e) {
    mismatchRejected = e instanceof Error && 'status' in e && (e as { status: number }).status === 400;
  }
  t.ok(mismatchRejected, 'replay with a different input is rejected (hash mismatch)');

  // --- a low score deterministically REVIEWs -----------------------------------------------------
  const review = await evals.evaluate(full, author, {
    ruleSetId: created.ruleSet.id,
    input: { amount: '2500.00', score: 500 },
  });
  t.equal(review.explanation?.outputs['decision'], 'REVIEW', 'score 500 -> REVIEW (deterministic branch)');

  // --- a bad input is recorded as a fail-closed failed decision, not a crash ----------------------
  const failedEval = await evals.evaluate(full, author, {
    ruleSetId: created.ruleSet.id,
    input: { amount: '2500.00' }, // score is required
  });
  t.equal(
    failedEval.evaluation.status,
    'failed',
    'a missing required input yields a recorded FAILED decision',
  );

  // --- immutability: a published version cannot be re-published/edited (illegal transition) ------
  let illegal = false;
  try {
    await sets.publish(full, author, published.id, activated.version + 5);
  } catch (e) {
    illegal = e instanceof Error && 'status' in e && (e as { status: number }).status === 409;
  }
  t.ok(illegal, 'a stale/again publish of a live version is refused (409)');

  // --- stored tests run against a version --------------------------------------------------------
  await tests.createTestCase(full, author, {
    ruleSetId: created.ruleSet.id,
    name: 'approve-high',
    input: { amount: '100.00', score: 750 },
    expected: { decision: 'APPROVE' },
  });
  await tests.createTestCase(full, author, {
    ruleSetId: created.ruleSet.id,
    name: 'expect-wrong',
    input: { amount: '100.00', score: 400 },
    expected: { decision: 'APPROVE' }, // actually REVIEWs -> should fail
  });
  const run = await tests.runTests(full, author, created.ruleSet.id);
  t.equal(run.total, 2, 'both enabled test cases ran');
  t.equal(run.passed, 1, 'the correct expectation passes');
  t.equal(run.failed, 1, 'the wrong expectation fails (tests actually assert)');

  // --- tenant isolation through the service: another tenant sees nothing -------------------------
  const otherTenant: RequestContext = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [...ALL_M07_PERMISSIONS],
  };
  const otherList = await sets.list(otherTenant);
  t.equal(otherList.length, 0, "another tenant sees none of this tenant's rule sets (RLS)");
});
