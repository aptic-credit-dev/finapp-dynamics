import { defineSuite } from '@finapp/test-runner';
import {
  M40_PERMISSIONS,
  ALL_M40_PERMISSIONS,
  M40_PRIVILEGED_PERMISSIONS,
  ALL_M40_AUDIT_CODES,
  RESILIENCE_AUDIT_PREFIX,
  RESTORE_STATES,
  isRestoreTransitionAllowed,
  isRestoreTerminal,
  evaluateOfflineFinalization,
  isHumanActor,
  evaluateSodGate,
  isThreeSegmentPermission,
  isValidObjective,
  validateOfflineRequest,
  isSecretReference,
  REASON_CODES,
} from '../src/index.ts';

/**
 * M40 Resilience PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the resilience.* permission +
 * RESILIENCE_ audit shape; THE OFFLINE FINALIZATION BLOCK (a controlled action can never be finalized offline — it needs online
 * re-validation + the required permission + no expiry; fail closed); maker-checker/SoD; the restore lifecycle; integer RTO/RPO;
 * the secretref seam.
 */
export default defineSuite('m40-resilience', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M40_PERMISSIONS.length, 12, 'twelve resilience.* permissions');
  for (const p of ALL_M40_PERMISSIONS) {
    t.ok(p.startsWith('resilience.'), `${p} is in the resilience namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M40_PERMISSIONS).size, ALL_M40_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M40_PERMISSIONS.includes('resilience.admin' as never), 'there is NO resilience.admin wildcard');
  t.equal(M40_PRIVILEGED_PERMISSIONS.length, 2, 'two privileged permissions');
  t.ok(
    M40_PRIVILEGED_PERMISSIONS.includes(M40_PERMISSIONS.restoreApprove),
    'restore/failover approval is privileged',
  );
  t.ok(
    M40_PRIVILEGED_PERMISSIONS.includes(M40_PERMISSIONS.administer),
    'the control-plane permission is privileged',
  );
  t.ok(
    !M40_PRIVILEGED_PERMISSIONS.includes(M40_PERMISSIONS.observabilityRead),
    'reading observability is not privileged',
  );

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M40_AUDIT_CODES.length, 20, 'twenty RESILIENCE_ audit codes');
  for (const c of ALL_M40_AUDIT_CODES) {
    t.ok(c.startsWith(RESILIENCE_AUDIT_PREFIX), `${c} carries the RESILIENCE_ prefix`);
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M40_AUDIT_CODES).size, ALL_M40_AUDIT_CODES.length, 'no duplicate audit code');

  // --- THE OFFLINE FINALIZATION BLOCK (load-bearing) ----------------------------------------------
  t.ok(
    !evaluateOfflineFinalization({
      controlled: true,
      validatedOnline: false,
      requiredPermissionHeldOnline: true,
      expired: false,
    }).allowed,
    'a CONTROLLED action cannot be finalized offline (no online re-validation) — BLOCKED',
  );
  t.equal(
    evaluateOfflineFinalization({
      controlled: true,
      validatedOnline: false,
      requiredPermissionHeldOnline: true,
      expired: false,
    }).reasonCode,
    REASON_CODES.offlineFinalizationBlocked,
    'the finding is offline_finalization_blocked',
  );
  t.ok(
    !evaluateOfflineFinalization({
      controlled: true,
      validatedOnline: true,
      requiredPermissionHeldOnline: false,
      expired: false,
    }).allowed,
    'a controlled action whose current online actor lacks the permission is refused (RBAC re-validation)',
  );
  t.equal(
    evaluateOfflineFinalization({
      controlled: true,
      validatedOnline: true,
      requiredPermissionHeldOnline: false,
      expired: false,
    }).reasonCode,
    REASON_CODES.offlineRbacRevalidationFailed,
    'the finding is offline_rbac_revalidation_failed (a cached permission is never final authority)',
  );
  t.ok(
    !evaluateOfflineFinalization({
      controlled: true,
      validatedOnline: true,
      requiredPermissionHeldOnline: true,
      expired: true,
    }).allowed,
    'an EXPIRED request fails closed even when re-validated',
  );
  t.ok(
    evaluateOfflineFinalization({
      controlled: true,
      validatedOnline: true,
      requiredPermissionHeldOnline: true,
      expired: false,
    }).allowed,
    'a controlled action re-validated online (permission held, authorized, not expired) may be applied',
  );
  t.ok(
    evaluateOfflineFinalization({
      controlled: false,
      validatedOnline: false,
      requiredPermissionHeldOnline: false,
      expired: false,
    }).allowed,
    'a non-controlled (read/draft) sync may apply without online authorization',
  );
  t.ok(
    !evaluateOfflineFinalization({
      controlled: false,
      validatedOnline: true,
      requiredPermissionHeldOnline: true,
      expired: true,
    }).allowed,
    'even a non-controlled request fails closed if expired',
  );

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'a restore approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve a restore/failover');
  t.ok(!evaluateSodGate('u1', 'system').allowed, 'a system actor cannot approve');
  t.ok(!evaluateSodGate('u1', 'automation').allowed, 'an automation actor cannot approve');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(!isHumanActor('ai') && !isHumanActor('system') && !isHumanActor(null), 'ai/system/null are not human');

  // --- restore lifecycle --------------------------------------------------------------------------
  t.ok(RESTORE_STATES.includes('approved') && RESTORE_STATES.includes('executed'), 'restore states present');
  t.ok(isRestoreTransitionAllowed('review_pending', 'approved'), 'review_pending -> approved is allowed');
  t.ok(isRestoreTransitionAllowed('approved', 'executed'), 'approved -> executed is allowed');
  t.ok(!isRestoreTransitionAllowed('executed', 'approved'), 'executed -> approved is NOT allowed (terminal)');
  t.ok(!isRestoreTransitionAllowed('draft', 'executed'), 'draft -> executed is NOT a governed transition');
  t.ok(isRestoreTerminal('executed') && isRestoreTerminal('rejected'), 'executed/rejected are terminal');

  // --- validation ---------------------------------------------------------------------------------
  t.ok(isThreeSegmentPermission('finance.journal.post'), 'a 3-segment permission is well-formed');
  t.ok(!isThreeSegmentPermission('post'), 'a 1-segment permission is rejected');
  t.ok(
    isValidObjective(3600) && isValidObjective(0) && isValidObjective(null),
    'RTO/RPO are non-negative integers or null',
  );
  t.ok(
    !isValidObjective(-1) && !isValidObjective(1.5),
    'a negative or fractional objective is rejected (no float)',
  );
  t.ok(
    validateOfflineRequest({ capabilityRef: 'journal:post', requiredPermission: 'finance.journal.post' })
      .passed,
    'a well-formed offline request passes',
  );
  t.ok(
    !validateOfflineRequest({ capabilityRef: '', requiredPermission: 'finance.journal.post' }).passed,
    'an offline request without a capability fails',
  );
  t.ok(
    !validateOfflineRequest({ capabilityRef: 'x', requiredPermission: 'post' }).passed,
    'an offline request without a 3-segment permission fails (never bypasses RBAC)',
  );
  t.ok(isSecretReference('secretref:vault/kv/x'), 'the secretref pattern is reused from the m30 seam');
  t.ok(!isSecretReference('raw-secret'), 'a raw secret value is not a secretref');
});
