import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M30Emitter,
  PlatformRepository,
  PlatformMetadataService,
  PlatformConfigService,
  PlatformFeatureService,
  PlatformSecretReferenceService,
  M30_PERMISSIONS,
  ALL_M30_PERMISSIONS,
} from '@finapp/m30-platform';

/**
 * M30 services DB spec — proves the platform-foundation pipeline END TO END on a REAL PostgreSQL: register metadata;
 * define/publish/set governed config (plain and SECRET-BEARING — a secret-bearing value stores an opaque reference,
 * NEVER a value; a raw secret value is refused); define/assign/evaluate feature flags — an ABSOLUTE flag can never be
 * weakened by a tenant override, and A FEATURE FLAG IS NEVER AN AUTHORIZATION SUBSTITUTE (RBAC DENY + FEATURE ENABLED =
 * DENY); a PLATFORM-scoped mutation requires the control-plane permission (a tenant admin cannot mutate platform
 * controls); register/rotate/revoke opaque secret references (a revoked reference is unavailable; a raw secret is
 * refused). Idempotency; optimistic concurrency; default deny; privacy-safe audit (no secret value); the one m06 outbox
 * carries platform.lifecycle (m30 owns none); cross-tenant isolation.
 */
export default defineDbSpec('m30-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M30Emitter(audit, outbox);
  const repo = new PlatformRepository();
  const metadata = new PlatformMetadataService(db, authz, emitter, repo);
  const config = new PlatformConfigService(db, authz, emitter, repo);
  const feature = new PlatformFeatureService(db, authz, emitter, repo);
  const secrets = new PlatformSecretReferenceService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const actor = randomUUID();
  const full = [...ALL_M30_PERMISSIONS];
  const ctxOf = (p: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId: actor,
    correlationId: randomUUID(),
    permissions: [...p],
  });
  const adminCtx = ctxOf(full);

  // --- metadata ---------------------------------------------------------------------------------
  const meta = await metadata.registerMetadata(adminCtx, actor, {
    scope: 'tenant',
    category: 'branding',
    metaKey: 'brand.name',
    value: { name: 'Acme' },
  });
  t.equal(meta.status, 'active', 'metadata is registered active');

  // --- config: plain value ----------------------------------------------------------------------
  const def = await config.defineConfig(adminCtx, actor, {
    scope: 'tenant',
    configKey: 'app.pageSize',
    valueType: 'number',
    idempotencyKey: `cd-${randomUUID()}`,
  });
  const published = await config.publishConfig(adminCtx, actor, def.id, def.version);
  t.equal(published.status, 'active', 'config definition publishes active');
  await config.setConfigValue(adminCtx, actor, def.id, { scope: 'tenant', value: 50 });
  const resolved = await config.resolveConfig(adminCtx, { scope: 'tenant', configKey: 'app.pageSize' });
  t.ok(
    resolved.found && resolved.value === 50 && resolved.secretRef === null,
    'a plain config value resolves to its value (no secret ref)',
  );

  // --- config: SECRET-BEARING — opaque reference only; a raw value is refused --------------------
  const secretDef = await config.defineConfig(adminCtx, actor, {
    scope: 'tenant',
    configKey: 'smtp.password',
    valueType: 'secret_ref',
    secretBearing: true,
  });
  await config.publishConfig(adminCtx, actor, secretDef.id, secretDef.version);
  await t.rejects(
    config.setConfigValue(adminCtx, actor, secretDef.id, { scope: 'tenant', value: 'hunter2' }),
    'a raw secret value is refused for a secret-bearing setting (no secret stored, fail closed)',
  );
  await config.setConfigValue(adminCtx, actor, secretDef.id, {
    scope: 'tenant',
    secretRef: 'secretref:vault/kv/smtp',
  });
  const resolvedSecret = await config.resolveConfig(adminCtx, {
    scope: 'tenant',
    configKey: 'smtp.password',
  });
  t.ok(
    resolvedSecret.secretBearing &&
      resolvedSecret.value === null &&
      resolvedSecret.secretRef === 'secretref:vault/kv/smtp',
    'a secret-bearing config resolves to the opaque REFERENCE only, never a value',
  );

  // --- feature: non-absolute, tenant override applies -------------------------------------------
  const fdef = await feature.defineFeature(adminCtx, actor, {
    scope: 'tenant',
    featureKey: 'beta.dashboard',
    defaultEnabled: true,
  });
  const beforeOverride = await feature.isFeatureEnabled(adminCtx, {
    scope: 'tenant',
    featureKey: 'beta.dashboard',
  });
  t.equal(beforeOverride, true, 'a feature evaluates to its default (enabled) with no override');
  await feature.assignFeature(adminCtx, actor, fdef.id, {
    scope: 'tenant',
    enabled: false,
    reasonCode: 'tenant_opt_out',
  });
  const afterOverride = await feature.isFeatureEnabled(adminCtx, {
    scope: 'tenant',
    featureKey: 'beta.dashboard',
  });
  t.equal(afterOverride, false, 'a tenant override applies to a non-absolute flag (evaluates disabled)');

  // --- feature: ABSOLUTE flag cannot be overridden by a tenant assignment ------------------------
  const absDef = await feature.defineFeature(adminCtx, actor, {
    scope: 'platform',
    featureKey: 'security.mfa_required',
    defaultEnabled: true,
    isAbsolute: true,
  });
  await t.rejects(
    feature.assignFeature(adminCtx, actor, absDef.id, { scope: 'tenant', enabled: false }),
    'a tenant can NEVER override a platform-absolute control (fail closed)',
  );

  // --- A FEATURE FLAG IS NEVER AN AUTHORIZATION SUBSTITUTE: RBAC DENY + FEATURE ENABLED = DENY ----
  const featureOnlyCtx = ctxOf([M30_PERMISSIONS.featureRead]);
  const canEvaluate = await feature.isFeatureEnabled(featureOnlyCtx, {
    scope: 'tenant',
    featureKey: 'beta.dashboard',
  });
  t.equal(typeof canEvaluate, 'boolean', 'a caller with feature.read can evaluate a flag');
  await t.rejects(
    metadata.registerMetadata(featureOnlyCtx, actor, { scope: 'tenant', category: 'custom', metaKey: 'x' }),
    'a feature flag NEVER grants authority — a caller lacking platform.metadata.manage is denied even when a feature is enabled (RBAC authoritative)',
  );

  // --- PLATFORM scope requires the control-plane permission -------------------------------------
  const noAdminCtx = ctxOf([M30_PERMISSIONS.configManage, M30_PERMISSIONS.configRead]);
  await t.rejects(
    config.defineConfig(noAdminCtx, actor, {
      scope: 'platform',
      configKey: 'platform.rate_limit',
      valueType: 'number',
    }),
    'a platform-scoped mutation without platform.control.administer is denied (a tenant admin cannot mutate platform controls)',
  );
  const platformDef = await config.defineConfig(adminCtx, actor, {
    scope: 'platform',
    configKey: 'platform.rate_limit',
    valueType: 'number',
  });
  t.equal(
    platformDef.scope,
    'platform',
    'a caller with platform.control.administer may define a platform-scoped config',
  );

  // --- secret references: invalid refused; opaque accepted; rotate/revoke; revoked unavailable ---
  await t.rejects(
    secrets.registerSecretReference(adminCtx, actor, {
      scope: 'tenant',
      refKey: 'bad',
      secretRef: 'hunter2',
    }),
    'a raw secret is refused as a reference (opaque secretref: only)',
  );
  const ref = await secrets.registerSecretReference(adminCtx, actor, {
    scope: 'tenant',
    refKey: 'db.password',
    secretRef: 'secretref:vault/kv/db',
    purpose: 'db',
  });
  const avail = await secrets.getReferenceAvailability(adminCtx, ref.id);
  t.ok(avail.available, 'a well-formed reference resolves available (metadata only, never a value)');
  const revoked = await secrets.revokeSecretReference(adminCtx, actor, ref.id, ref.version);
  t.equal(revoked.status, 'revoked', 'a reference can be revoked');
  const availAfter = await secrets.getReferenceAvailability(adminCtx, ref.id);
  t.ok(!availAfter.available, 'a revoked reference is unavailable (fail closed)');

  // --- idempotency + concurrency ----------------------------------------------------------------
  const key = `cd-${randomUUID()}`;
  const first = await config.defineConfig(adminCtx, actor, {
    scope: 'tenant',
    configKey: 'a.b',
    valueType: 'text',
    idempotencyKey: key,
  });
  const replay = await config.defineConfig(adminCtx, actor, {
    scope: 'tenant',
    configKey: 'a.b',
    valueType: 'text',
    idempotencyKey: key,
  });
  t.equal(replay.id, first.id, 'a replayed idempotency key returns the same definition');
  await t.rejects(
    config.publishConfig(adminCtx, actor, def.id, def.version + 99),
    'a stale expectedVersion is rejected (optimistic concurrency)',
  );

  // --- default deny -----------------------------------------------------------------------------
  await t.rejects(
    config.defineConfig(ctxOf([]), actor, { scope: 'tenant', configKey: 'x', valueType: 'text' }),
    'a caller without platform.config.manage is denied (default deny)',
  );

  // --- audit carries NO secret value ------------------------------------------------------------
  const auditJson = JSON.stringify(audit.entries);
  t.ok(
    !auditJson.includes('hunter2') && !auditJson.includes('secretref:vault/kv/smtp'),
    'no secret value or resolved reference appears in any audit entry',
  );
  t.ok(
    audit.entries.some((e) => e.code === 'PLATFORM_CONFIG_PUBLISHED') &&
      audit.entries.some((e) => e.code === 'PLATFORM_FEATURE_OVERRIDE_BLOCKED') &&
      audit.entries.some((e) => e.code === 'PLATFORM_SECRET_REFERENCE_REGISTERED'),
    'config publish, absolute-override block and secret-reference registration are all audited (PLATFORM_)',
  );

  // --- the one m06 outbox carries platform.lifecycle events (m30 owns none) ----------------------
  t.ok(
    outbox.events.length > 0 && outbox.events.every((e) => e.family === 'platform.lifecycle'),
    'm30 emits only platform.lifecycle events (owns no outbox)',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...adminCtx, tenantId: randomUUID() };
  const crossed = await config.resolveConfig(otherTenant, { scope: 'tenant', configKey: 'app.pageSize' });
  t.ok(!crossed.found, "another tenant cannot resolve this tenant's config (RLS)");
});
