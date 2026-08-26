import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M32Emitter,
  AnalyticsRepository,
  AnalyticsDatasetService,
  AnalyticsMetricService,
  AnalyticsQueryService,
  AnalyticsMaterializationService,
  AnalyticsExportService,
  AnalyticsScheduleService,
  AnalyticsReportService,
  M32ExecutiveAnalyticsAdapter,
  FixtureMaterializationSource,
  M32_PERMISSIONS,
} from '../src/index.ts';

/**
 * M32 services DB spec — proves the governed analytics pipeline END TO END on a REAL PostgreSQL: define a semantic
 * dataset + metric; validate + PUBLISH under maker-checker (self-approval + AI-approval + default-deny refused);
 * MATERIALIZE a rebuildable, money-safe, lineage-bearing snapshot through the source port; run the GOVERNED semantic
 * query (entitlement-gated — a caller lacking the entitlement is refused; an unknown/unsafe dimension fails closed, no
 * arbitrary SQL); EXPORT (privileged, filter-before-export); and serve the M28 ExecutiveAnalyticsPort (entitlement-
 * filtered, citation-bearing, no values).
 */
export default defineDbSpec('m32-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M32Emitter(audit, outbox);
  const repo = new AnalyticsRepository();
  const datasets = new AnalyticsDatasetService(db, authz, emitter, repo);
  const metrics = new AnalyticsMetricService(db, authz, emitter, repo);
  const reports = new AnalyticsReportService(db, authz, emitter, repo);
  const query = new AnalyticsQueryService(db, authz, emitter, repo);
  const source = new FixtureMaterializationSource(() => [
    { dimensionKey: 'region', dimensionValue: 'EU', valueMinor: null, valueNumeric: null, count: '42' },
    { dimensionKey: 'region', dimensionValue: 'US', valueMinor: null, valueNumeric: null, count: '17' },
  ]);
  const materialize = new AnalyticsMaterializationService(db, authz, emitter, source, repo);
  const exports = new AnalyticsExportService(db, authz, emitter, query, repo);
  const schedules = new AnalyticsScheduleService(db, authz, emitter, repo);
  const adapter = new M32ExecutiveAnalyticsAdapter(query);

  const tenant = randomUUID();
  const userR = randomUUID();
  const userA = randomUUID();
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const authorCtx = ctxOf(userR, [
    M32_PERMISSIONS.datasetManage,
    M32_PERMISSIONS.metricAuthor,
    M32_PERMISSIONS.metricRead,
    M32_PERMISSIONS.reportAuthor,
    M32_PERMISSIONS.reportPublish,
    M32_PERMISSIONS.scheduleManage,
  ]);
  const approverCtx = ctxOf(userA, [M32_PERMISSIONS.metricPublish, M32_PERMISSIONS.metricRead]);
  const analystCtx = ctxOf(userR, [
    M32_PERMISSIONS.queryRun,
    M32_PERMISSIONS.metricRead,
    M32_PERMISSIONS.exportCreate,
  ]);

  // --- dataset + metric -------------------------------------------------------------------------
  const dataset = await datasets.defineDataset(authorCtx, userR, {
    sourceModule: 'm19-finance',
    datasetKey: 'finance_ds',
    name: 'Finance dataset',
    dimensions: [{ key: 'region' }, { key: 'status' }],
    measures: [{ key: 'id' }, { key: 'amount' }],
  });
  t.equal(dataset.status, 'active', 'a dataset is defined active');

  const metric = await metrics.defineMetric(authorCtx, userR, {
    datasetId: dataset.id,
    metricKey: 'txn_count',
    name: 'Txn count',
    aggregation: 'count',
    measureKey: 'id',
    dimensions: ['region'],
  });
  t.equal(metric.state, 'draft', 'a metric starts draft');
  const vr = await metrics.validateMetric(authorCtx, userR, metric.id, metric.version);
  t.ok(vr.passed, 'a valid metric passes validation');
  const validated = await metrics.getMetric(authorCtx, metric.id);
  t.equal(validated?.state, 'validated', 'a passing validation moves the metric to validated');
  const reviewed = await metrics.requestReview(authorCtx, userR, metric.id, validated?.version ?? 0);
  t.equal(reviewed.state, 'review_pending', 'a validated metric can be sent for review');

  // --- maker-checker refusals -------------------------------------------------------------------
  const selfCtx = ctxOf(userR, [M32_PERMISSIONS.metricPublish, M32_PERMISSIONS.metricRead]);
  await t.rejects(
    metrics.publishMetric(selfCtx, userR, metric.id, reviewed.version),
    'the requester cannot self-approve/publish a metric',
  );
  await t.rejects(
    metrics.publishMetric(approverCtx, 'ai', metric.id, reviewed.version),
    'AI can never approve/publish a metric',
  );
  const noPermCtx = ctxOf(userA, [M32_PERMISSIONS.metricRead]);
  await t.rejects(
    metrics.publishMetric(noPermCtx, userA, metric.id, reviewed.version),
    'default deny — no analytics.metric.publish, refused',
  );

  // --- publish by an independent human approver -------------------------------------------------
  const published = await metrics.publishMetric(approverCtx, userA, metric.id, reviewed.version);
  t.equal(published.state, 'published', 'an independently-approved validated metric publishes');

  // --- materialize a rebuildable, money-safe, lineage-bearing snapshot --------------------------
  const mat = await materialize.materializeMetric(authorCtx, userR, metric.id, {});
  t.ok(
    mat.generation === 1 && mat.rowCount === 2 && mat.lineageId !== '',
    'materialization writes a generation + lineage',
  );

  // --- governed query: entitlement-gated + compiled (no arbitrary SQL) --------------------------
  const result = await query.runQuery(analystCtx, userR, { metricKey: 'txn_count', groupBy: ['region'] });
  t.equal(result.rows.length, 2, 'the governed query returns the materialized aggregate rows');
  t.ok(
    result.rows.every((r) => r.measure !== null && !r.measure.includes('.')),
    'measures are exact integer counts (no float)',
  );
  t.ok(result.lineageId !== '', 'the query result carries lineage');

  // no arbitrary SQL — an unknown/injection dimension fails closed
  await t.rejects(
    query.runQuery(analystCtx, userR, {
      metricKey: 'txn_count',
      groupBy: ['region; DROP TABLE analytics_metric'],
    }),
    'an unknown/injection group-by dimension is refused (no arbitrary SQL)',
  );

  // entitlement: a caller lacking the read entitlement gets NO aggregate (aggregation grants no access)
  const unentitledCtx = ctxOf(userR, [M32_PERMISSIONS.queryRun]);
  await t.rejects(
    query.runQuery(unentitledCtx, userR, { metricKey: 'txn_count' }),
    'a caller missing the read entitlement is refused (aggregation grants no access)',
  );

  // --- export: privileged + filter-before-export ------------------------------------------------
  const exp = await exports.createExport(analystCtx, userR, { metricKey: 'txn_count', format: 'csv' });
  t.ok(
    exp.status === 'completed' && exp.row_count === 2,
    'an entitled export completes with the filtered row count',
  );
  t.ok(
    (exp.storage_ref ?? '').startsWith('docref:'),
    'export bytes live behind an opaque m09 document reference (never in m32)',
  );
  const noExportCtx = ctxOf(userR, [M32_PERMISSIONS.queryRun, M32_PERMISSIONS.metricRead]);
  await t.rejects(
    exports.createExport(noExportCtx, userR, { metricKey: 'txn_count', format: 'csv' }),
    'default deny — no analytics.export.create, refused',
  );

  // --- M28 ExecutiveAnalyticsPort: entitlement-filtered, citation-bearing, no values ------------
  const evidence = await adapter.queryAggregates(analystCtx, { scopeLevel: 'tenant', maxSources: 10 });
  t.ok(evidence.length >= 1, 'the M28 analytics port returns evidence for an entitled caller');
  const item = evidence[0];
  t.ok(
    item?.citation.sourceModule === 'm32-analytics' && item.citation.recordRef === metric.id,
    'evidence is citation-bearing (opaque metric ref)',
  );
  t.ok(
    item !== undefined && !/\d+\s*(?:USD|EUR)/.test(item.headline),
    'the evidence headline carries no monetary value',
  );
  const maskedCtx = ctxOf(userR, []);
  const masked = await adapter.queryAggregates(maskedCtx, { scopeLevel: 'tenant', maxSources: 10 });
  t.equal(masked.length, 0, 'an unentitled caller sees NO analytics evidence (masked, never counted)');

  // --- schedule: opaque m06 timer + m08 notify refs (no engine) ---------------------------------
  const report = await reports.defineReport(authorCtx, userR, {
    reportKey: 'exec_dash',
    name: 'Exec dashboard',
    kind: 'dashboard',
    spec: {},
  });
  const schedule = await schedules.setSchedule(authorCtx, userR, {
    reportId: report.id,
    scheduleSpec: 'every 1 day',
    timerRef: 'timerref:m06/abc',
    notifyRef: 'notifyref:m08/def',
  });
  t.ok(
    schedule.timer_ref === 'timerref:m06/abc' && schedule.notify_ref === 'notifyref:m08/def',
    'a schedule holds opaque m06 timer + m08 notify references (m32 owns no engine)',
  );

  // --- read-model list methods for the reporting workspace (permission-gated, default-deny) -------
  const readerCtx = ctxOf(userR, [
    M32_PERMISSIONS.datasetRead,
    M32_PERMISSIONS.metricRead,
    M32_PERMISSIONS.reportRead,
  ]);
  t.ok(
    (await datasets.listDatasets(readerCtx, {})).some((d) => d.id === dataset.id),
    'listDatasets returns the defined dataset',
  );
  t.ok(
    (await metrics.listMetrics(readerCtx, dataset.id, {})).some((m) => m.id === metric.id),
    'listMetrics(byDataset) returns the metric',
  );
  t.ok(
    (await metrics.listPublishedMetrics(readerCtx)).some((m) => m.id === metric.id),
    'listPublishedMetrics returns the published metric',
  );
  t.ok(
    (await reports.listReports(readerCtx, {})).some((r) => r.id === report.id),
    'listReports returns the defined report',
  );
  let deniedList = false;
  try {
    await reports.listReports(ctxOf(userA, []), {});
  } catch {
    deniedList = true;
  }
  t.ok(deniedList, 'listReports default-denies a caller without analytics.report.read');
});
