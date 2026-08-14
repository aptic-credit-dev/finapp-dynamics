import { defineSuite } from '@finapp/test-runner';
import {
  M39_PERMISSIONS,
  ALL_M39_PERMISSIONS,
  M39_PRIVILEGED_PERMISSIONS,
  ALL_M39_AUDIT_CODES,
  SAAS_AUDIT_PREFIX,
  SUBSCRIPTION_STATES,
  isSubscriptionTransitionAllowed,
  isSubscriptionTerminal,
  evaluateEffectiveAccess,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  canReserve,
  isThreeSegmentPermission,
  isCurrencyCode,
  validatePlanVersion,
  REASON_CODES,
} from '../src/index.ts';

/**
 * M39 Commercial-SaaS PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the saas.* permission +
 * SAAS_ audit shape; THE ACCESS STACK truth table (RBAC ∧ entitlement ∧ feature/absolute — any deny denies; an entitlement is
 * never an authorization substitute); maker-checker/SoD; the subscription lifecycle; the RACE-SAFE quota arithmetic; the money
 * (currency/minor-unit) rules.
 */
export default defineSuite('m39-saas', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M39_PERMISSIONS.length, 12, 'twelve saas.* permissions');
  for (const p of ALL_M39_PERMISSIONS) {
    t.ok(p.startsWith('saas.'), `${p} is in the saas namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M39_PERMISSIONS).size, ALL_M39_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M39_PERMISSIONS.includes('saas.admin' as never), 'there is NO saas.admin wildcard');
  t.equal(M39_PRIVILEGED_PERMISSIONS.length, 4, 'four privileged permissions');
  t.ok(M39_PRIVILEGED_PERMISSIONS.includes(M39_PERMISSIONS.planPublish), 'plan publish is privileged');
  t.ok(
    M39_PRIVILEGED_PERMISSIONS.includes(M39_PERMISSIONS.subscriptionManage),
    'subscription manage is privileged',
  );
  t.ok(
    M39_PRIVILEGED_PERMISSIONS.includes(M39_PERMISSIONS.overrideAdminister),
    'override administer is privileged',
  );
  t.ok(!M39_PRIVILEGED_PERMISSIONS.includes(M39_PERMISSIONS.planRead), 'reading is not privileged');

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M39_AUDIT_CODES.length, 22, 'twenty-two SAAS_ audit codes');
  for (const c of ALL_M39_AUDIT_CODES) {
    t.ok(c.startsWith(SAAS_AUDIT_PREFIX), `${c} carries the SAAS_ prefix`);
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M39_AUDIT_CODES).size, ALL_M39_AUDIT_CODES.length, 'no duplicate audit code');

  // --- THE ACCESS STACK: RBAC ∧ ENTITLEMENT ∧ FEATURE/ABSOLUTE (load-bearing) ----------------------
  t.ok(
    !evaluateEffectiveAccess({ rbacAllowed: false, entitlementAllowed: true, featureAllowed: true }).allowed,
    'RBAC deny + entitlement allow + flag allow = DENY (entitlement is never an authorization substitute)',
  );
  t.equal(
    evaluateEffectiveAccess({ rbacAllowed: false, entitlementAllowed: true, featureAllowed: true })
      .reasonCode,
    REASON_CODES.rbacDenied,
    'the denial names RBAC',
  );
  t.ok(
    !evaluateEffectiveAccess({ rbacAllowed: true, entitlementAllowed: false, featureAllowed: true }).allowed,
    'RBAC allow + entitlement deny + flag allow = DENY',
  );
  t.ok(
    !evaluateEffectiveAccess({ rbacAllowed: true, entitlementAllowed: true, featureAllowed: false }).allowed,
    'RBAC allow + entitlement allow + flag deny = DENY (a flag cannot override an entitlement — nor grant one)',
  );
  t.ok(
    evaluateEffectiveAccess({ rbacAllowed: true, entitlementAllowed: true, featureAllowed: true }).allowed,
    'all allow = ALLOW',
  );
  t.ok(
    !evaluateEffectiveAccess({
      rbacAllowed: true,
      entitlementAllowed: true,
      featureAllowed: true,
      absoluteBlocked: true,
    }).allowed,
    'a platform-ABSOLUTE block denies even when RBAC + entitlement + flag all allow (m30 absolute is authoritative)',
  );
  t.equal(
    evaluateEffectiveAccess({
      rbacAllowed: true,
      entitlementAllowed: true,
      featureAllowed: true,
      absoluteBlocked: true,
    }).reasonCode,
    REASON_CODES.absoluteBlocked,
    'the denial names the platform-absolute block',
  );

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'the approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve');
  t.ok(!evaluateSodGate('u1', 'system').allowed, 'a system actor cannot approve');
  t.ok(!evaluateSodGate('u1', 'automation').allowed, 'an automation actor cannot approve');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(!isHumanActor('ai') && !isHumanActor('system') && !isHumanActor(null), 'ai/system/null are not human');
  t.ok(
    !evaluatePublishGate({ validationPassed: false, requestedBy: 'u1', approver: 'u2' }).allowed,
    'an unvalidated plan version cannot be published',
  );
  t.ok(
    evaluatePublishGate({ validationPassed: true, requestedBy: 'u1', approver: 'u2' }).allowed,
    'a validated + independently-approved plan version can be published',
  );

  // --- subscription lifecycle ---------------------------------------------------------------------
  t.ok(
    SUBSCRIPTION_STATES.includes('trial') && SUBSCRIPTION_STATES.includes('expired'),
    'lifecycle states present',
  );
  t.ok(isSubscriptionTransitionAllowed('trial', 'active'), 'trial -> active is allowed');
  t.ok(isSubscriptionTransitionAllowed('active', 'suspended'), 'active -> suspended is allowed');
  t.ok(
    !isSubscriptionTransitionAllowed('cancelled', 'active'),
    'cancelled -> active is NOT allowed (terminal)',
  );
  t.ok(
    !isSubscriptionTransitionAllowed('draft', 'suspended'),
    'draft -> suspended is NOT a governed transition',
  );
  t.ok(
    isSubscriptionTerminal('cancelled') && isSubscriptionTerminal('expired'),
    'cancelled/expired are terminal',
  );

  // --- RACE-SAFE quota arithmetic -----------------------------------------------------------------
  t.ok(
    canReserve({ reserved: 0, limit: 10, quantity: 10 }).allowed,
    'a reservation up to the limit is allowed',
  );
  t.ok(
    !canReserve({ reserved: 8, limit: 10, quantity: 3 }).allowed,
    'a reservation past the hard limit is refused',
  );
  t.equal(
    canReserve({ reserved: 8, limit: 10, quantity: 3 }).reasonCode,
    REASON_CODES.quotaExceeded,
    'the finding is quota_exceeded (never oversubscribe a hard limit)',
  );
  t.ok(!canReserve({ reserved: 0, limit: 10, quantity: 0 }).allowed, 'a non-positive quantity is refused');
  t.ok(
    canReserve({ reserved: 999999999999n, limit: 1000000000000n, quantity: 1n }).allowed,
    'bigint quantities are exact (no float)',
  );

  // --- money / validation -------------------------------------------------------------------------
  t.ok(isThreeSegmentPermission('finance.journal.post'), 'a 3-segment permission is well-formed');
  t.ok(isCurrencyCode('USD') && isCurrencyCode('KES'), 'a 3-letter currency is valid');
  t.ok(!isCurrencyCode('dollars') && !isCurrencyCode('US'), 'a non-ISO currency is rejected');
  t.ok(
    validatePlanVersion({
      currency: 'USD',
      baseAmountMinor: 1999n,
      billingInterval: 'monthly',
      entitlements: [{ capabilityKey: 'a.b.c', allowance: 'included' }],
    }).passed,
    'a valid plan version passes',
  );
  t.ok(
    !validatePlanVersion({
      currency: 'usd',
      baseAmountMinor: 0n,
      billingInterval: 'monthly',
      entitlements: [],
    }).passed,
    'a bad currency fails validation',
  );
  t.ok(
    !validatePlanVersion({
      currency: 'USD',
      baseAmountMinor: -5n,
      billingInterval: 'monthly',
      entitlements: [],
    }).passed,
    'a negative amount fails validation (no float, no negative money)',
  );
});
