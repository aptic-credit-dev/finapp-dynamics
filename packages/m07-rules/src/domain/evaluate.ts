/**
 * The deterministic rule-set evaluation engine — PURE, decimal-safe, fail-closed, explainable.
 *
 * Given a (validated) rule-set spec and a normalized input, `evaluateRuleSet` produces a structured
 * {@link Explanation}: the outcome, the outputs, which rows matched, the reason codes, per-table row
 * traces, the derived values and any warnings. Identical `(spec, input, context, ENGINE_VERSION)` ALWAYS
 * yields an identical Explanation: there is no `Date.now`, no `Math.random`, no env/fs/network. Any "now"
 * comes only from `context.evaluatedAt`. The only node import is `node:crypto` for the stable input hash —
 * a deterministic function, used for nothing but hashing.
 */
import { createHash } from 'node:crypto';
import { evaluateTable, type RowTrace } from './decision-table.ts';
import type { Value } from './conditions.ts';
import {
  RuleError,
  add,
  formatDecimal,
  multiply,
  parseDecimal,
  percentOf,
  subtract,
  type Decimal,
} from './decimal.ts';
import type { DerivedField, FieldSchema, RuleSetSpec } from './ruleset.ts';
import { RULE_LIMITS } from './ruleset.ts';

export const ENGINE_VERSION = 'm07-rules/1';

/** When no `evaluatedAt` is supplied, effective-date windows resolve against this fixed sentinel. */
export const DEFAULT_EVALUATED_AT = '1970-01-01T00:00:00Z';

export type Env = Record<string, Value>;

export interface EvaluationInput {
  readonly input: Record<string, unknown>;
  readonly context?: { readonly evaluatedAt: string };
}

export interface TableTrace {
  readonly tableId: string;
  readonly matchedRowIds: string[];
  readonly rowTraces: RowTrace[];
}

export interface Explanation {
  readonly engineVersion: string;
  readonly ruleSetCode: string;
  readonly outcome: 'matched' | 'no_match' | 'error';
  readonly outputs: Record<string, Value>;
  readonly matchedRuleIds: string[];
  readonly reasonCodes: string[];
  readonly tableTraces: TableTrace[];
  readonly derivedValues: Record<string, Value>;
  readonly warnings: string[];
}

// ---------------------------------------------------------------------------------------------------
// Input validation & normalization (fail closed)
// ---------------------------------------------------------------------------------------------------

