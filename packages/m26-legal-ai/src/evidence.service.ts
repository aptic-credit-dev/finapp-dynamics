/**
 * LegalAiEvidenceService — records citation-backed evidence for a legal analysis. A citation preserves an M09 document
 * REFERENCE + version/hash + a bounded location (page/section/paragraph) + evidence classification + confidence — never
 * document content. Citations are scoped to their analysis' subject (single matter — no cross-matter citation). Adding
 * a citation bumps the analysis' citation count, which the review gate checks for citation-required analyses.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M26_PERMISSIONS } from './permissions.ts';
import { M26_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isCitationSourceType, isConfidenceBps, isEvidenceClassification } from './domain.ts';
import { LegalAiRepository, type CitationRow, type EvidenceRow } from './repository.ts';
import type { M26Emitter } from './emit.ts';

export class LegalAiEvidenceService {
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

  async addCitation(
    ctx: RequestContext,
    actor: string | null,
    input: {
      analysisId: string;
      sourceType?: string;
      documentRef?: string | null;
      documentVersion?: number | null;
      documentHash?: string | null;
      page?: number | null;
      section?: string | null;
      paragraphRef?: string | null;
      evidenceClassification?: string;
      confidenceBps?: number;
    },
  ): Promise<CitationRow> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalAnalyze);
    const sourceType = input.sourceType ?? 'document';
    if (!isCitationSourceType(sourceType))
      throw badRequest('unknown citation source type.', ctx.correlationId);
    const evClass = input.evidenceClassification ?? 'supporting';
    if (!isEvidenceClassification(evClass))
      throw badRequest('unknown evidence classification.', ctx.correlationId);
    const conf = input.confidenceBps ?? 0;
    if (!isConfidenceBps(conf))
      throw badRequest('confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const analysis = await this.repo.findAnalysis(tx, input.analysisId);
      if (analysis === null) throw ProblemError.notFound('Analysis not found.', ctx.correlationId);
      if (analysis.status === 'accepted' || analysis.status === 'rejected' || analysis.status === 'dismissed')
        throw badRequest('cannot cite a terminal analysis.', ctx.correlationId);
      const citation = await this.repo.insertCitation(tx, {
        tenantId: ctx.tenantId,
        analysisId: input.analysisId,
        sourceType,
        documentRef: input.documentRef ?? null,
        documentVersion: input.documentVersion ?? null,
        documentHash: input.documentHash ?? null,
        page: input.page ?? null,
        section: input.section ?? null,
        paragraphRef: input.paragraphRef ?? null,
        evidenceClassification: evClass,
        confidenceBps: conf,
        by: actor,
        correlationId: ctx.correlationId,
      });
      const count = await this.repo.countCitations(tx, input.analysisId);
      await this.repo.updateAnalysis(tx, {
        id: input.analysisId,
        expectedVersion: analysis.version,
        status: analysis.status,
        citationCount: count,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M26_AUDIT_CODES.citationLinked,
        entityType: 'legal_ai_citation',
        entityId: citation.id,
        detail: { analysisId: input.analysisId, evidenceClassification: evClass },
      });
      return citation;
    });
  }

  async addEvidence(
    ctx: RequestContext,
    actor: string | null,
    input: {
      targetType: 'analysis' | 'suggestion';
      targetId: string;
      sourceType?: string;
      sourceRef?: string | null;
      evidenceClassification?: string;
      span?: string | null;
      confidenceBps?: number;
    },
  ): Promise<EvidenceRow> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalAnalyze);
    const sourceType = input.sourceType ?? 'document';
    if (!isCitationSourceType(sourceType))
      throw badRequest('unknown evidence source type.', ctx.correlationId);
    const evClass = input.evidenceClassification ?? 'supporting';
    if (!isEvidenceClassification(evClass))
      throw badRequest('unknown evidence classification.', ctx.correlationId);
    const conf = input.confidenceBps ?? 0;
    if (!isConfidenceBps(conf))
      throw badRequest('confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const evidence = await this.repo.insertEvidence(tx, {
        tenantId: ctx.tenantId,
        targetType: input.targetType,
        targetId: input.targetId,
        sourceType,
        sourceRef: input.sourceRef ?? null,
        evidenceClassification: evClass,
        span: input.span ?? null,
        confidenceBps: conf,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M26_AUDIT_CODES.evidenceRecorded,
        entityType: 'legal_ai_evidence',
        entityId: evidence.id,
        detail: { targetType: input.targetType },
      });
      return evidence;
    });
  }

  async listCitations(ctx: RequestContext, analysisId: string): Promise<CitationRow[]> {
    await this.authz.require(ctx, M26_PERMISSIONS.legalRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCitations(tx, analysisId));
  }
}
