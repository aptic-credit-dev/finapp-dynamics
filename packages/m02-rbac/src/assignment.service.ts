import { ProblemError, type Authz, type Db, type RequestContext, type SystemContext } from '@finapp/kernel';
import { RbacRepository, type AssignmentRow } from './repository.ts';
import { type RbacEmitter } from './emit.ts';
import { type SodService, badRequest, isUniqueViolation } from './sod.service.ts';
import { RBAC_AUDIT_CODES } from './audit-codes.ts';
import { RBAC_PERMISSIONS } from './permissions.ts';
import {
  checkAssignmentTransition,
  type AssignmentAction,
  type AssignmentStatus,
} from './domain/lifecycles.ts';
import { isScopeLevel } from './domain/scope.ts';

/**
 * Tenant role assignments (ADR-017/018/019). All work runs in the caller's TENANT context, so an assignment
 * physically cannot reference another tenant (RLS, no escape). Grants are SoD-checked and bounded by the
 * grantor's own permissions (no self-escalation beyond what you hold).
 */
export class AssignmentService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: RbacEmitter;
  private readonly sod: SodService;
  private readonly repo: RbacRepository;

  constructor(
    db: Db,
    authz: Authz,
    emitter: RbacEmitter,
    sod: SodService,
    repo: RbacRepository = new RbacRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.sod = sod;
    this.repo = repo;
  }

  async grant(
    ctx: RequestContext,
    actor: string,
    input: {
      membershipId: string;
      roleId: string;
      scopeLevel?: string;
      scopeRef?: string | null;
      effectiveFrom?: Date | null;
      expiresAt?: Date | null;
      justification?: string | null;
      grantorPermissions: readonly string[];
    },
  ): Promise<AssignmentRow> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.assignmentGrant);
    const scopeLevel = input.scopeLevel ?? 'tenant';
    if (!isScopeLevel(scopeLevel) || scopeLevel === 'platform')
      throw badRequest('invalid scope level.', ctx.correlationId);
    const scopeRef = scopeLevel === 'tenant' ? null : (input.scopeRef ?? null);
    if (scopeLevel !== 'tenant' && scopeRef === null)
      throw badRequest('an organizational scope requires a scope reference.', ctx.correlationId);

    const sys: SystemContext = { reason: 'grant role (m02-rbac)', correlationId: ctx.correlationId };
    return this.db.withTenant(ctx, async (tx) => {
      const role = await this.repo.findRole(tx, input.roleId);
      if (role === null)
        throw badRequest('roleId does not exist or is not visible in this tenant.', ctx.correlationId);
      if (role.status !== 'active')
        throw ProblemError.conflict(`Cannot assign a ${role.status} role.`, ctx.correlationId);

      const membership = await this.repo.findMembership(tx, input.membershipId);
      if (membership === null)
        throw badRequest('membershipId does not exist in this tenant.', ctx.correlationId);
      if (membership.status === 'ended')
        throw ProblemError.conflict('Cannot assign a role to an ended membership.', ctx.correlationId);

      // Anti-escalation: you may only grant a role whose permissions you yourself hold.
      const rolePerms = await this.repo.permissionsOfRole(tx, input.roleId);
      const grantor = new Set(input.grantorPermissions);
      const beyond = rolePerms.find((p) => !grantor.has(p));
      if (beyond !== undefined) {
        throw ProblemError.forbidden(
          'You cannot grant a role that includes permissions you do not hold.',
          ctx.correlationId,
        );
      }

      if (scopeRef !== null && !(await this.repo.orgNodeExists(tx, scopeLevel, scopeRef))) {
        throw badRequest('the organizational scope does not exist in this tenant.', ctx.correlationId);
      }

      // SoD — fail closed at grant time.
      const currentRoleCodes = await this.repo.currentMembershipRoleCodes(tx, input.membershipId);
      const conflict = await this.sod.firstConflict(tx, {
        membershipId: input.membershipId,
        newRoleId: input.roleId,
        newRoleCode: role.code,
        currentRoleCodes,
      });
      if (conflict !== null)
        await this.sod.rejectConflict(tx, sys, {
          conflict,
          membershipId: input.membershipId,
          correlationId: ctx.correlationId,
          actor,
        });

      let row: AssignmentRow;
      try {
        row = await this.repo.insertAssignment(tx, {
          tenantId: ctx.tenantId,
          membershipId: input.membershipId,
          identityId: membership.identity_id,
          roleId: input.roleId,
          scopeLevel,
          scopeRef,
          effectiveFrom: input.effectiveFrom ?? null,
          expiresAt: input.expiresAt ?? null,
          justification: input.justification ?? null,
          grantedBy: actor,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error))
          throw ProblemError.conflict(
            'That role is already assigned to this membership at this scope.',
            ctx.correlationId,
          );
        throw error;
      }
      await this.repo.appendAssignmentHistory(tx, {
        tenantId: ctx.tenantId,
        assignmentId: row.id,
        kind: 'tenant',
        fromStatus: null,
        toStatus: 'active',
        action: 'grant',
        reason: null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: RBAC_AUDIT_CODES.assignmentGranted,
        entityType: 'role_assignment',
        entityId: row.id,
        detail: { roleId: input.roleId },
      });
      await this.emitter.publish(tx, 'RoleAssigned', ctx.tenantId, ctx.correlationId, actor, {
        assignmentId: row.id,
        roleId: input.roleId,
        subjectId: input.membershipId,
        toStatus: 'active',
      });
      return row;
    });
  }

  async get(ctx: RequestContext, id: string): Promise<AssignmentRow> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.assignmentView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findAssignment(tx, id));
    if (row === null) throw ProblemError.notFound('Assignment not found.', ctx.correlationId);
    return row;
  }

  async list(
    ctx: RequestContext,
    opts: { limit?: number; offset?: number; membershipId?: string; status?: string },
  ): Promise<AssignmentRow[]> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.assignmentView);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listAssignments(tx, {
        limit: Math.min(Math.max(opts.limit ?? 50, 1), 200),
        offset: Math.max(opts.offset ?? 0, 0),
        ...(opts.membershipId === undefined ? {} : { membershipId: opts.membershipId }),
        ...(opts.status === undefined ? {} : { status: opts.status }),
      }),
    );
  }

  async applyAction(
    ctx: RequestContext,
    actor: string,
    id: string,
    action: AssignmentAction,
    opts: { reason?: string; expectedVersion: number },
  ): Promise<AssignmentRow> {
    // Every assignment mutation — suspend, reactivate, revoke, expire — is gated by the single revoke
    // permission: there is no finer grant, and the safe default is to require the strongest of them.
    await this.authz.require(ctx, RBAC_PERMISSIONS.assignmentRevoke);
    return this.db.withTenant(ctx, async (tx) => {
      const current = await this.repo.findAssignment(tx, id);
      if (current === null) throw ProblemError.notFound('Assignment not found.', ctx.correlationId);
      const check = checkAssignmentTransition(current.status as AssignmentStatus, action, {
        reason: opts.reason,
      });
      if (!check.allowed || check.to === undefined)
        throw ProblemError.conflict(check.reason ?? 'Transition not allowed.', ctx.correlationId);
      const updated = await this.repo.applyAssignmentStatus(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: check.to,
        reason: opts.reason ?? null,
        actor,
      });
      if (updated === null) throw ProblemError.conflict('Version conflict.', ctx.correlationId);
      await this.repo.appendAssignmentHistory(tx, {
        tenantId: ctx.tenantId,
        assignmentId: id,
        kind: 'tenant',
        fromStatus: current.status,
        toStatus: check.to,
        action,
        reason: opts.reason ?? null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      const code =
        action === 'revoke'
          ? RBAC_AUDIT_CODES.assignmentRevoked
          : action === 'expire'
            ? RBAC_AUDIT_CODES.assignmentExpired
            : RBAC_AUDIT_CODES.assignmentGranted;
      await this.emitter.recordAudit(tx, ctx, {
        code,
        entityType: 'role_assignment',
        entityId: id,
        ...(opts.reason === undefined ? {} : { reason: opts.reason }),
      });
      const evt =
        action === 'revoke'
          ? 'AssignmentRevoked'
          : action === 'expire'
            ? 'AssignmentExpired'
            : 'RoleAssigned';
      await this.emitter.publish(tx, evt, ctx.tenantId, ctx.correlationId, actor, {
        assignmentId: id,
        roleId: current.role_id,
        subjectId: current.membership_id,
        fromStatus: current.status,
        toStatus: check.to,
        ...(opts.reason === undefined ? {} : { reason: opts.reason }),
      });
      return updated;
    });
  }
}
