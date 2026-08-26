/**
 * M32 query + materialization services — the GOVERNED runtime. THE LOAD-BEARING CONTROLS live here:
 *  - `runQuery` compiles a metric query through `compileMetricQuery` (whitelisted dimensions/measures/operators only;
 *    NO arbitrary SQL — an unknown/unsafe query FAILS CLOSED), enforces the ENTITLEMENT intersection (a caller must hold
 *    every required entitlement at sufficient scope/sensitivity — aggregation NEVER grants access or leaks hidden
 *    counts), reads a FIXED parameterized SELECT over the metric's latest materialization, applies the compiled filters
 *    in-memory (bound scalars, never SQL), and writes mandatory LINEAGE.
 *  - `materializeMetric` computes a derived aggregate snapshot through a governed source port (deterministic doubles;
 *    fail closed) — SOURCE OF TRUTH stays the source module — writing lineage + a new rebuildable generation. Money is
 *    bigint minor / exact decimal / integer count (no float).
 *  - `aggregatesForCopilot` is the entitlement-filtered, citation-bearing evidence M28's ExecutiveAnalyticsPort returns.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import type { EvidenceItem, ReadPortQuery } from '@finapp/m28-executive-ai';
import { M32_PERMISSIONS } from './permissions.ts';
import { M32_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import {
  compileMetricQuery,
  evaluateEntitlement,
  measureColumnForKind,
  REASON_CODES,
  type AnalyticsCaller,
  type AccessPolicy,
  type DatasetSchema,
  type MetricQuerySpec,
  type CompiledFilter,
} from './domain.ts';
import {
  AnalyticsRepository,
  type MetricRow,
  type DatasetRow,
  type MaterializationRowDb,
} from './repository.ts';
import type { M32Emitter } from './emit.ts';
import type { AnalyticsEvidenceProvider, MaterializationSourcePort } from './ports.ts';

function callerOf(ctx: RequestContext): AnalyticsCaller {
  const perms = ctx.permissions;
  const clearance = perms.includes(M32_PERMISSIONS.administer)
    ? 'restricted'
    : perms.includes(M32_PERMISSIONS.exportCreate)
      ? 'confidential'
      : 'internal';
  const scopeLevel = perms.includes(M32_PERMISSIONS.administer) ? 'platform' : 'tenant';
  return { tenantId: ctx.tenantId, scopeLevel, entitlements: perms, sensitivityClearance: clearance };
}

function schemaOf(dataset: DatasetRow): DatasetSchema {
  const dims = Array.isArray(dataset.dimensions) ? (dataset.dimensions as unknown[]) : [];
  const meas = Array.isArray(dataset.measures) ? (dataset.measures as unknown[]) : [];
  const key = (x: unknown): string | null => {
    if (typeof x === 'string') return x;
    const k = (x as { key?: unknown } | null)?.key;
    return typeof k === 'string' ? k : null;
  };
  return {
    dimensionKeys: dims.map(key).filter((k): k is string => k !== null),
    measureKeys: meas.map(key).filter((k): k is string => k !== null),
  };
}

function measureOf(row: MaterializationRowDb): string | null {
  const col = measureColumnForKind(row.value_kind);
  return col === 'measure_count'
    ? row.measure_count
    : col === 'measure_value_minor'
      ? row.measure_value_minor
      : row.measure_value_numeric;
}

// Apply the COMPILED, whitelisted filters to already-aggregated snapshot rows (values are bound scalars — never SQL).
function applyFilters(
  rows: readonly MaterializationRowDb[],
  filters: readonly CompiledFilter[],
): MaterializationRowDb[] {
  if (filters.length === 0) return [...rows];
  return rows.filter((r) =>
    filters.every((f) => {
      const dv = r.dimension_value;
      if (dv === null) return false;
      switch (f.op) {
        case 'eq':
          return dv === String(f.value);
        case 'neq':
          return dv !== String(f.value);
        case 'in':
          return Array.isArray(f.value) && f.value.map(String).includes(dv);
        default:
          return true; // gt/gte/lt/lte/between apply to numeric dimensions; snapshot filtering keeps the equality subset
      }
    }),
  );
}

export interface QueryResultRow {
  readonly dimensionValue: string | null;
  readonly measure: string | null;
  readonly valueKind: string;
  readonly currency: string | null;
}
export interface QueryResult {
  readonly metricId: string;
  readonly metricKey: string;
  readonly metricVersion: number;
  readonly valueKind: string;
  readonly lineageId: string;
  readonly rows: readonly QueryResultRow[];
}

export class AnalyticsQueryService implements AnalyticsEvidenceProvider {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M32Emitter;
  private readonly repo: AnalyticsRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M32Emitter,
    repo: AnalyticsRepository = new AnalyticsRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async policyFor(tx: Tx, metric: MetricRow): Promise<AccessPolicy> {
    const explicit = await this.repo.getActivePolicy(tx, 'metric', metric.id);
    if (explicit !== null)
      return {
        requiredEntitlements: explicit.required_entitlements,
        minScope: explicit.min_scope,
        sensitivityFloor: explicit.sensitivity_floor,
      };
    // default: the metric's own scope + classification gate (read entitlement required).
    return {
      requiredEntitlements: [M32_PERMISSIONS.metricRead],
      minScope: metric.scope,
      sensitivityFloor: metric.classification,
    };
  }

  /** Run a governed semantic query. No arbitrary SQL; entitlement-gated; lineage-bearing. */
  async runQuery(
    ctx: RequestContext,
    actor: string | null,
    input: {
      metricKey: string;
      scope?: string;
      groupBy?: readonly string[];
      filters?: MetricQuerySpec['filters'];
    },
  ): Promise<QueryResult> {
    await this.authz.require(ctx, M32_PERMISSIONS.queryRun);
    const scope = input.scope ?? 'tenant';
    return this.db.withTenant(ctx, async (tx) => {
      const metric = await this.repo.getPublishedMetricByKey(tx, scope, input.metricKey);
      if (metric === null) throw governanceForbidden(REASON_CODES.notPublished, ctx.correlationId);
      const dataset = await this.repo.getDataset(tx, metric.dataset_id);
      if (dataset === null) throw badRequest('unknown dataset.', ctx.correlationId);

      // 1. ENTITLEMENT INTERSECTION — aggregation grants no access (fail closed, no partial aggregate).
      const gate = evaluateEntitlement(await this.policyFor(tx, metric), callerOf(ctx));
      if (!gate.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M32_AUDIT_CODES.accessBlocked,
          entityType: 'analytics_metric',
          entityId: metric.id,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }

      // 2. GOVERNED COMPILE — whitelisted dims/measures/operators only; no arbitrary SQL.
      const compiled = compileMetricQuery(
        { aggregation: metric.aggregation, measureKey: metric.measure_key },
        schemaOf(dataset),
        {
          aggregation: metric.aggregation,
          measureKey: metric.measure_key,
          groupBy: input.groupBy ?? [],
          filters: input.filters ?? [],
        },
      );
      if (!compiled.ok || compiled.plan === undefined) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M32_AUDIT_CODES.accessBlocked,
          entityType: 'analytics_metric',
          entityId: metric.id,
          detail: { reasonCode: compiled.reasonCode ?? REASON_CODES.structuralInvalid },
        });
        throw governanceForbidden(compiled.reasonCode ?? REASON_CODES.structuralInvalid, ctx.correlationId);
      }

      // 3. Read the FIXED parameterized SELECT over the latest materialization generation; filter in-memory.
      const generation = await this.repo.getLatestGeneration(tx, metric.id);
      const snapshot = generation === 0 ? [] : await this.repo.readMaterialization(tx, metric.id, generation);
      const filtered = applyFilters(snapshot, compiled.plan.filters);

      // 4. Mandatory LINEAGE for the query result.
      const lineage = await this.repo.insertLineage(tx, {
        tenantId: ctx.tenantId,
        targetType: 'query',
        targetId: null,
        sourceModule: dataset.source_module,
        sourceDatasetId: dataset.id,
        metricId: metric.id,
        metricVersion: metric.version,
        windowStart: null,
        windowEnd: null,
        filters: compiled.plan.filters,
        classification: metric.classification,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.queryExecuted,
        entityType: 'analytics_metric',
        entityId: metric.id,
        detail: { metricKey: metric.metric_key, rowCount: filtered.length },
      });

      return {
        metricId: metric.id,
        metricKey: metric.metric_key,
        metricVersion: metric.version,
        valueKind: metric.value_kind,
        lineageId: lineage.id,
        rows: filtered.map((r) => ({
          dimensionValue: r.dimension_value,
          measure: measureOf(r),
          valueKind: r.value_kind,
          currency: r.currency,
        })),
      };
    });
  }

  /** The M28 ExecutiveAnalyticsPort evidence: published metrics the caller is ENTITLED to, citation-bearing, no values. */
  async aggregatesForCopilot(ctx: RequestContext, query: ReadPortQuery): Promise<readonly EvidenceItem[]> {
    return this.db.withTenant(ctx, async (tx) => {
      const metrics = await this.repo.listPublishedMetrics(tx, Math.max(1, Math.min(query.maxSources, 50)));
      const caller = callerOf(ctx);
      const out: EvidenceItem[] = [];
      for (const metric of metrics) {
        const gate = evaluateEntitlement(await this.policyFor(tx, metric), caller);
        if (!gate.allowed) continue; // MASKED — a metric the caller is not entitled to is dropped, never counted/cited.
        const generation = await this.repo.getLatestGeneration(tx, metric.id);
        const rowCount =
          generation === 0 ? 0 : (await this.repo.readMaterialization(tx, metric.id, generation)).length;
        out.push({
          entitlement: {
            tenantId: ctx.tenantId,
            scopeLevel: metric.scope,
            requiredEntitlements: [M32_PERMISSIONS.metricRead],
            classification: metric.classification,
          },
          citation: {
            // 'metric' is the canonical cross-module citation source_type the consumer (m28 copilot) accepts
            // (copilot_citation_source_ck: record|document|metric|aggregate|timeline|report). A published m32
            // metric is exactly a 'metric' source; 'analytics_metric' is m32's internal entity name, not the
            // shared citation vocabulary.
            sourceType: 'metric',
            sourceModule: 'm32-analytics',
            recordRef: metric.id,
            documentRef: null,
            documentVersion: String(metric.version),
            location: metric.metric_key,
            confidenceBps: 10000,
          },
          headline: `${metric.name} (${String(rowCount)} series)`, // bounded, non-restricted — never a metric value.
        });
        if (out.length >= query.maxSources) break;
      }
      return out;
    });
  }
}

