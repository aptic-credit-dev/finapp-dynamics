/**
 * FinanceAiSuggestionService — EXPLAINABLE finance suggestions (match/candidate/anomaly categories) derived from an
 * ACCEPTED analysis. ADVISORY ONLY: a suggestion is created in 'suggested' and can only be decided by a HUMAN reviewer;
 * an accepted (explainability-required) suggestion must carry at least one matched FEATURE (no unexplained match
 * accepted); the DB `finance_ai_suggestion_human_ck` + `finance_ai_suggestion_explain_ck` are the last lines of defence.
 * Accepting records that a PERSON chose to act — M27 NEVER auto-matches, auto-posts, approves or mutates a finance
 * record; the human acts through the owning M15/M21 endpoints. Money is bigint minor units (never a float). Every
 * decision is audited. A suggestion is never a confirmed accounting fact.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M27_PERMISSIONS } from './permissions.ts';
import { M27_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  checkSuggestionTransition,
  decisionToState,
  evaluateReviewGate,
  isConfidenceBps,
  isFeatureType,
  isMinorUnits,
  isReviewDecision,
  isSuggestionType,
  REASON_CODES,
  type ReviewDecision,
} from './domain.ts';
import { FinanceAiRepository, type FeatureRow, type SuggestionRow } from './repository.ts';
import type { M27Emitter } from './emit.ts';

export class FinanceAiSuggestionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M27Emitter;
  private readonly repo: FinanceAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M27Emitter,
    repo: FinanceAiRepository = new FinanceAiRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  /** Create an explainable, advisory suggestion from an ACCEPTED analysis. amount is bigint minor units (never float). */
  async createSuggestion(
    ctx: RequestContext,
    actor: string | null,
    input: {
      analysisId: string;
      suggestionType: string;
      sourceRef?: string | null;
      targetRef?: string | null;
      matchingMethodRef?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      confidenceBps?: number;
      explainabilityRequired?: boolean;
    },
  ): Promise<SuggestionRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeAnalyze);
    if (!isSuggestionType(input.suggestionType))
      throw badRequest('unknown suggestion type.', ctx.correlationId);
    const conf = input.confidenceBps ?? 0;
    if (!isConfidenceBps(conf))
      throw badRequest('confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    if (input.amountMinor != null && !isMinorUnits(input.amountMinor))
      throw badRequest('amount must be an integer in minor units (no float).', ctx.correlationId);
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
        sourceRef: input.sourceRef ?? null,
        targetRef: input.targetRef ?? null,
        matchingMethodRef: input.matchingMethodRef ?? null,
        amountMinor: input.amountMinor != null ? String(input.amountMinor) : null,
        currency: input.currency ?? null,
        confidenceBps: conf,
        explainabilityRequired: input.explainabilityRequired ?? true,
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
        code: M27_AUDIT_CODES.suggestionCreated,
        entityType: 'finance_ai_suggestion',
        entityId: suggestion.id,
        detail: { suggestionType: input.suggestionType },
      });
      return suggestion;
    });
  }

  /** Record a matched FEATURE explaining a suggestion (explainability), bumping the suggestion's feature count. */
  async addFeature(
    ctx: RequestContext,
    actor: string | null,
    suggestionId: string,
    input: { featureType: string; weightBps?: number; reasonCode?: string | null },
  ): Promise<FeatureRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeAnalyze);
    if (!isFeatureType(input.featureType)) throw badRequest('unknown feature type.', ctx.correlationId);
    const weight = input.weightBps ?? 0;
    if (!isConfidenceBps(weight))
      throw badRequest('weight must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const suggestion = await this.repo.findSuggestion(tx, suggestionId);
      if (suggestion === null) throw ProblemError.notFound('Suggestion not found.', ctx.correlationId);
      if (suggestion.status !== 'suggested')
        throw badRequest('cannot add a feature to a decided suggestion.', ctx.correlationId);
      const feature = await this.repo.insertFeature(tx, {
        tenantId: ctx.tenantId,
        suggestionId,
        featureType: input.featureType,
        weightBps: weight,
        reasonCode: input.reasonCode ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      const count = await this.repo.countFeatures(tx, suggestionId);
      await this.repo.updateSuggestion(tx, {
        id: suggestionId,
        expectedVersion: suggestion.version,
        status: suggestion.status,
        featureCount: count,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M27_AUDIT_CODES.featureRecorded,
        entityType: 'finance_ai_feature',
        entityId: feature.id,
        detail: { suggestionId, featureType: input.featureType },
      });
      return feature;
    });
  }

  /**
   * A HUMAN decides a suggestion. ADVISORY ONLY — an accepted explainability-required suggestion needs a matched
   * feature (no unexplained match), and M27 records the decision but NEVER auto-matches/auto-posts/mutates a record.
   */
  async decideSuggestion(
    ctx: RequestContext,
    actor: string | null,
    suggestionId: string,
    expectedVersion: number,
    input: { decision: string; reason?: string | null },
  ): Promise<SuggestionRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeReview);
    if (actor === null || actor.trim() === '')
      throw badRequest('a human reviewer is required (advisory only, no auto-post).', ctx.correlationId);
    if (!isReviewDecision(input.decision)) throw badRequest('unknown decision.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const suggestion = await this.repo.findSuggestion(tx, suggestionId);
      if (suggestion === null) throw ProblemError.notFound('Suggestion not found.', ctx.correlationId);
      if (suggestion.version !== expectedVersion)
        throw ProblemError.conflict('Suggestion modified concurrently.', ctx.correlationId);
      const targetState = decisionToState(input.decision as ReviewDecision);
      const t = checkSuggestionTransition(suggestion.status, targetState);
      if (!t.ok)
        throw badRequest(
          `a ${suggestion.status} suggestion cannot be ${input.decision}ed.`,
          ctx.correlationId,
        );
      // Human + explainability gate (fail closed): accepting an unexplained match is refused.
      const gate = evaluateReviewGate({
        reviewerId: actor,
        decision: input.decision,
        explainabilityRequired: suggestion.explainability_required,
        featureCount: suggestion.feature_count,
      });
      if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
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
        code: M27_AUDIT_CODES.suggestionReviewed,
        entityType: 'finance_ai_suggestion',
        entityId: suggestionId,
        detail: { decision: input.decision, autopostedByM27: false, automatchedByM27: false },
      });
      return updated;
    });
  }

  async getSuggestion(
    ctx: RequestContext,
    id: string,
  ): Promise<{ suggestion: SuggestionRow; features: FeatureRow[] }> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeRead);
    return this.db.withTenant(ctx, async (tx) => {
      const suggestion = await this.repo.findSuggestion(tx, id);
      if (suggestion === null) throw ProblemError.notFound('Suggestion not found.', ctx.correlationId);
      const features = await this.repo.listFeatures(tx, id);
      return { suggestion, features };
    });
  }
  async listSuggestions(ctx: RequestContext, analysisId: string): Promise<SuggestionRow[]> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listSuggestions(tx, analysisId));
  }
}
