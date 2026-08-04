/**
 * The M04 ORCHESTRATION services. Each one is a thin, authorized delegator: it requires the caller's `admin.*`
 * permission (default deny), then calls the OWNING module's PUBLIC service — which enforces ITS own permission, runs
 * its own transaction, and writes its own audit. M04 adds NO business logic, touches NO other module's tables, and
 * bypasses NO authorization, validation, workflow or audit. This is the delegated-authority model: an admin identity
 * must hold BOTH the `admin.*` permission AND the delegated module permission — there is no universal admin bypass, and
 * a tenant admin can never invoke a platform action they do not hold. Immutable-system-role refusal, platform-role
 * refusal, SoD enforcement and optimistic concurrency all live in the owning module and are honoured unchanged.
 *
 * Sensitive READS (audit search / platform audit access) are additionally recorded by M04 with an `ADMIN_` code, so no
 * privileged read disappears silently. Key MUTATIONS are recorded in the M04 admin-operation ledger for an
 * admin-facing trail; the authoritative state change + audit remain the owning module's.
 *
 * Constructors use EXPLICIT field declarations (never TS parameter properties) so these files run under Node's
 * type-stripping in the PURE smoke lane.
 */
import type { Audit, Authz, Db, RequestContext } from '@finapp/kernel';
import type { TenantService } from '@finapp/m01-tenant';
import type { IdentityService, MembershipService } from '@finapp/m02-identity';
import type { RoleService, AssignmentService, SodService, CatalogueService } from '@finapp/m02-rbac';
import type { AuditQueryService } from '@finapp/m03-audit';
import type { DefinitionService, InstanceService } from '@finapp/m06-workflow';
import type { RuleSetService } from '@finapp/m07-rules';
import type { TemplateService, PreferenceService, NotificationService } from '@finapp/m08-notify';
import { M04_PERMISSIONS } from './permissions.ts';
import { M04_AUDIT_CODES } from './audit-codes.ts';
import type { AdminOperationService } from './operation.service.ts';

interface ActionOpts {
  reason?: string;
  expectedVersion: number;
}

