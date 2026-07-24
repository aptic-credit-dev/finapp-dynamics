import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint, ProblemError } from '@finapp/kernel';
import {
  // VALUE import (not `import type`): NestJS resolves the constructor dependency from design-time metadata.
  InstanceService,
  M06_AUDIT_CODES,
  M06_PERMISSIONS,
} from '@finapp/m06-workflow';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { instanceView } from './views.ts';

/**
 * Workflow instances, under `/api/v1/workflow` (D2).
 *
 * An instance is a running definition. It is started, then may be suspended/resumed, cancelled, or retried
 * out of an incident. Every handler works in the caller's TENANT context; permission is enforced in
 * `InstanceService`, and the `@Endpoint` permission is the declaration checked there.
 */

interface StartInstanceBody {
  definitionId?: unknown;
  businessKey?: unknown;
  subjectType?: unknown;
  subjectId?: unknown;
  variables?: unknown;
}

interface ReasonBody {
  reason?: unknown;
}

@Controller('workflow')
export class InstancesController {
  private readonly service: InstanceService;
  private readonly actors: ActorContextFactory;

  constructor(service: InstanceService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Endpoint({
    permission: M06_PERMISSIONS.instanceStart,
    auditCode: M06_AUDIT_CODES.instanceStarted,
    description: 'Start a workflow instance from an active definition.',
  })
  @Post('instances')
  async start(@Body() body: StartInstanceBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'start workflow instance (m06)'));
    const cid = scoped.correlationId;
    const row = await this.service.start(scoped.ctx, scoped.actor.identityId, {
      definitionId: requireString(body.definitionId, 'definitionId', cid),
      ...(typeof body.businessKey === 'string' ? { businessKey: body.businessKey } : {}),
      ...(typeof body.subjectType === 'string' ? { subjectType: body.subjectType } : {}),
      ...(typeof body.subjectId === 'string' ? { subjectId: body.subjectId } : {}),
      ...(isRecord(body.variables) ? { variables: body.variables } : {}),
    });
    return instanceView(row);
  }

  @Get('instances/:id')
  async get(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'read workflow instance (m06)'));
    const row = await this.service.view(scoped.ctx, id);
    if (row === null) throw ProblemError.notFound('Workflow instance not found.', scoped.correlationId);
    return instanceView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.instanceSuspend,
    auditCode: M06_AUDIT_CODES.instanceSuspended,
    description: 'Suspend a running workflow instance.',
  })
  @Post('instances/:id/suspend')
  async suspend(
    @Param('id') id: string,
    @Body() body: ReasonBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'suspend workflow instance (m06)'),
    );
    const cid = scoped.correlationId;
    const row = await this.service.suspend(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireString(body.reason, 'reason', cid),
    );
    return instanceView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.instanceResume,
    auditCode: M06_AUDIT_CODES.instanceResumed,
    description: 'Resume a suspended workflow instance.',
  })
  @Post('instances/:id/resume')
  async resume(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'resume workflow instance (m06)'),
    );
    const row = await this.service.resume(scoped.ctx, scoped.actor.identityId, id);
    return instanceView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.instanceCancel,
    auditCode: M06_AUDIT_CODES.instanceCancelled,
    description: 'Cancel a workflow instance.',
  })
  @Post('instances/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() body: ReasonBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'cancel workflow instance (m06)'),
    );
    const cid = scoped.correlationId;
    const row = await this.service.cancel(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireString(body.reason, 'reason', cid),
    );
    return instanceView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.instanceRetry,
    auditCode: M06_AUDIT_CODES.instanceStarted,
    description: 'Retry a failed workflow instance.',
  })
  @Post('instances/:id/retry')
  async retry(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'retry workflow instance (m06)'));
    const row = await this.service.retry(scoped.ctx, scoped.actor.identityId, id);
    return instanceView(row);
  }
}

/** A JSON object, distinguished from arrays and null so `variables` is only forwarded when it is a map. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
