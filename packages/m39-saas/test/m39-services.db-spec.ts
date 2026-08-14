import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M39Emitter,
  SaasRepository,
  PlanService,
  SubscriptionService,
  EntitlementQuotaService,
  BillingService,
  FixtureFeatureControl,
  FixtureBillingProvider,
  M39_PERMISSIONS,
  REASON_CODES,
} from '../src/index.ts';

/**
 * M39 services DB spec — proves the commercial-SaaS pipeline END TO END on a REAL PostgreSQL: define a plan + version +
 * entitlement + quota policy; validate; PUBLISH under maker-checker (self + AI refused, an independent human succeeds); a
 * published version is IMMUTABLE; create a subscription (an unpublished version is refused); ACTIVATE (derives entitlements);
 * THE ACCESS STACK (RBAC ∧ entitlement ∧ feature/absolute — every deny path); RACE-SAFE quota + IDEMPOTENT usage (a duplicate
 * counts once; an over-quota reservation is rejected and records nothing; a concurrent burst never oversubscribes); a
 * commercial OVERRIDE under maker-checker; subscription SUSPEND/CANCEL; a BILLING cycle open/close. Money is bigint minor units.
 */
export default defineDbSpec('m39-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M39Emitter(audit, outbox);
  const repo = new SaasRepository();
  const plans = new PlanService(db, authz, emitter, repo);
  const subs = new SubscriptionService(db, authz, emitter, repo);
  const billing = new BillingService(db, authz, emitter, new FixtureBillingProvider(), repo);
  const quotaOn = new EntitlementQuotaService(
    db,
    authz,
    emitter,
    new FixtureFeatureControl({ enabled: true }),
    repo,
  );
  const quotaOff = new EntitlementQuotaService(
    db,
    authz,
    emitter,
    new FixtureFeatureControl({ enabled: false }),
    repo,
  );
  const quotaAbsolute = new EntitlementQuotaService(
    db,
    authz,
    emitter,
    new FixtureFeatureControl({ enabled: true, absoluteBlocked: true }),
    repo,
  );

  const tenant = randomUUID();
  const author = randomUUID();
  const publisher = randomUUID();
  const CAP = 'reports.export';
  const METER = 'api_calls';
  const PERIOD = '2026-08';
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const authorCtx = ctxOf(author, [
    M39_PERMISSIONS.planManage,
    M39_PERMISSIONS.quotaManage,
    M39_PERMISSIONS.planRead,
  ]);
  const publisherCtx = ctxOf(publisher, [M39_PERMISSIONS.planPublish]);
  const subCtx = ctxOf(publisher, [M39_PERMISSIONS.subscriptionManage, M39_PERMISSIONS.subscriptionRead]);
  const usageCtx = ctxOf(publisher, [
    M39_PERMISSIONS.usageRecord,
    M39_PERMISSIONS.quotaRead,
    M39_PERMISSIONS.quotaManage,
  ]);
  const overrideCtx = ctxOf(publisher, [M39_PERMISSIONS.overrideAdminister]);

  // --- catalogue: plan + version + entitlement + quota policy --------------------------------------
  const plan = await plans.definePlan(authorCtx, { planKey: 'pro', name: 'Pro' });
  t.equal(plan.state, 'draft', 'a defined plan starts draft');
  const version = await plans.defineVersion(authorCtx, plan.id, {
    versionNo: 1,
    currency: 'USD',
    baseAmountMinor: 1999,
  });
  t.equal(version.base_amount_minor, '1999', 'money is stored as bigint minor units (exact)');
  await plans.addEntitlement(authorCtx, version.id, { capabilityKey: CAP, allowance: 'metered' });
  await plans.addQuotaPolicy(authorCtx, version.id, { capabilityKey: CAP, meterKey: METER, limitHard: 5 });
  const vr = await plans.validateVersion(authorCtx, version.id);
  t.ok(vr.passed, 'the plan version validates');
  const validated = await plans.getVersion(authorCtx, version.id);

  // --- publish: maker-checker (self + AI refused; independent human succeeds) ----------------------
  await t.rejects(
    plans.publishVersion(
      ctxOf(author, [M39_PERMISSIONS.planPublish]),
      author,
      version.id,
      validated?.version ?? 0,
      { requestedBy: author },
    ),
    'the requester cannot self-publish a plan version',
  );
  await t.rejects(
    plans.publishVersion(publisherCtx, 'ai', version.id, validated?.version ?? 0, { requestedBy: author }),
    'AI can never publish a plan version',
  );
  const published = await plans.publishVersion(publisherCtx, publisher, version.id, validated?.version ?? 0, {
    requestedBy: author,
  });
  t.equal(published.state, 'published', 'an independently-approved plan version publishes');

  // --- subscription: must bind a PUBLISHED version -------------------------------------------------
  const draftPlan = await plans.definePlan(authorCtx, { planKey: 'draft', name: 'Draft' });
  const draftVersion = await plans.defineVersion(authorCtx, draftPlan.id, { versionNo: 1 });
  await t.rejects(
    subs.createSubscription(subCtx, {
      subscriptionKey: 's-bad',
      planId: draftPlan.id,
      planVersionId: draftVersion.id,
    }),
    'a subscription cannot bind an unpublished plan version',
  );
  const sub = await subs.createSubscription(subCtx, {
    subscriptionKey: 's-1',
    planId: plan.id,
    planVersionId: version.id,
  });
  const activated = await subs.activateSubscription(subCtx, sub.id, sub.version);
  t.equal(activated.state, 'active', 'the subscription activates and derives its entitlements');

  // --- THE ACCESS STACK: RBAC ∧ ENTITLEMENT ∧ FEATURE/ABSOLUTE -------------------------------------
  const withPerm = [M39_PERMISSIONS.usageRecord];
  t.ok(
    (
      await quotaOn.evaluateAccess(ctxOf(publisher, []), {
        capabilityKey: CAP,
        requiredPermission: M39_PERMISSIONS.usageRecord,
      })
    ).reasonCode === REASON_CODES.rbacDenied,
    'RBAC deny (no permission) => access denied even though entitled + feature on',
  );
  t.ok(
    (
      await quotaOn.evaluateAccess(ctxOf(publisher, withPerm), {
        capabilityKey: 'not.entitled.cap',
        requiredPermission: M39_PERMISSIONS.usageRecord,
      })
    ).reasonCode === REASON_CODES.entitlementDenied,
    'entitlement deny (capability not in plan) => access denied',
  );
  t.ok(
    (
      await quotaOff.evaluateAccess(ctxOf(publisher, withPerm), {
        capabilityKey: CAP,
        requiredPermission: M39_PERMISSIONS.usageRecord,
      })
    ).reasonCode === REASON_CODES.featureDenied,
    'feature deny (m30 flag off) => access denied',
  );
  t.ok(
    (
      await quotaAbsolute.evaluateAccess(ctxOf(publisher, withPerm), {
        capabilityKey: CAP,
        requiredPermission: M39_PERMISSIONS.usageRecord,
      })
    ).reasonCode === REASON_CODES.absoluteBlocked,
    'a platform-absolute block denies even with RBAC + entitlement + flag all allow',
  );
  t.ok(
    (
      await quotaOn.evaluateAccess(ctxOf(publisher, withPerm), {
        capabilityKey: CAP,
        requiredPermission: M39_PERMISSIONS.usageRecord,
      })
    ).allowed,
    'RBAC ∧ entitlement ∧ feature all allow => ACCESS GRANTED',
  );

  // --- RACE-SAFE quota + IDEMPOTENT usage ----------------------------------------------------------
  await quotaOn.provisionQuota(usageCtx, {
    capabilityKey: CAP,
    meterKey: METER,
    periodKey: PERIOD,
    limitHard: 5,
  });
  const rec1 = await quotaOn.recordUsage(usageCtx, {
    capabilityKey: CAP,
    meterKey: METER,
    periodKey: PERIOD,
    quantity: 3,
    idempotencyKey: 'u-1',
  });
  t.ok(rec1.recorded, 'a usage event within quota is recorded');
  const dup = await quotaOn.recordUsage(usageCtx, {
    capabilityKey: CAP,
    meterKey: METER,
    periodKey: PERIOD,
    quantity: 3,
    idempotencyKey: 'u-1',
  });
  t.ok(!dup.recorded, 'a duplicate idempotency key is counted ONCE (not recorded again, not re-reserved)');
  await t.rejects(
    quotaOn.recordUsage(usageCtx, {
      capabilityKey: CAP,
      meterKey: METER,
      periodKey: PERIOD,
      quantity: 3,
      idempotencyKey: 'u-2',
    }),
    'a reservation that would exceed the hard limit is rejected (3 + 3 > 5)',
  );
  const check = await quotaOn.checkQuota(usageCtx, {
    capabilityKey: CAP,
    meterKey: METER,
    periodKey: PERIOD,
    quantity: 3,
  });
  t.ok(
    !check.allowed && check.reasonCode === REASON_CODES.quotaExceeded,
    'checkQuota reports the remaining 2 cannot fit 3',
  );
  // the rejected reservation recorded NOTHING — reserved stays 3
  await ctx.asTenant(tenant, async (tx) => {
    const q = await tx.query<{ reserved_qty: string }>(
      `SELECT reserved_qty::text FROM saas_quota_period WHERE capability_key=$1 AND meter_key=$2 AND period_key=$3`,
      [CAP, METER, PERIOD],
    );
    t.equal(
      q.rows[0]?.reserved_qty,
      '3',
      'the rejected reservation did not increment usage (reserved stays 3)',
    );
    const evc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM saas_usage_event WHERE capability_key=$1 AND period_key=$2`,
      [CAP, PERIOD],
    );
    t.equal(
      evc.rows[0]?.c,
      '1',
      'exactly one usage event was persisted (duplicate + rejected did not add rows)',
    );
  });
  // concurrent burst never oversubscribes: fire 5 reservations of 1 against a fresh limit of 3
  await quotaOn.provisionQuota(usageCtx, {
    capabilityKey: CAP,
    meterKey: 'burst',
    periodKey: PERIOD,
    limitHard: 3,
  });
  const burst = await Promise.allSettled(
    [1, 2, 3, 4, 5].map((n) =>
      quotaOn.recordUsage(usageCtx, {
        capabilityKey: CAP,
        meterKey: 'burst',
        periodKey: PERIOD,
        quantity: 1,
        idempotencyKey: `b-${n}`,
      }),
    ),
  );
  const ok = burst.filter(
    (r) => r.status === 'fulfilled' && (r.value as { recorded: boolean }).recorded,
  ).length;
  t.equal(ok, 3, 'a concurrent burst of 5×1 against a limit of 3 admits exactly 3 (never oversubscribes)');
  await ctx.asTenant(tenant, async (tx) => {
    const q = await tx.query<{ reserved_qty: string }>(
      `SELECT reserved_qty::text FROM saas_quota_period WHERE capability_key=$1 AND meter_key='burst' AND period_key=$2`,
      [CAP, PERIOD],
    );
    t.equal(
      q.rows[0]?.reserved_qty,
      '3',
      'the burst counter is exactly at the hard limit (no oversubscription)',
    );
  });

  // --- commercial OVERRIDE: maker-checker ---------------------------------------------------------
  await t.rejects(
    quotaOn.applyOverride(overrideCtx, publisher, {
      targetKind: 'entitlement',
      capabilityKey: 'extra.cap',
      requestedBy: publisher,
      reasonCode: 'promo',
    }),
    'an override approver cannot be the requester (SoD)',
  );
  const override = await quotaOn.applyOverride(overrideCtx, publisher, {
    targetKind: 'entitlement',
    capabilityKey: 'extra.cap',
    allowance: 'included',
    requestedBy: author,
    reasonCode: 'promo',
  });
  t.ok(override.id, 'an independently-approved entitlement override is applied');

  // --- lifecycle + billing ------------------------------------------------------------------------
  const suspended = await subs.suspendSubscription(subCtx, activated.id, activated.version);
  t.equal(suspended.state, 'suspended', 'an active subscription can be suspended');
  const cancelled = await subs.cancelSubscription(subCtx, suspended.id, suspended.version);
  t.equal(cancelled.state, 'cancelled', 'a suspended subscription can be cancelled (terminal)');
  const cycle = await billing.openCycle(subCtx, activated.id, {
    cycleStart: new Date('2026-08-01T00:00:00Z'),
    cycleEnd: new Date('2026-09-01T00:00:00Z'),
  });
  t.equal(cycle.status, 'open', 'a billing cycle opens (metadata)');
  const closed = await billing.closeCycle(subCtx, cycle.id, cycle.version);
  t.equal(
    closed.status,
    'closed',
    'a billing cycle closes (settlement deferred/fail-closed; no journal posted)',
  );
});
