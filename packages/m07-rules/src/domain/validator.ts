/**
 * Rule-set validator — PURE, fail-closed. Accepts UNTRUSTED input (a tenant's rule-set JSON) and returns
 * EVERY problem it finds (never throws on bad input), so a spec only becomes VALIDATED / PUBLISHED once this
 * returns `ok: true`. It enforces: shape and identifiers; unique table/row ids; that every condition
 * references a declared column; that every output references a declared output field and supplies the
 * mandatory ones; enum membership; well-formed ranges; safe operators (via a dry `evaluateCondition`
 * compile-check — no code/eval can appear); acyclic derived fields (topological); and the hard size limits.
 */
import {
  collectFields,
  conditionDepth,
  conditionNodeCount,
  evaluateCondition,
  type Condition,
  type Value,
} from './conditions.ts';
import { HIT_POLICIES } from './decision-table.ts';
import { MAX_DECIMAL_SCALE, RuleError, compare, parseDecimal } from './decimal.ts';
import {
  DERIVED_OPS,
  FIELD_TYPES,
  RULE_LIMITS,
  RULE_SCHEMA_VERSION,
  type DerivedField,
  type FieldType,
  type RuleSetError,
  type ValidationResult,
} from './ruleset.ts';

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const DERIVED_ARITY: Readonly<Record<string, { readonly min: number; readonly max: number | null }>> = {
  add: { min: 2, max: 2 },
  subtract: { min: 2, max: 2 },
  multiply: { min: 2, max: 2 },
  percent: { min: 2, max: 2 },
  concat: { min: 1, max: null },
  lower: { min: 1, max: 1 },
  upper: { min: 1, max: 1 },
  coalesce: { min: 1, max: null },
};

/** Detect cycles among derived fields (a derived field whose args reference other derived names). */
export function derivedCycleCheck(derived: readonly DerivedField[]): string[] {
  const names = new Set(derived.map((d) => d.name));
  const graph = new Map<string, string[]>();
  for (const d of derived) {
    const deps: string[] = [];
    for (const a of d.args) if (typeof a === 'string' && names.has(a)) deps.push(a);
    graph.set(d.name, deps);
  }
  const state = new Map<string, number>(); // 0 unvisited, 1 on-stack, 2 done
  const stack: string[] = [];
  const inCycle = new Set<string>();
  const dfs = (n: string): void => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n) ?? []) {
      const st = state.get(m) ?? 0;
      if (st === 0) dfs(m);
      else if (st === 1) {
        const idx = stack.lastIndexOf(m);
        if (idx >= 0) {
          for (let i = idx; i < stack.length; i += 1) {
            const x = stack[i];
            if (x !== undefined) inCycle.add(x);
          }
        }
      }
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of names) if ((state.get(n) ?? 0) === 0) dfs(n);
  return [...inCycle].sort();
}

