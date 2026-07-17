import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { defineSuite } from '@finapp/test-runner';
import { validateEndpointSpec } from '@finapp/kernel';
import {
  DOMAIN_EVENT_FAMILIES,
  IDENTITY_LIFECYCLE_FAMILY,
  IDENTITY_LIFECYCLE_EVENT_TYPES,
} from '@finapp/contracts';
import {
  IDENTITY_STATUSES,
  ACCOUNT_STATUSES,
  MEMBERSHIP_STATUSES,
  checkIdentityTransition,
  checkAccountTransition,
  checkMembershipTransition,
  identityCanResolve,
  accountCanResolve,
  membershipCanResolve,
  isIdentityStatus,
  IDENTITY_TYPES,
  ACCOUNT_TYPES,
  SYSTEM_ACTORS,
  isIdentityType,
  isHumanIdentity,
  isSystemActor,
  accountTypeAllowsIdentityType,
  systemActorInheritsHumanPermissions,
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validateUsername,
  validateServiceAccountName,
  validateSystemAccountName,
  validatePhoneReadiness,
  validateAuthSubject,
  authSubjectKey,
  ALL_IDENTITY_PERMISSIONS,
  ALL_IDENTITY_AUDIT_CODES,
  IDENTITY_ACTION_MAP,
  ACCOUNT_ACTION_MAP,
  MEMBERSHIP_ACTION_MAP,
  IDENTITY_PERMISSION_NAMESPACE,
  IDENTITY_AUDIT_PREFIX,
  isDevActorAdapterAllowed,
  devActorAdapterRejectionReason,
  signDevAssertion,
  verifyDevAssertion,
  type IdentityAction,
} from '@finapp/m02-identity';

