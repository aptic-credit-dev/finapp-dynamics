import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CalendarService, M19_AUDIT_CODES, M19_PERMISSIONS } from '@finapp/m19-finance';
import { ActorContextFactory } from '@finapp/m02-identity';
import { badRequest, requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { fiscalYearView, fiscalPeriodView, periodHistoryView } from './views.ts';

/**
 * The fiscal calendar — fiscal years (open <-> closed via `checkFiscalYearTransition`) and the accounting periods
 * within them (open → closed <-> reopen; open/closed → locked, sealed) through the ONE choke point
 * `checkPeriodTransition`, under `/api/v1/finance`. Period close/lock is the CROSS-MODULE gate downstream journal
 * posting (m21) honours — m19 never posts, and no monetary amounts appear anywhere (ADR-007). Permission enforced
 * in CalendarService (default deny). Read (GET) routes carry no `@Endpoint` — read permission enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function requireNumber(value: unknown, field: string, correlationId: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw badRequest(`${field} is required and must be a number.`, correlationId);
  }
  return value;
}

@Controller('finance')
export class FinanceCalendarController {
  private readonly service: CalendarService;
  private readonly actors: ActorContextFactory;
  constructor(service: CalendarService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- fiscal year ------------------------------------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.fiscalYearManage,
    auditCode: M19_AUDIT_CODES.fiscalYearCreated,
    description: 'Create a fiscal year.',
  })
  @Post('fiscal-years')
  async createFiscalYear(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create fiscal year (m19)');
    return fiscalYearView(
      await this.service.createFiscalYear(s.ctx, s.actor.identityId, {
        entityId: requireString(b['entityId'], 'entityId', s.correlationId),
        code: requireString(b['code'], 'code', s.correlationId),
        startDate: requireString(b['startDate'], 'startDate', s.correlationId),
        endDate: requireString(b['endDate'], 'endDate', s.correlationId),
        ...optStr(b['name'], 'name'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.fiscalYearClose,
    auditCode: M19_AUDIT_CODES.fiscalYearClosed,
    description: 'Close a fiscal year.',
  })
  @Post('fiscal-years/:id/close')
  async closeFiscalYear(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'close fiscal year (m19)');
    return fiscalYearView(
      await this.service.closeFiscalYear(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.fiscalYearReopen,
    auditCode: M19_AUDIT_CODES.fiscalYearReopened,
    description: 'Reopen a closed fiscal year.',
  })
  @Post('fiscal-years/:id/reopen')
  async reopenFiscalYear(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reopen fiscal year (m19)');
    return fiscalYearView(
      await this.service.reopenFiscalYear(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('fiscal-years')
  async listFiscalYears(@Headers() h: Record<string, string>, @Query('entityId') entityId?: string) {
    const s = await this.scoped(h, 'list fiscal years (m19)');
    const rows = await this.service.listFiscalYears(
      s.ctx,
      requireString(entityId, 'entityId', s.correlationId),
    );
    return { fiscalYears: rows.map(fiscalYearView) };
  }

  // --- accounting period (postability gate) -----------------------------------------------------
  @Endpoint({
    permission: M19_PERMISSIONS.periodOpen,
    auditCode: M19_AUDIT_CODES.periodOpened,
    description: 'Open an accounting period within a fiscal year.',
  })
  @Post('fiscal-years/:id/periods')
  async createPeriod(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'open period (m19)');
    return fiscalPeriodView(
      await this.service.createPeriod(s.ctx, s.actor.identityId, id, {
        periodNumber: requireNumber(b['periodNumber'], 'periodNumber', s.correlationId),
        startDate: requireString(b['startDate'], 'startDate', s.correlationId),
        endDate: requireString(b['endDate'], 'endDate', s.correlationId),
        ...optStr(b['name'], 'name'),
      }),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.periodClose,
    auditCode: M19_AUDIT_CODES.periodClosed,
    description: 'Close an accounting period.',
  })
  @Post('periods/:id/close')
  async closePeriod(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'close period (m19)');
    return fiscalPeriodView(
      await this.service.closePeriod(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.periodLock,
    auditCode: M19_AUDIT_CODES.periodLocked,
    description: 'Lock an accounting period (sealed).',
  })
  @Post('periods/:id/lock')
  async lockPeriod(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'lock period (m19)');
    return fiscalPeriodView(
      await this.service.lockPeriod(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M19_PERMISSIONS.periodReopen,
    auditCode: M19_AUDIT_CODES.periodReopened,
    description: 'Reopen a closed accounting period.',
  })
  @Post('periods/:id/reopen')
  async reopenPeriod(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reopen period (m19)');
    return fiscalPeriodView(
      await this.service.reopenPeriod(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('periods/:id')
  async getPeriod(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get period (m19)');
    return fiscalPeriodView(await this.service.getPeriod(s.ctx, id));
  }
  @Get('fiscal-years/:id/periods')
  async listPeriods(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list periods (m19)');
    return { periods: (await this.service.listPeriods(s.ctx, id)).map(fiscalPeriodView) };
  }
  @Get('periods/:id/history')
  async listPeriodHistory(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list period history (m19)');
    return { history: (await this.service.listPeriodHistory(s.ctx, id)).map(periodHistoryView) };
  }
}
