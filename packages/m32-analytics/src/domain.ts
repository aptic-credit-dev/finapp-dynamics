/**
 * M32 PURE domain — vocabulary, guards, the GOVERNED SEMANTIC QUERY COMPILER (no arbitrary SQL), the ENTITLEMENT
 * intersection gate (aggregation grants no access), the maker-checker/SoD + publish gates, and money-safe value helpers.
 * No I/O. THE LOAD-BEARING CONTROL: `compileMetricQuery` only ever references WHITELISTED dataset dimensions/measures +
 * WHITELISTED operators, and returns a STRUCTURED plan (never an SQL string) whose identifiers the repository maps to a
 * fixed, parameterized SELECT — a user string is never concatenated into SQL; an unknown dimension/measure/operator FAILS
 * CLOSED. Money is bigint MINOR units / exact decimal / integer basis points — there is NO float here.
 */

export class AnalyticsError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message?: string) {
    super(message ?? reasonCode);
    this.name = 'AnalyticsError';
    this.reasonCode = reasonCode;
  }
}

export const M32_LIMITS = {
  maxSpecBytes: 262144,
  maxDimensions: 32,
  maxFilters: 32,
  maxGroupBy: 8,
  maxExportRows: 100000,
  maxPageSize: 200,
  defaultPageSize: 50,
} as const;

export const SCOPES = ['platform', 'tenant'] as const;
export type Scope = (typeof SCOPES)[number];
export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}
export function isPlatformScope(s: string): boolean {
  return s === 'platform';
}
function scopeRank(s: string): number {
  return s === 'platform' ? 2 : 1;
}

export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export function isClassification(s: string): s is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(s);
}
export function classificationRank(c: string): number {
  return c === 'restricted' ? 3 : c === 'confidential' ? 2 : c === 'internal' ? 1 : 0;
}

export const AGGREGATIONS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];
export function isAggregation(s: string): s is Aggregation {
  return (AGGREGATIONS as readonly string[]).includes(s);
}

export const VALUE_KINDS = ['count', 'minor_amount', 'decimal', 'bps'] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];
export function isValueKind(s: string): s is ValueKind {
  return (VALUE_KINDS as readonly string[]).includes(s);
}

export const METRIC_STATES = [
  'draft',
  'validated',
  'review_pending',
  'published',
  'superseded',
  'rejected',
] as const;
export type MetricState = (typeof METRIC_STATES)[number];
export function isMetricState(s: string): s is MetricState {
  return (METRIC_STATES as readonly string[]).includes(s);
}
export function isMetricFrozen(s: string): boolean {
  return s === 'superseded' || s === 'rejected';
}

/** The ONLY operators the governed semantic query layer permits (no arbitrary expressions). */
export const QUERY_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between'] as const;
export type QueryOperator = (typeof QUERY_OPERATORS)[number];
export function isQueryOperator(s: string): s is QueryOperator {
  return (QUERY_OPERATORS as readonly string[]).includes(s);
}

