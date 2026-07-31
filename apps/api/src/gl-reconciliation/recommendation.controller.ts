import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { RecommendationService, M20_AUDIT_CODES, M20_PERMISSIONS } from '@finapp/m20-glrecon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { recommendationView } from './views.ts';

/**
 * DRAFT journal recommendations, under `/api/v1/gl-reconciliation`. m20 recommends a debit/credit correction for a
 * reconciling item or exception and hands it off to m21; it NEVER posts a journal, alters a ledger balance, or
 * approves anything (is_draft is always true). Permission enforced in-service (default deny); read routes carry no
 * `@Endpoint`. Amounts are INTEGER MINOR UNITS — numbers in, strings out; never a float (ADR-007).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('gl-reconciliation')
export class GlreconRecommendationController {
  private readonly service: RecommendationService;
  private readonly actors: ActorContextFactory;
  constructor(service: RecommendationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M20_PERMISSIONS.recommendationCreate,
    auditCode: M20_AUDIT_CODES.recommendationCreated,
    description: 'Create a DRAFT journal recommendation (never posts).',
  })
  @Post('recommendations')
  async create(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create recommendation (m20)');
    return recommendationView(
      await this.service.createRecommendation(s.ctx, s.actor.identityId, {
        runId: requireString(b['runId'], 'runId', s.correlationId),
        ...optStr(b['exceptionId'], 'exceptionId'),
        ...optStr(b['reconcilingItemId'], 'reconcilingItemId'),
        ...optStr(b['debitAccountRef'], 'debitAccountRef'),
        ...optStr(b['creditAccountRef'], 'creditAccountRef'),
        amountMinor: typeof b['amountMinor'] === 'number' ? b['amountMinor'] : Number.NaN,
        ...optStr(b['currencyRef'], 'currencyRef'),
        ...optStr(b['description'], 'description'),
        ...optStr(b['reasonCode'], 'reasonCode'),
        ...optStr(b['confidenceBand'], 'confidenceBand'),
      }),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.recommendationWithdraw,
    auditCode: M20_AUDIT_CODES.recommendationWithdrawn,
    description: 'Withdraw a draft recommendation.',
  })
  @Post('recommendations/:id/withdraw')
  async withdraw(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'withdraw recommendation (m20)');
    return recommendationView(
      await this.service.withdrawRecommendation(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.recommendationCreate,
    auditCode: M20_AUDIT_CODES.recommendationHandedOff,
    description: 'Hand a draft recommendation off to the journal engine (m21). m20 never posts.',
  })
  @Post('recommendations/:id/handoff')
  async handoff(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'handoff recommendation (m20)');
    return recommendationView(
      await this.service.handOffRecommendation(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        typeof b['handoffRef'] === 'string' ? b['handoffRef'] : null,
      ),
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('runs/:id/recommendations')
  async listByRun(
    @Param('id') id: string,
    @Headers() h: Record<string, string>,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list recommendations (m20)');
    return {
      recommendations: (await this.service.listRecommendations(s.ctx, id, status)).map(recommendationView),
    };
  }
  @Get('recommendations/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get recommendation (m20)');
    return recommendationView(await this.service.getRecommendation(s.ctx, id));
  }
}
