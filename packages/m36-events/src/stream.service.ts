/**
 * StreamService — tenant EVENT STREAMS + consumer CURSORS. A stream is a named, filtered projection of the platform's
 * domain events; it may only carry REGISTERED event families (no arbitrary family). A cursor's position is a monotonic
 * bigint (advance-only; never rewound — enforced in SQL). Every mutation authorizes an `events.*` permission (default deny)
 * and is audited through m03 in the same transaction. A subscriber sees only its own tenant's stream (FORCE-RLS).
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M36_PERMISSIONS } from './permissions.ts';
import { M36_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import { isScope, isPlatformScope, isRegisteredEventFamily, clampPage, REASON_CODES } from './domain.ts';
import { EventsRepository, type StreamRow, type CursorRow } from './repository.ts';
import type { M36Emitter } from './emit.ts';

export class StreamService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M36Emitter;
  private readonly repo: EventsRepository;
  constructor(db: Db, authz: Authz, emitter: M36Emitter, repo: EventsRepository = new EventsRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M36_PERMISSIONS.administer);
  }

  async createStream(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      streamKey: string;
      families: readonly string[];
      description?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<StreamRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.streamManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (input.streamKey.trim() === '') throw badRequest('a stream key is required.', ctx.correlationId);
    if (input.families.length === 0)
      throw badRequest('a stream must carry at least one event family.', ctx.correlationId);
    for (const f of input.families)
      if (!isRegisteredEventFamily(f))
        throw governanceForbidden(REASON_CODES.unknownEventFamily, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findStreamByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const stream = await this.repo.insertStream(tx, {
        tenantId: ctx.tenantId,
        scope,
        streamKey: input.streamKey,
        description: input.description ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      for (const family of input.families) {
        await this.repo.insertStreamSubscription(tx, {
          tenantId: ctx.tenantId,
          streamId: stream.id,
          eventFamily: family,
          correlationId: ctx.correlationId,
          by: actor,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M36_AUDIT_CODES.streamSubscriptionAdded,
          entityType: 'eventstream_subscription',
          entityId: stream.id,
          detail: { streamId: stream.id, eventFamily: family },
        });
      }
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'stream',
        targetId: stream.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.streamCreated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.streamCreated,
        entityType: 'eventstream_config',
        entityId: stream.id,
        detail: { streamKey: input.streamKey, familyCount: input.families.length },
      });
      await this.emitter.publishEventstream(tx, 'StreamCreated', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: stream.id,
          recordType: 'stream',
          streamKey: input.streamKey,
          toStatus: 'active',
          reasonCode: REASON_CODES.streamCreated,
        },
      });
      return stream;
    });
  }

  async pauseStream(ctx: RequestContext, actor: string | null, streamId: string): Promise<StreamRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.streamManage);
    return this.db.withTenant(ctx, async (tx) => {
      const stream = await this.repo.getStream(tx, streamId);
      if (stream === null) throw badRequest('unknown stream.', ctx.correlationId);
      if (stream.status !== 'active')
        throw badRequest('only an active stream can be paused.', ctx.correlationId);
      const moved = await this.repo.updateStreamStatus(tx, streamId, stream.version, {
        status: 'paused',
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'stream',
        targetId: streamId,
        fromStatus: 'active',
        toStatus: 'paused',
        reason: null,
        reasonCode: REASON_CODES.streamPaused,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.streamPaused,
        entityType: 'eventstream_config',
        entityId: streamId,
        detail: {},
      });
      await this.emitter.publishEventstream(tx, 'StreamPaused', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: streamId,
          recordType: 'stream',
          toStatus: 'paused',
          reasonCode: REASON_CODES.streamPaused,
        },
      });
      return moved;
    });
  }

  async createCursor(
    ctx: RequestContext,
    actor: string | null,
    streamId: string,
    input: { consumerKey: string },
  ): Promise<CursorRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.streamManage);
    if (input.consumerKey.trim() === '') throw badRequest('a consumer key is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const stream = await this.repo.getStream(tx, streamId);
      if (stream === null) throw badRequest('unknown stream.', ctx.correlationId);
      const cursor = await this.repo.insertCursor(tx, {
        tenantId: ctx.tenantId,
        streamId,
        consumerKey: input.consumerKey,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.cursorAdvanced,
        entityType: 'eventstream_cursor',
        entityId: cursor.id,
        detail: { streamId, consumerKey: input.consumerKey, position: cursor.position },
      });
      return cursor;
    });
  }

  /** Advance a cursor to a new position — monotonic (the DB rejects a rewind). */
  async advanceCursor(
    ctx: RequestContext,
    actor: string | null,
    cursorId: string,
    input: { position: string },
  ): Promise<CursorRow> {
    await this.authz.require(ctx, M36_PERMISSIONS.streamManage);
    if (!/^\d+$/.test(input.position))
      throw badRequest('a cursor position must be a non-negative integer.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const cursor = await this.repo.getCursor(tx, cursorId);
      if (cursor === null) throw badRequest('unknown cursor.', ctx.correlationId);
      const moved = await this.repo.advanceCursor(tx, cursorId, cursor.version, input.position, actor);
      if (moved === null)
        throw badRequest(
          'the cursor could not advance (stale version or non-monotonic position).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M36_AUDIT_CODES.cursorAdvanced,
        entityType: 'eventstream_cursor',
        entityId: cursorId,
        detail: { position: input.position },
      });
      await this.emitter.publishEventstream(tx, 'CursorAdvanced', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: cursorId,
          recordType: 'cursor',
          toStatus: 'active',
          reasonCode: REASON_CODES.cursorAdvanced,
        },
      });
      return moved;
    });
  }

  async getStream(ctx: RequestContext, id: string): Promise<StreamRow | null> {
    await this.authz.require(ctx, M36_PERMISSIONS.streamRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getStream(tx, id));
  }
  async listStreams(ctx: RequestContext, page?: { limit?: number; offset?: number }): Promise<StreamRow[]> {
    await this.authz.require(ctx, M36_PERMISSIONS.streamRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listStreams(tx, limit, offset));
  }
}
