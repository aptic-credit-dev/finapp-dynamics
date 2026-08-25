/**
 * M32 definition services — governed DATASETS, METRICS and REPORTS with entitlement policies and maker-checker
 * publication. A dataset declares the whitelisted semantic schema. A metric/report is authored -> validated (fail
 * closed) -> sent for review -> PUBLISHED (a controlled action: a HUMAN approver who is NOT the requester; a published
 * definition is immutable via DB trigger). Every mutation authorizes an `analytics.*` permission (default deny; a
 * platform-scoped definition additionally requires the control-plane permission) and is audited through m03 in the same
 * transaction. No business data is touched — these are DEFINITIONS.
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M32_PERMISSIONS } from './permissions.ts';
import { M32_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  isClassification,
  isAggregation,
  isValueKind,
  validateMetricDefinition,
  validateReportDefinition,
  evaluateSodGate,
  evaluatePublishGate,
  clampPage,
  REASON_CODES,
  type DatasetSchema,
} from './domain.ts';
import {
  AnalyticsRepository,
  type DatasetRow,
  type MetricRow,
  type ReportRow,
  type AccessPolicyRow,
} from './repository.ts';
import type { M32Emitter } from './emit.ts';

export function contentHashOf(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')}`;
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

export class AnalyticsDatasetService {
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
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M32_PERMISSIONS.administer);
  }

  async defineDataset(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      sourceModule: string;
      datasetKey: string;
      name: string;
      description?: string | null;
      classification?: string;
      dimensions?: unknown;
      measures?: unknown;
      idempotencyKey?: string | null;
    },
  ): Promise<DatasetRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.datasetManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const classification = input.classification ?? 'internal';
    if (!isClassification(classification)) throw badRequest('unknown classification.', ctx.correlationId);
    if (input.datasetKey.trim() === '' || input.sourceModule.trim() === '')
      throw badRequest('a dataset key and source module are required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findDatasetByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const dataset = await this.repo.insertDataset(tx, {
        tenantId: ctx.tenantId,
        scope,
        sourceModule: input.sourceModule,
        datasetKey: input.datasetKey,
        name: input.name,
        description: input.description ?? null,
        classification,
        dimensions: input.dimensions ?? [],
        measures: input.measures ?? [],
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'dataset',
        targetId: dataset.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.datasetDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.datasetDefined,
        entityType: 'analytics_dataset',
        entityId: dataset.id,
        detail: { sourceModule: input.sourceModule, datasetKey: input.datasetKey, scope },
      });
      await this.emitter.publishAnalytics(tx, 'DatasetDefined', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: dataset.id,
          recordType: 'dataset',
          sourceModule: input.sourceModule,
          key: input.datasetKey,
          scope,
          toStatus: 'active',
          reasonCode: REASON_CODES.datasetDefined,
        },
      });
      return dataset;
    });
  }

  /** Set (or replace) the entitlement policy that gates who may see a dataset/metric. Aggregation grants no access. */
  async setAccessPolicy(
    ctx: RequestContext,
    actor: string | null,
    input: {
      targetType: 'dataset' | 'metric';
      targetId: string;
      requiredEntitlements: readonly string[];
      minScope?: string;
      sensitivityFloor?: string;
      idempotencyKey?: string | null;
    },
  ): Promise<AccessPolicyRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.datasetManage);
    const minScope = input.minScope ?? 'tenant';
    const sensitivityFloor = input.sensitivityFloor ?? 'internal';
    if (!isScope(minScope)) throw badRequest('unknown min scope.', ctx.correlationId);
    if (!isClassification(sensitivityFloor))
      throw badRequest('unknown sensitivity floor.', ctx.correlationId);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.insertAccessPolicy(tx, {
        tenantId: ctx.tenantId,
        targetType: input.targetType,
        targetId: input.targetId,
        requiredEntitlements: input.requiredEntitlements,
        minScope,
        sensitivityFloor,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      }),
    );
  }

  async listDatasets(ctx: RequestContext, page?: { limit?: number; offset?: number }): Promise<DatasetRow[]> {
    await this.authz.require(ctx, M32_PERMISSIONS.datasetRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listDatasets(tx, limit, offset));
  }
  async getDataset(ctx: RequestContext, id: string): Promise<DatasetRow | null> {
    await this.authz.require(ctx, M32_PERMISSIONS.datasetRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getDataset(tx, id));
  }
}

