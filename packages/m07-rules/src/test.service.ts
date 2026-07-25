/**
 * TestService — stored, replayable test cases for a rule set (rules.engine.test). A test case pins a synthetic
 * input and its expected outputs; running the suite evaluates every enabled case against a chosen version
 * (default: the ACTIVE one, or a candidate DRAFT before publish) through the PURE engine and reports pass/fail
 * per case plus a summary. Runs audit `RULES_TEST_EXECUTED` (and `RULES_TEST_FAILED` when any case fails) and
 * publish a `RuleTestCompleted` event, in the same transaction. Test fixtures are synthetic, not production data.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M07_PERMISSIONS } from './permissions.ts';
import { M07_AUDIT_CODES } from './audit-codes.ts';
import { RuleError } from './domain/decimal.ts';
import { evaluateRuleSet } from './domain/evaluate.ts';
import type { RuleSetSpec } from './domain/ruleset.ts';
import { RulesRepository, type RuleTestCaseRow } from './repository.ts';
import type { M07Emitter } from './emit.ts';

export interface TestCaseResult {
  readonly testId: string;
  readonly name: string;
  readonly passed: boolean;
  readonly reason: string | null;
}

export interface TestRunResult {
  readonly ruleSetId: string;
  readonly versionId: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: TestCaseResult[];
}

/** Deep structural equality (order-independent for objects) — used to compare produced vs expected outputs. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length || !ak.every((k, i) => k === bk[i])) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

export class TestService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M07Emitter;
  private readonly repo: RulesRepository;

  constructor(db: Db, authz: Authz, emitter: M07Emitter, repo: RulesRepository = new RulesRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async createTestCase(
    ctx: RequestContext,
    actor: string | null,
    input: {
      ruleSetId: string;
      name: string;
      description?: string | null;
      input: Record<string, unknown>;
      expected: Record<string, unknown>;
    },
  ): Promise<RuleTestCaseRow> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineTest);
    return this.db.withTenant(ctx, async (tx) => {
      const ruleSet = await this.repo.findRuleSet(tx, input.ruleSetId);
      if (ruleSet === null) throw ProblemError.notFound('Rule set not found.', ctx.correlationId);
      const row = await this.repo.insertTestCase(tx, {
        tenantId: ctx.tenantId,
        ruleSetId: input.ruleSetId,
        name: input.name,
        description: input.description ?? null,
        input: input.input,
        expected: input.expected,
        createdBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M07_AUDIT_CODES.testCreated,
        entityType: 'rule_test_case',
        entityId: row.id,
        detail: { ruleSetId: input.ruleSetId, name: input.name },
      });
      return row;
    });
  }

  async listTestCases(ctx: RequestContext, ruleSetId: string): Promise<RuleTestCaseRow[]> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineView);
    return this.db.withTenant(ctx, (tx) => this.repo.listTestCases(tx, ruleSetId));
  }

  /** Run all enabled test cases for a rule set against a version (default ACTIVE, else the given versionId). */
  async runTests(
    ctx: RequestContext,
    actor: string | null,
    ruleSetId: string,
    versionId?: string,
  ): Promise<TestRunResult> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineTest);
    return this.db.withTenant(ctx, async (tx) => {
      const ruleSet = await this.repo.findRuleSet(tx, ruleSetId);
      if (ruleSet === null) throw ProblemError.notFound('Rule set not found.', ctx.correlationId);
      const version =
        versionId !== undefined
          ? await this.repo.findVersion(tx, versionId)
          : await this.repo.findActiveVersion(tx, ruleSetId);
      if (version === null)
        throw ProblemError.conflict(
          'No version to test (supply a versionId or activate one).',
          ctx.correlationId,
        );

      const spec = version.spec as RuleSetSpec;
      const cases = (await this.repo.listTestCases(tx, ruleSetId)).filter((c) => c.enabled);
      const results: TestCaseResult[] = cases.map((c) => {
        try {
          const explanation = evaluateRuleSet(spec, { input: c.input as Record<string, unknown> });
          const expected = c.expected as Record<string, unknown>;
          // A case passes when every expected output key matches the produced output exactly.
          const passed = Object.keys(expected).every((k) => deepEqual(explanation.outputs[k], expected[k]));
          return {
            testId: c.id,
            name: c.name,
            passed,
            reason: passed ? null : 'output did not match expected',
          };
        } catch (error: unknown) {
          const code = error instanceof RuleError ? error.code : 'ENGINE_ERROR';
          return { testId: c.id, name: c.name, passed: false, reason: code };
        }
      });

      const failed = results.filter((r) => !r.passed).length;
      const passed = results.length - failed;

      await this.emitter.recordAudit(tx, ctx, {
        code: failed > 0 ? M07_AUDIT_CODES.testFailed : M07_AUDIT_CODES.testExecuted,
        entityType: 'rule_set_version',
        entityId: version.id,
        detail: { ruleSetId, total: results.length, passed, failed },
      });
      await this.emitter.publish(tx, {
        type: 'RuleTestCompleted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { testId: version.id, ruleSetId, passed: failed === 0 },
      });

      return { ruleSetId, versionId: version.id, total: results.length, passed, failed, results };
    });
  }
}
