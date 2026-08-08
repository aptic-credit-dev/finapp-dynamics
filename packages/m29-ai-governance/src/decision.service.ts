/**
 * AiGovernanceDecisionService — the governance-evidence read + EXPORT surface. Exporting a release's decision +
 * evaluation evidence requires the privileged ai.governance.export and is audited (AI_GOVERNANCE_EXPORT_REQUESTED);
 * reading a sensitive (confidential/restricted) evaluation additionally records AI_GOVERNANCE_SENSITIVE_READ. Evidence is
 * returned by REFERENCE (opaque ids + safe metadata) — never prompts, outputs, restricted content or secrets. This
 * service performs NO mutation and NO controlled action.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M29_PERMISSIONS } from './permissions.ts';
import { M29_AUDIT_CODES } from './audit-codes.ts';
import { isSensitiveClassification } from './domain.ts';
import { AiGovernanceRepository, type EvaluationRow, type ReleaseRow } from './repository.ts';
import type { M29Emitter } from './emit.ts';

export class AiGovernanceDecisionService {
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

  async exportEvidence(
    ctx: RequestContext,
    releaseId: string,
  ): Promise<{ release: ReleaseRow; evaluations: EvaluationRow[] }> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceExport);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.findRelease(tx, releaseId);
      if (release === null) throw ProblemError.notFound('Release not found.', ctx.correlationId);
      const evaluations = await this.repo.listEvaluations(tx, releaseId);
      const sensitive = evaluations.some((e) => isSensitiveClassification(e.classification));
      if (sensitive)
        await this.emitter.recordAudit(tx, ctx, {
          code: M29_AUDIT_CODES.sensitiveRead,
          entityType: 'ai_governance_evaluation',
          entityId: releaseId,
          detail: { evaluationCount: evaluations.length },
        });
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.exportRequested,
        entityType: 'ai_governance_release',
        entityId: releaseId,
        detail: { evaluationCount: evaluations.length },
      });
      return { release, evaluations };
    });
  }
}