function normalizeIso(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  if (s.includes('T') && !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return `${s}Z`;
  return s;
}

function isValidIso(s: string): boolean {
  return !Number.isNaN(Date.parse(normalizeIso(s)));
}

/** Recursively bound the raw input's nesting depth, collection sizes and string lengths. */
function checkInputBounds(v: unknown, depth: number): void {
  if (depth > RULE_LIMITS.maxInputDepth) throw new RuleError('INPUT_INVALID', 'input nesting is too deep');
  if (Array.isArray(v)) {
    const arr: unknown[] = v;
    if (arr.length > RULE_LIMITS.maxCollectionSize)
      throw new RuleError('INPUT_INVALID', 'input collection too large');
    for (const item of arr) checkInputBounds(item, depth + 1);
    return;
  }
  if (v !== null && typeof v === 'object') {
    const obj: Record<string, unknown> = v as Record<string, unknown>;
    for (const k of Object.keys(obj)) checkInputBounds(obj[k], depth + 1);
    return;
  }
  if (typeof v === 'string' && v.length > RULE_LIMITS.maxStringLength) {
    throw new RuleError('INPUT_INVALID', 'input string exceeds the length limit');
  }
}

/** Validate raw input against the input schema; return the normalized, decimal-canonicalized env values. */
function validateInput(spec: RuleSetSpec, rawInput: Record<string, unknown>): Env {
  checkInputBounds(rawInput, 0);
  const out: Env = {};
  for (const field of spec.inputSchema) {
    const raw = rawInput[field.name];
    if (raw === undefined || raw === null) {
      if (field.required === true) {
        throw new RuleError('INPUT_INVALID', `required input "${field.name}" is missing`);
      }
      continue;
    }
    out[field.name] = validateInputValue(field, raw);
  }
  // Deterministic key order.
  const sorted: Env = {};
  for (const k of Object.keys(out).sort()) {
    const v = out[k];
    if (v !== undefined) sorted[k] = v;
  }
  return sorted;
}

function validateInputValue(field: FieldSchema, raw: unknown): Value {
  switch (field.type) {
    case 'string': {
      if (typeof raw !== 'string') throw new RuleError('INPUT_INVALID', `"${field.name}" must be a string`);
      if (field.maxLength !== undefined && raw.length > field.maxLength) {
        throw new RuleError('INPUT_INVALID', `"${field.name}" exceeds maxLength ${String(field.maxLength)}`);
      }
      return raw;
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new RuleError('INPUT_INVALID', `"${field.name}" must be a finite number`);
      }
      return raw;
    }
    case 'decimal': {
      if (typeof raw !== 'string' && typeof raw !== 'number') {
        throw new RuleError('INPUT_INVALID', `"${field.name}" must be a decimal string or integer`);
      }
      let dec: Decimal;
      try {
        dec = parseDecimal(raw);
      } catch {
        throw new RuleError('INPUT_INVALID', `"${field.name}" is not a valid decimal`);
      }
      if (field.scale !== undefined && dec.scale > field.scale) {
        throw new RuleError('INPUT_INVALID', `"${field.name}" exceeds scale ${String(field.scale)}`);
      }
      return formatDecimal(dec);
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') throw new RuleError('INPUT_INVALID', `"${field.name}" must be a boolean`);
      return raw;
    }
    case 'date': {
      if (typeof raw !== 'string' || !isValidIso(raw)) {
        throw new RuleError('INPUT_INVALID', `"${field.name}" must be an ISO date`);
      }
      return raw;
    }
    default: {
      // 'enum'
      if (typeof raw !== 'string' || !(field.enumValues ?? []).includes(raw)) {
        throw new RuleError('INPUT_INVALID', `"${field.name}" must be one of its enum values`);
      }
      return raw;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Derived fields (declared order, decimal-safe). Cycles were rejected at validate time.
// ---------------------------------------------------------------------------------------------------

function resolveArg(arg: string | Value, env: Env): Value {
  if (typeof arg === 'string' && Object.prototype.hasOwnProperty.call(env, arg)) {
    const v = env[arg];
    return v === undefined ? null : v;
  }
  return arg;
}

function asDecimal(v: Value, name: string): Decimal {
  if (typeof v === 'number' || typeof v === 'string') {
    try {
      return parseDecimal(v);
    } catch {
      throw new RuleError('DERIVED_INVALID', `derived "${name}" operand is not a decimal`);
    }
  }
  throw new RuleError('DERIVED_INVALID', `derived "${name}" operand is not a decimal`);
}

function computeDerived(d: DerivedField, env: Env): Value {
  const args = d.args.map((a) => resolveArg(a, env));
  const a0 = args[0];
  const a1 = args[1];
  switch (d.op) {
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'percent': {
      if (a0 === undefined || a1 === undefined)
        throw new RuleError('DERIVED_INVALID', `derived "${d.name}" needs two operands`);
      const x = asDecimal(a0, d.name);
      const y = asDecimal(a1, d.name);
      if (d.op === 'add') return formatDecimal(add(x, y));
      if (d.op === 'subtract') return formatDecimal(subtract(x, y));
      if (d.op === 'multiply') return formatDecimal(multiply(x, y));
      return formatDecimal(percentOf(x, y));
    }
    case 'concat':
      return args.map((v) => (v === null ? '' : String(v))).join('');
    case 'lower': {
      if (a0 === undefined) throw new RuleError('DERIVED_INVALID', `derived "${d.name}" needs an operand`);
      return String(a0).toLowerCase();
    }
    case 'upper': {
      if (a0 === undefined) throw new RuleError('DERIVED_INVALID', `derived "${d.name}" needs an operand`);
      return String(a0).toUpperCase();
    }
    default: {
      // 'coalesce'
      for (const v of args) if (v !== null && v !== undefined) return v;
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------------------------------

function validateOutputs(spec: RuleSetSpec, outputs: Record<string, Value>): void {
  const byName = new Map<string, FieldSchema>();
  for (const f of spec.outputSchema) byName.set(f.name, f);
  for (const key of Object.keys(outputs)) {
    const field = byName.get(key);
    if (field === undefined)
      throw new RuleError('OUTPUT_INVALID', `output "${key}" is not in the output schema`);
    const v = outputs[key];
    if (v === undefined) continue;
    if (!outputValueValid(field, v)) {
      throw new RuleError('OUTPUT_INVALID', `output "${key}" has an invalid value for type ${field.type}`);
    }
  }
}

function outputValueValid(field: FieldSchema, v: Value): boolean {
  switch (field.type) {
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'decimal':
      if (typeof v !== 'string' && typeof v !== 'number') return false;
      try {
        parseDecimal(v);
        return true;
      } catch {
        return false;
      }
    case 'boolean':
      return typeof v === 'boolean';
    case 'date':
      return typeof v === 'string' && isValidIso(v);
    default:
      return typeof v === 'string' && (field.enumValues ?? []).includes(v);
  }
}

// ---------------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------------

/**
 * Evaluate a rule-set spec against an input. Fails CLOSED: invalid input/output throws {@link RuleError}.
 * Deterministic ordering everywhere — tables run in declared order, keys are sorted, and the only clock is
 * the explicit `context.evaluatedAt`.
 */
export function evaluateRuleSet(spec: RuleSetSpec, ev: EvaluationInput): Explanation {
  const evaluatedAt = ev.context?.evaluatedAt ?? DEFAULT_EVALUATED_AT;

  // 1) validate + normalize the input
  const env: Env = validateInput(spec, ev.input);

  // 2) derived fields, declared order, each visible to the next
  const derivedValues: Env = {};
  for (const d of spec.derived ?? []) {
    const value = computeDerived(d, env);
    env[d.name] = value;
    derivedValues[d.name] = value;
  }

  // 3) evaluate each decision table over the merged env
  const mergedOutputs: Record<string, Value> = {};
  const matchedRuleIds: string[] = [];
  const reasonCodes: string[] = [];
  const tableTraces: TableTrace[] = [];
  const warnings: string[] = [];
  for (const table of spec.decisionTables) {
    const res = evaluateTable(table, env, evaluatedAt);
    for (const k of Object.keys(res.outputs)) {
      const v = res.outputs[k];
      if (v !== undefined) mergedOutputs[k] = v;
    }
    for (const id of res.matchedRowIds) matchedRuleIds.push(id);
    for (const rc of res.reasonCodes) reasonCodes.push(rc);
    for (const w of res.warnings) warnings.push(`${table.id}:${w}`);
    tableTraces.push({ tableId: table.id, matchedRowIds: res.matchedRowIds, rowTraces: res.rowTraces });
  }

  // 4) validate the produced outputs against the output schema
  validateOutputs(spec, mergedOutputs);

  // 5) deterministic Explanation (sorted output/derived keys)
  const outputs: Record<string, Value> = {};
  for (const k of Object.keys(mergedOutputs).sort()) {
    const v = mergedOutputs[k];
    if (v !== undefined) outputs[k] = v;
  }
  const derived: Record<string, Value> = {};
  for (const k of Object.keys(derivedValues).sort()) {
    const v = derivedValues[k];
    if (v !== undefined) derived[k] = v;
  }

  return {
    engineVersion: ENGINE_VERSION,
    ruleSetCode: spec.code,
    outcome: matchedRuleIds.length > 0 ? 'matched' : 'no_match',
    outputs,
    matchedRuleIds,
    reasonCodes,
    tableTraces,
    derivedValues: derived,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------------
// Stable input hash — canonical (sorted-key) JSON hashed with SHA-256. Deterministic; the ONLY node import.
// ---------------------------------------------------------------------------------------------------

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) {
    const arr: unknown[] = v;
    return arr.map(canonical);
  }
  if (v !== null && typeof v === 'object') {
    const obj: Record<string, unknown> = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = canonical(obj[k]);
    return out;
  }
  return v;
}

/** Stable content hash of an input object — identical inputs hash identically, changed inputs differ. */
export function inputHash(input: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(input)))
    .digest('hex');
}
