import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  // VALUE imports, deliberately not `import type`: NestJS resolves constructor dependencies from the
  // design-time metadata `emitDecoratorMetadata` writes, which a type-only import erases before emission.
  RoleService,
  RBAC_AUDIT_CODES,
  RBAC_PERMISSIONS,
  type RoleAction,
} from '@finapp/m02-rbac';
import { ActorContextFactory, requireUuidParam } from '@finapp/m02-identity';
import {
  actionOpts,
  nullableString,
  optionalLimit,
  optionalOffset,
  optionalString,
  requireString,
  requireTenantScope,
  requireVersion,
  type ActionBody,
} from '../identity/http.ts';
import { roleView } from './views.ts';

/**
 * Tenant custom roles, under `/api/v1/rbac` (D2). ADR-017.
 *
 * Every handler resolves its actor through `ActorContextFactory` and works in the caller's TENANT context —
 * roles are a tenant's own business, and RLS (no escape) makes a role for another tenant physically
 * unreachable rather than merely refused. The system roles (`platform_admin`, `tenant_admin`) are visible
 * and immutable: the service surfaces an edit of one as a conflict.
 *
 * Permission is enforced in `RoleService`, not here — the `@Endpoint` permission is the declaration; the
 * service is the single place it is checked, so a future non-HTTP caller cannot slip past it.
 */

interface CreateRoleBody {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  risk?: unknown;
}

interface ChangePermissionsBody {
  add?: unknown;
  remove?: unknown;
}

@Controller('rbac')
export class RolesController {
  private readonly service: RoleService;
  private readonly actors: ActorContextFactory;

  constructor(service: RoleService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: RBAC_PERMISSIONS.roleCreate,
    auditCode: RBAC_AUDIT_CODES.roleCreated,
    description: 'Create a tenant custom role in draft status.',
  })
  @Post('roles')
  async create(@Body() body: CreateRoleBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'create role (m02-rbac)'));
    const cid = scoped.correlationId;
    const row = await this.service.create(scoped.ctx, scoped.actor.identityId, {
      code: requireString(body.code, 'code', cid),
      name: requireString(body.name, 'name', cid),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.risk === 'string' ? { risk: body.risk } : {}),
    });
    return roleView(row);
  }

  @Get('roles')
  async list(
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list roles (m02-rbac)'));
    const cid = scoped.correlationId;
    const rows = await this.service.list(scoped.ctx, {
      ...(status === undefined ? {} : { status }),
      ...optionalLimit(limit, cid),
      ...optionalOffset(offset, cid),
    });
    return rows.map(roleView);
  }

  @Get('roles/:roleId')
  async get(@Param('roleId') roleId: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'read role (m02-rbac)'));
    const row = await this.service.get(scoped.ctx, requireUuidParam(roleId, 'roleId', scoped.correlationId));
    return roleView(row);
  }

  @Get('roles/:roleId/permissions')
  async permissions(@Param('roleId') roleId: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'read role permissions (m02-rbac)'));
    return {
      permissions: await this.service.permissions(
        scoped.ctx,
        requireUuidParam(roleId, 'roleId', scoped.correlationId),
      ),
    };
  }

  @Endpoint({
    permission: RBAC_PERMISSIONS.roleEdit,
    auditCode: RBAC_AUDIT_CODES.roleUpdated,
    description: 'Update a tenant role profile. Requires expectedVersion.',
  })
  @Patch('roles/:roleId')
  async update(
    @Param('roleId') roleId: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'update role (m02-rbac)'));
    const cid = scoped.correlationId;
    const row = await this.service.update(
      scoped.ctx,
      scoped.actor.identityId,
      requireUuidParam(roleId, 'roleId', cid),
      {
        expectedVersion: requireVersion(body['expectedVersion'], cid),
        ...optionalString(body['name'], 'name'),
        ...nullableString(body, 'description'),
      },
    );
    return roleView(row);
  }

  @Endpoint({
    permission: RBAC_PERMISSIONS.roleEdit,
    auditCode: RBAC_AUDIT_CODES.rolePermissionsChanged,
    description: 'Grant or remove concrete permissions on a tenant role.',
  })
  @Patch('roles/:roleId/permissions')
  async changePermissions(
    @Param('roleId') roleId: string,
    @Body() body: ChangePermissionsBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'change role permissions (m02-rbac)'));
    const cid = scoped.correlationId;
    return this.service.changePermissions(scoped.ctx, scoped.actor.identityId, requireUuidParam(roleId, 'roleId', cid), {
      ...(Array.isArray(body.add) ? { add: body.add.map((x) => String(x)) } : {}),
      ...(Array.isArray(body.remove) ? { remove: body.remove.map((x) => String(x)) } : {}),
      // Anti-escalation bound: the grantor can only confer permissions it itself holds. The set is the
      // caller's RBAC-resolved permissions, never anything the request supplied.
      grantorPermissions: scoped.ctx.permissions,
    });
  }

  // --- lifecycle -----------------------------------------------------------------------------------
  // One route per action, each with its own permission and audit code, all delegating to the same
  // server-side state machine. The route asks for a transition; it cannot invent one the domain forbids.

  @Endpoint({ permission: RBAC_PERMISSIONS.roleActivate, auditCode: RBAC_AUDIT_CODES.roleActivated })
  @Post('roles/:roleId/activate')
  async activate(@Param('roleId') id: string, @Body() body: ActionBody, @Headers() h: Record<string, string>) {
    return this.act('activate', id, body, h);
  }

  @Endpoint({ permission: RBAC_PERMISSIONS.roleSuspend, auditCode: RBAC_AUDIT_CODES.roleSuspended })
  @Post('roles/:roleId/suspend')
  async suspend(@Param('roleId') id: string, @Body() body: ActionBody, @Headers() h: Record<string, string>) {
    return this.act('suspend', id, body, h);
  }

  @Endpoint({ permission: RBAC_PERMISSIONS.roleActivate, auditCode: RBAC_AUDIT_CODES.roleActivated })
  @Post('roles/:roleId/reactivate')
  async reactivate(@Param('roleId') id: string, @Body() body: ActionBody, @Headers() h: Record<string, string>) {
    return this.act('reactivate', id, body, h);
  }

  @Endpoint({ permission: RBAC_PERMISSIONS.roleRetire, auditCode: RBAC_AUDIT_CODES.roleRetired })
  @Post('roles/:roleId/retire')
  async retire(@Param('roleId') id: string, @Body() body: ActionBody, @Headers() h: Record<string, string>) {
    return this.act('retire', id, body, h);
  }

  private async act(action: RoleAction, roleId: string, body: ActionBody, headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, `role action: ${action} (m02-rbac)`));
    const cid = scoped.correlationId;
    const row = await this.service.applyAction(
      scoped.ctx,
      scoped.actor.identityId,
      requireUuidParam(roleId, 'roleId', cid),
      action,
      actionOpts(body, cid),
    );
    return roleView(row);
  }
}
