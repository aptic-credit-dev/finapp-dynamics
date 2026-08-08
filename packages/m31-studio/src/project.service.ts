/**
 * StudioProjectService — governed design workspaces/projects. Every mutation is authorized (default deny; a
 * platform-scoped project additionally requires the control-plane `studio.control.administer`) and audited through m03
 * in the same transaction. No DELETE — a project archives.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M31_PERMISSIONS } from './permissions.ts';
import { M31_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, versionConflict } from './errors.ts';
import { isScope, isPlatformScope, clampPage, REASON_CODES } from './domain.ts';
import { StudioRepository, type ProjectRow } from './repository.ts';
import type { M31Emitter } from './emit.ts';

export class StudioProjectService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M31Emitter;
  private readonly repo: StudioRepository;
  constructor(db: Db, authz: Authz, emitter: M31Emitter, repo: StudioRepository = new StudioRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M31_PERMISSIONS.administer);
  }

  async createProject(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      projectKey: string;
      name: string;
      description?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ProjectRow> {
    await this.authz.require(ctx, M31_PERMISSIONS.projectManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (input.projectKey.trim() === '') throw badRequest('a project key is required.', ctx.correlationId);
    if (input.name.trim() === '') throw badRequest('a project name is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findProjectByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const project = await this.repo.insertProject(tx, {
        tenantId: ctx.tenantId,
        scope,
        projectKey: input.projectKey,
        name: input.name,
        description: input.description ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          targetType: 'project',
          targetId: project.id,
          correlationId: ctx.correlationId,
          by: actor,
        });
      }
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'project',
        targetId: project.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.projectCreated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.projectCreated,
        entityType: 'studio_project',
        entityId: project.id,
        detail: { scope, projectKey: input.projectKey },
      });
      return project;
    });
  }

  async updateProject(
    ctx: RequestContext,
    actor: string | null,
    projectId: string,
    input: { expectedVersion: number; name: string; description?: string | null; status?: string },
  ): Promise<ProjectRow> {
    await this.authz.require(ctx, M31_PERMISSIONS.projectManage);
    const status = input.status ?? 'active';
    if (status !== 'active' && status !== 'archived')
      throw badRequest('unknown project status.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const current = await this.repo.getProject(tx, projectId);
      if (current === null) throw badRequest('unknown project.', ctx.correlationId);
      await this.authorizeScope(ctx, current.scope);
      const updated = await this.repo.updateProject(tx, projectId, input.expectedVersion, {
        name: input.name,
        description: input.description ?? null,
        status,
        by: actor,
      });
      if (updated === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'project',
        targetId: projectId,
        fromStatus: current.status,
        toStatus: status,
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.projectUpdated,
        entityType: 'studio_project',
        entityId: projectId,
        detail: { status },
      });
      return updated;
    });
  }

  async listProjects(ctx: RequestContext, page?: { limit?: number; offset?: number }): Promise<ProjectRow[]> {
    await this.authz.require(ctx, M31_PERMISSIONS.projectRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listProjects(tx, limit, offset));
  }
}
