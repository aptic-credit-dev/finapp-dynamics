/**
 * FinanceAiAnalysisService — the governed finance-AI pipeline over M15 bank-recon / M20 GL-recon subjects. It binds a
 * subject by OPAQUE recon reference, requests a GOVERNED analysis through the M24 gateway (submit -> process; all
 * routing/DLP/confidence in M24), and records the analysis, its M24 model-result summary and exception classifications.
 * An analysis lands in `review_pending` for a HUMAN — it is NEVER auto-accepted, NEVER auto-matched, NEVER auto-posted,
 * and M27 never mutates a finance record. A classification/suggestion is never a confirmed accounting fact.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M27_PERMISSIONS } from './permissions.ts';
import { M27_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import {
  isAnalysisKind,
  isConfidenceBps,
  isExceptionCategory,
  isFinanceClassification,
  isSubjectType,
  REASON_CODES,
} from './domain.ts';
import {
  FinanceAiRepository,
  type AnalysisRow,
  type ExceptionClassificationRow,
  type ModelResultRow,
  type SubjectRow,
} from './repository.ts';
import type { AiGatewayPort } from './gateway.ts';
import type { M27Emitter } from './emit.ts';

export class FinanceAiAnalysisService {
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

  async ensureSubject(
    ctx: RequestContext,
    actor: string | null,
    input: { subjectType: string; subjectRef: string; classification?: string },
  ): Promise<SubjectRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeAnalyze);
    if (!isSubjectType(input.subjectType)) throw badRequest('unknown subject type.', ctx.correlationId);
    if (input.classification !== undefined && !isFinanceClassification(input.classification))
      throw badRequest('unknown classification.', ctx.correlationId);
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
      classification: input.classification ?? 'confidential',
      correlationId: ctx.correlationId,
      by: actor,
    });
    await this.emitter.recordAudit(tx, ctx, {
      code: M27_AUDIT_CODES.subjectBound,
      entityType: 'finance_ai_subject',
      entityId: subject.id,
      detail: { subjectType: subject.subject_type },
    });
    return subject;
  }

  /**
   * Request a governed finance-AI analysis. Generation is delegated to M24 (a governance refusal there leaves the
   * analysis 'failed'); the successful analysis lands in 'review_pending' for a HUMAN reviewer — NEVER auto-accepted.
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
      idempotencyKey?: string | null;
    },
  ): Promise<AnalysisRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeAnalyze);
    if (!isSubjectType(input.subjectType)) throw badRequest('unknown subject type.', ctx.correlationId);
    if (!isAnalysisKind(input.analysisKind)) throw badRequest('unknown analysis kind.', ctx.correlationId);

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

    const gen = await this.gateway.analyze(ctx, actor, {
      subjectType: input.subjectType,
      subjectRef: subject.subject_ref,
      classification: subject.classification,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      promptId: input.promptId ?? null,
      inputSample: input.inputSample ?? '',
      outputKind: input.outputKind ?? 'recommendation',
      citationsRequired: false,
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
        code: M27_AUDIT_CODES.analysisRequested,
        entityType: 'finance_ai_analysis',
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
        await this.repo.insertModelResult(tx, {
          tenantId: ctx.tenantId,
          analysisId: analysis.id,
          aiOutputRef: gen.outputRef,
          scoreBps: gen.confidenceBps,
          anomaly: false,
          methodRef: null,
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.repo.insertAnalysisHistory(tx, {
          tenantId: ctx.tenantId,
          analysisId: analysis.id,
          fromStatus: 'requested',
          toStatus: 'review_pending',
          reason: null,
          reasonCode: REASON_CODES.analysisCompleted,
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M27_AUDIT_CODES.analysisCompleted,
          entityType: 'finance_ai_analysis',
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
        code: M27_AUDIT_CODES.analysisBlocked,
        entityType: 'finance_ai_analysis',
        entityId: analysis.id,
        detail: { reasonCode: gen.reasonCode },
      });
      return failed;
    });
  }

  /** Record an AI classification of a recon exception (advisory; opaque m15/m20 exception ref). */
  async classifyException(
    ctx: RequestContext,
    actor: string | null,
    input: {
      analysisId: string;
      exceptionRef?: string | null;
      category: string;
      confidenceBps?: number;
      reasonCode?: string | null;
    },
  ): Promise<ExceptionClassificationRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeAnalyze);
    if (!isExceptionCategory(input.category))
      throw badRequest('unknown exception category.', ctx.correlationId);
    const conf = input.confidenceBps ?? 0;
    if (!isConfidenceBps(conf))
      throw badRequest('confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const analysis = await this.repo.findAnalysis(tx, input.analysisId);
      if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
      const cls = await this.repo.insertExceptionClassification(tx, {
        tenantId: ctx.tenantId,
        analysisId: input.analysisId,
        exceptionRef: input.exceptionRef ?? null,
        category: input.category,
        confidenceBps: conf,
        reasonCode: input.reasonCode ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M27_AUDIT_CODES.exceptionClassified,
        entityType: 'finance_ai_exception_classification',
        entityId: cls.id,
        detail: { category: input.category },
      });
      return cls;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getAnalysis(
    ctx: RequestContext,
    id: string,
  ): Promise<{
    analysis: AnalysisRow;
    classifications: ExceptionClassificationRow[];
    modelResults: ModelResultRow[];
  }> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeRead);
    return this.db.withTenant(ctx, async (tx) => {
      const analysis = await this.repo.findAnalysis(tx, id);
      if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
      return { analysis, classifications: [], modelResults: [] };
    });
  }
  async listAnalyses(ctx: RequestContext, subjectId: string): Promise<AnalysisRow[]> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAnalyses(tx, subjectId));
  }
}
