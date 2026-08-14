/**
 * ArtifactService — the governed integration ARTIFACTS + target ENVIRONMENTS. An artifact is an OPAQUE reference (kind, ref)
 * to a record owned by m33/m34/m35/m36; m37 reads no owning-module table. Registering/retiring an artifact and defining an
 * environment authorize a `govrelease.*` permission (default deny) and are audited through m03 in the same transaction.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M37_PERMISSIONS } from './permissions.ts';
import { M37_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, versionConflict } from './errors.ts';
import { isScope, isPlatformScope, isArtifactKind, clampPage, REASON_CODES } from './domain.ts';
import { GovreleaseRepository, type ArtifactRow, type EnvironmentRow } from './repository.ts';
import type { M37Emitter } from './emit.ts';

export class ArtifactService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M37Emitter;
  private readonly repo: GovreleaseRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M37Emitter,
    repo: GovreleaseRepository = new GovreleaseRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M37_PERMISSIONS.administer);
  }

  async registerArtifact(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      artifactKey: string;
      artifactKind: string;
      artifactRef: string;
      name: string;
      idempotencyKey?: string | null;
    },
  ): Promise<ArtifactRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.artifactManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (!isArtifactKind(input.artifactKind)) throw badRequest('unknown artifact kind.', ctx.correlationId);
    if (input.artifactKey.trim() === '' || input.artifactRef.trim() === '' || input.name.trim() === '')
      throw badRequest('an artifact key, reference and name are required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findArtifactByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const artifact = await this.repo.insertArtifact(tx, {
        tenantId: ctx.tenantId,
        scope,
        artifactKey: input.artifactKey,
        artifactKind: input.artifactKind,
        artifactRef: input.artifactRef,
        name: input.name,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'artifact',
        targetId: artifact.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.artifactRegistered,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.artifactRegistered,
        entityType: 'govrelease_artifact',
        entityId: artifact.id,
        detail: { artifactKey: input.artifactKey, artifactKind: input.artifactKind, scope },
      });
      return artifact;
    });
  }

  async retireArtifact(ctx: RequestContext, actor: string | null, artifactId: string): Promise<ArtifactRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.artifactManage);
    return this.db.withTenant(ctx, async (tx) => {
      const artifact = await this.repo.getArtifact(tx, artifactId);
      if (artifact === null) throw badRequest('unknown artifact.', ctx.correlationId);
      if (artifact.status !== 'active')
        throw badRequest('only an active artifact can be retired.', ctx.correlationId);
      const moved = await this.repo.updateArtifactStatus(tx, artifactId, artifact.version, {
        status: 'retired',
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'artifact',
        targetId: artifactId,
        fromStatus: 'active',
        toStatus: 'retired',
        reason: null,
        reasonCode: REASON_CODES.artifactRetired,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.artifactRetired,
        entityType: 'govrelease_artifact',
        entityId: artifactId,
        detail: {},
      });
      await this.emitter.publishGovrelease(tx, 'ArtifactRetired', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: artifactId,
          recordType: 'artifact',
          toStatus: 'retired',
          reasonCode: REASON_CODES.artifactRetired,
        },
      });
      return moved;
    });
  }

  async defineEnvironment(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      envKey: string;
      tier?: number;
      requiresApproval?: boolean;
      idempotencyKey?: string | null;
    },
  ): Promise<EnvironmentRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.artifactManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (input.envKey.trim() === '') throw badRequest('an environment key is required.', ctx.correlationId);
    const tier = input.tier ?? 0;
    if (!Number.isInteger(tier) || tier < 0)
      throw badRequest('tier must be a non-negative integer.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findEnvironmentByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const env = await this.repo.insertEnvironment(tx, {
        tenantId: ctx.tenantId,
        scope,
        envKey: input.envKey,
        tier,
        requiresApproval: input.requiresApproval ?? true,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'environment',
        targetId: env.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.environmentDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.environmentDefined,
        entityType: 'govrelease_environment',
        entityId: env.id,
        detail: { envKey: input.envKey, tier, scope },
      });
      return env;
    });
  }

  async getArtifact(ctx: RequestContext, id: string): Promise<ArtifactRow | null> {
    await this.authz.require(ctx, M37_PERMISSIONS.artifactRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getArtifact(tx, id));
  }
  async listArtifacts(
    ctx: RequestContext,
    page?: { limit?: number; offset?: number },
  ): Promise<ArtifactRow[]> {
    await this.authz.require(ctx, M37_PERMISSIONS.artifactRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listArtifacts(tx, limit, offset));
  }
  async listEnvironments(
    ctx: RequestContext,
    page?: { limit?: number; offset?: number },
  ): Promise<EnvironmentRow[]> {
    await this.authz.require(ctx, M37_PERMISSIONS.artifactRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listEnvironments(tx, limit, offset));
  }
}
