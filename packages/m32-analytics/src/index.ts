/**
 * @finapp/m32-analytics — REPORTING & ANALYTICS BUILDER (Stage 6C, mvp:false): a GOVERNED, DERIVED/READ analytics layer —
 * semantic datasets, metrics/KPIs, reports, dashboards, governed exports and scheduled-report metadata, with RLS +
 * entitlement masking preserved across aggregation. It is NOT a source of truth (source modules stay authoritative; m32
 * stores only derived, read-only, rebuildable projections with mandatory lineage) and performs NO business mutation. NO
 * ARBITRARY SQL — a governed semantic query layer compiles predefined metrics + bounded dimensions + whitelisted
 * operators + parameterized filters, fail closed. Entitlement intersection means aggregation grants no access. It
 * IMPLEMENTS the M28 ExecutiveAnalyticsPort (ADR-112). Money is bigint minor / exact decimal / integer bps (no float).
 * Metric/report publication is a controlled action (maker-checker/SoD; published-immutable). Reuses m02/m03/m06/m08/m09/
 * m24/m28/m30 BY CONTRACT — no second engine, no second outbox (it emits analytics.lifecycle through the ONE m06 outbox).
 * Declares /api/v1/analytics + analytics.* + ANALYTICS_. m33/m41 deferred behind fail-closed ports.
 */

// Permissions + audit codes
export {
  M32_PERMISSIONS,
  ALL_M32_PERMISSIONS,
  M32_PLATFORM_PERMISSIONS,
  M32_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M32Permission } from './permissions.ts';
export { M32_AUDIT_CODES, ALL_M32_AUDIT_CODES, ANALYTICS_AUDIT_PREFIX } from './audit-codes.ts';
export type { M32AuditCode } from './audit-codes.ts';

// Domain
export {
  M32_LIMITS,
  AnalyticsError,
  SCOPES,
  isScope,
  isPlatformScope,
  CLASSIFICATIONS,
  isClassification,
  classificationRank,
  AGGREGATIONS,
  isAggregation,
  VALUE_KINDS,
  isValueKind,
  METRIC_STATES,
  isMetricState,
  isMetricFrozen,
  QUERY_OPERATORS,
  isQueryOperator,
  REASON_CODES,
  ALL_REASON_CODES,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  evaluateEntitlement,
  compileMetricQuery,
  validateMetricDefinition,
  validateReportDefinition,
  measureColumnForKind,
  clampPage,
} from './domain.ts';
export type {
  Scope,
  Classification,
  Aggregation,
  ValueKind,
  MetricState,
  QueryOperator,
  ReasonCodeKey,
  GateResult,
  PublishGateInput,
  AccessPolicy,
  AnalyticsCaller,
  QueryFilter,
  MetricQuerySpec,
  DatasetSchema,
  CompiledFilter,
  QueryPlan,
  CompileResult,
  ValidationFinding,
  ValidationOutcome,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden, versionConflict } from './errors.ts';
export { M32Emitter } from './emit.ts';

// Ports (M28 analytics-port implementation + materialization source seam; deterministic doubles only)
export {
  M32ExecutiveAnalyticsAdapter,
  FixtureMaterializationSource,
  UnavailableMaterializationSource,
} from './ports.ts';
export type {
  AnalyticsEvidenceProvider,
  MaterializationSourcePort,
  MaterializationRow,
  MaterializationRequest,
} from './ports.ts';

// Persistence
export { AnalyticsRepository } from './repository.ts';
export type {
  DatasetRow,
  MetricRow,
  ReportRow,
  ReviewRow,
  AccessPolicyRow,
  LineageRow,
  MaterializationRowDb,
  ExportRow,
  ScheduleRow,
} from './repository.ts';

// Services
export {
  AnalyticsDatasetService,
  AnalyticsMetricService,
  AnalyticsReportService,
  contentHashOf,
} from './definitions.service.ts';
export { AnalyticsQueryService, AnalyticsMaterializationService } from './query.service.ts';
export type { QueryResult, QueryResultRow } from './query.service.ts';
export { AnalyticsExportService, AnalyticsScheduleService } from './exports.service.ts';
