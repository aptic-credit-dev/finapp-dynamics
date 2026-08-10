import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M34Emitter,
  MarketplaceRepository,
  ListingService,
  InstallationService,
  FixtureConnectorRegistry,
  M34_PERMISSIONS,
} from '../src/index.ts';

/**
 * M34 services DB spec — proves the marketplace pipeline END TO END on a REAL PostgreSQL: define a listing over an m33
 * connector; validate + PUBLISH under maker-checker (self-approval + AI-approval + default-deny refused; a listing whose
 * connector is UNAVAILABLE in m33 is refused, fail closed); request an installation (a raw secret in the config is refused);
 * grant HUMAN consent (AI cannot consent) which activates it; attach an opaque secret reference (raw refused); apply an
 * UPGRADE under maker-checker (approver != install requester); and revoke consent (which suspends the installation).
 */
export default defineDbSpec('m34-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M34Emitter(audit, outbox);
  const repo = new MarketplaceRepository();
  const registry = new FixtureConnectorRegistry(['conn-1']); // only conn-1 is "published" in m33
  const listings = new ListingService(db, authz, emitter, registry, repo);
  const installs = new InstallationService(db, authz, emitter, registry, repo);

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
    M34_PERMISSIONS.listingAuthor,
    M34_PERMISSIONS.listingRead,
    M34_PERMISSIONS.installManage,
    M34_PERMISSIONS.installRead,
  ]);
  const approverCtx = ctxOf(userA, [M34_PERMISSIONS.listingPublish, M34_PERMISSIONS.listingRead]);
  const consentCtx = ctxOf(userA, [M34_PERMISSIONS.consentManage]);
  const upgradeCtx = ctxOf(userA, [M34_PERMISSIONS.upgradeApply]);

  // --- listing over an available m33 connector --------------------------------------------------
  const listing = await listings.defineListing(authorCtx, userR, {
    listingKey: 'sf',
    connectorRef: 'conn-1',
    title: 'Salesforce',
    category: 'crm',
  });
  t.equal(listing.state, 'draft', 'a listing starts draft');
  await listings.addCapability(authorCtx, userR, listing.id, {
    capabilityRef: 'connector:sf/query',
    requiredScope: 'read',
  });
  const vr = await listings.validateListing(authorCtx, userR, listing.id, listing.version);
  t.ok(vr.passed, 'a valid listing passes validation');
  const validated = await listings.getListing(authorCtx, listing.id);
  const reviewed = await listings.requestReview(authorCtx, userR, listing.id, validated?.version ?? 0);
  t.equal(reviewed.state, 'review_pending', 'a validated listing can be sent for review');

  // --- maker-checker refusals -------------------------------------------------------------------
  const selfCtx = ctxOf(userR, [M34_PERMISSIONS.listingPublish, M34_PERMISSIONS.listingRead]);
  await t.rejects(
    listings.publishListing(selfCtx, userR, listing.id, reviewed.version),
    'the requester cannot self-approve/publish a listing',
  );
  await t.rejects(
    listings.publishListing(approverCtx, 'ai', listing.id, reviewed.version),
    'AI can never approve/publish a listing',
  );
  await t.rejects(
    listings.publishListing(ctxOf(userA, [M34_PERMISSIONS.listingRead]), userA, listing.id, reviewed.version),
    'default deny — no marketplace.listing.publish, refused',
  );

  // --- publish by an independent human approver (connector available) ---------------------------
  const published = await listings.publishListing(approverCtx, userA, listing.id, reviewed.version);
  t.equal(
    published.state,
    'published',
    'an independently-approved listing over an available connector publishes',
  );

  // --- a listing whose connector is UNAVAILABLE in m33 cannot be published (fail closed) ---------
  const bad = await listings.defineListing(authorCtx, userR, {
    listingKey: 'nope',
    connectorRef: 'conn-unknown',
    title: 'Nope',
    category: 'crm',
  });
  await listings.validateListing(authorCtx, userR, bad.id, bad.version);
  const badV = await listings.getListing(authorCtx, bad.id);
  const badReviewed = await listings.requestReview(authorCtx, userR, bad.id, badV?.version ?? 0);
  await t.rejects(
    listings.publishListing(approverCtx, userA, bad.id, badReviewed.version),
    'a listing whose connector is unavailable in m33 cannot be published (fail closed)',
  );

  // --- installation: a raw secret in the config is refused; a clean install goes to consent_pending
  await t.rejects(
    installs.requestInstall(authorCtx, userR, {
      listingId: listing.id,
      installKey: 'i-bad',
      config: { api_key: 'sk-live-1' },
    }),
    'a raw secret VALUE in an install config is refused (secret seam)',
  );
  const install = await installs.requestInstall(authorCtx, userR, {
    listingId: listing.id,
    installKey: 'i1',
    config: { region: 'eu' },
  });
  t.equal(install.status, 'consent_pending', 'a clean installation awaits consent');

  // --- CONSENT: AI cannot consent; a human grants and activates ---------------------------------
  await t.rejects(
    installs.grantConsent(consentCtx, 'ai', install.id, { scopes: ['read'] }),
    'AI can never consent to a connector data access',
  );
  const consent = await installs.grantConsent(consentCtx, userA, install.id, { scopes: ['read'] });
  t.ok(consent.status === 'granted', 'a human grants consent');
  const active = await installs.getInstallation(authorCtx, install.id);
  t.equal(active?.status, 'active', 'granting consent activates the installation');

  // --- install secret: opaque reference only ----------------------------------------------------
  await t.rejects(
    installs.setSecret(authorCtx, userR, install.id, { purpose: 'oauth', secretRef: 'hunter2' }),
    'a raw secret cannot be attached — only an opaque secretref: pointer',
  );
  const secret = await installs.setSecret(authorCtx, userR, install.id, {
    purpose: 'oauth',
    secretRef: 'secretref:vault/kv/sf',
  });
  t.ok(
    secret.secret_ref.startsWith('secretref:'),
    'a secret is stored as an opaque reference only (no value)',
  );

  // --- UPGRADE: maker-checker (approver != install requester) ------------------------------------
  await t.rejects(
    installs.applyUpgrade(ctxOf(userR, [M34_PERMISSIONS.upgradeApply]), userR, install.id, { toVersion: 2 }),
    'the install requester cannot self-approve an upgrade (SoD)',
  );
  const upgrade = await installs.applyUpgrade(upgradeCtx, userA, install.id, { toVersion: 2 });
  t.ok(
    upgrade.status === 'applied' && upgrade.to_version === 2,
    'an independent human approver applies an upgrade',
  );
  const upgraded = await installs.getInstallation(authorCtx, install.id);
  t.equal(upgraded?.installed_version, 2, 'the installation records the new version');

  // --- revoke consent suspends the installation -------------------------------------------------
  const suspended = await installs.revokeConsent(consentCtx, userA, install.id);
  t.equal(suspended.status, 'suspended', 'revoking consent suspends the installation (access withdrawn)');
});