export const REASON_CODES = {
  datasetDefined: 'dataset_defined',
  metricDefined: 'metric_defined',
  metricValidated: 'metric_validated',
  reportDefined: 'report_defined',
  validationPassed: 'validation_passed',
  validationFailed: 'validation_failed',
  reviewRequested: 'review_requested',
  published: 'published',
  superseded: 'superseded',
  rejected: 'review_rejected',
  materialized: 'materialization_completed',
  exported: 'export_completed',
  scheduleChanged: 'schedule_changed',
  validationNotPassed: 'validation_not_passed',
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval_forbidden',
  missingEntitlement: 'missing_entitlement',
  insufficientScope: 'insufficient_scope',
  sensitivityFloor: 'sensitivity_floor',
  unknownDimension: 'unknown_dimension',
  unknownMeasure: 'unknown_measure',
  unknownOperator: 'unknown_operator',
  unsafeValue: 'unsafe_query_value',
  notPublished: 'metric_not_published',
  crossTenant: 'cross_tenant_forbidden',
  exportTooLarge: 'export_too_large',
  structuralInvalid: 'structural_invalid',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// ---- maker-checker (metric/report publication is a controlled action) ----

export function isHumanActor(actor: string | null | undefined): actor is string {
  if (actor === null || actor === undefined) return false;
  const a = actor.trim().toLowerCase();
  if (a === '') return false;
  return a !== 'system' && a !== 'ai' && a !== 'automation';
}

export interface GateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

export function evaluateSodGate(requestedBy: string, approver: string | null): GateResult {
  if (!isHumanActor(approver)) return { allowed: false, reasonCode: REASON_CODES.notHumanApprover };
  if (approver === requestedBy) return { allowed: false, reasonCode: REASON_CODES.selfApproval };
  return { allowed: true, reasonCode: REASON_CODES.published };
}

export interface PublishGateInput {
  readonly validationPassed: boolean;
  readonly requestedBy: string;
  readonly approver: string | null;
}
export function evaluatePublishGate(input: PublishGateInput): GateResult {
  if (!input.validationPassed) return { allowed: false, reasonCode: REASON_CODES.validationNotPassed };
  return evaluateSodGate(input.requestedBy, input.approver);
}

// ---- entitlement intersection (RLS + entitlements survive aggregation; aggregation grants no access) ----

export interface AccessPolicy {
  readonly requiredEntitlements: readonly string[];
  readonly minScope: string;
  readonly sensitivityFloor: string;
}
export interface AnalyticsCaller {
  readonly tenantId: string;
  readonly scopeLevel: string;
  readonly entitlements: readonly string[];
  readonly sensitivityClearance: string;
}

/**
 * The caller may see a metric/dataset ONLY if it holds EVERY required entitlement (intersection), at a sufficient scope,
 * with sensitivity clearance at least the floor. A denied caller gets NO partial aggregate (no hidden-count leakage) and
 * never gains access merely because the data is aggregated. Fail closed.
 */
export function evaluateEntitlement(policy: AccessPolicy, caller: AnalyticsCaller): GateResult {
  for (const e of policy.requiredEntitlements) {
    if (!caller.entitlements.includes(e))
      return { allowed: false, reasonCode: REASON_CODES.missingEntitlement };
  }
  if (scopeRank(caller.scopeLevel) < scopeRank(policy.minScope))
    return { allowed: false, reasonCode: REASON_CODES.insufficientScope };
  if (classificationRank(caller.sensitivityClearance) < classificationRank(policy.sensitivityFloor))
    return { allowed: false, reasonCode: REASON_CODES.sensitivityFloor };
  return { allowed: true, reasonCode: REASON_CODES.published };
}

// ---- the GOVERNED SEMANTIC QUERY COMPILER (no arbitrary SQL) ----

export interface QueryFilter {
  readonly field: string;
  readonly op: string;
  readonly value: string | number | boolean | readonly (string | number)[];
}
export interface MetricQuerySpec {
  readonly aggregation: string;
  readonly measureKey: string;
  readonly groupBy?: readonly string[];
  readonly filters?: readonly QueryFilter[];
}
export interface DatasetSchema {
  readonly dimensionKeys: readonly string[];
  readonly measureKeys: readonly string[];
}
export interface CompiledFilter {
  readonly field: string;
  readonly op: QueryOperator;
  readonly value: string | number | boolean | readonly (string | number)[];
}
export interface QueryPlan {
  readonly aggregation: Aggregation;
  readonly measureKey: string;
  readonly groupBy: readonly string[];
  readonly filters: readonly CompiledFilter[];
}
export interface CompileResult {
  readonly ok: boolean;
  readonly plan?: QueryPlan;
  readonly reasonCode?: string;
  readonly detail?: string;
}

// A bound query VALUE must be a scalar (or a bounded list of scalars). No object/expression/string-SQL is ever accepted.
function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * Compile a metric query against the dataset's WHITELISTED schema. Every group-by + filter field must be a declared
 * dimension; the measure must be a declared measure; the aggregation + every operator must be whitelisted; every value
 * must be a bound scalar (or bounded scalar list). The result is a STRUCTURED plan — the repository maps its whitelisted
 * identifiers to a fixed parameterized SELECT (no user string ever reaches SQL). Anything else FAILS CLOSED.
 */
export function compileMetricQuery(
  metric: { aggregation: string; measureKey: string },
  schema: DatasetSchema,
  spec: MetricQuerySpec,
): CompileResult {
  if (!isAggregation(metric.aggregation))
    return { ok: false, reasonCode: REASON_CODES.structuralInvalid, detail: 'aggregation' };
  if (!schema.measureKeys.includes(metric.measureKey))
    return { ok: false, reasonCode: REASON_CODES.unknownMeasure, detail: metric.measureKey };

  const groupBy = spec.groupBy ?? [];
  if (groupBy.length > M32_LIMITS.maxGroupBy)
    return { ok: false, reasonCode: REASON_CODES.structuralInvalid, detail: 'group_by' };
  for (const g of groupBy) {
    if (!schema.dimensionKeys.includes(g))
      return { ok: false, reasonCode: REASON_CODES.unknownDimension, detail: g };
  }

  const filters = spec.filters ?? [];
  if (filters.length > M32_LIMITS.maxFilters)
    return { ok: false, reasonCode: REASON_CODES.structuralInvalid, detail: 'filters' };
  const compiled: CompiledFilter[] = [];
  for (const f of filters) {
    if (!schema.dimensionKeys.includes(f.field))
      return { ok: false, reasonCode: REASON_CODES.unknownDimension, detail: f.field };
    if (!isQueryOperator(f.op)) return { ok: false, reasonCode: REASON_CODES.unknownOperator, detail: f.op };
    if (Array.isArray(f.value)) {
      if (f.op !== 'in' && f.op !== 'between')
        return { ok: false, reasonCode: REASON_CODES.unknownOperator, detail: f.op };
      for (const v of f.value)
        if (!isScalar(v)) return { ok: false, reasonCode: REASON_CODES.unsafeValue, detail: f.field };
    } else if (!isScalar(f.value)) {
      return { ok: false, reasonCode: REASON_CODES.unsafeValue, detail: f.field };
    }
    compiled.push({ field: f.field, op: f.op, value: f.value });
  }

  return {
    ok: true,
    plan: {
      aggregation: metric.aggregation,
      measureKey: metric.measureKey,
      groupBy,
      filters: compiled,
    },
  };
}

// ---- definition validation (fail closed) ----

export interface ValidationFinding {
  readonly code: string;
  readonly ref?: string;
}
export interface ValidationOutcome {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

function bytesOf(spec: unknown): number {
  return JSON.stringify(spec ?? null).length;
}

/** A metric definition is valid if its aggregation/value_kind are whitelisted, its measure + dimensions are declared in
 * the dataset schema, and a money metric declares a currency. Fail closed. */
export function validateMetricDefinition(
  metric: {
    aggregation: string;
    measureKey: string;
    valueKind: string;
    currency: string | null;
    dimensions: readonly string[];
  },
  schema: DatasetSchema,
): ValidationOutcome {
  const findings: ValidationFinding[] = [];
  if (!isAggregation(metric.aggregation))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'aggregation' });
  if (!isValueKind(metric.valueKind))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'value_kind' });
  if (metric.valueKind === 'minor_amount' && (metric.currency === null || metric.currency.trim() === ''))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'currency' });
  if (!schema.measureKeys.includes(metric.measureKey))
    findings.push({ code: REASON_CODES.unknownMeasure, ref: metric.measureKey });
  for (const d of metric.dimensions) {
    if (!schema.dimensionKeys.includes(d)) findings.push({ code: REASON_CODES.unknownDimension, ref: d });
  }
  return { passed: findings.length === 0, findings };
}

