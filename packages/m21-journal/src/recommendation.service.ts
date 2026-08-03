/**
 * RecommendationService — intake of DRAFT journal recommendations (from the m20 GL-reconciliation handoff, AI, or
 * operations) and their lifecycle up to conversion into a draft journal. m21 copies the recommendation into its OWN
 * `journal_recommendation` under its own controls (it never reads m20/m19 tables — entity/currency/account refs are
 * OPAQUE ids). Intake is idempotent per m20 handoff_ref. A recommendation moves proposed -> accepted -> converted,
 * or -> dismissed. Conversion mints a DRAFT journal (debits/credits copied as lines; totals recomputed). It NEVER
 * approves or posts. Money is INTEGER MINOR UNITS — never float (ADR-007).
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M21_PERMISSIONS } from './permissions.ts';
import { M21_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isDirection, isSourceType } from './domain/limits.ts';
import { checkRecommendationTransition } from './domain/lifecycles.ts';
import { computeBalance } from './engine.ts';
import {
  JournalRepository,
  type JournalDraftRow,
  type JournalRecommendationLineRow,
  type JournalRecommendationRow,
} from './repository.ts';
import type { M21Emitter } from './emit.ts';

interface RecommendationLineInput {
  accountRef?: string | null;
  direction: string;
  amountMinor: number;
  currencyRef?: string | null;
  description?: string | null;
}

export class RecommendationService {
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

  /** Ingest a recommendation. Idempotent per handoff_ref — a re-delivered m20 handoff returns the existing record. */
  async ingestRecommendation(
    ctx: RequestContext,
    actor: string | null,
    input: {
      sourceType?: string;
      sourceRef?: string | null;
      handoffRef?: string | null;
      entityRef?: string | null;
      currencyRef?: string | null;
      amountMinor: number;
      description?: string | null;
      reasonCode?: string | null;
      confidenceBand?: string | null;
      lines?: readonly RecommendationLineInput[];
    },
  ): Promise<JournalRecommendationRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.recommendationIngest);
    const sourceType = input.sourceType ?? 'gl_reconciliation';
    if (!isSourceType(sourceType)) throw badRequest('unknown source type.', ctx.correlationId);
    if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0)
      throw badRequest(
        'amountMinor must be a non-negative integer in minor units (no float money).',
        ctx.correlationId,
      );
    for (const l of input.lines ?? []) {
      if (!isDirection(l.direction))
        throw badRequest('line direction must be debit or credit.', ctx.correlationId);
      if (!Number.isInteger(l.amountMinor) || l.amountMinor <= 0)
        throw badRequest('line amountMinor must be a positive integer in minor units.', ctx.correlationId);
    }
    return this.db.withTenant(ctx, async (tx) => {
      if (input.handoffRef != null && input.handoffRef !== '') {
        const existing = await this.repo.findRecommendationByHandoff(tx, input.handoffRef);
        if (existing !== null) return existing; // idempotent intake
      }
      const rec = await this.repo.insertRecommendation(tx, {
        tenantId: ctx.tenantId,
        sourceType,
        sourceRef: input.sourceRef ?? null,
        handoffRef: input.handoffRef ?? null,
        entityRef: input.entityRef ?? null,
        currencyRef: input.currencyRef ?? null,
        amountMinor: input.amountMinor,
        description: input.description ?? null,
        reasonCode: input.reasonCode ?? null,
        confidenceBand: input.confidenceBand ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      let lineNo = 1;
      for (const l of input.lines ?? []) {
        await this.repo.insertRecommendationLine(tx, {
          tenantId: ctx.tenantId,
          recommendationId: rec.id,
          lineNo: lineNo++,
          accountRef: l.accountRef ?? null,
          direction: l.direction,
          amountMinor: l.amountMinor,
          currencyRef: l.currencyRef ?? null,
          description: l.description ?? null,
          correlationId: ctx.correlationId,
          by: actor,
        });
      }
      await this.repo.insertRecommendationHistory(tx, {
        tenantId: ctx.tenantId,
        recommendationId: rec.id,
        fromStatus: null,
        toStatus: 'proposed',
        reason: null,
        reasonCode: input.reasonCode ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.recommendationIngested,
        entityType: 'journal_recommendation',
        entityId: rec.id,
        detail: { sourceType, ...(input.reasonCode != null ? { reasonCode: input.reasonCode } : {}) },
      });
      await this.emitter.publishJournal(tx, {
        type: 'RecommendationIngested',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: rec.id,
          recordType: 'recommendation',
          sourceType,
          ...(input.confidenceBand != null ? { confidenceBand: input.confidenceBand } : {}),
          ...(input.reasonCode != null ? { reasonCode: input.reasonCode } : {}),
          isDraft: true,
        },
      });
      return rec;
    });
  }

  async acceptRecommendation(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<JournalRecommendationRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.recommendationManage);
    return this.transition(
      ctx,
      actor,
      id,
      expectedVersion,
      'accepted',
      null,
      M21_AUDIT_CODES.recommendationAccepted,
      'RecommendationAccepted',
    );
  }
  async dismissRecommendation(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<JournalRecommendationRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.recommendationManage);
    if (reason.trim() === '') throw badRequest('a dismissal reason is required.', ctx.correlationId);
    return this.transition(
      ctx,
      actor,
      id,
      expectedVersion,
      'dismissed',
      reason,
      M21_AUDIT_CODES.recommendationDismissed,
      'RecommendationDismissed',
    );
  }

  private async transition(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    toStatus: string,
    reason: string | null,
    auditCode: string,
    eventType: 'RecommendationAccepted' | 'RecommendationDismissed',
  ): Promise<JournalRecommendationRow> {
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.repo.findRecommendation(tx, id);
      if (rec === null) throw ProblemError.notFound('Recommendation not found.', ctx.correlationId);
      const t = checkRecommendationTransition(rec.status, toStatus);
      if (!t.ok)
        throw badRequest(`Cannot move a ${rec.status} recommendation to ${toStatus}.`, ctx.correlationId);
      const updated = await this.repo.setRecommendationStatus(tx, {
        id,
        expectedVersion,
        toStatus,
        draftId: null,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Recommendation modified concurrently.', ctx.correlationId);
      await this.repo.insertRecommendationHistory(tx, {
        tenantId: ctx.tenantId,
        recommendationId: id,
        fromStatus: rec.status,
        toStatus,
        reason,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'journal_recommendation',
        entityId: id,
        detail: reason !== null ? { reason } : {},
      });
      await this.emitter.publishJournal(tx, {
        type: eventType,
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'recommendation',
          fromStatus: rec.status,
          toStatus,
          isDraft: true,
        },
      });
      return updated;
    });
  }

  /**
   * Convert an ACCEPTED recommendation into a DRAFT journal: mint a draft, copy the recommendation's legs as journal
   * lines, recompute the balance, and mark the recommendation converted (linking the draft). Draft-only — never posts.
   */
  async convertRecommendation(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    input: {
      journalTypeId?: string | null;
      periodRef?: string | null;
      periodStatus?: string;
      journalDate?: string | null;
      reference?: string | null;
      description?: string | null;
    },
  ): Promise<{ recommendation: JournalRecommendationRow; draft: JournalDraftRow }> {
    await this.authz.require(ctx, M21_PERMISSIONS.recommendationManage);
    await this.authz.require(ctx, M21_PERMISSIONS.draftCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.repo.findRecommendation(tx, id);
      if (rec === null) throw ProblemError.notFound('Recommendation not found.', ctx.correlationId);
      const t = checkRecommendationTransition(rec.status, 'converted');
      if (!t.ok)
        throw badRequest(
          `Only an accepted recommendation can be converted (is ${rec.status}).`,
          ctx.correlationId,
        );
      const recLines = await this.repo.listRecommendationLines(tx, id);
      if (recLines.length === 0)
        throw badRequest('a recommendation needs at least one leg to convert.', ctx.correlationId);

      const draft = await this.repo.insertDraft(tx, {
        tenantId: ctx.tenantId,
        journalTypeId: input.journalTypeId ?? null,
        entityRef: rec.entity_ref,
        periodRef: input.periodRef ?? null,
        periodStatus: input.periodStatus ?? 'open',
        currencyRef: rec.currency_ref,
        journalDate: input.journalDate ?? null,
        description: input.description ?? rec.description,
        sourceType: rec.source_type,
        sourceRef: rec.source_ref,
        recommendationId: rec.id,
        reference: input.reference ?? null,
        requestedBy: actor,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const forBalance: { direction: string; amountMinor: number; accountRef: string | null }[] = [];
      let lineNo = 1;
      for (const rl of recLines) {
        const amt = Number(rl.amount_minor);
        await this.repo.insertLine(tx, {
          tenantId: ctx.tenantId,
          draftId: draft.id,
          lineNo: lineNo++,
          accountRef: rl.account_ref,
          direction: rl.direction,
          amountMinor: amt,
          currencyRef: rl.currency_ref,
          costCentreRef: null,
          dimensionRef: null,
          taxCodeRef: null,
          description: rl.description,
          correlationId: ctx.correlationId,
          by: actor,
        });
        forBalance.push({ direction: rl.direction, amountMinor: amt, accountRef: rl.account_ref });
      }
      const balance = computeBalance(
        forBalance.map((l) => ({
          accountRef: l.accountRef,
          direction: l.direction,
          amountMinor: l.amountMinor,
        })),
      );
      const withTotals = await this.repo.updateDraftTotals(tx, {
        id: draft.id,
        expectedVersion: draft.version,
        totalDebitsMinor: balance.debitsMinor,
        totalCreditsMinor: balance.creditsMinor,
        isBalanced: balance.balanced,
        lineCount: recLines.length,
        by: actor,
      });
      if (withTotals === null) throw ProblemError.conflict('Draft modified concurrently.', ctx.correlationId);
      await this.repo.insertStatusHistory(tx, {
        tenantId: ctx.tenantId,
        draftId: draft.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: 'converted from recommendation',
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });

      const updatedRec = await this.repo.setRecommendationStatus(tx, {
        id,
        expectedVersion,
        toStatus: 'converted',
        draftId: draft.id,
        by: actor,
      });
      if (updatedRec === null)
        throw ProblemError.conflict('Recommendation modified concurrently.', ctx.correlationId);
      await this.repo.insertRecommendationHistory(tx, {
        tenantId: ctx.tenantId,
        recommendationId: id,
        fromStatus: rec.status,
        toStatus: 'converted',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });

      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.recommendationConverted,
        entityType: 'journal_recommendation',
        entityId: id,
        detail: { draftId: draft.id },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.draftCreated,
        entityType: 'journal_draft',
        entityId: draft.id,
        detail: { fromRecommendation: id },
      });
      await this.emitter.publishJournal(tx, {
        type: 'RecommendationConverted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'recommendation',
          draftId: draft.id,
          toStatus: 'converted',
          isDraft: true,
        },
      });
      await this.emitter.publishJournal(tx, {
        type: 'DraftCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: draft.id,
          recordType: 'draft',
          recommendationId: id,
          totalDebitsMinor: String(balance.debitsMinor),
          totalCreditsMinor: String(balance.creditsMinor),
          balanced: balance.balanced,
          lineCount: recLines.length,
          isDraft: true,
        },
      });
      return { recommendation: updatedRec, draft: withTotals };
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getRecommendation(
    ctx: RequestContext,
    id: string,
  ): Promise<{ recommendation: JournalRecommendationRow; lines: JournalRecommendationLineRow[] }> {
    await this.authz.require(ctx, M21_PERMISSIONS.recommendationRead);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.repo.findRecommendation(tx, id);
      if (rec === null) throw ProblemError.notFound('Recommendation not found.', ctx.correlationId);
      const lines = await this.repo.listRecommendationLines(tx, id);
      return { recommendation: rec, lines };
    });
  }
  async listRecommendations(ctx: RequestContext, status?: string): Promise<JournalRecommendationRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.recommendationRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRecommendations(tx, status));
  }
}
