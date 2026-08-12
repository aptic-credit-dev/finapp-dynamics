import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M36Emitter,
  EventsRepository,
  WebhookService,
  RelayService,
  StreamService,
  UnavailableWebhookDelivery,
  FixtureWebhookDelivery,
  M36_PERMISSIONS,
  type RelayEvent,
} from '../src/index.ts';

/**
 * M36 services DB spec — proves the webhooks & event-streaming pipeline END TO END on a REAL PostgreSQL: register an external
 * endpoint (a private/insecure URL is refused — SSRF allow-list); validate + APPROVE it under maker-checker (self-approval +
 * AI-approval + default-deny refused); subscribe to a REGISTERED event family (an unregistered family is refused); FAN OUT a
 * domain event through the fail-closed delivery port (an unavailable runtime yields a durable BLOCKED outcome; a working
 * runtime DELIVERS; a second delivery is idempotently skipped); REPLAY a blocked delivery; and create a STREAM + advance a
 * monotonic CURSOR (a rewind is refused). m06 owns the outbox; m36 owns none and performs no real network.
 */
export default defineDbSpec('m36-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M36Emitter(audit, outbox);
  const repo = new EventsRepository();
  const webhooks = new WebhookService(db, authz, emitter, repo);
  const relayBlocked = new RelayService(db, authz, emitter, new UnavailableWebhookDelivery(), repo);
  const relayOk = new RelayService(db, authz, emitter, new FixtureWebhookDelivery(true), repo);
  const streams = new StreamService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const userR = randomUUID();
  const userA = randomUUID();
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const managerCtx = ctxOf(userR, [
    M36_PERMISSIONS.webhookManage,
    M36_PERMISSIONS.webhookRead,
    M36_PERMISSIONS.subscriptionManage,
    M36_PERMISSIONS.streamManage,
    M36_PERMISSIONS.streamRead,
  ]);
  const approverCtx = ctxOf(userA, [M36_PERMISSIONS.webhookApprove, M36_PERMISSIONS.webhookRead]);
  const replayCtx = ctxOf(userA, [M36_PERMISSIONS.deliveryReplay, M36_PERMISSIONS.webhookRead]);
  const relayCtx = ctxOf(randomUUID(), []); // the relay is a system fan-out; no user permission

  // --- register an endpoint: SSRF allow-list refuses a private URL --------------------------------
  await t.rejects(
    webhooks.registerEndpoint(managerCtx, userR, { endpointKey: 'bad', url: 'https://127.0.0.1/x' }),
    'a loopback endpoint URL is refused (SSRF allow-list)',
  );
  await t.rejects(
    webhooks.registerEndpoint(managerCtx, userR, { endpointKey: 'bad2', url: 'http://hooks.example.com/x' }),
    'an insecure http endpoint URL is refused',
  );
  const endpoint = await webhooks.registerEndpoint(managerCtx, userR, {
    endpointKey: 'ep1',
    url: 'https://hooks.example.com/x',
    signingSecretRef: 'secretref:vault/kv/wh',
  });
  t.equal(endpoint.state, 'draft', 'a registered endpoint starts draft');

  // --- validate + review ---------------------------------------------------------------------------
  const reviewed = await webhooks.requestReview(managerCtx, userR, endpoint.id, endpoint.version);
  t.equal(reviewed.state, 'review_pending', 'a valid endpoint can be sent for review');

  // --- maker-checker refusals ----------------------------------------------------------------------
  await t.rejects(
    webhooks.approveEndpoint(
      ctxOf(userR, [M36_PERMISSIONS.webhookApprove, M36_PERMISSIONS.webhookRead]),
      userR,
      endpoint.id,
      reviewed.version,
    ),
    'the requester cannot self-approve an endpoint',
  );
  await t.rejects(
    webhooks.approveEndpoint(approverCtx, 'ai', endpoint.id, reviewed.version),
    'AI can never approve an endpoint',
  );
  await t.rejects(
    webhooks.approveEndpoint(
      ctxOf(userA, [M36_PERMISSIONS.webhookRead]),
      userA,
      endpoint.id,
      reviewed.version,
    ),
    'default deny — no events.webhook.approve, refused',
  );

  // --- approve by an independent human ------------------------------------------------------------
  const active = await webhooks.approveEndpoint(approverCtx, userA, endpoint.id, reviewed.version);
  t.equal(active.state, 'active', 'an independently-approved endpoint activates');

  // --- subscribe: an unregistered family is refused; a registered family is accepted --------------
  await t.rejects(
    webhooks.addSubscription(managerCtx, userR, endpoint.id, { eventFamily: 'totally.made.up' }),
    'a subscription to an unregistered event family is refused',
  );
  const sub = await webhooks.addSubscription(managerCtx, userR, endpoint.id, {
    eventFamily: 'finance.lifecycle',
    eventType: '*',
  });
  t.equal(sub.event_family, 'finance.lifecycle', 'an endpoint subscribes to a registered family');

  // --- fan-out: fail-closed BLOCKED, then DELIVERED, then idempotent skip --------------------------
  const evt1: RelayEvent = {
    eventId: randomUUID(),
    family: 'finance.lifecycle',
    type: 'JournalPosted',
    aggregateId: randomUUID(),
    dedupeKey: `evt-${randomUUID()}`,
  };
  const blocked = await relayBlocked.deliverEvent(relayCtx, evt1);
  t.ok(
    blocked.length === 1 && blocked[0]?.status === 'blocked',
    'an unavailable delivery runtime yields BLOCKED (fail closed)',
  );
  const delivered = await relayOk.deliverEvent(relayCtx, evt1);
  t.ok(
    delivered.length === 1 && delivered[0]?.status === 'delivered',
    'a working runtime delivers the event',
  );
  const again = await relayOk.deliverEvent(relayCtx, evt1);
  t.equal(again.length, 0, 'a second delivery of the same event is idempotently skipped');

  // --- replay a blocked delivery ------------------------------------------------------------------
  const evt2: RelayEvent = {
    eventId: randomUUID(),
    family: 'finance.lifecycle',
    type: 'JournalPosted',
    aggregateId: randomUUID(),
    dedupeKey: `evt-${randomUUID()}`,
  };
  const blocked2 = await relayBlocked.deliverEvent(relayCtx, evt2);
  const d2 = blocked2[0];
  t.ok(d2?.status === 'blocked', 'a second event is blocked by the unavailable runtime');
  await t.rejects(
    relayOk.replayDelivery(ctxOf(userR, []), userR, d2?.id ?? ''),
    'default deny — no events.delivery.replay, refused',
  );
  const replayed = await relayOk.replayDelivery(replayCtx, userA, d2?.id ?? '');
  t.equal(replayed.status, 'delivered', 'replaying a blocked delivery through a working runtime delivers it');

  // --- stream + monotonic cursor ------------------------------------------------------------------
  await t.rejects(
    streams.createStream(managerCtx, userR, { streamKey: 'bad', families: ['totally.made.up'] }),
    'a stream carrying an unregistered family is refused',
  );
  const stream = await streams.createStream(managerCtx, userR, {
    streamKey: 's1',
    families: ['finance.lifecycle', 'case.lifecycle'],
  });
  t.equal(stream.status, 'active', 'a stream over registered families is active');
  const cursor = await streams.createCursor(managerCtx, userR, stream.id, { consumerKey: 'c1' });
  t.equal(cursor.position, '0', 'a new cursor starts at position 0');
  const advanced = await streams.advanceCursor(managerCtx, userR, cursor.id, { position: '10' });
  t.equal(advanced.position, '10', 'a cursor advances forward');
  await t.rejects(
    streams.advanceCursor(managerCtx, userR, cursor.id, { position: '5' }),
    'a cursor cannot be rewound (monotonic)',
  );

  // --- suspend the endpoint (withdraw egress) -----------------------------------------------------
  const suspended = await webhooks.suspendEndpoint(managerCtx, userR, endpoint.id);
  t.equal(suspended.state, 'suspended', 'suspending an endpoint withdraws delivery');
});
