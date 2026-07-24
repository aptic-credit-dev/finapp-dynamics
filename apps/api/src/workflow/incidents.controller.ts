import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  // VALUE import (not `import type`): NestJS resolves the constructor dependency from design-time metadata.
  IncidentService,
  M06_AUDIT_CODES,
  M06_PERMISSIONS,
} from '@finapp/m06-workflow';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { incidentView } from './views.ts';

/**
 * Workflow incidents, under `/api/v1/workflow` (D2).
 *
 * An incident records a stalled instance/task. An operator resolves it (`resolved` or `wont_fix`) or retries
 * the underlying instance. Every handler works in the caller's TENANT context; permission is enforced in
 * `IncidentService`, the single place each `@Endpoint` permission is checked.
 */

interface ResolveBody {
  expectedVersion?: unknown;
  toStatus?: unknown;
  reason?: unknown;
}

@Controller('workflow')
export class IncidentsController {
  private readonly service: IncidentService;
  private readonly actors: ActorContextFactory;

  constructor(service: IncidentService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Get('incidents')
  async list(@Query('status') status: string | undefined, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list workflow incidents (m06)'));
    const rows = await this.service.list(scoped.ctx, {
      ...(status === undefined ? {} : { status }),
    });
    return rows.map(incidentView);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.incidentResolve,
    auditCode: M06_AUDIT_CODES.incidentResolved,
    description: 'Resolve an incident as resolved or wont_fix. Requires expectedVersion and a reason.',
  })
  @Post('incidents/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() body: ResolveBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'resolve workflow incident (m06)'),
    );
    const cid = scoped.correlationId;
    const toStatus: 'resolved' | 'wont_fix' = body.toStatus === 'wont_fix' ? 'wont_fix' : 'resolved';
    const row = await this.service.resolve(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, cid),
      toStatus,
      requireString(body.reason, 'reason', cid),
    );
    return incidentView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.instanceRetry,
    auditCode: M06_AUDIT_CODES.incidentResolved,
    description: 'Retry the instance behind an incident.',
  })
  @Post('incidents/:id/retry')
  async retry(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'retry workflow incident (m06)'));
    await this.service.retry(scoped.ctx, scoped.actor.identityId, id);
    return { ok: true };
  }
}
