import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M19_AUDIT_CODES, M19_PERMISSIONS } from '@finapp/m19-finance';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  entityView,
  accountTypeView,
  currencyView,
  exchangeRateView,
  entityCurrencyView,
  costCenterView,
  dimensionView,
  dimensionValueView,
  taxCodeView,
  taxRateView,
  paymentTermView,
} from './views.ts';

/**
 * Finance-foundation reference-data catalog — accounting entities, account types, currencies + FX rates (idempotent
 * on their natural key), the entity currency configuration, cost centres, analytical dimensions + values, tax codes
 * + rates and payment terms, under `/api/v1/finance`. There is NO privileged/confidential text and NO monetary
 * amount here, so no redaction: views pass rows through camelCased. FX `rate` and tax `ratePercent` are EXACT
 * decimals carried as STRINGS in and out, never parsed to a float (ADR-007). Permission enforced in CatalogService
 * (default deny). Read (GET) routes carry no `@Endpoint` — the read permission is enforced in-service.
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

@Controller('finance')
export class FinanceCatalogController {
  private readonly service: CatalogService;
  private readonly actors: ActorContextFactory;
  constructor(service: CatalogService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- accounting entity ------------------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.entityManage,
    auditCode: M19_AUDIT_CODES.entityRegistered,
    description: 'Register an accounting entity.',
  })
  @Post('entities')
  async registerEntity(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register entity (m19)');
    return entityView(
      await this.service.registerEntity(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        ...optStr(b['parentEntityId'], 'parentEntityId'),
        ...optStr(b['functionalCurrencyCode'], 'functionalCurrencyCode'),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.entityManage,
    auditCode: M19_AUDIT_CODES.entityUpdated,
    description: 'Update an accounting entity.',
  })
  @Post('entities/:id')
  async updateEntity(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update entity (m19)');
    return entityView(
      await this.service.updateEntity(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['name'], 'name'),
        ...optStr(b['parentEntityId'], 'parentEntityId'),
        ...optStr(b['functionalCurrencyCode'], 'functionalCurrencyCode'),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.entityActivate,
    auditCode: M19_AUDIT_CODES.entityActivated,
    description: 'Activate an accounting entity.',
  })
  @Post('entities/:id/activate')
  async activateEntity(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'activate entity (m19)');
    return entityView(
      await this.service.activateEntity(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.entityDeactivate,
    auditCode: M19_AUDIT_CODES.entityDeactivated,
    description: 'Deactivate an accounting entity.',
  })
  @Post('entities/:id/deactivate')
  async deactivateEntity(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'deactivate entity (m19)');
    return entityView(
      await this.service.deactivateEntity(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('entities')
  async listEntities(@Headers() h: Record<string, string>, @Query('status') status?: string) {
    const s = await this.scoped(h, 'list entities (m19)');
    return { entities: (await this.service.listEntities(s.ctx, status)).map(entityView) };
  }

  // --- account type -----------------------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.accountTypeManage,
    auditCode: M19_AUDIT_CODES.accountTypeRegistered,
    description: 'Register an account type.',
  })
  @Post('account-types')
  async registerAccountType(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register account type (m19)');
    return accountTypeView(
      await this.service.registerAccountType(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        accountClass: requireString(b['accountClass'], 'accountClass', s.correlationId),
        ...optStr(b['normalSide'], 'normalSide'),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.accountTypeManage,
    auditCode: M19_AUDIT_CODES.accountTypeRegistered,
    description: 'Update an account type.',
  })
  @Post('account-types/:id')
  async updateAccountType(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update account type (m19)');
    return accountTypeView(
      await this.service.updateAccountType(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['name'], 'name'),
        ...optStr(b['description'], 'description'),
        ...optBool(b['active'], 'active'),
      }),
    );
  }
  @Get('account-types')
  async listAccountTypes(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list account types (m19)');
    return { accountTypes: (await this.service.listAccountTypes(s.ctx)).map(accountTypeView) };
  }

  // --- currency ---------------------------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.currencyManage,
    auditCode: M19_AUDIT_CODES.currencyRegistered,
    description: 'Register a currency.',
  })
  @Post('currencies')
  async registerCurrency(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register currency (m19)');
    return currencyView(
      await this.service.registerCurrency(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        ...optNum(b['minorUnits'], 'minorUnits'),
        ...optStr(b['symbol'], 'symbol'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.currencyManage,
    auditCode: M19_AUDIT_CODES.currencyUpdated,
    description: 'Update a currency.',
  })
  @Post('currencies/:id')
  async updateCurrency(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update currency (m19)');
    return currencyView(
      await this.service.updateCurrency(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['name'], 'name'),
        ...optStr(b['symbol'], 'symbol'),
        ...optNum(b['minorUnits'], 'minorUnits'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.currencyManage,
    auditCode: M19_AUDIT_CODES.currencyDeactivated,
    description: 'Deactivate a currency.',
  })
  @Post('currencies/:id/deactivate')
  async deactivateCurrency(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'deactivate currency (m19)');
    return currencyView(
      await this.service.deactivateCurrency(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('currencies')
  async listCurrencies(@Headers() h: Record<string, string>, @Query('status') status?: string) {
    const s = await this.scoped(h, 'list currencies (m19)');
    return { currencies: (await this.service.listCurrencies(s.ctx, status)).map(currencyView) };
  }

  // --- exchange rate (exact-decimal STRING; idempotent on the natural key) -----------------------
  @Endpoint({
    permission: M19_PERMISSIONS.exchangeRateManage,
    auditCode: M19_AUDIT_CODES.exchangeRateRecorded,
    description: 'Record an exchange rate (idempotent on base/quote/type/date).',
  })
  @Post('exchange-rates')
  async recordExchangeRate(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'record exchange rate (m19)');
    return exchangeRateView(
      await this.service.recordExchangeRate(s.ctx, s.actor.identityId, {
        baseCurrencyId: requireString(b['baseCurrencyId'], 'baseCurrencyId', s.correlationId),
        quoteCurrencyId: requireString(b['quoteCurrencyId'], 'quoteCurrencyId', s.correlationId),
        // The rate is an EXACT decimal STRING — never Number()/parseFloat (ADR-007).
        rate: requireString(b['rate'], 'rate', s.correlationId),
        rateDate: requireString(b['rateDate'], 'rateDate', s.correlationId),
        ...optStr(b['rateType'], 'rateType'),
        ...optStr(b['source'], 'source'),
      }),
    );
  }
  @Get('exchange-rates')
  async listExchangeRates(
    @Headers() h: Record<string, string>,
    @Query('baseCurrencyId') baseCurrencyId?: string,
    @Query('quoteCurrencyId') quoteCurrencyId?: string,
    @Query('rateType') rateType?: string,
  ) {
    const s = await this.scoped(h, 'list exchange rates (m19)');
    const rows = await this.service.listExchangeRates(s.ctx, {
      ...optStr(baseCurrencyId, 'baseCurrencyId'),
      ...optStr(quoteCurrencyId, 'quoteCurrencyId'),
      ...optStr(rateType, 'rateType'),
    });
    return { exchangeRates: rows.map(exchangeRateView) };
  }

  // --- entity currency configuration ------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.entityCurrencyManage,
    auditCode: M19_AUDIT_CODES.entityCurrencyConfigured,
    description: 'Configure an entity currency role (idempotent on entity/currency/role).',
  })
  @Post('entities/:id/currencies')
  async configureEntityCurrency(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'configure entity currency (m19)');
    return entityCurrencyView(
      await this.service.configureEntityCurrency(s.ctx, s.actor.identityId, {
        entityId: id,
        currencyId: requireString(b['currencyId'], 'currencyId', s.correlationId),
        currencyRole: requireString(b['currencyRole'], 'currencyRole', s.correlationId),
      }),
    );
  }
  @Get('entities/:id/currencies')
  async listEntityCurrencies(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list entity currencies (m19)');
    return { entityCurrencies: (await this.service.listEntityCurrencies(s.ctx, id)).map(entityCurrencyView) };
  }

  // --- cost centre ------------------------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.costCenterManage,
    auditCode: M19_AUDIT_CODES.costCenterCreated,
    description: 'Create a cost centre.',
  })
  @Post('cost-centers')
  async createCostCenter(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create cost centre (m19)');
    return costCenterView(
      await this.service.createCostCenter(s.ctx, s.actor.identityId, {
        entityId: requireString(b['entityId'], 'entityId', s.correlationId),
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        ...optStr(b['parentCostCenterId'], 'parentCostCenterId'),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.costCenterManage,
    auditCode: M19_AUDIT_CODES.costCenterUpdated,
    description: 'Update a cost centre.',
  })
  @Post('cost-centers/:id')
  async updateCostCenter(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update cost centre (m19)');
    return costCenterView(
      await this.service.updateCostCenter(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['name'], 'name'),
        ...optStr(b['parentCostCenterId'], 'parentCostCenterId'),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.costCenterArchive,
    auditCode: M19_AUDIT_CODES.costCenterArchived,
    description: 'Archive a cost centre.',
  })
  @Post('cost-centers/:id/archive')
  async archiveCostCenter(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'archive cost centre (m19)');
    return costCenterView(
      await this.service.archiveCostCenter(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('cost-centers')
  async listCostCenters(
    @Headers() h: Record<string, string>,
    @Query('entityId') entityId?: string,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list cost centres (m19)');
    const rows = await this.service.listCostCenters(s.ctx, {
      ...optStr(entityId, 'entityId'),
      ...optStr(status, 'status'),
    });
    return { costCenters: rows.map(costCenterView) };
  }

  // --- analytical dimension + values ------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.dimensionManage,
    auditCode: M19_AUDIT_CODES.dimensionRegistered,
    description: 'Register an analytical dimension.',
  })
  @Post('dimensions')
  async registerDimension(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register dimension (m19)');
    return dimensionView(
      await this.service.registerDimension(s.ctx, s.actor.identityId, {
        entityId: requireString(b['entityId'], 'entityId', s.correlationId),
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        kind: requireString(b['kind'], 'kind', s.correlationId),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.dimensionValueManage,
    auditCode: M19_AUDIT_CODES.dimensionValueAdded,
    description: 'Add a value to an analytical dimension.',
  })
  @Post('dimensions/:id/values')
  async addDimensionValue(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add dimension value (m19)');
    return dimensionValueView(
      await this.service.addDimensionValue(s.ctx, s.actor.identityId, id, {
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        ...optStr(b['parentValueId'], 'parentValueId'),
      }),
    );
  }
  @Get('dimensions')
  async listDimensions(@Headers() h: Record<string, string>, @Query('entityId') entityId?: string) {
    const s = await this.scoped(h, 'list dimensions (m19)');
    const rows = await this.service.listDimensions(
      s.ctx,
      requireString(entityId, 'entityId', s.correlationId),
    );
    return { dimensions: rows.map(dimensionView) };
  }
  @Get('dimensions/:id/values')
  async listDimensionValues(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list dimension values (m19)');
    return { dimensionValues: (await this.service.listDimensionValues(s.ctx, id)).map(dimensionValueView) };
  }

  // --- tax code + rates -------------------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.taxCodeManage,
    auditCode: M19_AUDIT_CODES.taxCodeRegistered,
    description: 'Register a tax code.',
  })
  @Post('tax-codes')
  async registerTaxCode(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register tax code (m19)');
    return taxCodeView(
      await this.service.registerTaxCode(s.ctx, s.actor.identityId, {
        entityId: requireString(b['entityId'], 'entityId', s.correlationId),
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        taxType: requireString(b['taxType'], 'taxType', s.correlationId),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.taxCodeManage,
    auditCode: M19_AUDIT_CODES.taxCodeRegistered,
    description: 'Update a tax code.',
  })
  @Post('tax-codes/:id')
  async updateTaxCode(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update tax code (m19)');
    return taxCodeView(
      await this.service.updateTaxCode(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['name'], 'name'),
        ...optStr(b['description'], 'description'),
        ...optStr(b['status'], 'status'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.taxRateManage,
    auditCode: M19_AUDIT_CODES.taxRateAdded,
    description: 'Add an effective-dated rate to a tax code.',
  })
  @Post('tax-codes/:id/rates')
  async addTaxRate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add tax rate (m19)');
    return taxRateView(
      await this.service.addTaxRate(s.ctx, s.actor.identityId, id, {
        // The percentage is an EXACT decimal STRING — never Number()/parseFloat (ADR-007).
        ratePercent: requireString(b['ratePercent'], 'ratePercent', s.correlationId),
        effectiveFrom: requireString(b['effectiveFrom'], 'effectiveFrom', s.correlationId),
        ...optStr(b['effectiveTo'], 'effectiveTo'),
      }),
    );
  }
  @Get('tax-codes')
  async listTaxCodes(@Headers() h: Record<string, string>, @Query('entityId') entityId?: string) {
    const s = await this.scoped(h, 'list tax codes (m19)');
    const rows = await this.service.listTaxCodes(s.ctx, requireString(entityId, 'entityId', s.correlationId));
    return { taxCodes: rows.map(taxCodeView) };
  }
  @Get('tax-codes/:id/rates')
  async listTaxRates(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list tax rates (m19)');
    return { taxRates: (await this.service.listTaxRates(s.ctx, id)).map(taxRateView) };
  }

  // --- payment term -----------------------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.paymentTermManage,
    auditCode: M19_AUDIT_CODES.paymentTermRegistered,
    description: 'Register a payment term.',
  })
  @Post('payment-terms')
  async registerPaymentTerm(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'register payment term (m19)');
    return paymentTermView(
      await this.service.registerPaymentTerm(s.ctx, s.actor.identityId, {
        code: requireString(b['code'], 'code', s.correlationId),
        name: requireString(b['name'], 'name', s.correlationId),
        ...optStr(b['basis'], 'basis'),
        ...optNum(b['netDays'], 'netDays'),
        ...optNum(b['dayOfMonth'], 'dayOfMonth'),
        ...optStr(b['description'], 'description'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.paymentTermManage,
    auditCode: M19_AUDIT_CODES.paymentTermRegistered,
    description: 'Update a payment term.',
  })
  @Post('payment-terms/:id')
  async updatePaymentTerm(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update payment term (m19)');
    return paymentTermView(
      await this.service.updatePaymentTerm(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b['expectedVersion'], s.correlationId),
        ...optStr(b['name'], 'name'),
        ...optNum(b['netDays'], 'netDays'),
        ...optNum(b['dayOfMonth'], 'dayOfMonth'),
        ...optStr(b['description'], 'description'),
        ...optStr(b['status'], 'status'),
      }),
    );
  }
  @Get('payment-terms')
  async listPaymentTerms(@Headers() h: Record<string, string>, @Query('status') status?: string) {
    const s = await this.scoped(h, 'list payment terms (m19)');
    return { paymentTerms: (await this.service.listPaymentTerms(s.ctx, status)).map(paymentTermView) };
  }
}
