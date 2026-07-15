import { randomUUID } from 'node:crypto';
import {
  ProblemError,
  type Audit,
  type Authz,
  type Db,
  type Outbox,
  type RequestContext,
  type Tx,
} from '@finapp/kernel';
import {
  IDENTITY_LIFECYCLE_FAMILY,
  IDENTITY_LIFECYCLE_VERSION,
  type DomainEvent,
  type IdentityLifecycleEventType,
  type IdentityLifecyclePayload,
} from '@finapp/contracts';
import { allowsBusinessWrites, TenantRepository } from '@finapp/m01-tenant';
import { IdentityRepository, type MembershipRow } from './repository.ts';
import { MEMBERSHIP_ACTION_MAP, IDENTITY_AUDIT_CODES } from './audit-codes.ts';
import { IDENTITY_PERMISSIONS } from './permissions.ts';
import {
  checkMembershipTransition,
  type MembershipAction,
  type MembershipStatus,
} from './domain/lifecycles.ts';
import { isMembershipType } from './domain/types.ts';
import { badRequest, isUniqueViolation, versionConflict } from './identity.service.ts';

/**
 * Tenant membership — the join between a person and a tenant, and the only part of identity a tenant may
 * see.
 *
 * Everything here runs in TENANT context. `tenant_memberships` is tenant-scoped with no system escape, so
 * unlike identities and accounts there is no cross-tenant read to be had even from `withSystem`. That
 * asymmetry is the design: the identity plane is global because people are, and membership is tenant-
 * scoped because a relationship with a tenant is that tenant's business and nobody else's.
 */
