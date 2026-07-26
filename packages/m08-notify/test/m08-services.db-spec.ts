import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M08Emitter,
  NotifyRepository,
  TemplateService,
  NotificationService,
  EscalationService,
  PreferenceService,
  InboxService,
  ProviderRegistry,
  DeterministicProvider,
  M08_PERMISSIONS,
  ALL_M08_PERMISSIONS,
  type RetryPolicy,
} from '@finapp/m08-notify';

/**
 * M08 services DB spec — proves the notifications engine works end-to-end on a REAL PostgreSQL and enforces its
 * governance: the template authoring lifecycle, default-deny authorization, idempotent request creation,
 * preference/suppression gating (with mandatory-category bypass), worker-safe lease dispatch (success, retry,
 * exhaustion, single-winner under contention), the escalation lifecycle, and self-service preferences/inbox.
 * Authorization is the real RbacAuthz reading ctx.permissions; audit/outbox use in-memory stand-ins.
 */
export default defineDbSpec('m08-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new M08Emitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new NotifyRepository();
  const providers = new ProviderRegistry([
    new DeterministicProvider({ failFor: { 'fail@x.com': 'transient' } }),
  ]);
  const templates = new TemplateService(db, authz, emitter, repo);
  const notifications = new NotificationService(db, authz, emitter, repo, providers);
  const escalations = new EscalationService(db, authz, emitter, repo);
  const prefs = new PreferenceService(db, authz, emitter, repo);
  const inbox = new InboxService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const author = randomUUID();
  const cid = (): string => randomUUID();
  const full: RequestContext = {
    tenantId: tenant,
    userId: author,
    correlationId: cid(),
    permissions: [...ALL_M08_PERMISSIONS],
  };
  const viewerOnly: RequestContext = {
    tenantId: tenant,
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [M08_PERMISSIONS.templateView],
  };
  const noPerm: RequestContext = { tenantId: tenant, userId: author, correlationId: cid(), permissions: [] };
  const worker1 = randomUUID();
  const workerA = randomUUID();
  const workerB = randomUUID();

  const emailSpec = {
    schemaVersion: 1,
    code: 'welcome',
    name: 'Welcome',
    channel: 'email',
    subjectTemplate: 'Hi {{ name }}',
    bodyTemplate: 'Welcome {{ name }}',
    variables: [{ name: 'name', type: 'string', required: true }],
  };

  // --- authoring lifecycle ----------------------------------------------------------------------
  const created = await templates.create(full, author, { key: 'welcome', name: 'Welcome', spec: emailSpec });
  t.equal(created.version.status, 'DRAFT', 'a new template version starts DRAFT');
  const validated = await templates.validate(full, author, created.version.id, created.version.version);
  t.equal(validated.status, 'VALIDATED', 'a well-formed spec validates');
  const published = await templates.publish(full, author, validated.id, validated.version);
  t.ok(
    published.status === 'PUBLISHED' && published.content_hash !== null,
    'publishing freezes a content hash',
  );
  const activated = await templates.activate(full, author, published.id, published.version);
  t.equal(activated.status, 'ACTIVE', 'a published version activates');

  // --- default deny -----------------------------------------------------------------------------
  await t.rejects(
    templates.create(noPerm, author, { key: 'x', name: 'X', spec: emailSpec }),
    'a caller with no permission cannot author (default deny)',
  );
  await t.rejects(
    notifications.create(viewerOnly, author, {
      templateKey: 'welcome',
      destination: 'a@x.com',
      variables: { name: 'Ada' },
    }),
    'a view-only caller cannot create a request',
  );

  // --- request creation + idempotency -----------------------------------------------------------
  const req = await notifications.create(full, author, {
    templateKey: 'welcome',
    destination: 'Ada@Example.com',
    variables: { name: 'Ada' },
  });
  t.equal(req.status, 'queued', 'a request to a deliverable destination is queued');
  t.equal(req.destination, 'ada@example.com', 'destination is normalized');

  const idem = `idem-${randomUUID()}`;
  const a = await notifications.create(full, author, {
    templateKey: 'welcome',
    destination: 'a@x.com',
    variables: { name: 'A' },
    idempotencyKey: idem,
  });
  const b = await notifications.create(full, author, {
    templateKey: 'welcome',
    destination: 'a@x.com',
    variables: { name: 'A' },
    idempotencyKey: idem,
  });
  t.equal(a.id, b.id, 'a repeated idempotency key returns the same request');
  await t.rejects(
    notifications.create(full, author, {
      templateKey: 'welcome',
      destination: 'a@x.com',
      variables: { name: 'DIFFERENT' },
      idempotencyKey: idem,
    }),
    'reusing an idempotency key with a different payload is rejected (409)',
  );

  // --- missing variable rejected ----------------------------------------------------------------
  await t.rejects(
    notifications.create(full, author, { templateKey: 'welcome', destination: 'a@x.com', variables: {} }),
    'a request missing a required variable is rejected',
  );

  // --- suppression + mandatory bypass -----------------------------------------------------------
  await prefs.setSuppression(full, author, {
    destination: 'blocked@x.com',
    channel: 'email',
    suppressed: true,
    reason: 'bounce',
  });
  const suppressed = await notifications.create(full, author, {
    templateKey: 'welcome',
    destination: 'blocked@x.com',
    variables: { name: 'A' },
    category: 'optional',
  });
  t.equal(suppressed.status, 'suppressed', 'an optional request to a suppressed destination is suppressed');
  const mandatory = await notifications.create(full, author, {
    templateKey: 'welcome',
    destination: 'blocked@x.com',
    variables: { name: 'A' },
    category: 'legal',
  });
  t.equal(mandatory.status, 'queued', 'a legal (mandatory) request bypasses destination suppression');

  // --- dispatch success -------------------------------------------------------------------------
  const okDispatch = await notifications.dispatch(full, worker1, req.id, author);
  t.ok(
    okDispatch.claimed && okDispatch.finalStatus === 'delivered',
    'a deliverable request dispatches to delivered',
  );
  const delivered = await notifications.get(full, req.id);
  t.equal(delivered.status, 'delivered', 'the request is delivered');
  const dels = await notifications.deliveries(full, req.id);
  t.equal(dels.length, 1, 'exactly one delivery attempt is recorded (append-only evidence)');
  t.equal(dels[0]?.outcome, 'succeeded', 'the recorded attempt succeeded');

  // --- dispatch retry then exhaustion -----------------------------------------------------------
  const fastPolicy: RetryPolicy = {
    maxAttempts: 2,
    initialDelayMs: 0,
    backoff: 'fixed',
    factor: 1,
    maxDelayMs: 1000,
    retryableCategories: ['transient'],
  };
  const failing = await notifications.create(full, author, {
    templateKey: 'welcome',
    destination: 'fail@x.com',
    variables: { name: 'A' },
    retryPolicy: fastPolicy,
  });
  const first = await notifications.dispatch(full, worker1, failing.id, author);
  t.equal(first.finalStatus, 'retry_scheduled', 'a transient failure schedules a retry');
  const second = await notifications.dispatch(full, worker1, failing.id, author);
  t.equal(second.finalStatus, 'exhausted', 'the retry budget exhausts on the last attempt');
  const attempts = await notifications.deliveries(full, failing.id);
  t.equal(attempts.length, 2, 'two append-only attempts recorded');

  // --- single-winner under concurrent dispatch --------------------------------------------------
  const contended = await notifications.create(full, author, {
    templateKey: 'welcome',
    destination: 'race@x.com',
    variables: { name: 'A' },
  });
  const results = await Promise.all([
    notifications.dispatch(full, workerA, contended.id, author),
    notifications.dispatch(full, workerB, contended.id, author),
  ]);
  const claimedCount = results.filter((r) => r.claimed).length;
  t.equal(claimedCount, 1, 'exactly one worker claims a contended request (lease single-winner)');

  // --- cancel + manual retry --------------------------------------------------------------------
  const toCancel = await notifications.create(full, author, {
    templateKey: 'welcome',
    destination: 'c@x.com',
    variables: { name: 'A' },
  });
  const cancelled = await notifications.cancel(
    full,
    author,
    toCancel.id,
    toCancel.version,
    'no longer needed',
  );
  t.equal(cancelled.status, 'cancelled', 'a queued request cancels');
  await t.rejects(
    notifications.cancel(full, author, toCancel.id, cancelled.version),
    'a cancelled request cannot cancel again',
  );
  const requeued = await notifications.retryNow(full, author, failing.id, second.request?.version ?? 99);
  t.equal(requeued.status, 'queued', 'an exhausted request can be manually re-queued');

  // --- in-app dispatch lands in the inbox -------------------------------------------------------
  const inAppSpec = {
    schemaVersion: 1,
    code: 'inapp',
    name: 'In-app',
    channel: 'in_app',
    bodyTemplate: 'Hello {{ name }}',
    variables: [{ name: 'name', type: 'string', required: true }],
  };
  const it = await templates.create(full, author, { key: 'inapp', name: 'In-app', spec: inAppSpec });
  await templates.validate(full, author, it.version.id, it.version.version);
  const ipub = await templates.publish(full, author, it.version.id, it.version.version + 1);
  await templates.activate(full, author, ipub.id, ipub.version);
  const recipient = randomUUID();
  const inAppReq = await notifications.create(full, author, {
    templateKey: 'inapp',
    destination: recipient,
    recipientRef: recipient,
    variables: { name: 'Ada' },
  });
  await notifications.dispatch(full, worker1, inAppReq.id, author);
  const recipientCtx: RequestContext = {
    tenantId: tenant,
    userId: recipient,
    correlationId: cid(),
    permissions: [M08_PERMISSIONS.inboxView, M08_PERMISSIONS.inboxManage],
  };
  const box = await inbox.list(recipientCtx, recipient, {});
  t.equal(box.length, 1, 'an in-app delivery creates an inbox row for the recipient');
  const read = await inbox.markRead(recipientCtx, recipient, box[0]?.id ?? '', box[0]?.version ?? 1);
  t.equal(read.status, 'read', 'the recipient can mark their inbox row read');
  // Another user cannot see or read it.
  const otherCtx: RequestContext = {
    tenantId: tenant,
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [M08_PERMISSIONS.inboxView],
  };
  const otherBox = await inbox.list(otherCtx, otherCtx.userId ?? '', {});
  t.equal(otherBox.length, 0, 'another user sees none of the recipient inbox');

  // --- escalation lifecycle ---------------------------------------------------------------------
  const escSpec = {
    schemaVersion: 1,
    code: 'overdue',
    name: 'Overdue',
    requireAck: true,
    levels: [
      { level: 1, delayMs: 0, channel: 'email', recipients: [{ kind: 'role', ref: 'ops' }] },
      { level: 2, delayMs: 0, channel: 'sms', recipients: [{ kind: 'user', ref: 'mgr' }] },
    ],
  };
  const pol = await escalations.createPolicy(full, author, {
    key: 'overdue',
    name: 'Overdue',
    spec: escSpec,
  });
  await escalations.validatePolicy(full, author, pol.id, pol.version);
  const ppub = await escalations.publishPolicy(full, author, pol.id, pol.version + 1);
  await escalations.activatePolicy(full, author, ppub.id, ppub.version);
  const escIdem = `esc-${randomUUID()}`;
  const inst = await escalations.open(full, author, {
    policyKey: 'overdue',
    originModule: 'm13-case',
    idempotencyKey: escIdem,
  });
  t.equal(inst.status, 'active', 'an escalation opens active');
  const instDup = await escalations.open(full, author, { policyKey: 'overdue', idempotencyKey: escIdem });
  t.equal(inst.id, instDup.id, 'opening an escalation is idempotent per key');
  const adv = await escalations.advance(full, worker1, inst.id, author);
  t.ok(adv.advanced && adv.instance?.current_level === 1, 'a due escalation advances to level 1');
  const ack = await escalations.acknowledge(full, author, inst.id, adv.instance?.version ?? 99);
  t.equal(ack.status, 'acknowledged', 'an escalation can be acknowledged');
  const resolved = await escalations.resolve(full, author, inst.id, ack.version, 'handled');
  t.equal(resolved.status, 'resolved', 'an acknowledged escalation resolves');
  await t.rejects(
    escalations.cancel(full, author, inst.id, resolved.version),
    'a resolved escalation cannot be cancelled (terminal)',
  );

  // --- default-deny on escalation management ----------------------------------------------------
  await t.rejects(
    escalations.createPolicy(noPerm, author, { key: 'y', name: 'Y', spec: escSpec }),
    'escalation policy authoring requires the manage permission',
  );

  // --- preferences ------------------------------------------------------------------------------
  const subject = randomUUID();
  const subjectCtx: RequestContext = {
    tenantId: tenant,
    userId: subject,
    correlationId: cid(),
    permissions: [M08_PERMISSIONS.preferenceUpdate, M08_PERMISSIONS.preferenceView],
  };
  await prefs.setPreference(subjectCtx, subject, {
    subjectId: subject,
    channel: 'email',
    optIn: false,
    suppressed: false,
  });
  const list = await prefs.listForSubject(subjectCtx, subject);
  t.equal(list.length, 1, 'a user preference is stored and listed');
  t.equal(list[0]?.opt_in, false, 'the stored preference reflects opt-out');
});
