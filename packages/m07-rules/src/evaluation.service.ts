/**
 * EvaluationService — deterministic, explainable, audited rule evaluation (ADR-033/035). Every governed
 * evaluation enforces `rules.engine.evaluate`, runs the PURE engine against the rule set's ACTIVE (immutable)
 * version, records APPEND-ONLY evidence (input HASH + redacted structured explanation, never raw inputs),
 * writes audit + a rules.lifecycle event in the SAME transaction, and is idempotent: a repeated idempotency
 * key returns the stored decision instead of recomputing. Replay re-runs the ORIGINAL immutable version and
 * proves the same result WITHOUT ever having stored the raw input — the caller re-supplies it and the hash is
 * verified against the evidence. Simulation is a permissioned dry-run against any version and persists nothing.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M07_PERMISSIONS } from './permissions.ts';
import { M07_AUDIT_CODES } from './audit-codes.ts';
import { RuleError } from './domain/decimal.ts';
import { evaluateRuleSet, inputHash, ENGINE_VERSION, type Explanation } from './domain/evaluate.ts';
import type { RuleSetSpec } from './domain/ruleset.ts';
import { RulesRepository, type RuleEvaluationRow } from './repository.ts';
import type { M07Emitter } from './emit.ts';

/** The redacted decision record stored as evidence — outputs + reason codes + matched ids, never raw inputs. */
export interface RedactedOutcome {
  readonly outcome: 'matched' | 'no_match' | 'error';
  readonly outputs: Record<string, unknown>;
  readonly matchedRuleIds: string[];
  readonly reasonCodes: string[];
  readonly tables: { readonly tableId: string; readonly matchedRowIds: string[] }[];
  readonly warnings: string[];
  readonly error?: { readonly code: string; readonly message: string };
}

type EngineResult =
  | { readonly ok: true; readonly explanation: Explanation }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface EvaluationOutput {
  readonly evaluation: RuleEvaluationRow;
  /** The FULL explanation (with value-bearing traces) — returned transiently, never persisted. Null on idempotent hit. */
  readonly explanation: Explanation | null;
  readonly idempotent: boolean;
}

export interface ReplayOutput {
  readonly original: RuleEvaluationRow;
  readonly replay: RuleEvaluationRow;
  readonly matches: boolean;
  readonly explanation: Explanation;
}

