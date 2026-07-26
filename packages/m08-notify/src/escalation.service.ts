/**
 * EscalationService — escalation policy authoring/lifecycle and escalation instances (prompt §E8/§E12/§E13).
 *
 * A policy is a versioned, immutable-after-publish ladder (escalation_policy, single-table version model,
 * ADR-043). Instances run against an ACTIVE policy: opened idempotently per originating event, advanced
 * level-by-level under a compare-and-set LEASE (one worker wins), acknowledged, resolved, or cancelled — each a
 * permissioned, audited, event-emitting transition through the PURE `checkEscalationTransition` /
 * `nextEscalation` choke points. Advancement is bounded (no infinite escalation); processing is idempotent and
 * concurrency-safe.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M08_PERMISSIONS } from './permissions.ts';
import { M08_AUDIT_CODES } from './audit-codes.ts';
import { checkEscalationTransition, isEscalationTerminal } from './domain/lifecycles.ts';
import { validateEscalationSpec, nextEscalation, type EscalationPolicySpec } from './domain/escalation.ts';
import { contentHashOf } from './hash.ts';
import { NotifyRepository, type EscalationInstanceRow, type EscalationPolicyRow } from './repository.ts';
import type { M08Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

function specCode(spec: unknown): string | null {
  if (typeof spec === 'object' && spec !== null && 'code' in spec) {
    const c = (spec as Record<string, unknown>)['code'];
    return typeof c === 'string' ? c : null;
  }
  return null;
}

export class EscalationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M08Emitter;
  private readonly repo: NotifyRepository;
  private readonly leaseSeconds: number;

  constructor(
    db: Db,
    authz: Authz,
    emitter: M08Emitter,
    repo: NotifyRepository = new NotifyRepository(),
    leaseSeconds = 120,
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.leaseSeconds = leaseSeconds;
  }

  // --- policy authoring -------------------------------------------------------------------------
  /** Create a DRAFT escalation policy (version 1) from a spec. */
  async createPolicy(
    ctx: RequestContext,
    actor: string | null,
    input: { key: string; name: string; scope?: string; spec: unknown },
  ): Promise<EscalationPolicyRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.escalationManage);
    if (specCode(input.spec) !== input.key)
      throw badRequest('spec.code must equal the policy key', ctx.correlationId);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform')
      throw badRequest("scope must be 'tenant' or 'platform'", ctx.correlationId);
    if (scope === 'platform') await this.authz.require(ctx, M08_PERMISSIONS.platformAdminister);
    return this.db.withTenant(ctx, async (tx) => {
      const next = await this.repo.nextPolicyVersion(tx, input.key);
      const policy = await this.repo.insertPolicy(tx, {
        tenantId: ctx.tenantId,
        key: input.key,
        versionNumber: next,
        name: input.name,
        scope,
        spec: input.spec,
        createdBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.escalationPolicyCreated,
        entityType: 'escalation_policy',
        entityId: policy.id,
        detail: { key: input.key, versionNumber: next },
      });
      return policy;
    });
  }

  private async policyTransition(
    ctx: RequestContext,
    actor: string | null,
    policyId: string,
    expectedVersion: number,
    action: 'validate' | 'publish' | 'activate' | 'retire',
    auditCode: string,
  ): Promise<EscalationPolicyRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.escalationManage);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.findPolicy(tx, policyId);
      if (policy === null) throw ProblemError.notFound('Escalation policy not found.', ctx.correlationId);

      if (action === 'validate') {
        const result = validateEscalationSpec(policy.spec);
        if (!result.ok)
          throw badRequest(
            `escalation policy invalid (${String(result.errors.length)} problems)`,
            ctx.correlationId,
          );
      }
      const target = { validate: 'VALIDATED', publish: 'PUBLISHED', activate: 'ACTIVE', retire: 'RETIRED' }[
        action
      ];
      const from = policy.status;
      const allowed: Record<string, string[]> = {
        DRAFT: ['VALIDATED'],
        VALIDATED: ['PUBLISHED', 'DRAFT'],
        PUBLISHED: ['ACTIVE', 'RETIRED'],
        ACTIVE: ['RETIRED'],
        RETIRED: ['ARCHIVED'],
        ARCHIVED: [],
      };
      if (!(allowed[from] ?? []).includes(target))
        throw ProblemError.conflict(`Invalid policy transition ${from} -> ${target}.`, ctx.correlationId);

      const contentHash = action === 'publish' ? contentHashOf(policy.spec) : null;
      const updated = await this.repo.updatePolicyStatus(tx, {
        id: policyId,
        expectedVersion,
        toStatus: target,
        contentHash,
        publishedBy: action === 'publish' ? actor : null,
      });
      if (updated === null)
        throw ProblemError.conflict('Policy was modified concurrently (stale version).', ctx.correlationId);
      if (action === 'activate') await this.repo.retireActivePolicies(tx, updated.key, policyId);

      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'escalation_policy',
        entityId: policyId,
        detail: { toStatus: target },
      });
      return updated;
    });
  }

  validatePolicy(ctx: RequestContext, actor: string | null, id: string, v: number) {
    return this.policyTransition(ctx, actor, id, v, 'validate', M08_AUDIT_CODES.escalationPolicyUpdated);
  }
  publishPolicy(ctx: RequestContext, actor: string | null, id: string, v: number) {
    return this.policyTransition(ctx, actor, id, v, 'publish', M08_AUDIT_CODES.escalationPolicyUpdated);
  }
  activatePolicy(ctx: RequestContext, actor: string | null, id: string, v: number) {
    return this.policyTransition(ctx, actor, id, v, 'activate', M08_AUDIT_CODES.escalationPolicyUpdated);
  }
  retirePolicy(ctx: RequestContext, actor: string | null, id: string, v: number) {
    return this.policyTransition(ctx, actor, id, v, 'retire', M08_AUDIT_CODES.escalationPolicyUpdated);
  }

  // --- instances --------------------------------------------------------------------------------
  /** Open an escalation against the active policy for `policyKey`. Idempotent per idempotencyKey. */
  async open(
    ctx: RequestContext,
    actor: string | null,
    input: {
      policyKey: string;
      originModule?: string | null;
      originEntityType?: string | null;
      originEntityId?: string | null;
      idempotencyKey?: string | null;
      causationId?: string | null;
    },
  ): Promise<EscalationInstanceRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.escalationManage);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.findActivePolicyByKey(tx, input.policyKey);
      if (policy === null)
        throw ProblemError.conflict('No active escalation policy for that key.', ctx.correlationId);

      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findInstanceByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }

      const spec = policy.spec as EscalationPolicySpec;
      const step = nextEscalation(spec, 0);
      const nextAt = step.advance ? new Date(Date.now() + step.delayMs).toISOString() : null;

      const instance = await this.repo.insertInstance(tx, {
        tenantId: ctx.tenantId,
        policyId: policy.id,
        originModule: input.originModule ?? null,
        originEntityType: input.originEntityType ?? null,
        originEntityId: input.originEntityId ?? null,
        status: 'active',
        nextEscalationAt: nextAt,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        causationId: input.causationId ?? null,
        createdBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.escalationActivated,
        entityType: 'escalation_instance',
        entityId: instance.id,
        detail: { policyKey: input.policyKey },
      });
      await this.emitter.publish(tx, {
        type: 'EscalationCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          id: instance.id,
          policyId: policy.id,
          level: 0,
          status: 'active',
          ...(input.originModule != null ? { originModule: input.originModule } : {}),
        },
      });
      return instance;
    });
  }

  /**
   * Advance a due escalation instance to its next level under a lease (worker-safe). Fires the next level (via
   * the emitted event; downstream notification fan-out is wired by the caller), computes the next due time, or
   * marks the ladder exhausted. Idempotent under contention — only the lease winner advances.
   */
  async advance(
    ctx: RequestContext,
    workerId: string,
    instanceId: string,
    actor: string | null = null,
  ): Promise<{ advanced: boolean; instance?: EscalationInstanceRow }> {
    return this.db.withTenant(ctx, async (tx) => {
      const claim = await this.repo.claimInstance(tx, instanceId, workerId, this.leaseSeconds);
      if (claim === null) return { advanced: false };
      const policy = await this.repo.findPolicy(tx, claim.policy_id);
      if (policy === null) throw ProblemError.notFound('Escalation policy not found.', ctx.correlationId);
      const spec = policy.spec as EscalationPolicySpec;
      const step = nextEscalation(spec, claim.current_level);

      if (step.exhausted) {
        const updated = await this.repo.updateInstance(tx, {
          id: instanceId,
          expectedVersion: claim.version,
          toStatus: 'exhausted',
          nextEscalationAt: null,
          clearLease: true,
          updatedBy: actor,
        });
        if (updated === null)
          throw ProblemError.conflict('Instance changed concurrently.', ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M08_AUDIT_CODES.escalationAdvanced,
          entityType: 'escalation_instance',
          entityId: instanceId,
          detail: { exhausted: true },
        });
        return { advanced: true, instance: updated };
      }

      const newLevel = step.advance ? step.nextLevel : claim.current_level;
      const nextStep = nextEscalation(spec, newLevel);
      const nextAt =
        nextStep.exhausted && nextStep.delayMs === 0
          ? null
          : new Date(Date.now() + nextStep.delayMs).toISOString();
      const updated = await this.repo.updateInstance(tx, {
        id: instanceId,
        expectedVersion: claim.version,
        toStatus: 'active',
        currentLevel: newLevel,
        nextEscalationAt: nextAt,
        clearLease: true,
        updatedBy: actor,
      });
      if (updated === null) throw ProblemError.conflict('Instance changed concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.escalationAdvanced,
        entityType: 'escalation_instance',
        entityId: instanceId,
        detail: { level: newLevel },
      });
      await this.emitter.publish(tx, {
        type: 'EscalationAdvanced',
        tenantId: ctx.tenantId,
        correlationId: claim.correlation_id,
        ...(actor !== null ? { actor } : {}),
        payload: { id: instanceId, policyId: policy.id, level: newLevel, status: 'active' },
      });
      return { advanced: true, instance: updated };
    });
  }

  private async instanceTransition(
    ctx: RequestContext,
    actor: string | null,
    instanceId: string,
    expectedVersion: number,
    to: 'acknowledged' | 'resolved' | 'cancelled',
    permission: string,
    auditCode: string,
    eventType: 'EscalationAcknowledged' | 'EscalationResolved' | 'EscalationCancelled',
    extra: { resolution?: string | null; reason?: string | null; actorId?: string | null },
  ): Promise<EscalationInstanceRow> {
    await this.authz.require(ctx, permission);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findInstance(tx, instanceId);
      if (existing === null) throw ProblemError.notFound('Escalation not found.', ctx.correlationId);
      if (isEscalationTerminal(existing.status))
        throw ProblemError.conflict(`Escalation is ${existing.status}.`, ctx.correlationId);
      const check = checkEscalationTransition(existing.status, to);
      if (!check.ok)
        throw ProblemError.conflict(
          `Invalid escalation transition: ${check.reason ?? ''}`,
          ctx.correlationId,
        );

      const updated = await this.repo.updateInstance(tx, {
        id: instanceId,
        expectedVersion,
        toStatus: to,
        nextEscalationAt: null,
        acknowledgedBy: to === 'acknowledged' ? (extra.actorId ?? null) : null,
        resolvedBy: to === 'resolved' ? (extra.actorId ?? null) : null,
        resolution: extra.resolution ?? extra.reason ?? null,
        clearLease: true,
        updatedBy: actor,
      });
      if (updated === null)
        throw ProblemError.conflict(
          'Escalation was modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'escalation_instance',
        entityId: instanceId,
        ...(extra.reason != null ? { reason: extra.reason } : {}),
        detail: { fromStatus: existing.status, toStatus: to },
      });
      await this.emitter.publish(tx, {
        type: eventType,
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { id: instanceId, policyId: existing.policy_id, level: existing.current_level, status: to },
      });
      return updated;
    });
  }

  acknowledge(ctx: RequestContext, actor: string | null, id: string, v: number) {
    return this.instanceTransition(
      ctx,
      actor,
      id,
      v,
      'acknowledged',
      M08_PERMISSIONS.escalationAcknowledge,
      M08_AUDIT_CODES.escalationAcknowledged,
      'EscalationAcknowledged',
      { actorId: actor },
    );
  }
  resolve(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    v: number,
    resolution: string | null = null,
  ) {
    return this.instanceTransition(
      ctx,
      actor,
      id,
      v,
      'resolved',
      M08_PERMISSIONS.escalationResolve,
      M08_AUDIT_CODES.escalationResolved,
      'EscalationResolved',
      { resolution, actorId: actor },
    );
  }
  cancel(ctx: RequestContext, actor: string | null, id: string, v: number, reason: string | null = null) {
    return this.instanceTransition(
      ctx,
      actor,
      id,
      v,
      'cancelled',
      M08_PERMISSIONS.escalationManage,
      M08_AUDIT_CODES.escalationCancelled,
      'EscalationCancelled',
      { reason },
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  async getPolicy(ctx: RequestContext, id: string): Promise<EscalationPolicyRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.escalationView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findPolicy(tx, id));
    if (row === null) throw ProblemError.notFound('Escalation policy not found.', ctx.correlationId);
    return row;
  }
  async listPolicies(ctx: RequestContext): Promise<EscalationPolicyRow[]> {
    await this.authz.require(ctx, M08_PERMISSIONS.escalationView);
    return this.db.withTenant(ctx, (tx) => this.repo.listPolicies(tx));
  }
  async getInstance(ctx: RequestContext, id: string): Promise<EscalationInstanceRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.escalationView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findInstance(tx, id));
    if (row === null) throw ProblemError.notFound('Escalation not found.', ctx.correlationId);
    return row;
  }
  async listInstances(ctx: RequestContext, limit = 50, offset = 0): Promise<EscalationInstanceRow[]> {
    await this.authz.require(ctx, M08_PERMISSIONS.escalationView);
    return this.db.withTenant(ctx, (tx) => this.repo.listInstances(tx, Math.min(limit, 200), offset));
  }
}
