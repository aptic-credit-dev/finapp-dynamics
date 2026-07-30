/**
 * MatchService — confirm/reject proposed matches, manual match/unmatch, split/grouped matching, exception
 * resolution, and notes. Manual review/override is APPEND-ONLY evidence (recon_manual_decision) that NEVER
 * overwrites the engine's recon_match_candidate evidence. Split/grouped matches must BALANCE exactly (integer
 * minor-unit sums equal — no float; ADR-007/083). Unmatch, manual match/group and exception waive are privileged.
 * Every mutation runs inside `db.withTenant` with audit + a reconciliation.lifecycle event in the same tx; lifecycle
 * transitions go through `checkMatchTransition`/`checkExceptionTransition`.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { ReconciliationLifecycleEventType, ReconciliationLifecyclePayload } from '@finapp/contracts';
import { balances, classifyMatchType, sumMinor } from '@finapp/m15a-matching';
import { M15_PERMISSIONS } from './permissions.ts';
import { M15_AUDIT_CODES } from './audit-codes.ts';
import { checkMatchTransition, checkExceptionTransition } from './domain/lifecycles.ts';
import { isNoteType, ReconError } from './domain/limits.ts';
import {
  ReconRepository,
  type MatchRow,
  type MatchLineRow,
  type ExceptionRow,
  type ManualDecisionRow,
  type NoteRow,
} from './repository.ts';
import type { M15Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

function toMinorInt(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n))
    throw new ReconError('AMOUNT_TOO_LARGE', `amount ${v} exceeds safe integer range`);
  return n;
}

export class MatchService {
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
  private async requireMatch(tx: Tx, id: string, correlationId: string): Promise<MatchRow> {
    const m = await this.repo.findMatch(tx, id);
    if (m === null) throw ProblemError.notFound('Match not found.', correlationId);
    return m;
  }

  async confirm(
    ctx: RequestContext,
    actor: string | null,
    matchId: string,
    expectedVersion: number,
  ): Promise<MatchRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.matchConfirm);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.requireMatch(tx, matchId, ctx.correlationId);
      const check = checkMatchTransition(m.status, 'confirmed');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot confirm match from ${m.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.transitionMatch(tx, {
        id: matchId,
        expectedVersion,
        toStatus: 'confirmed',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Match modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.matchConfirmed,
        entityType: 'recon_match',
        entityId: matchId,
        detail: { matchType: m.match_type },
      });
      await this.publish(tx, ctx, actor, 'MatchConfirmed', {
        recordId: matchId,
        recordType: 'match',
        runId: m.run_id,
        matchType: m.match_type,
        fromStatus: m.status,
        toStatus: 'confirmed',
      });
      return upd;
    });
  }

  async reject(
    ctx: RequestContext,
    actor: string | null,
    matchId: string,
    expectedVersion: number,
    reason?: string | null,
  ): Promise<MatchRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.matchReject);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.requireMatch(tx, matchId, ctx.correlationId);
      const check = checkMatchTransition(m.status, 'rejected');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot reject match from ${m.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.transitionMatch(tx, {
        id: matchId,
        expectedVersion,
        toStatus: 'rejected',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Match modified concurrently (stale version).', ctx.correlationId);
      await this.revertLines(tx, matchId, actor);
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.matchRejected,
        entityType: 'recon_match',
        entityId: matchId,
        detail: { reasonCode: reason ?? undefined },
      });
      await this.publish(tx, ctx, actor, 'MatchRejected', {
        recordId: matchId,
        recordType: 'match',
        runId: m.run_id,
        fromStatus: m.status,
        toStatus: 'rejected',
      });
      return upd;
    });
  }

  async unmatch(
    ctx: RequestContext,
    actor: string | null,
    matchId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<MatchRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.matchUnmatch);
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.requireMatch(tx, matchId, ctx.correlationId);
      const check = checkMatchTransition(m.status, 'unmatched');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot unmatch a ${m.status} match: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.transitionMatch(tx, {
        id: matchId,
        expectedVersion,
        toStatus: 'unmatched',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Match modified concurrently (stale version).', ctx.correlationId);
      await this.revertLines(tx, matchId, actor);
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: m.run_id,
        decisionType: 'unmatch',
        matchId,
        statementLineId: null,
        ledgerEntryId: null,
        exceptionId: null,
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.matchUnmatched,
        entityType: 'recon_match',
        entityId: matchId,
        detail: { reasonCode: 'unmatch' },
      });
      await this.publish(tx, ctx, actor, 'MatchUnmatched', {
        recordId: matchId,
        recordType: 'match',
        runId: m.run_id,
        fromStatus: m.status,
        toStatus: 'unmatched',
      });
      return upd;
    });
  }

  /** Revert the statement/ledger lines of a match back to unmatched (best-effort; append-only match lines remain). */
  private async revertLines(tx: Tx, matchId: string, actor: string | null): Promise<void> {
    const lines = await this.repo.listMatchLinesByMatch(tx, matchId);
    for (const l of lines) {
      if (l.side === 'statement' && l.statement_line_id !== null) {
        const s = await this.repo.findStatementLine(tx, l.statement_line_id);
        if (s !== null)
          await this.repo.setStatementLineStatus(tx, {
            id: s.id,
            expectedVersion: s.version,
            toStatus: 'unmatched',
            by: actor,
          });
      } else if (l.side === 'ledger' && l.ledger_entry_id !== null) {
        const e = await this.repo.findLedgerEntry(tx, l.ledger_entry_id);
        if (e !== null)
          await this.repo.setLedgerEntryStatus(tx, {
            id: e.id,
            expectedVersion: e.version,
            toStatus: 'unmatched',
            by: actor,
          });
      }
    }
  }

  /**
   * A manual/split/grouped match. Privileged. The two sides must BALANCE exactly in minor units (integer). Records
   * append-only manual-decision evidence; the match is `matched_by='manual'`, status 'confirmed'.
   */
  async manualMatch(
    ctx: RequestContext,
    actor: string | null,
    input: {
      runId: string;
      statementLineIds: readonly string[];
      ledgerEntryIds: readonly string[];
      reason?: string | null;
    },
  ): Promise<MatchRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.manualMatch);
    if (input.statementLineIds.length < 1 || input.ledgerEntryIds.length < 1)
      throw badRequest(
        'a manual match needs at least one statement line and one ledger entry',
        ctx.correlationId,
      );
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.repo.findRun(tx, input.runId);
      if (run === null) throw ProblemError.notFound('Reconciliation run not found.', ctx.correlationId);
      const stmts = [];
      for (const id of input.statementLineIds) {
        const s = await this.repo.findStatementLine(tx, id);
        if (s === null) throw ProblemError.notFound(`Statement line ${id} not found.`, ctx.correlationId);
        stmts.push(s);
      }
      const ledgers = [];
      for (const id of input.ledgerEntryIds) {
        const e = await this.repo.findLedgerEntry(tx, id);
        if (e === null) throw ProblemError.notFound(`Ledger entry ${id} not found.`, ctx.correlationId);
        ledgers.push(e);
      }
      const stmtAmts = stmts.map((s) => toMinorInt(s.amount_minor));
      const ledgerAmts = ledgers.map((e) => toMinorInt(e.amount_minor));
      if (!balances(stmtAmts, ledgerAmts))
        throw ProblemError.conflict('A manual match must balance exactly in minor units.', ctx.correlationId);
      const matchType = classifyMatchType(stmts.length, ledgers.length);
      const isSplit = stmts.length === 1 && ledgers.length > 1;
      const isGrouped = stmts.length > 1;
      const finalType = isSplit ? 'split' : isGrouped ? 'grouped' : matchType;
      const match = await this.repo.insertMatch(tx, {
        tenantId: ctx.tenantId,
        runId: input.runId,
        matchType: finalType,
        status: 'confirmed',
        confidenceBand: null,
        colourStatus: null,
        score: null,
        amountVarianceMinor: Math.abs(sumMinor(stmtAmts) - sumMinor(ledgerAmts)),
        matchedBy: 'manual',
        rulesetId: null,
        rulesetVersion: null,
        idempotencyKey: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      for (const s of stmts) {
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
        await this.repo.setStatementLineStatus(tx, {
          id: s.id,
          expectedVersion: s.version,
          toStatus: 'matched',
          by: actor,
        });
      }
      for (const e of ledgers) {
        await this.repo.insertMatchLine(tx, {
          tenantId: ctx.tenantId,
          matchId: match.id,
          side: 'ledger',
          statementLineId: null,
          ledgerEntryId: e.id,
          amountMinor: toMinorInt(e.amount_minor),
          correlationId: ctx.correlationId,
          by: actor,
        });
        await this.repo.setLedgerEntryStatus(tx, {
          id: e.id,
          expectedVersion: e.version,
          toStatus: 'matched',
          by: actor,
        });
      }
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: input.runId,
        decisionType: isSplit ? 'split' : isGrouped ? 'group' : 'manual_match',
        matchId: match.id,
        statementLineId: stmts[0]?.id ?? null,
        ledgerEntryId: ledgers[0]?.id ?? null,
        exceptionId: null,
        reason: input.reason ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.manualDecisionRecorded,
        entityType: 'recon_manual_decision',
        entityId: match.id,
        detail: { matchType: finalType },
      });
      if (isSplit)
        await this.emitter.recordAudit(tx, ctx, {
          code: M15_AUDIT_CODES.splitMatchCreated,
          entityType: 'recon_match',
          entityId: match.id,
          detail: {},
        });
      if (isGrouped)
        await this.emitter.recordAudit(tx, ctx, {
          code: M15_AUDIT_CODES.groupedMatchCreated,
          entityType: 'recon_match',
          entityId: match.id,
          detail: {},
        });
      await this.publish(tx, ctx, actor, 'ManualDecisionRecorded', {
        recordId: match.id,
        recordType: 'match',
        runId: input.runId,
        matchType: finalType,
        matchedBy: 'manual',
      });
      if (isSplit)
        await this.publish(tx, ctx, actor, 'SplitMatchCreated', {
          recordId: match.id,
          recordType: 'match',
          runId: input.runId,
          matchType: 'split',
        });
      if (isGrouped)
        await this.publish(tx, ctx, actor, 'GroupedMatchCreated', {
          recordId: match.id,
          recordType: 'match',
          runId: input.runId,
          matchType: 'grouped',
        });
      return match;
    });
  }

  // --- exceptions -------------------------------------------------------------------------------
  async resolveException(
    ctx: RequestContext,
    actor: string | null,
    exceptionId: string,
    expectedVersion: number,
    reason?: string | null,
  ): Promise<ExceptionRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.exceptionResolve);
    return this.db.withTenant(ctx, async (tx) => {
      const e = await this.repo.findException(tx, exceptionId);
      if (e === null) throw ProblemError.notFound('Exception not found.', ctx.correlationId);
      const check = checkExceptionTransition(e.status, 'resolved');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot resolve a ${e.status} exception: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.transitionException(tx, {
        id: exceptionId,
        expectedVersion,
        toStatus: 'resolved',
        resolvedBy: actor,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Exception modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.exceptionResolved,
        entityType: 'recon_exception',
        entityId: exceptionId,
        detail: { exceptionType: e.exception_type, ...(reason != null ? { reasonCode: reason } : {}) },
      });
      await this.publish(tx, ctx, actor, 'ExceptionResolved', {
        recordId: exceptionId,
        recordType: 'exception',
        runId: e.run_id,
        exceptionType: e.exception_type,
        toStatus: 'resolved',
      });
      return upd;
    });
  }

  async waiveException(
    ctx: RequestContext,
    actor: string | null,
    exceptionId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<ExceptionRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.exceptionWaive);
    return this.db.withTenant(ctx, async (tx) => {
      const e = await this.repo.findException(tx, exceptionId);
      if (e === null) throw ProblemError.notFound('Exception not found.', ctx.correlationId);
      const check = checkExceptionTransition(e.status, 'waived');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot waive a ${e.status} exception: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.transitionException(tx, {
        id: exceptionId,
        expectedVersion,
        toStatus: 'waived',
        resolvedBy: actor,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Exception modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: e.run_id,
        decisionType: 'waive',
        matchId: null,
        statementLineId: null,
        ledgerEntryId: null,
        exceptionId,
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.exceptionWaived,
        entityType: 'recon_exception',
        entityId: exceptionId,
        detail: { reasonCode: 'waived' },
      });
      await this.publish(tx, ctx, actor, 'ExceptionWaived', {
        recordId: exceptionId,
        recordType: 'exception',
        runId: e.run_id,
        exceptionType: e.exception_type,
        toStatus: 'waived',
      });
      return upd;
    });
  }

  async addNote(
    ctx: RequestContext,
    actor: string | null,
    runId: string,
    input: { noteType?: string; content: string },
  ): Promise<NoteRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.runReview);
    const noteType = input.noteType ?? 'general';
    if (!isNoteType(noteType)) throw badRequest('invalid note type', ctx.correlationId);
    if (input.content.trim() === '') throw badRequest('note content is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.repo.findRun(tx, runId);
      if (run === null) throw ProblemError.notFound('Reconciliation run not found.', ctx.correlationId);
      const row = await this.repo.insertNote(tx, {
        tenantId: ctx.tenantId,
        runId,
        noteType,
        content: input.content,
        by: actor,
        correlationId: ctx.correlationId,
      });
      // Audit the FACT a note was added (run + type) — the note content never enters the audit payload.
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.noteAdded,
        entityType: 'recon_note',
        entityId: row.id,
        detail: { runId, noteType },
      });
      return row;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async listMatches(ctx: RequestContext, input: { runId: string; status?: string }): Promise<MatchRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.matchRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listMatchesByRun(tx, {
        runId: input.runId,
        ...(input.status !== undefined ? { status: input.status } : {}),
      }),
    );
  }
  async listMatchLines(ctx: RequestContext, matchId: string): Promise<MatchLineRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.matchRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listMatchLinesByMatch(tx, matchId));
  }
  async listExceptions(
    ctx: RequestContext,
    input: { runId: string; status?: string },
  ): Promise<ExceptionRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.exceptionRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listExceptionsByRun(tx, {
        runId: input.runId,
        ...(input.status !== undefined ? { status: input.status } : {}),
      }),
    );
  }
  async listManualDecisions(ctx: RequestContext, runId: string): Promise<ManualDecisionRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listManualDecisionsByRun(tx, runId));
  }
  async listNotes(ctx: RequestContext, runId: string): Promise<NoteRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.runRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listNotesByRun(tx, runId));
  }
}
