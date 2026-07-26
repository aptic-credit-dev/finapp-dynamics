import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  NotificationService,
  M08_AUDIT_CODES,
  M08_PERMISSIONS,
  type NotificationCategory,
} from '@finapp/m08-notify';
import { ActorContextFactory } from '@finapp/m02-identity';
import {
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  requireVersion,
} from '../identity/http.ts';
import { requestView, deliveryView } from './views.ts';

/**
 * Notification requests — creation and the cancel/retry surface, under `/api/v1/notifications`. Dispatch and
 * retry PROCESSING are worker paths and are deliberately NOT exposed over HTTP (prompt §E17: no worker
 * internals). Idempotency is by `idempotency-key` header (or body). Views redact variable values and the
 * worker lease.
 */

interface CreateBody {
  templateKey?: unknown;
  destination?: unknown;
  recipientRef?: unknown;
  variables?: unknown;
  category?: unknown;
  priority?: unknown;
  scheduledAt?: unknown;
  expiresAt?: unknown;
  originModule?: unknown;
  originEntityType?: unknown;
  originEntityId?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
  reason?: unknown;
}

const CATEGORIES = ['optional', 'operational', 'security', 'legal'];

@Controller('notifications')
export class RequestsController {
  private readonly service: NotificationService;
  private readonly actors: ActorContextFactory;
  constructor(service: NotificationService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: M08_PERMISSIONS.requestCreate,
    auditCode: M08_AUDIT_CODES.requestCreated,
    description: 'Create (enqueue) a notification request against a template.',
  })
  @Post('requests')
  async create(@Body() body: CreateBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'create notification request (m08)'),
    );
    const cid = scoped.correlationId;
    const idem = headers['idempotency-key'];
    const category =
      typeof body.category === 'string' && CATEGORIES.includes(body.category)
        ? (body.category as NotificationCategory)
        : undefined;
    const row = await this.service.create(scoped.ctx, scoped.actor.identityId, {
      templateKey: requireString(body.templateKey, 'templateKey', cid),
      destination: requireString(body.destination, 'destination', cid),
      ...(typeof body.recipientRef === 'string' ? { recipientRef: body.recipientRef } : {}),
      ...(typeof body.variables === 'object' && body.variables !== null
        ? { variables: body.variables as Record<string, unknown> }
        : {}),
      ...(category !== undefined ? { category } : {}),
      ...(typeof body.priority === 'string' ? { priority: body.priority } : {}),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      ...(typeof body.scheduledAt === 'string' ? { scheduledAt: body.scheduledAt } : {}),
      ...(typeof body.expiresAt === 'string' ? { expiresAt: body.expiresAt } : {}),
      ...(typeof body.originModule === 'string' ? { originModule: body.originModule } : {}),
      ...(typeof body.originEntityType === 'string' ? { originEntityType: body.originEntityType } : {}),
      ...(typeof body.originEntityId === 'string' ? { originEntityId: body.originEntityId } : {}),
    });
    return requestView(row);
  }

  @Endpoint({
    permission: M08_PERMISSIONS.requestCancel,
    auditCode: M08_AUDIT_CODES.requestCancelled,
    description: 'Cancel a non-terminal notification request.',
  })
  @Post('requests/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() body: ActionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'cancel notification request (m08)'),
    );
    const row = await this.service.cancel(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
      typeof body.reason === 'string' ? body.reason : null,
    );
    return requestView(row);
  }

  @Endpoint({
    permission: M08_PERMISSIONS.requestRetry,
    auditCode: M08_AUDIT_CODES.retryRequested,
    description: 'Manually re-queue a failed/exhausted request for another attempt.',
  })
  @Post('requests/:id/retry')
  async retry(@Param('id') id: string, @Body() body: ActionBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'retry notification request (m08)'),
    );
    const row = await this.service.retryNow(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
    );
    return requestView(row);
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('requests')
  async list(
    @Headers() headers: Record<string, string>,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'list notification requests (m08)'),
    );
    const cid = scoped.correlationId;
    const l = optionalLimit(limit, cid).limit ?? 50;
    const o = optionalOffset(offset, cid).offset ?? 0;
    const rows = await this.service.list(scoped.ctx, l, o);
    return { requests: rows.map(requestView) };
  }

  @Get('requests/:id')
  async get(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'get notification request (m08)'),
    );
    return requestView(await this.service.get(scoped.ctx, id));
  }

  @Get('requests/:id/deliveries')
  async deliveries(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'list notification deliveries (m08)'),
    );
    const rows = await this.service.deliveries(scoped.ctx, id);
    return { deliveries: rows.map(deliveryView) };
  }
}
