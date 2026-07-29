/**
 * M19 audit codes — the authoritative constant map. Every controlled finance-foundation mutation records one of
 * these through the kernel `AUDIT` port (m03 AuditService) in the SAME transaction as the state change. Codes are
 * SCREAMING_SNAKE `FIN_<ENTITY>_<ACTION>` (>= 3 segments) and MUST be registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). The `FIN_` prefix is shared with
 * m23-finance-integration — codes must not collide. Payloads never carry monetary amounts, balances or float
 * (ADR-007) — the finance foundation holds reference/config data, not ledger money.
 */
export const M19_AUDIT_CODES = {
  entityRegistered: 'FIN_ENTITY_REGISTERED',
  entityUpdated: 'FIN_ENTITY_UPDATED',
  entityActivated: 'FIN_ENTITY_ACTIVATED',
  entityDeactivated: 'FIN_ENTITY_DEACTIVATED',
  accountTypeRegistered: 'FIN_ACCOUNT_TYPE_REGISTERED',
  accountCreated: 'FIN_ACCOUNT_CREATED',
  accountUpdated: 'FIN_ACCOUNT_UPDATED',
  accountActivated: 'FIN_ACCOUNT_ACTIVATED',
  accountDeactivated: 'FIN_ACCOUNT_DEACTIVATED',
  accountArchived: 'FIN_ACCOUNT_ARCHIVED',
  fiscalYearCreated: 'FIN_FISCAL_YEAR_CREATED',
  fiscalYearClosed: 'FIN_FISCAL_YEAR_CLOSED',
  fiscalYearReopened: 'FIN_FISCAL_YEAR_REOPENED',
  periodOpened: 'FIN_PERIOD_OPENED',
  periodClosed: 'FIN_PERIOD_CLOSED',
  periodLocked: 'FIN_PERIOD_LOCKED',
  periodReopened: 'FIN_PERIOD_REOPENED',
  currencyRegistered: 'FIN_CURRENCY_REGISTERED',
  currencyUpdated: 'FIN_CURRENCY_UPDATED',
  currencyDeactivated: 'FIN_CURRENCY_DEACTIVATED',
  exchangeRateRecorded: 'FIN_EXCHANGE_RATE_RECORDED',
  entityCurrencyConfigured: 'FIN_ENTITY_CURRENCY_CONFIGURED',
  costCenterCreated: 'FIN_COST_CENTER_CREATED',
  costCenterUpdated: 'FIN_COST_CENTER_UPDATED',
  costCenterArchived: 'FIN_COST_CENTER_ARCHIVED',
  dimensionRegistered: 'FIN_DIMENSION_REGISTERED',
  dimensionValueAdded: 'FIN_DIMENSION_VALUE_ADDED',
  taxCodeRegistered: 'FIN_TAX_CODE_REGISTERED',
  taxRateAdded: 'FIN_TAX_RATE_ADDED',
  paymentTermRegistered: 'FIN_PAYMENT_TERM_REGISTERED',
  configCreated: 'FIN_CONFIG_CREATED',
  configPublished: 'FIN_CONFIG_PUBLISHED',
  configSuperseded: 'FIN_CONFIG_SUPERSEDED',
  analyticsExported: 'FIN_ANALYTICS_EXPORTED',
} as const;

export type M19AuditCode = (typeof M19_AUDIT_CODES)[keyof typeof M19_AUDIT_CODES];

export const ALL_M19_AUDIT_CODES: readonly M19AuditCode[] = Object.values(M19_AUDIT_CODES);

export const FIN_AUDIT_PREFIX = 'FIN_';
