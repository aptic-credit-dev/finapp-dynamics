import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  // VALUE imports, deliberately not `import type`. NestJS resolves constructor dependencies from the
  // design-time metadata `emitDecoratorMetadata` writes, and a type-only import is erased before that
  // metadata is emitted — leaving Nest with `Function` and an UnknownDependenciesException at boot.
  ActorContextFactory,
  IdentityService,
  IDENTITY_AUDIT_CODES,
  IDENTITY_PERMISSIONS,
  requireUuidParam,
  type IdentityAction,
} from '@finapp/m02-identity';
import { identityView } from './views.ts';
import {
  actionOpts,
  nullableString,
  optionalLimit,
  optionalOffset,
  optionalString,
  requireString,
  requireVersion,
  type ActionBody,
} from './http.ts';

/**
 * The identity registry API, under `/api/v1/identities` (ADR-008).
 *
 * ROUTE PREFIX: `manifests/naming-map.yaml` registers `/api/v1/identities` to m02, substage 1B. Identity,
 * account and membership are three prefixes rather than one `/api/v1/users`, because collapsing them
 * would be the "one generic user service" the architecture forbids — they are distinct resources with
 * distinct lifecycles, distinct permissions and, crucially, distinct scopes: an identity is global, a
 * membership is a tenant's own business.
 *
 * WHAT IS DIFFERENT FROM STAGE 1A. Every handler starts by asking `ActorContextFactory` who is calling,
 * and there is no other way to find out. The controller cannot construct a context, cannot read an actor
 * header, and cannot reach the resolver's decision — it receives a proven actor or the request has
 * already been refused. `x-actor-id` has no meaning here and never did.
 *
 * THE ACTOR ARGUMENT IS THE IDENTITY, NOT THE ACCOUNT. `scoped.actor.identityId` is what lands in
 * `created_by`, in audit and in event metadata, so a person with two logins is one actor in the trail.
 */

interface CreateIdentityBody {
  identityType?: unknown;
  displayName?: unknown;
  givenName?: unknown;
  familyName?: unknown;
  primaryEmail?: unknown;
  organizationRef?: unknown;
  externalRef?: unknown;
}

@Controller('identities')
export class IdentityController {
  private readonly service: IdentityService;
  private readonly actors: ActorContextFactory;

  constructor(service: IdentityService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.registryCreate,
    auditCode: IDENTITY_AUDIT_CODES.identityCreated,
    description: 'Register an identity in draft status.',
  })
  @Post()
  async create(@Body() body: CreateIdentityBody, @Headers() headers: Record<string, string>) {
    const scoped = await this.actors.forRequest(headers, 'create identity (m02)');
    const cid = scoped.correlationId;
    const row = await this.service.createIdentity(scoped.ctx, scoped.actor.identityId, {
      identityType: requireString(body.identityType, 'identityType', cid),
      displayName: requireString(body.displayName, 'displayName', cid),
      ...optionalString(body.givenName, 'givenName'),
      ...optionalString(body.familyName, 'familyName'),
      ...optionalString(body.primaryEmail, 'primaryEmail'),
      ...optionalString(body.organizationRef, 'organizationRef'),
      ...optionalString(body.externalRef, 'externalRef'),
    });
    return identityView(row);
  }

  @Get()
  async list(
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = await this.actors.forRequest(headers, 'list identities (m02)');
    const cid = scoped.correlationId;
    const rows = await this.service.listIdentities(scoped.ctx, {
      ...(status === undefined ? {} : { status }),
      ...optionalLimit(limit, cid),
      ...optionalOffset(offset, cid),
    });
    return rows.map(identityView);
  }

  @Get(':identityId')
  async get(@Param('identityId') identityId: string, @Headers() headers: Record<string, string>) {
    const scoped = await this.actors.forRequest(headers, 'read identity (m02)');
    const row = await this.service.getIdentity(
      scoped.ctx,
      requireUuidParam(identityId, 'identityId', scoped.correlationId),
    );
    return identityView(row);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.registryEdit,
    auditCode: IDENTITY_AUDIT_CODES.identityUpdated,
    description: 'Update an identity profile. Requires expectedVersion.',
  })
  @Patch(':identityId')
  async update(
    @Param('identityId') identityId: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = await this.actors.forRequest(headers, 'update identity (m02)');
    const cid = scoped.correlationId;
    const row = await this.service.updateIdentity(
      scoped.ctx,
      scoped.actor.identityId,
      requireUuidParam(identityId, 'identityId', cid),
      {
        expectedVersion: requireVersion(body['expectedVersion'], cid),
        ...optionalString(body['displayName'], 'displayName'),
        // Nullable: a person who leaves an employer clears their organisation, and "clear it" must be
        // expressible distinctly from "leave it alone".
        ...nullableString(body, 'givenName'),
        ...nullableString(body, 'familyName'),
        ...nullableString(body, 'organizationRef'),
      },
    );
    return identityView(row);
  }

  // --- lifecycle -----------------------------------------------------------------------------------
  //
  // One route per action, each with its own permission and audit code, all delegating to the same
  // server-side state machine. The route cannot decide the transition; it can only ask for one — so a
  // caller cannot invent a path through the lifecycle that the domain does not allow.

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.registryActivate,
    auditCode: IDENTITY_AUDIT_CODES.identityActivated,
  })
  @Post(':identityId/activate')
  async activate(
    @Param('identityId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('activate', id, body, h);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.registrySuspend,
    auditCode: IDENTITY_AUDIT_CODES.identitySuspended,
  })
  @Post(':identityId/suspend')
  async suspend(
    @Param('identityId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('suspend', id, body, h);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.registryReactivate,
    auditCode: IDENTITY_AUDIT_CODES.identityReactivated,
  })
  @Post(':identityId/reactivate')
  async reactivate(
    @Param('identityId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('reactivate', id, body, h);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.registryClose,
    auditCode: IDENTITY_AUDIT_CODES.identityClosed,
  })
  @Post(':identityId/close')
  async close(
    @Param('identityId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('close', id, body, h);
  }

  private async act(
    action: IdentityAction,
    identityId: string,
    body: ActionBody,
    headers: Record<string, string>,
  ) {
    const scoped = await this.actors.forRequest(headers, `identity action: ${action} (m02)`);
    const cid = scoped.correlationId;
    const row = await this.service.applyIdentityAction(
      scoped.ctx,
      scoped.actor.identityId,
      requireUuidParam(identityId, 'identityId', cid),
      action,
      actionOpts(body, cid),
    );
    return identityView(row);
  }
}
