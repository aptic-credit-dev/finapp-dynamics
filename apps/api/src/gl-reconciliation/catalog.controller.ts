import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M20_AUDIT_CODES, M20_PERMISSIONS } from '@finapp/m20-glrecon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { accountView, rulesetView, ruleView, rulesetHistoryView } from './views.ts';

/**
 * GL-reconciliation catalogue — accounts + versioned matching rulesets/rules, under `/api/v1/gl-reconciliation`. A
 * ruleset is immutable after publish (one active per code). Permission enforced in CatalogService (default deny);
 * read (GET) routes carry no `@Endpoint`. Amount tolerance is INTEGER MINOR UNITS (a number in), never a float.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}
function optBool<K extends string>(v: unknown, k: K): Partial<Record<K, boolean>> {
  return typeof v === 'boolean' ? ({ [k]: v } as Record<K, boolean>) : {};
}

@Controller('gl-reconciliation')
export class GlreconCatalogController {
  private readonly service: CatalogService;
  private readonly actors: ActorContextFactory;
  constructor(service: CatalogService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- GL accounts ------------------------------------------------------------------------------
  @Endpoint({
    permission: M20_PERMISSIONS.accountManage,
    auditCode: M20_AUDIT_CODES.accountRegistered,
    description: 'Register a GL reconciliation account.',
  })
  @Post('accounts')
  async register(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register account (m20)');
    return accountView(
      await this.service.registerAccount(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        ...optStr(b['normalSide'], 'normalSide'),
        ...optStr(b['sourceSystem'], 'sourceSystem'),
        ...optStr(b['glAccountRef'], 'glAccountRef'),
        ...optStr(b['currencyRef'], 'currencyRef'),
      }),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.accountManage,
    auditCode: M20_AUDIT_CODES.accountUpdated,
    description: 'Update a GL reconciliation account.',
  })
  @Post('accounts/:id/update')
  async update(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update account (m20)');
    return accountView(
      await this.service.updateAccount(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        {
          ...optStr(b['name'], 'name'),
          ...optStr(b['sourceSystem'], 'sourceSystem'),
          ...optStr(b['normalSide'], 'normalSide'),
          ...optStr(b['glAccountRef'], 'glAccountRef'),
          ...optStr(b['currencyRef'], 'currencyRef'),
        },
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.accountDeactivate,
    auditCode: M20_AUDIT_CODES.accountDeactivated,
    description: 'Deactivate a GL reconciliation account.',
  })
  @Post('accounts/:id/deactivate')
  async deactivate(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'deactivate account (m20)');
    return accountView(
      await this.service.deactivateAccount(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('accounts')
  async listAccounts(@Headers() h: Record<string, string>, @Query('status') status?: string) {
    const s = await this.scoped(h, 'list accounts (m20)');
    return { accounts: (await this.service.listAccounts(s.ctx, status)).map(accountView) };
  }
  @Get('accounts/:id')
  async getAccount(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get account (m20)');
    return accountView(await this.service.getAccount(s.ctx, id));
  }

  // --- rulesets + rules -------------------------------------------------------------------------
  @Endpoint({
    permission: M20_PERMISSIONS.rulesetManage,
    auditCode: M20_AUDIT_CODES.rulesetCreated,
    description: 'Create a draft matching ruleset.',
  })
  @Post('rulesets')
  async createRuleset(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create ruleset (m20)');
    return rulesetView(
      await this.service.createRuleset(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        ...optStr(b['name'], 'name'),
        ...optNum(b['dateWindowDays'], 'dateWindowDays'),
        ...optNum(b['amountToleranceMinor'], 'amountToleranceMinor'),
        ...optBool(b['requireOppositeDirection'], 'requireOppositeDirection'),
      }),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.rulesetManage,
    auditCode: M20_AUDIT_CODES.ruleAdded,
    description: 'Add a rule to a draft ruleset.',
  })
  @Post('rulesets/:id/rules')
  async addRule(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add rule (m20)');
    return ruleView(
      await this.service.addRule(s.ctx, s.actor.identityId, id, {
        ruleCode: requireString(b['ruleCode'], 'ruleCode', s.correlationId),
        ruleKind: requireString(b['ruleKind'], 'ruleKind', s.correlationId),
        ...optNum(b['weight'], 'weight'),
        ...optNum(b['priority'], 'priority'),
      }),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.rulesetPublish,
    auditCode: M20_AUDIT_CODES.rulesetPublished,
    description: 'Publish a matching ruleset (immutable after publish).',
  })
  @Post('rulesets/:id/publish')
  async publishRuleset(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish ruleset (m20)');
    return rulesetView(
      await this.service.publishRuleset(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('rulesets')
  async listRulesets(
    @Headers() h: Record<string, string>,
    @Query('code') code?: string,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list rulesets (m20)');
    const rows = await this.service.listRulesets(s.ctx, {
      ...optStr(code, 'code'),
      ...optStr(status, 'status'),
    });
    return { rulesets: rows.map(rulesetView) };
  }
  @Get('rulesets/:id')
  async getRuleset(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get ruleset (m20)');
    return rulesetView(await this.service.getRuleset(s.ctx, id));
  }
  @Get('rulesets/:id/rules')
  async listRules(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list rules (m20)');
    return { rules: (await this.service.listRules(s.ctx, id)).map(ruleView) };
  }
  @Get('rulesets/:id/history')
  async listRulesetHistory(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list ruleset history (m20)');
    return { history: (await this.service.listRulesetHistory(s.ctx, id)).map(rulesetHistoryView) };
  }
}