/** Run the PURE engine, converting an engine RuleError into a recorded failed outcome (fail closed). */
function runEngine(spec: RuleSetSpec, input: Record<string, unknown>, evaluatedAt?: string): EngineResult {
  try {
    const explanation = evaluateRuleSet(spec, {
      input,
      ...(evaluatedAt !== undefined ? { context: { evaluatedAt } } : {}),
    });
    return { ok: true, explanation };
  } catch (error: unknown) {
    if (error instanceof RuleError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

function redact(explanation: Explanation): RedactedOutcome {
  return {
    outcome: explanation.outcome,
    outputs: explanation.outputs,
    matchedRuleIds: explanation.matchedRuleIds,
    reasonCodes: explanation.reasonCodes,
    tables: explanation.tableTraces.map((t) => ({ tableId: t.tableId, matchedRowIds: t.matchedRowIds })),
    warnings: explanation.warnings,
  };
}

export class EvaluationService {
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

  /** Evaluate the rule set's ACTIVE version. Idempotent per (rule set, idempotencyKey). Records evidence. */
  async evaluate(
    ctx: RequestContext,
    actor: string | null,
    input: {
      ruleSetId: string;
      input: Record<string, unknown>;
      idempotencyKey?: string | null;
      evaluatedAt?: string;
      subjectType?: string;
      subjectId?: string;
    },
  ): Promise<EvaluationOutput> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineEvaluate);
    return this.db.withTenant(ctx, async (tx) => {
      const ruleSet = await this.repo.findRuleSet(tx, input.ruleSetId);
      if (ruleSet === null) throw ProblemError.notFound('Rule set not found.', ctx.correlationId);
      const version = await this.repo.findActiveVersion(tx, input.ruleSetId);
      if (version === null)
        throw ProblemError.conflict('Rule set has no ACTIVE version to evaluate.', ctx.correlationId);

      const idempotencyKey = input.idempotencyKey ?? null;
      if (idempotencyKey !== null) {
        const prior = await this.repo.findEvaluationByIdempotencyKey(tx, input.ruleSetId, idempotencyKey);
        if (prior !== null) return { evaluation: prior, explanation: null, idempotent: true };
      }

      const hash = inputHash(input.input);
      const result = runEngine(version.spec as RuleSetSpec, input.input, input.evaluatedAt);

      const redacted: RedactedOutcome = result.ok
        ? redact(result.explanation)
        : {
            outcome: 'error',
            outputs: {},
            matchedRuleIds: [],
            reasonCodes: [result.code],
            tables: [],
            warnings: [],
            error: { code: result.code, message: result.message },
          };
      const reasonCodes = redacted.reasonCodes;
      const status = result.ok ? 'completed' : 'failed';

      const evaluation = await this.repo.insertEvaluation(tx, {
        tenantId: ctx.tenantId,
        ruleSetId: input.ruleSetId,
        versionId: version.id,
        versionNumber: version.version_number,
        idempotencyKey,
        inputHash: hash,
        engineVersion: ENGINE_VERSION,
        status,
        outcome: redacted,
        reasonCodes,
        mode: 'evaluate',
        correlationId: ctx.correlationId,
        evaluatedBy: actor,
      });

      await this.emitter.recordAudit(tx, ctx, {
        code: result.ok ? M07_AUDIT_CODES.evaluationExecuted : M07_AUDIT_CODES.evaluationFailed,
        entityType: 'rule_evaluation',
        entityId: evaluation.id,
        detail: { ruleSetId: input.ruleSetId, outcome: redacted.outcome, inputHash: hash },
      });
      await this.emitter.publish(tx, {
        type: result.ok ? 'RuleEvaluationCompleted' : 'RuleEvaluationFailed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          evaluationId: evaluation.id,
          ruleSetId: input.ruleSetId,
          versionId: version.id,
          outcome: redacted.outcome,
          inputHash: hash,
          reasonCodes,
          ...(input.subjectType !== undefined ? { subjectType: input.subjectType } : {}),
          ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
        },
      });

      return { evaluation, explanation: result.ok ? result.explanation : null, idempotent: false };
    });
  }

  /**
   * Replay a recorded evaluation: re-run its ORIGINAL immutable version and prove the result is the same. The
   * raw input was never stored (ADR-035), so the caller re-supplies it; we verify inputHash(input) matches the
   * evidence before re-running, then record a NEW append-only replay record. The original is never mutated.
   */
  async replay(
    ctx: RequestContext,
    actor: string | null,
    evaluationId: string,
    input: Record<string, unknown>,
    evaluatedAt?: string,
  ): Promise<ReplayOutput> {
    await this.authz.require(ctx, M07_PERMISSIONS.evaluationReplay);
    return this.db.withTenant(ctx, async (tx) => {
      const original = await this.repo.findEvaluation(tx, evaluationId);
      if (original === null) throw ProblemError.notFound('Evaluation not found.', ctx.correlationId);
      const version = await this.repo.findVersion(tx, original.version_id);
      if (version === null)
        throw ProblemError.notFound('The evaluated version no longer exists.', ctx.correlationId);

      const hash = inputHash(input);
      if (hash !== original.input_hash) {
        throw new ProblemError({
          type: 'https://finapp.dynamics/problems/validation',
          title: 'Replay input mismatch',
          status: 400,
          detail: 'The supplied input does not match the recorded evaluation (input hash mismatch).',
          correlationId: ctx.correlationId,
        });
      }

      const result = runEngine(version.spec as RuleSetSpec, input, evaluatedAt);
      const redacted: RedactedOutcome = result.ok
        ? redact(result.explanation)
        : {
            outcome: 'error',
            outputs: {},
            matchedRuleIds: [],
            reasonCodes: [result.code],
            tables: [],
            warnings: [],
            error: { code: result.code, message: result.message },
          };

      // Determinism check: the replay's outcome + reason codes must equal the original evidence.
      const priorOutcome = original.outcome as RedactedOutcome | null;
      const matches =
        priorOutcome !== null &&
        priorOutcome.outcome === redacted.outcome &&
        JSON.stringify(priorOutcome.reasonCodes) === JSON.stringify(redacted.reasonCodes) &&
        JSON.stringify(priorOutcome.outputs) === JSON.stringify(redacted.outputs);

      const replay = await this.repo.insertEvaluation(tx, {
        tenantId: ctx.tenantId,
        ruleSetId: original.rule_set_id,
        versionId: original.version_id,
        versionNumber: original.version_number,
        idempotencyKey: null,
        inputHash: hash,
        engineVersion: ENGINE_VERSION,
        status: result.ok ? 'completed' : 'failed',
        outcome: { ...redacted, replayOf: evaluationId, matches },
        reasonCodes: redacted.reasonCodes,
        mode: 'replay',
        correlationId: ctx.correlationId,
        evaluatedBy: actor,
      });

      await this.emitter.recordAudit(tx, ctx, {
        code: M07_AUDIT_CODES.evaluationReplayed,
        entityType: 'rule_evaluation',
        entityId: evaluationId,
        detail: { replayId: replay.id, matches, inputHash: hash },
      });
      await this.emitter.publish(tx, {
        type: 'RuleEvaluationReplayed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          evaluationId,
          ruleSetId: original.rule_set_id,
          versionId: original.version_id,
          outcome: redacted.outcome,
          inputHash: hash,
          reasonCodes: redacted.reasonCodes,
        },
      });

      if (!result.ok)
        return { original, replay, matches, explanation: emptyExplanation(version.spec as RuleSetSpec) };
      return { original, replay, matches, explanation: result.explanation };
    });
  }

  /** Permissioned dry-run against ANY version (including DRAFT). Persists NO evidence; audits the simulation. */
  async simulate(
    ctx: RequestContext,
    input: { versionId: string; input: Record<string, unknown>; evaluatedAt?: string },
  ): Promise<{ outcome: RedactedOutcome; explanation: Explanation | null }> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineSimulate);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.findVersion(tx, input.versionId);
      if (version === null) throw ProblemError.notFound('Rule set version not found.', ctx.correlationId);
      const result = runEngine(version.spec as RuleSetSpec, input.input, input.evaluatedAt);
      const redacted: RedactedOutcome = result.ok
        ? redact(result.explanation)
        : {
            outcome: 'error',
            outputs: {},
            matchedRuleIds: [],
            reasonCodes: [result.code],
            tables: [],
            warnings: [],
            error: { code: result.code, message: result.message },
          };
      await this.emitter.recordAudit(tx, ctx, {
        code: M07_AUDIT_CODES.simulationExecuted,
        entityType: 'rule_set_version',
        entityId: input.versionId,
        detail: { outcome: redacted.outcome, inputHash: inputHash(input.input) },
      });
      return { outcome: redacted, explanation: result.ok ? result.explanation : null };
    });
  }

  // --- reads (evaluation.view) ------------------------------------------------------------------
  async getEvaluation(ctx: RequestContext, evaluationId: string): Promise<RuleEvaluationRow> {
    await this.authz.require(ctx, M07_PERMISSIONS.evaluationView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findEvaluation(tx, evaluationId));
    if (row === null) throw ProblemError.notFound('Evaluation not found.', ctx.correlationId);
    return row;
  }

  async listEvaluations(ctx: RequestContext, ruleSetId: string, limit = 50): Promise<RuleEvaluationRow[]> {
    await this.authz.require(ctx, M07_PERMISSIONS.evaluationView);
    const capped = Math.min(Math.max(limit, 1), 200);
    return this.db.withTenant(ctx, (tx) => this.repo.listEvaluations(tx, ruleSetId, capped));
  }

  /**
   * Export a rule set's decision evidence — a distinct, separately-permissioned and AUDITED read (evidence
   * leaving the system is itself an event, ADR-035). Returns the same append-only rows; the audit records that
   * an export was requested.
   */
  async exportEvaluations(ctx: RequestContext, ruleSetId: string, limit = 200): Promise<RuleEvaluationRow[]> {
    await this.authz.require(ctx, M07_PERMISSIONS.evaluationExport);
    const capped = Math.min(Math.max(limit, 1), 1000);
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await this.repo.listEvaluations(tx, ruleSetId, capped);
      await this.emitter.recordAudit(tx, ctx, {
        code: M07_AUDIT_CODES.exportRequested,
        entityType: 'rule_set',
        entityId: ruleSetId,
        detail: { count: rows.length },
      });
      return rows;
    });
  }
}

/** A minimal explanation stand-in for a failed replay (the caller cares about `matches`, not the trace). */
function emptyExplanation(spec: RuleSetSpec): Explanation {
  return {
    engineVersion: ENGINE_VERSION,
    ruleSetCode: spec.code,
    outcome: 'error',
    outputs: {},
    matchedRuleIds: [],
    reasonCodes: [],
    tableTraces: [],
    derivedValues: {},
    warnings: [],
  };
}
