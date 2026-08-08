/**
 * AiUseCaseGovernanceService — registers and governs AI USE CASES: which module/domain uses AI for what, at what
 * risk/classification, with which OPAQUE m24 provider/model/prompt refs, and whether human review + citations are
 * required. A governed use case can never permit an AI-executed controlled action (DB CHECK). Every mutation is
 * authorized (default deny), idempotency-keyed and audited; M24 assets are referenced by opaque id only.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M29_PERMISSIONS } from './permissions.ts';
import { M29_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { clampPage, isDataClassification, isDeploymentStatus, isRiskTier, REASON_CODES } from './domain.ts';
import { AiGovernanceRepository, type UseCaseRow } from './repository.ts';
import type { M29Emitter } from './emit.ts';

export class AiUseCaseGovernanceService {
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

  async registerUseCase(
    ctx: RequestContext,
    actor: string | null,
    input: {
      moduleRef: string;
      purpose?: string | null;
      classification?: string;
      riskTier?: string;
      providerRef?: string | null;
      modelRef?: string | null;
      promptRef?: string | null;
      humanReviewRequired?: boolean;
      citationRequired?: boolean;
      owner?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<UseCaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceManage);
    if (input.moduleRef.trim() === '') throw badRequest('a module reference is required.', ctx.correlationId);
    const classification = input.classification ?? 'internal';
    if (!isDataClassification(classification))
      throw badRequest('unknown data classification.', ctx.correlationId);
    const riskTier = input.riskTier ?? 'medium';
    if (!isRiskTier(riskTier)) throw badRequest('unknown risk tier.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findUseCaseByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const uc = await this.repo.insertUseCase(tx, {
        tenantId: ctx.tenantId,
        moduleRef: input.moduleRef,
        purpose: input.purpose ?? null,
        classification,
        riskTier,
        providerRef: input.providerRef ?? null,
        modelRef: input.modelRef ?? null,
        promptRef: input.promptRef ?? null,
        humanReviewRequired: input.humanReviewRequired ?? true,
        citationRequired: input.citationRequired ?? false,
        owner: input.owner ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.useCaseRegistered,
        entityType: 'ai_governance_use_case',
        entityId: uc.id,
        detail: { moduleRef: input.moduleRef, classification, riskTier },
      });
      await this.emitter.publishGovernance(tx, {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: uc.id,
          recordType: 'use_case',
          moduleRef: input.moduleRef,
          classification,
          toStatus: uc.deployment_status,
          reasonCode: REASON_CODES.useCaseRegistered,
        },
      });
      return uc;
    });
  }

  async setDeploymentStatus(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    deploymentStatus: string,
  ): Promise<UseCaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceApprove);
    if (!isDeploymentStatus(deploymentStatus))
      throw badRequest('unknown deployment status.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.setUseCaseDeployment(tx, {
        id,
        expectedVersion,
        deploymentStatus,
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Use case modified concurrently.', ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'use_case',
        targetId: id,
        fromStatus: null,
        toStatus: deploymentStatus,
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      return updated;
    });
  }

  async getUseCase(ctx: RequestContext, id: string): Promise<UseCaseRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceRead);
    const uc = await this.db.withTenant(ctx, (tx) => this.repo.findUseCase(tx, id));
    if (uc === null) throw ProblemError.notFound('Use case not found.', ctx.correlationId);
    return uc;
  }

  async listUseCases(ctx: RequestContext, page: { limit?: number; offset?: number }): Promise<UseCaseRow[]> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceRead);
    const p = clampPage(page.limit, page.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listUseCases(tx, p.limit, p.offset));
  }
}
