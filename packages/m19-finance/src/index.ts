/**
 * @finapp/m19-finance — finance operations FOUNDATION (Stage 3.1).
 *
 * The PURE domain layer (governed accounting vocabulary + normal-balance sides, the account/period/fiscal-year/
 * config state machines, decimal-safe rate/percentage/currency validators, canonical content hashing, reference-
 * number formatting) carries no I/O and is exhaustively unit-tested. The services layer runs everything inside
 * `db.withTenant` with append-only history + audit + outbox in the SAME transaction; m19 consumes DB/AUDIT/AUTHZ
 * via kernel tokens and publishes `finance.lifecycle` through the ONE outbox m06 owns. m19 is the finance
 * reference-data foundation — accounting entities, the chart of accounts, the fiscal calendar (periods with an
 * open/closed/locked state that is the cross-module posting gate), currencies + FX rates, cost centres, analytical
 * dimensions, tax codes/rates, payment terms and versioned finance configuration. It OWNS NO journals, NO postings,
 * NO reconciliation and NO approval workflow (m21/m15/m20/m22), and it carries NO monetary amounts or balances: the
 * only money-adjacent values are EXACT-decimal FX + tax rates, kept as STRINGS end-to-end and never parsed into a
 * float (ADR-007; CLAUDE.md money rule). Config is PUBLISHABLE + immutable-after-publish: content_hash is frozen at
 * publish and a change is a NEW version (supersession). m19 owns only `finance_*`; it never reads another module's
 * tables.
 */

// Permissions + audit codes
export { M19_PERMISSIONS, ALL_M19_PERMISSIONS, M19_PRIVILEGED_PERMISSIONS } from './permissions.ts';
export type { M19Permission } from './permissions.ts';
export { M19_AUDIT_CODES, ALL_M19_AUDIT_CODES, FIN_AUDIT_PREFIX } from './audit-codes.ts';
export type { M19AuditCode } from './audit-codes.ts';

// Domain — limits + governed vocabulary + guards
export {
  FINANCE_LIMITS,
  FinanceError,
  ACCOUNT_CLASSES,
  isAccountClass,
  normalSideOf,
  BALANCE_SIDES,
  isBalanceSide,
  ENTITY_STATUSES,
  isEntityStatus,
  ACCOUNT_STATUSES,
  isAccountStatus,
  FISCAL_YEAR_STATUSES,
  isFiscalYearStatus,
  PERIOD_STATUSES,
  isPeriodStatus,
  isPeriodPostable,
  CURRENCY_STATUSES,
  isCurrencyStatus,
  RATE_TYPES,
  isRateType,
  ENTITY_CURRENCY_ROLES,
  isEntityCurrencyRole,
  COST_CENTER_STATUSES,
  isCostCenterStatus,
  DIMENSION_KINDS,
  isDimensionKind,
  TAX_TYPES,
  isTaxType,
  PAYMENT_TERM_BASES,
  isPaymentTermBasis,
} from './domain/limits.ts';
export type {
  AccountClass,
  BalanceSide,
  EntityStatus,
  AccountStatus,
  FiscalYearStatus,
  PeriodStatus,
  CurrencyStatus,
  RateType,
  EntityCurrencyRole,
  CostCenterStatus,
  DimensionKind,
  TaxType,
  PaymentTermBasis,
} from './domain/limits.ts';

// Domain — the lifecycle state machines
export {
  checkAccountTransition,
  isAccountTerminal,
  isAccountPostable,
  checkPeriodTransition,
  isPeriodTerminal,
  checkFiscalYearTransition,
  CONFIG_STATUSES,
  checkConfigTransition,
  isConfigFrozen,
  isConfigActive,
} from './domain/lifecycles.ts';
export type { TransitionResult, ConfigStatus } from './domain/lifecycles.ts';

// Decimal-safe money + rate helpers (STRINGS, never float; ADR-007)
export {
  isDecimalString,
  isZeroDecimal,
  isPositiveDecimal,
  isValidRate,
  isValidPercentage,
  isCurrencyCode,
  isMinorUnits,
} from './money.ts';
export type { DecimalOptions } from './money.ts';

// Reference-number + hash + ports
export { formatFinanceNumber, isValidFinanceNumber } from './finance-number.ts';
export { contentHashOf, canonicalJson } from './hash.ts';
export { SystemClock, FixedClock } from './ports.ts';
export type { Clock } from './ports.ts';

// Persistence + emit + errors
export { FinanceRepository } from './repository.ts';
export type {
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
} from './repository.ts';
export { M19Emitter } from './emit.ts';
export { badRequest, invalidSpec } from './errors.ts';

// Services
export { CatalogService } from './catalog.service.ts';
export { ChartService } from './chart.service.ts';
export { CalendarService } from './calendar.service.ts';
export { ConfigService } from './config.service.ts';
