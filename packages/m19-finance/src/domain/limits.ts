/**
 * Hard limits + shared vocabulary for the finance operations FOUNDATION. Every bound is enforced fail-closed so an
 * oversized code, an excessive batch or a runaway payload is rejected deterministically. These are DATA, shared by
 * the validators, the services and the migration CHECK constraints. Chart-of-accounts codes, cost centres,
 * dimensions, tax codes and currencies are tenant DATA (configurable per tenant) — what IS enumerated here are the
 * governed CONTROL vocabularies the platform reasons about (account classes + normal side, lifecycle states, rate
 * types, tax types). Finance foundation carries NO monetary amounts (ADR-007); exact-decimal rates live in
 * money.ts. m19 owns no journals/postings/reconciliation.
 */
export const FINANCE_LIMITS = {
  maxCodeChars: 40,
  maxNameChars: 200,
  maxDescriptionChars: 2_000,
  maxBatch: 500,
  maxSearchLimit: 200,
} as const;

export class FinanceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FinanceError';
    this.code = code;
  }
}

/** The five accounting account classes and their normal balance side (double-entry foundation). */
export const ACCOUNT_CLASSES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];
export function isAccountClass(v: unknown): v is AccountClass {
  return typeof v === 'string' && (ACCOUNT_CLASSES as readonly string[]).includes(v);
}
/** The normal balance side of a class. Assets + expenses are debit-normal; the rest are credit-normal. */
export function normalSideOf(cls: AccountClass): 'debit' | 'credit' {
  return cls === 'asset' || cls === 'expense' ? 'debit' : 'credit';
}
export const BALANCE_SIDES = ['debit', 'credit'] as const;
export type BalanceSide = (typeof BALANCE_SIDES)[number];
export function isBalanceSide(v: unknown): v is BalanceSide {
  return typeof v === 'string' && (BALANCE_SIDES as readonly string[]).includes(v);
}

/** Accounting-entity lifecycle state. */
export const ENTITY_STATUSES = ['active', 'inactive', 'archived'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];
export function isEntityStatus(v: unknown): v is EntityStatus {
  return typeof v === 'string' && (ENTITY_STATUSES as readonly string[]).includes(v);
}

/** Ledger-account lifecycle state (draft -> active <-> inactive -> archived). */
export const ACCOUNT_STATUSES = ['draft', 'active', 'inactive', 'archived'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export function isAccountStatus(v: unknown): v is AccountStatus {
  return typeof v === 'string' && (ACCOUNT_STATUSES as readonly string[]).includes(v);
}

/** Fiscal-year lifecycle state. */
export const FISCAL_YEAR_STATUSES = ['open', 'closed'] as const;
export type FiscalYearStatus = (typeof FISCAL_YEAR_STATUSES)[number];
export function isFiscalYearStatus(v: unknown): v is FiscalYearStatus {
  return typeof v === 'string' && (FISCAL_YEAR_STATUSES as readonly string[]).includes(v);
}

/**
 * Accounting-period state. `open` accepts postings; `closed` blocks new postings but may be reopened; `locked` is
 * permanently sealed (audit/year-end). This is the cross-module gate downstream posting (m21) reads.
 */
export const PERIOD_STATUSES = ['open', 'closed', 'locked'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];
export function isPeriodStatus(v: unknown): v is PeriodStatus {
  return typeof v === 'string' && (PERIOD_STATUSES as readonly string[]).includes(v);
}
/** A period accepts postings only when open. Fail closed: unknown/closed/locked => not postable. */
export function isPeriodPostable(status: string): boolean {
  return status === 'open';
}

export const CURRENCY_STATUSES = ['active', 'inactive'] as const;
export type CurrencyStatus = (typeof CURRENCY_STATUSES)[number];
export function isCurrencyStatus(v: unknown): v is CurrencyStatus {
  return typeof v === 'string' && (CURRENCY_STATUSES as readonly string[]).includes(v);
}

/** Exchange-rate kinds. */
export const RATE_TYPES = ['spot', 'closing', 'average', 'historical', 'budget'] as const;
export type RateType = (typeof RATE_TYPES)[number];
export function isRateType(v: unknown): v is RateType {
  return typeof v === 'string' && (RATE_TYPES as readonly string[]).includes(v);
}

/** How an entity relates to a currency in its currency configuration. */
export const ENTITY_CURRENCY_ROLES = ['functional', 'presentation', 'transaction'] as const;
export type EntityCurrencyRole = (typeof ENTITY_CURRENCY_ROLES)[number];
export function isEntityCurrencyRole(v: unknown): v is EntityCurrencyRole {
  return typeof v === 'string' && (ENTITY_CURRENCY_ROLES as readonly string[]).includes(v);
}

export const COST_CENTER_STATUSES = ['active', 'inactive', 'archived'] as const;
export type CostCenterStatus = (typeof COST_CENTER_STATUSES)[number];
export function isCostCenterStatus(v: unknown): v is CostCenterStatus {
  return typeof v === 'string' && (COST_CENTER_STATUSES as readonly string[]).includes(v);
}

/** Analytical dimension kinds. `custom` covers tenant-defined analytical axes. */
export const DIMENSION_KINDS = ['project', 'department', 'product', 'region', 'segment', 'custom'] as const;
export type DimensionKind = (typeof DIMENSION_KINDS)[number];
export function isDimensionKind(v: unknown): v is DimensionKind {
  return typeof v === 'string' && (DIMENSION_KINDS as readonly string[]).includes(v);
}

export const TAX_TYPES = ['vat', 'gst', 'sales', 'withholding', 'excise', 'income', 'other'] as const;
export type TaxType = (typeof TAX_TYPES)[number];
export function isTaxType(v: unknown): v is TaxType {
  return typeof v === 'string' && (TAX_TYPES as readonly string[]).includes(v);
}

/** Payment-term basis. */
export const PAYMENT_TERM_BASES = ['net_days', 'end_of_month', 'day_of_month', 'immediate'] as const;
export type PaymentTermBasis = (typeof PAYMENT_TERM_BASES)[number];
export function isPaymentTermBasis(v: unknown): v is PaymentTermBasis {
  return typeof v === 'string' && (PAYMENT_TERM_BASES as readonly string[]).includes(v);
}
