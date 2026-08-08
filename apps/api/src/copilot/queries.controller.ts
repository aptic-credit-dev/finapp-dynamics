import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  CopilotQueryService,
  CopilotResponseService,
  M28_PERMISSIONS,
  M28_AUDIT_CODES,
} from '@finapp/m28-executive-ai';
import { ActorContextFactory } from '@finapp/m02-identity';
import { optionalLimit, optionalOffset, requireString, requireTenantScope } from '../identity/http.ts';
import { queryView, responseView, citationView } from './views.ts';

/**
 * Executive-copilot QUERIES under `/api/v1/copilot`. Submitting a query is READ-ONLY assistance: the service screens
 * the read-only/command gate + prompt-injection gate (a mutating/controlled or jailbreak intent is durably REFUSED),
 * masks cross-domain evidence to the caller's entitlements and returns a CITED response (or a review-required one when
 * it cannot be cited). Platform/sensitive queries need their own privileged permission (default deny, in-service).
 * Reads carry no `@Endpoint`; export is privileged + audited.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' && Number.isFinite(v) ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('copilot')
export class CopilotQueriesController {
  private readonly queries: CopilotQueryService;
  private readonly responses: CopilotResponseService;
  private readonly actors: ActorContextFactory;
  constructor(queries: CopilotQueryService, responses: CopilotResponseService, actors: ActorContextFactory) {
    this.queries = queries;
    this.responses = responses;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M28_PERMISSIONS.copilotQuery,
    auditCode: M28_AUDIT_CODES.querySubmitted,
    description: 'Submit a read-only executive question; returns a cited (or review-required) answer.',
  })
  @Post('queries')
  async submitQuery(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'submit copilot query (m28)');
    const idem = h['idempotency-key'];
    const r = await this.queries.submitQuery(s.ctx, s.actor.identityId, {
      sessionId: requireString(b['sessionId'], 'sessionId', s.correlationId),
      question: requireString(b['question'], 'question', s.correlationId),
      ...optStr(b['intentClass'], 'intentClass'),
      ...optStr(b['classification'], 'classification'),
      ...optStr(b['scopeLevel'], 'scopeLevel'),
      ...optStr(b['questionRef'], 'questionRef'),
      ...optStr(b['providerId'], 'providerId'),
      ...optStr(b['modelId'], 'modelId'),
      ...optStr(b['promptId'], 'promptId'),
      ...optNum(b['maxSources'], 'maxSources'),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return { query: queryView(r.query), response: r.response === null ? null : responseView(r.response) };
  }

  @Get('queries')
  async listQueries(
    @Headers() h: Record<string, string>,
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const s = await this.scoped(h, 'list copilot queries (m28)');
    const rows = await this.queries.listQueries(s.ctx, sessionId ?? null, {
      ...optionalLimit(limit, s.correlationId),
      ...optionalOffset(offset, s.correlationId),
    });
    return { queries: rows.map(queryView) };
  }

  @Get('queries/:id')
  async getQuery(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get copilot query (m28)');
    const r = await this.queries.getQuery(s.ctx, id);
    return { query: queryView(r.query), response: r.response === null ? null : responseView(r.response) };
  }

  @Get('queries/:id/response')
  async getResponse(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get copilot response (m28)');
    return responseView(await this.responses.getResponseForQuery(s.ctx, id));
  }

  @Get('queries/:id/citations')
  async getCitations(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get copilot citations (m28)');
    return { citations: (await this.responses.listCitationsForQuery(s.ctx, id)).map(citationView) };
  }

  @Endpoint({
    permission: M28_PERMISSIONS.copilotExport,
    auditCode: M28_AUDIT_CODES.exportRequested,
    description: 'Request a human-reviewed export of a completed, cited response (privileged).',
  })
  @Post('queries/:id/export')
  async requestExport(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'export copilot response (m28)');
    const r = await this.responses.requestExport(s.ctx, id);
    return { response: responseView(r.response), citations: r.citations.map(citationView) };
  }
}
