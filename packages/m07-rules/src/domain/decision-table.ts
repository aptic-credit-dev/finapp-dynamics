/**
 * Decision tables + hit policies — PURE, deterministic, decimal-safe, fail-closed.
 *
 * A decision table is an ORDERED list of rows; each row has a structured `when` condition, a set of typed
 * outputs, and a reason code. A hit policy decides which matched row(s) produce the outputs:
 *   FIRST    — the first matched row (declared order).
 *   UNIQUE   — exactly one row may match; two matches is a definition error (fails closed).
 *   COLLECT  — every matched row; an optional `aggregate` folds one output field decimal-safe.
 *   PRIORITY — the highest-priority matched row (priority desc, ties broken by declared order, stable).
 *
 * Determinism: row order is fixed, key iteration is sorted, and there is no wall-clock — any "now" comes
 * only from the explicit `evaluatedAt` used to skip disabled / out-of-window rows.
 */
import { evaluateCondition, type Condition, type Value } from './conditions.ts';
import { RuleError, add, compare, formatDecimal, parseDecimal, type Decimal } from './decimal.ts';

export const HIT_POLICIES = ['FIRST', 'UNIQUE', 'COLLECT', 'PRIORITY'] as const;
export type HitPolicy = (typeof HIT_POLICIES)[number];

export const AGGREGATE_OPS = ['sum', 'min', 'max', 'count'] as const;
export type AggregateOp = (typeof AGGREGATE_OPS)[number];

export interface DecisionRow {
  readonly id: string;
  readonly priority?: number;
  readonly enabled?: boolean;
  readonly when: Condition;
  readonly outputs: Readonly<Record<string, Value>>;
  readonly reasonCode: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
}

export interface DecisionAggregate {
  readonly field: string;
  readonly op: AggregateOp;
}

export interface DecisionTable {
  readonly id: string;
  readonly name?: string;
  readonly inputFields: readonly string[];
  readonly outputFields: readonly string[];
  readonly hitPolicy: HitPolicy;
  readonly rows: readonly DecisionRow[];
  readonly aggregate?: DecisionAggregate;
}

export interface RowTrace {
  readonly rowId: string;
  readonly matched: boolean;
}

export interface TableResult {
  readonly outputs: Record<string, Value>;
  readonly matchedRowIds: string[];
  readonly reasonCodes: string[];
  readonly rowTraces: RowTrace[];
  readonly warnings: string[];
}

function epoch(iso: string): number {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) throw new RuleError('BAD_DATE', `invalid effective date "${iso}"`);
  return ms;
}

/** A row participates only if enabled (default true) and `evaluatedAt` is within its effective window. */
function isRowEligible(row: DecisionRow, atMs: number): boolean {
  if (row.enabled === false) return false;
  if (row.effectiveFrom !== undefined && atMs < epoch(row.effectiveFrom)) return false;
  if (row.effectiveTo !== undefined && atMs > epoch(row.effectiveTo)) return false;
  return true;
}

