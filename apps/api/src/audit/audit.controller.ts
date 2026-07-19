import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  // VALUE imports (NestJS DI reads design-time metadata; a type-only import is erased before it is emitted).
  AuditQueryService,
  AUDIT_AUDIT_CODES,
  AUDIT_PERMISSIONS,
} from '@finapp/m03-audit';
import { ActorContextFactory, requireUuidParam } from '@finapp/m02-identity';
import { optionalLimit, optionalOffset, requireString, requireTenantScope } from '../identity/http.ts';
import { auditEventView } from './views.ts';

/**
 * The audit investigation API, under `/api/v1/audit` (ADR-008 / naming-map).
 *
 * Tenant routes resolve the actor and run in tenant context, so an administrator sees ONLY their own
 * tenant's evidence (RLS). The platform route is separate and requires `audit.platform.view` — a tenant
 * administrator can never reach cross-tenant events. Enforcement lives in the query service; the `@Endpoint`
 * permission/auditCode is the declaration, and export/verify are themselves audited.
 */

interface FilterQuery {
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  module?: string;
  category?: string;
  outcome?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

@Controller('audit')
export class AuditController {
  private readonly service: AuditQueryService;
  private readonly actors: ActorContextFactory;

  constructor(service: AuditQueryService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Get('events')
  async search(@Query() q: FilterQuery, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'search audit (m03)'));
    const cid = scoped.correlationId;
    const rows = await this.service.searchTenant(scoped.ctx, {
      ...filterFrom(q),
      ...optionalLimit(q.limit, cid),
      ...optionalOffset(q.offset, cid),
    });
    return rows.map(auditEventView);
  }

  @Get('events/:eventId')
  async get(@Param('eventId') eventId: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'read audit event (m03)'));
    const row = await this.service.getEvent(scoped.ctx, requireUuidParam(eventId, 'eventId', scoped.correlationId));
    return auditEventView(row);
  }

  @Get('platform/events')
  async searchPlatform(@Query() q: FilterQuery, @Headers() headers: Record<string, string>) {
    const scoped = await this.actors.forPlatformRequest(headers, 'search platform audit (m03)');
    const cid = scoped.correlationId;
    const rows = await this.service.searchPlatform(scoped.ctx, {
      ...filterFrom(q),
      ...optionalLimit(q.limit, cid),
      ...optionalOffset(q.offset, cid),
    });
    return rows.map(auditEventView);
  }

  @Endpoint({
    permission: AUDIT_PERMISSIONS.eventExport,
    auditCode: AUDIT_AUDIT_CODES.eventExported,
    description: 'Export the caller tenant’s matching audit events. The export is itself audited.',
  })
  @Post('exports')
  async export(@Body() body: FilterQuery & { limit?: number; offset?: number }, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'export audit (m03)'));
    const rows = await this.service.exportTenant(scoped.ctx, {
      ...filterFrom(body),
      ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
      ...(typeof body.offset === 'number' ? { offset: body.offset } : {}),
    });
    return { count: rows.length, events: rows.map(auditEventView) };
  }

  @Endpoint({
    permission: AUDIT_PERMISSIONS.integrityVerify,
    auditCode: AUDIT_AUDIT_CODES.integrityVerified,
    description: 'Verify a scope’s audit hash chain. Records the verification outcome.',
  })
  @Post('integrity/verify')
  async verify(@Body() body: { scopeKey?: unknown }, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'verify audit integrity (m03)'));
    const scopeKey = requireString(body.scopeKey, 'scopeKey', scoped.correlationId);
    return this.service.verifyScope(scoped.ctx, scopeKey);
  }
}

function filterFrom(q: FilterQuery) {
  return {
    ...(q.actorId === undefined ? {} : { actorId: q.actorId }),
    ...(q.resourceType === undefined ? {} : { resourceType: q.resourceType }),
    ...(q.resourceId === undefined ? {} : { resourceId: q.resourceId }),
    ...(q.action === undefined ? {} : { action: q.action }),
    ...(q.module === undefined ? {} : { module: q.module }),
    ...(q.category === undefined ? {} : { category: q.category }),
    ...(q.outcome === undefined ? {} : { outcome: q.outcome }),
    ...(q.correlationId === undefined ? {} : { correlationId: q.correlationId }),
    ...(q.from === undefined ? {} : { from: new Date(q.from) }),
    ...(q.to === undefined ? {} : { to: new Date(q.to) }),
  };
}
