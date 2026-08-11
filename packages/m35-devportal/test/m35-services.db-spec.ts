import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M35Emitter,
  DevportalRepository,
  AppService,
  ProductService,
  SubscriptionService,
  FixtureSourceCatalog,
  FixtureUsageQuota,
  UnavailableUsageQuota,
  M35_PERMISSIONS,
} from '../src/index.ts';

/**
 * M35 services DB spec — proves the developer-portal pipeline END TO END on a REAL PostgreSQL: register an app; ISSUE an API
 * credential (HUMAN only — AI refused; the plaintext is returned ONCE and only a one-way hash is stored); define an API
 * product + its ALLOW-LISTED operations (the FACADE rule); validate + PUBLISH under maker-checker (self-approval + AI-approval
 * + default-deny refused; a PUBLIC product needs the control-plane permission; a product whose source is UNAVAILABLE upstream
 * is refused, fail closed); SUBSCRIBE an app and APPROVE under maker-checker (a PUBLIC subscription FAILS CLOSED on the m39
 * quota while m39 is unbuilt, and succeeds once the quota permits it); rotate + revoke a credential (HUMAN only).
 */
export default defineDbSpec('m35-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M35Emitter(audit, outbox);
  const repo = new DevportalRepository();
  const sources = new FixtureSourceCatalog(['marketplace:listing-1']); // only listing-1 is "published" upstream
  const apps = new AppService(db, authz, emitter, repo);
  const products = new ProductService(db, authz, emitter, sources, repo);
  const subsDeny = new SubscriptionService(db, authz, emitter, new UnavailableUsageQuota(), repo);
  const subsAllow = new SubscriptionService(db, authz, emitter, new FixtureUsageQuota(true), repo);

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
    M35_PERMISSIONS.appManage,
    M35_PERMISSIONS.appRead,
    M35_PERMISSIONS.productAuthor,
    M35_PERMISSIONS.productRead,
    M35_PERMISSIONS.credentialManage,
    M35_PERMISSIONS.subscriptionManage,
  ]);
  const approverCtx = ctxOf(userA, [M35_PERMISSIONS.productPublish, M35_PERMISSIONS.productRead]);
  const adminCtx = ctxOf(userA, [
    M35_PERMISSIONS.productPublish,
    M35_PERMISSIONS.productRead,
    M35_PERMISSIONS.administer,
  ]);
  const subApproverCtx = ctxOf(userA, [M35_PERMISSIONS.subscriptionManage]);

  // --- register an app --------------------------------------------------------------------------
  const app = await apps.registerApp(authorCtx, userR, { appKey: 'acme', name: 'Acme' });
  t.equal(app.status, 'active', 'a registered app is active');

  // --- issue a credential: HUMAN only; plaintext returned once; only a hash is stored -----------
  await t.rejects(
    apps.issueCredential(ctxOf(userR, [M35_PERMISSIONS.credentialManage]), 'ai', app.id, {}),
    'AI can never issue an API credential',
  );
  const issued = await apps.issueCredential(authorCtx, userR, app.id, {});
  t.ok(
    issued.plaintextSecret?.startsWith('dps_') === true,
    'the plaintext secret is returned to the caller once',
  );
  t.ok(
    issued.credential.secret_hash?.startsWith('sha256:') === true,
    'only a one-way hash is stored (never the plaintext)',
  );
  t.ok(
    issued.credential.secret_hash !== issued.plaintextSecret,
    'the stored hash is not the plaintext secret',
  );
  t.equal(issued.credential.secret_ref, null, 'a generated credential stores no reference');

  // --- define a product + an ALLOW-LISTED operation (facade rule) -------------------------------
  const product = await products.defineProduct(authorCtx, userR, {
    productKey: 'billing',
    title: 'Billing API',
    category: 'finance',
  });
  t.equal(product.state, 'draft', 'a product starts draft');
  await t.rejects(
    products.addScope(authorCtx, userR, product.id, {
      operationRef: 'GET /invoices',
      requiredPermission: 'read',
    }),
    'an exposed operation without a 3-segment permission is refused (facade never bypasses RBAC)',
  );
  await products.addScope(authorCtx, userR, product.id, {
    operationRef: 'GET /invoices',
    requiredPermission: 'finance.invoice.read',
  });
  const vr = await products.validateProductById(authorCtx, userR, product.id, product.version);
  t.ok(vr.passed, 'a product exposing a permission-guarded operation passes validation');
  const validated = await products.getProduct(authorCtx, product.id);
  const reviewed = await products.requestReview(authorCtx, userR, product.id, validated?.version ?? 0);
  t.equal(reviewed.state, 'review_pending', 'a validated product can be sent for review');

  // --- maker-checker refusals -------------------------------------------------------------------
  await t.rejects(
    products.publishProduct(
      ctxOf(userR, [M35_PERMISSIONS.productPublish, M35_PERMISSIONS.productRead]),
      userR,
      product.id,
      reviewed.version,
    ),
    'the requester cannot self-approve/publish a product',
  );
  await t.rejects(
    products.publishProduct(approverCtx, 'ai', product.id, reviewed.version),
    'AI can never approve/publish a product',
  );
  await t.rejects(
    products.publishProduct(ctxOf(userA, [M35_PERMISSIONS.productRead]), userA, product.id, reviewed.version),
    'default deny — no devportal.product.publish, refused',
  );

  // --- publish an internal (tenant-visible) product by an independent human approver -------------
  const published = await products.publishProduct(approverCtx, userA, product.id, reviewed.version);
  t.equal(published.state, 'published', 'an independently-approved internal product publishes');

  // --- a PUBLIC product needs the control-plane permission --------------------------------------
  const pub = await products.defineProduct(authorCtx, userR, {
    productKey: 'public-billing',
    title: 'Public Billing',
    category: 'finance',
    visibility: 'public',
  });
  await products.addScope(authorCtx, userR, pub.id, {
    operationRef: 'GET /public/invoices',
    requiredPermission: 'finance.invoice.read',
  });
  await products.validateProductById(authorCtx, userR, pub.id, pub.version);
  const pubV = await products.getProduct(authorCtx, pub.id);
  const pubReviewed = await products.requestReview(authorCtx, userR, pub.id, pubV?.version ?? 0);
  await t.rejects(
    products.publishProduct(approverCtx, userA, pub.id, pubReviewed.version),
    'a PUBLIC product cannot be published without the control-plane permission',
  );
  const pubPublished = await products.publishProduct(adminCtx, userA, pub.id, pubReviewed.version);
  t.equal(pubPublished.state, 'published', 'a PUBLIC product publishes with the control-plane permission');

  // --- a product whose SOURCE is unavailable upstream cannot be published (fail closed) ----------
  const bad = await products.defineProduct(authorCtx, userR, {
    productKey: 'nope',
    title: 'Nope',
    category: 'integration',
    sourceKind: 'marketplace',
    sourceRef: 'listing-x', // not in the fixture's known-published set
  });
  await products.addScope(authorCtx, userR, bad.id, {
    operationRef: 'GET /x',
    requiredPermission: 'integration.connector.read',
  });
  await products.validateProductById(authorCtx, userR, bad.id, bad.version);
  const badV = await products.getProduct(authorCtx, bad.id);
  const badReviewed = await products.requestReview(authorCtx, userR, bad.id, badV?.version ?? 0);
  await t.rejects(
    products.publishProduct(approverCtx, userA, bad.id, badReviewed.version),
    'a product whose source is unavailable upstream cannot be published (fail closed)',
  );

  // --- subscribe an app to the tenant product; maker-checker approval ---------------------------
  const sub = await subsDeny.requestSubscription(authorCtx, userR, {
    appId: app.id,
    productId: published.id,
  });
  t.equal(sub.status, 'requested', 'a subscription starts requested');
  await t.rejects(
    subsDeny.approveSubscription(ctxOf(userR, [M35_PERMISSIONS.subscriptionManage]), userR, sub.id),
    'the subscription requester cannot self-approve (SoD)',
  );
  const activeSub = await subsDeny.approveSubscription(subApproverCtx, userA, sub.id);
  t.equal(activeSub.status, 'active', 'an independent human approver activates a tenant subscription');

  // --- a PUBLIC subscription FAILS CLOSED on the m39 quota while m39 is unbuilt ------------------
  const pubSub = await subsDeny.requestSubscription(authorCtx, userR, {
    appId: app.id,
    productId: pubPublished.id,
  });
  await t.rejects(
    subsDeny.approveSubscription(subApproverCtx, userA, pubSub.id),
    'a PUBLIC subscription fails closed on the m39 quota (m39 unbuilt)',
  );
  const pubActive = await subsAllow.approveSubscription(subApproverCtx, userA, pubSub.id);
  t.equal(pubActive.status, 'active', 'a PUBLIC subscription activates once the m39 quota permits it');

  // --- suspend the subscription (withdraw public API access) ------------------------------------
  const suspended = await subsAllow.suspendSubscription(subApproverCtx, userA, pubActive.id);
  t.equal(suspended.status, 'suspended', 'suspending a subscription withdraws access');

  // --- rotate + revoke a credential: HUMAN only -------------------------------------------------
  await t.rejects(
    apps.rotateCredential(ctxOf(userR, [M35_PERMISSIONS.credentialManage]), 'system', issued.credential.id),
    'system can never rotate a credential',
  );
  const rotated = await apps.rotateCredential(authorCtx, userR, issued.credential.id);
  t.ok(
    rotated.plaintextSecret !== null && rotated.credential.id !== issued.credential.id,
    'rotation issues a fresh credential and returns a new plaintext once',
  );
  const priorAfterRotate = await apps.getCredential(authorCtx, issued.credential.id);
  t.equal(priorAfterRotate?.status, 'rotated', 'the prior credential is marked rotated');
  const revoked = await apps.revokeCredential(authorCtx, userR, rotated.credential.id);
  t.equal(revoked.status, 'revoked', 'a human revokes a credential');
});
