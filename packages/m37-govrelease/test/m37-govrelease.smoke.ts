import { defineSuite } from '@finapp/test-runner';
import {
  M37_PERMISSIONS,
  ALL_M37_PERMISSIONS,
  M37_PRIVILEGED_PERMISSIONS,
  ALL_M37_AUDIT_CODES,
  GOVRELEASE_AUDIT_PREFIX,
  RELEASE_STATES,
  isReleaseFrozen,
  isHumanActor,
  evaluateSodGate,
  evaluateApprovalGate,
  evaluateQaGate,
  validateRelease,
  validateSignatureRef,
  isSecretReference,
  REASON_CODES,
  contentHashOf,
} from '../src/index.ts';

/**
 * M37 Integration Governance/QA/Release PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the
 * govrelease.* permission + GOVRELEASE_ audit shape; maker-checker/SoD + approval gates; the QA evidence gate (every required
 * gate passed); release validation; and the signature SECRET seam (opaque secretref only).
 */
export default defineSuite('m37-govrelease', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M37_PERMISSIONS.length, 8, 'eight govrelease.* permissions');
  for (const p of ALL_M37_PERMISSIONS) {
    t.ok(p.startsWith('govrelease.'), `${p} is in the govrelease namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M37_PERMISSIONS).size, ALL_M37_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M37_PERMISSIONS.includes('govrelease.admin' as never), 'there is NO govrelease.admin wildcard');
  t.equal(M37_PRIVILEGED_PERMISSIONS.length, 3, 'three privileged permissions');
  t.ok(
    M37_PRIVILEGED_PERMISSIONS.includes(M37_PERMISSIONS.releaseApprove),
    'release approval is privileged (controlled)',
  );
  t.ok(M37_PRIVILEGED_PERMISSIONS.includes(M37_PERMISSIONS.releaseExecute), 'release execute is privileged');
  t.ok(!M37_PRIVILEGED_PERMISSIONS.includes(M37_PERMISSIONS.releaseAuthor), 'authoring is not privileged');

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M37_AUDIT_CODES.length, 16, 'sixteen GOVRELEASE_ audit codes');
  for (const c of ALL_M37_AUDIT_CODES) {
    t.ok(c.startsWith(GOVRELEASE_AUDIT_PREFIX), `${c} carries the GOVRELEASE_ prefix`);
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M37_AUDIT_CODES).size, ALL_M37_AUDIT_CODES.length, 'no duplicate audit code');
  t.ok(
    !ALL_M37_AUDIT_CODES.some((c) => c.startsWith('INTEGRATION_')),
    'no code reuses m33 INTEGRATION_ prefix (distinct GOVRELEASE_ ownership)',
  );

  // --- vocabulary ---------------------------------------------------------------------------------
  t.ok(
    RELEASE_STATES.includes('released') && RELEASE_STATES.includes('rolled_back'),
    'release states include released/rolled_back',
  );
  t.ok(isReleaseFrozen('rejected'), 'rejected is terminal');
  t.ok(!isReleaseFrozen('released'), 'released is not terminal (may roll back)');

  // --- maker-checker / SoD + approval -------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'the approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(
    !evaluateApprovalGate({ qaPassed: false, requestedBy: 'u1', approver: 'u2' }).allowed,
    'a release without a passing QA gate cannot be approved',
  );
  t.equal(
    evaluateApprovalGate({ qaPassed: false, requestedBy: 'u1', approver: 'u2' }).reasonCode,
    REASON_CODES.qaNotPassed,
    'the reason is qa_not_passed',
  );
  t.ok(
    evaluateApprovalGate({ qaPassed: true, requestedBy: 'u1', approver: 'u2' }).allowed,
    'a QA-passed, independently-approved release can be released',
  );
  t.ok(!isHumanActor('automation'), 'automation is not human');

  // --- QA evidence gate: every REQUIRED gate must be passed/waived --------------------------------
  t.ok(!evaluateQaGate([]).allowed, 'a release with no required gate cannot pass QA (fail closed)');
  t.ok(!evaluateQaGate([{ required: true, status: 'pending' }]).allowed, 'a pending required gate fails QA');
  t.ok(
    !evaluateQaGate([
      { required: true, status: 'passed' },
      { required: true, status: 'failed' },
    ]).allowed,
    'a failed required gate fails QA',
  );
  t.ok(
    evaluateQaGate([
      { required: true, status: 'passed' },
      { required: true, status: 'waived' },
      { required: false, status: 'pending' },
    ]).allowed,
    'all required gates passed/waived (a non-required pending gate is ignored) passes QA',
  );

  // --- release validation -------------------------------------------------------------------------
  t.ok(
    validateRelease({ releaseKey: 'r1', artifactRef: 'a1', environmentRef: 'e1', toVersion: 2 }).passed,
    'a valid release passes',
  );
  t.ok(
    !validateRelease({ releaseKey: '', artifactRef: 'a1', environmentRef: 'e1', toVersion: 2 }).passed,
    'an empty release key fails',
  );
  t.ok(
    !validateRelease({ releaseKey: 'r1', artifactRef: 'a1', environmentRef: 'e1', toVersion: 0 }).passed,
    'a zero target version fails',
  );

  // --- signature SECRET seam ----------------------------------------------------------------------
  t.equal(validateSignatureRef(null).length, 0, 'no signature is allowed (optional)');
  t.equal(validateSignatureRef('secretref:vault/kv/sig').length, 0, 'an opaque secretref signature passes');
  t.ok(validateSignatureRef('rawsignature').length > 0, 'a raw signature value is rejected');
  t.equal(
    validateSignatureRef('rawsignature')[0]?.code,
    REASON_CODES.invalidSecretReference,
    'the finding is invalid_secret_reference',
  );
  t.ok(isSecretReference('secretref:vault/kv/sig'), 'the secretref pattern is reused from the m30 seam');

  // --- content hash deterministic -----------------------------------------------------------------
  t.equal(contentHashOf({ a: 1 }), contentHashOf({ a: 1 }), 'content hash is deterministic');
  t.ok(contentHashOf({ a: 1 }) !== contentHashOf({ a: 2 }), 'different definitions hash differently');
});
