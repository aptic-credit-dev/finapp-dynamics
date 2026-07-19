import { ProblemError, type Authz, type Db, type RequestContext } from '@finapp/kernel';
import { RbacRepository, type RoleRow } from './repository.ts';
import { type RbacEmitter } from './emit.ts';
import { RBAC_AUDIT_CODES } from './audit-codes.ts';
import { RBAC_PERMISSIONS } from './permissions.ts';
import { badRequest, isUniqueViolation } from './sod.service.ts';
import { checkRoleTransition, type RoleAction, type RoleStatus } from './domain/lifecycles.ts';

const ROLE_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const ROLE_ACTION_AUDIT: Record<RoleAction, string> = {
  activate: RBAC_AUDIT_CODES.roleActivated,
  suspend: RBAC_AUDIT_CODES.roleSuspended,
  reactivate: RBAC_AUDIT_CODES.roleActivated,
  retire: RBAC_AUDIT_CODES.roleRetired,
};
/** Which permission each lifecycle action demands. A reactivate is an activate; the rest map one to one. */
const ROLE_ACTION_PERMISSION: Record<RoleAction, string> = {
  activate: RBAC_PERMISSIONS.roleActivate,
  reactivate: RBAC_PERMISSIONS.roleActivate,
  suspend: RBAC_PERMISSIONS.roleSuspend,
  retire: RBAC_PERMISSIONS.roleRetire,
};

/**
 * Tenant custom roles (ADR-017). All work runs in the caller's TENANT context, so a tenant can only create,
 * read and edit its own roles (plus read the immutable system roles). System roles are immutable — the
 * repository's `is_immutable = false` guard makes a tenant edit of a platform role a no-op that this service
 * surfaces as a conflict.
 */
