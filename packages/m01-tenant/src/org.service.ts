import {
  ProblemError,
  type Audit,
  type Authz,
  type Db,
  type Outbox,
  type RequestContext,
  type Tx,
} from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  OrgRepository,
  type BranchRow,
  type DepartmentRow,
  type EntityRow,
  type EnvironmentRow,
} from './org-repository.ts';
import { TenantRepository } from './repository.ts';
import { tenantLifecycleEvent } from './events.ts';
import { TENANT_AUDIT_CODES } from './audit-codes.ts';
import { TENANT_PERMISSIONS } from './permissions.ts';
import { validateEnvironment, validateOrgNode, wouldCreateCycle } from './domain/org.ts';
import { allowsBusinessWrites } from './domain/tenant-status.ts';

/**
 * Tenant environments and organisational scope.
 *
 * Everything here is tenant-scoped: the tables carry `tenant_id`, RLS FORCE is on, and the policies have
 * no system escape. So unlike `TenantService`, these operations only ever run in tenant context — there
 * is no cross-tenant read to be had even from `withSystem`.
 */
export class OrgService {
  // Explicit fields, not parameter properties — strip-types cannot compile those. See tenant.service.ts.
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  private readonly repo: OrgRepository;
  private readonly tenants: TenantRepository;

  constructor(
    db: Db,
    authz: Authz,
    audit: Audit,
    outbox: Outbox<DomainEvent>,
    repo: OrgRepository = new OrgRepository(),
    tenants: TenantRepository = new TenantRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.audit = audit;
    this.outbox = outbox;
    this.repo = repo;
    this.tenants = tenants;
  }

  // --- environments -------------------------------------------------------------------------------

