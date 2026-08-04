import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { RequestService, M22_AUDIT_CODES, M22_PERMISSIONS } from '@finapp/m22-approval';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { requestView, requestStepView } from './views.ts';

/**
 * Approval requests — the lifecycle of the aggregate up to the point decisions land — under `/api/v1/approvals`.
 * Create (idempotent via the Idempotency-Key header), submit for approval (workflow + SLA + notify hooks), controlled
 * cancellation and resubmission, and notes. m22 never approves here.
 */
@Controller('approvals')
export class ApprovalRequestController {
  private readonly service: RequestService;
  private readonly actors: ActorContextFactory;
  constructor(service: RequestService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M22_PERMISSIONS.requestCreate,
    auditCode: M22_AUDIT_CODES.requestCreated,
    description: 'Create an approval request for a controlled action.',
  })
  @Post('requests')
  async create(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create approval request (m22)');
    const idem = h['idempotency-key'];
    const out = await this.service.createRequest(s.ctx, s.actor.identityId, {
      subjectType: requireString(b['subjectType'], 'subjectType', s.correlationId),
      ...(typeof b['subjectRef'] === 'string' ? { subjectRef: b['subjectRef'] } : {}),
      ...(typeof b['scope'] === 'string' ? { scope: b['scope'] } : {}),
      ...(typeof b['title'] === 'string' ? { title: b['title'] } : {}),
      ...(typeof b['amountMinor'] === 'number' ? { amountMinor: b['amountMinor'] } : {}),
      ...(typeof b['preparedBy'] === 'string' ? { preparedBy: b['preparedBy'] } : {}),
      ...(typeof b['requiredApprovals'] === 'number' ? { requiredApprovals: b['requiredApprovals'] } : {}),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    return { request: requestView(out.request), steps: out.steps.map(requestStepView) };
  }

  @Endpoint({
    permission: M22_PERMISSIONS.requestSubmit,
    auditCode: M22_AUDIT_CODES.requestSubmitted,
    description: 'Submit an approval request for approval.',
  })
  @Post('requests/:id/submit')
  async submit(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'submit approval request (m22)');
    return requestView(
      await this.service.submitRequest(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        {
          ...(typeof b['workflowRef'] === 'string' ? { workflowRef: b['workflowRef'] } : {}),
          ...(typeof b['timerRef'] === 'string' ? { timerRef: b['timerRef'] } : {}),
          ...(typeof b['notificationRef'] === 'string' ? { notificationRef: b['notificationRef'] } : {}),
        },
      ),
    );
  }

  @Endpoint({
    permission: M22_PERMISSIONS.requestSubmit,
    auditCode: M22_AUDIT_CODES.requestSubmitted,
    description: 'Resubmit a returned approval request.',
  })
  @Post('requests/:id/resubmit')
  async resubmit(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'resubmit approval request (m22)');
    return requestView(
      await this.service.resubmitRequest(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M22_PERMISSIONS.requestCancel,
    auditCode: M22_AUDIT_CODES.requestCancelled,
    description: 'Cancel an approval request.',
  })
  @Post('requests/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'cancel approval request (m22)');
    return requestView(
      await this.service.cancelRequest(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M22_PERMISSIONS.noteAdd,
    auditCode: M22_AUDIT_CODES.requestCreated,
    description: 'Add a note to an approval request.',
  })
  @Post('requests/:id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add approval note (m22)');
    await this.service.addNote(s.ctx, s.actor.identityId, id, {
      ...(typeof b['noteType'] === 'string' ? { noteType: b['noteType'] } : {}),
      content: requireString(b['content'], 'content', s.correlationId),
    });
    return { ok: true };
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('requests')
  async list(@Query('status') status: string | undefined, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list approval requests (m22)');
    const rows = await this.service.listRequests(
      s.ctx,
      typeof status === 'string' && status !== '' ? status : undefined,
    );
    return { requests: rows.map(requestView) };
  }
  @Get('requests/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get approval request (m22)');
    const out = await this.service.getRequest(s.ctx, id);
    return { request: requestView(out.request), steps: out.steps.map(requestStepView) };
  }
}
