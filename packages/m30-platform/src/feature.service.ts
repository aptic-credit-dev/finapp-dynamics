/**
 * PlatformFeatureService — the ONE feature-flag engine (GAP-5, ADR-115): typed definitions, tenant assignments,
 * deterministic evaluation and history, plus the public evaluation contract other modules consume. TWO HARD RULES: a
 * platform-ABSOLUTE flag can NEVER be weakened by a tenant assignment (`evaluateAbsoluteAssignmentGate` — the assignment
 * is refused and audited `PLATFORM_FEATURE_OVERRIDE_BLOCKED`), and a feature flag is NEVER an authorization substitute —
 * `isFeatureEnabled` authorizes `platform.feature.read` and returns only enabled/disabled; a flag can never grant a
 * permission RBAC (m02) denies (RBAC stays authoritative; the caller must still hold the permission for whatever the
 * flag gates). Every mutation is authorized (default deny; platform scope needs `platform.administer`) and audited.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M30_PERMISSIONS } from './permissions.ts';
import { M30_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  evaluateAbsoluteAssignmentGate,
  evaluateFeature,
  isScope,
  isPlatformScope,
  REASON_CODES,
} from './domain.ts';
import { PlatformRepository, type FeatureAssignmentRow, type FeatureDefinitionRow } from './repository.ts';
import type { PlatformFeatureEvaluatePort } from './ports.ts';
import type { M30Emitter } from './emit.ts';

export class PlatformFeatureService implements PlatformFeatureEvaluatePort {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M30Emitter;
  private readonly repo: PlatformRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M30Emitter,
    repo: PlatformRepository = new PlatformRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M30_PERMISSIONS.administer);
  }

  async defineFeature(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      featureKey: string;
      description?: string | null;
      defaultEnabled?: boolean;
      isAbsolute?: boolean;
      idempotencyKey?: string | null;
    },
  ): Promise<FeatureDefinitionRow> {
    await this.authz.require(ctx, M30_PERMISSIONS.featureManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (input.featureKey.trim() === '') throw badRequest('a feature key is required.', ctx.correlationId);
    // A platform-absolute flag is a control-plane control — defining one requires the control-plane permission.
    if (input.isAbsolute === true) await this.authz.require(ctx, M30_PERMISSIONS.administer);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findFeatureDefinitionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const def = await this.repo.insertFeatureDefinition(tx, {
        tenantId: ctx.tenantId,
        scope,
        featureKey: input.featureKey,
        description: input.description ?? null,
        defaultEnabled: input.defaultEnabled ?? false,
        isAbsolute: input.isAbsolute ?? false,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertFeatureHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'definition',
        targetId: def.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.featureDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M30_AUDIT_CODES.featureDefined,
        entityType: 'platform_feature_definition',
        entityId: def.id,
        detail: { scope, featureKey: input.featureKey, isAbsolute: def.is_absolute },
      });
      await this.emitter.publishPlatform(tx, 'FeatureDefined', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: def.id,
          recordType: 'feature_definition',
          key: input.featureKey,
          scope,
          isAbsolute: def.is_absolute,
          toStatus: 'active',
          reasonCode: REASON_CODES.featureDefined,
        },
      });
      return def;
    });
  }

  async assignFeature(
    ctx: RequestContext,
    actor: string | null,
    definitionId: string,
    input: { scope?: string; enabled: boolean; reasonCode?: string | null; idempotencyKey?: string | null },
  ): Promise<FeatureAssignmentRow> {
    await this.authz.require(ctx, M30_PERMISSIONS.featureManage);
    return this.db.withTenant(ctx, async (tx) => {
      const def = await this.repo.findFeatureDefinition(tx, definitionId);
      if (def === null) throw ProblemError.notFound('Feature definition not found.', ctx.correlationId);
      const scope = input.scope ?? 'tenant';
      if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
      await this.authorizeScope(ctx, scope);
      // ABSOLUTE control: a tenant assignment can never weaken/override a platform-absolute flag (fail closed).
      const gate = evaluateAbsoluteAssignmentGate(def.is_absolute);
      if (!gate.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M30_AUDIT_CODES.configAbsoluteBlocked,
          entityType: 'platform_feature_definition',
          entityId: definitionId,
          detail: { featureKey: def.feature_key, reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findFeatureAssignmentByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const assignment = await this.repo.insertFeatureAssignment(tx, {
        tenantId: ctx.tenantId,
        definitionId,
        scope,
        enabled: input.enabled,
        reasonCode: input.reasonCode ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertFeatureHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'assignment',
        targetId: assignment.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.featureAssigned,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M30_AUDIT_CODES.featureAssigned,
        entityType: 'platform_feature_assignment',
        entityId: assignment.id,
        detail: { definitionId, scope, enabled: input.enabled },
      });
      await this.emitter.publishPlatform(tx, 'FeatureAssigned', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: assignment.id,
          recordType: 'feature_assignment',
          key: def.feature_key,
          scope,
          enabled: input.enabled,
          reasonCode: REASON_CODES.featureAssigned,
        },
      });
      return assignment;
    });
  }

  // --- public evaluation contract (PlatformFeatureEvaluatePort) — NEVER an authorization substitute --------------
  async isFeatureEnabled(
    ctx: RequestContext,
    input: { scope: string; featureKey: string },
  ): Promise<boolean> {
    // A flag is not an authz decision: reading it requires only platform.feature.read; it grants no other authority.
    await this.authz.require(ctx, M30_PERMISSIONS.featureRead);
    return this.db.withTenant(ctx, async (tx) => {
      const def = await this.repo.findActiveFeatureDefinition(tx, input.scope, input.featureKey);
      if (def === null) return false; // unknown feature => disabled (default deny)
      const assignment = def.is_absolute
        ? null
        : await this.repo.findActiveFeatureAssignment(tx, def.id, input.scope);
      return evaluateFeature({
        defaultEnabled: def.default_enabled,
        isAbsolute: def.is_absolute,
        assignmentEnabled: assignment?.enabled ?? null,
      });
    });
  }
}