/** Gather (field, comparedValues) pairs from `compare`/`in` leaves — used to enforce enum membership. */
function collectFieldValues(cond: Condition): { readonly field: string; readonly values: Value[] }[] {
  const out: { field: string; values: Value[] }[] = [];
  const walk = (c: Condition): void => {
    switch (c.type) {
      case 'compare':
        out.push({ field: c.field, values: [c.value] });
        return;
      case 'in':
        out.push({ field: c.field, values: [...c.values] });
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
  return out;
}

interface SchemaInfo {
  readonly names: Set<string>;
  readonly types: Map<string, FieldType>;
  readonly enums: Map<string, Set<string>>;
  readonly required: Set<string>;
}

/** Validate one field-schema array; collects errors and returns the derived lookup maps. */
function validateFieldSchemas(
  arr: unknown[],
  path: string,
  err: (path: string, code: string, message: string) => void,
): SchemaInfo {
  const names = new Set<string>();
  const types = new Map<string, FieldType>();
  const enums = new Map<string, Set<string>>();
  const required = new Set<string>();
  arr.forEach((f, i) => {
    const where = `${path}[${String(i)}]`;
    if (!isObject(f) || typeof f['name'] !== 'string') {
      err(where, 'BAD_FIELD', 'field needs a string name');
      return;
    }
    const name = f['name'];
    if (names.has(name)) err(where, 'DUP_FIELD', `duplicate field "${name}"`);
    names.add(name);
    const type = f['type'];
    if (typeof type !== 'string' || !(FIELD_TYPES as readonly string[]).includes(type)) {
      err(`${where}.type`, 'BAD_FIELD_TYPE', `unknown field type "${String(type)}"`);
      return;
    }
    types.set(name, type as FieldType);
    if (f['required'] === true) required.add(name);
    if (type === 'enum') {
      const ev = f['enumValues'];
      if (!Array.isArray(ev) || ev.length === 0) {
        err(`${where}.enumValues`, 'MISSING_ENUM', 'enum field needs enumValues');
      } else {
        const set = new Set<string>();
        for (const v of ev as unknown[]) if (typeof v === 'string') set.add(v);
        enums.set(name, set);
      }
    }
    if (type === 'decimal' && f['scale'] !== undefined) {
      const sc = f['scale'];
      if (typeof sc !== 'number' || !Number.isInteger(sc) || sc < 0 || sc > MAX_DECIMAL_SCALE) {
        err(
          `${where}.scale`,
          'BAD_SCALE',
          `decimal scale must be an integer 0..${String(MAX_DECIMAL_SCALE)}`,
        );
      }
    }
  });
  return { names, types, enums, required };
}

/** Validate an untrusted rule-set document. Collects ALL errors so the author sees every problem at once. */
export function validateRuleSet(raw: unknown): ValidationResult {
  const errors: RuleSetError[] = [];
  const err = (path: string, code: string, message: string): void => {
    errors.push({ path, code, message });
  };

  if (!isObject(raw)) {
    return { ok: false, errors: [{ path: '', code: 'NOT_OBJECT', message: 'rule set must be an object' }] };
  }

  // --- top level ----------------------------------------------------------------------------------
  if (raw['schemaVersion'] !== RULE_SCHEMA_VERSION) {
    err('schemaVersion', 'BAD_SCHEMA_VERSION', `schemaVersion must be ${String(RULE_SCHEMA_VERSION)}`);
  }
  if (typeof raw['code'] !== 'string' || !RULE_LIMITS.codePattern.test(raw['code'])) {
    err('code', 'BAD_CODE', 'code must be a lowercase slug (a-z0-9_, 2-64 chars)');
  }
  if (typeof raw['name'] !== 'string' || raw['name'].trim() === '') {
    err('name', 'BAD_NAME', 'name is required');
  }

  // --- schemas ------------------------------------------------------------------------------------
  const inputArr: unknown[] = Array.isArray(raw['inputSchema']) ? raw['inputSchema'] : [];
  if (!Array.isArray(raw['inputSchema']))
    err('inputSchema', 'BAD_INPUT_SCHEMA', 'inputSchema must be an array');
  if (inputArr.length > RULE_LIMITS.maxInputFields) {
    err('inputSchema', 'TOO_MANY_INPUTS', `at most ${String(RULE_LIMITS.maxInputFields)} input fields`);
  }
  const input = validateFieldSchemas(inputArr, 'inputSchema', err);

  const outputArr: unknown[] = Array.isArray(raw['outputSchema']) ? raw['outputSchema'] : [];
  if (!Array.isArray(raw['outputSchema']))
    err('outputSchema', 'BAD_OUTPUT_SCHEMA', 'outputSchema must be an array');
  if (outputArr.length > RULE_LIMITS.maxOutputFields) {
    err('outputSchema', 'TOO_MANY_OUTPUTS', `at most ${String(RULE_LIMITS.maxOutputFields)} output fields`);
  }
  const output = validateFieldSchemas(outputArr, 'outputSchema', err);

  const contextArr: unknown[] = Array.isArray(raw['contextSchema']) ? raw['contextSchema'] : [];
  if (raw['contextSchema'] !== undefined && !Array.isArray(raw['contextSchema'])) {
    err('contextSchema', 'BAD_CONTEXT_SCHEMA', 'contextSchema must be an array');
  }
  const context = validateFieldSchemas(contextArr, 'contextSchema', err);

  // --- derived ------------------------------------------------------------------------------------
  const derivedArr: unknown[] = Array.isArray(raw['derived']) ? raw['derived'] : [];
  if (raw['derived'] !== undefined && !Array.isArray(raw['derived'])) {
    err('derived', 'BAD_DERIVED', 'derived must be an array');
  }
  if (derivedArr.length > RULE_LIMITS.maxDerived) {
    err('derived', 'TOO_MANY_DERIVED', `at most ${String(RULE_LIMITS.maxDerived)} derived fields`);
  }
  const derivedNames = new Set<string>();
  const cleanDerived: DerivedField[] = [];
  derivedArr.forEach((d, i) => {
    const where = `derived[${String(i)}]`;
    if (!isObject(d) || typeof d['name'] !== 'string') {
      err(where, 'BAD_DERIVED_FIELD', 'derived field needs a string name');
      return;
    }
    const name = d['name'];
    if (derivedNames.has(name)) err(where, 'DUP_DERIVED', `duplicate derived field "${name}"`);
    derivedNames.add(name);
    const op = d['op'];
    if (typeof op !== 'string' || !(DERIVED_OPS as readonly string[]).includes(op)) {
      err(`${where}.op`, 'BAD_DERIVED_OP', `unknown derived op "${String(op)}"`);
      return;
    }
    const args: unknown[] = Array.isArray(d['args']) ? d['args'] : [];
    if (!Array.isArray(d['args'])) {
      err(`${where}.args`, 'BAD_DERIVED_ARGS', 'derived args must be an array');
      return;
    }
    const arity = DERIVED_ARITY[op];
    if (arity !== undefined && (args.length < arity.min || (arity.max !== null && args.length > arity.max))) {
      err(`${where}.args`, 'DERIVED_ARITY', `op "${op}" has a wrong argument count`);
    }
    cleanDerived.push({ name, op: op as DerivedField['op'], args: args as (string | Value)[] });
  });
  const cycle = derivedCycleCheck(cleanDerived);
  if (cycle.length > 0) err('derived', 'DERIVED_CYCLE', `cyclic derived fields: ${cycle.join(', ')}`);

  // The universe of columns a condition may reference, and the type/enum lookups for enum membership.
  const knownFields = new Set<string>([...input.names, ...derivedNames, ...context.names]);
  const fieldType = new Map<string, FieldType>([...input.types, ...context.types]);
  const fieldEnums = new Map<string, Set<string>>([...input.enums, ...context.enums]);

  // --- decision tables ----------------------------------------------------------------------------
  const tablesArr: unknown[] = Array.isArray(raw['decisionTables']) ? raw['decisionTables'] : [];
  if (!Array.isArray(raw['decisionTables'])) {
    err('decisionTables', 'BAD_TABLES', 'decisionTables must be an array');
  }
  if (tablesArr.length > RULE_LIMITS.maxTables) {
    err('decisionTables', 'TOO_MANY_TABLES', `at most ${String(RULE_LIMITS.maxTables)} tables`);
  }
  const tableIds = new Set<string>();
  let totalRows = 0;
  tablesArr.forEach((tbl, ti) => {
    const tp = `decisionTables[${String(ti)}]`;
    if (!isObject(tbl)) {
      err(tp, 'BAD_TABLE', 'table must be an object');
      return;
    }
    if (typeof tbl['id'] !== 'string' || !RULE_LIMITS.idPattern.test(tbl['id'])) {
      err(`${tp}.id`, 'BAD_TABLE_ID', 'table id must be an identifier');
    } else {
      if (tableIds.has(tbl['id'])) err(`${tp}.id`, 'DUP_TABLE', `duplicate table id "${tbl['id']}"`);
      tableIds.add(tbl['id']);
    }
    if (
      typeof tbl['hitPolicy'] !== 'string' ||
      !(HIT_POLICIES as readonly string[]).includes(tbl['hitPolicy'])
    ) {
      err(`${tp}.hitPolicy`, 'BAD_HIT_POLICY', `unknown hit policy "${String(tbl['hitPolicy'])}"`);
    }

    const rowsArr: unknown[] = Array.isArray(tbl['rows']) ? tbl['rows'] : [];
    if (!Array.isArray(tbl['rows'])) err(`${tp}.rows`, 'BAD_ROWS', 'rows must be an array');
    if (rowsArr.length > RULE_LIMITS.maxRowsPerTable) {
      err(`${tp}.rows`, 'TOO_MANY_ROWS', `at most ${String(RULE_LIMITS.maxRowsPerTable)} rows per table`);
    }
    totalRows += rowsArr.length;

    const rowIds = new Set<string>();
    rowsArr.forEach((row, ri) => {
      const rp = `${tp}.rows[${String(ri)}]`;
      if (!isObject(row)) {
        err(rp, 'BAD_ROW', 'row must be an object');
        return;
      }
      if (typeof row['id'] !== 'string' || !RULE_LIMITS.idPattern.test(row['id'])) {
        err(`${rp}.id`, 'BAD_ROW_ID', 'row id must be an identifier');
      } else {
        if (rowIds.has(row['id'])) err(`${rp}.id`, 'DUP_ROW', `duplicate row id "${row['id']}"`);
        rowIds.add(row['id']);
      }
      if (typeof row['reasonCode'] !== 'string' || row['reasonCode'].trim() === '') {
        err(`${rp}.reasonCode`, 'BAD_REASON_CODE', 'row needs a non-empty reasonCode');
      }

      // --- the row condition (`when`) -------------------------------------------------------------
      const when = row['when'];
      if (!isObject(when)) {
        err(`${rp}.when`, 'BAD_CONDITION', 'row needs a structured `when` condition');
      } else {
        const cond = when as unknown as Condition;
        // Safe-operator / no-code compile check — a dry evaluation fails closed on any unknown type/op.
        try {
          evaluateCondition(cond, {});
        } catch (e) {
          const code = e instanceof RuleError ? e.code : 'UNSAFE_CONDITION';
          err(
            `${rp}.when`,
            code === 'BAD_OPERATOR' ? 'BAD_OPERATOR' : 'UNSAFE_CONDITION',
            `unsafe condition: ${code}`,
          );
        }
        if (conditionDepth(cond) > RULE_LIMITS.maxConditionDepth) {
          err(
            `${rp}.when`,
            'COND_TOO_DEEP',
            `condition exceeds depth ${String(RULE_LIMITS.maxConditionDepth)}`,
          );
        }
        if (conditionNodeCount(cond) > RULE_LIMITS.maxConditionNodes) {
          err(
            `${rp}.when`,
            'COND_TOO_MANY_NODES',
            `condition exceeds ${String(RULE_LIMITS.maxConditionNodes)} nodes`,
          );
        }
        for (const field of collectFields(cond)) {
          if (!knownFields.has(field)) {
            err(`${rp}.when`, 'BAD_COLUMN_REF', `condition references unknown column "${field}"`);
          }
        }
        // Enum membership: a value compared against an enum field must be one of its enum values.
        for (const fv of collectFieldValues(cond)) {
          const allowed = fieldEnums.get(fv.field);
          if (fieldType.get(fv.field) === 'enum' && allowed !== undefined) {
            for (const v of fv.values) {
              if (typeof v !== 'string' || !allowed.has(v)) {
                err(
                  `${rp}.when`,
                  'BAD_ENUM',
                  `value ${JSON.stringify(v)} is not a member of enum "${fv.field}"`,
                );
              }
            }
          }
        }
        // Malformed range: min > max under the row's value type.
        if (isObject(when) && when['type'] === 'range') checkRange(when, `${rp}.when`, err);
      }

      // --- the row outputs ------------------------------------------------------------------------
      const outputs = row['outputs'];
      const aggregate = isObject(tbl['aggregate']) ? tbl['aggregate'] : undefined;
      if (!isObject(outputs)) {
        err(`${rp}.outputs`, 'BAD_OUTPUTS', 'row needs an outputs object');
      } else {
        for (const key of Object.keys(outputs)) {
          if (!output.names.has(key)) {
            err(`${rp}.outputs`, 'BAD_OUTPUT_REF', `output "${key}" is not in the output schema`);
          } else {
            const allowed = output.enums.get(key);
            if (output.types.get(key) === 'enum' && allowed !== undefined) {
              const v = outputs[key];
              if (typeof v !== 'string' || !allowed.has(v)) {
                err(`${rp}.outputs`, 'BAD_ENUM', `output "${key}" value is not a member of its enum`);
              }
            }
          }
        }
        // Mandatory outputs must be supplied by every row (aggregate tables produce a single folded field).
        if (aggregate === undefined) {
          for (const req of output.required) {
            if (!(req in outputs))
              err(`${rp}.outputs`, 'MISSING_OUTPUT', `mandatory output "${req}" is missing`);
          }
        }
      }
    });

    // --- aggregate on a COLLECT table -----------------------------------------------------------
    const aggregate = tbl['aggregate'];
    if (aggregate !== undefined) {
      if (!isObject(aggregate) || typeof aggregate['field'] !== 'string') {
        err(`${tp}.aggregate`, 'AGG_INVALID', 'aggregate needs a string field');
      } else {
        if (tbl['hitPolicy'] !== 'COLLECT') {
          err(`${tp}.aggregate`, 'AGG_INVALID', 'aggregate is only valid on a COLLECT table');
        }
        const field = aggregate['field'];
        if (!output.names.has(field)) {
          err(`${tp}.aggregate`, 'AGG_INVALID', `aggregate field "${field}" is not an output`);
        } else if (aggregate['op'] !== 'count' && output.types.get(field) !== 'decimal') {
          err(`${tp}.aggregate`, 'AGG_INVALID', `aggregate field "${field}" must be a decimal output`);
        }
      }
    }
  });

  if (totalRows > RULE_LIMITS.maxTotalRows) {
    err('decisionTables', 'TOO_MANY_TOTAL_ROWS', `at most ${String(RULE_LIMITS.maxTotalRows)} rows in total`);
  }

  return { ok: errors.length === 0, errors };
}

/** Reject a range whose lower bound exceeds its upper bound (per its declared value type). */
function checkRange(
  when: Record<string, unknown>,
  path: string,
  err: (path: string, code: string, message: string) => void,
): void {
  const min = when['min'];
  const max = when['max'];
  if (min === undefined || max === undefined) return;
  const vt = when['valueType'];
  try {
    if (vt === 'decimal') {
      if (typeof min !== 'string' && typeof min !== 'number') return;
      if (typeof max !== 'string' && typeof max !== 'number') return;
      if (compare(parseDecimal(min), parseDecimal(max)) > 0) err(path, 'BAD_RANGE', 'range min exceeds max');
      return;
    }
    if (vt === 'date') {
      const a = typeof min === 'string' ? Date.parse(min) : NaN;
      const b = typeof max === 'string' ? Date.parse(max) : NaN;
      if (!Number.isNaN(a) && !Number.isNaN(b) && a > b) err(path, 'BAD_RANGE', 'range min exceeds max');
      return;
    }
    const a = Number(min);
    const b = Number(max);
    if (!Number.isNaN(a) && !Number.isNaN(b) && a > b) err(path, 'BAD_RANGE', 'range min exceeds max');
  } catch {
    // A malformed bound is surfaced by the dry compile-check elsewhere; don't double-report here.
  }
}
