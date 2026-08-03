/**
 * DraftService — create + edit BALANCED, decimal-safe DRAFT journals and manage their lifecycle up to submit-for-
 * approval and withdrawal. Lines are debit/credit in INTEGER MINOR UNITS (> 0; no float — ADR-007); the draft totals
 * and `is_balanced` are recomputed from the ACTIVE lines after every change (a removed line drops out; no DELETE).
 * A draft is editable only in 'draft' — editing a 'validated' draft first reverts it to 'draft' (it must be
 * re-validated). Submission is the handoff to m22 approval; m21 NEVER approves or posts. Every mutation is
 * permission-gated (default deny), optimistic-concurrency guarded, audited (m03) and event-emitting (journal.lifecycle
 * on the ONE m06 outbox), atomically.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M21_PERMISSIONS } from './permissions.ts';
import { M21_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isDirection, isNoteType, isPeriodStatus, isSourceType } from './domain/limits.ts';
import { checkDraftTransition, isDraftEditable } from './domain/lifecycles.ts';
import { computeBalance } from './engine.ts';
import {
  JournalRepository,
  type JournalDraftRow,
  type JournalLineRow,
  type JournalNoteRow,
  type JournalStatusHistoryRow,
} from './repository.ts';
import type { M21Emitter } from './emit.ts';

interface LineInput {
  accountRef?: string | null;
  direction: string;
  amountMinor: number;
  currencyRef?: string | null;
  costCentreRef?: string | null;
  dimensionRef?: string | null;
  taxCodeRef?: string | null;
  description?: string | null;
}

export class DraftService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M21Emitter;
  private readonly repo: JournalRepository;
  constructor(db: Db, authz: Authz, emitter: M21Emitter, repo: JournalRepository = new JournalRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private validateLineInput(ctx: RequestContext, l: LineInput): void {
    if (!isDirection(l.direction))
      throw badRequest('line direction must be debit or credit.', ctx.correlationId);
    if (!Number.isInteger(l.amountMinor) || l.amountMinor <= 0)
      throw badRequest(
        'line amountMinor must be a positive integer in minor units (no float money).',
        ctx.correlationId,
      );
  }

  /** Recompute the draft totals from its ACTIVE lines and persist them (optimistic-lock guarded). */
  private async recomputeTotals(
    tx: Tx,
    ctx: RequestContext,
    draftId: string,
    actor: string | null,
  ): Promise<JournalDraftRow> {
    const draft = await this.repo.findDraft(tx, draftId);
    if (draft === null) throw ProblemError.notFound('Draft not found.', ctx.correlationId);
    const lines = await this.repo.listLines(tx, draftId, true);
    const balance = computeBalance(
      lines.map((l) => ({
        accountRef: l.account_ref,
        direction: l.direction,
        amountMinor: Number(l.amount_minor),
        currencyRef: l.currency_ref,
        status: l.status,
      })),
    );
    const updated = await this.repo.updateDraftTotals(tx, {
      id: draftId,
      expectedVersion: draft.version,
      totalDebitsMinor: balance.debitsMinor,
      totalCreditsMinor: balance.creditsMinor,
      isBalanced: balance.balanced,
      lineCount: lines.length,
      by: actor,
    });
    if (updated === null) throw ProblemError.conflict('Draft modified concurrently.', ctx.correlationId);
    return updated;
  }

  /** Load a draft in an editable state, reverting a 'validated' draft to 'draft' (edits invalidate a validation). */
  private async loadEditable(
    tx: Tx,
    ctx: RequestContext,
    draftId: string,
    actor: string | null,
  ): Promise<JournalDraftRow> {
    const draft = await this.repo.findDraft(tx, draftId);
    if (draft === null) throw ProblemError.notFound('Draft not found.', ctx.correlationId);
    if (draft.status === 'draft') return draft;
    if (draft.status === 'validated') {
      const reverted = await this.repo.setDraftStatus(tx, {
        id: draftId,
        expectedVersion: draft.version,
        status: 'draft',
        by: actor,
      });
      if (reverted === null) throw ProblemError.conflict('Draft modified concurrently.', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        draftId,
        fromStatus: 'validated',
        toStatus: 'draft',
        reason: 'edited',
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      return reverted;
    }
    throw badRequest(`A ${draft.status} draft cannot be edited.`, ctx.correlationId);
  }

  async createDraft(
    ctx: RequestContext,
    actor: string | null,
    input: {
      journalTypeId?: string | null;
      entityRef?: string | null;
      periodRef?: string | null;
      periodStatus?: string;
      currencyRef?: string | null;
      journalDate?: string | null;
      description?: string | null;
      sourceType?: string;
      reference?: string | null;
      lines?: readonly LineInput[];
    },
  ): Promise<JournalDraftRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.draftCreate);
    const sourceType = input.sourceType ?? 'manual';
    if (!isSourceType(sourceType)) throw badRequest('unknown source type.', ctx.correlationId);
    const periodStatus = input.periodStatus ?? 'open';
    if (!isPeriodStatus(periodStatus)) throw badRequest('unknown period status.', ctx.correlationId);
    for (const l of input.lines ?? []) this.validateLineInput(ctx, l);
    return this.db.withTenant(ctx, async (tx) => {
      const draft = await this.repo.insertDraft(tx, {
        tenantId: ctx.tenantId,
        journalTypeId: input.journalTypeId ?? null,
        entityRef: input.entityRef ?? null,
        periodRef: input.periodRef ?? null,
        periodStatus,
        currencyRef: input.currencyRef ?? null,
        journalDate: input.journalDate ?? null,
        description: input.description ?? null,
        sourceType,
        sourceRef: null,
        recommendationId: null,
        reference: input.reference ?? null,
        requestedBy: actor,
        correlationId: ctx.correlationId,
        by: actor,
      });
      let lineNo = 1;
      for (const l of input.lines ?? []) {
        await this.repo.insertLine(tx, {
          tenantId: ctx.tenantId,
          draftId: draft.id,
          lineNo: lineNo++,
          accountRef: l.accountRef ?? null,
          direction: l.direction,
          amountMinor: l.amountMinor,
          currencyRef: l.currencyRef ?? null,
          costCentreRef: l.costCentreRef ?? null,
          dimensionRef: l.dimensionRef ?? null,
          taxCodeRef: l.taxCodeRef ?? null,
          description: l.description ?? null,
          correlationId: ctx.correlationId,
          by: actor,
        });
      }
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        draftId: draft.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      const withTotals =
        (input.lines ?? []).length > 0 ? await this.recomputeTotals(tx, ctx, draft.id, actor) : draft;
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.draftCreated,
        entityType: 'journal_draft',
        entityId: draft.id,
        detail: { sourceType },
      });
      await this.emitter.publishJournal(tx, {
        type: 'DraftCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: draft.id,
          recordType: 'draft',
          totalDebitsMinor: withTotals.total_debits_minor,
          totalCreditsMinor: withTotals.total_credits_minor,
          balanced: withTotals.is_balanced,
          lineCount: withTotals.line_count,
          isDraft: true,
        },
      });
      return withTotals;
    });
  }

  async editHeader(
    ctx: RequestContext,
    actor: string | null,
    draftId: string,
    expectedVersion: number,
    input: {
      journalTypeId?: string | null;
      entityRef?: string | null;
      periodRef?: string | null;
      periodStatus?: string;
      currencyRef?: string | null;
      journalDate?: string | null;
      description?: string | null;
      reference?: string | null;
    },
  ): Promise<JournalDraftRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.draftEdit);
    const periodStatus = input.periodStatus;
    if (periodStatus !== undefined && !isPeriodStatus(periodStatus))
      throw badRequest('unknown period status.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const draft = await this.repo.findDraft(tx, draftId);
      if (draft === null) throw ProblemError.notFound('Draft not found.', ctx.correlationId);
      if (draft.version !== expectedVersion)
        throw ProblemError.conflict('Draft modified concurrently.', ctx.correlationId);
      if (!isDraftEditable(draft.status) && draft.status !== 'validated')
        throw badRequest(`A ${draft.status} draft cannot be edited.`, ctx.correlationId);
      const updated = await this.repo.updateDraftHeader(tx, {
        id: draftId,
        expectedVersion,
        journalTypeId: input.journalTypeId ?? draft.journal_type_id,
        entityRef: input.entityRef ?? draft.entity_ref,
        periodRef: input.periodRef ?? draft.period_ref,
        periodStatus: periodStatus ?? draft.period_status,
        currencyRef: input.currencyRef ?? draft.currency_ref,
        journalDate: input.journalDate ?? draft.journal_date,
        description: input.description ?? draft.description,
        reference: input.reference ?? draft.reference,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Draft modified concurrently or not editable.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.draftEdited,
        entityType: 'journal_draft',
        entityId: draftId,
        detail: {},
      });
      await this.emitter.publishJournal(tx, {
        type: 'DraftEdited',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { recordId: draftId, recordType: 'draft', isDraft: true },
      });
      return updated;
    });
  }

  async addLine(
    ctx: RequestContext,
    actor: string | null,
    draftId: string,
    input: LineInput,
  ): Promise<{ draft: JournalDraftRow; line: JournalLineRow }> {
    await this.authz.require(ctx, M21_PERMISSIONS.lineManage);
    this.validateLineInput(ctx, input);
    return this.db.withTenant(ctx, async (tx) => {
      await this.loadEditable(tx, ctx, draftId, actor);
      const lineNo = await this.repo.nextLineNo(tx, draftId);
      const line = await this.repo.insertLine(tx, {
        tenantId: ctx.tenantId,
        draftId,
        lineNo,
        accountRef: input.accountRef ?? null,
        direction: input.direction,
        amountMinor: input.amountMinor,
        currencyRef: input.currencyRef ?? null,
        costCentreRef: input.costCentreRef ?? null,
        dimensionRef: input.dimensionRef ?? null,
        taxCodeRef: input.taxCodeRef ?? null,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const draft = await this.recomputeTotals(tx, ctx, draftId, actor);
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.lineAdded,
        entityType: 'journal_line',
        entityId: line.id,
        detail: { draftId, direction: input.direction },
      });
      await this.emitter.publishJournal(tx, {
        type: 'LineAdded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: line.id,
          recordType: 'line',
          draftId,
          balanced: draft.is_balanced,
          isDraft: true,
        },
      });
      return { draft, line };
    });
  }

  async updateLine(
    ctx: RequestContext,
    actor: string | null,
    lineId: string,
    expectedVersion: number,
    input: LineInput,
  ): Promise<{ draft: JournalDraftRow; line: JournalLineRow }> {
    await this.authz.require(ctx, M21_PERMISSIONS.lineManage);
    this.validateLineInput(ctx, input);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findLine(tx, lineId);
      if (existing === null) throw ProblemError.notFound('Line not found.', ctx.correlationId);
      await this.loadEditable(tx, ctx, existing.draft_id, actor);
      const line = await this.repo.updateLine(tx, {
        id: lineId,
        expectedVersion,
        accountRef: input.accountRef ?? null,
        direction: input.direction,
        amountMinor: input.amountMinor,
        currencyRef: input.currencyRef ?? null,
        description: input.description ?? null,
        by: actor,
      });
      if (line === null)
        throw ProblemError.conflict('Line modified concurrently or not active.', ctx.correlationId);
      const draft = await this.recomputeTotals(tx, ctx, existing.draft_id, actor);
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.lineUpdated,
        entityType: 'journal_line',
        entityId: lineId,
        detail: { draftId: existing.draft_id },
      });
      await this.emitter.publishJournal(tx, {
        type: 'LineUpdated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: lineId,
          recordType: 'line',
          draftId: existing.draft_id,
          balanced: draft.is_balanced,
          isDraft: true,
        },
      });
      return { draft, line };
    });
  }

  async removeLine(
    ctx: RequestContext,
    actor: string | null,
    lineId: string,
    expectedVersion: number,
  ): Promise<{ draft: JournalDraftRow; line: JournalLineRow }> {
    await this.authz.require(ctx, M21_PERMISSIONS.lineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findLine(tx, lineId);
      if (existing === null) throw ProblemError.notFound('Line not found.', ctx.correlationId);
      await this.loadEditable(tx, ctx, existing.draft_id, actor);
      const line = await this.repo.removeLine(tx, { id: lineId, expectedVersion, by: actor });
      if (line === null)
        throw ProblemError.conflict('Line modified concurrently or already removed.', ctx.correlationId);
      const draft = await this.recomputeTotals(tx, ctx, existing.draft_id, actor);
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.lineRemoved,
        entityType: 'journal_line',
        entityId: lineId,
        detail: { draftId: existing.draft_id },
      });
      await this.emitter.publishJournal(tx, {
        type: 'LineRemoved',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: lineId,
          recordType: 'line',
          draftId: existing.draft_id,
          balanced: draft.is_balanced,
          isDraft: true,
        },
      });
      return { draft, line };
    });
  }

  /** Submit a VALIDATED, balanced draft for approval (m22). m21 does NOT approve — it hands off the approvable unit. */
  async submitDraft(
    ctx: RequestContext,
    actor: string | null,
    draftId: string,
    expectedVersion: number,
  ): Promise<JournalDraftRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.draftSubmit);
    return this.db.withTenant(ctx, async (tx) => {
      const draft = await this.repo.findDraft(tx, draftId);
      if (draft === null) throw ProblemError.notFound('Draft not found.', ctx.correlationId);
      const t = checkDraftTransition(draft.status, 'submitted');
      if (!t.ok)
        throw badRequest(
          `A ${draft.status} draft cannot be submitted (validate it first).`,
          ctx.correlationId,
        );
      if (!draft.is_balanced)
        throw badRequest(
          'a draft must be balanced (debits == credits) before submission.',
          ctx.correlationId,
        );
      if (draft.period_status !== 'open')
        throw badRequest('a draft in a closed/locked period cannot be submitted.', ctx.correlationId);
      const updated = await this.repo.setDraftStatus(tx, {
        id: draftId,
        expectedVersion,
        status: 'submitted',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Draft modified concurrently.', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        draftId,
        fromStatus: draft.status,
        toStatus: 'submitted',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.draftSubmitted,
        entityType: 'journal_draft',
        entityId: draftId,
        detail: {},
      });
      await this.emitter.publishJournal(tx, {
        type: 'DraftSubmitted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: draftId,
          recordType: 'draft',
          fromStatus: draft.status,
          toStatus: 'submitted',
          balanced: true,
          isDraft: true,
        },
      });
      return updated;
    });
  }

  async withdrawDraft(
    ctx: RequestContext,
    actor: string | null,
    draftId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<JournalDraftRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.draftWithdraw);
    if (reason.trim() === '') throw badRequest('a withdrawal reason is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const draft = await this.repo.findDraft(tx, draftId);
      if (draft === null) throw ProblemError.notFound('Draft not found.', ctx.correlationId);
      const t = checkDraftTransition(draft.status, 'withdrawn');
      if (!t.ok) throw badRequest(`A ${draft.status} draft cannot be withdrawn.`, ctx.correlationId);
      const updated = await this.repo.setDraftStatus(tx, {
        id: draftId,
        expectedVersion,
        status: 'withdrawn',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Draft modified concurrently.', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        draftId,
        fromStatus: draft.status,
        toStatus: 'withdrawn',
        reason,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.draftWithdrawn,
        entityType: 'journal_draft',
        entityId: draftId,
        detail: { reason },
      });
      await this.emitter.publishJournal(tx, {
        type: 'DraftWithdrawn',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: draftId,
          recordType: 'draft',
          fromStatus: draft.status,
          toStatus: 'withdrawn',
          isDraft: true,
        },
      });
      return updated;
    });
  }

  async addNote(
    ctx: RequestContext,
    actor: string | null,
    draftId: string,
    input: { noteType?: string; content: string },
  ): Promise<JournalNoteRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.noteAdd);
    const noteType = input.noteType ?? 'general';
    if (!isNoteType(noteType)) throw badRequest('unknown note type.', ctx.correlationId);
    if (input.content.trim() === '') throw badRequest('note content is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const draft = await this.repo.findDraft(tx, draftId);
      if (draft === null) throw ProblemError.notFound('Draft not found.', ctx.correlationId);
      const note = await this.repo.insertNote(tx, {
        tenantId: ctx.tenantId,
        draftId,
        noteType,
        content: input.content,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.noteAdded,
        entityType: 'journal_note',
        entityId: note.id,
        detail: { draftId, noteType },
      });
      await this.emitter.publishJournal(tx, {
        type: 'NoteAdded',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { recordId: note.id, recordType: 'note', draftId, isDraft: true },
      });
      return note;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getDraft(
    ctx: RequestContext,
    id: string,
  ): Promise<{ draft: JournalDraftRow; lines: JournalLineRow[] }> {
    await this.authz.require(ctx, M21_PERMISSIONS.draftRead);
    return this.db.withTenant(ctx, async (tx) => {
      const draft = await this.repo.findDraft(tx, id);
      if (draft === null) throw ProblemError.notFound('Draft not found.', ctx.correlationId);
      const lines = await this.repo.listLines(tx, id, false);
      return { draft, lines };
    });
  }
  async listDrafts(ctx: RequestContext, status?: string): Promise<JournalDraftRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.draftRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDrafts(tx, status));
  }
  async listHistory(ctx: RequestContext, draftId: string): Promise<JournalStatusHistoryRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.draftRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listStatusHistory(tx, draftId));
  }
  async listNotes(ctx: RequestContext, draftId: string): Promise<JournalNoteRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.draftRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listNotes(tx, draftId));
  }
}
