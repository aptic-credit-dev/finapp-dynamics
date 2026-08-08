/**
 * AiGovernancePolicyService — the versioned AI-governance policy (one active per scope; idempotency-keyed). Human
 * approval + evaluation are always required and a restricted provider can never be blanket-allowed (DB CHECKs) — AI
 * governance is human-decided, fail closed. Every mutation is authorized (default deny) and audited through m03 in the
 * same transaction.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M29_PERMISSIONS } from './permissions.ts';
import { M29_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isConfidenceBps, REASON_CODES } from './domain.ts';
import { AiGovernanceRepository, type PolicyRow } from './repository.ts';
import type { M29Emitter } from './emit.ts';

export class AiGovernancePolicyService {
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

  async createPolicy(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      name?: string | null;
      minConfidenceBps?: number;
      idempotencyKey?: string | null;
    },
  ): Promise<PolicyRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceManage);
    const minConf = input.minConfidenceBps ?? 0;
    if (!isConfidenceBps(minConf))
      throw badRequest('min confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findPolicyByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      return this.repo.insertPolicy(tx, {
        tenantId: ctx.tenantId,
        scope: input.scope ?? 'default',
        name: input.name ?? null,
        minConfidenceBps: minConf,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
    });
  }

  async publishPolicy(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<PolicyRow> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceManage);
    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.setPolicyStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Policy modified concurrently.', ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'policy',
        targetId: id,
        fromStatus: 'draft',
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.policyPublished,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M29_AUDIT_CODES.policyPublished,
        entityType: 'ai_governance_policy',
        entityId: id,
        detail: { scope: updated.scope, status: updated.status },
      });
      await this.emitter.publishGovernance(tx, {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'policy',
          toStatus: 'active',
          reasonCode: REASON_CODES.policyPublished,
        },
      });
      return updated;
    });
  }

  async listPolicies(ctx: RequestContext): Promise<PolicyRow[]> {
    await this.authz.require(ctx, M29_PERMISSIONS.governanceRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPolicies(tx));
  }

  /** Effective active-policy thresholds for a scope, or fail-closed defaults (human approval + evaluation always on). */
  async effectivePolicy(
    ctx: RequestContext,
    scope: string,
  ): Promise<{ minConfidenceBps: number; allowRestrictedProvider: boolean }> {
    return this.db.withTenant(ctx, async (tx) => {
      const active = await this.repo.findActivePolicy(tx, scope);
      return { minConfidenceBps: active?.min_confidence_bps ?? 0, allowRestrictedProvider: false };
    });
  }
}
