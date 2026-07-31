/**
 * ReconciliationService — the GL-reconciliation RUN lifecycle + the balance-invariant computation + the deterministic
 * matching ORCHESTRATION. A run moves draft → running → review_required → completed (reopened; or failed) through the
 * single choke point `checkRunTransition`. Executing a run (1) computes the balance invariant (opening + debits −
 * credits = calculated closing) in INTEGER MINOR UNITS and records append-only evidence (gl_run_balance), raising a
 * closing_balance_mismatch exception when the calculated closing differs from the expected/source closing beyond the
 * ruleset tolerance; then (2) matches unmatched GL lines against unmatched source lines using the PURE m15a engine
 * (REUSED — never duplicated), recording explainable candidate evidence, auto-proposing exact/strong matches and
 * raising an exception otherwise. A run CANNOT complete while a REQUIRED exception is open (fail closed). Money is
 * INTEGER MINOR UNITS — row amounts (bigint strings) are converted to safe integers for the engine, never through a
 * float (ADR-007). Every mutation runs inside `db.withTenant` with audit + a glrecon.lifecycle event in the same tx.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { GlreconLifecycleEventType, GlreconLifecyclePayload } from '@finapp/contracts';
import {
  bestCandidate,
  reconcileBalance,
  type MatchableLine,
  type Ruleset as EngineRuleset,
} from './engine.ts';
import { M20_PERMISSIONS } from './permissions.ts';
import { M20_AUDIT_CODES } from './audit-codes.ts';
import { checkRunTransition } from './domain/lifecycles.ts';
import { GlreconError } from './domain/limits.ts';
import { badRequest } from './errors.ts';
import {
  GlreconRepository,
  type GlRunRow,
  type GlRulesetRow,
  type GlLineRow,
  type GlSourceLineRow,
  type GlMatchCandidateRow,
  type GlRunBalanceRow,
  type GlRunStatusHistoryRow,
  type GlRunSummaryRow,
} from './repository.ts';
import type { M20Emitter } from './emit.ts';

function toMinorInt(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n))
    throw new GlreconError('AMOUNT_TOO_LARGE', `amount ${v} exceeds safe integer range`);
  return n;
}
function toMatchable(row: GlLineRow | GlSourceLineRow, date: string): MatchableLine {
  return {
    id: row.id,
    amountMinor: toMinorInt(row.amount_minor),
    direction: row.direction === 'debit' ? 'debit' : 'credit',
    date,
    ...(row.reference !== null ? { reference: row.reference } : {}),
    ...(row.description !== null ? { description: row.description } : {}),
  };
}

export class ReconciliationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M20Emitter;
  private readonly repo: GlreconRepository;
  constructor(db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository = new GlreconRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: GlreconLifecycleEventType,
    payload: GlreconLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }
  private async requireRun(tx: Tx, id: string, correlationId: string): Promise<GlRunRow> {
    const r = await this.repo.findRun(tx, id);
    if (r === null) throw ProblemError.notFound('Reconciliation run not found.', correlationId);
    return r;
  }
  private async engineRuleset(tx: Tx, ruleset: GlRulesetRow): Promise<EngineRuleset> {
    const rules = await this.repo.listRulesByRuleset(tx, ruleset.id);
    return {
      version: ruleset.version_number,
      dateWindowDays: ruleset.date_window_days,
      amountToleranceMinor: toMinorInt(ruleset.amount_tolerance_minor),
      requireOppositeDirection: ruleset.require_opposite_direction,
      rules: rules.map((r) => ({ code: r.rule_code, kind: r.rule_kind, weight: r.weight })),
    };
  }

  // --- run lifecycle ----------------------------------------------------------------------------
  async createRun(
    ctx: RequestContext,
    actor: string | null,
    input: {
      glAccountId: string;
      rulesetId?: string | null;
      periodStart?: string | null;
      periodEnd?: string | null;
      openingBalanceMinor?: number | null;
      closingBalanceMinor?: number | null;
    },
  ): Promise<GlRunRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.runCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const acct = await this.repo.findAccount(tx, input.glAccountId);
      if (acct === null) throw ProblemError.notFound('GL account not found.', ctx.correlationId);
      const row = await this.repo.insertRun(tx, {
        tenantId: ctx.tenantId,
        glAccountId: input.glAccountId,
        rulesetId: input.rulesetId ?? null,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        openingBalanceMinor: input.openingBalanceMinor ?? null,
        closingBalanceMinor: input.closingBalanceMinor ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.runCreated,
        entityType: 'gl_recon_run',
        entityId: row.id,
        detail: { glAccountRef: input.glAccountId },
      });
      await this.publish(tx, ctx, actor, 'RunCreated', {
        recordId: row.id,
        recordType: 'run',
        glAccountRef: input.glAccountId,
        runId: row.id,
        toStatus: row.status,
      });
      return row;
    });
  }

  /** Execute a run: compute the balance invariant, then deterministic matching (running → review_required). */
  async executeRun(
    ctx: RequestContext,
    actor: string | null,
    runId: string,
    expectedVersion: number,
  ): Promise<GlRunRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.runExecute);
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.requireRun(tx, runId, ctx.correlationId);
      const toRunning = checkRunTransition(run.status, 'running');
      if (!toRunning.ok)
        throw ProblemError.conflict(
          `Cannot execute from ${run.status}: ${toRunning.reason ?? ''}`,
          ctx.correlationId,
        );
      const ruleset =
        run.ruleset_id !== null
          ? await this.repo.findRuleset(tx, run.ruleset_id)
          : await this.repo.findActiveRuleset(tx, 'default');
      if (ruleset === null)
        throw badRequest('No matching ruleset available for this run.', ctx.correlationId);

      const started = await this.repo.transitionRun(tx, {
        id: runId,
        expectedVersion,
        toStatus: 'running',
        by: actor,
      });
      if (started === null)
        throw ProblemError.conflict('Run modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertRunStatusHistory(tx, {
        tenantId: ctx.tenantId,
        runId,
        fromStatus: run.status,
        toStatus: 'running',
        reason: 'run started',
        reasonCode: 'running',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.runStarted,
        entityType: 'gl_recon_run',
        entityId: runId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'RunStarted', {
        recordId: runId,
        recordType: 'run',
        runId,
        rulesetVersion: ruleset.version_number,
        toStatus: 'running',
      });

      let exceptions = 0;

      // (1) BALANCE INVARIANT — opening + debits − credits = calculated closing (exact minor units). The expected
      // (source) closing is the run's closing_balance_minor; a difference beyond tolerance raises an exception.
      const openingMinor = run.opening_balance_minor !== null ? toMinorInt(run.opening_balance_minor) : 0;
      const agg = await this.repo.aggregateGlAmounts(tx, run.gl_account_id);
      const debitsMinor = toMinorInt(agg.debitsMinor);
      const creditsMinor = toMinorInt(agg.creditsMinor);
      const hasSourceClosing = run.closing_balance_minor !== null;
      const sourceClosingMinor = hasSourceClosing ? toMinorInt(run.closing_balance_minor) : null;
      const bal = reconcileBalance({
        openingMinor,
        debitsMinor,
        creditsMinor,
        sourceClosingMinor: sourceClosingMinor ?? openingMinor + debitsMinor - creditsMinor,
        toleranceMinor: toMinorInt(ruleset.amount_tolerance_minor),
      });
      await this.repo.insertRunBalance(tx, {
        tenantId: ctx.tenantId,
        runId,
        openingMinor: bal.openingMinor,
        debitsMinor: bal.debitsMinor,
        creditsMinor: bal.creditsMinor,
        calculatedClosingMinor: bal.calculatedClosingMinor,
        sourceClosingMinor,
        varianceMinor: bal.varianceMinor,
        balanced: bal.balanced,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.balanceComputed,
        entityType: 'gl_run_balance',
        entityId: runId,
        detail: { balanced: bal.balanced, reasonCode: bal.reasonCode },
      });
      await this.publish(tx, ctx, actor, 'RunBalanceComputed', {
        recordId: runId,
        recordType: 'run',
        runId,
        balanceVarianceMinor: String(bal.varianceMinor),
        reasonCode: bal.reasonCode,
      });
      const toleranceMinor = toMinorInt(ruleset.amount_tolerance_minor);
      const absVariance = bal.varianceMinor < 0 ? -bal.varianceMinor : bal.varianceMinor;
      if (hasSourceClosing && absVariance > toleranceMinor) {
        const exc = await this.repo.insertException(tx, {
          tenantId: ctx.tenantId,
          runId,
          glLineId: null,
          sourceLineId: null,
          exceptionType: 'closing_balance_mismatch',
          ageDays: 0,
          reason: `balance variance ${String(bal.varianceMinor)} (minor units)`,
          required: true,
          correlationId: ctx.correlationId,
          by: actor,
        });
        exceptions += 1;
        await this.emitter.recordAudit(tx, ctx, {
          code: M20_AUDIT_CODES.exceptionRaised,
          entityType: 'gl_exception',
          entityId: exc.id,
          detail: { exceptionType: 'closing_balance_mismatch' },
        });
        await this.publish(tx, ctx, actor, 'ExceptionRaised', {
          recordId: exc.id,
          recordType: 'exception',
          runId,
          exceptionType: 'closing_balance_mismatch',
          balanceVarianceMinor: String(bal.varianceMinor),
        });
      }

      // (2) DETERMINISTIC LINE MATCHING (reuses the m15a engine) — GL lines vs source lines.
      const engine = await this.engineRuleset(tx, ruleset);
      const glLines = await this.repo.listUnmatchedLines(tx, run.gl_account_id);
      const sourceLines = await this.repo.listUnmatchedSourceLines(tx, run.gl_account_id);
      const sourceMatchables = sourceLines.map((l) => toMatchable(l, l.entry_date));
      const claimedSource = new Set<string>();
      let matched = 0;

      for (const g of glLines) {
        const gM = toMatchable(g, g.txn_date);
        const pool = sourceMatchables.filter((l) => !claimedSource.has(l.id));
        const candidate = pool.length > 0 ? bestCandidate(gM, pool, engine) : null;
        if (candidate !== null) {
          await this.repo.insertMatchCandidate(tx, {
            tenantId: ctx.tenantId,
            runId,
            glLineId: g.id,
            sourceLineId: candidate.ledgerEntryId,
            score: candidate.score,
            confidenceBand: candidate.confidenceBand,
            colourStatus: candidate.colourStatus,
            amountVarianceMinor: candidate.amountVarianceMinor,
            dateVarianceDays: candidate.dateVarianceDays,
            referenceMatch: candidate.referenceMatch,
            descriptionScore: candidate.descriptionScore.toFixed(3),
            directionCompatible: candidate.directionCompatible,
            reasonCodes: candidate.reasonCodes,
            ruleCodes: candidate.ruleCodes,
            rulesetId: ruleset.id,
            rulesetVersion: ruleset.version_number,
            correlationId: ctx.correlationId,
          });
        }
        if (
          candidate !== null &&
          (candidate.confidenceBand === 'exact' || candidate.confidenceBand === 'strong')
        ) {
          claimedSource.add(candidate.ledgerEntryId);
          const match = await this.repo.insertMatch(tx, {
            tenantId: ctx.tenantId,
            runId,
            matchType: 'one_to_one',
            status: 'proposed',
            confidenceBand: candidate.confidenceBand,
            colourStatus: candidate.colourStatus,
            score: candidate.score,
            amountVarianceMinor: candidate.amountVarianceMinor,
            matchedBy: 'system',
            rulesetId: ruleset.id,
            rulesetVersion: ruleset.version_number,
            idempotencyKey: `run:${runId}:gl:${g.id}`,
            correlationId: ctx.correlationId,
            by: actor,
          });
          await this.repo.insertMatchLine(tx, {
            tenantId: ctx.tenantId,
            matchId: match.id,
            side: 'gl',
            glLineId: g.id,
            sourceLineId: null,
            amountMinor: toMinorInt(g.amount_minor),
            correlationId: ctx.correlationId,
            by: actor,
          });
          const src = sourceLines.find((l) => l.id === candidate.ledgerEntryId);
          await this.repo.insertMatchLine(tx, {
            tenantId: ctx.tenantId,
            matchId: match.id,
            side: 'source',
            glLineId: null,
            sourceLineId: candidate.ledgerEntryId,
            amountMinor: src !== undefined ? toMinorInt(src.amount_minor) : toMinorInt(g.amount_minor),
            correlationId: ctx.correlationId,
            by: actor,
          });
          await this.repo.setLineStatus(tx, {
            id: g.id,
            expectedVersion: g.version,
            toStatus: 'matched',
            by: actor,
          });
          if (src !== undefined)
            await this.repo.setSourceLineStatus(tx, {
              id: src.id,
              expectedVersion: src.version,
              toStatus: 'matched',
              by: actor,
            });
          await this.emitter.recordAudit(tx, ctx, {
            code: M20_AUDIT_CODES.matchProposed,
            entityType: 'gl_match',
            entityId: match.id,
            detail: { confidenceBand: candidate.confidenceBand, score: candidate.score },
          });
          await this.publish(tx, ctx, actor, 'MatchProposed', {
            recordId: match.id,
            recordType: 'match',
            runId,
            matchType: 'one_to_one',
            confidenceBand: candidate.confidenceBand,
            score: candidate.score,
            amountVarianceMinor: String(candidate.amountVarianceMinor),
            matchedBy: 'system',
          });
          matched += 1;
        } else {
          const exc = await this.repo.insertException(tx, {
            tenantId: ctx.tenantId,
            runId,
            glLineId: g.id,
            sourceLineId: null,
            exceptionType: 'unmatched_gl',
            ageDays: 0,
            reason: candidate === null ? 'no candidate' : `best band ${candidate.confidenceBand}`,
            required: true,
            correlationId: ctx.correlationId,
            by: actor,
          });
          await this.repo.setLineStatus(tx, {
            id: g.id,
            expectedVersion: g.version,
            toStatus: 'excepted',
            by: actor,
          });
          exceptions += 1;
          await this.emitter.recordAudit(tx, ctx, {
            code: M20_AUDIT_CODES.exceptionRaised,
            entityType: 'gl_exception',
            entityId: exc.id,
            detail: { exceptionType: 'unmatched_gl' },
          });
          await this.publish(tx, ctx, actor, 'ExceptionRaised', {
            recordId: exc.id,
            recordType: 'exception',
            runId,
            exceptionType: 'unmatched_gl',
          });
        }
      }

      // Any source line never claimed becomes an unmatched_source exception (aging tracked from creation).
      for (const s of sourceLines) {
        if (claimedSource.has(s.id)) continue;
        const exc = await this.repo.insertException(tx, {
          tenantId: ctx.tenantId,
          runId,
          glLineId: null,
          sourceLineId: s.id,
          exceptionType: 'unmatched_source',
          ageDays: 0,
          reason: 'no GL counterpart',
          required: true,
          correlationId: ctx.correlationId,
          by: actor,
        });
        await this.repo.setSourceLineStatus(tx, {
          id: s.id,
          expectedVersion: s.version,
          toStatus: 'excepted',
          by: actor,
        });
        exceptions += 1;
        await this.emitter.recordAudit(tx, ctx, {
          code: M20_AUDIT_CODES.exceptionRaised,
          entityType: 'gl_exception',
          entityId: exc.id,
          detail: { exceptionType: 'unmatched_source' },
        });
        await this.publish(tx, ctx, actor, 'ExceptionRaised', {
          recordId: exc.id,
          recordType: 'exception',
          runId,
          exceptionType: 'unmatched_source',
        });
      }

      const reviewed = await this.repo.transitionRun(tx, {
        id: runId,
        expectedVersion: started.version,
        toStatus: 'review_required',
        by: actor,
      });
      if (reviewed === null) throw ProblemError.conflict('Run modified concurrently.', ctx.correlationId);
      const counted = await this.repo.updateRunCounts(tx, {
        id: runId,
        expectedVersion: reviewed.version,
        matchedCount: matched,
        unmatchedCount: glLines.length - matched,
        exceptionCount: exceptions,
        itemCount: 0,
        by: actor,
      });
      await this.repo.insertRunStatusHistory(tx, {
        tenantId: ctx.tenantId,
        runId,
        fromStatus: 'running',
        toStatus: 'review_required',
        reason: 'matching completed',
        reasonCode: 'review_required',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.publish(tx, ctx, actor, 'RunBalanceComputed', {
        recordId: runId,
        recordType: 'run',
        runId,
        lineCount: glLines.length,
        toStatus: 'review_required',
      });
      return counted ?? reviewed;
    });
  }

  async complete(
    ctx: RequestContext,
    actor: string | null,
    runId: string,
    expectedVersion: number,
  ): Promise<GlRunRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.runExecute);
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.requireRun(tx, runId, ctx.correlationId);
      const check = checkRunTransition(run.status, 'completed');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot complete run from ${run.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const openRequired = await this.repo.countOpenRequiredExceptions(tx, runId);
      if (openRequired > 0)
        throw ProblemError.conflict(
          `Cannot complete: ${String(openRequired)} required exception(s) still open.`,
          ctx.correlationId,
        );
      const done = await this.repo.transitionRun(tx, {
        id: runId,
        expectedVersion,
        toStatus: 'completed',
        by: actor,
      });
      if (done === null)
        throw ProblemError.conflict('Run modified concurrently (stale version).', ctx.correlationId);
      const balances = await this.repo.listRunBalancesByRun(tx, runId);
      const latest = balances[balances.length - 1];
      const varianceMinor = latest?.variance_minor ?? '0';
      const balanced = latest?.balanced ?? true;
      await this.repo.insertRunSummary(tx, {
        tenantId: ctx.tenantId,
        runId,
        matchedCount: done.matched_count,
        unmatchedCount: done.unmatched_count,
        exceptionCount: done.exception_count,
        itemCount: done.item_count,
        matchedAmountMinor: '0',
        unmatchedAmountMinor: '0',
        balanceVarianceMinor: varianceMinor,
        balanced,
        colourStatus: balanced && done.exception_count === 0 ? 'dark_green' : 'amber',
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertRunStatusHistory(tx, {
        tenantId: ctx.tenantId,
        runId,
        fromStatus: run.status,
        toStatus: 'completed',
        reason: 'run completed',
        reasonCode: 'completed',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.runCompleted,
        entityType: 'gl_recon_run',
        entityId: runId,
        detail: { matched: done.matched_count, exceptions: done.exception_count },
      });
      await this.publish(tx, ctx, actor, 'RunCompleted', {
        recordId: runId,
        recordType: 'run',
        runId,
        fromStatus: run.status,
        toStatus: 'completed',
      });
      return done;
    });
  }

  async reopen(
    ctx: RequestContext,
    actor: string | null,
    runId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<GlRunRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.runReopen);
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.requireRun(tx, runId, ctx.correlationId);
      const check = checkRunTransition(run.status, 'reopened');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot reopen run from ${run.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const reopened = await this.repo.transitionRun(tx, {
        id: runId,
        expectedVersion,
        toStatus: 'reopened',
        by: actor,
      });
      if (reopened === null)
        throw ProblemError.conflict('Run modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId,
        decisionType: 'reopen',
        matchId: null,
        glLineId: null,
        sourceLineId: null,
        exceptionId: null,
        itemId: null,
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertRunStatusHistory(tx, {
        tenantId: ctx.tenantId,
        runId,
        fromStatus: run.status,
        toStatus: 'reopened',
        reason,
        reasonCode: 'reopened',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.runReopened,
        entityType: 'gl_recon_run',
        entityId: runId,
        detail: { reasonCode: 'reopened' },
      });
      await this.publish(tx, ctx, actor, 'RunReopened', {
        recordId: runId,
        recordType: 'run',
        runId,
        fromStatus: run.status,
        toStatus: 'reopened',
        reasonCode: 'reopened',
      });
      return reopened;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getRun(ctx: RequestContext, id: string): Promise<GlRunRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) => this.requireRun(tx, id, ctx.correlationId));
  }
  async listRuns(ctx: RequestContext, input: { glAccountId?: string; status?: string }): Promise<GlRunRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listRuns(tx, {
        ...(input.glAccountId !== undefined ? { glAccountId: input.glAccountId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      }),
    );
  }
  async listCandidates(ctx: RequestContext, runId: string): Promise<GlMatchCandidateRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listMatchCandidatesByRun(tx, runId));
  }
  async listRunBalances(ctx: RequestContext, runId: string): Promise<GlRunBalanceRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRunBalancesByRun(tx, runId));
  }
  async listStatusHistory(ctx: RequestContext, runId: string): Promise<GlRunStatusHistoryRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRunStatusHistory(tx, runId));
  }
  async listSummaries(ctx: RequestContext, runId: string): Promise<GlRunSummaryRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRunSummariesByRun(tx, runId));
  }
}
