import { defineSuite } from '@finapp/test-runner';
import {
  M41_PERMISSIONS,
  ALL_M41_PERMISSIONS,
  M41_PRIVILEGED_PERMISSIONS,
  ALL_M41_AUDIT_CODES,
  SEC_AUDIT_PREFIX,
  GRC_AUDIT_PREFIX,
  PRIV_AUDIT_PREFIX,
  SECRET_STATES,
  APPROVED_ALGORITHMS,
  isApprovedAlgorithm,
  isSecretTransitionAllowed,
  isSecretTerminal,
  evaluateSecurityPosture,
  isHumanActor,
  evaluateSodGate,
  evaluateDlp,
  isThreeSegmentPermission,
  isSecretReference,
  validateSecret,
  REASON_CODES,
} from '../src/index.ts';

/**
 * M41 Security PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the security. / grc. / privacy.
 * permission + SEC_/GRC_/PRIV_ audit shape; POSTURE OVER RBAC (security augments RBAC, never grants it — any deny denies);
 * maker-checker/SoD; the secret/key lifecycle; the APPROVED-ALGORITHM allowlist (no home-grown crypto); fail-closed DLP; the
 * secretref seam. No secret value is ever handled.
 */
export default defineSuite('m41-security', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M41_PERMISSIONS.length, 14, 'fourteen security/grc/privacy permissions');
  for (const p of ALL_M41_PERMISSIONS) {
    t.ok(
      p.startsWith('security.') || p.startsWith('grc.') || p.startsWith('privacy.'),
      `${p} is in the security/grc/privacy namespace`,
    );
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M41_PERMISSIONS).size, ALL_M41_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M41_PERMISSIONS.includes('security.admin' as never), 'there is NO security.admin wildcard');
  t.ok(!ALL_M41_PERMISSIONS.includes('grc.admin' as never), 'there is NO grc.admin wildcard');
  t.equal(M41_PRIVILEGED_PERMISSIONS.length, 4, 'four privileged permissions');
  t.ok(M41_PRIVILEGED_PERMISSIONS.includes(M41_PERMISSIONS.secretRotate), 'secret rotate is privileged');
  t.ok(M41_PRIVILEGED_PERMISSIONS.includes(M41_PERMISSIONS.secretReveal), 'secret reveal is privileged');
  t.ok(M41_PRIVILEGED_PERMISSIONS.includes(M41_PERMISSIONS.secretDestroy), 'secret destroy is privileged');
  t.ok(
    !M41_PRIVILEGED_PERMISSIONS.includes(M41_PERMISSIONS.secretRead),
    'reading a secret is not privileged',
  );

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M41_AUDIT_CODES.length, 18, 'eighteen SEC_/GRC_/PRIV_ audit codes');
  for (const c of ALL_M41_AUDIT_CODES) {
    t.ok(
      c.startsWith(SEC_AUDIT_PREFIX) || c.startsWith(GRC_AUDIT_PREFIX) || c.startsWith(PRIV_AUDIT_PREFIX),
      `${c} carries a SEC_/GRC_/PRIV_ prefix`,
    );
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M41_AUDIT_CODES).size, ALL_M41_AUDIT_CODES.length, 'no duplicate audit code');

  // --- POSTURE OVER RBAC (load-bearing, ADR-009) --------------------------------------------------
  t.ok(
    !evaluateSecurityPosture({ rbacAllowed: false, securityAllowed: true }).allowed,
    'RBAC deny + security allow = DENY (security posture never grants what RBAC denies)',
  );
  t.equal(
    evaluateSecurityPosture({ rbacAllowed: false, securityAllowed: true }).reasonCode,
    REASON_CODES.rbacDenied,
    'the denial names RBAC',
  );
  t.ok(
    !evaluateSecurityPosture({ rbacAllowed: true, securityAllowed: false }).allowed,
    'RBAC allow + security deny = DENY (security posture augments, and can block)',
  );
  t.equal(
    evaluateSecurityPosture({ rbacAllowed: true, securityAllowed: false }).reasonCode,
    REASON_CODES.securityDenied,
    'the denial names the security policy',
  );
  t.ok(
    !evaluateSecurityPosture({ rbacAllowed: true, securityAllowed: true, ownerAllowed: false }).allowed,
    'RBAC allow + security allow + owner deny = DENY (any deny denies)',
  );
  t.ok(
    evaluateSecurityPosture({ rbacAllowed: true, securityAllowed: true }).allowed,
    'RBAC allow + security allow = ALLOW',
  );

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'a secret approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve a secret action');
  t.ok(!evaluateSodGate('u1', 'system').allowed, 'a system actor cannot approve');
  t.ok(!evaluateSodGate('u1', 'automation').allowed, 'an automation actor cannot approve');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(!isHumanActor('ai') && !isHumanActor('system') && !isHumanActor(null), 'ai/system/null are not human');

  // --- secret/key lifecycle -----------------------------------------------------------------------
  t.ok(SECRET_STATES.includes('active') && SECRET_STATES.includes('destroyed'), 'lifecycle states present');
  t.ok(isSecretTransitionAllowed('pending_approval', 'active'), 'pending_approval -> active is allowed');
  t.ok(isSecretTransitionAllowed('active', 'rotating'), 'active -> rotating is allowed');
  t.ok(isSecretTransitionAllowed('revoked', 'destroyed'), 'revoked -> destroyed is allowed');
  t.ok(!isSecretTransitionAllowed('destroyed', 'active'), 'destroyed -> active is NOT allowed (terminal)');
  t.ok(!isSecretTransitionAllowed('draft', 'rotating'), 'draft -> rotating is NOT a governed transition');
  t.ok(isSecretTerminal('revoked') && isSecretTerminal('destroyed'), 'revoked/destroyed are terminal');

  // --- NO home-grown crypto -----------------------------------------------------------------------
  t.ok(APPROVED_ALGORITHMS.includes('aes-256-gcm'), 'aes-256-gcm is an approved algorithm');
  t.ok(
    isApprovedAlgorithm('rsa-4096') && isApprovedAlgorithm(null),
    'an approved algorithm (or none) passes',
  );
  t.ok(
    !isApprovedAlgorithm('rot13') && !isApprovedAlgorithm('home-grown'),
    'a home-grown/arbitrary algorithm is rejected',
  );

  // --- DLP (fail closed) --------------------------------------------------------------------------
  t.equal(
    evaluateDlp({ classification: 'restricted', looksSecret: true }).action,
    'block',
    'restricted data that looks secret is BLOCKED (never forwarded)',
  );
  t.equal(
    evaluateDlp({ classification: 'restricted', looksSecret: false, policyAction: 'block' }).action,
    'block',
    'a block policy blocks',
  );
  t.equal(
    evaluateDlp({ classification: 'internal', looksSecret: false }).action,
    'allow',
    'internal non-secret data is allowed',
  );

  // --- validation / secretref ---------------------------------------------------------------------
  t.ok(isThreeSegmentPermission('security.secret.rotate'), 'a 3-segment permission is well-formed');
  t.ok(isSecretReference('secretref:vault/kv/x'), 'the secretref pattern is reused from the m30 seam');
  t.ok(!isSecretReference('raw-secret-value'), 'a raw secret value is NOT a secretref');
  t.ok(
    validateSecret({ materialKind: 'key', secretRef: 'secretref:vault/kv/k1', algorithm: 'aes-256-gcm' })
      .passed,
    'a well-formed key with an approved algorithm passes',
  );
  t.ok(
    !validateSecret({ materialKind: 'key', secretRef: 'not-a-ref', algorithm: 'aes-256-gcm' }).passed,
    'a non-secretref is rejected (no raw secret value)',
  );
  t.ok(
    !validateSecret({ materialKind: 'key', secretRef: 'secretref:vault/kv/k1', algorithm: 'home-grown' })
      .passed,
    'a home-grown algorithm is rejected (no arbitrary crypto)',
  );
});
