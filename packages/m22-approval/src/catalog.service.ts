/**
 * CatalogService — manages the configurable, VERSIONED reference data of the approval engine: approval policies (+ their
 * ordered steps), engine config, and the reason-code registry. Policies and config are immutable-after-publish (a
 * change = a new version); publishing supersedes the prior active version so there is exactly ONE active policy per
 * (subject_type, scope) and ONE active config per scope. Every mutation is authorized (default deny), audited, and —
 * for publish — emits `approval.lifecycle`. m22 never approves here; this is only the rulebook the request/decision
 * services enforce.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M22_PERMISSIONS } from './permissions.ts';
import { M22_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { checkSpecTransition, isSpecFrozen } from './domain/lifecycles.ts';
import { isSodMode, isEscalationMode, M22_LIMITS } from './domain/vocab.ts';
import {
  ApprovalRepository,
  type ApprovalPolicyRow,
  type ApprovalPolicyStepRow,
  type ApprovalConfigRow,
  type ApprovalReasonCodeRow,
} from './repository.ts';
import type { M22Emitter } from './emit.ts';

export class CatalogService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M22Emitter;
  private readonly repo: ApprovalRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M22Emitter,
    repo: ApprovalRepository = new ApprovalRepository(),
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
      subjectType: string;
      scope?: string;
      name?: string | null;
      requiredApprovals?: number;
      minLevels?: number;
      sodMode?: string;
      escalationEnabled?: boolean;
      thresholdMinor?: number;
      steps?: {
        level: number;
        requiredPermission?: string | null;
        sodConstraint?: string;
        escalationAfterSeconds?: number | null;
        escalationTarget?: string | null;
        escalationMode?: string;
      }[];
    },
  ): Promise<{ policy: ApprovalPolicyRow; steps: ApprovalPolicyStepRow[] }> {
    await this.authz.require(ctx, M22_PERMISSIONS.policyManage);
    const sodMode = input.sodMode ?? 'strict';
    if (!isSodMode(sodMode)) throw badRequest('unknown SoD mode.', ctx.correlationId);
    const requiredApprovals = input.requiredApprovals ?? 1;
    if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1)
      throw badRequest('requiredApprovals must be a positive integer.', ctx.correlationId);
    const steps = input.steps ?? [];
    if (steps.length > M22_LIMITS.maxStepsPerRequest)
      throw badRequest('too many policy steps.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.insertPolicy(tx, {
        tenantId: ctx.tenantId,
        subjectType: input.subjectType,
        scope: input.scope ?? 'default',
        name: input.name ?? null,
        requiredApprovals,
        minLevels: input.minLevels ?? 1,
        sodMode,
        escalationEnabled: input.escalationEnabled ?? true,
        thresholdMinor: input.thresholdMinor ?? 0,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const stepRows: ApprovalPolicyStepRow[] = [];
      for (const s of steps) {
        const mode = s.escalationMode ?? 'notify_only';
        if (!isEscalationMode(mode)) throw badRequest('unknown escalation mode.', ctx.correlationId);
        stepRows.push(
          await this.repo.insertPolicyStep(tx, {
            tenantId: ctx.tenantId,
            policyId: policy.id,
            level: s.level,
            requiredPermission: s.requiredPermission ?? null,
            sodConstraint: s.sodConstraint ?? 'maker_checker',
            escalationAfterSeconds: s.escalationAfterSeconds ?? null,
            escalationTarget: s.escalationTarget ?? null,
            escalationMode: mode,
            correlationId: ctx.correlationId,
            by: actor,
          }),
        );
      }
      await this.repo.insertPolicyHistory(tx, {
        tenantId: ctx.tenantId,
        policyId: policy.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.policyCreated,
        entityType: 'approval_policy',
        entityId: policy.id,
        detail: { subjectType: policy.subject_type, scope: policy.scope },
      });
      return { policy, steps: stepRows };
    });
  }

  /** Publish a draft policy to active, superseding the prior active version for the same (subject_type, scope). */
  async publishPolicy(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ApprovalPolicyRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.policyPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.findPolicy(tx, id);
      if (policy === null) throw ProblemError.notFound('Policy not found.', ctx.correlationId);
      const t = checkSpecTransition(policy.status, 'active');
      if (!t.ok) throw badRequest(`A ${policy.status} policy cannot be published.`, ctx.correlationId);
      const prior = await this.repo.findActivePolicy(tx, policy.subject_type, policy.scope);
      if (prior !== null && prior.id !== policy.id) {
        const superseded = await this.repo.setPolicyStatus(tx, {
          id: prior.id,
          expectedVersion: prior.version,
          status: 'superseded',
          by: actor,
        });
        if (superseded === null)
          throw ProblemError.conflict('Prior active policy changed concurrently.', ctx.correlationId);
        await this.repo.insertPolicyHistory(tx, {
          tenantId: ctx.tenantId,
          policyId: prior.id,
          fromStatus: 'active',
          toStatus: 'superseded',
          reason: null,
          reasonCode: null,
          by: actor,
          correlationId: ctx.correlationId,
        });
      }
      const updated = await this.repo.setPolicyStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Policy modified concurrently.', ctx.correlationId);
      await this.repo.insertPolicyHistory(tx, {
        tenantId: ctx.tenantId,
        policyId: id,
        fromStatus: policy.status,
        toStatus: 'active',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.policyPublished,
        entityType: 'approval_policy',
        entityId: id,
        detail: { subjectType: updated.subject_type, scope: updated.scope },
      });
      await this.emitter.publish(tx, {
        type: 'PolicyPublished',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'policy',
          policyRef: id,
          subjectType: updated.subject_type,
          fromStatus: policy.status,
          toStatus: 'active',
          requiredApprovals: updated.required_approvals,
        },
      });
      return updated;
    });
  }

  async getPolicy(
    ctx: RequestContext,
    id: string,
  ): Promise<{ policy: ApprovalPolicyRow; steps: ApprovalPolicyStepRow[] }> {
    await this.authz.require(ctx, M22_PERMISSIONS.policyRead);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.findPolicy(tx, id);
      if (policy === null) throw ProblemError.notFound('Policy not found.', ctx.correlationId);
      const steps = await this.repo.listPolicySteps(tx, id);
      return { policy, steps };
    });
  }
  async listPolicies(ctx: RequestContext): Promise<ApprovalPolicyRow[]> {
    await this.authz.require(ctx, M22_PERMISSIONS.policyRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPolicies(tx));
  }

  // --- config ---------------------------------------------------------------------------------
  async createConfig(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      name?: string | null;
      maxEscalationDepth?: number;
      contentHash?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ApprovalConfigRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.configManage);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findConfigByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing; // idempotent create
      }
      const cfg = await this.repo.insertConfig(tx, {
        tenantId: ctx.tenantId,
        scope: input.scope ?? 'default',
        name: input.name ?? null,
        maxEscalationDepth: input.maxEscalationDepth ?? 10,
        contentHash: input.contentHash ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.configCreated,
        entityType: 'approval_config',
        entityId: cfg.id,
        detail: { scope: cfg.scope },
      });
      return cfg;
    });
  }
  async publishConfig(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ApprovalConfigRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.configPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const cfg = await this.repo.findConfig(tx, id);
      if (cfg === null) throw ProblemError.notFound('Config not found.', ctx.correlationId);
      if (isSpecFrozen(cfg.status))
        throw badRequest(`A ${cfg.status} config cannot be published.`, ctx.correlationId);
      const updated = await this.repo.setConfigStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Config modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.configPublished,
        entityType: 'approval_config',
        entityId: id,
        detail: { scope: updated.scope },
      });
      return updated;
    });
  }
  async listConfigs(ctx: RequestContext): Promise<ApprovalConfigRow[]> {
    await this.authz.require(ctx, M22_PERMISSIONS.configRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listConfigs(tx));
  }

  // --- reason codes ---------------------------------------------------------------------------
  async registerReasonCode(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; category?: string; severity?: string; description?: string | null },
  ): Promise<ApprovalReasonCodeRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.reasonCodeManage);
    if (input.code.trim() === '') throw badRequest('a reason code is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertReasonCode(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        category: input.category ?? 'lifecycle',
        severity: input.severity ?? 'error',
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.reasonCodeRegistered,
        entityType: 'approval_reason_code',
        entityId: row.id,
        detail: { code: row.code },
      });
      return row;
    });
  }
  async listReasonCodes(ctx: RequestContext): Promise<ApprovalReasonCodeRow[]> {
    await this.authz.require(ctx, M22_PERMISSIONS.reasonCodeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listReasonCodes(tx));
  }
}
