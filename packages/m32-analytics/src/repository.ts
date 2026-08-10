/**
 * M32 repository — ALL SQL for the analytics layer across its 11 tables. Every query is parameterized; every mutating
 * UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO
 * tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Review/lineage/
 * materialization/history + the idempotency ledger are append-only. MONEY-SAFE: bigint/numeric measure columns are
 * projected `::text` (never a JS float); there is no float column. A query reads a FIXED parameterized SELECT over a
 * metric's latest materialization generation — the governed plan's filters are applied in the service, never as SQL.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m32 repository: expected a row from ${what}`);
  return row;
}

export interface DatasetRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly source_module: string;
  readonly dataset_key: string;
  readonly name: string;
  readonly classification: string;
  readonly dimensions: unknown;
  readonly measures: unknown;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface MetricRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly dataset_id: string;
  readonly scope: string;
  readonly metric_key: string;
  readonly name: string;
  readonly aggregation: string;
  readonly measure_key: string;
  readonly value_kind: string;
  readonly currency: string | null;
  readonly dimensions: unknown;
  readonly filters: unknown;
  readonly classification: string;
  readonly state: string;
  readonly validation_passed: boolean;
  readonly content_hash: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ReportRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly report_key: string;
  readonly name: string;
  readonly kind: string;
  readonly spec: unknown;
  readonly classification: string;
  readonly state: string;
  readonly validation_passed: boolean;
  readonly content_hash: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly kind: string;
  readonly requested_by: string;
  readonly decided_by: string | null;
  readonly reason_code: string | null;
}
export interface AccessPolicyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly required_entitlements: readonly string[];
  readonly min_scope: string;
  readonly sensitivity_floor: string;
  readonly status: string;
  readonly version: number;
}
export interface LineageRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly source_module: string;
  readonly metric_id: string | null;
  readonly metric_version: number | null;
  readonly classification: string;
}
export interface MaterializationRowDb {
  readonly tenant_id: string;
  readonly id: string;
  readonly metric_id: string;
  readonly generation: number;
  readonly dimension_key: string | null;
  readonly dimension_value: string | null;
  readonly measure_value_minor: string | null;
  readonly measure_value_numeric: string | null;
  readonly measure_count: string | null;
  readonly currency: string | null;
  readonly value_kind: string;
}
export interface ExportRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly format: string;
  readonly status: string;
  readonly classification: string;
  readonly row_count: number | null;
  readonly byte_size: string | null;
  readonly storage_ref: string | null;
  readonly lineage_id: string | null;
  readonly version: number;
}
export interface ScheduleRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly report_id: string;
  readonly schedule_kind: string;
  readonly schedule_spec: string;
  readonly timer_ref: string | null;
  readonly notify_ref: string | null;
  readonly status: string;
  readonly version: number;
}

const MAT_COLS = `tenant_id, id, metric_id, generation, dimension_key, dimension_value,
  measure_value_minor::text AS measure_value_minor, measure_value_numeric::text AS measure_value_numeric,
  measure_count::text AS measure_count, currency, value_kind`;

export class AnalyticsRepository {
  // ---- dataset ----
  async insertDataset(
    tx: Tx,
    d: {
      tenantId: string;
      scope: string;
      sourceModule: string;
      datasetKey: string;
      name: string;
      description: string | null;
      classification: string;
      dimensions: unknown;
      measures: unknown;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DatasetRow> {
    const { rows } = await tx.query<DatasetRow>(
      `INSERT INTO analytics_dataset (tenant_id, scope, source_module, dataset_key, name, description, classification, dimensions, measures, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$12) RETURNING *`,
      [
        d.tenantId,
        d.scope,
        d.sourceModule,
        d.datasetKey,
        d.name,
        d.description,
        d.classification,
        JSON.stringify(d.dimensions ?? []),
        JSON.stringify(d.measures ?? []),
        d.idempotencyKey,
        d.correlationId,
        d.by,
      ],
    );
    return firstRow(rows, 'insertDataset');
  }
  async findDatasetByIdempotencyKey(tx: Tx, key: string): Promise<DatasetRow | null> {
    const { rows } = await tx.query<DatasetRow>(
      `SELECT * FROM analytics_dataset WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getDataset(tx: Tx, id: string): Promise<DatasetRow | null> {
    const { rows } = await tx.query<DatasetRow>(`SELECT * FROM analytics_dataset WHERE id=$1`, [id]);
    return rows[0] ?? null;
  }
  async updateDataset(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { name: string; description: string | null; status: string; by: string | null },
  ): Promise<DatasetRow | null> {
    const { rows } = await tx.query<DatasetRow>(
      `UPDATE analytics_dataset SET name=$3, description=$4, status=$5, version=version+1, updated_at=now(), updated_by=$6 WHERE id=$1 AND version=$2 RETURNING *`,
      [id, expectedVersion, patch.name, patch.description, patch.status, patch.by],
    );
    return rows[0] ?? null;
  }
  async listDatasets(tx: Tx, limit: number, offset: number): Promise<DatasetRow[]> {
    const { rows } = await tx.query<DatasetRow>(
      `SELECT * FROM analytics_dataset ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- metric ----
  async insertMetric(
    tx: Tx,
    m: {
      tenantId: string;
      datasetId: string;
      scope: string;
      metricKey: string;
      name: string;
      description: string | null;
      aggregation: string;
      measureKey: string;
      valueKind: string;
      currency: string | null;
      dimensions: unknown;
      filters: unknown;
      classification: string;
      contentHash: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<MetricRow> {
    const { rows } = await tx.query<MetricRow>(
      `INSERT INTO analytics_metric (tenant_id, dataset_id, scope, metric_key, name, description, aggregation, measure_key, value_kind, currency, dimensions, filters, classification, content_hash, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$17) RETURNING *`,
      [
        m.tenantId,
        m.datasetId,
        m.scope,
        m.metricKey,
        m.name,
        m.description,
        m.aggregation,
        m.measureKey,
        m.valueKind,
        m.currency,
        JSON.stringify(m.dimensions ?? []),
        JSON.stringify(m.filters ?? []),
        m.classification,
        m.contentHash,
        m.idempotencyKey,
        m.correlationId,
        m.by,
      ],
    );
    return firstRow(rows, 'insertMetric');
  }
  async findMetricByIdempotencyKey(tx: Tx, key: string): Promise<MetricRow | null> {
    const { rows } = await tx.query<MetricRow>(
      `SELECT * FROM analytics_metric WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getMetric(tx: Tx, id: string): Promise<MetricRow | null> {
    const { rows } = await tx.query<MetricRow>(`SELECT * FROM analytics_metric WHERE id=$1`, [id]);
    return rows[0] ?? null;
  }
  async getPublishedMetricByKey(tx: Tx, scope: string, metricKey: string): Promise<MetricRow | null> {
    const { rows } = await tx.query<MetricRow>(
      `SELECT * FROM analytics_metric WHERE scope=$1 AND metric_key=$2 AND state='published' LIMIT 1`,
      [scope, metricKey],
    );
    return rows[0] ?? null;
  }
  async updateMetricState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; by: string | null },
  ): Promise<MetricRow | null> {
    const { rows } = await tx.query<MetricRow>(
      `UPDATE analytics_metric SET state=$3, validation_passed=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING *`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.by],
    );
    return rows[0] ?? null;
  }
  async listPublishedMetrics(tx: Tx, limit: number): Promise<MetricRow[]> {
    const { rows } = await tx.query<MetricRow>(
      `SELECT * FROM analytics_metric WHERE state='published' ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }
  async listMetrics(tx: Tx, datasetId: string, limit: number, offset: number): Promise<MetricRow[]> {
    const { rows } = await tx.query<MetricRow>(
      `SELECT * FROM analytics_metric WHERE dataset_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [datasetId, limit, offset],
    );
    return rows;
  }

  // ---- report ----
  async insertReport(
    tx: Tx,
    r: {
      tenantId: string;
      scope: string;
      reportKey: string;
      name: string;
      description: string | null;
      kind: string;
      spec: unknown;
      classification: string;
      contentHash: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ReportRow> {
    const { rows } = await tx.query<ReportRow>(
      `INSERT INTO analytics_report (tenant_id, scope, report_key, name, description, kind, spec, classification, content_hash, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$12) RETURNING *`,
      [
        r.tenantId,
        r.scope,
        r.reportKey,
        r.name,
        r.description,
        r.kind,
        JSON.stringify(r.spec ?? {}),
        r.classification,
        r.contentHash,
        r.idempotencyKey,
        r.correlationId,
        r.by,
      ],
    );
    return firstRow(rows, 'insertReport');
  }
  async getReport(tx: Tx, id: string): Promise<ReportRow | null> {
    const { rows } = await tx.query<ReportRow>(`SELECT * FROM analytics_report WHERE id=$1`, [id]);
    return rows[0] ?? null;
  }
  async updateReportState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; by: string | null },
  ): Promise<ReportRow | null> {
    const { rows } = await tx.query<ReportRow>(
      `UPDATE analytics_report SET state=$3, validation_passed=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING *`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.by],
    );
    return rows[0] ?? null;
  }

  // ---- review (append-only maker-checker) ----
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      targetType: string;
      targetId: string;
      kind: string;
      requestedBy: string;
      decidedBy: string | null;
      reason: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<ReviewRow> {
    const { rows } = await tx.query<ReviewRow>(
      `INSERT INTO analytics_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, reason, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        r.tenantId,
        r.targetType,
        r.targetId,
        r.kind,
        r.requestedBy,
        r.decidedBy,
        r.reason,
        r.reasonCode,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReview');
  }
  async findOpenReviewRequest(tx: Tx, targetType: string, targetId: string): Promise<ReviewRow | null> {
    const { rows } = await tx.query<ReviewRow>(
      `SELECT * FROM analytics_review WHERE target_type=$1 AND target_id=$2 AND kind='requested' ORDER BY created_at DESC LIMIT 1`,
      [targetType, targetId],
    );
    return rows[0] ?? null;
  }

  // ---- access policy ----
  async insertAccessPolicy(
    tx: Tx,
    p: {
      tenantId: string;
      targetType: string;
      targetId: string;
      requiredEntitlements: readonly string[];
      minScope: string;
      sensitivityFloor: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AccessPolicyRow> {
    const { rows } = await tx.query<AccessPolicyRow>(
      `INSERT INTO analytics_access_policy (tenant_id, target_type, target_id, required_entitlements, min_scope, sensitivity_floor, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [
        p.tenantId,
        p.targetType,
        p.targetId,
        [...p.requiredEntitlements],
        p.minScope,
        p.sensitivityFloor,
        p.idempotencyKey,
        p.correlationId,
        p.by,
      ],
    );
    return firstRow(rows, 'insertAccessPolicy');
  }
  async getActivePolicy(tx: Tx, targetType: string, targetId: string): Promise<AccessPolicyRow | null> {
    const { rows } = await tx.query<AccessPolicyRow>(
      `SELECT * FROM analytics_access_policy WHERE target_type=$1 AND target_id=$2 AND status='active' LIMIT 1`,
      [targetType, targetId],
    );
    return rows[0] ?? null;
  }

  // ---- lineage (append-only) ----
  async insertLineage(
    tx: Tx,
    l: {
      tenantId: string;
      targetType: string;
      targetId: string | null;
      sourceModule: string;
      sourceDatasetId: string | null;
      metricId: string | null;
      metricVersion: number | null;
      windowStart: string | null;
      windowEnd: string | null;
      filters: unknown;
      classification: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<LineageRow> {
    const { rows } = await tx.query<LineageRow>(
      `INSERT INTO analytics_lineage (tenant_id, target_type, target_id, source_module, source_dataset_id, metric_id, metric_version, window_start, window_end, filters, classification, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) RETURNING tenant_id, id, target_type, source_module, metric_id, metric_version, classification`,
      [
        l.tenantId,
        l.targetType,
        l.targetId,
        l.sourceModule,
        l.sourceDatasetId,
        l.metricId,
        l.metricVersion,
        l.windowStart,
        l.windowEnd,
        JSON.stringify(l.filters ?? []),
        l.classification,
        l.correlationId,
        l.by,
      ],
    );
    return firstRow(rows, 'insertLineage');
  }

  // ---- materialization (append-only, money-safe) ----
  async getLatestGeneration(tx: Tx, metricId: string): Promise<number> {
    const { rows } = await tx.query<{ g: string | null }>(
      `SELECT max(generation)::text AS g FROM analytics_materialization WHERE metric_id=$1`,
      [metricId],
    );
    const g = rows[0]?.g;
    return g === null || g === undefined ? 0 : Number(g);
  }
  async insertMaterialization(
    tx: Tx,
    m: {
      tenantId: string;
      metricId: string;
      lineageId: string;
      generation: number;
      dimensionKey: string | null;
      dimensionValue: string | null;
      valueMinor: string | null;
      valueNumeric: string | null;
      count: string | null;
      currency: string | null;
      valueKind: string;
      windowStart: string | null;
      windowEnd: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO analytics_materialization (tenant_id, metric_id, lineage_id, generation, dimension_key, dimension_value, measure_value_minor, measure_value_numeric, measure_count, currency, value_kind, window_start, window_end, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::bigint,$8::numeric,$9::bigint,$10,$11,$12,$13,$14,$15)`,
      [
        m.tenantId,
        m.metricId,
        m.lineageId,
        m.generation,
        m.dimensionKey,
        m.dimensionValue,
        m.valueMinor,
        m.valueNumeric,
        m.count,
        m.currency,
        m.valueKind,
        m.windowStart,
        m.windowEnd,
        m.correlationId,
        m.by,
      ],
    );
  }
  async readMaterialization(tx: Tx, metricId: string, generation: number): Promise<MaterializationRowDb[]> {
    const { rows } = await tx.query<MaterializationRowDb>(
      `SELECT ${MAT_COLS} FROM analytics_materialization WHERE metric_id=$1 AND generation=$2 ORDER BY dimension_value`,
      [metricId, generation],
    );
    return rows;
  }

  // ---- export ----
  async insertExport(
    tx: Tx,
    e: {
      tenantId: string;
      targetType: string;
      targetId: string;
      format: string;
      classification: string;
      entitlementSnapshot: unknown;
      lineageId: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ExportRow> {
    const { rows } = await tx.query<ExportRow>(
      `INSERT INTO analytics_export (tenant_id, target_type, target_id, format, classification, entitlement_snapshot, lineage_id, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$10) RETURNING tenant_id, id, target_type, target_id, format, status, classification, row_count, byte_size::text AS byte_size, storage_ref, lineage_id, version`,
      [
        e.tenantId,
        e.targetType,
        e.targetId,
        e.format,
        e.classification,
        JSON.stringify(e.entitlementSnapshot ?? []),
        e.lineageId,
        e.idempotencyKey,
        e.correlationId,
        e.by,
      ],
    );
    return firstRow(rows, 'insertExport');
  }
  async findExportByIdempotencyKey(tx: Tx, key: string): Promise<ExportRow | null> {
    const { rows } = await tx.query<ExportRow>(
      `SELECT tenant_id, id, target_type, target_id, format, status, classification, row_count, byte_size::text AS byte_size, storage_ref, lineage_id, version FROM analytics_export WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async completeExport(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: {
      status: string;
      rowCount: number;
      byteSize: number;
      storageRef: string | null;
      lineageId: string;
      by: string | null;
    },
  ): Promise<ExportRow | null> {
    const { rows } = await tx.query<ExportRow>(
      `UPDATE analytics_export SET status=$3, row_count=$4, byte_size=$5, storage_ref=$6, lineage_id=$7, version=version+1, updated_at=now(), updated_by=$8 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, target_type, target_id, format, status, classification, row_count, byte_size::text AS byte_size, storage_ref, lineage_id, version`,
      [
        id,
        expectedVersion,
        patch.status,
        patch.rowCount,
        patch.byteSize,
        patch.storageRef,
        patch.lineageId,
        patch.by,
      ],
    );
    return rows[0] ?? null;
  }

  // ---- schedule ----
  async insertSchedule(
    tx: Tx,
    s: {
      tenantId: string;
      reportId: string;
      scope: string;
      scheduleKind: string;
      scheduleSpec: string;
      timerRef: string | null;
      notifyRef: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ScheduleRow> {
    const { rows } = await tx.query<ScheduleRow>(
      `INSERT INTO analytics_schedule (tenant_id, report_id, scope, schedule_kind, schedule_spec, timer_ref, notify_ref, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [
        s.tenantId,
        s.reportId,
        s.scope,
        s.scheduleKind,
        s.scheduleSpec,
        s.timerRef,
        s.notifyRef,
        s.idempotencyKey,
        s.correlationId,
        s.by,
      ],
    );
    return firstRow(rows, 'insertSchedule');
  }
  async updateSchedule(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; timerRef: string | null; notifyRef: string | null; by: string | null },
  ): Promise<ScheduleRow | null> {
    const { rows } = await tx.query<ScheduleRow>(
      `UPDATE analytics_schedule SET status=$3, timer_ref=$4, notify_ref=$5, version=version+1, updated_at=now(), updated_by=$6 WHERE id=$1 AND version=$2 RETURNING *`,
      [id, expectedVersion, patch.status, patch.timerRef, patch.notifyRef, patch.by],
    );
    return rows[0] ?? null;
  }

  // ---- history + idempotency (append-only) ----
  async insertHistory(
    tx: Tx,
    h: {
      tenantId: string;
      targetType: string;
      targetId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO analytics_definition_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        h.tenantId,
        h.targetType,
        h.targetId,
        h.fromStatus,
        h.toStatus,
        h.reason,
        h.reasonCode,
        h.by,
        h.correlationId,
      ],
    );
  }
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      targetType: string | null;
      targetId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO analytics_idempotency (tenant_id, idempotency_key, target_type, target_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [i.tenantId, i.idempotencyKey, i.targetType, i.targetId, i.correlationId, i.by],
    );
  }
}
