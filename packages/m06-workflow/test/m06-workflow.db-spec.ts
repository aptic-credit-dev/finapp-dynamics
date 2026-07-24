import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext, SystemContext } from '@finapp/kernel';
import { WorkflowRepository, WorkflowOutbox } from '@finapp/m06-workflow';
import type { DomainEvent } from '@finapp/contracts';

/**
 * M06 DB integration spec. Proves the workflow schema's load-bearing guarantees on a REAL PostgreSQL through
 * the non-owner application role (RLS enforced, via PgDb bound to `appRole`): FORCE RLS + tenant isolation,
 * append-only history via GRANT, optimistic-lock single-winner completion (double completion impossible),
 * timer fire-once dedupe, and outbox scope coherence. Isolation is only ever asserted through the app role.
 */
export default defineDbSpec('m06-workflow', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const repo = new WorkflowRepository();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const ctxA: RequestContext = { tenantId: tenantA, correlationId: randomUUID(), permissions: [] };
  const ctxB: RequestContext = { tenantId: tenantB, correlationId: randomUUID(), permissions: [] };
  const sys: SystemContext = { reason: 'm06 db-spec dispatcher read', correlationId: randomUUID() };

  // --- RLS FORCE is set on every workflow table ---------------------------------------------------
  const rls = await ctx.pool.query<{ relname: string; relforcerowsecurity: boolean }>(
    `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname LIKE 'workflow_%' AND relkind = 'r'`,
  );
  t.ok(rls.rows.length >= 11, 'all workflow tables exist');
  t.ok(
    rls.rows.every((r) => r.relforcerowsecurity),
    'every workflow table has FORCE ROW LEVEL SECURITY',
  );

  // --- seed a definition/version/instance/task in tenant A ---------------------------------------
  const seeded = await db.withTenant(ctxA, async (tx) => {
    const def = await repo.insertDefinition(tx, {
      tenantId: tenantA,
      code: 'onboarding',
      name: 'Onboarding',
      description: null,
      createdBy: null,
    });
    const ver = await repo.insertVersion(tx, {
      tenantId: tenantA,
      definitionId: def.id,
      versionNumber: 1,
      spec: {
        schemaVersion: 1,
        code: 'onboarding',
        name: 'Onboarding',
        variables: [],
        nodes: [],
        transitions: [],
      },
      createdBy: null,
    });
    const inst = await repo.insertInstance(tx, {
      tenantId: tenantA,
      definitionId: def.id,
      versionId: ver.id,
      businessKey: 'case-1',
      subjectType: 'case',
      subjectId: 'c1',
      variables: { amount: 500 },
      startedBy: null,
    });
    await repo.appendInstanceHistory(tx, {
      tenantId: tenantA,
      instanceId: inst.id,
      fromStatus: null,
      toStatus: 'CREATED',
      action: 'start',
      reason: null,
      correlationId: randomUUID(),
      changedBy: null,
    });
    const task = await repo.insertTask(tx, {
      tenantId: tenantA,
      instanceId: inst.id,
      nodeKey: 'review',
      taskType: 'APPROVAL_TASK',
      status: 'CLAIMED',
      assigneeKind: 'role',
      assigneeRef: 'reviewer',
      makerId: randomUUID(),
      dueAt: null,
    });
    return { defId: def.id, instId: inst.id, taskId: task.id };
  });
  t.ok(seeded.defId.length > 0, 'seeded a definition/version/instance/task in tenant A');

  // --- cross-tenant isolation (through the app role) ---------------------------------------------
  const seenInB = await db.withTenant(ctxB, (tx) => repo.findDefinition(tx, seeded.defId));
  t.equal(seenInB, null, "tenant B cannot see tenant A's definition (RLS isolates)");
  const instInB = await db.withTenant(ctxB, (tx) => repo.findInstance(tx, seeded.instId));
  t.equal(instInB, null, "tenant B cannot see tenant A's instance");
  const seenInA = await db.withTenant(ctxA, (tx) => repo.findDefinition(tx, seeded.defId));
  t.ok(seenInA !== null && seenInA.code === 'onboarding', 'tenant A sees its own definition');
  const defB = await db.withTenant(ctxB, (tx) =>
    repo.insertDefinition(tx, {
      tenantId: tenantB,
      code: 'onboarding',
      name: 'B',
      description: null,
      createdBy: null,
    }),
  );
  t.ok(defB.id !== seeded.defId, 'the same definition code is available in a different tenant');

  // --- append-only history: the app role cannot rewrite evidence ---------------------------------
  await t.rejects(
    db.withTenant(ctxA, (tx) =>
      tx.query(`UPDATE workflow_instance_history SET reason = 'tampered' WHERE instance_id = $1`, [
        seeded.instId,
      ]),
    ),
    'the app role cannot UPDATE instance history (append-only via grant)',
  );
  await t.rejects(
    db.withTenant(ctxA, (tx) =>
      tx.query(`DELETE FROM workflow_instance_history WHERE instance_id = $1`, [seeded.instId]),
    ),
    'the app role cannot DELETE instance history',
  );

  // --- optimistic-lock single-winner: double completion is impossible ----------------------------
  const firstComplete = await db.withTenant(ctxA, (tx) =>
    repo.applyTaskStatus(tx, {
      id: seeded.taskId,
      expectedVersion: 1,
      fromStatuses: ['CLAIMED', 'IN_PROGRESS'],
      toStatus: 'COMPLETED',
      decision: { outcome: 'approve' },
    }),
  );
  t.ok(firstComplete !== null && firstComplete.status === 'COMPLETED', 'the first completion wins');
  t.equal(firstComplete?.version, 2, 'the winning completion bumped the version');
  const secondComplete = await db.withTenant(ctxA, (tx) =>
    repo.applyTaskStatus(tx, {
      id: seeded.taskId,
      expectedVersion: 1, // stale
      fromStatuses: ['CLAIMED', 'IN_PROGRESS'],
      toStatus: 'COMPLETED',
    }),
  );
  t.equal(secondComplete, null, 'a stale/duplicate completion changes zero rows (no double completion)');
  const cannotReComplete = await db.withTenant(ctxA, (tx) =>
    repo.applyTaskStatus(tx, {
      id: seeded.taskId,
      expectedVersion: 2, // correct version, but status is now terminal
      fromStatuses: ['CLAIMED', 'IN_PROGRESS'],
      toStatus: 'COMPLETED',
    }),
  );
  t.equal(cannotReComplete, null, 'a completed task cannot be completed again (status guard)');

  // --- timer fire-once dedupe --------------------------------------------------------------------
  const dedupe = `sla:${seeded.instId}:breach`;
  const timerA = await db.withTenant(ctxA, (tx) =>
    repo.insertTimer(tx, {
      tenantId: tenantA,
      instanceId: seeded.instId,
      nodeKey: null,
      kind: 'sla_breach',
      fireAt: new Date(Date.now() + 3600_000),
      dedupeKey: dedupe,
    }),
  );
  t.ok(timerA.length > 0, 'a timer is scheduled');
  const timerDup = await db.withTenant(ctxA, (tx) =>
    repo.insertTimer(tx, {
      tenantId: tenantA,
      instanceId: seeded.instId,
      nodeKey: null,
      kind: 'sla_breach',
      fireAt: new Date(Date.now() + 3600_000),
      dedupeKey: dedupe,
    }),
  );
  t.equal(timerDup, '', 'a duplicate dedupe_key does not schedule a second timer (fire-once)');

  // --- outbox scope coherence --------------------------------------------------------------------
  await db.withTenant(ctxA, (tx) =>
    repo.insertOutboxRow(tx, {
      family: 'workflow.lifecycle',
      type: 'workflow.instance.started',
      aggregateId: seeded.instId,
      envelope: { eventId: randomUUID(), type: 'workflow.instance.started' },
      dedupeKey: `evt:${seeded.instId}:started`,
    }),
  );
  const outboxInA = await db.withTenant(ctxA, (tx) =>
    tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM workflow_event_outbox WHERE aggregate_id = $1`, [
      seeded.instId,
    ]),
  );
  t.equal(outboxInA.rows[0]?.n, '1', 'the outbox row is visible in its own tenant');
  const outboxInB = await db.withTenant(ctxB, (tx) =>
    tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM workflow_event_outbox WHERE aggregate_id = $1`, [
      seeded.instId,
    ]),
  );
  t.equal(outboxInB.rows[0]?.n, '0', "another tenant cannot see the first tenant's outbox rows");
  const outboxSystem = await db.withSystem(sys, (tx) =>
    tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM workflow_event_outbox WHERE aggregate_id = $1`, [
      seeded.instId,
    ]),
  );
  t.equal(
    outboxSystem.rows[0]?.n,
    '1',
    'the platform dispatcher reads the outbox across tenants (system escape)',
  );

  // --- WorkflowOutbox atomicity: enqueued iff the transaction commits -----------------------------
  const outbox = new WorkflowOutbox(repo);
  const evt = (id: string): DomainEvent => ({
    eventId: id,
    family: 'workflow.lifecycle',
    type: 'WorkflowInstanceStarted',
    version: 1,
    occurredAt: new Date(),
    tenantId: tenantA,
    correlationId: randomUUID(),
    classification: 'confidential',
    payload: {
      instanceId: seeded.instId,
      definitionId: seeded.defId,
      versionId: seeded.instId,
      toStatus: 'RUNNING',
    },
  });

  const committedId = randomUUID();
  await db.withTenant(ctxA, (tx) => outbox.publish(tx, evt(committedId)));
  const committed = await db.withTenant(ctxA, (tx) =>
    tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM workflow_event_outbox WHERE dedupe_key = $1`, [
      committedId,
    ]),
  );
  t.equal(committed.rows[0]?.n, '1', 'a published event is enqueued when its transaction commits');

  const rolledBackId = randomUUID();
  let threw = false;
  try {
    await db.withTenant(ctxA, async (tx) => {
      await outbox.publish(tx, evt(rolledBackId));
      throw new Error('force rollback');
    });
  } catch {
    threw = true;
  }
  t.ok(threw, 'the business transaction rolled back');
  const rolledBack = await db.withTenant(ctxA, (tx) =>
    tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM workflow_event_outbox WHERE dedupe_key = $1`, [
      rolledBackId,
    ]),
  );
  t.equal(rolledBack.rows[0]?.n, '0', 'a rolled-back transaction leaves NO outbox row (atomic with state)');
});
