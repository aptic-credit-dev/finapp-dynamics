import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint, ProblemError } from '@finapp/kernel';
import {
  AssignmentService,
  RBAC_AUDIT_CODES,
  RBAC_PERMISSIONS,
  type AssignmentAction,
} from '@finapp/m02-rbac';
import { ActorContextFactory, requireUuidParam } from '@finapp/m02-identity';
import {
  actionOpts,
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  type ActionBody,
} from '../identity/http.ts';
import { assignmentView } from './views.ts';

/**
 * Tenant role assignments, under `/api/v1/rbac` (D2). ADR-017/018/019.
 *
 * Every handler works in the caller's TENANT context, so an assignment physically cannot reference another
 * tenant (RLS, no escape). The service SoD-checks the grant and bounds it by the grantor's own permissions
 * — a caller cannot grant a role carrying a permission it does not itself hold. Enforcement lives in the
 * service; the `@Endpoint` permission is the declaration.
 */

interface GrantBody {
  membershipId?: unknown;
  roleId?: unknown;
  scopeLevel?: unknown;
  scopeRef?: unknown;
  effectiveFrom?: unknown;
  expiresAt?: unknown;
  justification?: unknown;
}

@Controller('rbac')
export class AssignmentsController {
  private readonly service: AssignmentService;
  private readonly actors: ActorContextFactory;

  constructor(service: AssignmentService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: RBAC_PERMISSIONS.assignmentGrant,
    auditCode: RBAC_AUDIT_CODES.assignmentGranted,
    description: 'Grant a role to a tenant membership at a scope.',
  })
  @Post('assignments')
  async grant(@Body() body: GrantBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'grant role (m02-rbac)'));
    const cid = scoped.correlationId;
    const row = await this.service.grant(scoped.ctx, scoped.actor.identityId, {
      membershipId: requireUuidParam(requireString(body.membershipId, 'membershipId', cid), 'membershipId', cid),
      roleId: requireUuidParam(requireString(body.roleId, 'roleId', cid), 'roleId', cid),
      ...(typeof body.scopeLevel === 'string' ? { scopeLevel: body.scopeLevel } : {}),
      ...(typeof body.scopeRef === 'string' ? { scopeRef: body.scopeRef } : {}),
      ...optionalDate(body.effectiveFrom, 'effectiveFrom', cid),
      ...optionalDate(body.expiresAt, 'expiresAt', cid),
      ...(typeof body.justification === 'string' ? { justification: body.justification } : {}),
      // The grantor may only confer permissions it itself holds — the caller's RBAC-resolved set, never
      // anything the request carried.
      grantorPermissions: scoped.ctx.permissions,
    });
    return assignmentView(row);
  }

  @Get('assignments')
  async list(
    @Query('membershipId') membershipId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list assignments (m02-rbac)'));
    const cid = scoped.correlationId;
    const rows = await this.service.list(scoped.ctx, {
      ...(membershipId === undefined ? {} : { membershipId }),
      ...(status === undefined ? {} : { status }),
      ...optionalLimit(limit, cid),
      ...optionalOffset(offset, cid),
    });
    return rows.map(assignmentView);
  }

  @Get('assignments/:assignmentId')
  async get(@Param('assignmentId') assignmentId: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'read assignment (m02-rbac)'));
    const row = await this.service.get(
      scoped.ctx,
      requireUuidParam(assignmentId, 'assignmentId', scoped.correlationId),
    );
    return assignmentView(row);
  }

  @Endpoint({ permission: RBAC_PERMISSIONS.assignmentRevoke, auditCode: RBAC_AUDIT_CODES.assignmentRevoked })
  @Post('assignments/:assignmentId/revoke')
  async revoke(@Param('assignmentId') id: string, @Body() body: ActionBody, @Headers() h: Record<string, string>) {
    return this.act('revoke', id, body, h);
  }

  @Endpoint({ permission: RBAC_PERMISSIONS.assignmentRevoke, auditCode: RBAC_AUDIT_CODES.assignmentRevoked })
  @Post('assignments/:assignmentId/suspend')
  async suspend(@Param('assignmentId') id: string, @Body() body: ActionBody, @Headers() h: Record<string, string>) {
    return this.act('suspend', id, body, h);
  }

  @Endpoint({ permission: RBAC_PERMISSIONS.assignmentRevoke, auditCode: RBAC_AUDIT_CODES.assignmentRevoked })
  @Post('assignments/:assignmentId/reactivate')
  async reactivate(@Param('assignmentId') id: string, @Body() body: ActionBody, @Headers() h: Record<string, string>) {
    return this.act('reactivate', id, body, h);
  }

  private async act(action: AssignmentAction, id: string, body: ActionBody, headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, `assignment action: ${action} (m02-rbac)`));
    const cid = scoped.correlationId;
    const row = await this.service.applyAction(
      scoped.ctx,
      scoped.actor.identityId,
      requireUuidParam(id, 'assignmentId', cid),
      action,
      actionOpts(body, cid),
    );
    return assignmentView(row);
  }
}

/** An optional ISO-8601 timestamp. A present-but-unparseable value is a client error, not a silent null. */
function optionalDate<K extends string>(value: unknown, field: K, correlationId: string): Partial<Record<K, Date>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') throw badRequest(`${field} must be an ISO-8601 string.`, correlationId);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw badRequest(`${field} is not a valid ISO-8601 timestamp.`, correlationId);
  return { [field]: new Date(ms) } as Record<K, Date>;
}

function badRequest(detail: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Bad Request',
    status: 400,
    detail,
    correlationId,
  });
}
