import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import type { MetricQuerySpec } from '@finapp/m32-analytics';
import {
  AnalyticsQueryService,
  AnalyticsMaterializationService,
  AnalyticsExportService,
  AnalyticsScheduleService,
  M32_PERMISSIONS,
  M32_AUDIT_CODES,
} from '@finapp/m32-analytics';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { exportView, scheduleView, queryView } from './views.ts';

/**
 * Analytics RUNTIME under `/api/v1/analytics` — the GOVERNED semantic query, materialization, export and schedule.
 * A query is entitlement-gated + compiled (no arbitrary SQL) + lineage-bearing; an export is privileged + filter-
 * before-export; a schedule holds only opaque m06/m08 references. Every route authorizes an `analytics.*` permission.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('analytics')
export class AnalyticsRuntimeController {
  private readonly query: AnalyticsQueryService;
  private readonly materialize: AnalyticsMaterializationService;
  private readonly exports: AnalyticsExportService;
  private readonly schedules: AnalyticsScheduleService;
  private readonly actors: ActorContextFactory;
  constructor(
    query: AnalyticsQueryService,
    materialize: AnalyticsMaterializationService,
    exports: AnalyticsExportService,
    schedules: AnalyticsScheduleService,
    actors: ActorContextFactory,
  ) {
    this.query = query;
    this.materialize = materialize;
    this.exports = exports;
    this.schedules = schedules;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M32_PERMISSIONS.queryRun,
    auditCode: M32_AUDIT_CODES.queryExecuted,
    description: 'Run a governed semantic query (entitlement-gated; no arbitrary SQL).',
  })
  @Post('query')
  async runQuery(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'run analytics query (m32)');
    const result = await this.query.runQuery(s.ctx, s.actor.identityId, {
      metricKey: requireString(b['metricKey'], 'metricKey', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...(Array.isArray(b['groupBy']) ? { groupBy: b['groupBy'] as string[] } : {}),
      ...(Array.isArray(b['filters']) ? { filters: b['filters'] as MetricQuerySpec['filters'] } : {}),
    });
    return queryView(result);
  }

  @Endpoint({
    permission: M32_PERMISSIONS.datasetManage,
    auditCode: M32_AUDIT_CODES.materialized,
    description: 'Compute a new materialization generation for a published metric.',
  })
  @Post('metrics/:id/materialize')
  async materializeMetric(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'materialize analytics metric (m32)');
    const metricId = requireString(b['metricId'], 'metricId', s.correlationId);
    const out = await this.materialize.materializeMetric(s.ctx, s.actor.identityId, metricId, {
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return out;
  }

  @Endpoint({
    permission: M32_PERMISSIONS.exportCreate,
    auditCode: M32_AUDIT_CODES.exported,
    description: 'Create a governed export (privileged; filter-before-export).',
  })
  @Post('exports')
  async createExport(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create analytics export (m32)');
    const e = await this.exports.createExport(s.ctx, s.actor.identityId, {
      metricKey: requireString(b['metricKey'], 'metricKey', s.correlationId),
      format: requireString(b['format'], 'format', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...(Array.isArray(b['filters']) ? { filters: b['filters'] as MetricQuerySpec['filters'] } : {}),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return exportView(e);
  }

  @Endpoint({
    permission: M32_PERMISSIONS.scheduleManage,
    auditCode: M32_AUDIT_CODES.scheduleChanged,
    description: 'Bind a report to a schedule (opaque m06 timer + m08 notify refs).',
  })
  @Post('schedules')
  async setSchedule(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'set analytics schedule (m32)');
    const sched = await this.schedules.setSchedule(s.ctx, s.actor.identityId, {
      reportId: requireString(b['reportId'], 'reportId', s.correlationId),
      scheduleSpec: requireString(b['scheduleSpec'], 'scheduleSpec', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['scheduleKind'], 'scheduleKind'),
      ...optStr(b['timerRef'], 'timerRef'),
      ...optStr(b['notifyRef'], 'notifyRef'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return scheduleView(sched);
  }
}
