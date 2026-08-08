/**
 * PlatformConfigService — governed platform CONFIGURATION: typed key definitions, values and history, plus the public
 * resolve contract other modules consume. THE SECRETS SEAM: a secret-bearing config value carries ONLY an opaque
 * `secretref:` reference (validated by `evaluateConfigValueGate`), never a value — a raw secret value is refused
 * (fail closed). Every mutation is authorized (default deny; a platform-scoped mutation additionally requires the
 * control-plane `platform.administer`) and audited through m03 in the same transaction. `resolveConfig` returns a plain
 * value or the opaque secret REFERENCE, never a resolved secret value.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M30_PERMISSIONS } from './permissions.ts';
import { M30_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import { evaluateConfigValueGate, isScope, isPlatformScope, isValueType, REASON_CODES } from './domain.ts';
import { PlatformRepository, type ConfigDefinitionRow, type ConfigValueRow } from './repository.ts';
import type { PlatformConfigResolvePort, ResolvedConfig } from './ports.ts';
import type { M30Emitter } from './emit.ts';

export class PlatformConfigService implements PlatformConfigResolvePort {
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

  /** A platform-scoped mutation requires the cross-tenant control-plane permission (a tenant admin never holds it). */
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M30_PERMISSIONS.administer);
  }

  async defineConfig(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      configKey: string;
      valueType?: string;
      secretBearing?: boolean;
      isAbsolute?: boolean;
      required?: boolean;
      description?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ConfigDefinitionRow> {
    await this.authz.require(ctx, M30_PERMISSIONS.configManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const valueType = input.valueType ?? 'text';
    if (!isValueType(valueType)) throw badRequest('unknown value type.', ctx.correlationId);
    if (input.configKey.trim() === '') throw badRequest('a config key is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findConfigDefinitionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const def = await this.repo.insertConfigDefinition(tx, {
        tenantId: ctx.tenantId,
        scope,
        configKey: input.configKey,
        valueType,
        secretBearing: input.secretBearing ?? false,
        isAbsolute: input.isAbsolute ?? false,
        required: input.required ?? false,
        description: input.description ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertConfigHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'definition',
        targetId: def.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.configDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M30_AUDIT_CODES.configDefined,
        entityType: 'platform_config_definition',
        entityId: def.id,
        detail: { scope, configKey: input.configKey, valueType, secretBearing: def.secret_bearing },
      });
      await this.emitter.publishPlatform(tx, 'ConfigDefined', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: def.id,
          recordType: 'config_definition',
          key: input.configKey,
          scope,
          valueType,
          secretBearing: def.secret_bearing,
          toStatus: 'draft',
          reasonCode: REASON_CODES.configDefined,
        },
      });
      return def;
    });
  }

  async publishConfig(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ConfigDefinitionRow> {
    await this.authz.require(ctx, M30_PERMISSIONS.configManage);
    return this.db.withTenant(ctx, async (tx) => {
      const current = await this.repo.findConfigDefinition(tx, id);
      if (current === null) throw ProblemError.notFound('Config definition not found.', ctx.correlationId);
      await this.authorizeScope(ctx, current.scope);
      const updated = await this.repo.setConfigDefinitionStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Config definition modified concurrently.', ctx.correlationId);
      await this.repo.insertConfigHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'definition',
        targetId: id,
        fromStatus: current.status,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.configPublished,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M30_AUDIT_CODES.configPublished,
        entityType: 'platform_config_definition',
        entityId: id,
        detail: { configKey: updated.config_key },
      });
      await this.emitter.publishPlatform(tx, 'ConfigPublished', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'config_definition',
          key: updated.config_key,
          scope: updated.scope,
          toStatus: 'active',
          reasonCode: REASON_CODES.configPublished,
        },
      });
      return updated;
    });
  }

  async setConfigValue(
    ctx: RequestContext,
    actor: string | null,
    definitionId: string,
    input: { scope?: string; value?: unknown; secretRef?: string | null; idempotencyKey?: string | null },
  ): Promise<ConfigValueRow> {
    await this.authz.require(ctx, M30_PERMISSIONS.configManage);
    return this.db.withTenant(ctx, async (tx) => {
      const def = await this.repo.findConfigDefinition(tx, definitionId);
      if (def === null) throw ProblemError.notFound('Config definition not found.', ctx.correlationId);
      const scope = input.scope ?? def.scope;
      if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
      await this.authorizeScope(ctx, scope);
      // THE SECRETS SEAM: a secret-bearing value is an opaque reference only; a raw secret value is refused (fail closed).
      const hasPlainValue = input.value !== undefined && input.value !== null;
      const secretRef = input.secretRef ?? null;
      const gate = evaluateConfigValueGate({ secretBearing: def.secret_bearing, hasPlainValue, secretRef });
      if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);

      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findConfigValueByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const value = await this.repo.insertConfigValue(tx, {
        tenantId: ctx.tenantId,
        definitionId,
        scope,
        valueJson: def.secret_bearing ? null : (input.value ?? null),
        secretRef: def.secret_bearing ? secretRef : null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertConfigHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'value',
        targetId: value.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.configValueSet,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M30_AUDIT_CODES.configValueSet,
        entityType: 'platform_config_value',
        entityId: value.id,
        detail: { definitionId, scope, secretBearing: def.secret_bearing },
      });
      return value;
    });
  }

  // --- public read contract (PlatformConfigResolvePort) — never returns a resolved secret value -------------------
  async resolveConfig(
    ctx: RequestContext,
    input: { scope: string; configKey: string },
  ): Promise<ResolvedConfig> {
    await this.authz.require(ctx, M30_PERMISSIONS.configRead);
    return this.db.withTenant(ctx, async (tx) => {
      const def = await this.repo.findActiveConfigDefinition(tx, input.scope, input.configKey);
      if (def === null)
        return { found: false, valueType: null, secretBearing: false, value: null, secretRef: null };
      const val = await this.repo.findActiveConfigValue(tx, def.id, input.scope);
      return {
        found: val !== null,
        valueType: def.value_type,
        secretBearing: def.secret_bearing,
        value: def.secret_bearing ? null : (val?.value_json ?? null),
        secretRef: def.secret_bearing ? (val?.secret_ref ?? null) : null,
      };
    });
  }
}
