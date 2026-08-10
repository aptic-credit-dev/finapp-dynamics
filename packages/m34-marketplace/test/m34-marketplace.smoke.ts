import { defineSuite } from '@finapp/test-runner';
import {
  M34_PERMISSIONS,
  ALL_M34_PERMISSIONS,
  M34_PRIVILEGED_PERMISSIONS,
  ALL_M34_AUDIT_CODES,
  MARKETPLACE_AUDIT_PREFIX,
  LISTING_STATES,
  isListingFrozen,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  evaluateConsentGate,
  screenInstallConfig,
  validateListing,
  isSecretReference,
  REASON_CODES,
  contentHashOf,
} from '../src/index.ts';

/**
 * M34 Marketplace PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the marketplace.* permission +
 * MARKETPLACE_ audit shape; maker-checker/SoD + publish gates; the CONSENT gate (human-only; AI never consents); the
 * SECRET-SEAM screening (a raw secret in an install config fails closed; secretref: passes); listing validation.
 */
export default defineSuite('m34-marketplace', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M34_PERMISSIONS.length, 8, 'eight marketplace.* permissions');
  for (const p of ALL_M34_PERMISSIONS) {
    t.ok(p.startsWith('marketplace.'), `${p} is in the marketplace namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M34_PERMISSIONS).size, ALL_M34_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M34_PERMISSIONS.includes('marketplace.admin' as never), 'there is NO marketplace.admin wildcard');
  t.equal(M34_PRIVILEGED_PERMISSIONS.length, 5, 'five privileged permissions');
  t.ok(
    M34_PRIVILEGED_PERMISSIONS.includes(M34_PERMISSIONS.listingPublish),
    'listing publish is privileged (controlled)',
  );
  t.ok(M34_PRIVILEGED_PERMISSIONS.includes(M34_PERMISSIONS.consentManage), 'consent manage is privileged');
  t.ok(M34_PRIVILEGED_PERMISSIONS.includes(M34_PERMISSIONS.upgradeApply), 'upgrade apply is privileged');
  t.ok(!M34_PRIVILEGED_PERMISSIONS.includes(M34_PERMISSIONS.listingAuthor), 'authoring is not privileged');

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M34_AUDIT_CODES.length, 16, 'sixteen MARKETPLACE_ audit codes');
  for (const c of ALL_M34_AUDIT_CODES) {
    t.ok(c.startsWith(MARKETPLACE_AUDIT_PREFIX), `${c} carries the MARKETPLACE_ prefix`);
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M34_AUDIT_CODES).size, ALL_M34_AUDIT_CODES.length, 'no duplicate audit code');

  // --- vocabulary ---------------------------------------------------------------------------------
  t.ok(
    LISTING_STATES.includes('published') && LISTING_STATES.includes('deprecated'),
    'listing states include published/deprecated',
  );
  t.ok(isListingFrozen('rejected'), 'rejected is terminal');
  t.ok(!isListingFrozen('published'), 'published is not terminal (may move to deprecated)');

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'the approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(
    !evaluatePublishGate({ validationPassed: false, requestedBy: 'u1', approver: 'u2' }).allowed,
    'an unvalidated listing cannot be published',
  );
  t.ok(
    evaluatePublishGate({ validationPassed: true, requestedBy: 'u1', approver: 'u2' }).allowed,
    'a validated + independently-approved listing can be published',
  );

  // --- CONSENT gate: AI never consents ------------------------------------------------------------
  t.ok(!evaluateConsentGate(null).allowed, 'a null grantor cannot consent');
  t.ok(!evaluateConsentGate('ai').allowed, 'AI cannot consent');
  t.ok(!evaluateConsentGate('system').allowed, 'system cannot consent');
  t.ok(!evaluateConsentGate('automation').allowed, 'automation cannot consent');
  t.equal(evaluateConsentGate('ai').reasonCode, REASON_CODES.notHumanConsent, 'consent-not-human reason');
  t.ok(evaluateConsentGate('user-123').allowed, 'a human can consent');
  t.ok(!isHumanActor('automation'), 'automation is not human');

  // --- SECRET SEAM: a raw secret value in an install config fails closed ---------------------------
  t.equal(
    screenInstallConfig({ region: 'eu', endpoint: 'https://x' }).length,
    0,
    'a non-secret config passes',
  );
  t.ok(
    screenInstallConfig({ api_key: 'sk-live-1234567890' }).length > 0,
    'a raw api_key VALUE in the config is rejected',
  );
  t.equal(
    screenInstallConfig({ api_key: 'sk-live-1234567890' })[0]?.code,
    REASON_CODES.secretValueForbidden,
    'the finding is secret_value_forbidden',
  );
  t.equal(
    screenInstallConfig({ token: 'secretref:vault/kv/x' }).length,
    0,
    'an opaque secretref: pointer in a secret-keyed field passes',
  );
  t.ok(isSecretReference('secretref:vault/kv/x'), 'the secretref pattern is reused from the m30 seam');

  // --- listing validation -------------------------------------------------------------------------
  t.ok(
    validateListing({
      listingKey: 'sf-crm',
      connectorRef: 'conn-uuid',
      category: 'crm',
      visibility: 'tenant',
    }).passed,
    'a valid listing passes',
  );
  t.ok(
    !validateListing({ listingKey: '', connectorRef: 'c', category: 'crm', visibility: 'tenant' }).passed,
    'an empty listing key fails',
  );
  t.ok(
    !validateListing({ listingKey: 'x', connectorRef: '', category: 'crm', visibility: 'tenant' }).passed,
    'an empty connector ref fails',
  );
  t.ok(
    !validateListing({ listingKey: 'x', connectorRef: 'c', category: 'ghost', visibility: 'tenant' }).passed,
    'an unknown category fails',
  );
  t.ok(
    !validateListing({ listingKey: 'x', connectorRef: 'c', category: 'crm', visibility: 'galactic' }).passed,
    'an unknown visibility fails',
  );

  // --- content hash deterministic -----------------------------------------------------------------
  t.equal(contentHashOf({ a: 1 }), contentHashOf({ a: 1 }), 'content hash is deterministic');
  t.ok(contentHashOf({ a: 1 }) !== contentHashOf({ a: 2 }), 'different definitions hash differently');
});
