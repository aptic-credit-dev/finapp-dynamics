import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { defineSuite } from '@finapp/test-runner';
import {
  ALL_AUTH_AUDIT_CODES,
  ALL_AUTH_PERMISSIONS,
  ARGON2_POLICY,
  AUTH_AUDIT_PREFIX,
  AUTH_FAILURE,
  AUTH_PERMISSION_NAMESPACE,
  GENERIC_AUTH_FAILURE_MESSAGE,
  argon2idHasher,
  checkSessionTransition,
  csrfMatches,
  hashLoginRef,
  hashToken,
  needsRehash,
  newCsrfToken,
  newSecret,
  scryptHasher,
  sessionIsUsable,
  verifyPassword,
} from '@finapp/m02-auth';
import { AUTH_LIFECYCLE_EVENT_TYPES, AUTH_LIFECYCLE_FAMILY } from '@finapp/contracts';

/**
 * M02-auth PURE smoke suite — hashing, tokens, the session state machine, CSRF, policy, and registry
 * conformance. No database, no clock beyond values passed in.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
function readYaml(relative: string): unknown {
  return parse(readFileSync(resolve(REPO_ROOT, relative), 'utf8'));
}

export default defineSuite('m02-auth', async (t) => {
  // --- password hashing (ADR-016) -----------------------------------------------------------------
  const hashed = await argon2idHasher.hash('correct-horse-battery-staple');
  t.ok(hashed.encoded.startsWith('$argon2id$'), 'argon2id produces an $argon2id$ PHC verifier');
  t.equal(hashed.algorithm, 'argon2id', 'and reports its algorithm');
  t.ok(
    await argon2idHasher.verify(hashed.encoded, 'correct-horse-battery-staple'),
    'the right password verifies',
  );
  t.ok(!(await argon2idHasher.verify(hashed.encoded, 'wrong-password')), 'a wrong password does NOT verify');
  t.ok(
    !(await argon2idHasher.verify('$argon2id$garbage', 'x')),
    'a malformed hash reads as non-verifying, not a throw',
  );

  // NO PLAINTEXT anywhere in the stored material.
  t.ok(
    !hashed.encoded.includes('correct-horse-battery-staple'),
    'the encoded hash does not contain the password',
  );

  // scrypt fallback round-trips and dispatches by stored algorithm.
  const scryptHashed = await scryptHasher.hash('another-strong-passphrase');
  t.ok(scryptHashed.encoded.startsWith('scrypt$'), 'scrypt produces a self-describing verifier');
  t.ok(
    await verifyPassword('scrypt', scryptHashed.encoded, 'another-strong-passphrase'),
    'verifyPassword dispatches to scrypt',
  );
  t.ok(!(await verifyPassword('scrypt', scryptHashed.encoded, 'nope')), 'and rejects a wrong password');
  t.ok(
    await verifyPassword('argon2id', hashed.encoded, 'correct-horse-battery-staple'),
    'and dispatches to argon2id',
  );

  // rehash-on-login policy: scrypt (or below-policy argon2) is flagged for upgrade; current argon2 is not.
  t.ok(needsRehash('scrypt', scryptHashed.params), 'a scrypt credential is flagged for rehash to argon2id');
  t.ok(
    needsRehash('argon2id', { memoryCost: 1, timeCost: 1, parallelism: 1 }),
    'below-policy argon2 is flagged',
  );
  t.ok(!needsRehash('argon2id', ARGON2_POLICY), 'a current-policy argon2 credential is NOT rehashed');

  // --- tokens -------------------------------------------------------------------------------------
  t.equal(hashToken('abc'), hashToken('abc'), 'token hashing is deterministic (a lookup can match)');
  t.ok(hashToken('abc') !== hashToken('abd'), 'and collision-resistant across different tokens');
  t.equal(hashToken('abc').length, 64, 'SHA-256 hex is 64 chars');
  t.ok(!hashToken('abc').includes('abc'), 'the hash does not contain the token');
  t.ok(newSecret() !== newSecret(), 'each session secret is unique (256-bit random)');
  t.ok(
    hashLoginRef('alice') !== hashToken('alice'),
    'login-ref hashing is domain-separated from token hashing',
  );

  // --- session state machine ----------------------------------------------------------------------
  t.ok(
    checkSessionTransition('active', 'revoke', { reason: 'x' }).allowed,
    'active -> revoke (with reason) is legal',
  );
  t.ok(!checkSessionTransition('active', 'revoke').allowed, 'revoke without a reason is refused');
  t.ok(!checkSessionTransition('revoked', 'refresh').allowed, 'a revoked session is terminal — no refresh');
  t.ok(
    !checkSessionTransition('expired', 'revoke', { reason: 'x' }).allowed,
    'an expired session is terminal',
  );
  t.ok(checkSessionTransition('active', 'refresh').allowed, 'active -> refresh is legal');

  const now = 1_000_000;
  t.ok(sessionIsUsable('active', now, now + 1000, now + 5000), 'an active, unexpired session is usable');
  t.ok(!sessionIsUsable('active', now, now - 1, now + 5000), 'past idle expiry is not usable');
  t.ok(!sessionIsUsable('active', now, now + 5000, now - 1), 'past absolute expiry is not usable');
  t.ok(!sessionIsUsable('revoked', now, now + 5000, now + 5000), 'a revoked session is not usable');

  // --- CSRF (double-submit) -----------------------------------------------------------------------
  const csrf = newCsrfToken();
  t.ok(newCsrfToken() !== newCsrfToken(), 'each CSRF token is unique');
  t.ok(csrfMatches(csrf, csrf), 'a matching cookie/header pair passes');
  t.ok(!csrfMatches(csrf, `${csrf}x`), 'a mismatched pair fails');
  t.ok(!csrfMatches(undefined, csrf), 'a missing cookie fails');
  t.ok(!csrfMatches(csrf, undefined), 'a missing header fails');
  t.ok(!csrfMatches('', ''), 'two empty values fail (not a vacuous pass)');

  // --- generic failure mapping (enumeration resistance) -------------------------------------------
  t.equal(GENERIC_AUTH_FAILURE_MESSAGE, 'Invalid credentials.', 'there is ONE external failure message');
  t.ok(
    Object.values(AUTH_FAILURE).length >= 5,
    'internal failure categories are enumerated (never surfaced)',
  );

  // --- registry conformance -----------------------------------------------------------------------
  const permissionRegistry = readYaml('manifests/permission-registry.yaml') as {
    namespaces?: { namespace: string; codes?: string[] }[];
  };
  const authNs = (permissionRegistry.namespaces ?? []).find((n) => n.namespace === 'auth.*');
  t.ok(authNs !== undefined, 'the auth.* namespace is registered');
  for (const perm of ALL_AUTH_PERMISSIONS) {
    t.ok(perm.startsWith(AUTH_PERMISSION_NAMESPACE), `${perm} is inside the auth namespace`);
    t.ok((authNs?.codes ?? []).includes(perm), `${perm} is registered in permission-registry.yaml`);
  }

  const auditRegistry = readYaml('manifests/audit-code-registry.yaml') as {
    codes?: { code: string }[];
  };
  const registeredCodes = new Set((auditRegistry.codes ?? []).map((c) => c.code));
  for (const code of ALL_AUTH_AUDIT_CODES) {
    t.ok(code.startsWith(AUTH_AUDIT_PREFIX), `${code} carries the AUTH_ prefix`);
    t.ok(registeredCodes.has(code), `${code} is registered in audit-code-registry.yaml`);
  }

  const eventRegistry = readYaml('manifests/event-registry.yaml') as {
    family_groups?: { families: string[] }[];
  };
  const families = new Set((eventRegistry.family_groups ?? []).flatMap((g) => g.families));
  t.ok(families.has(AUTH_LIFECYCLE_FAMILY), 'identity.authentication is registered in event-registry.yaml');
  t.equal(AUTH_LIFECYCLE_EVENT_TYPES.length, 11, 'the family declares 11 event types');
});
