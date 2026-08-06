/**
 * LegalAiAnalysisService — the governed legal-AI pipeline over M14 matters. It binds a subject by OPAQUE matter id
 * (inside privilege + ethical-wall boundaries), requests a GOVERNED analysis through the M24 gateway (submit -> process,
 * all routing/DLP/confidence in M24), records the analysis and its extracted/inferred findings. The ethical wall is
 * enforced BEFORE analysis: privileged / work-product matters require the `ai.privileged.read` entitlement (fail
 * closed), and each privileged access is audited. An analysis lands in `review_pending` for a HUMAN — it is NEVER
 * auto-accepted, and M26 never mutates the matter. An AI inference is recorded as `inferred`, never a verified fact.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M26_PERMISSIONS } from './permissions.ts';
import { M26_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  evaluateEthicalWall,
  isAnalysisKind,
  isBehindEthicalWall,
  isConfidenceBps,
  isFactStatus,
  isFindingType,
  isLegalClassification,
  isPrivilegeClassification,
  isSubjectType,
  REASON_CODES,
} from './domain.ts';
import { LegalAiRepository, type AnalysisRow, type FindingRow, type SubjectRow } from './repository.ts';
import type { AiGatewayPort } from './gateway.ts';
import type { M26Emitter } from './emit.ts';

export class LegalAiAnalysisService {
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

  private hasPrivilegedRead(ctx: RequestContext): boolean {
    return ctx.permissions.includes(M26_PERMISSIONS.privilegedRead);
  }

  /** The ethical-wall gate: privileged/work-product material requires ai.privileged.read; a crossing is audited. */
  private async enforceEthicalWall(tx: Tx, ctx: RequestContext, subject: SubjectRow): Promise<void> {
    const gate = evaluateEthicalWall({
      privilege: subject.privilege_classification,
      hasPrivilegedRead: this.hasPrivilegedRead(ctx),
    });
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    if (isBehindEthicalWall(subject.privilege_classification)) {
      await this.emitter.recordAudit(tx, ctx, {
        code: M26_AUDIT_CODES.privilegedRead,
        entityType: 'legal_ai_subject',
        entityId: subject.id,
        detail: { privilege: subject.privilege_classification },
      });
    }
  }

  async ensureSubject(
    ctx: RequestContext,
    actor: string | null,
    input: { subjectType: string; matterRef: string; classification?: string; privilege?: string },
  ): Promise<SubjectRow> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalAnalyze);
    if (!isSubjectType(input.subjectType)) throw badRequest('unknown subject type.', ctx.correlationId);
    if (input.classification !== undefined && !isLegalClassification(input.classification))
      throw badRequest('unknown classification.', ctx.correlationId);
    if (input.privilege !== undefined && !isPrivilegeClassification(input.privilege))
      throw badRequest('unknown privilege classification.', ctx.correlationId);
    return this.db.withTenant(ctx, (tx) => this.ensureSubjectTx(tx, ctx, actor, input));
  }

  private async ensureSubjectTx(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    input: { subjectType: string; matterRef: string; classification?: string; privilege?: string },
  ): Promise<SubjectRow> {
    const existing = await this.repo.findSubjectByRef(tx, input.subjectType, input.matterRef);
    if (existing !== null) {
      await this.enforceEthicalWall(tx, ctx, existing);
      return existing;
    }
    const subject = await this.repo.insertSubject(tx, {
      tenantId: ctx.tenantId,
      subjectType: input.subjectType,
      matterRef: input.matterRef,
      classification: input.classification ?? 'confidential',
      privilege: input.privilege ?? 'confidential',
      correlationId: ctx.correlationId,
      by: actor,
    });
    await this.enforceEthicalWall(tx, ctx, subject);
    await this.emitter.recordAudit(tx, ctx, {
      code: M26_AUDIT_CODES.subjectBound,
      entityType: 'legal_ai_subject',
      entityId: subject.id,
      detail: { subjectType: subject.subject_type, privilege: subject.privilege_classification },
    });
    return subject;
  }

  /**
   * Request a governed legal-AI analysis. Generation is delegated to M24 (a governance refusal there leaves the analysis
   * 'failed'); the successful analysis lands in 'review_pending' for a HUMAN legal reviewer — NEVER auto-accepted.
   */
  async requestAnalysis(
    ctx: RequestContext,
    actor: string | null,
    input: {
      subjectType: string;
      matterRef: string;
      classification?: string;
      privilege?: string;
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
    await this.authz.require(ctx, M26_PERMISSIONS.legalAnalyze);
    if (!isSubjectType(input.subjectType)) throw badRequest('unknown subject type.', ctx.correlationId);
    if (!isAnalysisKind(input.analysisKind)) throw badRequest('unknown analysis kind.', ctx.correlationId);

    const pre = await this.db.withTenant(ctx, async (tx) => {
      const subject = await this.ensureSubjectTx(tx, ctx, actor, {
        subjectType: input.subjectType,
        matterRef: input.matterRef,
        ...(input.classification !== undefined ? { classification: input.classification } : {}),
        ...(input.privilege !== undefined ? { privilege: input.privilege } : {}),
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findAnalysisByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return { subject, existing };
      }
      return { subject, existing: null as AnalysisRow | null };
    });
    if (pre.existing !== null) return pre.existing;
    const subject = pre.subject;
    const citationsRequired = input.citationsRequired ?? true;

    // Delegate generation to M24 (own transactions; never throws on a governance refusal). M24-level citations are
    // handled by M24; M26 enforces its OWN legal-citation requirement at review time.
    const gen = await this.gateway.analyze(ctx, actor, {
      subjectType: input.subjectType,
      subjectRef: subject.matter_ref,
      classification: subject.classification,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      promptId: input.promptId ?? null,
      inputSample: input.inputSample ?? '',
      outputKind: input.outputKind ?? 'summary',
      citationsRequired: false,
    });

    return this.db.withTenant(ctx, async (tx) => {
      const analysis = await this.repo.insertAnalysis(tx, {
        tenantId: ctx.tenantId,
        subjectId: subject.id,
        analysisKind: input.analysisKind,
        aiRequestRef: gen.requestRef,
        citationsRequired,
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
        code: M26_AUDIT_CODES.analysisRequested,
        entityType: 'legal_ai_analysis',
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
          reasonCode: REASON_CODES.analysisCompleted,
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M26_AUDIT_CODES.analysisCompleted,
          entityType: 'legal_ai_analysis',
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
        code: M26_AUDIT_CODES.analysisBlocked,
        entityType: 'legal_ai_analysis',
        entityId: analysis.id,
        detail: { reasonCode: gen.reasonCode },
      });
      return failed;
    });
  }

  /** Record an extracted/inferred finding on an analysis. An AI inference is `inferred`, NEVER a verified legal fact. */
  async recordFinding(
    ctx: RequestContext,
    actor: string | null,
    input: {
      analysisId: string;
      findingType: string;
      factStatus?: string;
      confidenceBps?: number;
      limitations?: string | null;
    },
  ): Promise<FindingRow> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalAnalyze);
    if (!isFindingType(input.findingType)) throw badRequest('unknown finding type.', ctx.correlationId);
    const factStatus = input.factStatus ?? 'inferred';
    if (!isFactStatus(factStatus))
      throw badRequest('a finding is extracted or inferred, never verified.', ctx.correlationId);
    const conf = input.confidenceBps ?? 0;
    if (!isConfidenceBps(conf))
      throw badRequest('confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const analysis = await this.repo.findAnalysis(tx, input.analysisId);
      if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
      const finding = await this.repo.insertFinding(tx, {
        tenantId: ctx.tenantId,
        analysisId: input.analysisId,
        findingType: input.findingType,
        factStatus,
        confidenceBps: conf,
        limitations: input.limitations ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M26_AUDIT_CODES.findingRecorded,
        entityType: 'legal_ai_finding',
        entityId: finding.id,
        detail: { findingType: input.findingType, factStatus },
      });
      return finding;
    });
  }

  // --- reads (ethical-wall enforced) ------------------------------------------------------------
  async getAnalysis(
    ctx: RequestContext,
    id: string,
  ): Promise<{ analysis: AnalysisRow; findings: FindingRow[] }> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalRead);
    return this.db.withTenant(ctx, async (tx) => {
      const analysis = await this.repo.findAnalysis(tx, id);
      if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
      const subject = await this.repo.findSubject(tx, analysis.subject_id);
      if (subject !== null) await this.enforceEthicalWall(tx, ctx, subject);
      const findings = await this.repo.listFindings(tx, id);
      return { analysis, findings };
    });
  }
  async listAnalyses(ctx: RequestContext, subjectId: string): Promise<AnalysisRow[]> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalRead);
    return this.db.withTenant(ctx, async (tx) => {
      const subject = await this.repo.findSubject(tx, subjectId);
      if (subject !== null) await this.enforceEthicalWall(tx, ctx, subject);
      return this.repo.listAnalyses(tx, subjectId);
    });
  }
}
