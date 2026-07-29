/**
 * CatalogService — the finance-foundation reference-data catalog: accounting entities, account types, currencies +
 * FX rates, the entity currency configuration, cost centres, analytical dimensions + values, tax codes + rates and
 * payment terms. Every mutating method enforces its permission (default deny), runs inside `db.withTenant`, and
 * records audit + a `finance.lifecycle` event (where one exists) in the SAME transaction. Nothing is hardcoded:
 * codes/currencies/dimensions/tax codes are tenant DATA. FX rates and tax rates are EXACT decimals validated as
 * STRINGS via money.ts and never parsed to a float (ADR-007); the catalog carries no monetary amounts or balances.
 * Exchange rates are IDEMPOTENT on their natural key; the entity currency configuration is idempotent on its role
 * key — a replay returns the existing row rather than violating the unique index (fail closed, retry-safe).
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { FinanceLifecycleEventType, FinanceLifecyclePayload } from '@finapp/contracts';
import { M19_PERMISSIONS } from './permissions.ts';
import { M19_AUDIT_CODES } from './audit-codes.ts';
import {
  isAccountClass,
  isBalanceSide,
  isRateType,
  isEntityCurrencyRole,
  isDimensionKind,
  isTaxType,
  isPaymentTermBasis,
  normalSideOf,
  FINANCE_LIMITS,
} from './domain/limits.ts';
import { isCurrencyCode, isMinorUnits, isValidRate, isValidPercentage } from './money.ts';
import {
  FinanceRepository,
  type EntityRow,
  type AccountTypeRow,
  type CurrencyRow,
  type ExchangeRateRow,
  type EntityCurrencyRow,
  type CostCenterRow,
  type DimensionRow,
  type DimensionValueRow,
  type TaxCodeRow,
  type TaxRateRow,
  type PaymentTermRow,
} from './repository.ts';
import type { M19Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

function assertCodeName(code: string, name: string, correlationId: string): void {
  if (code.trim() === '' || code.length > FINANCE_LIMITS.maxCodeChars)
    throw badRequest('a code is required and must be bounded', correlationId);
  if (name.trim() === '' || name.length > FINANCE_LIMITS.maxNameChars)
    throw badRequest('a name is required and must be bounded', correlationId);
}

export class CatalogService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M19Emitter;
  private readonly repo: FinanceRepository;
  constructor(db: Db, authz: Authz, emitter: M19Emitter, repo: FinanceRepository = new FinanceRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: FinanceLifecycleEventType,
    payload: FinanceLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }
  private async requireEntity(tx: Tx, id: string, correlationId: string): Promise<EntityRow> {
    const e = await this.repo.findEntity(tx, id);
    if (e === null) throw ProblemError.notFound('Accounting entity not found.', correlationId);
    return e;
  }

  // --- accounting entity ------------------------------------------------------------------------
  async registerEntity(
    ctx: RequestContext,
    actor: string | null,
    input: {
      code: string;
      name: string;
      parentEntityId?: string | null;
      functionalCurrencyCode?: string | null;
      description?: string | null;
    },
  ): Promise<EntityRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.entityManage);
    assertCodeName(input.code, input.name, ctx.correlationId);
    if (input.functionalCurrencyCode != null && !isCurrencyCode(input.functionalCurrencyCode))
      throw badRequest('invalid functional currency code', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findEntityByCode(tx, input.code);
      if (existing !== null)
        throw ProblemError.conflict('An entity with that code already exists.', ctx.correlationId);
      const row = await this.repo.insertEntity(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        parentEntityId: input.parentEntityId ?? null,
        functionalCurrencyCode: input.functionalCurrencyCode ?? null,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.entityRegistered,
        entityType: 'finance_entity',
        entityId: row.id,
        detail: { code: input.code },
      });
      await this.publish(tx, ctx, actor, 'EntityRegistered', {
        recordId: row.id,
        recordType: 'entity',
        code: input.code,
        toStatus: row.status,
      });
      return row;
    });
  }
  async updateEntity(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      name?: string | null;
      parentEntityId?: string | null;
      functionalCurrencyCode?: string | null;
      description?: string | null;
    },
  ): Promise<EntityRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.entityManage);
    if (input.functionalCurrencyCode != null && !isCurrencyCode(input.functionalCurrencyCode))
      throw badRequest('invalid functional currency code', ctx.correlationId);
    if (input.parentEntityId != null && input.parentEntityId === id)
      throw badRequest('an entity cannot be its own parent', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateEntity(tx, {
        id,
        expectedVersion: input.expectedVersion,
        name: input.name ?? null,
        parentEntityId: input.parentEntityId ?? null,
        functionalCurrencyCode: input.functionalCurrencyCode ?? null,
        description: input.description ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Entity modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.entityUpdated,
        entityType: 'finance_entity',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  activateEntity(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.setEntityStatus(ctx, actor, id, expectedVersion, {
      toStatus: 'active',
      permission: M19_PERMISSIONS.entityActivate,
      auditCode: M19_AUDIT_CODES.entityActivated,
      eventType: 'EntityActivated',
    });
  }
  deactivateEntity(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.setEntityStatus(ctx, actor, id, expectedVersion, {
      toStatus: 'inactive',
      permission: M19_PERMISSIONS.entityDeactivate,
      auditCode: M19_AUDIT_CODES.entityDeactivated,
      eventType: 'EntityDeactivated',
    });
  }
  private async setEntityStatus(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    opts: { toStatus: string; permission: string; auditCode: string; eventType: FinanceLifecycleEventType },
  ): Promise<EntityRow> {
    await this.authz.require(ctx, opts.permission);
    return this.db.withTenant(ctx, async (tx) => {
      const entity = await this.requireEntity(tx, id, ctx.correlationId);
      const upd = await this.repo.transitionEntity(tx, {
        id,
        expectedVersion,
        toStatus: opts.toStatus,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Entity modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: opts.auditCode,
        entityType: 'finance_entity',
        entityId: id,
        detail: { fromStatus: entity.status, toStatus: opts.toStatus },
      });
      await this.publish(tx, ctx, actor, opts.eventType, {
        recordId: id,
        recordType: 'entity',
        code: entity.code,
        fromStatus: entity.status,
        toStatus: opts.toStatus,
      });
      return upd;
    });
  }
  async listEntities(ctx: RequestContext, status?: string): Promise<EntityRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.entityRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listEntities(tx, status));
  }

  // --- account type -----------------------------------------------------------------------------
  async registerAccountType(
    ctx: RequestContext,
    actor: string | null,
    input: {
      code: string;
      name: string;
      accountClass: string;
      normalSide?: string | null;
      description?: string | null;
    },
  ): Promise<AccountTypeRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.accountTypeManage);
    assertCodeName(input.code, input.name, ctx.correlationId);
    if (!isAccountClass(input.accountClass)) throw badRequest('invalid account class', ctx.correlationId);
    // Normal balance side follows the class by default; an explicit override must still be a valid side.
    const normalSide = input.normalSide ?? normalSideOf(input.accountClass);
    if (!isBalanceSide(normalSide)) throw badRequest('invalid normal side', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertAccountType(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        accountClass: input.accountClass,
        normalSide,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.accountTypeRegistered,
        entityType: 'finance_account_type',
        entityId: row.id,
        detail: { code: input.code, accountClass: input.accountClass },
      });
      await this.publish(tx, ctx, actor, 'AccountTypeRegistered', {
        recordId: row.id,
        recordType: 'account_type',
        code: input.code,
        accountType: input.accountClass,
      });
      return row;
    });
  }
  async updateAccountType(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; name?: string | null; description?: string | null; active?: boolean },
  ): Promise<AccountTypeRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.accountTypeManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateAccountType(tx, {
        id,
        expectedVersion: input.expectedVersion,
        name: input.name ?? null,
        description: input.description ?? null,
        active: input.active ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Account type modified concurrently (stale version).', ctx.correlationId);
      // No dedicated *_UPDATED audit code / event exists for reference types — the manage action is audited
      // under the registered code (the family carries no AccountTypeUpdated event).
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.accountTypeRegistered,
        entityType: 'finance_account_type',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  async listAccountTypes(ctx: RequestContext): Promise<AccountTypeRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.accountTypeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAccountTypes(tx));
  }

  // --- currency ---------------------------------------------------------------------------------
  async registerCurrency(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; name: string; minorUnits?: number; symbol?: string | null },
  ): Promise<CurrencyRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.currencyManage);
    if (!isCurrencyCode(input.code)) throw badRequest('invalid currency code', ctx.correlationId);
    if (input.name.trim() === '' || input.name.length > FINANCE_LIMITS.maxNameChars)
      throw badRequest('a name is required and must be bounded', ctx.correlationId);
    const minorUnits = input.minorUnits ?? 2;
    if (!isMinorUnits(minorUnits)) throw badRequest('invalid minor units', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findCurrencyByCode(tx, input.code);
      if (existing !== null)
        throw ProblemError.conflict('A currency with that code already exists.', ctx.correlationId);
      const row = await this.repo.insertCurrency(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        minorUnits,
        symbol: input.symbol ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.currencyRegistered,
        entityType: 'finance_currency',
        entityId: row.id,
        detail: { code: input.code },
      });
      await this.publish(tx, ctx, actor, 'CurrencyRegistered', {
        recordId: row.id,
        recordType: 'currency',
        code: input.code,
        currencyCode: input.code,
      });
      return row;
    });
  }
  async updateCurrency(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      name?: string | null;
      symbol?: string | null;
      minorUnits?: number | null;
    },
  ): Promise<CurrencyRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.currencyManage);
    if (input.minorUnits != null && !isMinorUnits(input.minorUnits))
      throw badRequest('invalid minor units', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateCurrency(tx, {
        id,
        expectedVersion: input.expectedVersion,
        name: input.name ?? null,
        symbol: input.symbol ?? null,
        minorUnits: input.minorUnits ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Currency modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.currencyUpdated,
        entityType: 'finance_currency',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  async deactivateCurrency(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<CurrencyRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.currencyManage);
    return this.db.withTenant(ctx, async (tx) => {
      const cur = await this.repo.findCurrency(tx, id);
      if (cur === null) throw ProblemError.notFound('Currency not found.', ctx.correlationId);
      const upd = await this.repo.setCurrencyStatus(tx, {
        id,
        expectedVersion,
        toStatus: 'inactive',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Currency modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.currencyDeactivated,
        entityType: 'finance_currency',
        entityId: id,
        detail: { code: cur.code },
      });
      await this.publish(tx, ctx, actor, 'CurrencyDeactivated', {
        recordId: id,
        recordType: 'currency',
        code: cur.code,
        currencyCode: cur.code,
        fromStatus: cur.status,
        toStatus: 'inactive',
      });
      return upd;
    });
  }
  async listCurrencies(ctx: RequestContext, status?: string): Promise<CurrencyRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.currencyRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCurrencies(tx, status));
  }

  // --- exchange rate (exact-decimal STRING; idempotent on the natural key) -----------------------
  async recordExchangeRate(
    ctx: RequestContext,
    actor: string | null,
    input: {
      baseCurrencyId: string;
      quoteCurrencyId: string;
      rate: string;
      rateType?: string;
      rateDate: string;
      source?: string | null;
    },
  ): Promise<ExchangeRateRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.exchangeRateManage);
    const rateType = input.rateType ?? 'spot';
    if (!isRateType(rateType)) throw badRequest('invalid rate type', ctx.correlationId);
    // The rate is an EXACT decimal STRING — validated as a string, passed straight to NUMERIC, never a float.
    if (!isValidRate(input.rate)) throw badRequest('invalid exchange rate', ctx.correlationId);
    if (input.baseCurrencyId === input.quoteCurrencyId)
      throw badRequest('base and quote currency must differ', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const base = await this.repo.findCurrency(tx, input.baseCurrencyId);
      const quote = await this.repo.findCurrency(tx, input.quoteCurrencyId);
      if (base === null || quote === null)
        throw ProblemError.notFound('Both base and quote currencies must exist.', ctx.correlationId);
      // Idempotent on the natural key (base, quote, type, date) — a replay returns the existing rate row.
      const existing = await this.repo.findExchangeRateByKey(tx, {
        baseCurrencyId: input.baseCurrencyId,
        quoteCurrencyId: input.quoteCurrencyId,
        rateType,
        rateDate: input.rateDate,
      });
      if (existing !== null) return existing;
      const row = await this.repo.insertExchangeRate(tx, {
        tenantId: ctx.tenantId,
        baseCurrencyId: input.baseCurrencyId,
        quoteCurrencyId: input.quoteCurrencyId,
        rate: input.rate,
        rateType,
        rateDate: input.rateDate,
        source: input.source ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.exchangeRateRecorded,
        entityType: 'finance_exchange_rate',
        entityId: row.id,
        // Codes/dates only — the rate value never enters audit (ADR-007).
        detail: { base: base.code, quote: quote.code, rateType, rateDate: input.rateDate },
      });
      await this.publish(tx, ctx, actor, 'ExchangeRateRecorded', {
        recordId: row.id,
        recordType: 'exchange_rate',
        currencyCode: base.code,
        quoteCurrencyCode: quote.code,
        reasonCode: rateType,
        rateDate: input.rateDate,
      });
      return row;
    });
  }
  async listExchangeRates(
    ctx: RequestContext,
    filters: { baseCurrencyId?: string; quoteCurrencyId?: string; rateType?: string },
  ): Promise<ExchangeRateRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.exchangeRateRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listExchangeRates(tx, filters));
  }

  // --- entity currency configuration ------------------------------------------------------------
  async configureEntityCurrency(
    ctx: RequestContext,
    actor: string | null,
    input: { entityId: string; currencyId: string; currencyRole: string },
  ): Promise<EntityCurrencyRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.entityCurrencyManage);
    if (!isEntityCurrencyRole(input.currencyRole))
      throw badRequest('invalid currency role', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireEntity(tx, input.entityId, ctx.correlationId);
      const currency = await this.repo.findCurrency(tx, input.currencyId);
      if (currency === null) throw ProblemError.notFound('Currency not found.', ctx.correlationId);
      // Idempotent on (entity, currency, role) — a replay returns the existing configuration row.
      const existing = await this.repo.findEntityCurrencyByKey(tx, {
        entityId: input.entityId,
        currencyId: input.currencyId,
        currencyRole: input.currencyRole,
      });
      if (existing !== null) return existing;
      const row = await this.repo.insertEntityCurrency(tx, {
        tenantId: ctx.tenantId,
        entityId: input.entityId,
        currencyId: input.currencyId,
        currencyRole: input.currencyRole,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.entityCurrencyConfigured,
        entityType: 'finance_entity_currency',
        entityId: row.id,
        detail: { currencyRole: input.currencyRole, currencyCode: currency.code },
      });
      await this.publish(tx, ctx, actor, 'EntityCurrencyConfigured', {
        recordId: row.id,
        recordType: 'entity_currency',
        entityRef: input.entityId,
        currencyCode: currency.code,
        reasonCode: input.currencyRole,
      });
      return row;
    });
  }
  async listEntityCurrencies(ctx: RequestContext, entityId: string): Promise<EntityCurrencyRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.entityCurrencyRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listEntityCurrencies(tx, entityId));
  }

  // --- cost centre ------------------------------------------------------------------------------
  async createCostCenter(
    ctx: RequestContext,
    actor: string | null,
    input: {
      entityId: string;
      code: string;
      name: string;
      parentCostCenterId?: string | null;
      description?: string | null;
    },
  ): Promise<CostCenterRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.costCenterManage);
    assertCodeName(input.code, input.name, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireEntity(tx, input.entityId, ctx.correlationId);
      const row = await this.repo.insertCostCenter(tx, {
        tenantId: ctx.tenantId,
        entityId: input.entityId,
        code: input.code,
        name: input.name,
        parentCostCenterId: input.parentCostCenterId ?? null,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.costCenterCreated,
        entityType: 'finance_cost_center',
        entityId: row.id,
        detail: { code: input.code },
      });
      await this.publish(tx, ctx, actor, 'CostCenterCreated', {
        recordId: row.id,
        recordType: 'cost_center',
        entityRef: input.entityId,
        code: input.code,
      });
      return row;
    });
  }
  async updateCostCenter(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      name?: string | null;
      parentCostCenterId?: string | null;
      description?: string | null;
    },
  ): Promise<CostCenterRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.costCenterManage);
    if (input.parentCostCenterId != null && input.parentCostCenterId === id)
      throw badRequest('a cost centre cannot be its own parent', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateCostCenter(tx, {
        id,
        expectedVersion: input.expectedVersion,
        name: input.name ?? null,
        parentCostCenterId: input.parentCostCenterId ?? null,
        description: input.description ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Cost centre archived or modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.costCenterUpdated,
        entityType: 'finance_cost_center',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  async archiveCostCenter(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<CostCenterRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.costCenterArchive);
    return this.db.withTenant(ctx, async (tx) => {
      const cc = await this.repo.findCostCenter(tx, id);
      if (cc === null) throw ProblemError.notFound('Cost centre not found.', ctx.correlationId);
      const upd = await this.repo.setCostCenterStatus(tx, {
        id,
        expectedVersion,
        toStatus: 'archived',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Cost centre modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.costCenterArchived,
        entityType: 'finance_cost_center',
        entityId: id,
        detail: { fromStatus: cc.status },
      });
      await this.publish(tx, ctx, actor, 'CostCenterArchived', {
        recordId: id,
        recordType: 'cost_center',
        entityRef: cc.entity_id,
        code: cc.code,
        fromStatus: cc.status,
        toStatus: 'archived',
      });
      return upd;
    });
  }
  async listCostCenters(
    ctx: RequestContext,
    filters: { entityId?: string; status?: string },
  ): Promise<CostCenterRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.costCenterRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCostCenters(tx, filters));
  }

  // --- analytical dimension + values ------------------------------------------------------------
  async registerDimension(
    ctx: RequestContext,
    actor: string | null,
    input: { entityId: string; code: string; name: string; kind: string },
  ): Promise<DimensionRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.dimensionManage);
    assertCodeName(input.code, input.name, ctx.correlationId);
    if (!isDimensionKind(input.kind)) throw badRequest('invalid dimension kind', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireEntity(tx, input.entityId, ctx.correlationId);
      const row = await this.repo.insertDimension(tx, {
        tenantId: ctx.tenantId,
        entityId: input.entityId,
        code: input.code,
        name: input.name,
        kind: input.kind,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.dimensionRegistered,
        entityType: 'finance_dimension',
        entityId: row.id,
        detail: { code: input.code, kind: input.kind },
      });
      await this.publish(tx, ctx, actor, 'DimensionRegistered', {
        recordId: row.id,
        recordType: 'dimension',
        entityRef: input.entityId,
        code: input.code,
        reasonCode: input.kind,
      });
      return row;
    });
  }
  async addDimensionValue(
    ctx: RequestContext,
    actor: string | null,
    dimensionId: string,
    input: { code: string; name: string; parentValueId?: string | null },
  ): Promise<DimensionValueRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.dimensionValueManage);
    assertCodeName(input.code, input.name, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const dim = await this.repo.findDimension(tx, dimensionId);
      if (dim === null) throw ProblemError.notFound('Dimension not found.', ctx.correlationId);
      const row = await this.repo.insertDimensionValue(tx, {
        tenantId: ctx.tenantId,
        dimensionId,
        code: input.code,
        name: input.name,
        parentValueId: input.parentValueId ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.dimensionValueAdded,
        entityType: 'finance_dimension_value',
        entityId: row.id,
        detail: { dimensionId, code: input.code },
      });
      await this.publish(tx, ctx, actor, 'DimensionValueAdded', {
        recordId: row.id,
        recordType: 'dimension_value',
        entityRef: dim.entity_id,
        code: input.code,
      });
      return row;
    });
  }
  async listDimensions(ctx: RequestContext, entityId: string): Promise<DimensionRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.dimensionRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDimensions(tx, entityId));
  }
  async listDimensionValues(ctx: RequestContext, dimensionId: string): Promise<DimensionValueRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.dimensionRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDimensionValues(tx, dimensionId));
  }

  // --- tax code + rates -------------------------------------------------------------------------
  async registerTaxCode(
    ctx: RequestContext,
    actor: string | null,
    input: { entityId: string; code: string; name: string; taxType: string; description?: string | null },
  ): Promise<TaxCodeRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.taxCodeManage);
    assertCodeName(input.code, input.name, ctx.correlationId);
    if (!isTaxType(input.taxType)) throw badRequest('invalid tax type', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireEntity(tx, input.entityId, ctx.correlationId);
      const row = await this.repo.insertTaxCode(tx, {
        tenantId: ctx.tenantId,
        entityId: input.entityId,
        code: input.code,
        name: input.name,
        taxType: input.taxType,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.taxCodeRegistered,
        entityType: 'finance_tax_code',
        entityId: row.id,
        detail: { code: input.code, taxType: input.taxType },
      });
      await this.publish(tx, ctx, actor, 'TaxCodeRegistered', {
        recordId: row.id,
        recordType: 'tax_code',
        entityRef: input.entityId,
        code: input.code,
        reasonCode: input.taxType,
      });
      return row;
    });
  }
  async updateTaxCode(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      name?: string | null;
      description?: string | null;
      status?: string | null;
    },
  ): Promise<TaxCodeRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.taxCodeManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateTaxCode(tx, {
        id,
        expectedVersion: input.expectedVersion,
        name: input.name ?? null,
        description: input.description ?? null,
        status: input.status ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Tax code modified concurrently (stale version).', ctx.correlationId);
      // No dedicated FIN_TAX_CODE_UPDATED code — the manage action audits under the registered code.
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.taxCodeRegistered,
        entityType: 'finance_tax_code',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  async addTaxRate(
    ctx: RequestContext,
    actor: string | null,
    taxCodeId: string,
    input: { ratePercent: string; effectiveFrom: string; effectiveTo?: string | null },
  ): Promise<TaxRateRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.taxRateManage);
    // The percentage is an EXACT decimal STRING — validated as a string, passed straight to NUMERIC, never a float.
    if (!isValidPercentage(input.ratePercent))
      throw badRequest('invalid tax rate percentage', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const code = await this.repo.findTaxCode(tx, taxCodeId);
      if (code === null) throw ProblemError.notFound('Tax code not found.', ctx.correlationId);
      const row = await this.repo.insertTaxRate(tx, {
        tenantId: ctx.tenantId,
        taxCodeId,
        ratePercent: input.ratePercent,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.taxRateAdded,
        entityType: 'finance_tax_rate',
        entityId: row.id,
        // Effective dates only — the rate value never enters audit (ADR-007).
        detail: { taxCodeId, effectiveFrom: input.effectiveFrom },
      });
      await this.publish(tx, ctx, actor, 'TaxRateAdded', {
        recordId: row.id,
        recordType: 'tax_rate',
        entityRef: code.entity_id,
        code: code.code,
        effectiveDate: input.effectiveFrom,
      });
      return row;
    });
  }
  async listTaxCodes(ctx: RequestContext, entityId: string): Promise<TaxCodeRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.taxCodeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listTaxCodes(tx, entityId));
  }
  async listTaxRates(ctx: RequestContext, taxCodeId: string): Promise<TaxRateRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.taxCodeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listTaxRates(tx, taxCodeId));
  }

  // --- payment term -----------------------------------------------------------------------------
  async registerPaymentTerm(
    ctx: RequestContext,
    actor: string | null,
    input: {
      code: string;
      name: string;
      basis?: string;
      netDays?: number | null;
      dayOfMonth?: number | null;
      description?: string | null;
    },
  ): Promise<PaymentTermRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.paymentTermManage);
    assertCodeName(input.code, input.name, ctx.correlationId);
    const basis = input.basis ?? 'net_days';
    if (!isPaymentTermBasis(basis)) throw badRequest('invalid payment term basis', ctx.correlationId);
    if (input.netDays != null && (!Number.isInteger(input.netDays) || input.netDays < 0))
      throw badRequest('invalid net days', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertPaymentTerm(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        basis,
        netDays: input.netDays ?? null,
        dayOfMonth: input.dayOfMonth ?? null,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.paymentTermRegistered,
        entityType: 'finance_payment_term',
        entityId: row.id,
        detail: { code: input.code, basis },
      });
      await this.publish(tx, ctx, actor, 'PaymentTermRegistered', {
        recordId: row.id,
        recordType: 'payment_term',
        code: input.code,
        reasonCode: basis,
      });
      return row;
    });
  }
  async updatePaymentTerm(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      name?: string | null;
      netDays?: number | null;
      dayOfMonth?: number | null;
      description?: string | null;
      status?: string | null;
    },
  ): Promise<PaymentTermRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.paymentTermManage);
    if (input.netDays != null && (!Number.isInteger(input.netDays) || input.netDays < 0))
      throw badRequest('invalid net days', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updatePaymentTerm(tx, {
        id,
        expectedVersion: input.expectedVersion,
        name: input.name ?? null,
        netDays: input.netDays ?? null,
        dayOfMonth: input.dayOfMonth ?? null,
        description: input.description ?? null,
        status: input.status ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Payment term modified concurrently (stale version).', ctx.correlationId);
      // No dedicated FIN_PAYMENT_TERM_UPDATED code — the manage action audits under the registered code.
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.paymentTermRegistered,
        entityType: 'finance_payment_term',
        entityId: id,
        detail: {},
      });
      return upd;
    });
  }
  async listPaymentTerms(ctx: RequestContext, status?: string): Promise<PaymentTermRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.paymentTermRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPaymentTerms(tx, status));
  }
}
