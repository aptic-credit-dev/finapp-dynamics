/**
 * Rule-set spec types + hard limits — PURE. A rule set is a declarative, versioned JSON document: an input
 * schema, an output schema, an optional context schema, an ordered list of decision tables, and optional
 * derived fields. It is DATA — no code, SQL, or host reach — validated structurally by `validator.ts` and
 * interpreted deterministically by `evaluate.ts`. The `RULE_LIMITS` ceilings bound DoS / runaway specs.
 */
import type { DecisionTable } from './decision-table.ts';
import type { Value } from './conditions.ts';

export const RULE_SCHEMA_VERSION = 1;

export const FIELD_TYPES = ['string', 'number', 'decimal', 'boolean', 'date', 'enum'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldSchema {
  readonly name: string;
  readonly type: FieldType;
  readonly required?: boolean;
  readonly enumValues?: readonly string[];
  readonly maxLength?: number;
  readonly scale?: number;
}

export const DERIVED_OPS = [
  'add',
  'subtract',
  'multiply',
  'percent',
  'concat',
  'lower',
  'upper',
  'coalesce',
] as const;
export type DerivedOp = (typeof DERIVED_OPS)[number];

export interface DerivedField {
  readonly name: string;
  readonly op: DerivedOp;
  /** Each arg is either an input/derived/context field NAME (string) or a literal value. */
  readonly args: readonly (string | Value)[];
}

export interface RuleSetSpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly inputSchema: readonly FieldSchema[];
  readonly outputSchema: readonly FieldSchema[];
  readonly contextSchema?: readonly FieldSchema[];
  readonly decisionTables: readonly DecisionTable[];
  readonly derived?: readonly DerivedField[];
}

/** Hard ceilings — the validator rejects a spec exceeding any of them. */
export const RULE_LIMITS = {
  maxTables: 50,
  maxRowsPerTable: 500,
  maxConditionDepth: 20,
  maxConditionNodes: 200,
  maxInputFields: 100,
  maxOutputFields: 100,
  maxDerived: 100,
  maxStringLength: 4096,
  maxCollectionSize: 256,
  maxInputDepth: 8,
  maxTotalRows: 2000,
  codePattern: /^[a-z][a-z0-9_]{1,63}$/,
  idPattern: /^[A-Za-z_][A-Za-z0-9_]{0,63}$/,
} as const;

/** A structured validation error — returned (never thrown) so all problems surface at once. */
export interface RuleSetError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly RuleSetError[];
}
