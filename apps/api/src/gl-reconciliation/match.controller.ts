import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { MatchService, M20_AUDIT_CODES, M20_PERMISSIONS } from '@finapp/m20-glrecon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  matchView,
  matchLineView,
  exceptionView,
  reconcilingItemView,
  manualDecisionView,
  noteView,
} from './views.ts';

/**
 * Match review + manual/grouped matches + exception management + reconciling items + notes, under
 * `/api/v1/gl-reconciliation`. Manual override + unmatch are PRIVILEGED; grouped/split matches must balance exactly
 * in minor units (enforced in-service). Manual decisions are APPEND-ONLY evidence. Permission enforced in-service
 * (default deny); read routes carry no `@Endpoint`. Money is INTEGER MINOR UNITS — never a float (ADR-007).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

@Controller('gl-reconciliation')
export class GlreconMatchController {
  private readonly service: MatchService;
  private readonly actors: ActorContextFactory;
  constructor(service: MatchService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- match review -----------------------------------------------------------------------------
  @Endpoint({
    permission: M20_PERMISSIONS.matchReview,
    auditCode: M20_AUDIT_CODES.matchConfirmed,
    description: 'Confirm a proposed match.',
  })
  @Post('matches/:id/confirm')
  async confirm(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'confirm match (m20)');
    return matchView(
      await this.service.confirmMatch(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.matchReview,
    auditCode: M20_AUDIT_CODES.matchRejected,
    description: 'Reject a proposed match.',
  })
  @Post('matches/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reject match (m20)');
    return matchView(
      await this.service.rejectMatch(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.matchUnmatch,
    auditCode: M20_AUDIT_CODES.matchUnmatched,
    description: 'Unmatch a confirmed match (privileged).',
  })
  @Post('matches/:id/unmatch')
  async unmatch(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'unmatch (m20)');
    return matchView(
      await this.service.unmatch(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.matchManual,
    auditCode: M20_AUDIT_CODES.manualDecisionRecorded,
    description: 'Create a manual / grouped match (privileged; must balance in minor units).',
  })
  @Post('manual-matches')
  async manualMatch(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'manual match (m20)');
    return matchView(
      await this.service.manualMatch(s.ctx, s.actor.identityId, {
        runId: requireString(b['runId'], 'runId', s.correlationId),
        glLineIds: asIds(b['glLineIds']),
        sourceLineIds: asIds(b['sourceLineIds']),
        reason: requireString(b['reason'], 'reason', s.correlationId),
      }),
    );
  }

  // --- exceptions -------------------------------------------------------------------------------
  @Endpoint({
    permission: M20_PERMISSIONS.exceptionAssign,
    auditCode: M20_AUDIT_CODES.exceptionAssigned,
    description: 'Assign an exception to a reviewer.',
  })
  @Post('exceptions/:id/assign')
  async assignException(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'assign exception (m20)');
    return exceptionView(
      await this.service.assignException(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['assignee'], 'assignee', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.exceptionResolve,
    auditCode: M20_AUDIT_CODES.exceptionResolved,
    description: 'Resolve an exception.',
  })
  @Post('exceptions/:id/resolve')
  async resolveException(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'resolve exception (m20)');
    return exceptionView(
      await this.service.resolveException(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.exceptionWaive,
    auditCode: M20_AUDIT_CODES.exceptionWaived,
    description: 'Waive an exception (privileged).',
  })
  @Post('exceptions/:id/waive')
  async waiveException(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'waive exception (m20)');
    return exceptionView(
      await this.service.waiveException(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }

  // --- reconciling items ------------------------------------------------------------------------
  @Endpoint({
    permission: M20_PERMISSIONS.itemManage,
    auditCode: M20_AUDIT_CODES.reconcilingItemRaised,
    description: 'Raise a reconciling item.',
  })
  @Post('reconciling-items')
  async raiseItem(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'raise reconciling item (m20)');
    return reconcilingItemView(
      await this.service.raiseReconcilingItem(s.ctx, s.actor.identityId, {
        runId: requireString(b['runId'], 'runId', s.correlationId),
        itemType: requireString(b['itemType'], 'itemType', s.correlationId),
        amountMinor: typeof b['amountMinor'] === 'number' ? b['amountMinor'] : Number.NaN,
        ...optStr(b['direction'], 'direction'),
        ...optStr(b['glLineId'], 'glLineId'),
        ...optStr(b['sourceLineId'], 'sourceLineId'),
        ...optStr(b['reason'], 'reason'),
      }),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.itemManage,
    auditCode: M20_AUDIT_CODES.reconcilingItemCleared,
    description: 'Clear a reconciling item.',
  })
  @Post('reconciling-items/:id/clear')
  async clearItem(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'clear reconciling item (m20)');
    return reconcilingItemView(
      await this.service.clearReconcilingItem(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }

  // --- notes ------------------------------------------------------------------------------------
  @Endpoint({
    permission: M20_PERMISSIONS.matchReview,
    auditCode: M20_AUDIT_CODES.noteAdded,
    description: 'Add a note to a run.',
  })
  @Post('runs/:id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add note (m20)');
    return noteView(
      await this.service.addNote(s.ctx, s.actor.identityId, id, {
        content: requireString(b['content'], 'content', s.correlationId),
        ...optStr(b['noteType'], 'noteType'),
      }),
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('runs/:id/matches')
  async listMatches(
    @Param('id') id: string,
    @Headers() h: Record<string, string>,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list matches (m20)');
    return { matches: (await this.service.listMatches(s.ctx, id, status)).map(matchView) };
  }
  @Get('matches/:id')
  async getMatch(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get match (m20)');
    return matchView(await this.service.getMatch(s.ctx, id));
  }
  @Get('matches/:id/lines')
  async listMatchLines(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list match lines (m20)');
    return { lines: (await this.service.listMatchLines(s.ctx, id)).map(matchLineView) };
  }
  @Get('runs/:id/exceptions')
  async listExceptions(
    @Param('id') id: string,
    @Headers() h: Record<string, string>,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list exceptions (m20)');
    return { exceptions: (await this.service.listExceptions(s.ctx, id, status)).map(exceptionView) };
  }
  @Get('exceptions/:id')
  async getException(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get exception (m20)');
    return exceptionView(await this.service.getException(s.ctx, id));
  }
  @Get('runs/:id/reconciling-items')
  async listItems(
    @Param('id') id: string,
    @Headers() h: Record<string, string>,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list reconciling items (m20)');
    return { items: (await this.service.listReconcilingItems(s.ctx, id, status)).map(reconcilingItemView) };
  }
  @Get('runs/:id/decisions')
  async listDecisions(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list decisions (m20)');
    return { decisions: (await this.service.listManualDecisions(s.ctx, id)).map(manualDecisionView) };
  }
  @Get('runs/:id/notes')
  async listNotes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list notes (m20)');
    return { notes: (await this.service.listNotes(s.ctx, id)).map(noteView) };
  }
}
