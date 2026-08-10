import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  AnalyticsDatasetService,
  AnalyticsMetricService,
  AnalyticsReportService,
  M32_PERMISSIONS,
  M32_AUDIT_CODES,
} from '@finapp/m32-analytics';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { datasetView, metricView, reportView } from './views.ts';

/**
 * Analytics DEFINITIONS under `/api/v1/analytics` — governed datasets, metrics and reports. Authoring is unprivileged;
 * dataset management, and metric/report PUBLICATION (a controlled maker-checker action) are privileged and audited.
 * Reads carry no `@Endpoint` — the read permission is enforced in-service (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('analytics')
export class AnalyticsDefinitionsController {
  private readonly datasets: AnalyticsDatasetService;
  private readonly metrics: AnalyticsMetricService;
  private readonly reports: AnalyticsReportService;
  private readonly actors: ActorContextFactory;
  constructor(
    datasets: AnalyticsDatasetService,
    metrics: AnalyticsMetricService,
    reports: AnalyticsReportService,
    actors: ActorContextFactory,
  ) {
    this.datasets = datasets;
    this.metrics = metrics;
    this.reports = reports;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M32_PERMISSIONS.datasetManage,
    auditCode: M32_AUDIT_CODES.datasetDefined,
    description: 'Define a governed semantic dataset.',
  })
  @Post('datasets')
  async defineDataset(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define analytics dataset (m32)');
    const d = await this.datasets.defineDataset(s.ctx, s.actor.identityId, {
      sourceModule: requireString(b['sourceModule'], 'sourceModule', s.correlationId),
      datasetKey: requireString(b['datasetKey'], 'datasetKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['classification'], 'classification'),
      dimensions: b['dimensions'] ?? [],
      measures: b['measures'] ?? [],
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return datasetView(d);
  }

  @Get('datasets')
  async listDatasets(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list analytics datasets (m32)');
    const rows = await this.datasets.listDatasets(s.ctx, {});
    return { datasets: rows.map(datasetView) };
  }

  @Endpoint({
    permission: M32_PERMISSIONS.datasetManage,
    auditCode: M32_AUDIT_CODES.datasetUpdated,
    description: 'Set the entitlement access policy for a dataset/metric.',
  })
  @Post('policies')
  async setPolicy(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'set analytics access policy (m32)');
    const p = await this.datasets.setAccessPolicy(s.ctx, s.actor.identityId, {
      targetType: requireString(b['targetType'], 'targetType', s.correlationId) as 'dataset' | 'metric',
      targetId: requireString(b['targetId'], 'targetId', s.correlationId),
      requiredEntitlements: Array.isArray(b['requiredEntitlements'])
        ? (b['requiredEntitlements'] as string[])
        : [],
      ...optStr(b['minScope'], 'minScope'),
      ...optStr(b['sensitivityFloor'], 'sensitivityFloor'),
    });
    return { id: p.id, targetType: p.target_type, targetId: p.target_id, status: p.status };
  }

  @Endpoint({
    permission: M32_PERMISSIONS.metricAuthor,
    auditCode: M32_AUDIT_CODES.metricDefined,
    description: 'Author a governed metric/KPI (draft).',
  })
  @Post('metrics')
  async defineMetric(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define analytics metric (m32)');
    const m = await this.metrics.defineMetric(s.ctx, s.actor.identityId, {
      datasetId: requireString(b['datasetId'], 'datasetId', s.correlationId),
      metricKey: requireString(b['metricKey'], 'metricKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      aggregation: requireString(b['aggregation'], 'aggregation', s.correlationId),
      measureKey: requireString(b['measureKey'], 'measureKey', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['valueKind'], 'valueKind'),
      ...optStr(b['currency'], 'currency'),
      ...optStr(b['classification'], 'classification'),
      dimensions: Array.isArray(b['dimensions']) ? (b['dimensions'] as string[]) : [],
      filters: b['filters'] ?? [],
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return metricView(m);
  }

  @Endpoint({
    permission: M32_PERMISSIONS.metricAuthor,
    auditCode: M32_AUDIT_CODES.metricValidated,
    description: 'Validate a metric against its dataset schema.',
  })
  @Post('metrics/:id/validate')
  async validateMetric(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'validate analytics metric (m32)');
    const out = await this.metrics.validateMetric(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return { passed: out.passed, findings: out.findings };
  }

  @Endpoint({
    permission: M32_PERMISSIONS.metricAuthor,
    auditCode: M32_AUDIT_CODES.reviewRequested,
    description: 'Send a validated metric for review.',
  })
  @Post('metrics/:id/review')
  async reviewMetric(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'request analytics metric review (m32)');
    const m = await this.metrics.requestReview(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return metricView(m);
  }

  @Endpoint({
    permission: M32_PERMISSIONS.metricPublish,
    auditCode: M32_AUDIT_CODES.metricPublished,
    description: 'Publish a metric (maker-checker; approver != author).',
  })
  @Post('metrics/:id/publish')
  async publishMetric(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish analytics metric (m32)');
    const m = await this.metrics.publishMetric(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return metricView(m);
  }

  @Get('metrics/:id')
  async getMetric(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get analytics metric (m32)');
    const m = await this.metrics.getMetric(s.ctx, id);
    return m === null ? { metric: null } : metricView(m);
  }

  @Endpoint({
    permission: M32_PERMISSIONS.reportAuthor,
    auditCode: M32_AUDIT_CODES.reportDefined,
    description: 'Author a report/dashboard (draft).',
  })
  @Post('reports')
  async defineReport(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define analytics report (m32)');
    const r = await this.reports.defineReport(s.ctx, s.actor.identityId, {
      reportKey: requireString(b['reportKey'], 'reportKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['kind'], 'kind'),
      ...optStr(b['classification'], 'classification'),
      spec: b['spec'] ?? {},
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return reportView(r);
  }

  @Endpoint({
    permission: M32_PERMISSIONS.reportPublish,
    auditCode: M32_AUDIT_CODES.reportPublished,
    description: 'Publish a report (maker-checker; approver != author).',
  })
  @Post('reports/:id/publish')
  async publishReport(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish analytics report (m32)');
    const r = await this.reports.publishReport(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return reportView(r);
  }
}
