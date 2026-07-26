/**
 * Decimal-safe numeric core for the rules engine — PURE, deterministic, no binary float for money.
 *
 * A {@link Decimal} is an exact base-10 value carried as `{ neg, digits, scale }` where the mathematical
 * value is `(neg ? -1 : 1) * BigInt(digits) / 10 ** scale`. All arithmetic runs through BigInt so there is
 * NO floating-point rounding: `add("0.10","0.20")` is exactly `"0.30"`, never `0.30000000000000004`.
 *
 * Every parse/type error fails CLOSED by throwing {@link RuleError} — the engine never silently coerces.
 * Runs under `node --experimental-strip-types` with no imports.
 */

/** Fail-closed, machine-readable error. The single error type the whole rules engine throws. */
export class RuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'RuleError';
    this.code = code;
    // Keep `instanceof` working after transpilation/strip-types.
    Object.setPrototypeOf(this, RuleError.prototype);
  }
}

/** Hard ceilings — reject values that would blow up precision or memory. */
export const MAX_DECIMAL_SCALE = 12;
export const MAX_DECIMAL_DIGITS = 38;

export type RoundingMode = 'half_up' | 'half_even' | 'down';

/** An exact base-10 number. `digits` is the unsigned coefficient with no leading zeros (or `"0"`). */
export interface Decimal {
  readonly neg: boolean;
  readonly digits: string;
  readonly scale: number;
}

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Strip leading zeros; an all-zero / empty coefficient normalizes to `"0"`. */
function stripLeadingZeros(s: string): string {
  let i = 0;
  while (i < s.length - 1 && s.charAt(i) === '0') i += 1;
  const out = s.slice(i);
  return out === '' ? '0' : out;
}

/** Signed BigInt value of the coefficient (ignoring scale). */
function signedValue(d: Decimal): bigint {
  const mag = BigInt(d.digits);
  return d.neg ? -mag : mag;
}

/** Build a normalized {@link Decimal} from a signed scaled BigInt (arithmetic results; no scale limit). */
function decimalFromSigned(value: bigint, scale: number): Decimal {
  const neg = value < 0n;
  const mag = neg ? -value : value;
  const digits = mag.toString();
  // Never carry a negative zero.
  return { neg: digits === '0' ? false : neg, digits, scale };
}

/**
 * Parse a decimal from an integer JS number or a decimal STRING like `"1234.50"`. Rejects `NaN`/`Infinity`,
 * non-integer numbers (which would already have lost precision as a float), malformed strings, and values
 * exceeding the scale/digit ceilings. Fails closed via {@link RuleError}.
 */
export function parseDecimal(s: string | number): Decimal {
  let text: string;
  if (typeof s === 'number') {
    if (!Number.isFinite(s)) throw new RuleError('DECIMAL_INVALID', `not a finite number: ${String(s)}`);
    if (!Number.isInteger(s)) {
      throw new RuleError(
        'DECIMAL_INVALID',
        `a JS number must be an integer (use a decimal string to keep fractional precision): ${String(s)}`,
      );
    }
    text = String(s);
  } else if (typeof s === 'string') {
    text = s;
  } else {
    throw new RuleError('DECIMAL_INVALID', 'decimal must be a string or integer number');
  }

  const m = DECIMAL_RE.exec(text);
  if (m === null) throw new RuleError('DECIMAL_INVALID', `malformed decimal "${text}"`);
  const sign = m[1];
  const intPart = m[2] ?? '0';
  const fracPart = m[3] ?? '';
  const scale = fracPart.length;
  if (scale > MAX_DECIMAL_SCALE) {
    throw new RuleError('DECIMAL_SCALE', `scale ${String(scale)} exceeds max ${String(MAX_DECIMAL_SCALE)}`);
  }
  const coeff = stripLeadingZeros(intPart + fracPart);
  if (coeff.length > MAX_DECIMAL_DIGITS) {
    throw new RuleError(
      'DECIMAL_DIGITS',
      `coefficient has ${String(coeff.length)} digits, max ${String(MAX_DECIMAL_DIGITS)}`,
    );
  }
  const neg = sign === '-' && coeff !== '0';
  return { neg, digits: coeff, scale };
}

