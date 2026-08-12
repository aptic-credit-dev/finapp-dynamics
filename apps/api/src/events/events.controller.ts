import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { StreamService, M36_PERMISSIONS, M36_AUDIT_CODES } from '@finapp/m36-events';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { streamView, cursorView } from './views.ts';

/**
 * Event STREAMS + consumer CURSORS under `/api/v1/events`. Creating/pausing a stream and advancing a cursor are governed
 * `events.stream.*` actions (a stream may only carry REGISTERED event families; a cursor position is monotonic). A stream is
 * tenant-scoped — a subscriber sees only its own tenant's events (FORCE-RLS). Reads carry no `@Endpoint` — the read
 * permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('events')
export class EventsController {
  private readonly streams: StreamService;
  private readonly actors: ActorContextFactory;
  constructor(streams: StreamService, actors: ActorContextFactory) {
    this.streams = streams;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M36_PERMISSIONS.streamManage,
    auditCode: M36_AUDIT_CODES.streamCreated,
    description: 'Create an event stream over registered event families.',
  })
  @Post('streams')
  async createStream(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create event stream (m36)');
    const families = Array.isArray(b['families']) ? (b['families'] as string[]) : [];
    const stream = await this.streams.createStream(s.ctx, s.actor.identityId, {
      streamKey: requireString(b['streamKey'], 'streamKey', s.correlationId),
      families,
      ...optStr(b['scope'], 'scope'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return streamView(stream);
  }

  @Get('streams')
  async listStreams(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse event streams (m36)');
    const rows = await this.streams.listStreams(s.ctx, {});
    return { streams: rows.map(streamView) };
  }

  @Endpoint({
    permission: M36_PERMISSIONS.streamManage,
    auditCode: M36_AUDIT_CODES.streamPaused,
    description: 'Pause an active event stream.',
  })
  @Post('streams/:id/pause')
  async pauseStream(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'pause event stream (m36)');
    const stream = await this.streams.pauseStream(s.ctx, s.actor.identityId, id);
    return streamView(stream);
  }

  @Endpoint({
    permission: M36_PERMISSIONS.streamManage,
    auditCode: M36_AUDIT_CODES.cursorAdvanced,
    description: 'Create a consumer cursor on a stream.',
  })
  @Post('streams/:id/cursors')
  async createCursor(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'create stream cursor (m36)');
    const cursor = await this.streams.createCursor(s.ctx, s.actor.identityId, id, {
      consumerKey: requireString(b['consumerKey'], 'consumerKey', s.correlationId),
    });
    return cursorView(cursor);
  }

  @Endpoint({
    permission: M36_PERMISSIONS.streamManage,
    auditCode: M36_AUDIT_CODES.cursorAdvanced,
    description: 'Advance a consumer cursor (monotonic).',
  })
  @Post('cursors/:id/advance')
  async advanceCursor(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'advance stream cursor (m36)');
    const cursor = await this.streams.advanceCursor(s.ctx, s.actor.identityId, id, {
      position: requireString(b['position'], 'position', s.correlationId),
    });
    return cursorView(cursor);
  }
}
