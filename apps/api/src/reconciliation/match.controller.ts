import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { MatchService, M15_AUDIT_CODES, M15_PERMISSIONS } from '@finapp/m15-recon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { badRequest, requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { matchView, matchLineView, exceptionView, manualDecisionView, noteView } from './views.ts';

/**
 * Match review + override, exception resolution and run notes, under `/api/v1/reconciliation`. Confirm/reject a
 * proposed match, manual/split/grouped match (which must BALANCE exactly in INTEGER MINOR UNITS — no float, ADR-007),
 * unmatch, resolve/waive an exception, and record append-only notes. Manual review/override is APPEND-ONLY evidence
 * that never overwrites the engine's candidate evidence; unmatch, manual match and exception waive are privileged.
 * Lifecycle transitions go through `checkMatchTransition`/`checkExceptionTransition`. Permission enforced in
 * MatchService (default deny). Read (GET) routes carry no `@Endpoint` — the read permission is enforced in-service.
 */
function requireStringArray(v: unknown, field: string, correlationId: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.trim() === ''))
    throw badRequest(`${field} is required and must be a non-empty array of ids.`, correlationId);
  return v as string[];
}

@Controller('reconciliation')
export class ReconciliationMatchController {
  private readonly service: MatchService;
  private readonly actors: ActorContextFactory;
  constructor(service: MatchService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- match confirm / reject / unmatch ---------------------------------------------------------
  @Endpoint({
    permission: M15_PERMISSIONS.matchConfirm,
    auditCode: M15_AUDIT_CODES.matchConfirmed,
    description: 'Confirm a proposed match.',
  })
  @Post('matches/:id/confirm')
  async confirm(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'confirm match (m15)');
    return matchView(
      await this.service.confirm(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M15_PERMISSIONS.matchReject,
    auditCode: M15_AUDIT_CODES.matchRejected,
    description: 'Reject a proposed match.',
  })
  @Post('matches/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reject match (m15)');
    return matchView(
      await this.service.reject(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        typeof b['reason'] === 'string' ? b['reason'] : null,
      ),
    );
  }
  @Endpoint({
    permission: M15_PERMISSIONS.matchUnmatch,
    auditCode: M15_AUDIT_CODES.matchUnmatched,
    description: 'Unmatch a confirmed match (privileged).',
  })
  @Post('matches/:id/unmatch')
  async unmatch(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'unmatch match (m15)');
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

  // --- manual / split / grouped match -----------------------------------------------------------
  @Endpoint({
    permission: M15_PERMISSIONS.manualMatch,
    auditCode: M15_AUDIT_CODES.manualDecisionRecorded,
    description: 'Manually match statement lines to ledger entries (must balance; privileged).',
  })
  @Post('manual-matches')
  async manualMatch(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'manual match (m15)');
    return matchView(
      await this.service.manualMatch(s.ctx, s.actor.identityId, {
        runId: requireString(b['runId'], 'runId', s.correlationId),
        statementLineIds: requireStringArray(b['statementLineIds'], 'statementLineIds', s.correlationId),
        ledgerEntryIds: requireStringArray(b['ledgerEntryIds'], 'ledgerEntryIds', s.correlationId),
        ...(typeof b['reason'] === 'string' ? { reason: b['reason'] } : {}),
      }),
    );
  }

  // --- exceptions -------------------------------------------------------------------------------
  @Endpoint({
    permission: M15_PERMISSIONS.exceptionResolve,
    auditCode: M15_AUDIT_CODES.exceptionResolved,
    description: 'Resolve a reconciliation exception.',
  })
  @Post('exceptions/:id/resolve')
  async resolveException(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'resolve exception (m15)');
    return exceptionView(
      await this.service.resolveException(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        typeof b['reason'] === 'string' ? b['reason'] : null,
      ),
    );
  }
  @Endpoint({
    permission: M15_PERMISSIONS.exceptionWaive,
    auditCode: M15_AUDIT_CODES.exceptionWaived,
    description: 'Waive a reconciliation exception (privileged).',
  })
  @Post('exceptions/:id/waive')
  async waiveException(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'waive exception (m15)');
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

  // --- notes ------------------------------------------------------------------------------------
  @Endpoint({
    permission: M15_PERMISSIONS.runReview,
    auditCode: M15_AUDIT_CODES.noteAdded,
    description: 'Add a note to a reconciliation run.',
  })
  @Post('runs/:id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add run note (m15)');
    return noteView(
      await this.service.addNote(s.ctx, s.actor.identityId, id, {
        content: requireString(b['content'], 'content', s.correlationId),
        ...(typeof b['noteType'] === 'string' ? { noteType: b['noteType'] } : {}),
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
    const s = await this.scoped(h, 'list matches (m15)');
    const rows = await this.service.listMatches(s.ctx, {
      runId: id,
      ...(status !== undefined ? { status } : {}),
    });
    return { matches: rows.map(matchView) };
  }
  @Get('matches/:id/lines')
  async listMatchLines(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list match lines (m15)');
    return { lines: (await this.service.listMatchLines(s.ctx, id)).map(matchLineView) };
  }
  @Get('runs/:id/exceptions')
  async listExceptions(
    @Param('id') id: string,
    @Headers() h: Record<string, string>,
    @Query('status') status?: string,
  ) {
    const s = await this.scoped(h, 'list exceptions (m15)');
    const rows = await this.service.listExceptions(s.ctx, {
      runId: id,
      ...(status !== undefined ? { status } : {}),
    });
    return { exceptions: rows.map(exceptionView) };
  }
  @Get('runs/:id/manual-decisions')
  async listManualDecisions(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list manual decisions (m15)');
    return { manualDecisions: (await this.service.listManualDecisions(s.ctx, id)).map(manualDecisionView) };
  }
  @Get('runs/:id/notes')
  async listNotes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list notes (m15)');
    return { notes: (await this.service.listNotes(s.ctx, id)).map(noteView) };
  }
}
