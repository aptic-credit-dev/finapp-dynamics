/**
 * AiEvaluationService — records APPEND-ONLY evaluation EVIDENCE for a release (opaque test/eval + model/prompt/provider
 * refs; DLP/safety/citation results; accuracy basis points). It computes the pass verdict from the active policy's
 * confidence floor (`evaluatePasses`) and stamps the release's `evaluation_passed` flag — a non-waiver release can never
 * be approved without a passing evaluation (DB `ai_governance_release_evidence_ck`). No "passed" without recorded
 * evidence. Authorized (default deny) and audited.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M29_PERMISSIONS } from './permissions.ts';
import { M29_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import {
  evaluatePasses,
  isCitationResult,
  isConfidenceBps,
  isDlpResult,
  isSafetyResult,
  REASON_CODES,
} from './domain.ts';
import { AiGovernanceRepository, type EvaluationRow } from './repository.ts';
import type { M29Emitter } from './emit.ts';

export class AiEvaluationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M29Emitter;
  private readonly repo: AiGovernanceRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M29Emitter,
    repo: AiGovernanceRepository = new AiGovernanceRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async recordEvaluation(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    input: {
      evalRef?: string | null;
      modelRef?: string | null;
      promptRef?: string | null;
      providerRef?: string | null;
      classification?: string;
      dlpResult?: string;
      safetyResult?: string;
      citationResult?: string;
      accuracyBps?: number;
    },
  ): Promise<EvaluationRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceManage);
    const dlpResult = input.dlpResult ?? 'na';
    const safetyResult = input.safetyResult ?? 'na';
    const citationResult = input.citationResult ?? 'na';
    const accuracyBps = input.accuracyBps ?? 0;
    if (!isDlpResult(dlpResult) || !isSafetyResult(safetyResult) || !isCitationResult(citationResult))
      throw badRequest('unknown evaluation result.', ctx.correlationId);
    if (!isConfidenceBps(accuracyBps))
      throw badRequest('accuracy must be an integer 0..10000 basis points.', ctx.correlationId);

    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.findRelease(tx, releaseId);
      if (release === null) throw ProblemError.notFound('Release not found.', ctx.correlationId);
      const active = await this.repo.findActivePolicy(tx, 'default');
      const minConf = active?.min_confidence_bps ?? 0;
      const passed = evaluatePasses({
        dlpResult,
        safetyResult,
        citationResult,
        accuracyBps,
        minConfidenceBps: minConf,
      });

      const evaluation = await this.repo.insertEvaluation(tx, {
        tenantId: ctx.tenantId,
        releaseId,
        evalRef: input.evalRef ?? null,
        modelRef: input.modelRef ?? null,
        promptRef: input.promptRef ?? null,
        providerRef: input.providerRef ?? null,
        classification:
          input.classification ?? (release.risk_tier === 'critical' ? 'confidential' : 'internal'),
        dlpResult,
        safetyResult,
        citationResult,
        accuracyBps,
        passed,
        reasonCode: passed ? REASON_CODES.evaluationPassed : REASON_CODES.evaluationFailed,
        by: actor,
        correlationId: ctx.correlationId,
      });
      // Stamp the release's evidence flag (a non-waiver release cannot be approved without a passing evaluation).
      const updated = await this.repo.updateRelease(tx, {
        id: releaseId,
        expectedVersion: release.version,
        status: release.status,
        evaluationPassed: passed,
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Release modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.evaluationRecorded,
        entityType: 'ai_governance_evaluation',
        entityId: evaluation.id,
        detail: { releaseId, passed, accuracyBps },
      });
      return evaluation;
    });
  }

  async listEvaluations(ctx: RequestContext, releaseId: string): Promise<EvaluationRow[]> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listEvaluations(tx, releaseId));
  }
}
