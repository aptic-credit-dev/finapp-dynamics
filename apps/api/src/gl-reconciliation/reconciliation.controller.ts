import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ReconciliationService, M20_AUDIT_CODES, M20_PERMISSIONS } from '@finapp/m20-glrecon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { runView, candidateView, runBalanceView, statusHistoryView, runSummaryView } from './views.ts';

/**
 * The GL-reconciliation RUN lifecycle + the balance invariant + the deterministic matching ORCHESTRATION, under
 * `/api/v1/gl-reconciliation`. A run moves draft → running → review_required → completed (reopened). Executing a run
 * computes the balance invariant (opening + debits − credits = calculated closing) and matches GL lines against
 * source lines via the reused m15a engine. A run CANNOT complete while a REQUIRED exception is open (fail closed).
 * Balances are INTEGER MINOR UNITS carried as STRINGS out (ADR-007). Permission enforced in-service (default deny).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('gl-reconciliation')
export class GlreconRunController {
  private readonly service: ReconciliationService;
  private readonly actors: ActorContextFactory;
  constructor(service: ReconciliationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M20_PERMISSIONS.runCreate,
    auditCode: M20_AUDIT_CODES.runCreated,
    description: 'Create a GL reconciliation run.',
  })
  @Post('runs')
  async createRun(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create run (m20)');
    return runView(
      await this.service.createRun(s.ctx, s.actor.identityId, {
        glAccountId: requireString(b['glAccountId'], 'glAccountId', s.correlationId),
        ...optStr(b['rulesetId'], 'rulesetId'),
        ...optStr(b['periodStart'], 'periodStart'),
        ...optStr(b['periodEnd'], 'periodEnd'),
        // Opening/closing balances are INTEGER MINOR UNITS (numbers in); never a float (ADR-007).
        ...optNum(b['openingBalanceMinor'], 'openingBalanceMinor'),
        ...optNum(b['closingBalanceMinor'], 'closingBalanceMinor'),
      }),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.runExecute,
    auditCode: M20_AUDIT_CODES.runStarted,
    description: 'Execute a run: balance invariant + deterministic matching (running -> review_required).',
  })
  @Post('runs/:id/execute')
  async execute(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'execute run (m20)');
    return runView(
      await this.service.executeRun(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.runExecute,
    auditCode: M20_AUDIT_CODES.runCompleted,
    description: 'Complete a GL reconciliation run (fails if a required exception is open).',
  })
  @Post('runs/:id/complete')
  async complete(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete run (m20)');
    return runView(
      await this.service.complete(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.runReopen,
    auditCode: M20_AUDIT_CODES.runReopened,
    description: 'Reopen a completed GL reconciliation run.',
  })
  @Post('runs/:id/reopen')
  async reopen(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reopen run (m20)');
    return runView(
      await this.service.reopen(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('runs')
  async listRuns(
    @Headers() h: Record<string, string>,
    @Query('glAccountId') glAccountId?: string,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list runs (m20)');
    const rows = await this.service.listRuns(s.ctx, {
      ...optStr(glAccountId, 'glAccountId'),
      ...optStr(status, 'status'),
    });
    return { runs: rows.map(runView) };
  }
  @Get('runs/:id')
  async getRun(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get run (m20)');
    return runView(await this.service.getRun(s.ctx, id));
  }
  @Get('runs/:id/candidates')
  async listCandidates(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list candidates (m20)');
    return { candidates: (await this.service.listCandidates(s.ctx, id)).map(candidateView) };
  }
  @Get('runs/:id/balances')
  async listRunBalances(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list run balances (m20)');
    return { balances: (await this.service.listRunBalances(s.ctx, id)).map(runBalanceView) };
  }
  @Get('runs/:id/history')
  async listStatusHistory(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list run history (m20)');
    return { history: (await this.service.listStatusHistory(s.ctx, id)).map(statusHistoryView) };
  }
  @Get('runs/:id/summaries')
  async listSummaries(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list run summaries (m20)');
    return { summaries: (await this.service.listSummaries(s.ctx, id)).map(runSummaryView) };
  }
}
