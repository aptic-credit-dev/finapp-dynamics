import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ReconciliationService, M15_AUDIT_CODES, M15_PERMISSIONS } from '@finapp/m15-recon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { runView, candidateView, statusHistoryView, runSummaryView } from './views.ts';

/**
 * The reconciliation RUN lifecycle + the deterministic matching ORCHESTRATION, under `/api/v1/reconciliation`. A run
 * moves draft → matching → review → completed (reopened) through the single choke point `checkRunTransition`;
 * matching calls the PURE m15a engine, records append-only explainable candidate evidence, auto-proposes exact/strong
 * matches and raises an exception otherwise. A run CANNOT complete while a REQUIRED exception is open (fail closed).
 * Opening/closing balances are INTEGER MINOR UNITS carried as STRINGS out (ADR-007), never a float. Permission
 * enforced in ReconciliationService (default deny). Read (GET) routes carry no `@Endpoint` — enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('reconciliation')
export class ReconciliationRunController {
  private readonly service: ReconciliationService;
  private readonly actors: ActorContextFactory;
  constructor(service: ReconciliationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- run lifecycle ----------------------------------------------------------------------------
  @Endpoint({
    permission: M15_PERMISSIONS.runCreate,
    auditCode: M15_AUDIT_CODES.runCreated,
    description: 'Create a reconciliation run.',
  })
  @Post('runs')
  async createRun(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create run (m15)');
    return runView(
      await this.service.createRun(s.ctx, s.actor.identityId, {
        bankAccountId: requireString(b['bankAccountId'], 'bankAccountId', s.correlationId),
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
    permission: M15_PERMISSIONS.matchRun,
    auditCode: M15_AUDIT_CODES.runMatchingStarted,
    description: 'Run deterministic matching for a run (matching -> review).',
  })
  @Post('runs/:id/run-matching')
  async runMatching(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'run matching (m15)');
    return runView(
      await this.service.runMatching(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M15_PERMISSIONS.runComplete,
    auditCode: M15_AUDIT_CODES.runCompleted,
    description: 'Complete a reconciliation run (fails if a required exception is open).',
  })
  @Post('runs/:id/complete')
  async complete(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'complete run (m15)');
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
    permission: M15_PERMISSIONS.runReopen,
    auditCode: M15_AUDIT_CODES.runReopened,
    description: 'Reopen a completed reconciliation run.',
  })
  @Post('runs/:id/reopen')
  async reopen(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reopen run (m15)');
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
    @Query('bankAccountId') bankAccountId?: string,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list runs (m15)');
    const rows = await this.service.listRuns(s.ctx, {
      ...optStr(bankAccountId, 'bankAccountId'),
      ...optStr(status, 'status'),
    });
    return { runs: rows.map(runView) };
  }
  @Get('runs/:id')
  async getRun(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get run (m15)');
    return runView(await this.service.getRun(s.ctx, id));
  }
  @Get('runs/:id/candidates')
  async listCandidates(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list candidates (m15)');
    return { candidates: (await this.service.listCandidates(s.ctx, id)).map(candidateView) };
  }
  @Get('runs/:id/history')
  async listStatusHistory(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list run status history (m15)');
    return { history: (await this.service.listStatusHistory(s.ctx, id)).map(statusHistoryView) };
  }
  @Get('runs/:id/summaries')
  async listSummaries(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list run summaries (m15)');
    return { summaries: (await this.service.listSummaries(s.ctx, id)).map(runSummaryView) };
  }
}
