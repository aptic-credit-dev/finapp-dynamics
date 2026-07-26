import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { RecordsService, M09_AUDIT_CODES, M09_PERMISSIONS } from '@finapp/m09-docs';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { holdView, dispositionView } from './views.ts';

/**
 * Legal hold + controlled disposition, under `/api/v1/documents`. An active hold blocks disposal; disposal
 * requires request → privileged approval (by someone other than the requester) → execution, leaving a
 * tombstone. Permission enforced in `RecordsService`.
 */
interface HoldBody {
  reason?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
  reason?: unknown;
}
interface DispositionBody {
  action?: unknown;
  reason?: unknown;
}

@Controller('documents')
export class DocumentRecordsController {
  private readonly service: RecordsService;
  private readonly actors: ActorContextFactory;
  constructor(service: RecordsService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M09_PERMISSIONS.legalHoldManage,
    auditCode: M09_AUDIT_CODES.legalHoldPlaced,
    description: 'Place a legal hold on a document.',
  })
  @Post('documents/:id/legal-holds')
  async placeHold(@Param('id') id: string, @Body() b: HoldBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'place legal hold (m09)');
    return holdView(
      await this.service.placeLegalHold(
        s.ctx,
        s.actor.identityId,
        id,
        requireString(b.reason, 'reason', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.legalHoldManage,
    auditCode: M09_AUDIT_CODES.legalHoldReleased,
    description: 'Release a legal hold.',
  })
  @Post('legal-holds/:id/release')
  async releaseHold(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'release legal hold (m09)');
    return holdView(
      await this.service.releaseLegalHold(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
        typeof b.reason === 'string' ? b.reason : null,
      ),
    );
  }
  @Get('documents/:id/legal-hold')
  async activeHold(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get active legal hold (m09)');
    const hold = await this.service.getActiveHold(s.ctx, id);
    return { hold: hold === null ? null : holdView(hold) };
  }

  @Endpoint({
    permission: M09_PERMISSIONS.dispositionRequest,
    auditCode: M09_AUDIT_CODES.dispositionRequested,
    description: 'Request disposition of a document.',
  })
  @Post('documents/:id/dispositions')
  async request(@Param('id') id: string, @Body() b: DispositionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'request disposition (m09)');
    const idem = h['idempotency-key'];
    return dispositionView(
      await this.service.requestDisposition(s.ctx, s.actor.identityId, id, {
        action: requireString(b.action, 'action', s.correlationId),
        ...(typeof b.reason === 'string' ? { reason: b.reason } : {}),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      }),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.dispositionApprove,
    auditCode: M09_AUDIT_CODES.dispositionApproved,
    description: 'Approve a disposition (not the requester).',
  })
  @Post('dispositions/:id/approve')
  async approve(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'approve disposition (m09)');
    return dispositionView(
      await this.service.approveDisposition(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.dispositionApprove,
    auditCode: M09_AUDIT_CODES.dispositionRejected,
    description: 'Reject a disposition.',
  })
  @Post('dispositions/:id/reject')
  async reject(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'reject disposition (m09)');
    return dispositionView(
      await this.service.rejectDisposition(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
        typeof b.reason === 'string' ? b.reason : null,
      ),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.dispositionExecute,
    auditCode: M09_AUDIT_CODES.dispositionCompleted,
    description: 'Execute an approved disposition (purge + tombstone).',
  })
  @Post('dispositions/:id/execute')
  async execute(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'execute disposition (m09)');
    return dispositionView(
      await this.service.executeDisposition(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('dispositions/:id')
  async getDisposition(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get disposition (m09)');
    return dispositionView(await this.service.getDisposition(s.ctx, id));
  }
}
