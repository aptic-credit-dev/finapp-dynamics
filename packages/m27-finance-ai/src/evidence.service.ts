/**
 * FinanceAiEvidenceService — records supporting evidence links for a finance-AI analysis or suggestion. Evidence holds
 * an OPAQUE M15/M20/M09 reference (bank line / GL line / statement / journal / document) + a bounded span + confidence
 * — never raw bank-statement or ledger content. M15/M20 remain the source of truth.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M27_PERMISSIONS } from './permissions.ts';
import { M27_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isConfidenceBps, isEvidenceSource } from './domain.ts';
import { FinanceAiRepository, type EvidenceRow } from './repository.ts';
import type { M27Emitter } from './emit.ts';

export class FinanceAiEvidenceService {
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

  async addEvidence(
    ctx: RequestContext,
    actor: string | null,
    input: {
      targetType: 'analysis' | 'suggestion';
      targetId: string;
      sourceType?: string;
      sourceRef?: string | null;
      span?: string | null;
      confidenceBps?: number;
    },
  ): Promise<EvidenceRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeAnalyze);
    const sourceType = input.sourceType ?? 'bank_line';
    if (!isEvidenceSource(sourceType)) throw badRequest('unknown evidence source.', ctx.correlationId);
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
        span: input.span ?? null,
        confidenceBps: conf,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M27_AUDIT_CODES.evidenceLinked,
        entityType: 'finance_ai_evidence',
        entityId: evidence.id,
        detail: { targetType: input.targetType, sourceType },
      });
      return evidence;
    });
  }
}
