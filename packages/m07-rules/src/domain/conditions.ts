/**
 * Structured condition model + evaluator — PURE, deterministic, decimal-safe, fail-closed.
 *
 * Conditions are TYPED JSON, never free text: there is NO eval / Function / vm / require anywhere, so a
 * tenant's condition is data the engine interprets, never code it runs. `evaluateCondition` returns both the
 * boolean result and a structured {@link ConditionTrace} sub-tree for explainability. It fails CLOSED — an
 * unknown `type`/`op` or an un-orderable type mismatch throws {@link RuleError} — but a merely-missing field
 * in a comparison reads as "not matched" (except `present`/`absent`, which report on presence itself).
 *
 * Runs under `node --experimental-strip-types`.
 */
import {
  RuleError,
  compare as decCompare,
  inRange as decInRange,
  parseDecimal,
  type Decimal,
} from './decimal.ts';

export type Value = string | number | boolean | null;
export type Env = Record<string, Value>;

export const COMPARE_OPS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

export const STRING_OPS = ['equals', 'startsWith', 'endsWith', 'contains'] as const;
export type StringOp = (typeof STRING_OPS)[number];

export const DATE_OPS = ['eq', 'lt', 'le', 'gt', 'ge'] as const;
export type DateOp = (typeof DATE_OPS)[number];

export const VALUE_TYPES = ['number', 'decimal', 'string', 'boolean', 'date'] as const;
export type CondValueType = (typeof VALUE_TYPES)[number];

export type Condition =
  | {
      readonly type: 'compare';
      readonly field: string;
      readonly op: CompareOp;
      readonly value: Value;
      readonly valueType?: CondValueType;
    }
  | { readonly type: 'in'; readonly field: string; readonly values: readonly Value[] }
  | {
      readonly type: 'range';
      readonly field: string;
      readonly min?: Value;
      readonly max?: Value;
      readonly minInclusive?: boolean;
      readonly maxInclusive?: boolean;
      readonly valueType?: 'number' | 'decimal' | 'date';
    }
  | { readonly type: 'present'; readonly field: string }
  | { readonly type: 'absent'; readonly field: string }
  | {
      readonly type: 'string';
      readonly field: string;
      readonly op: StringOp;
      readonly value: string;
      readonly normalize?: boolean;
    }
  | { readonly type: 'date'; readonly field: string; readonly op: DateOp; readonly value: string }
  | { readonly type: 'and'; readonly conditions: readonly Condition[] }
  | { readonly type: 'or'; readonly conditions: readonly Condition[] }
  | { readonly type: 'not'; readonly condition: Condition };

/** A node of the explanation tree: what was evaluated and whether it matched. */
export interface ConditionTrace {
  readonly type: string;
  readonly matched: boolean;
  readonly field?: string;
  readonly children?: readonly ConditionTrace[];
}

export interface ConditionResult {
  readonly matched: boolean;
  readonly trace: ConditionTrace;
}

// ---------------------------------------------------------------------------------------------------
// Value coercion / comparison helpers — deterministic, fail-closed.
// ---------------------------------------------------------------------------------------------------