export class AnalyticsMetricService {
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
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M32_PERMISSIONS.administer);
  }

  async defineMetric(
    ctx: RequestContext,
    actor: string | null,
    input: {
      datasetId: string;
      scope?: string;
      metricKey: string;
      name: string;
      description?: string | null;
      aggregation: string;
      measureKey: string;
      valueKind?: string;
      currency?: string | null;
      dimensions?: readonly string[];
      filters?: unknown;
      classification?: string;
      idempotencyKey?: string | null;
    },
  ): Promise<MetricRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.metricAuthor);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const valueKind = input.valueKind ?? 'count';
    const classification = input.classification ?? 'internal';
    if (!isAggregation(input.aggregation)) throw badRequest('unknown aggregation.', ctx.correlationId);
    if (!isValueKind(valueKind)) throw badRequest('unknown value kind.', ctx.correlationId);
    if (!isClassification(classification)) throw badRequest('unknown classification.', ctx.correlationId);
    if (input.metricKey.trim() === '') throw badRequest('a metric key is required.', ctx.correlationId);
    const dimensions = input.dimensions ?? [];
    const contentHash = contentHashOf({
      datasetId: input.datasetId,
      metricKey: input.metricKey,
      aggregation: input.aggregation,
      measureKey: input.measureKey,
      valueKind,
      currency: input.currency ?? null,
      dimensions,
      filters: input.filters ?? [],
    });
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findMetricByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const dataset = await this.repo.getDataset(tx, input.datasetId);
      if (dataset === null) throw badRequest('unknown dataset.', ctx.correlationId);
      const metric = await this.repo.insertMetric(tx, {
        tenantId: ctx.tenantId,
        datasetId: input.datasetId,
        scope,
        metricKey: input.metricKey,
        name: input.name,
        description: input.description ?? null,
        aggregation: input.aggregation,
        measureKey: input.measureKey,
        valueKind,
        currency: input.currency ?? null,
        dimensions,
        filters: input.filters ?? [],
        classification,
        contentHash,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'metric',
        targetId: metric.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.metricDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.metricDefined,
        entityType: 'analytics_metric',
        entityId: metric.id,
        detail: { metricKey: input.metricKey, aggregation: input.aggregation, valueKind, scope },
      });
      return metric;
    });
  }

  /** Validate a metric against its dataset schema (fail closed); a passing metric moves draft -> validated. */
  async validateMetric(
    ctx: RequestContext,
    actor: string | null,
    metricId: string,
    expectedVersion: number,
  ): Promise<{ passed: boolean; findings: readonly { code: string; ref?: string }[] }> {
    await this.authz.require(ctx, M32_PERMISSIONS.metricAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const metric = await this.repo.getMetric(tx, metricId);
      if (metric === null) throw badRequest('unknown metric.', ctx.correlationId);
      const dataset = await this.repo.getDataset(tx, metric.dataset_id);
      if (dataset === null) throw badRequest('unknown dataset.', ctx.correlationId);
      const dims = Array.isArray(metric.dimensions) ? (metric.dimensions as string[]) : [];
      const outcome = validateMetricDefinition(
        {
          aggregation: metric.aggregation,
          measureKey: metric.measure_key,
          valueKind: metric.value_kind,
          currency: metric.currency,
          dimensions: dims,
        },
        schemaOf(dataset),
      );
      if (outcome.passed) {
        const moved = await this.repo.updateMetricState(tx, metricId, expectedVersion, {
          state: 'validated',
          validationPassed: true,
          by: actor,
        });
        if (moved === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M32_AUDIT_CODES.metricValidated,
          entityType: 'analytics_metric',
          entityId: metricId,
          detail: { metricKey: metric.metric_key },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M32_AUDIT_CODES.publishBlocked,
          entityType: 'analytics_metric',
          entityId: metricId,
          detail: { reasonCode: REASON_CODES.validationFailed, findingCount: outcome.findings.length },
        });
      }
      return outcome;
    });
  }

  async requestReview(
    ctx: RequestContext,
    actor: string | null,
    metricId: string,
    expectedVersion: number,
  ): Promise<MetricRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.metricAuthor);
    if (actor === null || actor.trim() === '')
      throw badRequest('an identified requester is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const metric = await this.repo.getMetric(tx, metricId);
      if (metric === null) throw badRequest('unknown metric.', ctx.correlationId);
      if (metric.state !== 'validated')
        throw badRequest('only a validated metric can be sent for review.', ctx.correlationId);
      const moved = await this.repo.updateMetricState(tx, metricId, expectedVersion, {
        state: 'review_pending',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'metric',
        targetId: metricId,
        kind: 'requested',
        requestedBy: actor,
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.reviewRequested,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.reviewRequested,
        entityType: 'analytics_metric',
        entityId: metricId,
        detail: { metricKey: metric.metric_key },
      });
      return moved;
    });
  }

  /** PUBLISH a metric — a controlled action (maker-checker/SoD, human approver, validation passed). Supersedes the prior
   * published version of the same key. AI never approves. */
  async publishMetric(
    ctx: RequestContext,
    actor: string | null,
    metricId: string,
    expectedVersion: number,
  ): Promise<MetricRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.metricPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const metric = await this.repo.getMetric(tx, metricId);
      if (metric === null) throw badRequest('unknown metric.', ctx.correlationId);
      await this.authorizeScope(ctx, metric.scope);
      if (metric.state !== 'review_pending')
        throw badRequest('only a metric in review can be published.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'metric', metricId);
      const gate = evaluatePublishGate({
        validationPassed: metric.validation_passed,
        requestedBy: request?.requested_by ?? '',
        approver: actor,
      });
      if (!gate.allowed) {
        const code =
          gate.reasonCode === REASON_CODES.selfApproval || gate.reasonCode === REASON_CODES.notHumanApprover
            ? M32_AUDIT_CODES.sodBlocked
            : M32_AUDIT_CODES.publishBlocked;
        await this.emitter.recordAudit(tx, ctx, {
          code,
          entityType: 'analytics_metric',
          entityId: metricId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      // supersede the prior published version of this key (a published metric may only move to superseded).
      const prior = await this.repo.getPublishedMetricByKey(tx, metric.scope, metric.metric_key);
      if (prior !== null && prior.id !== metricId) {
        const superseded = await this.repo.updateMetricState(tx, prior.id, prior.version, {
          state: 'superseded',
          validationPassed: prior.validation_passed,
          by: actor,
        });
        if (superseded === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M32_AUDIT_CODES.metricSuperseded,
          entityType: 'analytics_metric',
          entityId: prior.id,
          detail: { metricKey: metric.metric_key },
        });
        await this.emitter.publishAnalytics(tx, 'MetricSuperseded', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: prior.id,
            recordType: 'metric',
            key: metric.metric_key,
            toStatus: 'superseded',
            reasonCode: REASON_CODES.superseded,
          },
        });
      }
      const published = await this.repo.updateMetricState(tx, metricId, expectedVersion, {
        state: 'published',
        validationPassed: true,
        by: actor,
      });
      if (published === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'metric',
        targetId: metricId,
        kind: 'approved',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.published,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'metric',
        targetId: metricId,
        fromStatus: 'review_pending',
        toStatus: 'published',
        reason: null,
        reasonCode: REASON_CODES.published,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.metricPublished,
        entityType: 'analytics_metric',
        entityId: metricId,
        detail: { metricKey: metric.metric_key, version: metric.version },
      });
      await this.emitter.publishAnalytics(tx, 'MetricPublished', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: metricId,
          recordType: 'metric',
          key: metric.metric_key,
          scope: metric.scope,
          toStatus: 'published',
          reasonCode: REASON_CODES.published,
        },
      });
      return published;
    });
  }

  async rejectReview(
    ctx: RequestContext,
    actor: string | null,
    metricId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<MetricRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.metricPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const metric = await this.repo.getMetric(tx, metricId);
      if (metric === null) throw badRequest('unknown metric.', ctx.correlationId);
      if (metric.state !== 'review_pending')
        throw badRequest('only a metric in review can be rejected.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'metric', metricId);
      const sod = evaluateSodGate(request?.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M32_AUDIT_CODES.sodBlocked,
          entityType: 'analytics_metric',
          entityId: metricId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateMetricState(tx, metricId, expectedVersion, {
        state: 'rejected',
        validationPassed: metric.validation_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'metric',
        targetId: metricId,
        kind: 'rejected',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason,
        reasonCode: REASON_CODES.rejected,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.reviewRejected,
        entityType: 'analytics_metric',
        entityId: metricId,
        detail: {},
      });
      return moved;
    });
  }

  async getMetric(ctx: RequestContext, id: string): Promise<MetricRow | null> {
    await this.authz.require(ctx, M32_PERMISSIONS.metricRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getMetric(tx, id));
  }
  /** Metrics of a dataset (any state) — read-model for the reporting workspace. */
  async listMetrics(
    ctx: RequestContext,
    datasetId: string,
    page?: { limit?: number; offset?: number },
  ): Promise<MetricRow[]> {
    await this.authz.require(ctx, M32_PERMISSIONS.metricRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listMetrics(tx, datasetId, limit, offset));
  }
  /** Published metrics across datasets (the ones a query can run against). */
  async listPublishedMetrics(ctx: RequestContext, limit?: number): Promise<MetricRow[]> {
    await this.authz.require(ctx, M32_PERMISSIONS.metricRead);
    const { limit: lim } = clampPage(limit, 0);
    return this.db.withTenant(ctx, (tx) => this.repo.listPublishedMetrics(tx, lim));
  }
}

