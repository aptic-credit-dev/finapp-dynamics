import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M40Emitter,
  ResilienceRepository,
  OfflineService,
  ObservabilityService,
  BackupDrService,
  UnavailableBackupExecutor,
  FixtureBackupExecutor,
  M40_PERMISSIONS,
  REASON_CODES,
} from '../src/index.ts';

/**
 * M40 services DB spec — proves the resilience pipeline END TO END on a REAL PostgreSQL: register a device; queue a CONTROLLED
 * offline request; a controlled offline finalization is REFUSED without online re-validation, REFUSED when the current online
 * actor lacks the required permission, and APPLIED only when re-validated online with the permission held; a non-controlled
 * request applies; a backup runs FRAMEWORK-ONLY (unavailable executor -> BLOCKED, fixture -> succeeded, idempotent by run key);
 * a restore/failover is maker-checker (self + AI refused, an independent human approves) and executes framework-only; a DR plan
 * + drill are recorded; an operational signal is recorded.
 */
export default defineDbSpec('m40-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M40Emitter(audit, outbox);
  const repo = new ResilienceRepository();
  const offline = new OfflineService(db, authz, emitter, repo);
  const observability = new ObservabilityService(db, authz, emitter, repo);
  const backupBlocked = new BackupDrService(db, authz, emitter, new UnavailableBackupExecutor(), repo);
  const backupOk = new BackupDrService(db, authz, emitter, new FixtureBackupExecutor(), repo);

  const tenant = randomUUID();
  const userR = randomUUID();
  const userA = randomUUID();
  const CAP_PERM = 'finance.journal.post';
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  // syncCtx can queue/finalize but does NOT hold the downstream finance permission
  const syncCtx = ctxOf(userR, [
    M40_PERMISSIONS.deviceManage,
    M40_PERMISSIONS.offlineSync,
    M40_PERMISSIONS.offlineRead,
  ]);
  // syncCtxPerm additionally holds the required downstream permission (online re-validation succeeds)
  const syncCtxPerm = ctxOf(userR, [M40_PERMISSIONS.offlineSync, CAP_PERM]);
  const backupCtx = ctxOf(userR, [M40_PERMISSIONS.backupManage]);
  const restoreReqCtx = ctxOf(userR, [M40_PERMISSIONS.restoreRequest, M40_PERMISSIONS.drRead]);
  const restoreApproveCtx = ctxOf(userA, [M40_PERMISSIONS.restoreApprove]);
  const drCtx = ctxOf(userR, [M40_PERMISSIONS.drManage]);

  // --- device + a controlled offline request ------------------------------------------------------
  const device = await offline.registerDevice(syncCtx, { deviceKey: 'dev-1', platform: 'ios' });
  t.equal(device.trust_state, 'registered', 'a registered device is registered');

  const queueControlled = (key: string) =>
    offline.queueRequest(syncCtx, {
      deviceId: device.id,
      requestKey: key,
      capabilityRef: 'journal:post',
      requiredPermission: CAP_PERM,
      controlled: true,
    });

  // (1) a controlled offline finalization is REFUSED without online re-validation (no downstream ref) -> rejected
  const r1 = await queueControlled('req-1');
  const f1 = await offline.finalizeRequest(syncCtx, r1.id, r1.version, {});
  t.equal(
    f1.syncState,
    'rejected',
    'a controlled action cannot be finalized offline (no online re-validation)',
  );
  t.equal(
    f1.reasonCode,
    REASON_CODES.offlineFinalizationBlocked,
    'the reason is offline_finalization_blocked',
  );

  // (2) re-validated online but the CURRENT actor lacks the required permission -> rejected (RBAC re-validation)
  const r2 = await queueControlled('req-2');
  const f2 = await offline.finalizeRequest(syncCtx, r2.id, r2.version, { downstreamRef: 'ref:posted-2' });
  t.equal(f2.syncState, 'rejected', 'a controlled action whose online actor lacks the permission is refused');
  t.equal(
    f2.reasonCode,
    REASON_CODES.offlineRbacRevalidationFailed,
    'the reason is offline_rbac_revalidation_failed',
  );

  // (3) re-validated online AND the required permission held -> applied
  const r3 = await queueControlled('req-3');
  const f3 = await offline.finalizeRequest(syncCtxPerm, r3.id, r3.version, { downstreamRef: 'ref:posted-3' });
  t.equal(f3.syncState, 'applied', 'a controlled action re-validated online (permission held) is applied');

  // (4) a NON-controlled request applies without online authorization
  const r4 = await offline.queueRequest(syncCtx, {
    deviceId: device.id,
    requestKey: 'req-4',
    capabilityRef: 'report:read',
    requiredPermission: 'analytics.report.read',
    controlled: false,
  });
  const f4 = await offline.finalizeRequest(syncCtx, r4.id, r4.version, {});
  t.equal(f4.syncState, 'applied', 'a non-controlled (read/draft) sync applies');

  // --- backup: FRAMEWORK-ONLY (blocked) then fixture (succeeded) + idempotency ---------------------
  const policy = await backupBlocked.setPolicy(backupCtx, {
    policyKey: 'nightly',
    targetRef: 'db-main',
    rtoSeconds: 3600,
    rpoSeconds: 900,
  });
  const runBlocked = await backupBlocked.runBackup(backupCtx, policy.id, { runKey: 'run-1' });
  t.equal(
    runBlocked.result,
    'blocked',
    'an unavailable backup executor yields a durable BLOCKED run (framework-only)',
  );
  const runOk = await backupOk.runBackup(backupCtx, policy.id, { runKey: 'run-2' });
  t.equal(runOk.result, 'succeeded', 'a working (fixture) backup executor succeeds');
  await t.rejects(
    backupOk.runBackup(backupCtx, policy.id, { runKey: 'run-2' }),
    'a repeated backup run key is idempotently refused',
  );

  // --- restore/failover: maker-checker (self + AI refused; independent human approves) + execute ---
  const restore = await backupOk.requestRestore(restoreReqCtx, {
    requestKey: 'rr-1',
    kind: 'restore',
    targetRef: 'db-main',
  });
  await t.rejects(
    backupOk.approveRestore(
      ctxOf(userR, [M40_PERMISSIONS.restoreApprove]),
      userR,
      restore.id,
      restore.version,
    ),
    'the requester cannot self-approve a restore',
  );
  await t.rejects(
    backupOk.approveRestore(restoreApproveCtx, 'ai', restore.id, restore.version),
    'AI can never approve a restore/failover',
  );
  const approved = await backupOk.approveRestore(restoreApproveCtx, userA, restore.id, restore.version);
  t.equal(approved.state, 'approved', 'an independent human approves the restore');
  const executed = await backupOk.executeRestore(restoreApproveCtx, approved.id, approved.version);
  t.equal(executed.state, 'executed', 'a working (fixture) executor executes the approved restore');

  // a restore executed via the UNAVAILABLE executor is durably BLOCKED (framework-only)
  const restore2 = await backupOk.requestRestore(restoreReqCtx, {
    requestKey: 'rr-2',
    kind: 'failover',
    targetRef: 'db-main',
  });
  const approved2 = await backupOk.approveRestore(restoreApproveCtx, userA, restore2.id, restore2.version);
  const blocked2 = await backupBlocked.executeRestore(restoreApproveCtx, approved2.id, approved2.version);
  t.equal(
    blocked2.state,
    'blocked',
    'an unavailable executor leaves the failover durably BLOCKED (no direct infra execution)',
  );

  // --- DR plan + drill + observability signal -----------------------------------------------------
  const plan = await backupOk.setDrPlan(drCtx, { planKey: 'dr-1', rtoSeconds: 7200, rpoSeconds: 1800 });
  const test = await backupOk.recordDrTest(drCtx, plan.id, {
    testKey: 't-1',
    outcome: 'passed',
    measuredRecoverySeconds: 5400,
  });
  t.ok(test.id, 'a DR drill is recorded (append-only evidence)');
  const signal = await observability.recordSignal(backupCtx, {
    component: 'api',
    state: 'ok',
    signalKind: 'health',
    latencyMs: 42,
  });
  t.ok(signal.id, 'a bounded operational signal is recorded');
});
