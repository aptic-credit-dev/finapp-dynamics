/**
 * InstanceService — starts and drives workflow instances (ADR-021/022/023). Starting resolves the ACTIVE,
 * frozen version, is idempotent on `business_key`, mints a START token and drives execution until the flow
 * parks (a task/timer/event), completes, or cancels. All work runs in `db.withTenant` under a per-instance
 * advisory lock (serialising token accounting), with audit + outbox in the same transaction. The engine
 * decision at each node is the PURE `directiveForNode`; this service performs the effect.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M06_PERMISSIONS } from './permissions.ts';
import { M06_AUDIT_CODES } from './audit-codes.ts';
import { checkInstanceTransition, type InstanceAction } from './domain/lifecycles.ts';
import { directiveForNode, outgoingEdges } from './domain/engine.ts';
import { DEFINITION_LIMITS, type WorkflowDefinitionSpec } from './domain/definition.ts';
import type { WorkflowValue } from './domain/expression.ts';
import { WorkflowRepository, type InstanceRow } from './repository.ts';
import { type M06Emitter } from './emit.ts';
import { type SlaService } from './sla.service.ts';

interface WorkItem {
  tokenId: string;
  nodeKey: string;
  version: number;
}

function startNodeKey(spec: WorkflowDefinitionSpec): string | null {
  return spec.nodes.find((n) => n.type === 'START')?.key ?? null;
}

function inDegree(spec: WorkflowDefinitionSpec, nodeKey: string): number {
  return spec.transitions.filter((t) => t.to === nodeKey).length;
}

function resolveAssignment(
  spec: WorkflowDefinitionSpec,
  nodeKey: string,
): { kind: string | null; ref: string | null } {
  const rule = spec.assignment?.find((a) => a.nodeKey === nodeKey);
  if (rule === undefined) return { kind: null, ref: null };
  const ref = typeof rule.params?.['ref'] === 'string' ? rule.params['ref'] : null;
  const kindByStrategy: Record<string, string> = {
    named_user: 'user',
    role: 'role',
    department: 'department',
    branch: 'branch',
    entity: 'entity',
    unassigned_queue: 'queue',
    escalation_chain: 'queue',
  };
  return { kind: kindByStrategy[rule.strategy] ?? 'queue', ref };
}

export class InstanceService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M06Emitter;
  private readonly repo: WorkflowRepository;
  private readonly sla: SlaService | null;

  constructor(
    db: Db,
    authz: Authz,
    emitter: M06Emitter,
    repo: WorkflowRepository = new WorkflowRepository(),
    sla: SlaService | null = null,
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.sla = sla;
  }

  async start(
    ctx: RequestContext,
    actor: string | null,
    input: {
      definitionId: string;
      businessKey?: string | null;
      subjectType?: string | null;
      subjectId?: string | null;
      variables?: Record<string, unknown>;
    },
  ): Promise<InstanceRow> {
    await this.authz.require(ctx, M06_PERMISSIONS.instanceStart);
    return this.db.withTenant(ctx, async (tx) => {
      // Idempotent start: an existing instance for this (definition, business_key) is returned as-is.
      if (input.businessKey != null && input.businessKey !== '') {
        const existing = await this.repo.findInstanceByBusinessKey(tx, input.definitionId, input.businessKey);
        if (existing !== null) return existing;
      }
      const active = await this.repo.findActiveVersion(tx, input.definitionId);
      if (active === null)
        throw ProblemError.conflict('The workflow has no ACTIVE version to start.', ctx.correlationId);
      const spec = active.spec as WorkflowDefinitionSpec;
      const start = startNodeKey(spec);
      if (start === null)
        throw ProblemError.conflict('The workflow definition has no START node.', ctx.correlationId);

      const instance = await this.repo.insertInstance(tx, {
        tenantId: ctx.tenantId,
        definitionId: input.definitionId,
        versionId: active.id,
        businessKey: input.businessKey ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        variables: input.variables ?? {},
        startedBy: actor,
      });
      const running = await this.repo.updateInstanceStatus(tx, {
        id: instance.id,
        expectedVersion: instance.version,
        toStatus: 'RUNNING',
      });
      if (running === null)
        throw ProblemError.conflict('Instance start raced (stale version).', ctx.correlationId);
      await this.repo.appendInstanceHistory(tx, {
        tenantId: ctx.tenantId,
        instanceId: instance.id,
        fromStatus: null,
        toStatus: 'RUNNING',
        action: 'start',
        reason: null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M06_AUDIT_CODES.instanceStarted,
        entityType: 'workflow_instance',
        entityId: instance.id,
        detail: { definitionId: input.definitionId },
      });
      await this.emitter.publish(tx, {
        type: 'WorkflowInstanceStarted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          instanceId: instance.id,
          definitionId: input.definitionId,
          versionId: active.id,
          toStatus: 'RUNNING',
        },
      });

      const startToken = await this.repo.insertToken(tx, {
        tenantId: ctx.tenantId,
        instanceId: instance.id,
        nodeKey: start,
        branchKey: null,
        joinKey: null,
      });
      await this.drive(tx, ctx, running, spec, [{ tokenId: startToken, nodeKey: start, version: 1 }], actor);
      return (await this.repo.findInstance(tx, instance.id)) ?? running;
    });
  }

  /**
   * The engine drive loop. Processes a worklist of tokens until the flow parks, ends, or cancels. Serialised
   * per instance by an advisory lock held to end-of-transaction (deterministic token accounting, ADR-023).
   */
  async drive(
    tx: Tx,
    ctx: RequestContext,
    instance: InstanceRow,
    spec: WorkflowDefinitionSpec,
    worklist: WorkItem[],
    actor: string | null,
  ): Promise<void> {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [instance.id]);
    const env = instance.variables as Record<string, WorkflowValue>;
    let parked = false;
    let cancelled = false;
    let iterations = 0;

    const advance = async (
      targets: readonly { transitionKey: string; to: string }[],
      joinKey: string | null,
    ): Promise<void> => {
      for (const tgt of targets) {
        const id = await this.repo.insertToken(tx, {
          tenantId: ctx.tenantId,
          instanceId: instance.id,
          nodeKey: tgt.to,
          branchKey: joinKey === null ? null : tgt.transitionKey,
          joinKey,
        });
        worklist.push({ tokenId: id, nodeKey: tgt.to, version: 1 });
      }
    };

    while (worklist.length > 0) {
      if (++iterations > DEFINITION_LIMITS.maxLoopIterations) {
        await this.repo.insertIncident(tx, {
          tenantId: ctx.tenantId,
          instanceId: instance.id,
          taskId: null,
          errorCode: 'LOOP_LIMIT',
          errorDetail: { iterations },
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M06_AUDIT_CODES.incidentCreated,
          entityType: 'workflow_instance',
          entityId: instance.id,
          reason: 'loop iteration limit exceeded',
        });
        parked = true;
        break;
      }
      const item = worklist.shift();
      if (item === undefined) break;
      const dir = directiveForNode(spec, item.nodeKey, env);

      if (dir.kind === 'advance') {
        await this.repo.consumeToken(tx, item.tokenId, item.version);
        await advance(dir.targets, null);
      } else if (dir.kind === 'split') {
        await this.repo.consumeToken(tx, item.tokenId, item.version);
        await advance(dir.targets, dir.joinKey);
      } else if (dir.kind === 'join') {
        await this.repo.consumeToken(tx, item.tokenId, item.version);
        const arrived = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM workflow_token WHERE instance_id = $1 AND node_key = $2 AND status = 'consumed'`,
          [instance.id, item.nodeKey],
        );
        if ((arrived.rows[0]?.n ?? 0) >= inDegree(spec, item.nodeKey)) {
          await advance(outgoingEdges(spec, item.nodeKey), null);
        }
      } else if (dir.kind === 'wait_task') {
        // Idempotent park: if an OPEN task already exists at this node (e.g. this is a retry re-driving the
        // same token), do not create a duplicate — just park.
        const existing = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM workflow_task WHERE instance_id = $1 AND node_key = $2
             AND status IN ('AVAILABLE', 'CLAIMED', 'IN_PROGRESS')`,
          [instance.id, item.nodeKey],
        );
        if ((existing.rows[0]?.n ?? 0) > 0) {
          parked = true;
          continue;
        }
        const assign = resolveAssignment(spec, item.nodeKey);
        const task = await this.repo.insertTask(tx, {
          tenantId: ctx.tenantId,
          instanceId: instance.id,
          nodeKey: item.nodeKey,
          taskType: dir.taskType,
          status: 'AVAILABLE',
          assigneeKind: assign.kind,
          assigneeRef: assign.ref,
          makerId: instance.started_by,
          dueAt: null,
        });
        await this.repo.appendTaskHistory(tx, {
          tenantId: ctx.tenantId,
          taskId: task.id,
          fromStatus: null,
          toStatus: 'AVAILABLE',
          action: 'create',
          reason: null,
          correlationId: ctx.correlationId,
          changedBy: actor,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M06_AUDIT_CODES.taskCreated,
          entityType: 'workflow_task',
          entityId: task.id,
          detail: { nodeKey: item.nodeKey },
        });
        await this.emitter.publish(tx, {
          type: 'WorkflowTaskCreated',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            taskId: task.id,
            instanceId: instance.id,
            nodeKey: item.nodeKey,
            taskType: dir.taskType,
            toStatus: 'AVAILABLE',
          },
        });
        if (this.sla !== null) {
          await this.sla.scheduleForNode(tx, ctx, {
            instanceId: instance.id,
            taskId: task.id,
            nodeKey: item.nodeKey,
            spec,
            now: new Date(),
          });
        }
        parked = true; // token stays active as the park marker
      } else if (dir.kind === 'wait_timer') {
        await this.repo.insertTimer(tx, {
          tenantId: ctx.tenantId,
          instanceId: instance.id,
          nodeKey: item.nodeKey,
          kind: 'node',
          fireAt: new Date(Date.now() + 60_000),
          dedupeKey: `node:${instance.id}:${item.nodeKey}`,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M06_AUDIT_CODES.timerScheduled,
          entityType: 'workflow_instance',
          entityId: instance.id,
          detail: { nodeKey: item.nodeKey },
        });
        parked = true;
      } else if (dir.kind === 'wait_event') {
        parked = true;
      } else if (dir.kind === 'run_system') {
        if (dir.handler === 'noop') {
          await this.repo.consumeToken(tx, item.tokenId, item.version);
          await advance([dir.next], null);
        } else {
          await this.repo.insertIncident(tx, {
            tenantId: ctx.tenantId,
            instanceId: instance.id,
            taskId: null,
            errorCode: 'UNKNOWN_HANDLER',
            errorDetail: { handler: dir.handler },
          });
          await this.emitter.recordAudit(tx, ctx, {
            code: M06_AUDIT_CODES.incidentCreated,
            entityType: 'workflow_instance',
            entityId: instance.id,
            reason: `unknown system handler '${dir.handler}'`,
          });
          parked = true;
        }
      } else if (dir.kind === 'escalate') {
        await this.repo.consumeToken(tx, item.tokenId, item.version);
        await this.emitter.recordAudit(tx, ctx, {
          code: M06_AUDIT_CODES.taskEscalated,
          entityType: 'workflow_instance',
          entityId: instance.id,
          reason: 'escalation node',
        });
        await advance(dir.targets, null);
      } else if (dir.kind === 'cancel') {
        await this.repo.consumeToken(tx, item.tokenId, item.version);
        cancelled = true;
      } else {
        // 'end'
        await this.repo.consumeToken(tx, item.tokenId, item.version);
      }
    }

    const active = await this.repo.activeTokens(tx, instance.id);
    // Completion/cancellation happen from RUNNING; a resumed drive may have entered while WAITING, so
    // unblock first. `unblock` is a silent engine step (no audit) — see applyStatusInTx.
    const current = await this.repo.findInstance(tx, instance.id);
    if (current !== null && current.status === 'WAITING') {
      await this.applyStatusInTx(tx, ctx, instance.id, 'unblock', actor, null);
    }
    if (cancelled) {
      await this.applyStatusInTx(tx, ctx, instance.id, 'cancel', actor, 'cancelled by CANCEL node');
    } else if (active.length === 0) {
      await this.applyStatusInTx(tx, ctx, instance.id, 'complete', actor, null);
    } else if (parked) {
      await this.applyStatusInTx(tx, ctx, instance.id, 'block', actor, null);
    }
  }

  /** Apply an instance status transition inside an existing tx (used by drive and by the admin actions). */
  private async applyStatusInTx(
    tx: Tx,
    ctx: RequestContext,
    instanceId: string,
    action: InstanceAction,
    actor: string | null,
    reason: string | null,
  ): Promise<void> {
    const instance = await this.repo.findInstance(tx, instanceId);
    if (instance === null) throw ProblemError.notFound('Workflow instance not found.', ctx.correlationId);
    const check = checkInstanceTransition(instance.status as never, action);
    if (!check.ok) return; // already in a compatible state (e.g. blocking a completed instance) — no-op
    const updated = await this.repo.updateInstanceStatus(tx, {
      id: instanceId,
      expectedVersion: instance.version,
      toStatus: check.to,
    });
    if (updated === null)
      throw ProblemError.conflict('Instance was modified concurrently (stale version).', ctx.correlationId);
    await this.repo.appendInstanceHistory(tx, {
      tenantId: ctx.tenantId,
      instanceId,
      fromStatus: instance.status,
      toStatus: check.to,
      action,
      reason,
      correlationId: ctx.correlationId,
      changedBy: actor,
    });
    // Audit keys off the ACTION, not the target status, so engine-internal `block`/`unblock` steps stay
    // silent while the admin `suspend`/`resume` and terminal `complete`/`cancel` are recorded.
    const auditCode =
      action === 'complete'
        ? M06_AUDIT_CODES.instanceCompleted
        : action === 'cancel'
          ? M06_AUDIT_CODES.instanceCancelled
          : action === 'suspend'
            ? M06_AUDIT_CODES.instanceSuspended
            : action === 'resume'
              ? M06_AUDIT_CODES.instanceResumed
              : null;
    if (auditCode !== null) {
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'workflow_instance',
        entityId: instanceId,
        ...(reason !== null ? { reason } : {}),
      });
    }
    if (check.to === 'COMPLETED' || check.to === 'CANCELLED') {
      await this.emitter.publish(tx, {
        type: check.to === 'COMPLETED' ? 'WorkflowInstanceCompleted' : 'WorkflowInstanceCancelled',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          instanceId,
          definitionId: instance.definition_id,
          versionId: instance.version_id,
          toStatus: check.to,
          ...(reason !== null ? { reason } : {}),
        },
      });
    }
  }

  private async adminAction(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    action: InstanceAction,
    permission: string,
    reason: string | null,
  ): Promise<InstanceRow> {
    await this.authz.require(ctx, permission);
    return this.db.withTenant(ctx, async (tx) => {
      await this.applyStatusInTx(tx, ctx, id, action, actor, reason);
      const updated = await this.repo.findInstance(tx, id);
      if (updated === null) throw ProblemError.notFound('Workflow instance not found.', ctx.correlationId);
      return updated;
    });
  }

  suspend(ctx: RequestContext, actor: string | null, id: string, reason: string): Promise<InstanceRow> {
    return this.adminAction(ctx, actor, id, 'suspend', M06_PERMISSIONS.instanceSuspend, reason);
  }
  resume(ctx: RequestContext, actor: string | null, id: string): Promise<InstanceRow> {
    return this.adminAction(ctx, actor, id, 'resume', M06_PERMISSIONS.instanceResume, null);
  }
  cancel(ctx: RequestContext, actor: string | null, id: string, reason: string): Promise<InstanceRow> {
    return this.adminAction(ctx, actor, id, 'cancel', M06_PERMISSIONS.instanceCancel, reason);
  }

  /**
   * Re-drive a non-terminal instance's active tokens — recovery after a process crash or after an incident is
   * resolved. The drive is idempotent for parked task nodes (no duplicate task), so this is safe to repeat.
   */
  async retry(ctx: RequestContext, actor: string | null, id: string): Promise<InstanceRow> {
    await this.authz.require(ctx, M06_PERMISSIONS.instanceRetry);
    return this.db.withTenant(ctx, async (tx) => {
      const instance = await this.repo.findInstance(tx, id);
      if (instance === null) throw ProblemError.notFound('Workflow instance not found.', ctx.correlationId);
      if (instance.status === 'COMPLETED' || instance.status === 'CANCELLED') {
        throw ProblemError.conflict('A terminal workflow instance cannot be retried.', ctx.correlationId);
      }
      const version = await this.repo.findVersion(tx, instance.version_id);
      if (version === null)
        throw ProblemError.conflict('Workflow version missing for instance.', ctx.correlationId);
      const spec = version.spec as WorkflowDefinitionSpec;
      const active = await this.repo.activeTokens(tx, id);
      const worklist = active.map((tk) => ({ tokenId: tk.id, nodeKey: tk.node_key, version: tk.version }));
      await this.drive(tx, ctx, instance, spec, worklist, actor);
      return (await this.repo.findInstance(tx, id)) ?? instance;
    });
  }

  async view(ctx: RequestContext, id: string): Promise<InstanceRow | null> {
    await this.authz.require(ctx, M06_PERMISSIONS.instanceView);
    return this.db.withTenant(ctx, (tx) => this.repo.findInstance(tx, id));
  }
}
