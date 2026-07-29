/**
 * Decimal-safe money + rate helpers — PURE. Finance NEVER uses floating-point arithmetic (CLAUDE.md money rule,
 * ADR-007). The finance FOUNDATION carries no monetary amounts or balances (those live with journals/postings in
 * m21) — what it DOES carry are exact decimals: FX exchange rates and tax rates. These are stored as exact
 * NUMERIC in the database and validated here as canonical decimal strings, never parsed into a binary float.
 *
 * A decimal is validated/normalised as a string: an optional leading `-`, digits, an optional single `.` with
 * digits, bounded scale. Comparison and sign checks operate on the string form so no float ever appears.
 */

/** Canonical decimal string pattern: optional sign, integer part, optional fractional part. */
const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface DecimalOptions {
  readonly maxIntegerDigits?: number;
  readonly maxScale?: number;
  readonly allowNegative?: boolean;
  readonly allowZero?: boolean;
}

/** True when `v` is a canonical decimal string within the given bounds. Never coerces to a JS number. */
export function isDecimalString(v: unknown, opts: DecimalOptions = {}): v is string {
  if (typeof v !== 'string' || !DECIMAL_RE.test(v)) return false;
  const negative = v.startsWith('-');
  if (negative && opts.allowNegative === false) return false;
  const body = negative ? v.slice(1) : v;
  const [intPart = '', fracPart = ''] = body.split('.');
  if (opts.maxIntegerDigits !== undefined && intPart.length > opts.maxIntegerDigits) return false;
  if (opts.maxScale !== undefined && fracPart.length > opts.maxScale) return false;
  if (opts.allowZero === false && isZeroDecimal(v)) return false;
  return true;
}

/** True when the decimal string is exactly zero (any scale, either sign). */
export function isZeroDecimal(v: string): boolean {
  return /^-?0(?:\.0+)?$/.test(v);
}

/** True when the decimal string is strictly positive. PURE string check, no float. */
export function isPositiveDecimal(v: string): boolean {
  return DECIMAL_RE.test(v) && !v.startsWith('-') && !isZeroDecimal(v);
}

/**
 * An exchange rate must be a strictly-positive exact decimal within bounds — a zero or negative rate is a
 * fail-closed error, and a float would silently lose precision.
 */
export function isValidRate(v: unknown): v is string {
  return isDecimalString(v, { allowNegative: false, allowZero: false, maxIntegerDigits: 18, maxScale: 12 });
}

/** A tax/percentage rate: a non-negative exact decimal, bounded scale. Zero is allowed (a 0% code). */
export function isValidPercentage(v: unknown): v is string {
  return isDecimalString(v, { allowNegative: false, maxIntegerDigits: 5, maxScale: 6 });
}

/** ISO-4217-style currency-code shape: 3 uppercase letters. */
export function isCurrencyCode(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z]{3}$/.test(v);
}

/** Minor-unit exponent for a currency (e.g. 2 for USD, 0 for JPY, 3 for BHD). Bounded 0..6. */
export function isMinorUnits(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;
}