// --- Tenant administration --------------------------------------------------------------------
export class TenantAdminService {
  private readonly authz: Authz;
  private readonly tenants: TenantService;
  private readonly ops: AdminOperationService;
  constructor(authz: Authz, tenants: TenantService, ops: AdminOperationService) {
    this.authz = authz;
    this.tenants = tenants;
    this.ops = ops;
  }
  async list(ctx: RequestContext, opts?: { status?: string; limit?: number; offset?: number }) {
    await this.authz.require(ctx, M04_PERMISSIONS.tenantRead);
    return this.tenants.list(ctx, opts ?? {});
  }
  async get(ctx: RequestContext, tenantId: string) {
    await this.authz.require(ctx, M04_PERMISSIONS.tenantRead);
    return this.tenants.get(ctx, tenantId);
  }
  async statusHistory(ctx: RequestContext, tenantId: string) {
    await this.authz.require(ctx, M04_PERMISSIONS.tenantRead);
    return this.tenants.statusHistory(ctx, tenantId);
  }
  async update(
    ctx: RequestContext,
    actor: string | null,
    tenantId: string,
    input: { expectedVersion: number } & Record<string, unknown>,
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.tenantManage);
    return this.tenants.updateProfile(ctx, actor, tenantId, input);
  }
  async suspend(
    ctx: RequestContext,
    actor: string | null,
    tenantId: string,
    opts: ActionOpts,
    idempotencyKey?: string,
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.tenantSuspend);
    const op = await this.ops.recordOperation(ctx, actor, {
      operationType: 'tenant_suspend',
      targetType: 'tenant',
      targetRef: tenantId,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    try {
      const result = await this.tenants.applyAction(ctx, actor, tenantId, 'suspend', opts);
      await this.ops.completeOperation(ctx, actor, op.id, op.version, 'completed');
      return result;
    } catch (e) {
      await this.ops.completeOperation(ctx, actor, op.id, op.version, 'failed');
      throw e;
    }
  }
  async reactivate(
    ctx: RequestContext,
    actor: string | null,
    tenantId: string,
    opts: ActionOpts,
    idempotencyKey?: string,
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.tenantReactivate);
    const op = await this.ops.recordOperation(ctx, actor, {
      operationType: 'tenant_reactivate',
      targetType: 'tenant',
      targetRef: tenantId,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    try {
      const result = await this.tenants.applyAction(ctx, actor, tenantId, 'reactivate', opts);
      await this.ops.completeOperation(ctx, actor, op.id, op.version, 'completed');
      return result;
    } catch (e) {
      await this.ops.completeOperation(ctx, actor, op.id, op.version, 'failed');
      throw e;
    }
  }
}

// --- Identity / account administration ---------------------------------------------------------
export class IdentityAdminService {
  private readonly authz: Authz;
  private readonly identities: IdentityService;
  private readonly memberships: MembershipService;
  constructor(authz: Authz, identities: IdentityService, memberships: MembershipService) {
    this.authz = authz;
    this.identities = identities;
    this.memberships = memberships;
  }
  async listIdentities(ctx: RequestContext, opts?: { status?: string; limit?: number; offset?: number }) {
    await this.authz.require(ctx, M04_PERMISSIONS.identityRead);
    return this.identities.listIdentities(ctx, opts ?? {});
  }
  async getIdentity(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M04_PERMISSIONS.identityRead);
    return this.identities.getIdentity(ctx, id);
  }
  async applyIdentityAction(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    action: 'activate' | 'suspend' | 'reactivate' | 'deactivate',
    opts: ActionOpts,
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.identityManage);
    return this.identities.applyIdentityAction(ctx, actor, id, action, opts);
  }
  async listAccounts(ctx: RequestContext, opts?: { identityId?: string; limit?: number; offset?: number }) {
    await this.authz.require(ctx, M04_PERMISSIONS.identityRead);
    return this.identities.listAccounts(ctx, opts ?? {});
  }
  async activateAccount(ctx: RequestContext, actor: string | null, id: string, opts: ActionOpts) {
    await this.authz.require(ctx, M04_PERMISSIONS.accountActivate);
    return this.identities.applyAccountAction(ctx, actor, id, 'activate', opts);
  }
  async deactivateAccount(ctx: RequestContext, actor: string | null, id: string, opts: ActionOpts) {
    await this.authz.require(ctx, M04_PERMISSIONS.accountDeactivate);
    return this.identities.applyAccountAction(ctx, actor, id, 'deactivate', opts);
  }
  async listMemberships(ctx: RequestContext, opts?: { status?: string; limit?: number; offset?: number }) {
    await this.authz.require(ctx, M04_PERMISSIONS.identityRead);
    return this.memberships.list(ctx, opts ?? {});
  }
}

