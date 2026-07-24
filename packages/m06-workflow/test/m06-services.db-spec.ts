import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M06Emitter,
  WorkflowRepository,
  DefinitionService,
  InstanceService,
  TaskService,
  SlaService,
  M06_PERMISSIONS,
  ALL_M06_PERMISSIONS,
} from '@finapp/m06-workflow';

/**
 * M06 services DB spec — proves the engine works end-to-end on a REAL PostgreSQL and enforces its governance:
 * authoring lifecycle, default-deny authorization, single-winner task completion, and maker != checker
 * (no self-approval). Authorization is the real RbacAuthz reading ctx.permissions; audit/outbox use the
 * in-memory stand-ins here (the durable outbox + audit atomicity are proven by their own specs).
 */
export default defineDbSpec('m06-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new M06Emitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new WorkflowRepository();
  const sla = new SlaService(db, emitter, repo);
  const defs = new DefinitionService(db, authz, emitter, repo);
  const instances = new InstanceService(db, authz, emitter, repo, sla);
  const tasks = new TaskService(db, authz, emitter, instances, repo);

  const tenant = randomUUID();
  const maker = randomUUID();
  const checker = randomUUID();
  const cid = (): string => randomUUID();
  const author: RequestContext = {
    tenantId: tenant,
    userId: maker,
    correlationId: cid(),
    permissions: [...ALL_M06_PERMISSIONS],
  };
  const checkerCtx: RequestContext = {
    tenantId: tenant,
    userId: checker,
    correlationId: cid(),
    permissions: [M06_PERMISSIONS.taskView, M06_PERMISSIONS.taskClaim, M06_PERMISSIONS.taskComplete],
  };
  const noPerm: RequestContext = { tenantId: tenant, userId: maker, correlationId: cid(), permissions: [] };

  const spec = {
    schemaVersion: 1,
    code: 'approval_flow',
    name: 'Approval flow',
    variables: [{ name: 'amount', type: 'number' }],
    nodes: [
      { key: 'start', type: 'START' },
      { key: 'approve', type: 'APPROVAL_TASK' },
      { key: 'approved', type: 'END' },
      { key: 'rejected', type: 'END' },
    ],
    transitions: [
      { key: 't0', from: 'start', to: 'approve' },
      { key: 't_ok', from: 'approve', to: 'approved', condition: 'amount >= 0' },
      { key: 't_no', from: 'approve', to: 'rejected' },
    ],
    sla: [{ key: 's1', slaType: 'response', nodeKey: 'approve', targetSeconds: 3600, warnPct: 50 }],
  };

  // --- authoring lifecycle: create -> validate -> publish -> activate ----------------------------
  const created = await defs.create(author, maker, { code: 'approval_flow', name: 'Approval flow', spec });
  t.ok(created.version.status === 'DRAFT', 'a new definition version starts DRAFT');
  const validated = await defs.validate(author, maker, created.version.id, created.version.version);
  t.equal(validated.status, 'VALIDATED', 'a well-formed version validates');
  const published = await defs.publish(author, maker, validated.id, validated.version);
  t.equal(published.status, 'PUBLISHED', 'a validated version publishes (content frozen)');
  t.ok(published.content_hash !== null, 'publishing computes a content hash');
  const activated = await defs.activate(author, maker, published.id, published.version);
  t.equal(activated.status, 'ACTIVE', 'a published version activates');

  // --- default deny: no permission cannot start --------------------------------------------------
  let denied = false;
  try {
    await instances.start(noPerm, maker, { definitionId: created.definition.id });
  } catch (e) {
    denied = e instanceof Error && 'status' in e && (e as { status: number }).status === 403;
  }
  t.ok(denied, 'starting without workflow.instance.start is forbidden (default deny)');

  // --- start drives to the approval task and parks -----------------------------------------------
  const instance = await instances.start(author, maker, {
    definitionId: created.definition.id,
    businessKey: 'req-1',
    variables: { amount: 100 },
  });
  const afterStart = await instances.view(author, instance.id);
  t.equal(afterStart?.status, 'WAITING', 'the instance parks WAITING at the approval task');
  const task1 = await db.withTenant(author, (tx) =>
    tx.query<{ id: string; version: number }>(
      `SELECT id, version FROM workflow_task WHERE instance_id = $1 AND status = 'AVAILABLE'`,
      [instance.id],
    ),
  );
  const taskId = task1.rows[0]?.id ?? '';
  t.ok(taskId.length > 0, 'an AVAILABLE approval task was created');

  // --- SLA: a clock + warn/breach timers were scheduled for the task (ADR-025) -------------------
  const slaState = await db.withTenant(author, async (tx) => {
    const clocks = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM workflow_sla_clock WHERE instance_id = $1`,
      [instance.id],
    );
    const timers = await tx.query<{ id: string; kind: string }>(
      `SELECT id, kind FROM workflow_timer WHERE instance_id = $1 ORDER BY kind`,
      [instance.id],
    );
    return { clocks: clocks.rows[0]?.n ?? '0', timers: timers.rows };
  });
  t.equal(slaState.clocks, '1', 'an SLA clock was started for the task');
  t.equal(slaState.timers.length, 2, 'warn + breach timers were scheduled');
  const breachTimer = slaState.timers.find((tk) => tk.kind === 'sla_breach');
  const fired = await sla.fire(author, breachTimer?.id ?? '');
  t.equal(fired, 'breached', 'firing the breach timer records a breach');
  const firedAgain = await sla.fire(author, breachTimer?.id ?? '');
  t.equal(firedAgain, 'noop', 'firing the same timer again is a no-op (breach emitted once)');

  // --- idempotent start --------------------------------------------------------------------------
  const again = await instances.start(author, maker, {
    definitionId: created.definition.id,
    businessKey: 'req-1',
  });
  t.equal(
    again.id,
    instance.id,
    'starting with the same business_key returns the same instance (idempotent)',
  );

  // --- maker != checker: the maker cannot approve their own request ------------------------------
  await tasks.claim(author, maker, taskId, task1.rows[0]?.version ?? 1);
  const claimedByMaker = await tasks.view(author, taskId);
  let selfApprovalBlocked = false;
  try {
    await tasks.complete(author, maker, taskId, claimedByMaker?.version ?? 1, { transitionKey: 't_ok' });
  } catch (e) {
    selfApprovalBlocked = e instanceof Error && 'status' in e && (e as { status: number }).status === 403;
  }
  t.ok(selfApprovalBlocked, 'the maker cannot approve their own request (maker != checker)');

  // release + let the checker claim & complete ----------------------------------------------------
  // reassign back to the queue so the checker can claim (the maker is not the checker)
  await tasks.reassign(
    author,
    maker,
    taskId,
    (await tasks.view(author, taskId))?.version ?? 1,
    'role',
    'reviewer',
  );
  const availTask = await tasks.view(author, taskId);
  await tasks.claim(checkerCtx, checker, taskId, availTask?.version ?? 1);
  const claimedByChecker = await tasks.view(checkerCtx, taskId);
  const completed = await tasks.complete(checkerCtx, checker, taskId, claimedByChecker?.version ?? 1, {
    transitionKey: 't_ok',
  });
  t.equal(completed.status, 'COMPLETED', 'the checker completes the approval task');

  // --- the instance drives to END and COMPLETES --------------------------------------------------
  const finalInstance = await instances.view(author, instance.id);
  t.equal(finalInstance?.status, 'COMPLETED', 'completing the last task drives the instance to COMPLETED');

  // --- double completion is impossible -----------------------------------------------------------
  let doubleBlocked = false;
  try {
    await tasks.complete(checkerCtx, checker, taskId, claimedByChecker?.version ?? 1, {
      transitionKey: 't_ok',
    });
  } catch (e) {
    doubleBlocked = e instanceof Error && 'status' in e && (e as { status: number }).status === 409;
  }
  t.ok(doubleBlocked, 'completing an already-completed task is a 409 (no double completion)');

  // --- default deny on completion ----------------------------------------------------------------
  const inst2 = await instances.start(author, maker, {
    definitionId: created.definition.id,
    businessKey: 'req-2',
    variables: { amount: 1 },
  });
  const task2 = await db.withTenant(author, (tx) =>
    tx.query<{ id: string; version: number }>(
      `SELECT id, version FROM workflow_task WHERE instance_id = $1 AND status = 'AVAILABLE'`,
      [inst2.id],
    ),
  );
  const t2 = task2.rows[0];
  await tasks.claim(checkerCtx, checker, t2?.id ?? '', t2?.version ?? 1);
  let completeDenied = false;
  try {
    await tasks.complete(noPerm, maker, t2?.id ?? '', 1, { transitionKey: 't_ok' });
  } catch (e) {
    completeDenied = e instanceof Error && 'status' in e && (e as { status: number }).status === 403;
  }
  t.ok(
    completeDenied,
    'completing without workflow.task.complete is forbidden (authz re-evaluated at execution)',
  );
});
