/**
 * TaskService — the human side of the engine (ADR-023/026). Claim takes a single-winner lease; complete /
 * reject re-evaluate authorization AT EXECUTION TIME (a revoked permission blocks completion), enforce
 * maker != checker (no self-approval — the core SoD rule), record audit + outbox, and RESUME the instance
 * drive down the chosen edge. Double completion is impossible: the status change is guarded by both the
 * expected version and the legal from-statuses, so exactly one concurrent completer wins.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M06_PERMISSIONS } from './permissions.ts';
import { M06_AUDIT_CODES } from './audit-codes.ts';
import { edgeAfterTask } from './domain/engine.ts';
import type { WorkflowDefinitionSpec } from './domain/definition.ts';
import { WorkflowRepository, type TaskRow } from './repository.ts';
import { type M06Emitter } from './emit.ts';
import { type InstanceService } from './instance.service.ts';
import { badRequest } from './errors.ts';

export class TaskService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M06Emitter;
  private readonly instances: InstanceService;
  private readonly repo: WorkflowRepository;

  constructor(
    db: Db,
    authz: Authz,
    emitter: M06Emitter,
    instances: InstanceService,
    repo: WorkflowRepository = new WorkflowRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.instances = instances;
    this.repo = repo;
  }

  async view(ctx: RequestContext, id: string): Promise<TaskRow | null> {
    await this.authz.require(ctx, M06_PERMISSIONS.taskView);
    return this.db.withTenant(ctx, (tx) => this.repo.findTask(tx, id));
  }

  /** Claim an AVAILABLE task — single-winner via the version + status guard. */
  async claim(ctx: RequestContext, actor: string, id: string, expectedVersion: number): Promise<TaskRow> {
    await this.authz.require(ctx, M06_PERMISSIONS.taskClaim);
    return this.db.withTenant(ctx, async (tx) => {
      const claimed = await this.repo.applyTaskStatus(tx, {
        id,
        expectedVersion,
        fromStatuses: ['AVAILABLE'],
        toStatus: 'CLAIMED',
        claimedBy: actor,
        leaseExpiresAt: new Date(Date.now() + 30 * 60_000),
      });
      if (claimed === null)
        throw ProblemError.conflict(
          'Task is not available to claim (already claimed or stale).',
          ctx.correlationId,
        );
      await this.repo.appendTaskHistory(tx, {
        tenantId: ctx.tenantId,
        taskId: id,
        fromStatus: 'AVAILABLE',
        toStatus: 'CLAIMED',
        action: 'claim',
        reason: null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M06_AUDIT_CODES.taskClaimed,
        entityType: 'workflow_task',
        entityId: id,
      });
      return claimed;
    });
  }

  private async finish(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    action: 'complete' | 'reject',
    input: { transitionKey?: string; decision?: unknown; reason?: string },
  ): Promise<TaskRow> {
    // Authorization is re-evaluated HERE, at execution time — a permission revoked after task creation blocks
    // completion (ctx.permissions are resolved fresh per request by the API actor boundary).
    await this.authz.require(
      ctx,
      action === 'complete' ? M06_PERMISSIONS.taskComplete : M06_PERMISSIONS.taskReject,
    );
    const toStatus = action === 'complete' ? 'COMPLETED' : 'REJECTED';
    const auditCode = action === 'complete' ? M06_AUDIT_CODES.taskCompleted : M06_AUDIT_CODES.taskRejected;

    return this.db.withTenant(ctx, async (tx) => {
      const task = await this.repo.findTask(tx, id);
      if (task === null) throw ProblemError.notFound('Workflow task not found.', ctx.correlationId);

      // maker != checker: an approval cannot be completed by the identity that started the process (ADR-026).
      if (task.task_type === 'APPROVAL_TASK' && task.maker_id !== null && task.maker_id === actor) {
        throw ProblemError.forbidden(
          'The maker of a process may not approve their own request (segregation of duties).',
          ctx.correlationId,
        );
      }
      // Only the claimer (or a reassigner/admin) may act on a claimed task.
      if (
        task.claimed_by !== null &&
        task.claimed_by !== actor &&
        !ctx.permissions.includes(M06_PERMISSIONS.taskReassign) &&
        !ctx.permissions.includes(M06_PERMISSIONS.engineAdminister)
      ) {
        throw ProblemError.forbidden('Only the task assignee may act on this task.', ctx.correlationId);
      }

      const finished = await this.repo.applyTaskStatus(tx, {
        id,
        expectedVersion,
        fromStatuses: ['CLAIMED', 'IN_PROGRESS'],
        toStatus,
        decision: input.decision,
      });
      if (finished === null)
        throw ProblemError.conflict(
          'Task cannot be completed (already terminal, unclaimed, or stale version).',
          ctx.correlationId,
        );

      await this.repo.appendTaskHistory(tx, {
        tenantId: ctx.tenantId,
        taskId: id,
        fromStatus: task.status,
        toStatus,
        action,
        reason: input.reason ?? null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'workflow_task',
        entityId: id,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        detail: { nodeKey: task.node_key },
      });
      await this.emitter.publish(tx, {
        type: action === 'complete' ? 'WorkflowTaskCompleted' : 'WorkflowTaskRejected',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: { taskId: id, instanceId: task.instance_id, nodeKey: task.node_key, toStatus },
      });

      // Resume the instance: consume the parked token at this node and advance down the chosen edge.
      const instance = await this.repo.findInstance(tx, task.instance_id);
      if (instance === null) throw ProblemError.notFound('Workflow instance not found.', ctx.correlationId);
      const version = await this.repo.findVersion(tx, instance.version_id);
      if (version === null)
        throw ProblemError.conflict('Workflow version missing for instance.', ctx.correlationId);
      const spec = version.spec as WorkflowDefinitionSpec;

      const tokens = await this.repo.activeTokens(tx, instance.id);
      const parked = tokens.find((tk) => tk.node_key === task.node_key);
      if (parked !== undefined) {
        const edges = spec.transitions.filter((tr) => tr.from === task.node_key);
        const chosenKey = input.transitionKey ?? edges[0]?.key;
        if (chosenKey === undefined)
          throw badRequest('The task node has no outgoing transition to follow.', ctx.correlationId);
        const edge = edgeAfterTask(spec, task.node_key, chosenKey);
        await this.repo.consumeToken(tx, parked.id, parked.version);
        const nextToken = await this.repo.insertToken(tx, {
          tenantId: ctx.tenantId,
          instanceId: instance.id,
          nodeKey: edge.to,
          branchKey: null,
          joinKey: null,
        });
        await this.instances.drive(
          tx,
          ctx,
          instance,
          spec,
          [{ tokenId: nextToken, nodeKey: edge.to, version: 1 }],
          actor,
        );
      }
      const after = await this.repo.findTask(tx, id);
      return after ?? finished;
    });
  }

  complete(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    input: { transitionKey?: string; decision?: unknown },
  ): Promise<TaskRow> {
    return this.finish(ctx, actor, id, expectedVersion, 'complete', input);
  }

  reject(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    input: { transitionKey?: string; reason: string },
  ): Promise<TaskRow> {
    return this.finish(ctx, actor, id, expectedVersion, 'reject', input);
  }

  private async reassignInner(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    assigneeKind: string,
    assigneeRef: string,
    permission: string,
    auditCode: string,
    action: string,
  ): Promise<TaskRow> {
    await this.authz.require(ctx, permission);
    return this.db.withTenant(ctx, async (tx) => {
      const task = await this.repo.findTask(tx, id);
      if (task === null) throw ProblemError.notFound('Workflow task not found.', ctx.correlationId);
      const r = await tx.query<TaskRow>(
        `UPDATE workflow_task
           SET assignee_kind = $3, assignee_ref = $4, claimed_by = NULL, status = 'AVAILABLE', version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $2 AND status IN ('AVAILABLE', 'CLAIMED', 'IN_PROGRESS')
         RETURNING tenant_id, id, instance_id, node_key, task_type, status, assignee_kind, assignee_ref, claimed_by, maker_id, version`,
        [id, expectedVersion, assigneeKind, assigneeRef],
      );
      const updated = r.rows[0] ?? null;
      if (updated === null)
        throw ProblemError.conflict(
          'Task cannot be reassigned (terminal or stale version).',
          ctx.correlationId,
        );
      await this.repo.appendTaskHistory(tx, {
        tenantId: ctx.tenantId,
        taskId: id,
        fromStatus: task.status,
        toStatus: 'AVAILABLE',
        action,
        reason: null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'workflow_task',
        entityId: id,
        reason: `${action} to ${assigneeKind}:${assigneeRef}`,
      });
      return updated;
    });
  }

  reassign(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    assigneeKind: string,
    assigneeRef: string,
  ): Promise<TaskRow> {
    return this.reassignInner(
      ctx,
      actor,
      id,
      expectedVersion,
      assigneeKind,
      assigneeRef,
      M06_PERMISSIONS.taskReassign,
      M06_AUDIT_CODES.taskReassigned,
      'reassign',
    );
  }

  assign(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    assigneeKind: string,
    assigneeRef: string,
  ): Promise<TaskRow> {
    return this.reassignInner(
      ctx,
      actor,
      id,
      expectedVersion,
      assigneeKind,
      assigneeRef,
      M06_PERMISSIONS.taskAssign,
      M06_AUDIT_CODES.taskAssigned,
      'assign',
    );
  }

  delegate(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    assigneeRef: string,
  ): Promise<TaskRow> {
    return this.reassignInner(
      ctx,
      actor,
      id,
      expectedVersion,
      'user',
      assigneeRef,
      M06_PERMISSIONS.taskDelegate,
      M06_AUDIT_CODES.taskDelegated,
      'delegate',
    );
  }

  /** Escalate a task — records the escalation and raises an incident for follow-up (MVP). */
  async escalate(
    ctx: RequestContext,
    actor: string,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<TaskRow> {
    await this.authz.require(ctx, M06_PERMISSIONS.taskEscalate);
    return this.db.withTenant(ctx, async (tx) => {
      const task = await this.repo.findTask(tx, id);
      if (task === null) throw ProblemError.notFound('Workflow task not found.', ctx.correlationId);
      const escalated = await this.repo.applyTaskStatus(tx, {
        id,
        expectedVersion,
        fromStatuses: ['AVAILABLE', 'CLAIMED', 'IN_PROGRESS'],
        toStatus: 'ESCALATED',
      });
      if (escalated === null)
        throw ProblemError.conflict(
          'Task cannot be escalated (terminal or stale version).',
          ctx.correlationId,
        );
      await this.repo.insertIncident(tx, {
        tenantId: ctx.tenantId,
        instanceId: task.instance_id,
        taskId: id,
        errorCode: 'TASK_ESCALATED',
        errorDetail: { reason },
      });
      await this.repo.appendTaskHistory(tx, {
        tenantId: ctx.tenantId,
        taskId: id,
        fromStatus: task.status,
        toStatus: 'ESCALATED',
        action: 'escalate',
        reason,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M06_AUDIT_CODES.taskEscalated,
        entityType: 'workflow_task',
        entityId: id,
        reason,
      });
      await this.emitter.publish(tx, {
        type: 'WorkflowTaskEscalated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: {
          taskId: id,
          instanceId: task.instance_id,
          nodeKey: task.node_key,
          toStatus: 'ESCALATED',
          reason,
        },
      });
      return escalated;
    });
  }
}