  async listEnvironments(ctx: RequestContext): Promise<EnvironmentRow[]> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.environmentView);
    return this.db.withTenant(ctx, (tx) => this.repo.listEnvironments(tx));
  }

  async createEnvironment(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; environmentType: string; region?: string | null; isDefault?: boolean },
  ): Promise<EnvironmentRow> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.environmentManage);

    const problems = validateEnvironment({
      code: input.code,
      environmentType: input.environmentType,
      isDefault: input.isDefault ?? false,
    });
    if (problems.length > 0) throw badRequest(problems, ctx.correlationId);

    return this.db.withTenant(ctx, async (tx) => {
      await this.requireWritableTenant(tx, ctx);

      const isDefault = input.isDefault ?? false;
      // One default per tenant is enforced by a partial unique index; demote the incumbent first, in the
      // same transaction, so the two writes are never briefly both default and never briefly neither.
      if (isDefault) await this.repo.clearDefaultEnvironment(tx);

      let row: EnvironmentRow;
      try {
        row = await this.repo.insertEnvironment(tx, {
          tenantId: ctx.tenantId,
          code: input.code,
          environmentType: input.environmentType,
          region: input.region ?? null,
          isDefault,
          createdBy: actor,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw ProblemError.conflict(
            `Environment code "${input.code}" already exists for this tenant.`,
            ctx.correlationId,
          );
        }
        throw error;
      }

      await this.audit.write(tx, ctx, {
        code: TENANT_AUDIT_CODES.environmentCreated,
        entityType: 'tenant_environment',
        entityId: row.id,
        detail: { code: row.code, environmentType: row.environment_type, isDefault: row.is_default },
      });

      await this.outbox.publish(
        tx,
        tenantLifecycleEvent({
          type: 'TenantEnvironmentCreated',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor === null ? {} : { actor }),
          occurredAt: new Date(),
          payload: {
            tenantId: ctx.tenantId,
            environmentId: row.id,
            environmentCode: row.code,
            environmentType: row.environment_type,
            isDefault: row.is_default,
          },
        }),
      );

      return row;
    });
  }

  // --- entities -----------------------------------------------------------------------------------

  async listEntities(ctx: RequestContext): Promise<EntityRow[]> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.entityView);
    return this.db.withTenant(ctx, (tx) => this.repo.listEntities(tx));
  }

  async createEntity(
    ctx: RequestContext,
    actor: string | null,
    input: {
      code: string;
      legalName: string;
      tradingName?: string | null;
      parentEntityId?: string | null;
      country?: string | null;
      effectiveFrom?: Date;
      effectiveTo?: Date | null;
    },
  ): Promise<EntityRow> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.entityManage);

    const effectiveFrom = input.effectiveFrom ?? new Date();
    const problems = validateOrgNode({
      kind: 'entity',
      code: input.code,
      name: input.legalName,
      parentId: input.parentEntityId ?? null,
      effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
    });
    if (problems.length > 0) throw badRequest(problems, ctx.correlationId);

    return this.db.withTenant(ctx, async (tx) => {
      await this.requireWritableTenant(tx, ctx);

      const parentId = input.parentEntityId ?? null;
      if (parentId !== null) {
        // The composite FK already guarantees the parent is in THIS tenant — a parent in another tenant
        // is invisible here and the FK fails. This check is about existence, for a clear 400.
        const parent = await this.repo.findEntity(tx, parentId);
        if (parent === null) {
          throw badRequest([`Parent entity ${parentId} does not exist in this tenant.`], ctx.correlationId);
        }
      }

      const row = await this.insertOrConflict(ctx, 'Entity', input.code, () =>
        this.repo.insertEntity(tx, {
          tenantId: ctx.tenantId,
          code: input.code,
          legalName: input.legalName,
          tradingName: input.tradingName ?? null,
          parentEntityId: parentId,
          country: input.country ?? null,
          effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          createdBy: actor,
        }),
      );

      await this.recordOrgNode(tx, ctx, actor, {
        auditCode: TENANT_AUDIT_CODES.entityCreated,
        entityType: 'tenant_entity',
        eventType: 'TenantEntityCreated',
        nodeId: row.id,
        nodeCode: row.code,
        nodeKind: 'entity',
        parentId,
        entityId: null,
      });

      return row;
    });
  }

  // --- departments --------------------------------------------------------------------------------

  async listDepartments(ctx: RequestContext): Promise<DepartmentRow[]> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.departmentView);
    return this.db.withTenant(ctx, (tx) => this.repo.listDepartments(tx));
  }

  async createDepartment(
    ctx: RequestContext,
    actor: string | null,
    input: {
      entityId: string;
      code: string;
      name: string;
      parentDepartmentId?: string | null;
      effectiveFrom?: Date;
      effectiveTo?: Date | null;
    },
  ): Promise<DepartmentRow> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.departmentManage);

    const effectiveFrom = input.effectiveFrom ?? new Date();
    const problems = validateOrgNode({
      kind: 'department',
      code: input.code,
      name: input.name,
      parentId: input.parentDepartmentId ?? null,
      effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
    });
    if (problems.length > 0) throw badRequest(problems, ctx.correlationId);

    return this.db.withTenant(ctx, async (tx) => {
      await this.requireWritableTenant(tx, ctx);

      const parentId = input.parentDepartmentId ?? null;
      if (parentId !== null) {
        // A → B → A is not expressible as a constraint; a cycle would make every recursive scope query
        // spin. Checked here, before the write.
        const ancestors = await this.repo.departmentAncestors(tx, parentId);
        if (wouldCreateCycle('', parentId, ancestors) && ancestors.includes(parentId)) {
          throw badRequest(['Department parent would create a cycle.'], ctx.correlationId);
        }
      }

      const row = await this.insertOrConflict(ctx, 'Department', input.code, () =>
        this.repo.insertDepartment(tx, {
          tenantId: ctx.tenantId,
          entityId: input.entityId,
          parentDepartmentId: parentId,
          code: input.code,
          name: input.name,
          effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          createdBy: actor,
        }),
      );

      await this.recordOrgNode(tx, ctx, actor, {
        auditCode: TENANT_AUDIT_CODES.departmentCreated,
        entityType: 'tenant_department',
        eventType: 'TenantDepartmentCreated',
        nodeId: row.id,
        nodeCode: row.code,
        nodeKind: 'department',
        parentId,
        entityId: input.entityId,
      });

      return row;
    });
  }

  // --- branches -----------------------------------------------------------------------------------

  async listBranches(ctx: RequestContext): Promise<BranchRow[]> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.branchView);
    return this.db.withTenant(ctx, (tx) => this.repo.listBranches(tx));
  }

  async createBranch(
    ctx: RequestContext,
    actor: string | null,
    input: {
      entityId: string;
      code: string;
      name: string;
      country?: string | null;
      effectiveFrom?: Date;
      effectiveTo?: Date | null;
    },
  ): Promise<BranchRow> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.branchManage);

    const effectiveFrom = input.effectiveFrom ?? new Date();
    const problems = validateOrgNode({
      kind: 'branch',
      code: input.code,
      name: input.name,
      parentId: null,
      effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
    });
    if (problems.length > 0) throw badRequest(problems, ctx.correlationId);

    return this.db.withTenant(ctx, async (tx) => {
      await this.requireWritableTenant(tx, ctx);

      const row = await this.insertOrConflict(ctx, 'Branch', input.code, () =>
        this.repo.insertBranch(tx, {
          tenantId: ctx.tenantId,
          entityId: input.entityId,
          code: input.code,
          name: input.name,
          country: input.country ?? null,
          effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          createdBy: actor,
        }),
      );

      await this.recordOrgNode(tx, ctx, actor, {
        auditCode: TENANT_AUDIT_CODES.branchCreated,
        entityType: 'tenant_branch',
        eventType: 'TenantBranchCreated',
        nodeId: row.id,
        nodeCode: row.code,
        nodeKind: 'branch',
        parentId: null,
        entityId: input.entityId,
      });

      return row;
    });
  }

  /** Retires or reinstates an org node. ADR-010: status + removed_at, never a DELETE. */
  async changeOrgStatus(
    ctx: RequestContext,
    actor: string | null,
    kind: 'entity' | 'department' | 'branch',
    id: string,
    input: { status: string; expectedVersion: number },
  ): Promise<Record<string, unknown>> {
    const permission = {
      entity: TENANT_PERMISSIONS.entityManage,
      department: TENANT_PERMISSIONS.departmentManage,
      branch: TENANT_PERMISSIONS.branchManage,
    }[kind];
    await this.authz.require(ctx, permission);

    const table = {
      entity: 'tenant_entities',
      department: 'tenant_departments',
      branch: 'tenant_branches',
    }[kind] as 'tenant_entities' | 'tenant_departments' | 'tenant_branches';

    return this.db.withTenant(ctx, async (tx) => {
      await this.requireWritableTenant(tx, ctx);

      const row = await this.repo.setOrgStatus(tx, table, {
        id,
        expectedVersion: input.expectedVersion,
        status: input.status,
        actor,
      });
      if (row === null) {
        throw ProblemError.conflict(
          `${kind} not found at version ${input.expectedVersion}. Re-read and retry.`,
          ctx.correlationId,
        );
      }

      await this.audit.write(tx, ctx, {
        code: TENANT_AUDIT_CODES.orgStatusChanged,
        entityType: `tenant_${kind}`,
        entityId: id,
        detail: { kind, toStatus: input.status },
      });

      return row as unknown as Record<string, unknown>;
    });
  }

  // --- shared -------------------------------------------------------------------------------------

  /**
   * Org structure may only be changed while the tenant is `active`.
   *
   * Tenant status enforcement lives here rather than in a route guard so that it cannot be bypassed by a
   * caller who finds another way in. A suspended tenant is suspended for a reason — usually commercial or
   * compliance — and quietly letting it restructure its subsidiaries would defeat the point.
   */
  private async requireWritableTenant(tx: Tx, ctx: RequestContext): Promise<void> {
    const tenant = await this.tenants.findById(tx, ctx.tenantId);
    if (tenant === null) throw ProblemError.notFound('Tenant not found.', ctx.correlationId);
    if (!allowsBusinessWrites(tenant.status)) {
      throw ProblemError.conflict(
        `Tenant is ${tenant.status}; organisational changes require an active tenant.`,
        ctx.correlationId,
      );
    }
  }

  private async insertOrConflict<T>(
    ctx: RequestContext,
    kind: string,
    code: string,
    insert: () => Promise<T>,
  ): Promise<T> {
    try {
      return await insert();
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw ProblemError.conflict(
          `${kind} code "${code}" already exists for this tenant.`,
          ctx.correlationId,
        );
      }
      if (isForeignKeyViolation(error)) {
        throw badRequest(
          [`${kind} references a record that does not exist in this tenant.`],
          ctx.correlationId,
        );
      }
      throw error;
    }
  }

  private async recordOrgNode(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    input: {
      auditCode: string;
      entityType: string;
      eventType: 'TenantEntityCreated' | 'TenantDepartmentCreated' | 'TenantBranchCreated';
      nodeId: string;
      nodeCode: string;
      nodeKind: string;
      parentId: string | null;
      entityId: string | null;
    },
  ): Promise<void> {
    await this.audit.write(tx, ctx, {
      code: input.auditCode,
      entityType: input.entityType,
      entityId: input.nodeId,
      detail: { code: input.nodeCode, parentId: input.parentId, entityId: input.entityId },
    });

    await this.outbox.publish(
      tx,
      tenantLifecycleEvent({
        type: input.eventType,
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor === null ? {} : { actor }),
        occurredAt: new Date(),
        payload: {
          tenantId: ctx.tenantId,
          nodeId: input.nodeId,
          nodeCode: input.nodeCode,
          nodeKind: input.nodeKind,
          parentId: input.parentId,
          entityId: input.entityId,
        },
      }),
    );
  }
}

function badRequest(problems: readonly string[], correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Bad Request',
    status: 400,
    detail: problems.join(' '),
    correlationId,
  });
}

/** PostgreSQL 23505 — unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && (error as { code?: unknown } | null)?.code === '23505';
}

/** PostgreSQL 23503 — foreign_key_violation. */
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && (error as { code?: unknown } | null)?.code === '23503';
}
