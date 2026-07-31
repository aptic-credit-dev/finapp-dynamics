/**
 * RecommendationService — DRAFT journal recommendations ONLY. m20 recommends a debit/credit correction for a
 * reconciling item or exception; it NEVER posts a journal, alters a ledger balance, invokes an external finance
 * system, or approves anything (is_draft is always true, DB-enforced). A recommendation moves proposed → withdrawn or
 * handed_off; the handoff is the contract for m21 (the journal engine) to pick up under its own controls + approval
 * (m22). Money is INTEGER MINOR UNITS — never float (ADR-007). Debit/credit account suggestions are OPAQUE m19 refs.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { GlreconLifecycleEventType, GlreconLifecyclePayload } from '@finapp/contracts';
import { M20_PERMISSIONS } from './permissions.ts';
import { M20_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { GlreconRepository, type GlRecommendationRow } from './repository.ts';
import type { M20Emitter } from './emit.ts';

export class RecommendationService {
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

  async createRecommendation(
    ctx: RequestContext,
    actor: string | null,
    input: {
      runId: string;
      exceptionId?: string | null;
      reconcilingItemId?: string | null;
      debitAccountRef?: string | null;
      creditAccountRef?: string | null;
      amountMinor: number;
      currencyRef?: string | null;
      description?: string | null;
      reasonCode?: string | null;
      confidenceBand?: string | null;
    },
  ): Promise<GlRecommendationRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.recommendationCreate);
    if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0)
      throw badRequest(
        'amountMinor must be a non-negative integer in minor units (no float money).',
        ctx.correlationId,
      );
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.repo.findRun(tx, input.runId);
      if (run === null) throw ProblemError.notFound('Run not found.', ctx.correlationId);
      const rec = await this.repo.insertRecommendation(tx, {
        tenantId: ctx.tenantId,
        runId: input.runId,
        exceptionId: input.exceptionId ?? null,
        reconcilingItemId: input.reconcilingItemId ?? null,
        debitAccountRef: input.debitAccountRef ?? null,
        creditAccountRef: input.creditAccountRef ?? null,
        amountMinor: input.amountMinor,
        currencyRef: input.currencyRef ?? null,
        description: input.description ?? null,
        reasonCode: input.reasonCode ?? null,
        confidenceBand: input.confidenceBand ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.recommendationCreated,
        entityType: 'gl_journal_recommendation',
        entityId: rec.id,
        detail: { reasonCode: input.reasonCode ?? null },
      });
      await this.publish(tx, ctx, actor, 'RecommendationCreated', {
        recordId: rec.id,
        recordType: 'recommendation',
        runId: input.runId,
        ...(input.reasonCode != null ? { reasonCode: input.reasonCode } : {}),
        recommendationDraft: true,
      });
      return rec;
    });
  }

  async withdrawRecommendation(
    ctx: RequestContext,
    actor: string | null,
    recommendationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<GlRecommendationRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.recommendationWithdraw);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.repo.findRecommendation(tx, recommendationId);
      if (rec === null) throw ProblemError.notFound('Recommendation not found.', ctx.correlationId);
      const updated = await this.repo.setRecommendationStatus(tx, {
        id: recommendationId,
        expectedVersion,
        toStatus: 'withdrawn',
        handoffRef: null,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict(
          'Recommendation modified concurrently or not in a withdrawable state.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.recommendationWithdrawn,
        entityType: 'gl_journal_recommendation',
        entityId: recommendationId,
        detail: { reason },
      });
      await this.publish(tx, ctx, actor, 'RecommendationWithdrawn', {
        recordId: recommendationId,
        recordType: 'recommendation',
        runId: rec.run_id,
        toStatus: 'withdrawn',
        recommendationDraft: true,
      });
      return updated;
    });
  }

  /** Mark a recommendation handed off to m21 (the journal engine). m20 does NOT post — it records the handoff only. */
  async handOffRecommendation(
    ctx: RequestContext,
    actor: string | null,
    recommendationId: string,
    expectedVersion: number,
    handoffRef?: string | null,
  ): Promise<GlRecommendationRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.recommendationCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.repo.findRecommendation(tx, recommendationId);
      if (rec === null) throw ProblemError.notFound('Recommendation not found.', ctx.correlationId);
      const updated = await this.repo.setRecommendationStatus(tx, {
        id: recommendationId,
        expectedVersion,
        toStatus: 'handed_off',
        handoffRef: handoffRef ?? null,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict(
          'Recommendation modified concurrently or not in a proposable state.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.recommendationHandedOff,
        entityType: 'gl_journal_recommendation',
        entityId: recommendationId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'RecommendationHandedOff', {
        recordId: recommendationId,
        recordType: 'recommendation',
        runId: rec.run_id,
        toStatus: 'handed_off',
        recommendationDraft: true,
      });
      return updated;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getRecommendation(ctx: RequestContext, id: string): Promise<GlRecommendationRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.recommendationRead);
    return this.db.withTenant(ctx, async (tx) => {
      const rec = await this.repo.findRecommendation(tx, id);
      if (rec === null) throw ProblemError.notFound('Recommendation not found.', ctx.correlationId);
      return rec;
    });
  }
  async listRecommendations(
    ctx: RequestContext,
    runId: string,
    status?: string,
  ): Promise<GlRecommendationRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.recommendationRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listRecommendationsByRun(tx, { runId, ...(status !== undefined ? { status } : {}) }),
    );
  }
}
