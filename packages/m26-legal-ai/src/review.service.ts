/**
 * LegalAiReviewService — the HUMAN legal-review gate. A legal analysis is a RECOMMENDATION; it can only be
 * accepted/rejected/dismissed by a HUMAN reviewer (fail closed), an ACCEPT of a citations-required analysis needs at
 * least one citation, an ACCEPT is refused unless M24 approved the underlying AI output, and reviewing privileged /
 * work-product material requires the ethical-wall entitlement. M26 records the decision but NEVER files, reaches a
 * legal conclusion, settles, enforces or mutates the matter — a human acts through M14's own controlled endpoints.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M26_PERMISSIONS } from './permissions.ts';
import { M26_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  checkAnalysisTransition,
  decisionToState,
  evaluateEthicalWall,
  evaluateReviewGate,
  isReviewDecision,
  REASON_CODES,
} from './domain.ts';
import { LegalAiRepository, type AnalysisRow } from './repository.ts';
import type { AiGatewayPort } from './gateway.ts';
import type { M26Emitter } from './emit.ts';

const ANALYSIS_DECISION_AUDIT: Record<'accepted' | 'rejected' | 'dismissed', string> = {
  accepted: M26_AUDIT_CODES.analysisAccepted,
  rejected: M26_AUDIT_CODES.analysisRejected,
  dismissed: M26_AUDIT_CODES.analysisDismissed,
};

export class LegalAiReviewService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M26Emitter;
  private readonly gateway: AiGatewayPort;
  private readonly repo: LegalAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M26Emitter,
    gateway: AiGatewayPort,
    repo: LegalAiRepository = new LegalAiRepository(),
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
    await this.authz.require(ctx, M26_PERMISSIONS.legalReview);
    if (actor === null || actor.trim() === '')
      throw badRequest('a human legal reviewer is required (advisory only).', ctx.correlationId);
    if (!isReviewDecision(input.decision)) throw badRequest('unknown review decision.', ctx.correlationId);
    const targetState = decisionToState(input.decision);

    const analysis = await this.db.withTenant(ctx, (tx) => this.repo.findAnalysis(tx, analysisId));
    if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
    if (analysis.version !== expectedVersion)
      throw ProblemError.conflict('Analysis modified concurrently.', ctx.correlationId);

    // Ethical wall: privileged/work-product material requires the privileged-read entitlement.
    const subject = await this.db.withTenant(ctx, (tx) => this.repo.findSubject(tx, analysis.subject_id));
    if (subject !== null) {
      const wall = evaluateEthicalWall({
        privilege: subject.privilege_classification,
        hasPrivilegedRead: ctx.permissions.includes(M26_PERMISSIONS.privilegedRead),
      });
      if (!wall.allowed) throw governanceForbidden(wall.reasonCode, ctx.correlationId);
    }

    const t = checkAnalysisTransition(analysis.status, targetState);
    if (!t.ok)
      throw badRequest(`a ${analysis.status} analysis cannot be ${input.decision}ed.`, ctx.correlationId);

    // Human + citation gate (fail closed): a human reviewer, and citations where the analysis requires them.
    const gate = evaluateReviewGate({
      reviewerId: actor,
      decision: input.decision,
      citationsRequired: analysis.citations_required,
      citationCount: analysis.citation_count,
    });
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);

    // Drive the M24 output human-review for accept/reject (separate M24 transactions).
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
        entityType: 'legal_ai_analysis',
        entityId: analysisId,
        detail: { decision: input.decision },
      });
      return updated;
    });
  }
}
