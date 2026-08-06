/**
 * FinanceAiReviewService — the HUMAN review gate for a finance-AI analysis. An analysis is a RECOMMENDATION; it can
 * only be accepted/rejected/dismissed by a HUMAN reviewer (fail closed), and an ACCEPT is refused unless M24 approved
 * the underlying AI output. M27 records the decision but NEVER auto-matches, auto-posts, approves or mutates a finance
 * record — a human acts through the owning M15/M20/M21 endpoints.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M27_PERMISSIONS } from './permissions.ts';
import { M27_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  checkAnalysisTransition,
  decisionToState,
  evaluateReviewGate,
  isReviewDecision,
  REASON_CODES,
} from './domain.ts';
import { FinanceAiRepository, type AnalysisRow } from './repository.ts';
import type { AiGatewayPort } from './gateway.ts';
import type { M27Emitter } from './emit.ts';

const ANALYSIS_DECISION_AUDIT: Record<'accepted' | 'rejected' | 'dismissed', string> = {
  accepted: M27_AUDIT_CODES.analysisAccepted,
  rejected: M27_AUDIT_CODES.analysisRejected,
  dismissed: M27_AUDIT_CODES.analysisDismissed,
};

export class FinanceAiReviewService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M27Emitter;
  private readonly gateway: AiGatewayPort;
  private readonly repo: FinanceAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M27Emitter,
    gateway: AiGatewayPort,
    repo: FinanceAiRepository = new FinanceAiRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.gateway = gateway;
    this.repo = repo;
  }

  async reviewAnalysis(
    ctx: RequestContext,
    actor: string | null,
    analysisId: string,
    expectedVersion: number,
    input: { decision: string; reason?: string | null },
  ): Promise<AnalysisRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeReview);
    if (actor === null || actor.trim() === '')
      throw badRequest('a human reviewer is required (advisory only, no auto-post).', ctx.correlationId);
    if (!isReviewDecision(input.decision)) throw badRequest('unknown review decision.', ctx.correlationId);
    const gate = evaluateReviewGate({
      reviewerId: actor,
      decision: input.decision,
      explainabilityRequired: false,
      featureCount: 0,
    });
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    const targetState = decisionToState(input.decision);

    const analysis = await this.db.withTenant(ctx, (tx) => this.repo.findAnalysis(tx, analysisId));
    if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
    if (analysis.version !== expectedVersion)
      throw ProblemError.conflict('Analysis modified concurrently.', ctx.correlationId);
    const t = checkAnalysisTransition(analysis.status, targetState);
    if (!t.ok)
      throw badRequest(`a ${analysis.status} analysis cannot be ${input.decision}ed.`, ctx.correlationId);

    if (analysis.ai_output_ref !== null && (input.decision === 'accept' || input.decision === 'reject')) {
      const dec = await this.gateway.decideOutput(
        ctx,
        actor,
        analysis.ai_output_ref,
        input.decision === 'accept' ? 'approved' : 'rejected',
      );
      if (input.decision === 'accept' && !dec.done)
        throw governanceForbidden(REASON_CODES.aiOutputNotApproved, ctx.correlationId);
    }

    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.updateAnalysis(tx, {
        id: analysisId,
        expectedVersion,
        status: targetState,
        reviewedBy: actor,
        reviewReasonCode: gate.reasonCode,
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Analysis modified concurrently.', ctx.correlationId);
      await this.repo.insertAnalysisHistory(tx, {
        tenantId: ctx.tenantId,
        analysisId,
        fromStatus: analysis.status,
        toStatus: targetState,
        reason: input.reason ?? null,
        reasonCode: gate.reasonCode,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'analysis',
        targetId: analysisId,
        reviewer: actor,
        decision: input.decision,
        reason: input.reason ?? null,
        reasonCode: gate.reasonCode,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: ANALYSIS_DECISION_AUDIT[targetState],
        entityType: 'finance_ai_analysis',
        entityId: analysisId,
        detail: { decision: input.decision },
      });
      return updated;
    });
  }
}
