/**
 * OperationalAiService — the governed operational-AI pipeline over Feedback (m12) and Case (m13). It binds a subject by
 * OPAQUE id, requests a GOVERNED analysis through the M24 gateway (submit -> process, all routing/DLP/confidence in M24),
 * and records the analysis + its human decision. It RECOMMENDS ONLY: an analysis can only be accepted/rejected/dismissed
 * by a HUMAN reviewer (fail closed), and an ACCEPT is refused unless M24 approved the underlying AI output — M25 never
 * acts on m12/m13 itself. The DLP input sample is used only for M24 scanning and is never persisted; large content is
 * referenced through m09 documents.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M25_PERMISSIONS } from './permissions.ts';
import { M25_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  checkAnalysisTransition,
  decisionToState,
  evaluateDecisionGate,
  isAnalysisKind,
  isConfidenceBps,
  isDecision,
  isEvidenceSource,
  isSentimentLabel,
  isSubjectType,
  REASON_CODES,
} from './domain.ts';
import {
  OperationalAiRepository,
  type AnalysisRow,
  type EvidenceRow,
  type SubjectRow,
} from './repository.ts';
import type { AiGatewayPort } from './gateway.ts';
import type { M25Emitter } from './emit.ts';

const ANALYSIS_DECISION_AUDIT: Record<'accepted' | 'rejected' | 'dismissed', string> = {
  accepted: M25_AUDIT_CODES.analysisAccepted,
  rejected: M25_AUDIT_CODES.analysisRejected,
  dismissed: M25_AUDIT_CODES.analysisDismissed,
};

export class OperationalAiService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M25Emitter;
  private readonly gateway: AiGatewayPort;
  private readonly repo: OperationalAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M25Emitter,
    gateway: AiGatewayPort,
    repo: OperationalAiRepository = new OperationalAiRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.gateway = gateway;
    this.repo = repo;
  }

  /** Bind (or return) the operational subject for an OPAQUE m12 feedback / m13 case reference. */
  async ensureSubject(
    ctx: RequestContext,
    actor: string | null,
    input: { subjectType: string; subjectRef: string; classification?: string },
  ): Promise<SubjectRow> {
    await this.authz.require(ctx, M25_PERMISSIONS.operationalAnalyze);
    if (!isSubjectType(input.subjectType)) throw badRequest('unknown subject type.', ctx.correlationId);
    return this.db.withTenant(ctx, (tx) => this.ensureSubjectTx(tx, ctx, actor, input));
  }

  private async ensureSubjectTx(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    input: { subjectType: string; subjectRef: string; classification?: string },
  ): Promise<SubjectRow> {
    const existing = await this.repo.findSubjectByRef(tx, input.subjectType, input.subjectRef);
    if (existing !== null) return existing;
    const subject = await this.repo.insertSubject(tx, {
      tenantId: ctx.tenantId,
      subjectType: input.subjectType,
      subjectRef: input.subjectRef,
      classification: input.classification ?? 'internal',
      correlationId: ctx.correlationId,
      by: actor,
    });
    await this.emitter.recordAudit(tx, ctx, {
      code: M25_AUDIT_CODES.subjectBound,
      entityType: 'ops_ai_subject',
      entityId: subject.id,
      detail: { subjectType: subject.subject_type },
    });
    return subject;
  }

  /**
   * Request a governed AI analysis of a subject. Generation is delegated to M24 (a governance refusal there leaves the
   * analysis 'failed'); the successful analysis lands in 'review_pending' for a HUMAN — it is NEVER auto-accepted.
   */
  async requestAnalysis(
    ctx: RequestContext,
    actor: string | null,
    input: {
      subjectType: string;
      subjectRef: string;
      classification?: string;
      analysisKind: string;
      providerId?: string | null;
      modelId?: string | null;
      promptId?: string | null;
      inputSample?: string;
      outputKind?: string;
      citationsRequired?: boolean;
      idempotencyKey?: string | null;
    },
  ): Promise<AnalysisRow> {
    await this.authz.require(ctx, M25_PERMISSIONS.operationalAnalyze);
    if (!isSubjectType(input.subjectType)) throw badRequest('unknown subject type.', ctx.correlationId);
    if (!isAnalysisKind(input.analysisKind)) throw badRequest('unknown analysis kind.', ctx.correlationId);

    // Ensure the subject + short-circuit on an idempotent replay (no duplicate M24 generation).
    const pre = await this.db.withTenant(ctx, async (tx) => {
      const subject = await this.ensureSubjectTx(tx, ctx, actor, {
        subjectType: input.subjectType,
        subjectRef: input.subjectRef,
        ...(input.classification !== undefined ? { classification: input.classification } : {}),
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findAnalysisByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return { subject, existing };
      }
      return { subject, existing: null as AnalysisRow | null };
    });
    if (pre.existing !== null) return pre.existing;
    const subject = pre.subject;

    // Delegate generation to the M24 governed pipeline (own transactions; never throws on a governance refusal).
    const gen = await this.gateway.analyze(ctx, actor, {
      subjectType: input.subjectType,
      subjectRef: input.subjectRef,
      classification: subject.classification,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      promptId: input.promptId ?? null,
      inputSample: input.inputSample ?? '',
      outputKind: input.outputKind ?? 'summary',
      citationsRequired: input.citationsRequired ?? false,
    });

    return this.db.withTenant(ctx, async (tx) => {
      const analysis = await this.repo.insertAnalysis(tx, {
        tenantId: ctx.tenantId,
        subjectId: subject.id,
        analysisKind: input.analysisKind,
        aiRequestRef: gen.requestRef,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '')
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          analysisId: analysis.id,
          correlationId: ctx.correlationId,
          by: actor,
        });
      await this.repo.insertAnalysisHistory(tx, {
        tenantId: ctx.tenantId,
        analysisId: analysis.id,
        fromStatus: null,
        toStatus: 'requested',
        reason: null,
        reasonCode: REASON_CODES.analysisRequested,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M25_AUDIT_CODES.analysisRequested,
        entityType: 'ops_ai_analysis',
        entityId: analysis.id,
        detail: { analysisKind: input.analysisKind },
      });

      if (gen.generated && gen.outputRef !== null) {
        const updated = await this.repo.updateAnalysis(tx, {
          id: analysis.id,
          expectedVersion: analysis.version,
          status: 'review_pending',
          aiOutputRef: gen.outputRef,
          confidenceBps: gen.confidenceBps,
          by: actor,
        });
        if (updated === null)
          throw ProblemError.conflict('Analysis modified concurrently.', ctx.correlationId);
        await this.repo.insertAnalysisHistory(tx, {
          tenantId: ctx.tenantId,
          analysisId: analysis.id,
          fromStatus: 'requested',
          toStatus: 'review_pending',
          reason: null,
          reasonCode: REASON_CODES.analysisGenerated,
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M25_AUDIT_CODES.analysisGenerated,
          entityType: 'ops_ai_analysis',
          entityId: analysis.id,
          detail: { confidenceBps: gen.confidenceBps },
        });
        return updated;
      }
      const failed = await this.repo.updateAnalysis(tx, {
        id: analysis.id,
        expectedVersion: analysis.version,
        status: 'failed',
        reviewReasonCode: gen.reasonCode,
        by: actor,
      });
      if (failed === null) throw ProblemError.conflict('Analysis modified concurrently.', ctx.correlationId);
      await this.repo.insertAnalysisHistory(tx, {
        tenantId: ctx.tenantId,
        analysisId: analysis.id,
        fromStatus: 'requested',
        toStatus: 'failed',
        reason: null,
        reasonCode: REASON_CODES.analysisFailed,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M25_AUDIT_CODES.analysisFailed,
        entityType: 'ops_ai_analysis',
        entityId: analysis.id,
        detail: { reasonCode: gen.reasonCode },
      });
      return failed;
    });
  }

  /**
   * A HUMAN reviews an analysis. Accept/reject drive the M24 output human-review; an ACCEPT is refused unless M24
   * approved the output (fail closed). Dismiss records an operational dismissal only. M25 never acts on m12/m13.
   */
  async reviewAnalysis(
    ctx: RequestContext,
    actor: string | null,
    analysisId: string,
    expectedVersion: number,
    input: {
      decision: string;
      sentimentLabel?: string | null;
      category?: string | null;
      reason?: string | null;
    },
  ): Promise<AnalysisRow> {
    await this.authz.require(ctx, M25_PERMISSIONS.operationalReview);
    if (actor === null || actor.trim() === '')
      throw badRequest('a human reviewer is required (recommends only).', ctx.correlationId);
    if (!isDecision(input.decision)) throw badRequest('unknown review decision.', ctx.correlationId);
    if (input.sentimentLabel != null && !isSentimentLabel(input.sentimentLabel))
      throw badRequest('unknown sentiment label.', ctx.correlationId);
    const gate = evaluateDecisionGate({ reviewerId: actor, decision: input.decision });
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    const targetState = decisionToState(input.decision);

    const analysis = await this.db.withTenant(ctx, (tx) => this.repo.findAnalysis(tx, analysisId));
    if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
    if (analysis.version !== expectedVersion)
      throw ProblemError.conflict('Analysis modified concurrently.', ctx.correlationId);
    const t = checkAnalysisTransition(analysis.status, targetState);
    if (!t.ok)
      throw badRequest(`a ${analysis.status} analysis cannot be ${input.decision}ed.`, ctx.correlationId);

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
        sentimentLabel: input.sentimentLabel ?? null,
        category: input.category ?? null,
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
        entityType: 'ops_ai_analysis',
        entityId: analysisId,
        detail: { decision: input.decision },
      });
      return updated;
    });
  }

  /** Record a source citation (opaque m12/m13/m09 ref + span) for an analysis or a suggestion. */
  async addEvidence(
    ctx: RequestContext,
    actor: string | null,
    input: {
      targetType: 'analysis' | 'suggestion';
      targetId: string;
      sourceType: string;
      sourceRef?: string | null;
      span?: string | null;
      confidenceBps?: number;
    },
  ): Promise<EvidenceRow> {
    await this.authz.require(ctx, M25_PERMISSIONS.operationalAnalyze);
    if (!isEvidenceSource(input.sourceType)) throw badRequest('unknown evidence source.', ctx.correlationId);
    const conf = input.confidenceBps ?? 0;
    if (!isConfidenceBps(conf))
      throw badRequest('confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const evidence = await this.repo.insertEvidence(tx, {
        tenantId: ctx.tenantId,
        targetType: input.targetType,
        targetId: input.targetId,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef ?? null,
        span: input.span ?? null,
        confidenceBps: conf,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M25_AUDIT_CODES.evidenceRecorded,
        entityType: 'ops_ai_evidence',
        entityId: evidence.id,
        detail: { targetType: input.targetType },
      });
      return evidence;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getAnalysis(
    ctx: RequestContext,
    id: string,
  ): Promise<{ analysis: AnalysisRow; evidence: EvidenceRow[] }> {
    await this.authz.require(ctx, M25_PERMISSIONS.operationalRead);
    return this.db.withTenant(ctx, async (tx) => {
      const analysis = await this.repo.findAnalysis(tx, id);
      if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
      const evidence = await this.repo.listEvidence(tx, 'analysis', id);
      return { analysis, evidence };
    });
  }
  async listAnalyses(ctx: RequestContext, subjectId: string): Promise<AnalysisRow[]> {
    await this.authz.require(ctx, M25_PERMISSIONS.operationalRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAnalyses(tx, subjectId));
  }
}