/** Deterministic ISO normalization so parsing never depends on the host timezone. */
function normalizeIso(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  if (s.includes('T') && !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return `${s}Z`;
  return s;
}

function toEpoch(v: Value): number {
  if (typeof v !== 'string') throw new RuleError('BAD_DATE', 'date value must be an ISO string');
  const ms = Date.parse(normalizeIso(v));
  if (Number.isNaN(ms)) throw new RuleError('BAD_DATE', `invalid ISO date "${v}"`);
  return ms;
}

function toDecimal(v: Value): Decimal {
  if (typeof v === 'number' || typeof v === 'string') return parseDecimal(v);
  throw new RuleError('TYPE_MISMATCH', `cannot treat ${typeof v} as a decimal`);
}

function sign(n: number): -1 | 0 | 1 {
  if (n < 0) return -1;
  if (n > 0) return 1;
  return 0;
}

/** Equality for `eq`/`ne` without an explicit valueType: null==null only; different types are unequal. */
function valuesEqual(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === null && b === null;
  if (typeof a !== typeof b) return false;
  return a === b;
}

/** Ordered three-way comparison. Throws on an un-orderable type mismatch (fail closed). */
function orderedCompare(a: Value, b: Value, valueType: CondValueType | undefined): -1 | 0 | 1 {
  if (valueType === 'decimal') return decCompare(toDecimal(a), toDecimal(b));
  if (valueType === 'date') return sign(toEpoch(a) - toEpoch(b));
  if (valueType === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) throw new RuleError('TYPE_MISMATCH', 'non-numeric operand');
    return sign(na - nb);
  }
  if (valueType === 'boolean') return sign((a === true ? 1 : 0) - (b === true ? 1 : 0));
  if (valueType === 'string') {
    const sa = String(a);
    const sb = String(b);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    return 0;
  }
  // No declared type: infer from the operands, and refuse to order mixed/incomparable types.
  if (typeof a === 'number' && typeof b === 'number') return sign(a - b);
  if (typeof a === 'string' && typeof b === 'string') {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  throw new RuleError('TYPE_MISMATCH', `cannot order ${typeName(a)} and ${typeName(b)}`);
}

function typeName(v: Value): string {
  return v === null ? 'null' : typeof v;
}

function applyOrder(op: CompareOp | DateOp, cmp: -1 | 0 | 1): boolean {
  switch (op) {
    case 'eq':
      return cmp === 0;
    case 'ne':
      return cmp !== 0;
    case 'lt':
      return cmp < 0;
    case 'le':
      return cmp <= 0;
    case 'gt':
      return cmp > 0;
    default:
      return cmp >= 0; // 'ge'
  }
}

// ---------------------------------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------------------------------

/**
 * Evaluate a condition against `env`. Deterministic and side-effect-free. Returns the match plus a trace
 * tree. Validates the `type`/`op` allow-list FIRST (so an unsafe operator fails closed even when the field
 * is absent), then evaluates.
 */
export function evaluateCondition(cond: Condition, env: Env): ConditionResult {
  switch (cond.type) {
    case 'compare':
      return leaf(cond.type, cond.field, evalCompare(cond, env));
    case 'in':
      return leaf(cond.type, cond.field, evalIn(cond, env));
    case 'range':
      return leaf(cond.type, cond.field, evalRange(cond, env));
    case 'present':
      return leaf(cond.type, cond.field, present(env[cond.field]));
    case 'absent':
      return leaf(cond.type, cond.field, !present(env[cond.field]));
    case 'string':
      return leaf(cond.type, cond.field, evalString(cond, env));
    case 'date':
      return leaf(cond.type, cond.field, evalDate(cond, env));
    case 'and':
    case 'or': {
      const children = cond.conditions.map((c) => evaluateCondition(c, env));
      const matched =
        cond.type === 'and' ? children.every((c) => c.matched) : children.some((c) => c.matched);
      return { matched, trace: { type: cond.type, matched, children: children.map((c) => c.trace) } };
    }
    case 'not': {
      const child = evaluateCondition(cond.condition, env);
      const matched = !child.matched;
      return { matched, trace: { type: 'not', matched, children: [child.trace] } };
    }
    default:
      throw new RuleError(
        'UNSAFE_CONDITION',
        `unknown condition type "${String((cond as { type: unknown }).type)}"`,
      );
  }
}

function leaf(type: string, field: string, matched: boolean): ConditionResult {
  return { matched, trace: { type, matched, field } };
}

function present(v: Value | undefined): boolean {
  return v !== undefined && v !== null;
}

function evalCompare(cond: Extract<Condition, { type: 'compare' }>, env: Env): boolean {
  if (!(COMPARE_OPS as readonly string[]).includes(cond.op)) {
    throw new RuleError('BAD_OPERATOR', `unknown compare op "${cond.op}"`);
  }
  const raw = env[cond.field];
  if (raw === undefined) return false;
  if (cond.op === 'eq' || cond.op === 'ne') {
    const isEqual =
      cond.valueType === undefined
        ? valuesEqual(raw, cond.value)
        : orderedCompare(raw, cond.value, cond.valueType) === 0;
    return cond.op === 'eq' ? isEqual : !isEqual;
  }
  return applyOrder(cond.op, orderedCompare(raw, cond.value, cond.valueType));
}

function evalIn(cond: Extract<Condition, { type: 'in' }>, env: Env): boolean {
  const raw = env[cond.field];
  if (raw === undefined) return false;
  return cond.values.some((v) => valuesEqual(raw, v));
}

function evalRange(cond: Extract<Condition, { type: 'range' }>, env: Env): boolean {
  const raw = env[cond.field];
  if (raw === undefined) return false;
  const vt = cond.valueType;
  const minInclusive = cond.minInclusive ?? true;
  const maxInclusive = cond.maxInclusive ?? true;
  if (vt === 'decimal') {
    return decInRange(
      toDecimal(raw),
      cond.min === undefined ? undefined : toDecimal(cond.min),
      cond.max === undefined ? undefined : toDecimal(cond.max),
      minInclusive,
      maxInclusive,
    );
  }
  if (cond.min !== undefined) {
    const c = orderedCompare(raw, cond.min, vt);
    if (minInclusive ? c < 0 : c <= 0) return false;
  }
  if (cond.max !== undefined) {
    const c = orderedCompare(raw, cond.max, vt);
    if (maxInclusive ? c > 0 : c >= 0) return false;
  }
  return true;
}

function evalString(cond: Extract<Condition, { type: 'string' }>, env: Env): boolean {
  if (!(STRING_OPS as readonly string[]).includes(cond.op)) {
    throw new RuleError('BAD_OPERATOR', `unknown string op "${cond.op}"`);
  }
  const raw = env[cond.field];
  if (typeof raw !== 'string') return false;
  const a = cond.normalize === true ? raw.toLowerCase() : raw;
  const b = cond.normalize === true ? cond.value.toLowerCase() : cond.value;
  switch (cond.op) {
    case 'equals':
      return a === b;
    case 'startsWith':
      return a.startsWith(b);
    case 'endsWith':
      return a.endsWith(b);
    default:
      return a.includes(b); // 'contains'
  }
}

function evalDate(cond: Extract<Condition, { type: 'date' }>, env: Env): boolean {
  if (!(DATE_OPS as readonly string[]).includes(cond.op)) {
    throw new RuleError('BAD_OPERATOR', `unknown date op "${cond.op}"`);
  }
  const raw = env[cond.field];
  if (raw === undefined) return false;
  return applyOrder(cond.op, sign(toEpoch(raw) - toEpoch(cond.value)));
}

// ---------------------------------------------------------------------------------------------------
// Structural helpers (used for limit checks by the validator)
// ---------------------------------------------------------------------------------------------------

/** Every field name referenced anywhere in the condition, de-duplicated and sorted (deterministic). */
export function collectFields(cond: Condition): string[] {
  const out = new Set<string>();
  const walk = (c: Condition): void => {
    switch (c.type) {
      case 'compare':
      case 'in':
      case 'range':
      case 'present':
      case 'absent':
      case 'string':
      case 'date':
        out.add(c.field);
        return;
      case 'and':
      case 'or':
        c.conditions.forEach(walk);
        return;
      case 'not':
        walk(c.condition);
        return;
      default:
        return;
    }
  };
  walk(cond);
  return [...out].sort();
}

/** Maximum nesting depth (a leaf is depth 1). */
export function conditionDepth(cond: Condition): number {
  switch (cond.type) {
    case 'and':
    case 'or': {
      let max = 0;
      for (const c of cond.conditions) max = Math.max(max, conditionDepth(c));
      return 1 + max;
    }
    case 'not':
      return 1 + conditionDepth(cond.condition);
    default:
      return 1;
  }
}

/** Total number of condition nodes. */
export function conditionNodeCount(cond: Condition): number {
  switch (cond.type) {
    case 'and':
    case 'or': {
      let total = 1;
      for (const c of cond.conditions) total += conditionNodeCount(c);
      return total;
    }
    case 'not':
      return 1 + conditionNodeCount(cond.condition);
    default:
      return 1;
  }
}