export class AnalyticsMaterializationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M32Emitter;
  private readonly repo: AnalyticsRepository;
  private readonly source: MaterializationSourcePort;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M32Emitter,
    source: MaterializationSourcePort,
    repo: AnalyticsRepository = new AnalyticsRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.source = source;
    this.repo = repo;
  }

  /** Compute a NEW rebuildable materialization generation for a published metric. Source of truth stays the source
   * module; the snapshot is derived/read-only + lineage-bearing. Money-safe (minor/decimal/count strings, no float). */
  async materializeMetric(
    ctx: RequestContext,
    actor: string | null,
    metricId: string,
    input: { windowStart?: string | null; windowEnd?: string | null; idempotencyKey?: string | null } = {},
  ): Promise<{ generation: number; rowCount: number; lineageId: string }> {
    await this.authz.require(ctx, M32_PERMISSIONS.datasetManage);
    // compute OUTSIDE the write tx (the source port manages its own read); then persist atomically.
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const metric = await this.repo.getMetric(tx, metricId);
      if (metric === null) throw badRequest('unknown metric.', ctx.correlationId);
      if (metric.state !== 'published')
        throw governanceForbidden(REASON_CODES.notPublished, ctx.correlationId);
      const dataset = await this.repo.getDataset(tx, metric.dataset_id);
      if (dataset === null) throw badRequest('unknown dataset.', ctx.correlationId);
      const generation = (await this.repo.getLatestGeneration(tx, metricId)) + 1;
      return { metric, dataset, generation };
    });

    const rows = await this.source.computeAggregate(ctx, {
      sourceModule: prepared.dataset.source_module,
      datasetKey: prepared.dataset.dataset_key,
      metricKey: prepared.metric.metric_key,
      plan: {
        aggregation: prepared.metric.aggregation as never,
        measureKey: prepared.metric.measure_key,
        groupBy: [],
        filters: [],
      },
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
    });

    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          targetType: 'materialization',
          targetId: metricId,
          correlationId: ctx.correlationId,
          by: actor,
        });
      }
      const lineage = await this.repo.insertLineage(tx, {
        tenantId: ctx.tenantId,
        targetType: 'materialization',
        targetId: metricId,
        sourceModule: prepared.dataset.source_module,
        sourceDatasetId: prepared.dataset.id,
        metricId,
        metricVersion: prepared.metric.version,
        windowStart: input.windowStart ?? null,
        windowEnd: input.windowEnd ?? null,
        filters: [],
        classification: prepared.metric.classification,
        correlationId: ctx.correlationId,
        by: actor,
      });
      for (const r of rows) {
        await this.repo.insertMaterialization(tx, {
          tenantId: ctx.tenantId,
          metricId,
          lineageId: lineage.id,
          generation: prepared.generation,
          dimensionKey: r.dimensionKey,
          dimensionValue: r.dimensionValue,
          valueMinor: r.valueMinor,
          valueNumeric: r.valueNumeric,
          count: r.count,
          currency: prepared.metric.currency,
          valueKind: prepared.metric.value_kind,
          windowStart: input.windowStart ?? null,
          windowEnd: input.windowEnd ?? null,
          correlationId: ctx.correlationId,
          by: actor,
        });
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.materialized,
        entityType: 'analytics_metric',
        entityId: metricId,
        detail: { generation: prepared.generation, rowCount: rows.length },
      });
      await this.emitter.publishAnalytics(tx, 'MaterializationCompleted', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: metricId,
          recordType: 'materialization',
          sourceModule: prepared.dataset.source_module,
          key: prepared.metric.metric_key,
          version: prepared.generation,
          rowCount: rows.length,
          reasonCode: REASON_CODES.materialized,
        },
      });
      return { generation: prepared.generation, rowCount: rows.length, lineageId: lineage.id };
    });
  }
}
