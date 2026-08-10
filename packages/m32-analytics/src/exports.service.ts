/**
 * M32 export + schedule services.
 *  - `AnalyticsExportService.createExport` is a GOVERNED, privileged (analytics.export.create) controlled action:
 *    FILTER-BEFORE-EXPORT (it runs the entitlement-gated governed query FIRST, so a caller can only export rows it is
 *    entitled to and never crosses a tenant boundary — RLS), enforces a BOUNDED row cap, records an entitlement snapshot
 *    + mandatory LINEAGE, stores the bytes behind an OPAQUE m09 document reference (never in m32), and audits the export.
 *  - `AnalyticsScheduleService` owns scheduled-report METADATA ONLY — it holds OPAQUE m06 timer + m08 notify references
 *    and never implements a scheduler/timer/notification engine.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M32_PERMISSIONS } from './permissions.ts';
import { M32_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import { M32_LIMITS, REASON_CODES } from './domain.ts';
import { AnalyticsRepository, type ExportRow, type ScheduleRow } from './repository.ts';
import type { M32Emitter } from './emit.ts';
import type { AnalyticsQueryService } from './query.service.ts';

const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf', 'json'];

export class AnalyticsExportService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M32Emitter;
  private readonly query: AnalyticsQueryService;
  private readonly repo: AnalyticsRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M32Emitter,
    query: AnalyticsQueryService,
    repo: AnalyticsRepository = new AnalyticsRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.query = query;
    this.repo = repo;
  }

  /** Export a published metric. Privileged + filter-before-export + entitlement-gated + bounded + audited + lineage. */
  async createExport(
    ctx: RequestContext,
    actor: string | null,
    input: {
      metricKey: string;
      scope?: string;
      format: string;
      filters?: Parameters<AnalyticsQueryService['runQuery']>[2]['filters'];
      idempotencyKey?: string | null;
    },
  ): Promise<ExportRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.exportCreate);
    if (!EXPORT_FORMATS.includes(input.format)) throw badRequest('unknown export format.', ctx.correlationId);

    // idempotency short-circuit
    const idem = input.idempotencyKey;
    if (idem != null && idem !== '') {
      const existing = await this.db.withTenant(ctx, (tx) => this.repo.findExportByIdempotencyKey(tx, idem));
      if (existing !== null) return existing;
    }

    // FILTER-BEFORE-EXPORT: run the entitlement-gated governed query (throws 403 if the caller is not entitled).
    const result = await this.query.runQuery(ctx, actor, {
      metricKey: input.metricKey,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.filters !== undefined ? { filters: input.filters } : {}),
    });

    if (result.rows.length > M32_LIMITS.maxExportRows) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M32_AUDIT_CODES.publishBlocked,
          entityType: 'analytics_metric',
          entityId: result.metricId,
          detail: { reasonCode: REASON_CODES.exportTooLarge },
        }),
      );
      throw governanceForbidden(REASON_CODES.exportTooLarge, ctx.correlationId);
    }

    return this.db.withTenant(ctx, async (tx) => {
      const created = await this.repo.insertExport(tx, {
        tenantId: ctx.tenantId,
        targetType: 'metric',
        targetId: result.metricId,
        format: input.format,
        classification: result.valueKind === 'minor_amount' ? 'confidential' : 'internal',
        entitlementSnapshot: [M32_PERMISSIONS.metricRead, M32_PERMISSIONS.exportCreate],
        lineageId: result.lineageId,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        await this.repo.insertIdempotency(tx, {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
          targetType: 'export',
          targetId: created.id,
          correlationId: ctx.correlationId,
          by: actor,
        });
      }
      // the bytes live behind an OPAQUE m09 document reference — never persisted in m32.
      const storageRef = `docref:analytics/export/${created.id}`;
      const byteSize = result.rows.reduce(
        (n, r) => n + (r.dimensionValue?.length ?? 0) + (r.measure?.length ?? 0) + 2,
        0,
      );
      const completed = await this.repo.completeExport(tx, created.id, created.version, {
        status: 'completed',
        rowCount: result.rows.length,
        byteSize,
        storageRef,
        lineageId: result.lineageId,
        by: actor,
      });
      if (completed === null) throw versionConflict(ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.exported,
        entityType: 'analytics_export',
        entityId: created.id,
        detail: { metricKey: input.metricKey, format: input.format, rowCount: result.rows.length },
      });
      await this.emitter.publishAnalytics(tx, 'ExportCompleted', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: created.id,
          recordType: 'export',
          key: input.metricKey,
          kind: input.format,
          rowCount: result.rows.length,
          toStatus: 'completed',
          reasonCode: REASON_CODES.exported,
        },
      });
      return completed;
    });
  }
}

export class AnalyticsScheduleService {
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

  /** Bind a report to a schedule. m32 owns NO scheduler/timer/notify engine — timerRef is an opaque m06 timer reference
   * and notifyRef an opaque m08 reference (both created by their canonical owners; m32 stores the binding only). */
  async setSchedule(
    ctx: RequestContext,
    actor: string | null,
    input: {
      reportId: string;
      scope?: string;
      scheduleKind?: string;
      scheduleSpec: string;
      timerRef?: string | null;
      notifyRef?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ScheduleRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.scheduleManage);
    const scope = input.scope ?? 'tenant';
    const scheduleKind = input.scheduleKind ?? 'interval';
    if (scheduleKind !== 'interval' && scheduleKind !== 'cron')
      throw badRequest('unknown schedule kind.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const report = await this.repo.getReport(tx, input.reportId);
      if (report === null) throw badRequest('unknown report.', ctx.correlationId);
      const schedule = await this.repo.insertSchedule(tx, {
        tenantId: ctx.tenantId,
        reportId: input.reportId,
        scope,
        scheduleKind,
        scheduleSpec: input.scheduleSpec,
        timerRef: input.timerRef ?? null,
        notifyRef: input.notifyRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.scheduleChanged,
        entityType: 'analytics_schedule',
        entityId: schedule.id,
        detail: { reportId: input.reportId, scheduleKind },
      });
      await this.emitter.publishAnalytics(tx, 'ScheduleChanged', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: schedule.id,
          recordType: 'schedule',
          toStatus: 'active',
          reasonCode: REASON_CODES.scheduleChanged,
        },
      });
      return schedule;
    });
  }

  async setStatus(
    ctx: RequestContext,
    actor: string | null,
    scheduleId: string,
    expectedVersion: number,
    status: 'active' | 'paused' | 'retired',
  ): Promise<ScheduleRow> {
    await this.authz.require(ctx, M32_PERMISSIONS.scheduleManage);
    return this.db.withTenant(ctx, async (tx) => {
      const current = await tx.query<{ timer_ref: string | null; notify_ref: string | null }>(
        `SELECT timer_ref, notify_ref FROM analytics_schedule WHERE id=$1`,
        [scheduleId],
      );
      const row = current.rows[0];
      if (row === undefined) throw badRequest('unknown schedule.', ctx.correlationId);
      const updated = await this.repo.updateSchedule(tx, scheduleId, expectedVersion, {
        status,
        timerRef: row.timer_ref,
        notifyRef: row.notify_ref,
        by: actor,
      });
      if (updated === null) throw versionConflict(ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M32_AUDIT_CODES.scheduleChanged,
        entityType: 'analytics_schedule',
        entityId: scheduleId,
        detail: { status },
      });
      return updated;
    });
  }
}