/**
 * M02 PURE smoke suite — the deterministic safety core, the dev adapter's failure modes, and registry
 * conformance.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const SECRET = 'a'.repeat(48);

function readYaml(relative: string): unknown {
  return parse(readFileSync(resolve(REPO_ROOT, relative), 'utf8'));
}

export default defineSuite('m02-identity', (t) => {
  // --- lifecycles ----------------------------------------------------------------------------------
  t.equal(IDENTITY_STATUSES.length, 7, 'seven identity statuses');
  t.equal(ACCOUNT_STATUSES.length, 6, 'six account statuses');
  t.equal(MEMBERSHIP_STATUSES.length, 4, 'four membership statuses');

  t.equal(checkIdentityTransition('draft', 'activate').to, 'active', 'identity draft -> active');
  t.ok(
    !checkIdentityTransition('draft', 'suspend', { reason: 'x' }).allowed,
    'cannot suspend a draft identity',
  );
  t.ok(!checkIdentityTransition('active', 'suspend').allowed, 'identity suspension requires a reason');
  t.ok(checkIdentityTransition('suspended', 'reactivate').allowed, 'identity suspended -> active');
  t.ok(!checkIdentityTransition('closed', 'reactivate').allowed, 'a closed identity is terminal — no reopen');
  t.ok(!checkIdentityTransition('closed', 'close', { reason: 'again' }).allowed, 'cannot close twice');

  t.equal(checkAccountTransition('pending_activation', 'activate').to, 'active', 'account pending -> active');
  t.ok(!checkAccountTransition('active', 'activate').allowed, 'cannot re-activate an active account');
  t.ok(!checkAccountTransition('active', 'suspend').allowed, 'account suspension requires a reason');
  t.ok(!checkAccountTransition('deactivated', 'reactivate').allowed, 'deactivated is terminal');
  // 1C readiness: locked/expired are declared but nothing in 1B produces them.
  t.ok(
    checkAccountTransition('locked', 'reactivate').allowed,
    'locked -> active is reachable (1C wires lockout)',
  );
  t.ok(checkAccountTransition('expired', 'reactivate').allowed, 'expired -> active is reachable (1C)');

  t.equal(checkMembershipTransition('pending', 'activate').to, 'active', 'membership pending -> active');
  t.ok(!checkMembershipTransition('ended', 'reactivate').allowed, 'an ended membership is never revived');
  t.ok(!checkMembershipTransition('active', 'end').allowed, 'ending a membership requires a reason');
  t.ok(checkMembershipTransition('active', 'end', { reason: 'leaver' }).allowed, 'leaver path works');

  t.ok(!checkIdentityTransition('draft', 'not_real' as IdentityAction).allowed, 'unknown action refused');

  // --- the three resolution gates ------------------------------------------------------------------
  // Each is independent: suspending a person, a login, or a membership must each be sufficient on its own.
  t.ok(identityCanResolve('active'), 'an active identity resolves');
  for (const s of IDENTITY_STATUSES) {
    if (s !== 'active') t.ok(!identityCanResolve(s), `a ${s} identity does NOT resolve`);
  }
  t.ok(accountCanResolve('active'), 'an active account resolves');
  for (const s of ACCOUNT_STATUSES) {
    if (s !== 'active') t.ok(!accountCanResolve(s), `a ${s} account does NOT resolve`);
  }
  t.ok(membershipCanResolve('active'), 'an active membership resolves');
  for (const s of MEMBERSHIP_STATUSES) {
    if (s !== 'active') t.ok(!membershipCanResolve(s), `a ${s} membership does NOT resolve`);
  }
  t.ok(!isIdentityStatus('enabled'), 'an unrecognised status is not a status (resolver fails closed on it)');

  // --- types and the human/machine boundary --------------------------------------------------------
  t.equal(IDENTITY_TYPES.length, 6, 'six identity types');
  t.equal(ACCOUNT_TYPES.length, 4, 'four account types');
  t.equal(SYSTEM_ACTORS.length, 4, 'four named system actors');
  t.ok(isSystemActor('scheduler_service'), 'scheduler_service is a system actor');
  t.ok(!isSystemActor('anything_else'), 'system actors are a closed list');
  t.ok(isHumanIdentity('contractor'), 'a contractor is a person');
  t.ok(!isHumanIdentity('service_identity'), 'a service identity is not a person');
  t.ok(!isIdentityType('robot'), 'unknown identity type rejected');

  // The rule that stops "log in as the scheduler".
  t.ok(accountTypeAllowsIdentityType('human', 'internal_person'), 'a human account may bind a person');
  t.ok(
    !accountTypeAllowsIdentityType('human', 'system_identity'),
    'a human account may NOT bind a system identity',
  );
  t.ok(!accountTypeAllowsIdentityType('system', 'internal_person'), 'a system account may NOT bind a person');
  t.ok(
    accountTypeAllowsIdentityType('service', 'service_identity'),
    'a service account binds a service identity',
  );
  t.ok(
    !accountTypeAllowsIdentityType('integration', 'internal_person'),
    'an integration account may not bind a person',
  );
  t.equal(systemActorInheritsHumanPermissions(), false, 'a system actor never inherits human permissions');

  // --- normalization — the most consequential rules -------------------------------------------------
  t.equal(normalizeEmail('  Alice@Corp.COM '), 'alice@corp.com', 'email is trimmed and lowercased');
  // The rules we deliberately do NOT apply. Folding these would merge two different colleagues.
  t.notEqual(
    normalizeEmail('a.b@corp.com'),
    normalizeEmail('ab@corp.com'),
    'dots are NOT stripped (not every domain is Gmail)',
  );
  t.notEqual(normalizeEmail('a+tag@corp.com'), normalizeEmail('a@corp.com'), '+tags are NOT dropped');
  t.equal(normalizeEmail('A@x.com'), normalizeEmail('a@x.com'), 'case folds — the one compromise we do make');

  t.equal(validateEmail('alice@corp.com'), null, 'a valid email is accepted');
  t.ok(validateEmail('alice@corp') !== null, 'an address with no TLD is rejected');
  t.ok(validateEmail('alice at corp.com') !== null, 'a spaced address is rejected');
  t.ok(validateEmail('') !== null, 'an empty email is rejected');

  t.equal(normalizeUsername(' Alice '), 'alice', 'username trimmed + lowercased');
  t.equal(validateUsername('alice.smith'), null, 'a valid username is accepted');
  t.ok(validateUsername('al') !== null, 'a two-character username is too short');
  t.ok(validateUsername('1alice') !== null, 'a username must start with a letter');
  // Confusables are REJECTED, not folded: folding merges two real people into one account.
  t.ok(validateUsername('аlice') !== null, 'a Cyrillic homoglyph is rejected, not folded');

  t.equal(validateServiceAccountName('svc_ledger_sync'), null, 'service names need the svc_ prefix');
  t.ok(validateServiceAccountName('ledger_sync') !== null, 'a service name without svc_ is rejected');
  t.equal(validateSystemAccountName('sys_scheduler'), null, 'system names need the sys_ prefix');
  t.ok(validateSystemAccountName('svc_scheduler') !== null, 'a system name may not use svc_');

  t.equal(validatePhoneReadiness('+254712345678'), null, 'E.164 accepted (readiness only)');
  t.ok(validatePhoneReadiness('0712345678') !== null, 'a national-format number is rejected');

  // issuer+subject, never subject alone — two IdPs may both issue "12345".
  t.notEqual(
    authSubjectKey('https://a.example', '12345'),
    authSubjectKey('https://b.example', '12345'),
    'the same subject from two issuers is two keys',
  );
  t.equal(
    authSubjectKey('https://A.example', '12345'),
    authSubjectKey('https://a.example', '12345'),
    'the issuer folds by case',
  );
  t.notEqual(
    authSubjectKey('https://a.example', 'AbC'),
    authSubjectKey('https://a.example', 'abc'),
    'the subject is case-SENSITIVE — never folded',
  );
  t.deepEqual(
    validateAuthSubject({ providerCode: 'entra_id', issuer: 'https://x', subject: 's' }),
    [],
    'a valid auth subject',
  );
  t.equal(
    validateAuthSubject({ providerCode: 'Entra', issuer: '', subject: '' }).length,
    3,
    'every problem is reported',
  );

  // --- the development adapter ---------------------------------------------------------------------
  // The whole point is that it cannot exist in production.
  t.ok(isDevActorAdapterAllowed({ NODE_ENV: 'development' }), 'allowed in development');
  t.ok(isDevActorAdapterAllowed({ NODE_ENV: 'test' }), 'allowed in test');
  t.ok(!isDevActorAdapterAllowed({ NODE_ENV: 'production' }), 'NOT allowed in production');
  t.ok(!isDevActorAdapterAllowed({}), 'NOT allowed when NODE_ENV is unset — an unset env is not development');
  t.ok(!isDevActorAdapterAllowed({ NODE_ENV: 'staging' }), 'NOT allowed in staging');

  t.ok(
    devActorAdapterRejectionReason({ NODE_ENV: 'production', FINAPP_DEV_ACTOR_SECRET: SECRET }) !== null,
    'production is rejected even WITH a secret',
  );
  t.ok(
    devActorAdapterRejectionReason({ NODE_ENV: 'development' }) !== null,
    'development without a secret is rejected',
  );
  t.ok(
    devActorAdapterRejectionReason({ NODE_ENV: 'development', FINAPP_DEV_ACTOR_SECRET: 'short' }) !== null,
    'a weak secret is rejected',
  );
  t.equal(
    devActorAdapterRejectionReason({ NODE_ENV: 'development', FINAPP_DEV_ACTOR_SECRET: SECRET }),
    null,
    'development + a strong secret is allowed',
  );

  const account = '7f1b3f6e-3a4b-4c2d-8e9f-0a1b2c3d4e5f';
  const now = 1_800_000_000;
  const good = signDevAssertion({ accountId: account, expiresAt: now + 300 }, SECRET);
  t.ok(verifyDevAssertion(good, SECRET, now).ok, 'a fresh, correctly-signed assertion verifies');
  t.equal(verifyDevAssertion(good, SECRET, now).assertion?.accountId, account, 'and carries the account');

  t.ok(!verifyDevAssertion(good, 'b'.repeat(48), now).ok, 'a different secret does NOT verify');
  t.ok(!verifyDevAssertion(good, SECRET, now + 301).ok, 'an expired assertion does NOT verify');
  t.ok(!verifyDevAssertion('garbage', SECRET, now).ok, 'a malformed assertion does not verify');
  t.ok(!verifyDevAssertion('', SECRET, now).ok, 'an empty assertion does not verify');
  // Tampering with the payload must invalidate the signature — otherwise anyone could name any account.
  const payloadPart = good.split('.')[0] ?? '';
  const tampered = `${payloadPart}.${'f'.repeat(64)}`;
  t.ok(!verifyDevAssertion(tampered, SECRET, now).ok, 'a forged signature does not verify');
  const macPart = good.split('.')[1] ?? '';
  const otherPayload = Buffer.from(
    JSON.stringify({ accountId: 'other', expiresAt: now + 300 }),
    'utf8',
  ).toString('base64url');
  const swapped = `${otherPayload}.${macPart}`;
  t.ok(
    !verifyDevAssertion(swapped, SECRET, now).ok,
    'swapping the payload under a valid signature does not verify',
  );

  // --- the three axes stay in step -----------------------------------------------------------------
  for (const [name, map] of [
    ['identity', IDENTITY_ACTION_MAP],
    ['account', ACCOUNT_ACTION_MAP],
    ['membership', MEMBERSHIP_ACTION_MAP],
  ] as const) {
    for (const [action, binding] of Object.entries(map)) {
      t.ok(
        binding.auditCode.startsWith(IDENTITY_AUDIT_PREFIX),
        `${name}.${action} audit code carries the registered prefix`,
      );
      t.ok(
        binding.permission.startsWith(IDENTITY_PERMISSION_NAMESPACE),
        `${name}.${action} permission is in the registered namespace`,
      );
      t.ok(
        IDENTITY_LIFECYCLE_EVENT_TYPES.includes(binding.eventType),
        `${name}.${action} maps to a declared event type`,
      );
    }
  }

  // --- permission and audit-code shape -------------------------------------------------------------
  for (const permission of ALL_IDENTITY_PERMISSIONS) {
    t.deepEqual(
      validateEndpointSpec({ permission, auditCode: 'IDENTITY_REGISTRY_CREATED' }),
      [],
      `permission ${permission} satisfies the kernel's @Endpoint validator`,
    );
  }
  for (const code of ALL_IDENTITY_AUDIT_CODES) {
    t.deepEqual(
      validateEndpointSpec({ permission: 'identity.registry.view', auditCode: code }),
      [],
      `audit code ${code} satisfies the kernel's validator`,
    );
    t.ok(code.split('_').length >= 3, `${code} matches <PREFIX>_<ENTITY>_<ACTION>`);
  }
  // rbac.* is m02's other registered namespace and belongs to Stage 1D. Nothing here may claim it.
  t.ok(
    ALL_IDENTITY_PERMISSIONS.every((p) => !p.startsWith('rbac.')),
    'Stage 1B declares no rbac.* permission — roles are Stage 1D',
  );

  // --- registry conformance ------------------------------------------------------------------------
  const auditRegistry = readYaml('manifests/audit-code-registry.yaml') as {
    codes?: { code: string }[];
    registered_code_count?: number;
  };
  const registered = new Set((auditRegistry.codes ?? []).map((c) => c.code));
  for (const code of ALL_IDENTITY_AUDIT_CODES) {
    t.ok(registered.has(code), `audit code ${code} is registered in audit-code-registry.yaml`);
  }
  t.equal(
    auditRegistry.registered_code_count,
    (auditRegistry.codes ?? []).length,
    'registered_code_count matches len(codes)',
  );

  const permissionRegistry = readYaml('manifests/permission-registry.yaml') as {
    namespaces?: { namespace: string; module?: string; codes?: string[] }[];
  };
  const identityNs = (permissionRegistry.namespaces ?? []).find((n) => n.namespace === 'identity.*');
  t.ok(identityNs !== undefined, 'identity.* is registered');
  for (const permission of ALL_IDENTITY_PERMISSIONS) {
    t.ok((identityNs?.codes ?? []).includes(permission), `permission ${permission} is registered`);
  }

  // GAP-1 closed — the same defect m01 closed for tenant.lifecycle.
  t.ok(
    DOMAIN_EVENT_FAMILIES.includes(IDENTITY_LIFECYCLE_FAMILY),
    'identity.lifecycle is in the contracts union',
  );
  t.equal(DOMAIN_EVENT_FAMILIES.length, 2, 'two families are declared at Stage 1B');
  const eventRegistry = readYaml('manifests/event-registry.yaml') as {
    family_groups?: { families: string[] }[];
  };
  const families = new Set((eventRegistry.family_groups ?? []).flatMap((g) => g.families));
  t.ok(
    families.has(IDENTITY_LIFECYCLE_FAMILY),
    'identity.lifecycle is registered in event-registry.yaml (GAP-1 closed)',
  );

  const namingMap = readYaml('manifests/naming-map.yaml') as {
    modules?: { module: string; event_family_registered?: boolean }[];
  };
  const m02 = (namingMap.modules ?? []).find((m) => m.module === 'm02-identity');
  t.equal(m02?.event_family_registered, true, 'naming-map records identity.lifecycle as registered');
  t.equal(IDENTITY_LIFECYCLE_EVENT_TYPES.length, 18, 'identity.lifecycle declares 18 event types');
});
