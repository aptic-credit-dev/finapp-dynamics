/**
 * LegalAiSuggestionService — legal SUGGESTIONS (procedural / drafting / risk / next_action / precedent / evidence_gap)
 * derived from an ACCEPTED analysis. ADVISORY ONLY: a suggestion is created in 'suggested' and can only be decided by a
 * HUMAN reviewer; the DB `legal_ai_suggestion_human_ck` is the last line of defence. Accepting a suggestion records that
 * a PERSON chose to act — M26 NEVER files, settles, enforces, creates a hearing/deadline/decision or mutates a matter;
 * the human acts through M14's own controlled endpoints. Every decision is audited.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M26_PERMISSIONS } from './permissions.ts';
import { M26_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  checkSuggestionTransition,
  decisionToState,
  evaluateReviewGate,
  isConfidenceBps,
  isReviewDecision,
  isSuggestionType,
  REASON_CODES,
} from './domain.ts';
import { LegalAiRepository, type SuggestionRow } from './repository.ts';
import type { M26Emitter } from './emit.ts';

export class LegalAiSuggestionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M26Emitter;
  private readonly repo: LegalAiRepository;
  constructor(db: Db, authz: Authz, emitter: M26Emitter, repo: LegalAiRepository = new LegalAiRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  /** Create an advisory suggestion from an ACCEPTED analysis. */
  async createSuggestion(
    ctx: RequestContext,
    actor: string | null,
    input: {
      analysisId: string;
      suggestionType: string;
      recommendedRef?: string | null;
      rationaleDocumentRef?: string | null;
      confidenceBps?: number;
    },
  ): Promise<SuggestionRow> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalAnalyze);
    if (!isSuggestionType(input.suggestionType))
      throw badRequest('unknown suggestion type.', ctx.correlationId);
    const conf = input.confidenceBps ?? 0;
    if (!isConfidenceBps(conf))
      throw badRequest('confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const analysis = await this.repo.findAnalysis(tx, input.analysisId);
      if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
      if (analysis.status !== 'accepted')
        throw badRequest(
          'a suggestion can only be created from a human-accepted analysis.',
          ctx.correlationId,
        );
      const suggestion = await this.repo.insertSuggestion(tx, {
        tenantId: ctx.tenantId,
        analysisId: input.analysisId,
        suggestionType: input.suggestionType,
        recommendedRef: input.recommendedRef ?? null,
        rationaleDocumentRef: input.rationaleDocumentRef ?? null,
        confidenceBps: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertSuggestionHistory(tx, {
        tenantId: ctx.tenantId,
        suggestionId: suggestion.id,
        fromStatus: null,
        toStatus: 'suggested',
        reason: null,
        reasonCode: REASON_CODES.suggestionCreated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M26_AUDIT_CODES.suggestionCreated,
        entityType: 'legal_ai_suggestion',
        entityId: suggestion.id,
        detail: { suggestionType: input.suggestionType },
      });
      return suggestion;
    });
  }

  /** A HUMAN decides a suggestion. ADVISORY ONLY — M26 records the decision but never acts on the matter (M14). */
  async decideSuggestion(
    ctx: RequestContext,
    actor: string | null,
    suggestionId: string,
    expectedVersion: number,
    input: { decision: string; reason?: string | null },
  ): Promise<SuggestionRow> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalReview);
    if (actor === null || actor.trim() === '')
      throw badRequest('a human legal reviewer is required (advisory only).', ctx.correlationId);
    if (!isReviewDecision(input.decision)) throw badRequest('unknown decision.', ctx.correlationId);
    const gate = evaluateReviewGate({
      reviewerId: actor,
      decision: input.decision,
      citationsRequired: false,
      citationCount: 0,
    });
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    const targetState = decisionToState(input.decision);
    return this.db.withTenant(ctx, async (tx) => {
      const suggestion = await this.repo.findSuggestion(tx, suggestionId);
      if (suggestion === null) throw ProblemError.notFound('Suggestion not found.', ctx.correlationId);
      if (suggestion.version !== expectedVersion)
        throw ProblemError.conflict('Suggestion modified concurrently.', ctx.correlationId);
      const t = checkSuggestionTransition(suggestion.status, targetState);
      if (!t.ok)
        throw badRequest(
          `a ${suggestion.status} suggestion cannot be ${input.decision}ed.`,
          ctx.correlationId,
        );
      const updated = await this.repo.updateSuggestion(tx, {
        id: suggestionId,
        expectedVersion,
        status: targetState,
        decidedBy: actor,
        decisionReasonCode: gate.reasonCode,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Suggestion modified concurrently.', ctx.correlationId);
      await this.repo.insertSuggestionHistory(tx, {
        tenantId: ctx.tenantId,
        suggestionId,
        fromStatus: suggestion.status,
        toStatus: targetState,
        reason: input.reason ?? null,
        reasonCode: gate.reasonCode,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'suggestion',
        targetId: suggestionId,
        reviewer: actor,
        decision: input.decision,
        reason: input.reason ?? null,
        reasonCode: gate.reasonCode,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M26_AUDIT_CODES.suggestionReviewed,
        entityType: 'legal_ai_suggestion',
        entityId: suggestionId,
        detail: { decision: input.decision, appliedByM26: false },
      });
      return updated;
    });
  }

  async getSuggestion(ctx: RequestContext, id: string): Promise<SuggestionRow> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalRead);
    return this.db.withTenant(ctx, async (tx) => {
      const suggestion = await this.repo.findSuggestion(tx, id);
      if (suggestion === null) throw ProblemError.notFound('Suggestion not found.', ctx.correlationId);
      return suggestion;
    });
  }
  async listSuggestions(ctx: RequestContext, analysisId: string): Promise<SuggestionRow[]> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listSuggestions(tx, analysisId));
  }
}
