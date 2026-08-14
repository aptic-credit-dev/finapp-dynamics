import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M38Emitter,
  AutomationRepository,
  AutomationService,
  ExtensionService,
  UnavailableCapabilityInvoker,
  FixtureCapabilityInvoker,
  FixtureTimerScheduler,
  M38_PERMISSIONS,
} from '../src/index.ts';

/**
 * M38 services DB spec — proves the automation + extension pipeline END TO END on a REAL PostgreSQL: define an automation +
 * capability steps (a step without a 3-segment permission is refused; a raw secret config is refused); set a GOVERNED schedule
 * (an invalid/too-frequent recurrence is refused); validate + ACTIVATE under maker-checker (self + AI + default-deny refused);
 * RUN it (an unavailable capability yields a durable BLOCKED run — framework-only; a working capability succeeds; a repeat run
 * key is idempotently refused); register + publish an extension under maker-checker; install + disable it.
 */
export default defineDbSpec('m38-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M38Emitter(audit, outbox);
  const repo = new AutomationRepository();
  const timer = new FixtureTimerScheduler();
  const autoBlocked = new AutomationService(
    db,
    authz,
    emitter,
    new UnavailableCapabilityInvoker(),
    timer,
    repo,
  );
  const autoOk = new AutomationService(
    db,
    authz,
    emitter,
    new FixtureCapabilityInvoker(['notify:send']),
    timer,
    repo,
  );
  const extensions = new ExtensionService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const userR = randomUUID();
  const userA = randomUUID();
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const authorCtx = ctxOf(userR, [
    M38_PERMISSIONS.jobManage,
    M38_PERMISSIONS.jobRead,
    M38_PERMISSIONS.executionRead,
    M38_PERMISSIONS.extensionManage,
    M38_PERMISSIONS.extensionRead,
    M38_PERMISSIONS.extensionInstall,
  ]);
  const activatorCtx = ctxOf(userA, [
    M38_PERMISSIONS.jobActivate,
    M38_PERMISSIONS.jobRead,
    M38_PERMISSIONS.executionRead,
  ]);
  const publisherCtx = ctxOf(userA, [M38_PERMISSIONS.extensionPublish, M38_PERMISSIONS.extensionRead]);

  // --- define an automation + steps (facade rule) -------------------------------------------------
  const automation = await autoBlocked.defineAutomation(authorCtx, userR, {
    automationKey: 'nightly',
    name: 'Nightly',
  });
  t.equal(automation.state, 'draft', 'a defined automation starts draft');
  await t.rejects(
    autoBlocked.addStep(authorCtx, userR, automation.id, {
      stepNo: 1,
      capabilityRef: 'notify:send',
      requiredPermission: 'send',
    }),
    'a step without a 3-segment permission is refused (facade never bypasses RBAC)',
  );
  await t.rejects(
    autoBlocked.addStep(authorCtx, userR, automation.id, {
      stepNo: 1,
      capabilityRef: 'notify:send',
      requiredPermission: 'notifications.message.send',
      configSecretRef: 'hunter2',
    }),
    'a raw secret config is refused (opaque secretref only)',
  );
  await autoBlocked.addStep(authorCtx, userR, automation.id, {
    stepNo: 1,
    capabilityRef: 'notify:send',
    requiredPermission: 'notifications.message.send',
    configSecretRef: 'secretref:vault/kv/x',
  });

  // --- schedule: governed recurrence + frequency floor --------------------------------------------
  await t.rejects(
    autoBlocked.setSchedule(authorCtx, userR, automation.id, { scheduleKey: 's1', recurrence: '* * * * *' }),
    'a raw cron expression is refused (governed recurrence only, no cron)',
  );
  await t.rejects(
    autoBlocked.setSchedule(authorCtx, userR, automation.id, { scheduleKey: 's1', recurrence: 'every:5' }),
    'a 5-second recurrence is refused (below the frequency floor — no job storm)',
  );
  const schedule = await autoBlocked.setSchedule(authorCtx, userR, automation.id, {
    scheduleKey: 's1',
    recurrence: 'daily',
  });
  t.equal(schedule.recurrence, 'daily', 'a governed daily schedule is accepted');

  // --- validate + review --------------------------------------------------------------------------
  const vr = await autoBlocked.validateAutomationById(authorCtx, userR, automation.id, automation.version);
  t.ok(vr.passed, 'an automation with a permission-guarded step passes validation');
  const validated = await autoBlocked.getAutomation(authorCtx, automation.id);
  const reviewed = await autoBlocked.requestReview(authorCtx, userR, automation.id, validated?.version ?? 0);
  t.equal(reviewed.state, 'review_pending', 'a validated automation can be sent for review');

  // --- maker-checker refusals ---------------------------------------------------------------------
  await t.rejects(
    autoBlocked.activateAutomation(
      ctxOf(userR, [M38_PERMISSIONS.jobActivate, M38_PERMISSIONS.jobRead]),
      userR,
      automation.id,
      reviewed.version,
    ),
    'the requester cannot self-activate an automation',
  );
  await t.rejects(
    autoBlocked.activateAutomation(activatorCtx, 'ai', automation.id, reviewed.version),
    'AI can never activate an automation',
  );
  await t.rejects(
    autoBlocked.activateAutomation(
      ctxOf(userA, [M38_PERMISSIONS.jobRead]),
      userA,
      automation.id,
      reviewed.version,
    ),
    'default deny — no automation.job.activate, refused',
  );

  // --- activate by an independent human -----------------------------------------------------------
  const active = await autoBlocked.activateAutomation(activatorCtx, userA, automation.id, reviewed.version);
  t.equal(active.state, 'active', 'an independently-approved automation activates');

  // --- run: fail-closed BLOCKED, then a working capability SUCCEEDS, then idempotent refuse --------
  const blocked = await autoBlocked.runAutomation(activatorCtx, userA, automation.id, { runKey: 'run-1' });
  t.equal(
    blocked.status,
    'blocked',
    'an unavailable capability yields a durable BLOCKED run (framework-only)',
  );
  const succeeded = await autoOk.runAutomation(activatorCtx, userA, automation.id, { runKey: 'run-2' });
  t.equal(succeeded.status, 'succeeded', 'a working registered capability succeeds');
  await t.rejects(
    autoOk.runAutomation(activatorCtx, userA, automation.id, { runKey: 'run-2' }),
    'a repeated run key that already succeeded is idempotently refused',
  );

  // --- suspend ------------------------------------------------------------------------------------
  const suspended = await autoBlocked.suspendAutomation(authorCtx, userR, automation.id);
  t.equal(suspended.state, 'suspended', 'an active automation can be suspended');

  // --- extensions: register -> point -> validate -> publish (maker-checker) -> install -> disable --
  const extension = await extensions.defineExtension(authorCtx, userR, {
    extensionKey: 'ext1',
    name: 'Ext One',
    trustTier: 'verified',
  });
  t.equal(extension.state, 'draft', 'a registered extension starts draft');
  await extensions.addPoint(authorCtx, userR, extension.id, {
    pointKey: 'p1',
    capabilityRef: 'report:generate',
    requiredPermission: 'analytics.report.generate',
  });
  const ev = await extensions.validateExtensionById(authorCtx, userR, extension.id, extension.version);
  t.ok(ev.passed, 'an extension with a permission-guarded point validates');
  const evd = await extensions.getExtension(authorCtx, extension.id);
  await t.rejects(
    extensions.publishExtension(
      ctxOf(userR, [M38_PERMISSIONS.extensionPublish, M38_PERMISSIONS.extensionRead]),
      userR,
      extension.id,
      evd?.version ?? 0,
    ),
    'the requester cannot self-publish an extension',
  );
  await t.rejects(
    extensions.publishExtension(publisherCtx, 'ai', extension.id, evd?.version ?? 0),
    'AI can never publish an extension',
  );
  const published = await extensions.publishExtension(publisherCtx, userA, extension.id, evd?.version ?? 0);
  t.equal(published.state, 'published', 'an independently-approved extension publishes');
  const installation = await extensions.installExtension(authorCtx, userR, extension.id, {
    installKey: 'i1',
  });
  t.equal(installation.status, 'enabled', 'a tenant installs/enables a published extension');
  const disabled = await extensions.disableInstallation(authorCtx, userR, installation.id);
  t.equal(disabled.status, 'disabled', 'an installation can be disabled');
});
