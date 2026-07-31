/**
 * MatchService — match review (confirm/reject/unmatch), manual + grouped matches (privileged; append-only decision
 * evidence that NEVER overwrites the engine's candidate evidence; grouped/split must balance EXACTLY in minor units),
 * exception management (assign → resolve/waive; aging), reconciling items (raise/clear), and notes. Every mutation
 * runs inside `db.withTenant` with audit + a glrecon.lifecycle event in the same transaction. Money is INTEGER MINOR
 * UNITS — never float (ADR-007). m20 never posts a journal or approves anything.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { GlreconLifecycleEventType, GlreconLifecyclePayload } from '@finapp/contracts';
import { balances, classifyMatchType } from './engine.ts';
import { M20_PERMISSIONS } from './permissions.ts';
import { M20_AUDIT_CODES } from './audit-codes.ts';
import { checkMatchTransition, checkExceptionTransition, checkItemTransition } from './domain/lifecycles.ts';
import { isItemType } from './domain/limits.ts';
import { badRequest } from './errors.ts';
import {
  GlreconRepository,
  type GlMatchRow,
  type GlMatchLineRow,
  type GlExceptionRow,
  type GlReconcilingItemRow,
  type GlManualDecisionRow,
  type GlNoteRow,
} from './repository.ts';
import type { M20Emitter } from './emit.ts';

export class MatchService {
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
  private async requireMatch(tx: Tx, id: string, correlationId: string): Promise<GlMatchRow> {
    const m = await this.repo.findMatch(tx, id);
    if (m === null) throw ProblemError.notFound('Match not found.', correlationId);
    return m;
  }

  // --- match review -----------------------------------------------------------------------------
  async confirmMatch(
    ctx: RequestContext,
    actor: string | null,
    matchId: string,
    expectedVersion: number,
  ): Promise<GlMatchRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchReview);
    return this.db.withTenant(ctx, async (tx) => {
      const match = await this.requireMatch(tx, matchId, ctx.correlationId);
      const check = checkMatchTransition(match.status, 'confirmed');
      if (!check.ok) throw ProblemError.conflict(`Cannot confirm from ${match.status}.`, ctx.correlationId);
      const updated = await this.repo.transitionMatch(tx, {
        id: matchId,
        expectedVersion,
        toStatus: 'confirmed',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Match modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.matchConfirmed,
        entityType: 'gl_match',
        entityId: matchId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'MatchConfirmed', {
        recordId: matchId,
        recordType: 'match',
        runId: match.run_id,
        toStatus: 'confirmed',
      });
      return updated;
    });
  }

  async rejectMatch(
    ctx: RequestContext,
    actor: string | null,
    matchId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<GlMatchRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchReview);
    return this.db.withTenant(ctx, async (tx) => {
      const match = await this.requireMatch(tx, matchId, ctx.correlationId);
      const check = checkMatchTransition(match.status, 'rejected');
      if (!check.ok) throw ProblemError.conflict(`Cannot reject from ${match.status}.`, ctx.correlationId);
      const updated = await this.repo.transitionMatch(tx, {
        id: matchId,
        expectedVersion,
        toStatus: 'rejected',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Match modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: match.run_id,
        decisionType: 'unmatch',
        matchId,
        glLineId: null,
        sourceLineId: null,
        exceptionId: null,
        itemId: null,
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.matchRejected,
        entityType: 'gl_match',
        entityId: matchId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'MatchRejected', {
        recordId: matchId,
        recordType: 'match',
        runId: match.run_id,
        toStatus: 'rejected',
      });
      return updated;
    });
  }

  async unmatch(
    ctx: RequestContext,
    actor: string | null,
    matchId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<GlMatchRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchUnmatch);
    return this.db.withTenant(ctx, async (tx) => {
      const match = await this.requireMatch(tx, matchId, ctx.correlationId);
      const check = checkMatchTransition(match.status, 'unmatched');
      if (!check.ok) throw ProblemError.conflict(`Cannot unmatch from ${match.status}.`, ctx.correlationId);
      const updated = await this.repo.transitionMatch(tx, {
        id: matchId,
        expectedVersion,
        toStatus: 'unmatched',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Match modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: match.run_id,
        decisionType: 'unmatch',
        matchId,
        glLineId: null,
        sourceLineId: null,
        exceptionId: null,
        itemId: null,
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.matchUnmatched,
        entityType: 'gl_match',
        entityId: matchId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'MatchUnmatched', {
        recordId: matchId,
        recordType: 'match',
        runId: match.run_id,
        toStatus: 'unmatched',
      });
      return updated;
    });
  }

  /** Manual / grouped match — privileged. Grouped/split members must BALANCE EXACTLY in minor units (fail closed). */
  async manualMatch(
    ctx: RequestContext,
    actor: string | null,
    input: {
      runId: string;
      glLineIds: readonly string[];
      sourceLineIds: readonly string[];
      reason: string;
    },
  ): Promise<GlMatchRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchManual);
    if (input.glLineIds.length === 0 || input.sourceLineIds.length === 0)
      throw badRequest('A manual match needs at least one GL line and one source line.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.repo.findRun(tx, input.runId);
      if (run === null) throw ProblemError.notFound('Run not found.', ctx.correlationId);

      const glLines = [];
      for (const id of input.glLineIds) {
        const l = await this.repo.findLine(tx, id);
        if (l === null) throw badRequest(`GL line ${id} not found.`, ctx.correlationId);
        glLines.push(l);
      }
      const sourceLines = [];
      for (const id of input.sourceLineIds) {
        const l = await this.repo.findSourceLine(tx, id);
        if (l === null) throw badRequest(`Source line ${id} not found.`, ctx.correlationId);
        sourceLines.push(l);
      }
      const glAmounts = glLines.map((l) => Number(l.amount_minor));
      const sourceAmounts = sourceLines.map((l) => Number(l.amount_minor));
      if (!balances(glAmounts, sourceAmounts))
        throw badRequest('A grouped/split match must balance exactly in minor units.', ctx.correlationId);

      const matchType = classifyMatchType(glLines.length, sourceLines.length);
      const grouped = glLines.length > 1 || sourceLines.length > 1;
      const match = await this.repo.insertMatch(tx, {
        tenantId: ctx.tenantId,
        runId: input.runId,
        matchType,
        status: 'confirmed',
        confidenceBand: null,
        colourStatus: null,
        score: null,
        amountVarianceMinor: 0,
        matchedBy: 'manual',
        rulesetId: null,
        rulesetVersion: null,
        idempotencyKey: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      for (const l of glLines) {
        await this.repo.insertMatchLine(tx, {
          tenantId: ctx.tenantId,
          matchId: match.id,
          side: 'gl',
          glLineId: l.id,
          sourceLineId: null,
          amountMinor: Number(l.amount_minor),
          correlationId: ctx.correlationId,
          by: actor,
        });
        await this.repo.setLineStatus(tx, {
          id: l.id,
          expectedVersion: l.version,
          toStatus: 'matched',
          by: actor,
        });
      }
      for (const l of sourceLines) {
        await this.repo.insertMatchLine(tx, {
          tenantId: ctx.tenantId,
          matchId: match.id,
          side: 'source',
          glLineId: null,
          sourceLineId: l.id,
          amountMinor: Number(l.amount_minor),
          correlationId: ctx.correlationId,
          by: actor,
        });
        await this.repo.setSourceLineStatus(tx, {
          id: l.id,
          expectedVersion: l.version,
          toStatus: 'matched',
          by: actor,
        });
      }
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: input.runId,
        decisionType: grouped ? 'group' : 'manual_match',
        matchId: match.id,
        glLineId: null,
        sourceLineId: null,
        exceptionId: null,
        itemId: null,
        reason: input.reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: grouped ? M20_AUDIT_CODES.groupedMatchCreated : M20_AUDIT_CODES.matchProposed,
        entityType: 'gl_match',
        entityId: match.id,
        detail: { matchType },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.manualDecisionRecorded,
        entityType: 'gl_manual_decision',
        entityId: match.id,
        detail: { decisionType: grouped ? 'group' : 'manual_match' },
      });
      await this.publish(tx, ctx, actor, grouped ? 'GroupedMatchCreated' : 'MatchConfirmed', {
        recordId: match.id,
        recordType: 'match',
        runId: input.runId,
        matchType,
        matchedBy: 'manual',
      });
      return match;
    });
  }

  // --- exceptions -------------------------------------------------------------------------------
  async assignException(
    ctx: RequestContext,
    actor: string | null,
    exceptionId: string,
    expectedVersion: number,
    assignee: string,
  ): Promise<GlExceptionRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.exceptionAssign);
    return this.db.withTenant(ctx, async (tx) => {
      const exc = await this.repo.findException(tx, exceptionId);
      if (exc === null) throw ProblemError.notFound('Exception not found.', ctx.correlationId);
      const updated = await this.repo.assignException(tx, {
        id: exceptionId,
        expectedVersion,
        assignedTo: assignee,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Exception modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: exc.run_id,
        decisionType: 'assign',
        matchId: null,
        glLineId: null,
        sourceLineId: null,
        exceptionId,
        itemId: null,
        reason: `assigned to ${assignee}`,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.exceptionAssigned,
        entityType: 'gl_exception',
        entityId: exceptionId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ManualDecisionRecorded', {
        recordId: exceptionId,
        recordType: 'exception',
        runId: exc.run_id,
        reasonCode: 'assign',
      });
      return updated;
    });
  }

  async resolveException(
    ctx: RequestContext,
    actor: string | null,
    exceptionId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<GlExceptionRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.exceptionResolve);
    return this.db.withTenant(ctx, async (tx) => {
      const exc = await this.repo.findException(tx, exceptionId);
      if (exc === null) throw ProblemError.notFound('Exception not found.', ctx.correlationId);
      const check = checkExceptionTransition(exc.status, 'resolved');
      if (!check.ok) throw ProblemError.conflict(`Cannot resolve from ${exc.status}.`, ctx.correlationId);
      const updated = await this.repo.transitionException(tx, {
        id: exceptionId,
        expectedVersion,
        toStatus: 'resolved',
        resolvedBy: actor,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Exception modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: exc.run_id,
        decisionType: 'tick',
        matchId: null,
        glLineId: null,
        sourceLineId: null,
        exceptionId,
        itemId: null,
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.exceptionResolved,
        entityType: 'gl_exception',
        entityId: exceptionId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ExceptionResolved', {
        recordId: exceptionId,
        recordType: 'exception',
        runId: exc.run_id,
        exceptionType: exc.exception_type,
        toStatus: 'resolved',
      });
      return updated;
    });
  }

  async waiveException(
    ctx: RequestContext,
    actor: string | null,
    exceptionId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<GlExceptionRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.exceptionWaive);
    return this.db.withTenant(ctx, async (tx) => {
      const exc = await this.repo.findException(tx, exceptionId);
      if (exc === null) throw ProblemError.notFound('Exception not found.', ctx.correlationId);
      const check = checkExceptionTransition(exc.status, 'waived');
      if (!check.ok) throw ProblemError.conflict(`Cannot waive from ${exc.status}.`, ctx.correlationId);
      const updated = await this.repo.transitionException(tx, {
        id: exceptionId,
        expectedVersion,
        toStatus: 'waived',
        resolvedBy: actor,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Exception modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: exc.run_id,
        decisionType: 'waive',
        matchId: null,
        glLineId: null,
        sourceLineId: null,
        exceptionId,
        itemId: null,
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.exceptionWaived,
        entityType: 'gl_exception',
        entityId: exceptionId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ExceptionWaived', {
        recordId: exceptionId,
        recordType: 'exception',
        runId: exc.run_id,
        exceptionType: exc.exception_type,
        toStatus: 'waived',
      });
      return updated;
    });
  }

  // --- reconciling items ------------------------------------------------------------------------
  async raiseReconcilingItem(
    ctx: RequestContext,
    actor: string | null,
    input: {
      runId: string;
      itemType: string;
      amountMinor: number;
      direction?: string | null;
      glLineId?: string | null;
      sourceLineId?: string | null;
      reason?: string | null;
    },
  ): Promise<GlReconcilingItemRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.itemManage);
    if (!isItemType(input.itemType))
      throw badRequest(`Unknown reconciling-item type "${input.itemType}".`, ctx.correlationId);
    if (!Number.isInteger(input.amountMinor))
      throw badRequest('amountMinor must be an integer in minor units (no float money).', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.repo.findRun(tx, input.runId);
      if (run === null) throw ProblemError.notFound('Run not found.', ctx.correlationId);
      const item = await this.repo.insertReconcilingItem(tx, {
        tenantId: ctx.tenantId,
        runId: input.runId,
        itemType: input.itemType,
        glLineId: input.glLineId ?? null,
        sourceLineId: input.sourceLineId ?? null,
        amountMinor: input.amountMinor,
        direction: input.direction ?? null,
        ageDays: 0,
        reason: input.reason ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.reconcilingItemRaised,
        entityType: 'gl_reconciling_item',
        entityId: item.id,
        detail: { itemType: input.itemType },
      });
      await this.publish(tx, ctx, actor, 'ReconcilingItemRaised', {
        recordId: item.id,
        recordType: 'reconciling_item',
        runId: input.runId,
        itemType: input.itemType,
      });
      return item;
    });
  }

  async clearReconcilingItem(
    ctx: RequestContext,
    actor: string | null,
    itemId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<GlReconcilingItemRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.itemManage);
    return this.db.withTenant(ctx, async (tx) => {
      const item = await this.repo.findReconcilingItem(tx, itemId);
      if (item === null) throw ProblemError.notFound('Reconciling item not found.', ctx.correlationId);
      const check = checkItemTransition(item.status, 'cleared');
      if (!check.ok) throw ProblemError.conflict(`Cannot clear from ${item.status}.`, ctx.correlationId);
      const updated = await this.repo.transitionReconcilingItem(tx, {
        id: itemId,
        expectedVersion,
        toStatus: 'cleared',
        clearedBy: actor,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict(
          'Reconciling item modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.repo.insertManualDecision(tx, {
        tenantId: ctx.tenantId,
        runId: item.run_id,
        decisionType: 'clear_item',
        matchId: null,
        glLineId: null,
        sourceLineId: null,
        exceptionId: null,
        itemId,
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.reconcilingItemCleared,
        entityType: 'gl_reconciling_item',
        entityId: itemId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ReconcilingItemCleared', {
        recordId: itemId,
        recordType: 'reconciling_item',
        runId: item.run_id,
        toStatus: 'cleared',
      });
      return updated;
    });
  }

  // --- notes ------------------------------------------------------------------------------------
  async addNote(
    ctx: RequestContext,
    actor: string | null,
    runId: string,
    input: { noteType?: string; content: string },
  ): Promise<GlNoteRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchReview);
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.repo.findRun(tx, runId);
      if (run === null) throw ProblemError.notFound('Run not found.', ctx.correlationId);
      const note = await this.repo.insertNote(tx, {
        tenantId: ctx.tenantId,
        runId,
        noteType: input.noteType ?? 'general',
        content: input.content,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.noteAdded,
        entityType: 'gl_note',
        entityId: note.id,
        detail: {},
      });
      return note;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async listMatches(ctx: RequestContext, runId: string, status?: string): Promise<GlMatchRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listMatchesByRun(tx, { runId, ...(status !== undefined ? { status } : {}) }),
    );
  }
  async getMatch(ctx: RequestContext, id: string): Promise<GlMatchRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchRead);
    return this.db.withTenant(ctx, (tx) => this.requireMatch(tx, id, ctx.correlationId));
  }
  async listMatchLines(ctx: RequestContext, matchId: string): Promise<GlMatchLineRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listMatchLinesByMatch(tx, matchId));
  }
  async listExceptions(ctx: RequestContext, runId: string, status?: string): Promise<GlExceptionRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.exceptionRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listExceptionsByRun(tx, { runId, ...(status !== undefined ? { status } : {}) }),
    );
  }
  async getException(ctx: RequestContext, id: string): Promise<GlExceptionRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.exceptionRead);
    return this.db.withTenant(ctx, async (tx) => {
      const exc = await this.repo.findException(tx, id);
      if (exc === null) throw ProblemError.notFound('Exception not found.', ctx.correlationId);
      return exc;
    });
  }
  async listReconcilingItems(
    ctx: RequestContext,
    runId: string,
    status?: string,
  ): Promise<GlReconcilingItemRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.itemRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listReconcilingItemsByRun(tx, { runId, ...(status !== undefined ? { status } : {}) }),
    );
  }
  async listManualDecisions(ctx: RequestContext, runId: string): Promise<GlManualDecisionRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listManualDecisionsByRun(tx, runId));
  }
  async listNotes(ctx: RequestContext, runId: string): Promise<GlNoteRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.matchRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listNotesByRun(tx, runId));
  }
}
