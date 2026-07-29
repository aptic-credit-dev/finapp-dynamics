import type {
  EntityRow,
  AccountTypeRow,
  CurrencyRow,
  ExchangeRateRow,
  EntityCurrencyRow,
  AccountRow,
  AccountHistoryRow,
  FiscalYearRow,
  FiscalPeriodRow,
  PeriodHistoryRow,
  CostCenterRow,
  DimensionRow,
  DimensionValueRow,
  TaxCodeRow,
  TaxRateRow,
  PaymentTermRow,
  ConfigRow,
  ConfigHistoryRow,
} from '@finapp/m19-finance';

/**
 * Response shapes for the finance-operations FOUNDATION API (m19). Persistence rows are snake_case; these map to
 * camelCase DTOs. The tenant is implicit (x-tenant-id + RLS), never re-exposed, and neither is `correlation_id`.
 *
 * The finance foundation carries NO privileged/confidential text and NO monetary amounts or balances, so — unlike
 * m18 — there is NO redaction layer here: every view passes its row straight through, camelCased. The only
 * money-adjacent values are EXACT-decimal FX + tax rates; they arrive from the repository as STRINGS
 * (`rate::text`, `rate_percent`) and are emitted AS STRINGS, never coerced to a `number` (ADR-007, CLAUDE.md money
 * rule). Every mutable view carries `version` for optimistic concurrency.
 */

export function entityView(row: EntityRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    parentEntityId: row.parent_entity_id,
    functionalCurrencyCode: row.functional_currency_code,
    description: row.description,
    status: row.status,
    version: row.version,
  };
}

export function accountTypeView(row: AccountTypeRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    accountClass: row.account_class,
    normalSide: row.normal_side,
    description: row.description,
    active: row.active,
    version: row.version,
  };
}

export function currencyView(row: CurrencyRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    minorUnits: row.minor_units,
    symbol: row.symbol,
    status: row.status,
    version: row.version,
  };
}

export function exchangeRateView(row: ExchangeRateRow) {
  return {
    id: row.id,
    baseCurrencyId: row.base_currency_id,
    quoteCurrencyId: row.quote_currency_id,
    // EXACT decimal — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    rate: row.rate,
    rateType: row.rate_type,
    rateDate: row.rate_date,
    source: row.source,
    version: row.version,
  };
}

export function entityCurrencyView(row: EntityCurrencyRow) {
  return {
    id: row.id,
    entityId: row.entity_id,
    currencyId: row.currency_id,
    currencyRole: row.currency_role,
    version: row.version,
  };
}

export function accountView(row: AccountRow) {
  return {
    id: row.id,
    entityId: row.entity_id,
    accountTypeId: row.account_type_id,
    parentAccountId: row.parent_account_id,
    code: row.code,
    name: row.name,
    description: row.description,
    currencyId: row.currency_id,
    postable: row.postable,
    status: row.status,
    version: row.version,
  };
}

export function accountHistoryView(row: AccountHistoryRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    reasonCode: row.reason_code,
    byUser: row.by_user,
  };
}

export function fiscalYearView(row: FiscalYearRow) {
  return {
    id: row.id,
    entityId: row.entity_id,
    code: row.code,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    version: row.version,
  };
}

export function fiscalPeriodView(row: FiscalPeriodRow) {
  return {
    id: row.id,
    entityId: row.entity_id,
    fiscalYearId: row.fiscal_year_id,
    periodNumber: row.period_number,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    closedAt: row.closed_at,
    lockedAt: row.locked_at,
    version: row.version,
  };
}

export function periodHistoryView(row: PeriodHistoryRow) {
  return {
    id: row.id,
    periodId: row.period_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    reasonCode: row.reason_code,
    byUser: row.by_user,
  };
}

export function costCenterView(row: CostCenterRow) {
  return {
    id: row.id,
    entityId: row.entity_id,
    code: row.code,
    name: row.name,
    parentCostCenterId: row.parent_cost_center_id,
    description: row.description,
    status: row.status,
    version: row.version,
  };
}

export function dimensionView(row: DimensionRow) {
  return {
    id: row.id,
    entityId: row.entity_id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    status: row.status,
    version: row.version,
  };
}

export function dimensionValueView(row: DimensionValueRow) {
  return {
    id: row.id,
    dimensionId: row.dimension_id,
    code: row.code,
    name: row.name,
    parentValueId: row.parent_value_id,
    status: row.status,
    version: row.version,
  };
}

export function taxCodeView(row: TaxCodeRow) {
  return {
    id: row.id,
    entityId: row.entity_id,
    code: row.code,
    name: row.name,
    taxType: row.tax_type,
    description: row.description,
    status: row.status,
    version: row.version,
  };
}

export function taxRateView(row: TaxRateRow) {
  return {
    id: row.id,
    taxCodeId: row.tax_code_id,
    // EXACT decimal percentage — kept as a STRING end-to-end, never parsed to a float (ADR-007).
    ratePercent: row.rate_percent,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    version: row.version,
  };
}

export function paymentTermView(row: PaymentTermRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    basis: row.basis,
    netDays: row.net_days,
    dayOfMonth: row.day_of_month,
    description: row.description,
    status: row.status,
    version: row.version,
  };
}

export function configView(row: ConfigRow) {
  return {
    id: row.id,
    entityId: row.entity_id,
    scope: row.scope,
    versionNumber: row.version_number,
    status: row.status,
    settings: row.settings,
    contentHash: row.content_hash,
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    publishedAt: row.published_at,
    version: row.version,
  };
}

export function configHistoryView(row: ConfigHistoryRow) {
  return {
    id: row.id,
    configId: row.config_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    byUser: row.by_user,
  };
}
