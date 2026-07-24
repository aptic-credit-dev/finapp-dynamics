/**
 * SlaService — schedules SLA clocks + warn/breach timers when a task is created, and fires them (ADR-025).
 * Deadlines are BUSINESS-time (calendar.ts). Warn and breach each emit EXACTLY ONCE: the timer's UNIQUE
 * dedupe_key stops duplicate scheduling and `fireTimer` / `markSlaFlag` are single-winner guards, so a
 * re-delivered or duplicate timer firing is a no-op. Emissions go through the same AUDIT + OUTBOX ports.
 */
import type { Db, RequestContext, Tx } from '@finapp/kernel';
import { M06_AUDIT_CODES } from './audit-codes.ts';
import { businessDeadline } from './domain/calendar.ts';
import type { WorkflowDefinitionSpec } from './domain/definition.ts';
import { WorkflowRepository } from './repository.ts';
import type { M06Emitter } from './emit.ts';

export class SlaService {
  private readonly db: Db;
  private readonly emitter: M06Emitter;
  private readonly repo: WorkflowRepository;

  constructor(db: Db, emitter: M06Emitter, repo: WorkflowRepository = new WorkflowRepository()) {
    this.db = db;
    this.emitter = emitter;
    this.repo = repo;
  }

  /** Called from the drive when a task node carries an SLA definition — starts a clock + warn/breach timers. */
  async scheduleForNode(
    tx: Tx,
    ctx: RequestContext,
    input: { instanceId: string; taskId: string; nodeKey: string; spec: WorkflowDefinitionSpec; now: Date },
  ): Promise<void> {
    const slaDef = input.spec.sla?.find((s) => s.nodeKey === input.nodeKey);
    if (slaDef === undefined) return;
    const warnPct = slaDef.warnPct ?? 80;
    const warnAt = businessDeadline(input.now, (slaDef.targetSeconds * warnPct) / 100);
    const breachAt = businessDeadline(input.now, slaDef.targetSeconds);
    const clockId = await this.repo.insertSlaClock(tx, {
      tenantId: ctx.tenantId,
      instanceId: input.instanceId,
      taskId: input.taskId,
      slaType: slaDef.slaType,
      warnAt,
      breachAt,
    });
    await this.repo.insertTimer(tx, {
      tenantId: ctx.tenantId,
      instanceId: input.instanceId,
      nodeKey: input.nodeKey,
      kind: 'sla_warn',
      fireAt: warnAt,
      dedupeKey: `sla_warn:${input.taskId}`,
    });
    await this.repo.insertTimer(tx, {
      tenantId: ctx.tenantId,
      instanceId: input.instanceId,
      nodeKey: input.nodeKey,
      kind: 'sla_breach',
      fireAt: breachAt,
      dedupeKey: `sla_breach:${input.taskId}`,
    });
    await this.emitter.recordAudit(tx, ctx, {
      code: M06_AUDIT_CODES.timerScheduled,
      entityType: 'workflow_sla_clock',
      entityId: clockId,
      detail: { slaType: slaDef.slaType },
    });
  }

  /** Fire a scheduled SLA timer (dispatcher-invoked). Emits warn/breach exactly once. */
  async fire(ctx: RequestContext, timerId: string): Promise<'warned' | 'breached' | 'noop'> {
    return this.db.withTenant(ctx, async (tx) => {
      const timer = await this.repo.findTimer(tx, timerId);
      if (timer?.status !== 'scheduled') return 'noop';
      if (timer.kind !== 'sla_warn' && timer.kind !== 'sla_breach') {
        await this.repo.fireTimer(tx, timerId, timer.version);
        return 'noop';
      }
      if (!(await this.repo.fireTimer(tx, timerId, timer.version))) return 'noop';

      const clockRow = await tx.query<{ id: string; task_id: string | null; version: number }>(
        `SELECT id, task_id, version FROM workflow_sla_clock WHERE instance_id = $1 ORDER BY started_at DESC LIMIT 1`,
        [timer.instance_id],
      );
      const clock = clockRow.rows[0];
      if (clock === undefined) return 'noop';

      if (timer.kind === 'sla_warn') {
        if (!(await this.repo.markSlaFlag(tx, clock.id, clock.version, 'warned'))) return 'noop';
        await this.emitter.recordAudit(tx, ctx, {
          code: M06_AUDIT_CODES.slaWarning,
          entityType: 'workflow_sla_clock',
          entityId: clock.id,
        });
        await this.emitter.publish(tx, {
          type: 'WorkflowSlaWarning',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          payload: {
            instanceId: timer.instance_id,
            ...(clock.task_id !== null ? { taskId: clock.task_id } : {}),
            slaType: 'response',
            threshold: 'warning',
          },
        });
        return 'warned';
      }
      if (!(await this.repo.markSlaFlag(tx, clock.id, clock.version, 'breached'))) return 'noop';
      await this.emitter.recordAudit(tx, ctx, {
        code: M06_AUDIT_CODES.slaBreached,
        entityType: 'workflow_sla_clock',
        entityId: clock.id,
        reason: 'SLA target exceeded',
      });
      await this.emitter.publish(tx, {
        type: 'WorkflowSlaBreached',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        payload: {
          instanceId: timer.instance_id,
          ...(clock.task_id !== null ? { taskId: clock.task_id } : {}),
          slaType: 'response',
          threshold: 'breach',
        },
      });
      return 'breached';
    });
  }
}
