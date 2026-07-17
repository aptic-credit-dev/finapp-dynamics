import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  ActorContextFactory,
  IdentityService,
  IDENTITY_AUDIT_CODES,
  IDENTITY_PERMISSIONS,
  requireUuidParam,
  type AccountAction,
} from '@finapp/m02-identity';
import { accountView } from './views.ts';
import { actionOpts, optionalLimit, optionalOffset, requireString, type ActionBody } from './http.ts';

/**
 * The account API, under `/api/v1/accounts` (ADR-008).
 *
 * AN ACCOUNT IS A WAY IN; AN IDENTITY IS A PERSON. They are separate resources because their lifecycles
 * are separate and must stay that way: suspending a person should not require hunting down their logins,
 * and revoking one login should not lock a person out of everything. `ActorResolver` gates on both
 * independently for exactly that reason, and this API preserves the distinction rather than offering a
 * convenience route that quietly does both.
 *
 * WHAT THIS API DOES NOT DO — and must not grow into (§10):
 *   - no passwords, no credential of any kind
 *   - no session, no token, no login
 *   - no authentication-provider subject
 * Those are Stage 1C. Creating an account here creates a `pending_activation` record and nothing that can
 * be authenticated with, which is why an account API can exist a stage before authentication does.
 */

interface CreateAccountBody {
  identityId?: unknown;
  accountType?: unknown;
  loginIdentifier?: unknown;
}

@Controller('accounts')
export class AccountController {
  private readonly service: IdentityService;
  private readonly actors: ActorContextFactory;

  constructor(service: IdentityService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.accountCreate,
    auditCode: IDENTITY_AUDIT_CODES.accountCreated,
    description: 'Create an account for an identity, in pending_activation status.',
  })
  @Post()
  async create(@Body() body: CreateAccountBody, @Headers() headers: Record<string, string>) {
    const scoped = await this.actors.forRequest(headers, 'create account (m02)');
    const cid = scoped.correlationId;
    // The linked identity's existence, type compatibility and status are validated server-side by the
    // service (§10) — a human account cannot be bound to a system identity, and a closed person cannot
    // gain a new way in. The controller states the request; it does not get to vouch for it.
    const row = await this.service.createAccount(scoped.ctx, scoped.actor.identityId, {
      identityId: requireString(body.identityId, 'identityId', cid),
      accountType: requireString(body.accountType, 'accountType', cid),
      loginIdentifier: requireString(body.loginIdentifier, 'loginIdentifier', cid),
    });
    return accountView(row);
  }

  @Get()
  async list(
    @Query('identityId') identityId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = await this.actors.forRequest(headers, 'list accounts (m02)');
    const cid = scoped.correlationId;
    const rows = await this.service.listAccounts(scoped.ctx, {
      ...(identityId === undefined ? {} : { identityId: requireUuidParam(identityId, 'identityId', cid) }),
      ...optionalLimit(limit, cid),
      ...optionalOffset(offset, cid),
    });
    return rows.map(accountView);
  }

  @Get(':accountId')
  async get(@Param('accountId') accountId: string, @Headers() headers: Record<string, string>) {
    const scoped = await this.actors.forRequest(headers, 'read account (m02)');
    const row = await this.service.getAccount(
      scoped.ctx,
      requireUuidParam(accountId, 'accountId', scoped.correlationId),
    );
    return accountView(row);
  }

  // --- lifecycle -----------------------------------------------------------------------------------

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.accountActivate,
    auditCode: IDENTITY_AUDIT_CODES.accountActivated,
  })
  @Post(':accountId/activate')
  async activate(
    @Param('accountId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('activate', id, body, h);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.accountSuspend,
    auditCode: IDENTITY_AUDIT_CODES.accountSuspended,
  })
  @Post(':accountId/suspend')
  async suspend(
    @Param('accountId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('suspend', id, body, h);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.accountReactivate,
    auditCode: IDENTITY_AUDIT_CODES.accountReactivated,
  })
  @Post(':accountId/reactivate')
  async reactivate(
    @Param('accountId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('reactivate', id, body, h);
  }

  @Endpoint({
    permission: IDENTITY_PERMISSIONS.accountDeactivate,
    auditCode: IDENTITY_AUDIT_CODES.accountDeactivated,
  })
  @Post(':accountId/deactivate')
  async deactivate(
    @Param('accountId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('deactivate', id, body, h);
  }

  private async act(
    action: AccountAction,
    accountId: string,
    body: ActionBody,
    headers: Record<string, string>,
  ) {
    const scoped = await this.actors.forRequest(headers, `account action: ${action} (m02)`);
    const cid = scoped.correlationId;
    const row = await this.service.applyAccountAction(
      scoped.ctx,
      scoped.actor.identityId,
      requireUuidParam(accountId, 'accountId', cid),
      action,
      actionOpts(body, cid),
    );
    return accountView(row);
  }
}