/** Sort output keys so the produced record is byte-identical across runs. */
function sortedOutputs(src: Readonly<Record<string, Value>>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const k of Object.keys(src).sort()) {
    const v = src[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Fold a matched-row output field decimal-safe. `count` is an integer; sum/min/max require decimals. */
function aggregate(matched: readonly DecisionRow[], agg: DecisionAggregate): Value {
  if (agg.op === 'count') return matched.length;
  const decimals: Decimal[] = [];
  for (const row of matched) {
    const raw = row.outputs[agg.field];
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      throw new RuleError(
        'OUTPUT_INVALID',
        `aggregate field "${agg.field}" is not a decimal on row "${row.id}"`,
      );
    }
    decimals.push(parseDecimal(raw));
  }
  const first = decimals[0];
  if (first === undefined)
    throw new RuleError('OUTPUT_INVALID', `aggregate over zero rows on "${agg.field}"`);
  let acc = first;
  for (let i = 1; i < decimals.length; i += 1) {
    const d = decimals[i];
    if (d === undefined) continue;
    if (agg.op === 'sum') acc = add(acc, d);
    else if (agg.op === 'min') acc = compare(d, acc) < 0 ? d : acc;
    else acc = compare(d, acc) > 0 ? d : acc; // 'max'
  }
  return formatDecimal(acc);
}

/**
 * Evaluate a decision table over `env`. `evaluatedAt` (an explicit ISO string) drives effective-date
 * windowing only — there is no wall-clock read. Returns outputs, matched row ids, reason codes, per-row
 * traces (in evaluation order) and any warnings.
 */
export function evaluateTable(
  table: DecisionTable,
  env: Record<string, Value>,
  evaluatedAt: string,
): TableResult {
  const atMs = epoch(evaluatedAt);

  // Eligible rows, in declared order, paired with their declared index for stable priority sorting.
  const eligible: { readonly row: DecisionRow; readonly index: number }[] = [];
  table.rows.forEach((row, index) => {
    if (isRowEligible(row, atMs)) eligible.push({ row, index });
  });

  const order =
    table.hitPolicy === 'PRIORITY'
      ? [...eligible].sort((a, b) => {
          const pa = a.row.priority ?? 0;
          const pb = b.row.priority ?? 0;
          if (pa !== pb) return pb - pa; // priority descending
          return a.index - b.index; // stable: declared order
        })
      : eligible;

  const rowTraces: RowTrace[] = [];
  const matchedRows: DecisionRow[] = [];
  for (const { row } of order) {
    const matched = evaluateCondition(row.when, env).matched;
    rowTraces.push({ rowId: row.id, matched });
    if (matched) matchedRows.push(row);
  }

  const warnings: string[] = [];
  if (matchedRows.length === 0) {
    warnings.push('NO_MATCH');
    return { outputs: {}, matchedRowIds: [], reasonCodes: [], rowTraces, warnings };
  }

  if (table.hitPolicy === 'FIRST' || table.hitPolicy === 'PRIORITY') {
    const chosen = matchedRows[0];
    if (chosen === undefined) return { outputs: {}, matchedRowIds: [], reasonCodes: [], rowTraces, warnings };
    return {
      outputs: sortedOutputs(chosen.outputs),
      matchedRowIds: [chosen.id],
      reasonCodes: [chosen.reasonCode],
      rowTraces,
      warnings,
    };
  }

  if (table.hitPolicy === 'UNIQUE') {
    if (matchedRows.length > 1) {
      throw new RuleError(
        'UNIQUE_MATCH_VIOLATION',
        `UNIQUE table "${table.id}" matched ${String(matchedRows.length)} rows`,
      );
    }
    const chosen = matchedRows[0];
    if (chosen === undefined) return { outputs: {}, matchedRowIds: [], reasonCodes: [], rowTraces, warnings };
    return {
      outputs: sortedOutputs(chosen.outputs),
      matchedRowIds: [chosen.id],
      reasonCodes: [chosen.reasonCode],
      rowTraces,
      warnings,
    };
  }

  // COLLECT — every matched row; optionally fold one output field.
  const matchedRowIds = matchedRows.map((r) => r.id);
  const reasonCodes = matchedRows.map((r) => r.reasonCode);
  let outputs: Record<string, Value>;
  if (table.aggregate !== undefined) {
    outputs = { [table.aggregate.field]: aggregate(matchedRows, table.aggregate) };
  } else {
    // Merge outputs deterministically; a later matched row overrides an earlier one on key collision.
    const merged: Record<string, Value> = {};
    for (const row of matchedRows) {
      for (const k of Object.keys(row.outputs)) {
        const v = row.outputs[k];
        if (v !== undefined) merged[k] = v;
      }
    }
    outputs = sortedOutputs(merged);
  }
  return { outputs, matchedRowIds, reasonCodes, rowTraces, warnings };
}
