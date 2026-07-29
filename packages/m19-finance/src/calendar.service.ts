/**
 * CalendarService — the fiscal calendar: fiscal years (open <-> closed via `checkFiscalYearTransition`) and the
 * accounting periods within them (open → closed <-> reopen; open/closed → locked, sealed) through the ONE choke
 * point `checkPeriodTransition`. Every mutating method enforces its permission (default deny), runs inside
 * `db.withTenant`, appends the append-only finance_period_history, records audit + a `finance.lifecycle` event in
 * the SAME transaction, and is optimistic-lock/CAS guarded. Period close/lock is the CROSS-MODULE gate downstream
 * journal posting (m21) honours — `isPeriodPostable` is true only while open, `isPeriodTerminal` while locked — so
 * PeriodOpened / PeriodClosed / PeriodLocked / PeriodReopened are the signals a consumer reads to enforce "no
 * posting into a closed period". m19 never posts a ledger entry; no monetary amounts anywhere (ADR-007).
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { FinanceLifecycleEventType, FinanceLifecyclePayload } from '@finapp/contracts';
import { M19_PERMISSIONS } from './permissions.ts';
import { M19_AUDIT_CODES } from './audit-codes.ts';
import { checkFiscalYearTransition, checkPeriodTransition } from './domain/lifecycles.ts';
import { FINANCE_LIMITS } from './domain/limits.ts';
import {
  FinanceRepository,
  type FiscalYearRow,
  type FiscalPeriodRow,
  type PeriodHistoryRow,
} from './repository.ts';
import type { M19Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export class CalendarService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M19Emitter;
  private readonly repo: FinanceRepository;
  constructor(db: Db, authz: Authz, emitter: M19Emitter, repo: FinanceRepository = new FinanceRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: FinanceLifecycleEventType,
    payload: FinanceLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }
  private async requireFiscalYear(tx: Tx, id: string, correlationId: string): Promise<FiscalYearRow> {
    const fy = await this.repo.findFiscalYear(tx, id);
    if (fy === null) throw ProblemError.notFound('Fiscal year not found.', correlationId);
    return fy;
  }
  private async requirePeriod(tx: Tx, id: string, correlationId: string): Promise<FiscalPeriodRow> {
    const p = await this.repo.findFiscalPeriod(tx, id);
    if (p === null) throw ProblemError.notFound('Accounting period not found.', correlationId);
    return p;
  }

  // --- fiscal year ------------------------------------------------------------------------------
  async createFiscalYear(
    ctx: RequestContext,
    actor: string | null,
    input: { entityId: string; code: string; name?: string | null; startDate: string; endDate: string },
  ): Promise<FiscalYearRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.fiscalYearManage);
    if (input.code.trim() === '' || input.code.length > FINANCE_LIMITS.maxCodeChars)
      throw badRequest('a code is required and must be bounded', ctx.correlationId);
    if (!isoDate.test(input.startDate) || !isoDate.test(input.endDate))
      throw badRequest('start and end dates must be ISO dates (YYYY-MM-DD)', ctx.correlationId);
    if (input.endDate < input.startDate)
      throw badRequest('end date must be on or after start date', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const entity = await this.repo.findEntity(tx, input.entityId);
      if (entity === null) throw ProblemError.notFound('Accounting entity not found.', ctx.correlationId);
      const row = await this.repo.insertFiscalYear(tx, {
        tenantId: ctx.tenantId,
        entityId: input.entityId,
        code: input.code,
        name: input.name ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.fiscalYearCreated,
        entityType: 'finance_fiscal_year',
        entityId: row.id,
        detail: { code: input.code },
      });
      await this.publish(tx, ctx, actor, 'FiscalYearCreated', {
        recordId: row.id,
        recordType: 'fiscal_year',
        entityRef: input.entityId,
        code: input.code,
        fiscalYearRef: row.id,
        toStatus: row.status,
      });
      return row;
    });
  }
  closeFiscalYear(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.moveFiscalYear(ctx, actor, id, 'closed', {
      permission: M19_PERMISSIONS.fiscalYearClose,
      auditCode: M19_AUDIT_CODES.fiscalYearClosed,
      eventType: 'FiscalYearClosed',
      reasonCode: 'closed',
      expectedVersion,
    });
  }
  reopenFiscalYear(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.moveFiscalYear(ctx, actor, id, 'open', {
      permission: M19_PERMISSIONS.fiscalYearReopen,
      auditCode: M19_AUDIT_CODES.fiscalYearReopened,
      eventType: 'FiscalYearReopened',
      reasonCode: 'reopened',
      expectedVersion,
    });
  }
  private async moveFiscalYear(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    to: string,
    opts: {
      permission: string;
      auditCode: string;
      eventType: FinanceLifecycleEventType;
      reasonCode: string;
      expectedVersion: number;
    },
  ): Promise<FiscalYearRow> {
    await this.authz.require(ctx, opts.permission);
    return this.db.withTenant(ctx, async (tx) => {
      const fy = await this.requireFiscalYear(tx, id, ctx.correlationId);
      const check = checkFiscalYearTransition(fy.status, to);
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot move fiscal year ${fy.status} -> ${to}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.transitionFiscalYear(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: to,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Fiscal year modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: opts.auditCode,
        entityType: 'finance_fiscal_year',
        entityId: id,
        detail: { fromStatus: fy.status, toStatus: to },
      });
      await this.publish(tx, ctx, actor, opts.eventType, {
        recordId: id,
        recordType: 'fiscal_year',
        entityRef: fy.entity_id,
        code: fy.code,
        fiscalYearRef: id,
        fromStatus: fy.status,
        toStatus: to,
        reasonCode: opts.reasonCode,
      });
      return upd;
    });
  }
  async listFiscalYears(ctx: RequestContext, entityId: string): Promise<FiscalYearRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.fiscalYearRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listFiscalYears(tx, entityId));
  }

  // --- accounting period (postability gate) -----------------------------------------------------
  async createPeriod(
    ctx: RequestContext,
    actor: string | null,
    fiscalYearId: string,
    input: { periodNumber: number; name?: string | null; startDate: string; endDate: string },
  ): Promise<FiscalPeriodRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.periodOpen);
    if (!Number.isInteger(input.periodNumber) || input.periodNumber < 1 || input.periodNumber > 24)
      throw badRequest('period number must be an integer in 1..24', ctx.correlationId);
    if (!isoDate.test(input.startDate) || !isoDate.test(input.endDate))
      throw badRequest('start and end dates must be ISO dates (YYYY-MM-DD)', ctx.correlationId);
    if (input.endDate < input.startDate)
      throw badRequest('end date must be on or after start date', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const fy = await this.requireFiscalYear(tx, fiscalYearId, ctx.correlationId);
      if (fy.status !== 'open')
        throw ProblemError.conflict('Cannot open a period in a closed fiscal year.', ctx.correlationId);
      // The period's entity is derived from its fiscal year so the two can never disagree.
      const row = await this.repo.insertFiscalPeriod(tx, {
        tenantId: ctx.tenantId,
        entityId: fy.entity_id,
        fiscalYearId,
        periodNumber: input.periodNumber,
        name: input.name ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertPeriodHistory(tx, {
        tenantId: ctx.tenantId,
        periodId: row.id,
        fromStatus: null,
        toStatus: row.status,
        reason: null,
        reasonCode: 'opened',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.periodOpened,
        entityType: 'finance_fiscal_period',
        entityId: row.id,
        detail: { fiscalYearId, periodNumber: input.periodNumber },
      });
      await this.publish(tx, ctx, actor, 'PeriodOpened', {
        recordId: row.id,
        recordType: 'period',
        entityRef: fy.entity_id,
        fiscalYearRef: fiscalYearId,
        periodNumber: input.periodNumber,
        toStatus: row.status,
      });
      return row;
    });
  }
  closePeriod(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.movePeriod(ctx, actor, id, 'closed', {
      permission: M19_PERMISSIONS.periodClose,
      auditCode: M19_AUDIT_CODES.periodClosed,
      eventType: 'PeriodClosed',
      reasonCode: 'closed',
      expectedVersion,
    });
  }
  lockPeriod(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.movePeriod(ctx, actor, id, 'locked', {
      permission: M19_PERMISSIONS.periodLock,
      auditCode: M19_AUDIT_CODES.periodLocked,
      eventType: 'PeriodLocked',
      reasonCode: 'locked',
      expectedVersion,
    });
  }
  reopenPeriod(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.movePeriod(ctx, actor, id, 'open', {
      permission: M19_PERMISSIONS.periodReopen,
      auditCode: M19_AUDIT_CODES.periodReopened,
      eventType: 'PeriodReopened',
      reasonCode: 'reopened',
      expectedVersion,
    });
  }
  private async movePeriod(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    to: string,
    opts: {
      permission: string;
      auditCode: string;
      eventType: FinanceLifecycleEventType;
      reasonCode: string;
      expectedVersion: number;
    },
  ): Promise<FiscalPeriodRow> {
    await this.authz.require(ctx, opts.permission);
    return this.db.withTenant(ctx, async (tx) => {
      const period = await this.requirePeriod(tx, id, ctx.correlationId);
      const check = checkPeriodTransition(period.status, to);
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot move period ${period.status} -> ${to}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.transitionPeriod(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: to,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Period modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertPeriodHistory(tx, {
        tenantId: ctx.tenantId,
        periodId: id,
        fromStatus: period.status,
        toStatus: to,
        reason: null,
        reasonCode: opts.reasonCode,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: opts.auditCode,
        entityType: 'finance_fiscal_period',
        entityId: id,
        detail: { fromStatus: period.status, toStatus: to },
      });
      await this.publish(tx, ctx, actor, opts.eventType, {
        recordId: id,
        recordType: 'period',
        entityRef: period.entity_id,
        fiscalYearRef: period.fiscal_year_id,
        periodNumber: period.period_number,
        fromStatus: period.status,
        toStatus: to,
        reasonCode: opts.reasonCode,
      });
      return upd;
    });
  }
  async getPeriod(ctx: RequestContext, id: string): Promise<FiscalPeriodRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.periodRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findFiscalPeriod(tx, id));
    if (r === null) throw ProblemError.notFound('Accounting period not found.', ctx.correlationId);
    return r;
  }
  async listPeriods(ctx: RequestContext, fiscalYearId: string): Promise<FiscalPeriodRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.periodRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listFiscalPeriods(tx, fiscalYearId));
  }
  async listPeriodHistory(ctx: RequestContext, periodId: string): Promise<PeriodHistoryRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.periodRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPeriodHistory(tx, periodId));
  }
}