/** Canonical string form. `formatDecimal({neg:false,digits:"30",scale:2}) === "0.30"`. */
export function formatDecimal(d: Decimal): string {
  const sign = d.neg ? '-' : '';
  if (d.scale === 0) return sign + d.digits;
  let s = d.digits;
  if (s.length <= d.scale) s = '0'.repeat(d.scale - s.length + 1) + s;
  const cut = s.length - d.scale;
  return `${sign}${s.slice(0, cut)}.${s.slice(cut)}`;
}

/** Align two decimals to a common scale; returns the two scaled BigInts and that scale. */
function align(a: Decimal, b: Decimal): { readonly av: bigint; readonly bv: bigint; readonly scale: number } {
  const scale = Math.max(a.scale, b.scale);
  const av = signedValue(a) * 10n ** BigInt(scale - a.scale);
  const bv = signedValue(b) * 10n ** BigInt(scale - b.scale);
  return { av, bv, scale };
}

/** Three-way comparison, decimal-exact (no float). */
export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const { av, bv } = align(a, b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

export function eq(a: Decimal, b: Decimal): boolean {
  return compare(a, b) === 0;
}
export function ne(a: Decimal, b: Decimal): boolean {
  return compare(a, b) !== 0;
}
export function lt(a: Decimal, b: Decimal): boolean {
  return compare(a, b) < 0;
}
export function le(a: Decimal, b: Decimal): boolean {
  return compare(a, b) <= 0;
}
export function gt(a: Decimal, b: Decimal): boolean {
  return compare(a, b) > 0;
}
export function ge(a: Decimal, b: Decimal): boolean {
  return compare(a, b) >= 0;
}

export function add(a: Decimal, b: Decimal): Decimal {
  const { av, bv, scale } = align(a, b);
  return decimalFromSigned(av + bv, scale);
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const { av, bv, scale } = align(a, b);
  return decimalFromSigned(av - bv, scale);
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  return decimalFromSigned(signedValue(a) * signedValue(b), a.scale + b.scale);
}

/** `base * pct / 100`, decimal-exact. `percentOf("200","10") === "20.00"`. */
export function percentOf(base: Decimal, pct: Decimal): Decimal {
  return decimalFromSigned(signedValue(base) * signedValue(pct), base.scale + pct.scale + 2);
}

/** Round to `scale` fractional digits using the named rounding mode. Decimal-exact. */
export function roundTo(a: Decimal, scale: number, mode: RoundingMode): Decimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_DECIMAL_SCALE) {
    throw new RuleError('DECIMAL_SCALE', `invalid target scale ${String(scale)}`);
  }
  if (a.scale <= scale) {
    const v = signedValue(a) * 10n ** BigInt(scale - a.scale);
    return decimalFromSigned(v, scale);
  }
  const drop = a.scale - scale;
  const divisor = 10n ** BigInt(drop);
  const av = BigInt(a.digits);
  const q = av / divisor;
  const rem = av % divisor;
  let rounded = q;
  if (mode === 'half_up') {
    if (rem * 2n >= divisor) rounded = q + 1n;
  } else if (mode === 'half_even') {
    const twice = rem * 2n;
    if (twice > divisor) rounded = q + 1n;
    else if (twice === divisor) rounded = q % 2n === 0n ? q : q + 1n;
  }
  // 'down' => truncate toward zero => keep q as-is.
  const signed = a.neg ? -rounded : rounded;
  return decimalFromSigned(signed, scale);
}

/**
 * Decimal-safe range test. A missing bound is unbounded on that side. `minInclusive`/`maxInclusive` pick
 * `>=`/`>` and `<=`/`<` respectively.
 */
export function inRange(
  v: Decimal,
  min: Decimal | undefined,
  max: Decimal | undefined,
  minInclusive: boolean,
  maxInclusive: boolean,
): boolean {
  if (min !== undefined) {
    const c = compare(v, min);
    if (minInclusive ? c < 0 : c <= 0) return false;
  }
  if (max !== undefined) {
    const c = compare(v, max);
    if (maxInclusive ? c > 0 : c >= 0) return false;
  }
  return true;
}