// --- RBAC / SoD administration -----------------------------------------------------------------
export class AccessAdminService {
  private readonly authz: Authz;
  private readonly roles: RoleService;
  private readonly assignments: AssignmentService;
  private readonly sod: SodService;
  private readonly catalogue: CatalogueService;
  constructor(
    authz: Authz,
    roles: RoleService,
    assignments: AssignmentService,
    sod: SodService,
    catalogue: CatalogueService,
  ) {
    this.authz = authz;
    this.roles = roles;
    this.assignments = assignments;
    this.sod = sod;
    this.catalogue = catalogue;
  }
  async listRoles(ctx: RequestContext, opts: { limit?: number; offset?: number; status?: string }) {
    await this.authz.require(ctx, M04_PERMISSIONS.roleRead);
    return this.roles.list(ctx, opts);
  }
  async getRole(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M04_PERMISSIONS.roleRead);
    return this.roles.get(ctx, id);
  }
  async createRole(
    ctx: RequestContext,
    actor: string,
    input: { code: string; name: string; description?: string; risk?: string },
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.roleManage);
    return this.roles.create(ctx, actor, input);
  }
  /** Activate/suspend/reactivate/retire a role. Immutable system roles are refused BY m02-rbac (ProblemError.conflict). */
  async applyRoleAction(
    ctx: RequestContext,
    actor: string,
    id: string,
    action: 'activate' | 'suspend' | 'reactivate' | 'retire',
    opts: ActionOpts,
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.roleManage);
    return this.roles.applyAction(ctx, actor, id, action, opts);
  }
  async listPermissions(ctx: RequestContext) {
    await this.authz.require(ctx, M04_PERMISSIONS.permissionRead);
    return this.catalogue.listPermissions(ctx);
  }
  /** Grant a role assignment. Anti-escalation is bounded by the caller's OWN resolved permissions (never client input);
   *  platform-role refusal + SoD are enforced by m02-rbac. */
  async assignRole(
    ctx: RequestContext,
    actor: string,
    input: {
      membershipId: string;
      roleId: string;
      scopeLevel?: string;
      scopeRef?: string;
      justification?: string;
    },
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.roleAssign);
    return this.assignments.grant(ctx, actor, { ...input, grantorPermissions: ctx.permissions });
  }
  async revokeAssignment(ctx: RequestContext, actor: string, id: string, opts: ActionOpts) {
    await this.authz.require(ctx, M04_PERMISSIONS.roleRevoke);
    return this.assignments.applyAction(ctx, actor, id, 'revoke', opts);
  }
  async listSod(ctx: RequestContext) {
    await this.authz.require(ctx, M04_PERMISSIONS.sodRead);
    return this.sod.list(ctx);
  }
  async createSod(
    ctx: RequestContext,
    input: {
      tenantId: string;
      ruleType: 'role_pair' | 'permission_pair';
      codeA: string;
      codeB: string;
      description: string;
      severity: string;
      actor: string;
    },
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.sodManage);
    return this.sod.create(ctx, input);
  }
}

// --- Audit administration (sensitive reads are M04-audited) ------------------------------------
export class AuditAdminService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly audit: Audit;
  private readonly auditQuery: AuditQueryService;
  constructor(db: Db, authz: Authz, audit: Audit, auditQuery: AuditQueryService) {
    this.db = db;
    this.authz = authz;
    this.audit = audit;
    this.auditQuery = auditQuery;
  }
  private async record(ctx: RequestContext, code: string, detail: Record<string, unknown>): Promise<void> {
    await this.db.withTenant(ctx, (tx) =>
      this.audit.write(tx, ctx, { code, entityType: 'admin_audit', entityId: ctx.tenantId, detail }),
    );
  }
  async search(ctx: RequestContext, filter: { limit?: number; offset?: number } & Record<string, unknown>) {
    await this.authz.require(ctx, M04_PERMISSIONS.auditRead);
    await this.record(ctx, M04_AUDIT_CODES.auditSearched, { scope: 'tenant' });
    return this.auditQuery.searchTenant(ctx, filter);
  }
  async searchPlatform(
    ctx: RequestContext,
    filter: { limit?: number; offset?: number } & Record<string, unknown>,
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.platformAuditRead);
    await this.record(ctx, M04_AUDIT_CODES.platformAuditAccessed, { scope: 'platform' });
    return this.auditQuery.searchPlatform(ctx, filter);
  }
  async export(ctx: RequestContext, filter: { limit?: number; offset?: number } & Record<string, unknown>) {
    await this.authz.require(ctx, M04_PERMISSIONS.auditExport);
    await this.record(ctx, M04_AUDIT_CODES.auditExported, { scope: 'tenant' });
    return this.auditQuery.exportTenant(ctx, filter);
  }
  async verifyIntegrity(ctx: RequestContext, scopeKey: string) {
    await this.authz.require(ctx, M04_PERMISSIONS.auditVerify);
    await this.record(ctx, M04_AUDIT_CODES.auditIntegrityVerified, { scopeKey });
    return this.auditQuery.verifyScope(ctx, scopeKey);
  }
}

