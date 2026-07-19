import { defineSuite } from '@finapp/test-runner';
import {
  ACTOR_TYPES,
  OUTCOMES,
  CATEGORIES,
  isActorType,
  isOutcome,
  isCategory,
  moduleForCode,
  categoryForCode,
  redact,
  REDACTED,
  hashEvent,
  verifyChain,
  canonicalize,
  GENESIS_HASH,
  ALL_AUDIT_PERMISSIONS,
  AUDIT_PERMISSION_NAMESPACE,
  ALL_AUDIT_AUDIT_CODES,
  AUDIT_AUDIT_PREFIX,
  type HashableEvent,
} from '@finapp/m03-audit';

/**
 * m03-audit PURE smoke suite — the parts an audit spine rests on that need no database: the vocabularies,
 * redaction (nothing sensitive ever enters an append-only store), and the tamper-evidence hash chain
 * (any edit, deletion, or reorder is detectable). Persistence, RLS and immutability are proven in the DB
 * spec; this proves the logic those layers carry out, and it fails safe at every edge.
 */
export default defineSuite('m03-audit', (t) => {
  // --- vocabularies --------------------------------------------------------------------------------
  t.ok(isActorType('system_process') && !isActorType('wizard'), 'actor types admit only real principals');
  t.ok(isOutcome('denied') && !isOutcome('maybe'), 'outcomes admit only real results');
  t.ok(isCategory('authorization') && !isCategory('vibes'), 'categories admit only real buckets');
  t.equal(new Set(ACTOR_TYPES).size, ACTOR_TYPES.length, 'no duplicate actor types');
  t.equal(new Set(OUTCOMES).size, OUTCOMES.length, 'no duplicate outcomes');
  t.equal(new Set(CATEGORIES).size, CATEGORIES.length, 'no duplicate categories');

  t.equal(moduleForCode('RBAC_ROLE_CREATED'), 'm02-rbac', 'module is derived from the registered code prefix');
  t.equal(moduleForCode('TENANT_REGISTRY_CREATED'), 'm01-tenant', 'tenant prefix maps to m01');
  t.equal(moduleForCode('AUDIT_EVENT_EXPORTED'), 'm03-audit', 'audit prefix maps to m03');
  t.equal(moduleForCode('WAT_NO_SUCH_PREFIX'), 'unknown', 'an unknown prefix is "unknown", never a throw');
  t.equal(categoryForCode('AUTH_LOGIN_SUCCEEDED'), 'authentication', 'auth codes classify as authentication');
  t.equal(categoryForCode('RBAC_ASSIGNMENT_GRANTED'), 'assignment', 'rbac assignment classifies as assignment');

  // --- registered names ----------------------------------------------------------------------------
  for (const code of ALL_AUDIT_PERMISSIONS) {
    t.ok(code.startsWith(AUDIT_PERMISSION_NAMESPACE), `${code} is inside the audit.* namespace`);
    t.equal(code.split('.').length, 3, `${code} has three segments`);
  }
  for (const code of ALL_AUDIT_AUDIT_CODES) {
    t.ok(code.startsWith(AUDIT_AUDIT_PREFIX), `${code} carries the AUDIT_ prefix`);
    t.ok(code.split('_').length >= 3, `${code} matches <PREFIX>_<ENTITY>_<ACTION>`);
  }

  // --- redaction: nothing sensitive is retained ----------------------------------------------------
  {
    const r = redact({ user: 'ada', password: 'hunter2', token: 'abc', nested: { api_key: 'k', ok: 1 } });
    const v = (r.value ?? {});
    const nested = (v['nested'] ?? {}) as Record<string, unknown>;
    t.equal(v['password'], REDACTED, 'a password field is masked');
    t.equal(v['token'], REDACTED, 'a token field is masked');
    t.equal(nested['api_key'], REDACTED, 'nested secrets are masked recursively');
    t.equal(nested['ok'], 1, 'non-secret fields survive');
    t.ok(r.redactedKeys.includes('password') && r.redactedKeys.includes('nested.api_key'), 'redacted key PATHS are recorded (never the values)');
  }
  {
    const big = 'x'.repeat(5000);
    const r = redact({ note: big });
    t.ok(String((r.value!)['note']).length < big.length, 'a very long string is truncated');
    t.ok(r.truncated, 'truncation is flagged');
  }
  {
    const r = redact({ blob: new Uint8Array([1, 2, 3]) });
    t.ok(r.binaryRejected, 'binary payloads are rejected');
    t.equal(redact(null).value, null, 'null detail stays null (no throw)');
  }
  {
    // A cyclic object must not throw and must not be persisted raw.
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const r = redact(cyclic);
    t.ok(r.value !== null, 'a cyclic detail becomes a safe summary rather than throwing');
  }

  // --- tamper evidence -----------------------------------------------------------------------------
  const base = (seq: number, id: string): HashableEvent => ({
    id, scopeKey: 't1', seq, tenantId: 't1', actorType: 'user', actorId: 'u1', module: 'm', action: 'X_Y_Z',
    category: 'state_transition', resourceType: 'r', resourceId: 'r1', outcome: 'success',
    correlationId: 'c1', causationId: null, occurredAt: '2026-01-01T00:00:00.000Z', detail: { n: seq },
  });
  t.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }), 'canonicalisation is key-order independent');

  const h1 = hashEvent(GENESIS_HASH, base(1, 'id1'));
  const h2 = hashEvent(h1, base(2, 'id2'));
  t.notEqual(h1, h2, 'each event hash differs');
  t.equal(hashEvent(GENESIS_HASH, base(1, 'id1')), h1, 'hashing is deterministic');

  const e1 = { ...base(1, 'id1'), previousHash: GENESIS_HASH, eventHash: h1 };
  const e2 = { ...base(2, 'id2'), previousHash: h1, eventHash: h2 };
  t.ok(verifyChain([e1, e2]).ok, 'an intact chain verifies');

  // Tamper: alter a stored field without recomputing the hash -> detected.
  const v = verifyChain([e1, { ...e2, resourceId: 'HACKED' }]);
  t.ok(!v.ok && v.brokenAtSeq === 2, 'an altered record breaks verification at its seq');

  // Deletion / reorder: a gap in seq -> detected.
  const e3 = { ...base(3, 'id3'), previousHash: h1, eventHash: hashEvent(h1, base(3, 'id3')) };
  t.ok(!verifyChain([e1, e3]).ok, 'a deleted event (seq gap) breaks verification');
});
