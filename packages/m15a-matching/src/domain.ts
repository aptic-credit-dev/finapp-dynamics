/**
 * M15a matching domain — governed vocabulary + integer-minor-unit money helpers. PURE. Money is INTEGER MINOR
 * UNITS (e.g. cents) held in JS integers; NEVER float, NEVER decimal arithmetic on money (ADR-007, CLAUDE.md).
 * Text-similarity scores are ratios in [0,1] and are NOT money.
 */

/** A matching rule kind. `composite` is the weighted combination the engine computes. */
export const RULE_KINDS = [
  'exact_reference',
  'exact_amount',
  'date_window',
  'similarity',
  'composite',
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export function isRuleKind(v: unknown): v is RuleKind {
  return typeof v === 'string' && (RULE_KINDS as readonly string[]).includes(v);
}

/** Confidence bands, each mapped to the spec's colour status. */
export const CONFIDENCE_BANDS = ['exact', 'strong', 'partial', 'review', 'unmatched'] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];
export function isConfidenceBand(v: unknown): v is ConfidenceBand {
  return typeof v === 'string' && (CONFIDENCE_BANDS as readonly string[]).includes(v);
}
/** Colour status per band (BANK_RECONCILIATION.md); `escalated` is reserved for the workflow, not the engine. */
export const COLOUR_STATUS: Record<ConfidenceBand, string> = {
  exact: 'dark_green',
  strong: 'light_green',
  partial: 'amber',
  review: 'orange',
  unmatched: 'red',
};

/** Match cardinalities. */
export const MATCH_TYPES = [
  'one_to_one',
  'one_to_many',
  'many_to_one',
  'many_to_many',
  'split',
  'grouped',
] as const;
export type MatchType = (typeof MATCH_TYPES)[number];
export function isMatchType(v: unknown): v is MatchType {
  return typeof v === 'string' && (MATCH_TYPES as readonly string[]).includes(v);
}

export const DIRECTIONS = ['debit', 'credit'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export function isDirection(v: unknown): v is Direction {
  return typeof v === 'string' && (DIRECTIONS as readonly string[]).includes(v);
}

export const EXCEPTION_TYPES = [
  'unmatched_statement',
  'unmatched_ledger',
  'amount_mismatch',
  'date_out_of_window',
  'duplicate_suspect',
  'ambiguous_match',
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];
export function isExceptionType(v: unknown): v is ExceptionType {
  return typeof v === 'string' && (EXCEPTION_TYPES as readonly string[]).includes(v);
}

export class MatchingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MatchingError';
    this.code = code;
  }
}

/** A money amount in integer minor units. Rejects non-integers / floats fail-closed. */
export function assertMinorUnits(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || !Number.isSafeInteger(v)) {
    throw new MatchingError('INVALID_MONEY', `${what} must be an integer number of minor units (no float)`);
  }
  return v;
}

/** The absolute variance between two minor-unit amounts (integer). */
export function amountVarianceMinor(a: number, b: number): number {
  return Math.abs(assertMinorUnits(a, 'amount') - assertMinorUnits(b, 'amount'));
}

/** Whole-day difference between two ISO dates (YYYY-MM-DD), by UTC midnight. Deterministic; no ambient clock. */
export function dateVarianceDays(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db))
    throw new MatchingError('INVALID_DATE', 'dates must be ISO YYYY-MM-DD');
  return Math.round(Math.abs(da - db) / 86_400_000);
}