// --- Workflow administration -------------------------------------------------------------------
export class WorkflowAdminService {
  private readonly authz: Authz;
  private readonly definitions: DefinitionService;
  private readonly instances: InstanceService;
  constructor(authz: Authz, definitions: DefinitionService, instances: InstanceService) {
    this.authz = authz;
    this.definitions = definitions;
    this.instances = instances;
  }
  async getDefinition(ctx: RequestContext, versionId: string) {
    await this.authz.require(ctx, M04_PERMISSIONS.workflowRead);
    return this.definitions.view(ctx, versionId);
  }
  async publish(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    await this.authz.require(ctx, M04_PERMISSIONS.workflowManage);
    return this.definitions.publish(ctx, actor, versionId, expectedVersion);
  }
  async activate(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    await this.authz.require(ctx, M04_PERMISSIONS.workflowManage);
    return this.definitions.activate(ctx, actor, versionId, expectedVersion);
  }
  async retire(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
    reason: string,
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.workflowManage);
    return this.definitions.retire(ctx, actor, versionId, expectedVersion, reason);
  }
  async getInstance(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M04_PERMISSIONS.workflowRead);
    return this.instances.view(ctx, id);
  }
}

// --- Rules administration ----------------------------------------------------------------------
export class RulesAdminService {
  private readonly authz: Authz;
  private readonly ruleSets: RuleSetService;
  constructor(authz: Authz, ruleSets: RuleSetService) {
    this.authz = authz;
    this.ruleSets = ruleSets;
  }
  async list(ctx: RequestContext) {
    await this.authz.require(ctx, M04_PERMISSIONS.rulesRead);
    return this.ruleSets.list(ctx);
  }
  async get(ctx: RequestContext, ruleSetId: string) {
    await this.authz.require(ctx, M04_PERMISSIONS.rulesRead);
    return this.ruleSets.get(ctx, ruleSetId);
  }
  async publish(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    await this.authz.require(ctx, M04_PERMISSIONS.rulesManage);
    return this.ruleSets.publish(ctx, actor, versionId, expectedVersion);
  }
  async activate(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    await this.authz.require(ctx, M04_PERMISSIONS.rulesManage);
    return this.ruleSets.activate(ctx, actor, versionId, expectedVersion);
  }
}

// --- Notification administration ---------------------------------------------------------------
export class NotificationAdminService {
  private readonly authz: Authz;
  private readonly templates: TemplateService;
  private readonly preferences: PreferenceService;
  private readonly notifications: NotificationService;
  constructor(
    authz: Authz,
    templates: TemplateService,
    preferences: PreferenceService,
    notifications: NotificationService,
  ) {
    this.authz = authz;
    this.templates = templates;
    this.preferences = preferences;
    this.notifications = notifications;
  }
  async listTemplates(ctx: RequestContext) {
    await this.authz.require(ctx, M04_PERMISSIONS.notificationRead);
    return this.templates.list(ctx);
  }
  async publishTemplate(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.notificationManage);
    return this.templates.publish(ctx, actor, versionId, expectedVersion);
  }
  async setSuppression(
    ctx: RequestContext,
    actor: string | null,
    input: { destination: string; channel: string; suppressed: boolean; reason?: string },
  ) {
    await this.authz.require(ctx, M04_PERMISSIONS.notificationManage);
    return this.preferences.setSuppression(ctx, actor, input);
  }
  async listRequests(ctx: RequestContext, limit?: number, offset?: number) {
    await this.authz.require(ctx, M04_PERMISSIONS.notificationRead);
    return this.notifications.list(ctx, limit, offset);
  }
}
