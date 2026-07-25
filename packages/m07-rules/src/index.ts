/**
 * @finapp/m07-rules — the versioned, explainable, deterministic decision-rules engine (Stage 2.3).
 *
 * The PURE domain layer (decimal-safe numerics, structured typed conditions, decision tables + hit policies,
 * the rule-set lifecycle, the definition validator, and the evaluation engine + structured explanation) carries
 * no I/O and is exhaustively unit-tested. Conditions are DATA, never host code — there is no eval/Function/vm,
 * so injection is impossible by construction (ADR-033). The services layer runs everything inside
 * `db.withTenant(ctx, tx => …)` with audit + outbox in the same transaction; m07 consumes DB/AUDIT/AUTHZ via
 * kernel tokens and publishes through the ONE outbox m06 owns.
 */

// Vocabularies (registered in manifests/*.yaml + seeded)
export { M07_PERMISSIONS, ALL_M07_PERMISSIONS } from './permissions.ts';
export type { M07Permission } from './permissions.ts';
export { M07_AUDIT_CODES, ALL_M07_AUDIT_CODES, RULES_AUDIT_PREFIX } from './audit-codes.ts';
export type { M07AuditCode } from './audit-codes.ts';

// Domain — decimal-safe numerics
export {
  RuleError,
  MAX_DECIMAL_SCALE,
  MAX_DECIMAL_DIGITS,
  parseDecimal,
  formatDecimal,
  compare,
  eq,
  ne,
  lt,
  le,
  gt,
  ge,
  add,
  subtract,
  multiply,
  percentOf,
  roundTo,
  inRange,
} from './domain/decimal.ts';
export type { Decimal, RoundingMode } from './domain/decimal.ts';

// Domain — structured conditions
export {
  COMPARE_OPS,
  STRING_OPS,
  DATE_OPS,
  VALUE_TYPES,
  evaluateCondition,
  collectFields,
  conditionDepth,
  conditionNodeCount,
} from './domain/conditions.ts';
export type {
  Value,
  Env,
  Condition,
  CompareOp,
  StringOp,
  DateOp,
  CondValueType,
  ConditionTrace,
  ConditionResult,
} from './domain/conditions.ts';

// Domain — decision tables + hit policies
export { HIT_POLICIES, AGGREGATE_OPS, evaluateTable } from './domain/decision-table.ts';
export type {
  HitPolicy,
  AggregateOp,
  DecisionRow,
  DecisionAggregate,
  DecisionTable,
  RowTrace,
  TableResult,
} from './domain/decision-table.ts';

// Domain — lifecycle
export {
  checkTransition,
  RULESET_STATUSES,
  RULESET_ACTIONS,
  RULESET_MACHINE,
  isRuleSetContentFrozen,
  checkRuleSetTransition,
} from './domain/lifecycles.ts';
export type {
  Transition,
  Machine,
  TransitionResult,
  RuleSetStatus,
  RuleSetAction,
} from './domain/lifecycles.ts';

// Domain — rule-set spec + limits
export { RULE_SCHEMA_VERSION, FIELD_TYPES, DERIVED_OPS, RULE_LIMITS } from './domain/ruleset.ts';
export type {
  FieldType,
  FieldSchema,
  DerivedOp,
  DerivedField,
  RuleSetSpec,
  RuleSetError,
  ValidationResult,
} from './domain/ruleset.ts';

// Domain — validator + evaluation engine
export { derivedCycleCheck, validateRuleSet } from './domain/validator.ts';
export { ENGINE_VERSION, DEFAULT_EVALUATED_AT, evaluateRuleSet, inputHash } from './domain/evaluate.ts';
export type { EvaluationInput, TableTrace, Explanation } from './domain/evaluate.ts';
