/**
 * Safe DTO shapers for `/api/v1/analytics`. They expose ids, keys, kinds, scopes, states, versions and — for a query —
 * the governed, entitlement-checked aggregate rows + their LINEAGE id. They never expose another tenant's rows (RLS) and
 * never leak a raw metric definition's secret-bearing internals; a query result carries only the aggregated measure the
 * caller is entitled to, projected as text (never a float).
 */
import type {
  DatasetRow,
  MetricRow,
  ReportRow,
  ExportRow,
  ScheduleRow,
  QueryResult,
} from '@finapp/m32-analytics';

export function datasetView(d: DatasetRow) {
  return {
    id: d.id,
    scope: d.scope,
    sourceModule: d.source_module,
    datasetKey: d.dataset_key,
    name: d.name,
    classification: d.classification,
    dimensions: d.dimensions,
    measures: d.measures,
    status: d.status,
    version: d.version,
  };
}

export function metricView(m: MetricRow) {
  return {
    id: m.id,
    datasetId: m.dataset_id,
    scope: m.scope,
    metricKey: m.metric_key,
    name: m.name,
    aggregation: m.aggregation,
    measureKey: m.measure_key,
    valueKind: m.value_kind,
    currency: m.currency,
    dimensions: m.dimensions,
    classification: m.classification,
    state: m.state,
    version: m.version,
  };
}

export function reportView(r: ReportRow) {
  return {
    id: r.id,
    scope: r.scope,
    reportKey: r.report_key,
    name: r.name,
    kind: r.kind,
    classification: r.classification,
    state: r.state,
    version: r.version,
  };
}

export function exportView(e: ExportRow) {
  return {
    id: e.id,
    targetType: e.target_type,
    targetId: e.target_id,
    format: e.format,
    status: e.status,
    classification: e.classification,
    rowCount: e.row_count,
    byteSize: e.byte_size,
    storageRef: e.storage_ref,
    lineageId: e.lineage_id,
    version: e.version,
  };
}

export function scheduleView(s: ScheduleRow) {
  return {
    id: s.id,
    reportId: s.report_id,
    scheduleKind: s.schedule_kind,
    scheduleSpec: s.schedule_spec,
    timerRef: s.timer_ref,
    notifyRef: s.notify_ref,
    status: s.status,
    version: s.version,
  };
}

export function queryView(q: QueryResult) {
  return {
    metricId: q.metricId,
    metricKey: q.metricKey,
    metricVersion: q.metricVersion,
    valueKind: q.valueKind,
    lineageId: q.lineageId,
    rows: q.rows.map((r) => ({ dimensionValue: r.dimensionValue, measure: r.measure, currency: r.currency })),
  };
}
