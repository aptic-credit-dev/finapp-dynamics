import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { RecommendationService, M21_AUDIT_CODES, M21_PERMISSIONS } from '@finapp/m21-journal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { recommendationView, recommendationLineView, draftView } from './views.ts';

/**
 * Journal recommendation intake — ingest DRAFT recommendations (from the m20 handoff, AI or operations), accept /
 * dismiss them, and convert an accepted one into a draft journal — under `/api/v1/journals`. Intake is idempotent per
 * m20 handoff_ref. m21 copies under its own controls; it never reads m20/m19 tables (opaque refs). It NEVER posts or
 * approves. Amounts are INTEGER MINOR UNITS — numbers in, strings out; never a float (ADR-007).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number.NaN;
}
function parseLegs(v: unknown): {
  accountRef?: string | null;
  direction: string;
  amountMinor: number;
  currencyRef?: string | null;
  description?: string | null;
}[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      accountRef: typeof o['accountRef'] === 'string' ? o['accountRef'] : null,
      direction: typeof o['direction'] === 'string' ? o['direction'] : '',
      amountMinor: num(o['amountMinor']),
      currencyRef: typeof o['currencyRef'] === 'string' ? o['currencyRef'] : null,
      description: typeof o['description'] === 'string' ? o['description'] : null,
    };
  });
}

@Controller('journals')
export class JournalRecommendationController {
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
    permission: M21_PERMISSIONS.recommendationIngest,
    auditCode: M21_AUDIT_CODES.recommendationIngested,
    description: 'Ingest a DRAFT journal recommendation.',
  })
  @Post('recommendations')
  async ingest(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'ingest recommendation (m21)');
    return recommendationView(
      await this.service.ingestRecommendation(s.ctx, s.actor.identityId, {
        ...optStr(b['sourceType'], 'sourceType'),
        ...optStr(b['sourceRef'], 'sourceRef'),
        ...optStr(b['handoffRef'], 'handoffRef'),
        ...optStr(b['entityRef'], 'entityRef'),
        ...optStr(b['currencyRef'], 'currencyRef'),
        amountMinor: num(b['amountMinor']),
        ...optStr(b['description'], 'description'),
        ...optStr(b['reasonCode'], 'reasonCode'),
        ...optStr(b['confidenceBand'], 'confidenceBand'),
        lines: parseLegs(b['lines']),
      }),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.recommendationManage,
    auditCode: M21_AUDIT_CODES.recommendationAccepted,
    description: 'Accept a draft journal recommendation.',
  })
  @Post('recommendations/:id/accept')
  async accept(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'accept recommendation (m21)');
    return recommendationView(
      await this.service.acceptRecommendation(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.recommendationManage,
    auditCode: M21_AUDIT_CODES.recommendationDismissed,
    description: 'Dismiss a draft journal recommendation.',
  })
  @Post('recommendations/:id/dismiss')
  async dismiss(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'dismiss recommendation (m21)');
    return recommendationView(
      await this.service.dismissRecommendation(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.recommendationManage,
    auditCode: M21_AUDIT_CODES.recommendationConverted,
    description: 'Convert an accepted recommendation into a draft journal.',
  })
  @Post('recommendations/:id/convert')
  async convert(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'convert recommendation (m21)');
    const out = await this.service.convertRecommendation(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
      {
        ...optStr(b['journalTypeId'], 'journalTypeId'),
        ...optStr(b['periodRef'], 'periodRef'),
        ...optStr(b['periodStatus'], 'periodStatus'),
        ...optStr(b['journalDate'], 'journalDate'),
        ...optStr(b['reference'], 'reference'),
        ...optStr(b['description'], 'description'),
      },
    );
    return { recommendation: recommendationView(out.recommendation), draft: draftView(out.draft) };
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('recommendations')
  async list(@Headers() h: Record<string, string>, @Query('status') status?: string) {
    const s = await this.scoped(h, 'list recommendations (m21)');
    return {
      recommendations: (await this.service.listRecommendations(s.ctx, status)).map(recommendationView),
    };
  }
  @Get('recommendations/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get recommendation (m21)');
    const out = await this.service.getRecommendation(s.ctx, id);
    return {
      recommendation: recommendationView(out.recommendation),
      lines: out.lines.map(recommendationLineView),
    };
  }
}
