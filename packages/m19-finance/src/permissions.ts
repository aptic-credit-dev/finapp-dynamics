/**
 * M19 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators and
 * enforced server-side inside the services (default deny). Every code is three segments
 * `finance.<entity>.<action>` (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `finance.*` namespace AND seeded into the `permissions` catalogue
 * (GAP-4 closed at Stage 3.1). Controlling/config actions (closing/locking a period, closing a fiscal year,
 * publishing configuration, archiving an account, managing reference data, exporting analytics, administering the
 * engine) are gated by dedicated privileged permissions; there is no vague `finance.admin`.
 */
export const M19_PERMISSIONS = {
  // accounting entity
  entityRead: 'finance.entity.read',
  entityManage: 'finance.entity.manage',
  entityActivate: 'finance.entity.activate',
  entityDeactivate: 'finance.entity.deactivate',
  // account types + chart of accounts
  accountTypeRead: 'finance.account_type.read',
  accountTypeManage: 'finance.account_type.manage',
  accountRead: 'finance.account.read',
  accountCreate: 'finance.account.create',
  accountUpdate: 'finance.account.update',
  accountActivate: 'finance.account.activate',
  accountDeactivate: 'finance.account.deactivate',
  accountArchive: 'finance.account.archive',
  // fiscal calendar
  fiscalYearRead: 'finance.fiscal_year.read',
  fiscalYearManage: 'finance.fiscal_year.manage',
  fiscalYearClose: 'finance.fiscal_year.close',
  fiscalYearReopen: 'finance.fiscal_year.reopen',
  periodRead: 'finance.period.read',
  periodManage: 'finance.period.manage',
  periodOpen: 'finance.period.open',
  periodClose: 'finance.period.close',
  periodLock: 'finance.period.lock',
  periodReopen: 'finance.period.reopen',
  // currencies + FX
  currencyRead: 'finance.currency.read',
  currencyManage: 'finance.currency.manage',
  exchangeRateRead: 'finance.exchange_rate.read',
  exchangeRateManage: 'finance.exchange_rate.manage',
  entityCurrencyRead: 'finance.entity_currency.read',
  entityCurrencyManage: 'finance.entity_currency.manage',
  // cost centres + dimensions
  costCenterRead: 'finance.cost_center.read',
  costCenterManage: 'finance.cost_center.manage',
  costCenterArchive: 'finance.cost_center.archive',
  dimensionRead: 'finance.dimension.read',
  dimensionManage: 'finance.dimension.manage',
  dimensionValueManage: 'finance.dimension_value.manage',
  // tax + payment terms
  taxCodeRead: 'finance.tax_code.read',
  taxCodeManage: 'finance.tax_code.manage',
  taxRateManage: 'finance.tax_rate.manage',
  paymentTermRead: 'finance.payment_term.read',
  paymentTermManage: 'finance.payment_term.manage',
  // configuration
  configRead: 'finance.config.read',
  configManage: 'finance.config.manage',
  configPublish: 'finance.config.publish',
  // reporting
  analyticsRead: 'finance.analytics.read',
  analyticsExport: 'finance.analytics.export',
  // platform
  platformAdminister: 'finance.platform.administer',
} as const;

export type M19Permission = (typeof M19_PERMISSIONS)[keyof typeof M19_PERMISSIONS];

export const ALL_M19_PERMISSIONS: readonly M19Permission[] = Object.values(M19_PERMISSIONS);

/** The privileged subset — controlling/config actions + configuration + analytics export (seeded privileged). */
export const M19_PRIVILEGED_PERMISSIONS: readonly M19Permission[] = [
  M19_PERMISSIONS.entityManage,
  M19_PERMISSIONS.accountTypeManage,
  M19_PERMISSIONS.accountArchive,
  M19_PERMISSIONS.fiscalYearClose,
  M19_PERMISSIONS.fiscalYearReopen,
  M19_PERMISSIONS.periodClose,
  M19_PERMISSIONS.periodLock,
  M19_PERMISSIONS.periodReopen,
  M19_PERMISSIONS.currencyManage,
  M19_PERMISSIONS.exchangeRateManage,
  M19_PERMISSIONS.taxCodeManage,
  M19_PERMISSIONS.taxRateManage,
  M19_PERMISSIONS.configManage,
  M19_PERMISSIONS.configPublish,
  M19_PERMISSIONS.analyticsExport,
  M19_PERMISSIONS.platformAdminister,
];
