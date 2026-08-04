import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit } from '@finapp/m01-tenant';
import {
  IntegrationRepository,
  DestinationService,
  ExecutionService,
  FrameworkOnlyDispatch,
} from '@finapp/m23-finance-integration';

/**
 * M23 services DB spec — proves the FRAMEWORK-ONLY finance-integration foundation END TO END on a REAL PostgreSQL:
 * configure + enable a destination (secret REFERENCE only); prepare a governed execution from an approved intent
 * (opaque m21/m22 refs; idempotent); DISPATCH — which NEVER calls out (the only adapter is Framework-Only, recording a
 * dispatched attempt as evidence); acknowledge with an external reference; refuse dispatch to a disabled / non-approved
 * destination (fail closed); a bounded retry cycle (fail -> retryable -> retry -> exhausted); controlled cancellation;
 * optimistic-concurrency (stale-version) rejection; FIN_INTEGRATION_ audit with NO secret in any entry; and cross-tenant
 * isolation. m23 never approves, never posts, and reaches no external system.
 */
export default defineDbSpec('m23-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const audit = new RecordingAudit();
  const repo = new IntegrationRepository();
  const destinations = new DestinationService(db, audit, repo);
  const executions = new ExecutionService(db, audit, new FrameworkOnlyDispatch(), repo);

  const tenant = randomUUID();
  const actor = randomUUID();
  const ctxOf = (): RequestContext => ({
    tenantId: tenant,
    userId: actor,
    correlationId: randomUUID(),
    permissions: [],
  });
  const c = ctxOf();
  const SECRET_REF = `secretref:vault/${randomUUID()}`;
  const approvalRef = randomUUID();

  // --- configure + enable a destination (secret REFERENCE only) ---------------------------------
  const dest = await destinations.configureDestination(c, actor, {
    systemCode: 'core-gl',
    name: 'Core GL',
    destinationType: 'core_banking',
    allowlisted: true,
    secretReference: SECRET_REF,
  });
  t.equal(dest.status, 'draft', 'a configured destination starts draft');
  await t.rejects(
    destinations.configureDestination(c, actor, {
      systemCode: 'bad',
      secretReference: 'inline-secret-value',
    }),
    'an inline secret is rejected at the service (references only)',
  );
  const enabled = await destinations.enableDestination(c, actor, dest.id, dest.version);
  t.equal(enabled.status, 'enabled', 'a destination enables');

  // --- prepare a governed execution (idempotent) ------------------------------------------------
  const idem = `exec-${randomUUID()}`;
  const prep = await executions.prepareExecution(c, actor, {
    destinationId: dest.id,
    postingRequestRef: randomUUID(),
    approvalRef,
    amountMinor: 250000,
    idempotencyKey: idem,
    maxAttempts: 2,
  });
  t.equal(prep.status, 'prepared', 'an execution is prepared from an approved intent');
  t.equal(
    prep.amount_minor,
    '250000',
    'amount is carried as opaque bigint minor-unit evidence (string, never a float)',
  );
  const again = await executions.prepareExecution(c, actor, { approvalRef, idempotencyKey: idem });
  t.equal(again.id, prep.id, 'preparation is idempotent per key (no duplicate execution)');
  await t.rejects(
    executions.prepareExecution(c, actor, { approvalRef: '' }),
    'an execution cannot be prepared without an approval reference (no execution without approval)',
  );

  // --- dispatch NEVER calls out -----------------------------------------------------------------
  const dispatched = await executions.dispatchExecution(c, actor, prep.id, prep.version);
  t.equal(dispatched.execution.status, 'dispatched', 'a governed execution dispatches (framework-only)');
  t.ok(
    dispatched.attempt.framework_only && dispatched.attempt.result === 'dispatched',
    'the dispatch attempt is recorded as framework-only evidence (no external call was made)',
  );
  t.equal(dispatched.execution.attempt_count, 1, 'the dispatch increments the bounded attempt count');

  // --- acknowledge with an external reference ---------------------------------------------------
  const acked = await executions.acknowledgeExecution(c, actor, prep.id, dispatched.execution.version, {
    externalRef: 'EXT-ACK-123',
    externalSystem: 'core-gl',
  });
  t.equal(acked.status, 'acknowledged', 'an external acknowledgement moves the execution terminal (success)');
  const refs = await db.withTenant(c, (tx) => repo.listExternalReferences(tx, prep.id));
  t.ok(
    refs.some((r) => r.external_ref === 'EXT-ACK-123' && r.ref_type === 'acknowledgement'),
    'the external reference is recorded',
  );

  // --- dispatch refused to a disabled destination (fail closed) ---------------------------------
  const disabledDest = await destinations.configureDestination(c, actor, {
    systemCode: 'off',
    allowlisted: true,
  });
  const refusedExec = await executions.prepareExecution(c, actor, {
    destinationId: disabledDest.id,
    approvalRef,
  });
  await t.rejects(
    executions.dispatchExecution(c, actor, refusedExec.id, refusedExec.version),
    'dispatch to a non-enabled destination is refused (fail closed)',
  );

  // --- bounded retry cycle: fail -> retryable -> retry -> ... -> exhausted -----------------------
  const retryDest = await destinations.configureDestination(c, actor, {
    systemCode: 'retry-sys',
    allowlisted: true,
  });
  const retryEnabled = await destinations.enableDestination(c, actor, retryDest.id, retryDest.version);
  const rexec = await executions.prepareExecution(c, actor, {
    destinationId: retryEnabled.id,
    approvalRef,
    maxAttempts: 2,
  });
  const d1 = await executions.dispatchExecution(c, actor, rexec.id, rexec.version);
  const failed1 = await executions.failExecution(c, actor, rexec.id, d1.execution.version, {});
  t.equal(failed1.status, 'retryable', 'a failure with attempts remaining schedules a retry (bounded)');
  const retried = await executions.retryExecution(c, actor, rexec.id, failed1.version);
  t.equal(retried.status, 'ready', 'a retryable execution goes back to ready');
  const d2 = await executions.dispatchExecution(c, actor, rexec.id, retried.version);
  t.equal(d2.execution.attempt_count, 2, 'the retry dispatch reaches the attempt ceiling');
  const failed2 = await executions.failExecution(c, actor, rexec.id, d2.execution.version, {});
  t.equal(
    failed2.status,
    'exhausted',
    'a failure at the attempt ceiling exhausts (bounded retry — no runaway dispatch)',
  );

  // --- controlled cancellation ------------------------------------------------------------------
  const toCancel = await executions.prepareExecution(c, actor, { approvalRef });
  const cancelled = await executions.cancelExecution(
    c,
    actor,
    toCancel.id,
    toCancel.version,
    'no longer needed',
  );
  t.equal(cancelled.status, 'cancelled', 'a non-terminal execution can be cancelled');
  await t.rejects(
    executions.cancelExecution(c, actor, toCancel.id, cancelled.version, 'again'),
    'a cancelled (terminal) execution cannot be cancelled again',
  );

  // --- optimistic concurrency (stale dispatch rejects) ------------------------------------------
  const staleExec = await executions.prepareExecution(c, actor, { destinationId: enabled.id, approvalRef });
  await t.rejects(
    executions.dispatchExecution(c, actor, staleExec.id, staleExec.version + 99),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- audit carries NO secret ------------------------------------------------------------------
  t.ok(audit.entries.length >= 6, 'FIN_INTEGRATION_ audit entries were recorded for controlled mutations');
  t.ok(
    !JSON.stringify(audit.entries).includes(SECRET_REF) &&
      !JSON.stringify(audit.entries).includes('secretref:'),
    'no secret reference appears in any audit entry (data minimisation)',
  );
  t.ok(
    audit.entries.some((e) => e.code === 'FIN_INTEGRATION_EXECUTION_DISPATCHED'),
    'the dispatch is audited under the FIN_INTEGRATION_ prefix',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...c, tenantId: randomUUID() };
  await t.rejects(
    executions.getExecution(otherTenant, prep.id),
    "another tenant cannot read this tenant's execution (RLS)",
  );
});
