import { defineSuite } from '@finapp/test-runner';
import {
  M35_PERMISSIONS,
  ALL_M35_PERMISSIONS,
  M35_PRIVILEGED_PERMISSIONS,
  ALL_M35_AUDIT_CODES,
  DEVPORTAL_AUDIT_PREFIX,
  PRODUCT_STATES,
  isProductFrozen,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  evaluateCredentialActorGate,
  validateCredentialSecret,
  isSecretHash,
  isThreeSegmentPermission,
  screenExposedOperations,
  validateProduct,
  isSecretReference,
  REASON_CODES,
  contentHashOf,
} from '../src/index.ts';

/**
 * M35 Developer Portal PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the devportal.* permission +
 * DEVPORTAL_ audit shape; maker-checker/SoD + publish gates; the CREDENTIAL actor gate (human-only; AI never issues); the
 * SECRET seam (a plaintext credential fails closed; a one-way sha256: hash XOR an opaque secretref: passes); the FACADE rule
 * (every exposed operation carries a 3-segment m02 permission); product validation.
 */
export default defineSuite('m35-devportal', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M35_PERMISSIONS.length, 8, 'eight devportal.* permissions');
  for (const p of ALL_M35_PERMISSIONS) {
    t.ok(p.startsWith('devportal.'), `${p} is in the devportal namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M35_PERMISSIONS).size, ALL_M35_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M35_PERMISSIONS.includes('devportal.admin' as never), 'there is NO devportal.admin wildcard');
  t.equal(M35_PRIVILEGED_PERMISSIONS.length, 4, 'four privileged permissions');
  t.ok(
    M35_PRIVILEGED_PERMISSIONS.includes(M35_PERMISSIONS.productPublish),
    'product publish is privileged (controlled)',
  );
  t.ok(
    M35_PRIVILEGED_PERMISSIONS.includes(M35_PERMISSIONS.credentialManage),
    'credential manage is privileged',
  );
  t.ok(
    M35_PRIVILEGED_PERMISSIONS.includes(M35_PERMISSIONS.subscriptionManage),
    'subscription manage is privileged',
  );
  t.ok(!M35_PRIVILEGED_PERMISSIONS.includes(M35_PERMISSIONS.appManage), 'app authoring is not privileged');

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M35_AUDIT_CODES.length, 18, 'eighteen DEVPORTAL_ audit codes');
  for (const c of ALL_M35_AUDIT_CODES) {
    t.ok(c.startsWith(DEVPORTAL_AUDIT_PREFIX), `${c} carries the DEVPORTAL_ prefix`);
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M35_AUDIT_CODES).size, ALL_M35_AUDIT_CODES.length, 'no duplicate audit code');

  // --- vocabulary ---------------------------------------------------------------------------------
  t.ok(
    PRODUCT_STATES.includes('published') && PRODUCT_STATES.includes('deprecated'),
    'product states include published/deprecated',
  );
  t.ok(isProductFrozen('rejected'), 'rejected is terminal');
  t.ok(!isProductFrozen('published'), 'published is not terminal (may move to deprecated)');

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'the approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(
    !evaluatePublishGate({ validationPassed: false, requestedBy: 'u1', approver: 'u2' }).allowed,
    'an unvalidated product cannot be published',
  );
  t.ok(
    evaluatePublishGate({ validationPassed: true, requestedBy: 'u1', approver: 'u2' }).allowed,
    'a validated + independently-approved product can be published',
  );

  // --- CREDENTIAL actor gate: AI never issues -----------------------------------------------------
  t.ok(!evaluateCredentialActorGate(null).allowed, 'a null actor cannot issue a credential');
  t.ok(!evaluateCredentialActorGate('ai').allowed, 'AI cannot issue a credential');
  t.ok(!evaluateCredentialActorGate('system').allowed, 'system cannot issue a credential');
  t.ok(!evaluateCredentialActorGate('automation').allowed, 'automation cannot issue a credential');
  t.equal(
    evaluateCredentialActorGate('ai').reasonCode,
    REASON_CODES.notHumanCredential,
    'credential-not-human reason',
  );
  t.ok(evaluateCredentialActorGate('user-123').allowed, 'a human can issue a credential');
  t.ok(!isHumanActor('automation'), 'automation is not human');

  // --- SECRET SEAM: no plaintext; sha256 hash XOR opaque secretref --------------------------------
  const goodHash = `sha256:${'a'.repeat(64)}`;
  t.ok(isSecretHash(goodHash), 'a well-formed sha256: hash is recognised');
  t.ok(!isSecretHash('hunter2'), 'a plaintext value is not a hash');
  t.equal(
    validateCredentialSecret({ secretHash: goodHash, secretRef: null }).length,
    0,
    'a one-way hash alone is valid credential material',
  );
  t.equal(
    validateCredentialSecret({ secretHash: null, secretRef: 'secretref:vault/kv/app' }).length,
    0,
    'an opaque secretref alone is valid credential material',
  );
  t.ok(
    validateCredentialSecret({ secretHash: 'hunter2', secretRef: null }).length > 0,
    'a plaintext (non-hash) secret is rejected',
  );
  t.ok(
    validateCredentialSecret({ secretHash: null, secretRef: null }).length > 0,
    'a credential with neither hash nor reference is rejected (no plaintext elsewhere)',
  );
  t.ok(
    validateCredentialSecret({ secretHash: goodHash, secretRef: 'secretref:x/y/z' }).length > 0,
    'a credential cannot carry BOTH a hash and a reference (exactly one)',
  );
  t.equal(
    validateCredentialSecret({ secretHash: 'hunter2', secretRef: null })[0]?.code,
    REASON_CODES.secretValueForbidden,
    'the finding is secret_value_forbidden',
  );
  t.ok(isSecretReference('secretref:vault/kv/x'), 'the secretref pattern is reused from the m30 seam');

  // --- FACADE rule: every exposed operation carries a 3-segment m02 permission ---------------------
  t.ok(isThreeSegmentPermission('finance.journal.post'), 'a 3-segment permission is well-formed');
  t.ok(!isThreeSegmentPermission('finance.post'), 'a 2-segment permission is rejected');
  t.ok(!isThreeSegmentPermission('finance..post'), 'an empty segment is rejected');
  t.equal(
    screenExposedOperations([{ operationRef: 'GET /invoices', requiredPermission: 'finance.invoice.read' }])
      .length,
    0,
    'an operation with a required permission passes the facade rule',
  );
  t.ok(
    screenExposedOperations([{ operationRef: 'GET /invoices', requiredPermission: 'read' }]).length > 0,
    'an operation without a 3-segment permission is rejected (facade never bypasses RBAC)',
  );
  t.equal(
    screenExposedOperations([{ operationRef: 'x', requiredPermission: 'read' }])[0]?.code,
    REASON_CODES.missingRequiredPermission,
    'the finding is exposed_operation_missing_permission',
  );

  // --- product validation -------------------------------------------------------------------------
  t.ok(
    validateProduct({
      productKey: 'billing-api',
      category: 'finance',
      visibility: 'tenant',
      sourceKind: 'internal',
      operations: [{ operationRef: 'GET /invoices', requiredPermission: 'finance.invoice.read' }],
    }).passed,
    'a valid product passes',
  );
  t.ok(
    !validateProduct({
      productKey: '',
      category: 'finance',
      visibility: 'tenant',
      sourceKind: 'internal',
      operations: [{ operationRef: 'x', requiredPermission: 'a.b.c' }],
    }).passed,
    'an empty product key fails',
  );
  t.ok(
    !validateProduct({
      productKey: 'p',
      category: 'finance',
      visibility: 'tenant',
      sourceKind: 'internal',
      operations: [],
    }).passed,
    'a product exposing no operations fails',
  );
  t.ok(
    !validateProduct({
      productKey: 'p',
      category: 'ghost',
      visibility: 'tenant',
      sourceKind: 'internal',
      operations: [{ operationRef: 'x', requiredPermission: 'a.b.c' }],
    }).passed,
    'an unknown category fails',
  );
  t.ok(
    !validateProduct({
      productKey: 'p',
      category: 'finance',
      visibility: 'tenant',
      sourceKind: 'internal',
      operations: [{ operationRef: 'x', requiredPermission: 'notthreeseg' }],
    }).passed,
    'an exposed operation without a required permission fails the facade rule',
  );

  // --- content hash deterministic -----------------------------------------------------------------
  t.equal(contentHashOf({ a: 1 }), contentHashOf({ a: 1 }), 'content hash is deterministic');
  t.ok(contentHashOf({ a: 1 }) !== contentHashOf({ a: 2 }), 'different definitions hash differently');
});
