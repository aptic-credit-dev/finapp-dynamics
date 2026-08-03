import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { PostingService, M21_AUDIT_CODES, M21_PERMISSIONS } from '@finapp/m21-journal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { postingRequestView, postingResultView } from './views.ts';

/**
 * Posting requests + posting-result evidence — under `/api/v1/journals`. DRAFT-first MVP: m21 PREPARES an approval-
 * gated posting request for a submitted draft and records posting-result evidence, but NEVER pushes to a core banking/
 * accounting system (m23/m33, post-MVP) and NEVER approves (m22). There is NO approve route and NO external-post route
 * here. The absolute controls (no posting without approval / into a closed period / duplicate / by the requester) are
 * enforced in-service AND at the DB. All posting routes are privileged. Amounts are INTEGER MINOR UNITS (strings out).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('journals')
export class JournalPostingController {
  private readonly service: PostingService;
  private readonly actors: ActorContextFactory;
  constructor(service: PostingService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M21_PERMISSIONS.postingRequestCreate,
    auditCode: M21_AUDIT_CODES.postingRequestCreated,
    description: 'Prepare an approval-gated posting request for a submitted draft.',
  })
  @Post('drafts/:id/posting-requests')
  async create(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create posting request (m21)');
    const idem = h['idempotency-key'];
    return postingRequestView(
      await this.service.createPostingRequest(s.ctx, s.actor.identityId, id, {
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.postingRequestAuthorize,
    auditCode: M21_AUDIT_CODES.postingRequestAuthorized,
    description: 'Record m22 approval on a posting request and mark it ready.',
  })
  @Post('posting-requests/:id/authorize')
  async authorize(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'authorize posting request (m21)');
    return postingRequestView(
      await this.service.authorizePostingRequest(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        {
          approvalRef: requireString(b['approvalRef'], 'approvalRef', s.correlationId),
          approvedBy: requireString(b['approvedBy'], 'approvedBy', s.correlationId),
        },
      ),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.postingRequestCancel,
    auditCode: M21_AUDIT_CODES.postingRequestCancelled,
    description: 'Cancel a posting request.',
  })
  @Post('posting-requests/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'cancel posting request (m21)');
    return postingRequestView(
      await this.service.cancelPostingRequest(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.postingResultRecord,
    auditCode: M21_AUDIT_CODES.postingResultRecorded,
    description: 'Record posting-result evidence for a posting request.',
  })
  @Post('posting-requests/:id/results')
  async recordResult(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record posting result (m21)');
    const idem = h['idempotency-key'];
    const out = await this.service.recordPostingResult(s.ctx, s.actor.identityId, id, {
      status: requireString(b['status'], 'status', s.correlationId),
      ...optStr(b['externalSystem'], 'externalSystem'),
      ...optStr(b['externalRef'], 'externalRef'),
      ...optStr(b['message'], 'message'),
      ...optStr(b['reasonCode'], 'reasonCode'),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return { request: postingRequestView(out.request), result: postingResultView(out.result) };
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('drafts/:id/posting-requests')
  async listByDraft(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list posting requests (m21)');
    return { postingRequests: (await this.service.listPostingRequests(s.ctx, id)).map(postingRequestView) };
  }
  @Get('posting-requests/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get posting request (m21)');
    const out = await this.service.getPostingRequest(s.ctx, id);
    return { request: postingRequestView(out.request), results: out.results.map(postingResultView) };
  }
}
