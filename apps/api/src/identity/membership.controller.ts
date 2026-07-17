import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  ActorContextFactory,
  MembershipService,
  IDENTITY_AUDIT_CODES,
  IDENTITY_PERMISSIONS,
  requireUuidParam,
  type MembershipAction,
} from '@finapp/m02-identity';
import { membershipView } from './views.ts';
import {
  actionOpts,
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  requireVersion,
  type ActionBody,
} from './http.ts';

/**
 * The tenant membership API, under `/api/v1/tenant-memberships` (ADR-008).
 *
 * MEMBERSHIP IS THE ONLY PART OF IDENTITY A TENANT MAY SEE. Identities and accounts are global — a person
 * exists once across the platform — but their relationship with a tenant is that tenant's business and
 * nobody else's. That asymmetry is enforced by the database, not by this controller:
 * `tenant_memberships` is tenant-scoped with FORCE RLS and, unlike the identity plane, has NO system
 * escape. So there is no cross-tenant read to be had here even from `Db.withSystem`.
 *
 * WHY EVERY ROUTE DEMANDS A TENANT. `requireTenantScope` narrows the request or refuses. It is not a
 * formality: `MembershipService` takes a `RequestContext`, and a `RequestContext` cannot exist without a
 * proven membership of the tenant it names. So reaching a handler here already means the caller proved —
 * against the database — that they belong to the tenant whose memberships they are about to touch.
 *
 * NON-DISCLOSURE (§11). A membership in another tenant is invisible rather than forbidden: RLS returns no
 * row, the service raises `notFound`, and the caller cannot distinguish "does not exist" from "exists,
 * elsewhere". A 403 here would confirm the record is real, which is the whole thing worth hiding.
 */

interface CreateMembershipBody {
  identityId?: unknown;
  accountId?: unknown;
  membershipType?: unknown;
  isPrimary?: unknown;
  entityId?: unknown;
  departmentId?: unknown;
  branchId?: unknown;
  environmentId?: unknown;
}

@Controller('tenant-memberships')
export class MembershipController {
  private readonly service: MembershipService;
  private readonly actors: ActorContextFactory;

  constructor(service: MembershipService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.membershipCreate,
    auditCode: IDENTITY_AUDIT_CODES.membershipCreated,
    description: 'Grant an identity membership of the current tenant, in pending status.',
  })
  @Post()
  async create(@Body() body: CreateMembershipBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'create membership (m02)'));
    const cid = scoped.correlationId;
    // The tenant is never taken from the body — it is `ctx.tenantId`, which exists only because the actor
    // proved membership of it. A `tenantId` field here would be a cross-tenant write waiting to happen.
    const row = await this.service.create(scoped.ctx, scoped.actor.identityId, {
      identityId: requireString(body.identityId, 'identityId', cid),
      membershipType: requireString(body.membershipType, 'membershipType', cid),
      ...(typeof body.accountId === 'string' ? { accountId: body.accountId } : {}),
      ...(typeof body.isPrimary === 'boolean' ? { isPrimary: body.isPrimary } : {}),
      ...(typeof body.entityId === 'string' ? { entityId: body.entityId } : {}),
      ...(typeof body.departmentId === 'string' ? { departmentId: body.departmentId } : {}),
      ...(typeof body.branchId === 'string' ? { branchId: body.branchId } : {}),
      ...(typeof body.environmentId === 'string' ? { environmentId: body.environmentId } : {}),
    });
    return membershipView(row);
  }

  @Get()
  async list(
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list memberships (m02)'));
    const cid = scoped.correlationId;
    const rows = await this.service.list(scoped.ctx, {
      ...(status === undefined ? {} : { status }),
      ...optionalLimit(limit, cid),
      ...optionalOffset(offset, cid),
    });
    return rows.map(membershipView);
  }

  @Get(':membershipId')
  async get(@Param('membershipId') membershipId: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'read membership (m02)'));
    const row = await this.service.get(
      scoped.ctx,
      requireUuidParam(membershipId, 'membershipId', scoped.correlationId),
    );
    return membershipView(row);
  }

  // --- lifecycle -----------------------------------------------------------------------------------

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.membershipActivate,
    auditCode: IDENTITY_AUDIT_CODES.membershipActivated,
  })
  @Post(':membershipId/activate')
  async activate(
    @Param('membershipId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('activate', id, body, h);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.membershipSuspend,
    auditCode: IDENTITY_AUDIT_CODES.membershipSuspended,
  })
  @Post(':membershipId/suspend')
  async suspend(
    @Param('membershipId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('suspend', id, body, h);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.membershipReactivate,
    auditCode: IDENTITY_AUDIT_CODES.membershipReactivated,
  })
  @Post(':membershipId/reactivate')
  async reactivate(
    @Param('membershipId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('reactivate', id, body, h);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.membershipEnd,
    auditCode: IDENTITY_AUDIT_CODES.membershipEnded,
  })
  @Post(':membershipId/end')
  async end(
    @Param('membershipId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('end', id, body, h);
  }

  /**
   * Rescoping — `identity.membership.scope` is a registered permission and `changeScope` is implemented,
   * so the route is approved rather than invented here (§11).
   *
   * The composite foreign keys guarantee the named entity, department or branch is in THIS tenant; there
   * is no check in this file that could be forgotten.
   */
  @Endpoint({
    permission: IDENTITY_PERMISSIONS.membershipScope,
    auditCode: IDENTITY_AUDIT_CODES.membershipScopeChanged,
    description: 'Change a membership organisational scope. Requires expectedVersion.',
  })
  @Post(':membershipId/scope')
  async scope(
    @Param('membershipId') membershipId: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'change membership scope (m02)'));
    const cid = scoped.correlationId;
    const row = await this.service.changeScope(
      scoped.ctx,
      scoped.actor.identityId,
      requireUuidParam(membershipId, 'membershipId', cid),
      {
        expectedVersion: requireVersion(body['expectedVersion'], cid),
        // Nullable throughout: removing someone from a department is as real an operation as moving them.
        ...scopeField(body, 'entityId'),
        ...scopeField(body, 'departmentId'),
        ...scopeField(body, 'branchId'),
      },
    );
    return membershipView(row);
  }

  private async act(
    action: MembershipAction,
    membershipId: string,
    body: ActionBody,
    headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, `membership action: ${action} (m02)`),
    );
    const cid = scoped.correlationId;
    const row = await this.service.applyAction(
      scoped.ctx,
      scoped.actor.identityId,
      requireUuidParam(membershipId, 'membershipId', cid),
      action,
      actionOpts(body, cid),
    );
    return membershipView(row);
  }
}

/** `null` clears the scope, absence leaves it. Anything else is ignored rather than guessed at. */
function scopeField<K extends string>(
  body: Record<string, unknown>,
  field: K,
): Partial<Record<K, string | null>> {
  if (!(field in body)) return {};
  const value = body[field];
  if (value === null) return { [field]: null } as Record<K, null>;
  return typeof value === 'string' ? ({ [field]: value } as Record<K, string>) : {};
}