/** A report definition is valid if it is a bounded declarative object referencing published metric keys (no code). */
export function validateReportDefinition(
  spec: unknown,
  knownMetricKeys: readonly string[],
): ValidationOutcome {
  const findings: ValidationFinding[] = [];
  if (bytesOf(spec) > M32_LIMITS.maxSpecBytes)
    return { passed: false, findings: [{ code: REASON_CODES.structuralInvalid, ref: 'size' }] };
  const s = spec as Record<string, unknown> | null;
  if (s === null || typeof s !== 'object' || Array.isArray(s))
    return { passed: false, findings: [{ code: REASON_CODES.structuralInvalid, ref: 'root' }] };
  const widgets = s['widgets'];
  if (widgets !== undefined) {
    if (!Array.isArray(widgets)) findings.push({ code: REASON_CODES.structuralInvalid, ref: 'widgets' });
    else
      for (let i = 0; i < widgets.length; i++) {
        const w = widgets[i] as Record<string, unknown> | null;
        const mk = w?.['metricKey'];
        if (typeof mk !== 'string' || !knownMetricKeys.includes(mk))
          findings.push({ code: REASON_CODES.structuralInvalid, ref: `widgets[${i}].metricKey` });
      }
  }
  return { passed: findings.length === 0, findings };
}

// ---- money / numeric helpers (no float) ----

/** Describe how a materialized value column should be read for a metric's value kind (never a float). */
export function measureColumnForKind(
  kind: string,
): 'measure_count' | 'measure_value_minor' | 'measure_value_numeric' {
  if (kind === 'count') return 'measure_count';
  if (kind === 'minor_amount') return 'measure_value_minor';
  return 'measure_value_numeric';
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit?: number, offset?: number): Page {
  const l =
    limit === undefined || limit <= 0 ? M32_LIMITS.defaultPageSize : Math.min(limit, M32_LIMITS.maxPageSize);
  const o = offset === undefined || offset < 0 ? 0 : offset;
  return { limit: l, offset: o };
}
