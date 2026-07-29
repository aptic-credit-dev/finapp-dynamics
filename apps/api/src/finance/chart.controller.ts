import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ChartService, M19_AUDIT_CODES, M19_PERMISSIONS } from '@finapp/m19-finance';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { accountView, accountHistoryView } from './views.ts';

/**
 * The chart of accounts / ledger account and its lifecycle through the ONE choke point `checkAccountTransition`
 * (draft → active <-> inactive → archived; archived is terminal), under `/api/v1/finance`. `postable` is the flag
 * downstream posting (m21) reads before referencing an account on a journal line; m19 never posts and carries NO
 * monetary amounts — this is the account DEFINITION, not its ledger money (ADR-007). Permission enforced in
 * ChartService (default deny). Read (GET) routes carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optBool<K extends string>(v: unknown, k: K): Partial<Record<K, boolean>> {
  return typeof v === 'boolean' ? ({ [k]: v } as Record<K, boolean>) : {};
}

@Controller('finance')
export class FinanceChartController {
  private readonly service: ChartService;
  private readonly actors: ActorContextFactory;
  constructor(service: ChartService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- create (draft) ---------------------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.accountCreate,
    auditCode: M19_AUDIT_CODES.accountCreated,
    description: 'Create a ledger account (draft).',
  })
  @Post('accounts')
  async createAccount(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create account (m19)');
    return accountView(
      await this.service.createAccount(s.ctx, s.actor.identityId, {
        entityId: requireString(b['entityId'], 'entityId', s.correlationId),
        accountTypeId: requireString(b['accountTypeId'], 'accountTypeId', s.correlationId),
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        ...optStr(b['parentAccountId'], 'parentAccountId'),
        ...optStr(b['currencyId'], 'currencyId'),
        ...optStr(b['description'], 'description'),
        ...optBool(b['postable'], 'postable'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.accountUpdate,
    auditCode: M19_AUDIT_CODES.accountUpdated,
    description: 'Update a draft/active ledger account.',
  })
  @Post('accounts/:id')
  async updateAccount(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update account (m19)');
    return accountView(
      await this.service.updateAccount(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['name'], 'name'),
        ...optStr(b['description'], 'description'),
        ...optStr(b['accountTypeId'], 'accountTypeId'),
        ...optStr(b['parentAccountId'], 'parentAccountId'),
        ...optStr(b['currencyId'], 'currencyId'),
        ...optBool(b['postable'], 'postable'),
      }),
    );
  }

  // --- lifecycle (single choke point) -----------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.accountActivate,
    auditCode: M19_AUDIT_CODES.accountActivated,
    description: 'Activate a ledger account.',
  })
  @Post('accounts/:id/activate')
  async activateAccount(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'activate account (m19)');
    return accountView(
      await this.service.activateAccount(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.accountDeactivate,
    auditCode: M19_AUDIT_CODES.accountDeactivated,
    description: 'Deactivate a ledger account.',
  })
  @Post('accounts/:id/deactivate')
  async deactivateAccount(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'deactivate account (m19)');
    return accountView(
      await this.service.deactivateAccount(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.accountArchive,
    auditCode: M19_AUDIT_CODES.accountArchived,
    description: 'Archive a ledger account (terminal).',
  })
  @Post('accounts/:id/archive')
  async archiveAccount(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'archive account (m19)');
    return accountView(
      await this.service.archiveAccount(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('accounts')
  async listAccounts(
    @Headers() h: Record<string, string>,
    @Query('entityId') entityId?: string,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list accounts (m19)');
    const rows = await this.service.listAccounts(s.ctx, {
      ...optStr(entityId, 'entityId'),
      ...optStr(status, 'status'),
    });
    return { accounts: rows.map(accountView) };
  }
  @Get('accounts/:id')
  async getAccount(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get account (m19)');
    return accountView(await this.service.getAccount(s.ctx, id));
  }
  @Get('accounts/:id/history')
  async listAccountHistory(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list account history (m19)');
    return { history: (await this.service.listAccountHistory(s.ctx, id)).map(accountHistoryView) };
  }
}