export class RoleService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: RbacEmitter;
  private readonly repo: RbacRepository;

  constructor(db: Db, authz: Authz, emitter: RbacEmitter, repo: RbacRepository = new RbacRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async create(ctx: RequestContext, actor: string, input: { code: string; name: string; description?: string | null; risk?: string }): Promise<RoleRow> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.roleCreate);
    if (!ROLE_CODE_PATTERN.test(input.code)) throw badRequest('code must be lower_snake_case (3-64 chars).', ctx.correlationId);
    if (typeof input.name !== 'string' || input.name.trim() === '') throw badRequest('name is required.', ctx.correlationId);
    const risk = input.risk ?? 'normal';
    if (!['normal', 'elevated', 'critical'].includes(risk)) throw badRequest('invalid risk.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      let row: RoleRow;
      try {
        row = await this.repo.insertRole(tx, { tenantId: ctx.tenantId, code: input.code, name: input.name, description: input.description ?? null, risk, createdBy: actor });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw ProblemError.conflict(`Role code "${input.code}" already exists in this tenant.`, ctx.correlationId);
        throw error;
      }
      await this.repo.appendRoleHistory(tx, { tenantId: ctx.tenantId, roleId: row.id, fromStatus: null, toStatus: 'draft', action: 'create', reason: null, correlationId: ctx.correlationId, changedBy: actor });
      await this.emitter.recordAudit(tx, ctx, { code: RBAC_AUDIT_CODES.roleCreated, entityType: 'role', entityId: row.id, detail: { code: row.code } });
      await this.emitter.publish(tx, 'RoleCreated', ctx.tenantId, ctx.correlationId, actor, { roleId: row.id, roleCode: row.code, toStatus: 'draft' });
      return row;
    });
  }

  async get(ctx: RequestContext, id: string): Promise<RoleRow> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.roleView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findRole(tx, id));
    if (row === null) throw ProblemError.notFound('Role not found.', ctx.correlationId);
    return row;
  }

  async list(ctx: RequestContext, opts: { limit?: number; offset?: number; status?: string }): Promise<RoleRow[]> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.roleView);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listRoles(tx, { limit: Math.min(Math.max(opts.limit ?? 50, 1), 200), offset: Math.max(opts.offset ?? 0, 0), ...(opts.status === undefined ? {} : { status: opts.status }) }),
    );
  }

  async update(ctx: RequestContext, actor: string, id: string, input: { expectedVersion: number; name?: string; description?: string | null }): Promise<RoleRow> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.roleEdit);
    return this.db.withTenant(ctx, async (tx) => {
      const current = await this.repo.findRole(tx, id);
      if (current === null) throw ProblemError.notFound('Role not found.', ctx.correlationId);
      if (current.is_immutable) throw ProblemError.conflict('System roles are immutable.', ctx.correlationId);
      const updated = await this.repo.updateRoleMeta(tx, { id, expectedVersion: input.expectedVersion, ...(input.name === undefined ? {} : { name: input.name }), ...(input.description === undefined ? {} : { description: input.description }), updatedBy: actor });
      if (updated === null) throw ProblemError.conflict('Version conflict.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, { code: RBAC_AUDIT_CODES.roleUpdated, entityType: 'role', entityId: id });
      await this.emitter.publish(tx, 'RoleUpdated', ctx.tenantId, ctx.correlationId, actor, { roleId: id, roleCode: updated.code });
      return updated;
    });
  }

  async applyAction(ctx: RequestContext, actor: string, id: string, action: RoleAction, opts: { reason?: string; expectedVersion: number }): Promise<RoleRow> {
    await this.authz.require(ctx, ROLE_ACTION_PERMISSION[action]);
    return this.db.withTenant(ctx, async (tx) => {
      const current = await this.repo.findRole(tx, id);
      if (current === null) throw ProblemError.notFound('Role not found.', ctx.correlationId);
      if (current.is_immutable) throw ProblemError.conflict('System roles are immutable.', ctx.correlationId);
      const check = checkRoleTransition(current.status as RoleStatus, action, { reason: opts.reason });
      if (!check.allowed || check.to === undefined) throw ProblemError.conflict(check.reason ?? 'Transition not allowed.', ctx.correlationId);
      const updated = await this.repo.applyRoleStatus(tx, { id, expectedVersion: opts.expectedVersion, toStatus: check.to, updatedBy: actor });
      if (updated === null) throw ProblemError.conflict('Version conflict.', ctx.correlationId);
      await this.repo.appendRoleHistory(tx, { tenantId: ctx.tenantId, roleId: id, fromStatus: current.status, toStatus: check.to, action, reason: opts.reason ?? null, correlationId: ctx.correlationId, changedBy: actor });
      await this.emitter.recordAudit(tx, ctx, { code: ROLE_ACTION_AUDIT[action], entityType: 'role', entityId: id, ...(opts.reason === undefined ? {} : { reason: opts.reason }), detail: { fromStatus: current.status, toStatus: check.to } });
      const evt = action === 'activate' || action === 'reactivate' ? 'RoleActivated' : action === 'suspend' ? 'RoleSuspended' : 'RoleRetired';
      await this.emitter.publish(tx, evt, ctx.tenantId, ctx.correlationId, actor, { roleId: id, roleCode: current.code, fromStatus: current.status, toStatus: check.to, ...(opts.reason === undefined ? {} : { reason: opts.reason }) });
      return updated;
    });
  }

  /** Grants/removes concrete permissions on a tenant role. `grantorPermissions` bounds escalation (no grant beyond your own set). */
  async changePermissions(
    ctx: RequestContext,
    actor: string,
    id: string,
    input: { add?: string[]; remove?: string[]; grantorPermissions: readonly string[] },
  ): Promise<{ added: number; removed: number }> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.roleEdit);
    const add = input.add ?? [];
    const remove = input.remove ?? [];
    if (add.length === 0 && remove.length === 0) throw badRequest('Provide permissions to add or remove.', ctx.correlationId);
    const grantorSet = new Set(input.grantorPermissions);
    // Anti-escalation: you may only grant permissions you yourself hold.
    for (const code of add) {
      if (!grantorSet.has(code)) throw ProblemError.forbidden(`You cannot grant a permission you do not hold: ${code}.`, ctx.correlationId);
    }
    return this.db.withTenant(ctx, async (tx) => {
      const role = await this.repo.findRole(tx, id);
      if (role === null) throw ProblemError.notFound('Role not found.', ctx.correlationId);
      if (role.is_immutable) throw ProblemError.conflict('System roles are immutable.', ctx.correlationId);
      let added = 0;
      let removed = 0;
      for (const code of add) {
        if (!(await this.repo.permissionExists(tx, code, true))) throw badRequest(`Unknown or non-tenant-assignable permission: ${code}.`, ctx.correlationId);
        if (await this.repo.addRolePermission(tx, { roleId: id, tenantId: ctx.tenantId, code, grantedBy: actor })) added += 1;
      }
      for (const code of remove) {
        if (await this.repo.removeRolePermission(tx, id, code)) removed += 1;
      }
      await this.emitter.recordAudit(tx, ctx, { code: RBAC_AUDIT_CODES.rolePermissionsChanged, entityType: 'role', entityId: id, detail: { added, removed } });
      await this.emitter.publish(tx, 'RolePermissionsChanged', ctx.tenantId, ctx.correlationId, actor, { roleId: id, added, removed });
      return { added, removed };
    });
  }

  async permissions(ctx: RequestContext, id: string): Promise<string[]> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.roleView);
    return this.db.withTenant(ctx, async (tx) => {
      const role = await this.repo.findRole(tx, id);
      if (role === null) throw ProblemError.notFound('Role not found.', ctx.correlationId);
      return this.repo.listRolePermissions(tx, id);
    });
  }
}
