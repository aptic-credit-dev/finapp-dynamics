import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M15_AUDIT_CODES, M15_PERMISSIONS } from '@finapp/m15-recon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { bankAccountView, rulesetView, ruleView, rulesetHistoryView } from './views.ts';

/**
 * Reconciliation reference data — the bank accounts to reconcile and the versioned matching RULESETS + rules the
 * deterministic engine (m15a) consumes, under `/api/v1/reconciliation`. A ruleset is PUBLISHABLE + IMMUTABLE-after-
 * publish (draft → active → superseded); a published ruleset is frozen and a change is a NEW version (supersession).
 * The amount tolerance is INTEGER MINOR UNITS carried as a STRING out (ADR-007), never a float. The raw account
 * number is never accepted nor echoed — only the pre-masked `accountRefMasked`. Permission enforced in
 * CatalogService (default deny). Read (GET) routes carry no `@Endpoint` — the read permission is enforced in-service.
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

@Controller('reconciliation')
export class ReconciliationCatalogController {
  private readonly service: CatalogService;
  private readonly actors: ActorContextFactory;
  constructor(service: CatalogService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- bank account -----------------------------------------------------------------------------
  @Endpoint({
    permission: M15_PERMISSIONS.bankAccountManage,
    auditCode: M15_AUDIT_CODES.bankAccountRegistered,
    description: 'Register a bank account to reconcile.',
  })
  @Post('bank-accounts')
  async registerBankAccount(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register bank account (m15)');
    return bankAccountView(
      await this.service.registerBankAccount(s.ctx, s.actor.identityId, {
        bankName: requireString(b['bankName'], 'bankName', s.correlationId),
        accountLabel: requireString(b['accountLabel'], 'accountLabel', s.correlationId),
        ...optStr(b['entityRef'], 'entityRef'),
        ...optStr(b['currencyRef'], 'currencyRef'),
        ...optStr(b['accountRefMasked'], 'accountRefMasked'),
        ...optStr(b['branch'], 'branch'),
      }),
    );
  }
  @Endpoint({
    permission: M15_PERMISSIONS.bankAccountManage,
    auditCode: M15_AUDIT_CODES.bankAccountUpdated,
    description: 'Update a bank account.',
  })
  @Post('bank-accounts/:id')
  async updateBankAccount(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update bank account (m15)');
    return bankAccountView(
      await this.service.updateBankAccount(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['bankName'], 'bankName'),
        ...optStr(b['accountLabel'], 'accountLabel'),
        ...optStr(b['accountRefMasked'], 'accountRefMasked'),
        ...optStr(b['branch'], 'branch'),
        ...optStr(b['entityRef'], 'entityRef'),
        ...optStr(b['currencyRef'], 'currencyRef'),
      }),
    );
  }
  @Endpoint({
    permission: M15_PERMISSIONS.bankAccountDeactivate,
    auditCode: M15_AUDIT_CODES.bankAccountDeactivated,
    description: 'Deactivate a bank account.',
  })
  @Post('bank-accounts/:id/deactivate')
  async deactivateBankAccount(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'deactivate bank account (m15)');
    return bankAccountView(
      await this.service.deactivateBankAccount(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('bank-accounts')
  async listBankAccounts(@Headers() h: Record<string, string>, @Query('status') status?: string) {
    const s = await this.scoped(h, 'list bank accounts (m15)');
    return { bankAccounts: (await this.service.listBankAccounts(s.ctx, status)).map(bankAccountView) };
  }
  @Get('bank-accounts/:id')
  async getBankAccount(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get bank account (m15)');
    return bankAccountView(await this.service.getBankAccount(s.ctx, id));
  }

  // --- matching ruleset (draft) -----------------------------------------------------------------
  @Endpoint({
    permission: M15_PERMISSIONS.rulesetManage,
    auditCode: M15_AUDIT_CODES.rulesetCreated,
    description: 'Create a matching ruleset (draft).',
  })
  @Post('rulesets')
  async createRuleset(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create ruleset (m15)');
    return rulesetView(
      await this.service.createRuleset(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        ...optStr(b['name'], 'name'),
        // Amount tolerance is INTEGER MINOR UNITS (a number in, validated in-service); never a float (ADR-007).
        ...optNum(b['dateWindowDays'], 'dateWindowDays'),
        ...optNum(b['amountToleranceMinor'], 'amountToleranceMinor'),
        ...optBool(b['requireOppositeDirection'], 'requireOppositeDirection'),
      }),
    );
  }
  @Endpoint({
    permission: M15_PERMISSIONS.rulesetManage,
    auditCode: M15_AUDIT_CODES.ruleAdded,
    description: 'Add a rule to a draft matching ruleset.',
  })
  @Post('rulesets/:id/rules')
  async addRule(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add rule (m15)');
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
    permission: M15_PERMISSIONS.rulesetPublish,
    auditCode: M15_AUDIT_CODES.rulesetPublished,
    description: 'Publish a draft matching ruleset (freeze content hash).',
  })
  @Post('rulesets/:id/publish')
  async publishRuleset(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish ruleset (m15)');
    return rulesetView(
      await this.service.publishRuleset(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M15_PERMISSIONS.rulesetPublish,
    auditCode: M15_AUDIT_CODES.rulesetSuperseded,
    description: 'Supersede an active matching ruleset with a new version.',
  })
  @Post('rulesets/:id/supersede')
  async supersedeRuleset(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'supersede ruleset (m15)');
    const r = await this.service.supersedeRuleset(s.ctx, s.actor.identityId, id, {
      expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
      ...optStr(b['name'], 'name'),
      ...optNum(b['dateWindowDays'], 'dateWindowDays'),
      ...optNum(b['amountToleranceMinor'], 'amountToleranceMinor'),
      ...optBool(b['requireOppositeDirection'], 'requireOppositeDirection'),
    });
    return { prior: rulesetView(r.prior), successor: rulesetView(r.successor) };
  }
  @Get('rulesets')
  async listRulesets(
    @Headers() h: Record<string, string>,
    @Query('code') code?: string,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list rulesets (m15)');
    const rows = await this.service.listRulesets(s.ctx, {
      ...optStr(code, 'code'),
      ...optStr(status, 'status'),
    });
    return { rulesets: rows.map(rulesetView) };
  }
  @Get('rulesets/:id')
  async getRuleset(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get ruleset (m15)');
    return rulesetView(await this.service.getRuleset(s.ctx, id));
  }
  @Get('rulesets/:id/rules')
  async listRules(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list rules (m15)');
    return { rules: (await this.service.listRules(s.ctx, id)).map(ruleView) };
  }
  @Get('rulesets/:id/history')
  async listRulesetHistory(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list ruleset history (m15)');
    return { history: (await this.service.listRulesetHistory(s.ctx, id)).map(rulesetHistoryView) };
  }
}