export class AnalyticsReportService {
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
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M32_PERMISSIONS.administer);
  }

  async defineReport(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      reportKey: string;
      name: string;
      description?: string | null;
      kind?: string;
      spec?: unknown;
      classification?: string;
      idempotencyKey?: string | null;
    },
  ): Promise<ReportRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.reportAuthor);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const kind = input.kind ?? 'report';
    const classification = input.classification ?? 'internal';
    if (kind !== 'report' && kind !== 'dashboard')
      throw badRequest('unknown report kind.', ctx.correlationId);
    if (!isClassification(classification)) throw badRequest('unknown classification.', ctx.correlationId);
    if (input.reportKey.trim() === '') throw badRequest('a report key is required.', ctx.correlationId);
    const spec = input.spec ?? {};
    const contentHash = contentHashOf({ reportKey: input.reportKey, kind, spec });
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const found = await tx.query<{ id: string }>(
          `SELECT id FROM analytics_report WHERE idempotency_key=$1 LIMIT 1`,
          [input.idempotencyKey],
        );
        const existingId = found.rows[0]?.id;
        if (existingId !== undefined) {
          const existing = await this.repo.getReport(tx, existingId);
          if (existing !== null) return existing;
        }
      }
      const report = await this.repo.insertReport(tx, {
        tenantId: ctx.tenantId,
        scope,
        reportKey: input.reportKey,
        name: input.name,
        description: input.description ?? null,
        kind,
        spec,
        classification,
        contentHash,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'report',
        targetId: report.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.reportDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.reportDefined,
        entityType: 'analytics_report',
        entityId: report.id,
        detail: { reportKey: input.reportKey, kind, scope },
      });
      return report;
    });
  }

  /** Validate a report against the published metric keys (fail closed); a passing report moves draft -> validated. */
  async validateReport(
    ctx: RequestContext,
    actor: string | null,
    reportId: string,
    expectedVersion: number,
    knownMetricKeys: readonly string[],
  ): Promise<{ passed: boolean; findings: readonly { code: string; ref?: string }[] }> {
    await this.authz.require(ctx, M32_PERMISSIONS.reportAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const report = await this.repo.getReport(tx, reportId);
      if (report === null) throw badRequest('unknown report.', ctx.correlationId);
      const outcome = validateReportDefinition(report.spec, knownMetricKeys);
      if (outcome.passed) {
        const moved = await this.repo.updateReportState(tx, reportId, expectedVersion, {
          state: 'validated',
          validationPassed: true,
          by: actor,
        });
        if (moved === null) throw versionConflict(ctx.correlationId);
      }
      return outcome;
    });
  }

  async requestReview(
    ctx: RequestContext,
    actor: string | null,
    reportId: string,
    expectedVersion: number,
  ): Promise<ReportRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.reportAuthor);
    if (actor === null || actor.trim() === '')
      throw badRequest('an identified requester is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const report = await this.repo.getReport(tx, reportId);
      if (report === null) throw badRequest('unknown report.', ctx.correlationId);
      if (report.state !== 'validated')
        throw badRequest('only a validated report can be sent for review.', ctx.correlationId);
      const moved = await this.repo.updateReportState(tx, reportId, expectedVersion, {
        state: 'review_pending',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'report',
        targetId: reportId,
        kind: 'requested',
        requestedBy: actor,
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.reviewRequested,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.reviewRequested,
        entityType: 'analytics_report',
        entityId: reportId,
        detail: { reportKey: report.report_key },
      });
      return moved;
    });
  }

  async publishReport(
    ctx: RequestContext,
    actor: string | null,
    reportId: string,
    expectedVersion: number,
  ): Promise<ReportRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.reportPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const report = await this.repo.getReport(tx, reportId);
      if (report === null) throw badRequest('unknown report.', ctx.correlationId);
      await this.authorizeScope(ctx, report.scope);
      if (report.state !== 'review_pending')
        throw badRequest('only a report in review can be published.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'report', reportId);
      const gate = evaluatePublishGate({
        validationPassed: report.validation_passed,
        requestedBy: request?.requested_by ?? '',
        approver: actor,
      });
      if (!gate.allowed) {
        const code =
          gate.reasonCode === REASON_CODES.selfApproval || gate.reasonCode === REASON_CODES.notHumanApprover
            ? M32_AUDIT_CODES.sodBlocked
            : M32_AUDIT_CODES.publishBlocked;
        await this.emitter.recordAudit(tx, ctx, {
          code,
          entityType: 'analytics_report',
          entityId: reportId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      const published = await this.repo.updateReportState(tx, reportId, expectedVersion, {
        state: 'published',
        validationPassed: true,
        by: actor,
      });
      if (published === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'report',
        targetId: reportId,
        kind: 'approved',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.published,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'report',
        targetId: reportId,
        fromStatus: 'review_pending',
        toStatus: 'published',
        reason: null,
        reasonCode: REASON_CODES.published,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.reportPublished,
        entityType: 'analytics_report',
        entityId: reportId,
        detail: { reportKey: report.report_key, kind: report.kind },
      });
      await this.emitter.publishAnalytics(tx, 'ReportPublished', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: reportId,
          recordType: 'report',
          key: report.report_key,
          kind: report.kind,
          scope: report.scope,
          toStatus: 'published',
          reasonCode: REASON_CODES.published,
        },
      });
      return published;
    });
  }

  async getReport(ctx: RequestContext, id: string): Promise<ReportRow | null> {
    await this.authz.require(ctx, M32_PERMISSIONS.reportRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getReport(tx, id));
  }
  async listReports(ctx: RequestContext, page?: { limit?: number; offset?: number }): Promise<ReportRow[]> {
    await this.authz.require(ctx, M32_PERMISSIONS.reportRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listReports(tx, limit, offset));
  }
}
