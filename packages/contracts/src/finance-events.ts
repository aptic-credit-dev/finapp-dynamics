import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `finance.lifecycle` event family — owned by m19-finance (Stage 3.1).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m19 owns no outbox.
 * Classification `internal`. m19 is the finance FOUNDATION / reference-data layer: accounting entities, the chart
 * of accounts, the fiscal calendar (periods with an open/closed/locked state), currencies + FX rates, cost
 * centres, dimensions, tax codes/rates, payment terms and finance configuration. It holds NO journals, NO
 * postings, NO reconciliation (those are m21/m15/m20). Payloads carry IDENTIFIERS, CODES, STATES, DATES and safe
 * reference dimensions ONLY — NEVER monetary amounts, balances, or float (ADR-007; CLAUDE.md money rule). Period
 * open/close/lock events are the cross-module signal downstream journal posting (m21) consumes to honour
 * "no posting into a closed period"; a consumer reads detail back through the finance API under its own
 * permissions.
 */

export const FINANCE_LIFECYCLE_FAMILY = 'finance.lifecycle';
export const FINANCE_LIFECYCLE_VERSION = 1;

export type FinanceLifecycleEventType =
  | 'EntityRegistered'
  | 'EntityUpdated'
  | 'EntityActivated'
  | 'EntityDeactivated'
  | 'AccountTypeRegistered'
  | 'AccountCreated'
  | 'AccountUpdated'
  | 'AccountActivated'
  | 'AccountDeactivated'
  | 'AccountArchived'
  | 'FiscalYearCreated'
  | 'FiscalYearClosed'
  | 'FiscalYearReopened'
  | 'PeriodOpened'
  | 'PeriodClosed'
  | 'PeriodLocked'
  | 'PeriodReopened'
  | 'CurrencyRegistered'
  | 'CurrencyUpdated'
  | 'CurrencyDeactivated'
  | 'ExchangeRateRecorded'
  | 'EntityCurrencyConfigured'
  | 'CostCenterCreated'
  | 'CostCenterUpdated'
  | 'CostCenterArchived'
  | 'DimensionRegistered'
  | 'DimensionValueAdded'
  | 'TaxCodeRegistered'
  | 'TaxRateAdded'
  | 'PaymentTermRegistered'
  | 'ConfigCreated'
  | 'ConfigPublished'
  | 'ConfigSuperseded';

export const FINANCE_LIFECYCLE_EVENT_TYPES: readonly FinanceLifecycleEventType[] = [
  'EntityRegistered',
  'EntityUpdated',
  'EntityActivated',
  'EntityDeactivated',
  'AccountTypeRegistered',
  'AccountCreated',
  'AccountUpdated',
  'AccountActivated',
  'AccountDeactivated',
  'AccountArchived',
  'FiscalYearCreated',
  'FiscalYearClosed',
  'FiscalYearReopened',
  'PeriodOpened',
  'PeriodClosed',
  'PeriodLocked',
  'PeriodReopened',
  'CurrencyRegistered',
  'CurrencyUpdated',
  'CurrencyDeactivated',
  'ExchangeRateRecorded',
  'EntityCurrencyConfigured',
  'CostCenterCreated',
  'CostCenterUpdated',
  'CostCenterArchived',
  'DimensionRegistered',
  'DimensionValueAdded',
  'TaxCodeRegistered',
  'TaxRateAdded',
  'PaymentTermRegistered',
  'ConfigCreated',
  'ConfigPublished',
  'ConfigSuperseded',
];

/**
 * A finance-foundation lifecycle / reference-data transition. Ids, codes, states, dates and safe reference
 * dimensions ONLY — never monetary amounts, balances or float (ADR-007). `entityRef` is the owning accounting
 * entity; `effectiveDate`/`rateDate` are ISO date strings.
 */
export interface FinanceLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly entityRef?: string;
  readonly code?: string;
  readonly accountType?: string;
  readonly currencyCode?: string;
  readonly quoteCurrencyCode?: string;
  readonly fiscalYearRef?: string;
  readonly periodNumber?: number;
  readonly versionNumber?: number;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reasonCode?: string;
  readonly effectiveDate?: string;
  readonly rateDate?: string;
}

export type FinanceLifecycleEvent = DomainEventEnvelope<
  typeof FINANCE_LIFECYCLE_FAMILY,
  FinanceLifecycleEventType,
  FinanceLifecyclePayload
>;
