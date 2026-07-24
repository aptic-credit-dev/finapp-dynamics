import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint, ProblemError } from '@finapp/kernel';
import {
  // VALUE import (not `import type`): NestJS resolves the constructor dependency from design-time metadata.
  TaskService,
  M06_AUDIT_CODES,
  M06_PERMISSIONS,
} from '@finapp/m06-workflow';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { taskView } from './views.ts';

/**
 * Human tasks, under `/api/v1/workflow` (D2).
 *
 * A task moves claim → complete/reject, and may be assigned, reassigned, delegated or escalated. Maker-checker
 * (SoD) is enforced in `TaskService` — the completing identity cannot be the one the domain forbids — so it is
 * not re-litigated here. Every mutation carries `expectedVersion` for optimistic concurrency; the service is
 * the single place each `@Endpoint` permission is checked.
 */

interface ExpectedVersionBody {
  expectedVersion?: unknown;
}

interface AssignBody {
  expectedVersion?: unknown;
  assigneeKind?: unknown;
  assigneeRef?: unknown;
}

interface CompleteBody {
  expectedVersion?: unknown;
  transitionKey?: unknown;
  decision?: unknown;
}

interface RejectBody {
  expectedVersion?: unknown;
  transitionKey?: unknown;
  reason?: unknown;
}

interface DelegateBody {
  expectedVersion?: unknown;
  assigneeRef?: unknown;
}

interface EscalateBody {
  expectedVersion?: unknown;
  reason?: unknown;
}

@Controller('workflow')
export class TasksController {
  private readonly service: TaskService;
  private readonly actors: ActorContextFactory;

  constructor(service: TaskService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  @Get('tasks/:id')
  async get(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'read workflow task (m06)'));
    const row = await this.service.view(scoped.ctx, id);
    if (row === null) throw ProblemError.notFound('Workflow task not found.', scoped.correlationId);
    return taskView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.taskClaim,
    auditCode: M06_AUDIT_CODES.taskClaimed,
    description: 'Claim an available task. Requires expectedVersion.',
  })
  @Post('tasks/:id/claim')
  async claim(
    @Param('id') id: string,
    @Body() body: ExpectedVersionBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'claim workflow task (m06)'));
    const row = await this.service.claim(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
    );
    return taskView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.taskAssign,
    auditCode: M06_AUDIT_CODES.taskAssigned,
    description: 'Assign a task to a principal. Requires expectedVersion.',
  })
  @Post('tasks/:id/assign')
  async assign(
    @Param('id') id: string,
    @Body() body: AssignBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'assign workflow task (m06)'));
    const cid = scoped.correlationId;
    const row = await this.service.assign(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, cid),
      requireString(body.assigneeKind, 'assigneeKind', cid),
      requireString(body.assigneeRef, 'assigneeRef', cid),
    );
    return taskView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.taskReassign,
    auditCode: M06_AUDIT_CODES.taskReassigned,
    description: 'Reassign a task to a different principal. Requires expectedVersion.',
  })
  @Post('tasks/:id/reassign')
  async reassign(
    @Param('id') id: string,
    @Body() body: AssignBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'reassign workflow task (m06)'));
    const cid = scoped.correlationId;
    const row = await this.service.reassign(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, cid),
      requireString(body.assigneeKind, 'assigneeKind', cid),
      requireString(body.assigneeRef, 'assigneeRef', cid),
    );
    return taskView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.taskComplete,
    auditCode: M06_AUDIT_CODES.taskCompleted,
    description: 'Complete a task, choosing an outgoing transition. Requires expectedVersion.',
  })
  @Post('tasks/:id/complete')
  async complete(
    @Param('id') id: string,
    @Body() body: CompleteBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'complete workflow task (m06)'));
    const row = await this.service.complete(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
      {
        ...(typeof body.transitionKey === 'string' ? { transitionKey: body.transitionKey } : {}),
        ...('decision' in body ? { decision: body.decision } : {}),
      },
    );
    return taskView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.taskReject,
    auditCode: M06_AUDIT_CODES.taskRejected,
    description: 'Reject a task with a reason. Requires expectedVersion.',
  })
  @Post('tasks/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: RejectBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'reject workflow task (m06)'));
    const cid = scoped.correlationId;
    const row = await this.service.reject(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, cid),
      {
        ...(typeof body.transitionKey === 'string' ? { transitionKey: body.transitionKey } : {}),
        reason: requireString(body.reason, 'reason', cid),
      },
    );
    return taskView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.taskDelegate,
    auditCode: M06_AUDIT_CODES.taskDelegated,
    description: 'Delegate a task to another user. Requires expectedVersion.',
  })
  @Post('tasks/:id/delegate')
  async delegate(
    @Param('id') id: string,
    @Body() body: DelegateBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'delegate workflow task (m06)'));
    const cid = scoped.correlationId;
    const row = await this.service.delegate(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, cid),
      requireString(body.assigneeRef, 'assigneeRef', cid),
    );
    return taskView(row);
  }

  @Endpoint({
    permission: M06_PERMISSIONS.taskEscalate,
    auditCode: M06_AUDIT_CODES.taskEscalated,
    description: 'Escalate a task with a reason. Requires expectedVersion.',
  })
  @Post('tasks/:id/escalate')
  async escalate(
    @Param('id') id: string,
    @Body() body: EscalateBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'escalate workflow task (m06)'));
    const cid = scoped.correlationId;
    const row = await this.service.escalate(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, cid),
      requireString(body.reason, 'reason', cid),
    );
    return taskView(row);
  }
}
