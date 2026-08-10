import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M33Emitter,
  IntegrationRepository,
  ConnectorService,
  ConnectionService,
  RunService,
  M33IntegrationCapabilityCatalog,
  FrameworkConnectorRuntime,
  UnavailableConnectorRuntime,
  M33_PERMISSIONS,
} from '../src/index.ts';

/**
 * M33 services DB spec — proves the integration foundation END TO END on a REAL PostgreSQL: define a connector + register
 * a capability; validate + PUBLISH under maker-checker (self-approval + AI-approval + default-deny refused); create a
 * connection (a raw secret in the config is refused; secrets are opaque secretref: pointers only); execute a FRAMEWORK-ONLY
 * run (succeeds offline); execute against an UNAVAILABLE runtime (durably BLOCKED, fail closed); and serve m31's
 * IntegrationCapabilityCatalogPort (a published capability is available; an unknown one is not).
 */
export default defineDbSpec('m33-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M33Emitter(audit, outbox);
  const repo = new IntegrationRepository();
  const connectors = new ConnectorService(db, authz, emitter, repo);
  const connections = new ConnectionService(db, authz, emitter, repo);
  const runsFramework = new RunService(db, authz, emitter, new FrameworkConnectorRuntime(() => 3), repo);
  const runsUnavailable = new RunService(db, authz, emitter, new UnavailableConnectorRuntime(), repo);
  const catalog = new M33IntegrationCapabilityCatalog(connectors);

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
    M33_PERMISSIONS.connectorAuthor,
    M33_PERMISSIONS.connectorRead,
    M33_PERMISSIONS.capabilityRead,
    M33_PERMISSIONS.connectionManage,
    M33_PERMISSIONS.runExecute,
    M33_PERMISSIONS.connectionRead,
  ]);
  const approverCtx = ctxOf(userA, [M33_PERMISSIONS.connectorPublish, M33_PERMISSIONS.connectorRead]);

  // --- connector + capability -------------------------------------------------------------------
  const connector = await connectors.defineConnector(authorCtx, userR, {
    connectorKey: 'sf',
    name: 'Salesforce',
    category: 'crm',
    authKind: 'oauth2',
  });
  t.equal(connector.state, 'draft', 'a connector starts draft');
  const cap = await connectors.registerCapability(authorCtx, userR, connector.id, {
    capabilityKey: 'query',
    name: 'Query',
    direction: 'inbound',
    kind: 'read',
  });
  t.ok(cap.id !== '', 'a governed capability is registered');
  const vr = await connectors.validateConnector(authorCtx, userR, connector.id, connector.version);
  t.ok(vr.passed, 'a valid connector passes validation');
  const validated = await connectors.getConnector(authorCtx, connector.id);
  t.equal(validated?.state, 'validated', 'a passing validation moves the connector to validated');
  const reviewed = await connectors.requestReview(authorCtx, userR, connector.id, validated?.version ?? 0);
  t.equal(reviewed.state, 'review_pending', 'a validated connector can be sent for review');

  // --- maker-checker refusals -------------------------------------------------------------------
  const selfCtx = ctxOf(userR, [M33_PERMISSIONS.connectorPublish, M33_PERMISSIONS.connectorRead]);
  await t.rejects(
    connectors.publishConnector(selfCtx, userR, connector.id, reviewed.version),
    'the requester cannot self-approve/publish a connector',
  );
  await t.rejects(
    connectors.publishConnector(approverCtx, 'ai', connector.id, reviewed.version),
    'AI can never approve/publish a connector',
  );
  const noPermCtx = ctxOf(userA, [M33_PERMISSIONS.connectorRead]);
  await t.rejects(
    connectors.publishConnector(noPermCtx, userA, connector.id, reviewed.version),
    'default deny — no integration.connector.publish, refused',
  );

  // --- publish by an independent human approver -------------------------------------------------
  const published = await connectors.publishConnector(approverCtx, userA, connector.id, reviewed.version);
  t.equal(published.state, 'published', 'an independently-approved validated connector publishes');

  // --- connection: a raw secret in the config is refused; secrets are opaque refs only ----------
  await t.rejects(
    connections.createConnection(authorCtx, userR, {
      connectorId: connector.id,
      connectionKey: 'c-bad',
      name: 'Bad',
      config: { api_key: 'sk-live-999' },
    }),
    'a raw secret VALUE in a connection config is refused (secret seam)',
  );
  const connection = await connections.createConnection(authorCtx, userR, {
    connectorId: connector.id,
    connectionKey: 'c1',
    name: 'C1',
    config: { host: 'login.salesforce.com' },
  });
  t.equal(connection.status, 'draft', 'a clean connection is created');
  await t.rejects(
    connections.setSecret(authorCtx, userR, connection.id, { purpose: 'oauth', secretRef: 'hunter2' }),
    'a raw secret cannot be attached — only an opaque secretref: pointer',
  );
  const secret = await connections.setSecret(authorCtx, userR, connection.id, {
    purpose: 'oauth',
    secretRef: 'secretref:vault/kv/sf',
  });
  t.ok(
    secret.secret_ref.startsWith('secretref:'),
    'a secret is stored as an opaque reference only (no value)',
  );

  // --- FRAMEWORK-ONLY run succeeds offline; UNAVAILABLE runtime is durably BLOCKED (fail closed) --
  const run = await runsFramework.executeRun(authorCtx, userR, {
    connectionId: connection.id,
    capabilityId: cap.id,
  });
  t.ok(
    run.status === 'succeeded' && run.row_count === 3,
    'a framework-only run succeeds offline (deterministic double)',
  );
  t.equal(run.runtime_kind, 'framework', 'the run records the framework runtime (no production egress)');
  const blockedRun = await runsUnavailable.executeRun(authorCtx, userR, {
    connectionId: connection.id,
    capabilityId: cap.id,
  });
  t.equal(
    blockedRun.status,
    'blocked',
    'a run against an unavailable runtime is durably BLOCKED (fail closed)',
  );

  // --- m31 IntegrationCapabilityCatalogPort: published capability available; unknown not ---------
  const avail = await catalog.getCapability(authorCtx, 'connector:sf/query');
  t.ok(avail.available, 'a published connector capability is available to the m31 catalog');
  const missing = await catalog.getCapability(authorCtx, 'connector:sf/unknown');
  t.ok(!missing.available, 'an unregistered capability is unavailable (fail closed)');
  const draftMissing = await catalog.getCapability(authorCtx, 'connector:nope/query');
  t.ok(!draftMissing.available, 'a capability of an unpublished connector is unavailable');
});
