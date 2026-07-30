/**
 * ReconciliationService — the reconciliation RUN lifecycle + the deterministic matching ORCHESTRATION. A run moves
 * draft -> matching -> review -> completed (reopened) through the single choke point `checkRunTransition`. Matching
 * calls the PURE m15a engine (`bestCandidate`/`scoreCandidate`) per unmatched statement line against unmatched
 * ledger entries under the run's ruleset, records the engine's explainable evidence (recon_match_candidate,
 * append-only), auto-proposes a match for exact/strong bands (recon_match + append-only recon_match_line) and raises
 * an exception otherwise. A run CANNOT complete while a REQUIRED exception is open (fail closed). Money is INTEGER
 * MINOR UNITS — row amounts (bigint strings) are converted to safe integers for the engine, never through a float
 * (ADR-007). Every mutation runs inside `db.withTenant` with audit + a reconciliation.lifecycle event in the same tx.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { ReconciliationLifecycleEventType, ReconciliationLifecyclePayload } from '@finapp/contracts';
import { bestCandidate, type MatchableLine, type Ruleset as EngineRuleset } from '@finapp/m15a-matching';
import { M15_PERMISSIONS } from './permissions.ts';
import { M15_AUDIT_CODES } from './audit-codes.ts';
import { checkRunTransition } from './domain/lifecycles.ts';
import {
  ReconRepository,
  type RunRow,
  type MatchingRulesetRow,
  type StatementLineRow,
  type LedgerEntryRow,
  type MatchCandidateRow,
  type RunSummaryRow,
  type StatusHistoryRow,
} from './repository.ts';
import type { M15Emitter } from './emit.ts';
import { badRequest } from './errors.ts';
import { ReconError } from './domain/limits.ts';

function toMinorInt(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n))
    throw new ReconError('AMOUNT_TOO_LARGE', `amount ${v} exceeds safe integer range`);
  return n;
}
function toMatchable(row: StatementLineRow | LedgerEntryRow, date: string): MatchableLine {
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
  private readonly emitter: M15Emitter;
  private readonly repo: ReconRepository;
  constructor(db: Db, authz: Authz, emitter: M15Emitter, repo: ReconRepository = new ReconRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: ReconciliationLifecycleEventType,
    payload: ReconciliationLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }
  private async requireRun(tx: Tx, id: string, correlationId: string): Promise<RunRow> {
    const r = await this.repo.findRun(tx, id);
    if (r === null) throw ProblemError.notFound('Reconciliation run not found.', correlationId);
    return r;
  }
  private async engineRuleset(tx: Tx, ruleset: MatchingRulesetRow): Promise<EngineRuleset> {
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
      bankAccountId: string;
      rulesetId?: string | null;
      periodStart?: string | null;
      periodEnd?: string | null;
      openingBalanceMinor?: number | null;
      closingBalanceMinor?: number | null;
    },
  ): Promise<RunRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.runCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const acct = await this.repo.findBankAccount(tx, input.bankAccountId);
      if (acct === null) throw ProblemError.notFound('Bank account not found.', ctx.correlationId);
      const row = await this.repo.insertRun(tx, {
        tenantId: ctx.tenantId,
        bankAccountId: input.bankAccountId,
        rulesetId: input.rulesetId ?? null,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        openingBalanceMinor: input.openingBalanceMinor ?? null,
        closingBalanceMinor: input.closingBalanceMinor ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.runCreated,
        entityType: 'recon_run',
        entityId: row.id,
        detail: { bankAccountRef: input.bankAccountId },
      });
      await this.publish(tx, ctx, actor, 'RunCreated', {
        recordId: row.id,
        recordType: 'run',
        bankAccountRef: input.bankAccountId,
        runId: row.id,
        toStatus: row.status,
      });
      return row;
    });
  }

  /** Run deterministic matching for a run (draft/reopened -> matching -> review). Idempotent per unmatched line. */
  async runMatching(
    ctx: RequestContext,
    actor: string | null,
    runId: string,
    expectedVersion: number,
  ): Promise<RunRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.matchRun);
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.requireRun(tx, runId, ctx.correlationId);
      const toMatching = checkRunTransition(run.status, 'matching');
      if (!toMatching.ok)
        throw ProblemError.conflict(
          `Cannot start matching from ${run.status}: ${toMatching.reason ?? ''}`,
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
        toStatus: 'matching',
        by: actor,
      });
      if (started === null)
        throw ProblemError.conflict('Run modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        runId,
        fromStatus: run.status,
        toStatus: 'matching',
        reason: 'matching started',
        reasonCode: 'matching',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.runMatchingStarted,
        entityType: 'recon_run',
        entityId: runId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'RunMatchingStarted', {
        recordId: runId,
        recordType: 'run',
        runId,
        rulesetVersion: ruleset.version_number,
      });

      const engine = await this.engineRuleset(tx, ruleset);
      const statements = await this.repo.listUnmatchedStatementLines(tx, run.bank_account_id);
      const ledgers = await this.repo.listUnmatchedLedgerEntries(tx, run.bank_account_id);
      const ledgerMatchables = ledgers.map((l) => toMatchable(l, l.entry_date));
      const claimedLedger = new Set<string>();
      let matched = 0;
      let exceptions = 0;

      for (const s of statements) {
        const sM = toMatchable(s, s.txn_date);
        const pool = ledgerMatchables.filter((l) => !claimedLedger.has(l.id));
        const candidate = pool.length > 0 ? bestCandidate(sM, pool, engine) : null;
        // Append-only engine evidence (explainable), regardless of outcome.
        if (candidate !== null) {
          await this.repo.insertMatchCandidate(tx, {
            tenantId: ctx.tenantId,
            runId,
            statementLineId: s.id,
            ledgerEntryId: candidate.ledgerEntryId,
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
          claimedLedger.add(candidate.ledgerEntryId);
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
            idempotencyKey: `run:${runId}:stmt:${s.id}`,
            correlationId: ctx.correlationId,
            by: actor,
          });
          await this.repo.insertMatchLine(tx, {
            tenantId: ctx.tenantId,
            matchId: match.id,
            side: 'statement',
            statementLineId: s.id,
            ledgerEntryId: null,
            amountMinor: toMinorInt(s.amount_minor),
            correlationId: ctx.correlationId,
            by: actor,
          });
          await this.repo.insertMatchLine(tx, {
            tenantId: ctx.tenantId,
            matchId: match.id,
            side: 'ledger',
            statementLineId: null,
            ledgerEntryId: candidate.ledgerEntryId,
            amountMinor:
              candidate.amountVarianceMinor >= 0 ? toMinorInt(s.amount_minor) : toMinorInt(s.amount_minor),
            correlationId: ctx.correlationId,
            by: actor,
          });
          await this.repo.setStatementLineStatus(tx, {
            id: s.id,
            expectedVersion: s.version,
            toStatus: 'matched',
            by: actor,
          });
          const led = ledgers.find((l) => l.id === candidate.ledgerEntryId);
          if (led !== undefined)
            await this.repo.setLedgerEntryStatus(tx, {
              id: led.id,
              expectedVersion: led.version,
              toStatus: 'matched',
              by: actor,
            });
          await this.emitter.recordAudit(tx, ctx, {
            code: M15_AUDIT_CODES.matchProposed,
            entityType: 'recon_match',
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
            statementLineId: s.id,
            ledgerEntryId: null,
            exceptionType: 'unmatched_statement',
            ageDays: 0,
            reason: candidate === null ? 'no candidate' : `best band ${candidate.confidenceBand}`,
            required: true,
            correlationId: ctx.correlationId,
            by: actor,
          });
          await this.repo.setStatementLineStatus(tx, {
            id: s.id,
            expectedVersion: s.version,
            toStatus: 'excepted',
            by: actor,
          });
          await this.emitter.recordAudit(tx, ctx, {
            code: M15_AUDIT_CODES.exceptionRaised,
            entityType: 'recon_exception',
            entityId: exc.id,
            detail: { exceptionType: 'unmatched_statement' },
          });
          await this.publish(tx, ctx, actor, 'ExceptionRaised', {
            recordId: exc.id,
            recordType: 'exception',
            runId,
            exceptionType: 'unmatched_statement',
          });
          exceptions += 1;
        }
      }
      const reviewed = await this.repo.transitionRun(tx, {
        id: runId,
        expectedVersion: started.version,
        toStatus: 'review',
        by: actor,
      });
      if (reviewed === null) throw ProblemError.conflict('Run modified concurrently.', ctx.correlationId);
      const counted = await this.repo.updateRunCounts(tx, {
        id: runId,
        expectedVersion: reviewed.version,
        matchedCount: matched,
        unmatchedCount: statements.length - matched,
        exceptionCount: exceptions,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        runId,
        fromStatus: 'matching',
        toStatus: 'review',
        reason: 'matching completed',
        reasonCode: 'review',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.runMatchingCompleted,
        entityType: 'recon_run',
        entityId: runId,
        detail: { matched, exceptions },
      });
      await this.publish(tx, ctx, actor, 'RunMatchingCompleted', {
        recordId: runId,
        recordType: 'run',
        runId,
        lineCount: statements.length,
      });
      await this.publish(tx, ctx, actor, 'RunReviewStarted', {
        recordId: runId,
        recordType: 'run',
        runId,
        toStatus: 'review',
      });
      return counted ?? reviewed;
    });
  }

  async complete(
    ctx: RequestContext,
    actor: string | null,
    runId: string,
    expectedVersion: number,
  ): Promise<RunRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.runComplete);
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
      const amts = await this.repo.computeRunSummaryAmounts(tx, runId);
      await this.repo.insertRunSummary(tx, {
        tenantId: ctx.tenantId,
        runId,
        matchedCount: done.matched_count,
        unmatchedCount: done.unmatched_count,
        exceptionCount: done.exception_count,
        matchedAmountMinor: amts.matchedMinor,
        unmatchedAmountMinor: amts.unmatchedMinor,
        colourStatus: done.unmatched_count === 0 && done.exception_count === 0 ? 'dark_green' : 'amber',
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertStatusHistory(tx, {
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
        code: M15_AUDIT_CODES.runCompleted,
        entityType: 'recon_run',
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
  ): Promise<RunRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.runReopen);
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
        statementLineId: null,
        ledgerEntryId: null,
        exceptionId: null,
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertStatusHistory(tx, {
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
        code: M15_AUDIT_CODES.runReopened,
        entityType: 'recon_run',
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
  async getRun(ctx: RequestContext, id: string): Promise<RunRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) => this.requireRun(tx, id, ctx.correlationId));
  }
  async listRuns(ctx: RequestContext, input: { bankAccountId?: string; status?: string }): Promise<RunRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listRuns(tx, {
        ...(input.bankAccountId !== undefined ? { bankAccountId: input.bankAccountId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      }),
    );
  }
  async listCandidates(ctx: RequestContext, runId: string): Promise<MatchCandidateRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.matchRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listMatchCandidatesByRun(tx, runId));
  }
  async listStatusHistory(ctx: RequestContext, runId: string): Promise<StatusHistoryRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listStatusHistory(tx, runId));
  }
  async listSummaries(ctx: RequestContext, runId: string): Promise<RunSummaryRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRunSummariesByRun(tx, runId));
  }
}