export class MembershipService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  private readonly repo: IdentityRepository;
  private readonly tenants: TenantRepository;

  constructor(
    db: Db,
    authz: Authz,
    audit: Audit,
    outbox: Outbox<DomainEvent>,
    repo: IdentityRepository = new IdentityRepository(),
    tenants: TenantRepository = new TenantRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.audit = audit;
    this.outbox = outbox;
    this.repo = repo;
    this.tenants = tenants;
  }

  async create(
    ctx: RequestContext,
    actor: string | null,
    input: {
      identityId: string;
      accountId?: string | null;
      membershipType: string;
      isPrimary?: boolean;
      entityId?: string | null;
      departmentId?: string | null;
      branchId?: string | null;
      environmentId?: string | null;
    },
  ): Promise<MembershipRow> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.membershipCreate);

    if (!isMembershipType(input.membershipType)) {
      throw badRequest(['membershipType must be a registered type.'], ctx.correlationId);
    }

    // The identity lives on the global plane and cannot be read from tenant context, so it is checked
    // first, in its own transaction. That is a deliberate trade: the alternative is giving
    // tenant_memberships a system escape, which would let any withSystem call enumerate every tenant's
    // people. A stale read here is caught by the FK inside the write transaction below.
    const identity = await this.db.withSystem(
      { reason: 'membership: verify identity exists (m02)', correlationId: ctx.correlationId },
      (tx) => this.repo.findIdentity(tx, input.identityId),
    );
    if (identity === null) throw badRequest(['identityId does not exist.'], ctx.correlationId);
    if (identity.status === 'closed' || identity.status === 'rejected' || identity.status === 'archived') {
      throw ProblemError.conflict(
        `Cannot grant membership to an identity that is ${identity.status}.`,
        ctx.correlationId,
      );
    }

    const accountId = input.accountId ?? null;
    if (accountId !== null) {
      const account = await this.db.withSystem(
        { reason: 'membership: verify account exists (m02)', correlationId: ctx.correlationId },
        (tx) => this.repo.findAccount(tx, accountId),
      );
      if (account === null) throw badRequest(['accountId does not exist.'], ctx.correlationId);
      // An account belonging to a different person would let one human's membership be exercised by
      // another's login.
      if (account.identity_id !== input.identityId) {
        throw badRequest(['accountId belongs to a different identity.'], ctx.correlationId);
      }
    }

    return this.db.withTenant(ctx, async (tx) => {
      await this.requireActiveTenant(tx, ctx);

      let row: MembershipRow;
      try {
        row = await this.repo.insertMembership(tx, {
          tenantId: ctx.tenantId,
          identityId: input.identityId,
          accountId: input.accountId ?? null,
          membershipType: input.membershipType,
          isPrimary: input.isPrimary ?? false,
          entityId: input.entityId ?? null,
          departmentId: input.departmentId ?? null,
          branchId: input.branchId ?? null,
          environmentId: input.environmentId ?? null,
          createdBy: actor,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw ProblemError.conflict(
            'That identity already has a live membership in this tenant.',
            ctx.correlationId,
          );
        }
        if (isForeignKeyViolation(error)) {
          // The composite FKs make this mean "the scope names a node that is not in this tenant".
          throw badRequest(
            [
              'A referenced record (entity, department, branch or environment) does not exist in this tenant.',
            ],
            ctx.correlationId,
          );
        }
        throw error;
      }

      await this.record(tx, ctx, actor, row, {
        auditCode: IDENTITY_AUDIT_CODES.membershipCreated,
        eventType: 'TenantMembershipCreated',
        fromStatus: null,
        toStatus: 'pending',
        action: 'create',
        reason: null,
      });

      return row;
    });
  }

  async get(ctx: RequestContext, id: string): Promise<MembershipRow> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.membershipView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findMembership(tx, id));
    // RLS already hid another tenant's membership, so "not visible" and "does not exist" are the same
    // answer — and must look the same to the caller.
    if (row === null) throw ProblemError.notFound('Membership not found.', ctx.correlationId);
    return row;
  }

  async list(
    ctx: RequestContext,
    opts: { status?: string; limit?: number; offset?: number } = {},
  ): Promise<MembershipRow[]> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.membershipView);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listMemberships(tx, {
        ...(opts.status === undefined ? {} : { status: opts.status }),
        limit: Math.min(Math.max(opts.limit ?? 50, 1), 200),
        offset: Math.max(opts.offset ?? 0, 0),
      }),
    );
  }

  async applyAction(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    action: MembershipAction,
    opts: { reason?: string; expectedVersion: number },
  ): Promise<MembershipRow> {
    const mapping = MEMBERSHIP_ACTION_MAP[action];
    await this.authz.require(ctx, mapping.permission);

    return this.db.withTenant(ctx, async (tx) => {
      // Ending a membership is allowed even on a non-active tenant: offboarding must never be blocked by
      // the tenant's commercial state. Everything else requires an active tenant.
      if (action !== 'end') await this.requireActiveTenant(tx, ctx);

      const current = await this.repo.findMembership(tx, id);
      if (current === null) throw ProblemError.notFound('Membership not found.', ctx.correlationId);

      const check = checkMembershipTransition(current.status as MembershipStatus, action, {
        reason: opts.reason,
      });
      if (!check.allowed || check.to === undefined) {
        throw ProblemError.conflict(check.reason ?? 'Transition not allowed.', ctx.correlationId);
      }

      const updated = await this.repo.applyMembershipStatus(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: check.to,
        updatedBy: actor,
      });
      if (updated === null) throw versionConflict(current.version, opts.expectedVersion, ctx.correlationId);

      await this.record(tx, ctx, actor, updated, {
        auditCode: mapping.auditCode,
        eventType: mapping.eventType,
        fromStatus: current.status,
        toStatus: check.to,
        action,
        reason: opts.reason ?? null,
      });

      return updated;
    });
  }

  /** Changes the organisational scope. The composite FKs guarantee the scope is in this tenant. */
  async changeScope(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      entityId?: string | null;
      departmentId?: string | null;
      branchId?: string | null;
    },
  ): Promise<MembershipRow> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.membershipScope);

    return this.db.withTenant(ctx, async (tx) => {
      await this.requireActiveTenant(tx, ctx);
      const current = await this.repo.findMembership(tx, id);
      if (current === null) throw ProblemError.notFound('Membership not found.', ctx.correlationId);
      if (current.status === 'ended') {
        throw ProblemError.conflict('An ended membership cannot be rescoped.', ctx.correlationId);
      }

      let updated: MembershipRow | null;
      try {
        updated = await this.repo.updateMembershipScope(tx, {
          id,
          expectedVersion: input.expectedVersion,
          ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
          ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
          ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
          updatedBy: actor,
        });
      } catch (error: unknown) {
        if (isForeignKeyViolation(error)) {
          throw badRequest(['A referenced scope record does not exist in this tenant.'], ctx.correlationId);
        }
        throw error;
      }
      if (updated === null) throw versionConflict(current.version, input.expectedVersion, ctx.correlationId);

      const changedFields = Object.keys(input).filter((k) => k !== 'expectedVersion');
      await this.audit.write(tx, ctx, {
        code: IDENTITY_AUDIT_CODES.membershipScopeChanged,
        entityType: 'tenant_membership',
        entityId: id,
        detail: { changedFields },
      });
      await this.publish(tx, 'TenantMembershipScopeChanged', ctx, actor, {
        membershipId: id,
        tenantId: ctx.tenantId,
        changedFields,
      });

      return updated;
    });
  }

  // --- shared -------------------------------------------------------------------------------------

  /**
   * Membership changes require an ACTIVE tenant (m01's own gate, reused rather than re-implemented).
   *
   * Granting access to a suspended tenant would let a commercial suspension be worked around by adding
   * people to it.
   */
  private async requireActiveTenant(tx: Tx, ctx: RequestContext): Promise<void> {
    const tenant = await this.tenants.findById(tx, ctx.tenantId);
    if (tenant === null) throw ProblemError.notFound('Tenant not found.', ctx.correlationId);
    if (!allowsBusinessWrites(tenant.status)) {
      throw ProblemError.conflict(
        `Tenant is ${tenant.status}; membership changes require an active tenant.`,
        ctx.correlationId,
      );
    }
  }

  private async record(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    row: MembershipRow,
    input: {
      auditCode: string;
      eventType: IdentityLifecycleEventType;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      reason: string | null;
    },
  ): Promise<void> {
    await this.repo.appendMembershipHistory(tx, {
      tenantId: ctx.tenantId,
      membershipId: row.id,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      action: input.action,
      reason: input.reason,
      correlationId: ctx.correlationId,
      changedBy: actor,
    });
    await this.audit.write(tx, ctx, {
      code: input.auditCode,
      entityType: 'tenant_membership',
      entityId: row.id,
      ...(input.reason === null ? {} : { reason: input.reason }),
      detail: { fromStatus: input.fromStatus, toStatus: input.toStatus },
    });
    await this.publish(tx, input.eventType, ctx, actor, {
      membershipId: row.id,
      tenantId: ctx.tenantId,
      identityId: row.identity_id,
      accountId: row.account_id,
      membershipType: row.membership_type,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      ...(input.reason === null ? {} : { reason: input.reason }),
    });
  }

  private async publish(
    tx: Tx,
    type: IdentityLifecycleEventType,
    ctx: RequestContext,
    actor: string | null,
    payload: IdentityLifecyclePayload,
  ): Promise<void> {
    await this.outbox.publish(tx, {
      eventId: randomUUID(),
      family: IDENTITY_LIFECYCLE_FAMILY,
      type,
      version: IDENTITY_LIFECYCLE_VERSION,
      occurredAt: new Date(),
      // The real tenant — membership events ARE tenant business, unlike identity events.
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor === null ? {} : { actor }),
      classification: 'confidential',
      payload,
    });
  }
}

/** PostgreSQL 23503 — foreign_key_violation. */
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && (error as { code?: unknown } | null)?.code === '23503';
}
