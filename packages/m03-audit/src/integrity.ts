import { createHash } from 'node:crypto';

/**
 * Tamper evidence — PURE. Each audit event is linked to the previous event in its scope (a tenant's chain,
 * or the platform chain) by a hash that covers the event's stable fields AND the prior event's hash. Any
 * change to a stored record — or any deletion or reordering — breaks the chain from that point on, which a
 * verification pass detects.
 *
 * Honest scope of the claim: this is TAMPER-EVIDENCE, not cryptographic non-repudiation. A party who can
 * rewrite the whole chain (recomputing every subsequent hash) could forge a consistent history; defeating
 * that needs periodic external anchoring of chain heads, which is a documented follow-on (chain_anchors).
 * What this DOES guarantee: no in-place edit or deletion of a stored row goes undetected by verification.
 */

export const INTEGRITY_VERSION = 1;
/** The prior-hash value for the first event in a scope. */
export const GENESIS_HASH = '0'.repeat(64);

/** The stable, hashed projection of an audit event. Order-independent: canonicalisation sorts keys. */
export interface HashableEvent {
  readonly id: string;
  readonly scopeKey: string;
  readonly seq: number;
  readonly tenantId: string | null;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly module: string;
  readonly action: string;
  readonly category: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly outcome: string;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly occurredAt: string; // ISO-8601, server-generated
  readonly detail: unknown; // already redacted
}

/** Deterministic serialisation: keys sorted at every level so the hash is stable across engines. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortDeep((value as Record<string, unknown>)[key]);
  }
  return out;
}

/** The hash of one event, chaining the previous event's hash. sha-256, hex. */
export function hashEvent(previousHash: string, event: HashableEvent): string {
  const canonical = canonicalize({
    id: event.id,
    scopeKey: event.scopeKey,
    seq: event.seq,
    tenantId: event.tenantId,
    actorType: event.actorType,
    actorId: event.actorId,
    module: event.module,
    action: event.action,
    category: event.category,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    outcome: event.outcome,
    correlationId: event.correlationId,
    causationId: event.causationId,
    occurredAt: event.occurredAt,
    detail: event.detail,
  });
  return createHash('sha256').update(`${INTEGRITY_VERSION}\n${previousHash}\n${canonical}`).digest('hex');
}

export interface ChainVerification {
  readonly ok: boolean;
  /** seq of the first event whose stored hash does not match a recomputation, if any. */
  readonly brokenAtSeq: number | null;
  readonly checked: number;
  readonly reason: string | null;
}

/**
 * Verifies a scope's chain: events must be contiguous in `seq`, each `previousHash` must equal the prior
 * event's `eventHash`, and each `eventHash` must recompute from its fields. Returns the first break.
 */
export function verifyChain(
  events: readonly (HashableEvent & { previousHash: string; eventHash: string })[],
): ChainVerification {
  let prior = GENESIS_HASH;
  let expectedSeq: number | null = null;
  for (const e of events) {
    if (expectedSeq !== null && e.seq !== expectedSeq) {
      return {
        ok: false,
        brokenAtSeq: e.seq,
        checked: events.length,
        reason: 'non-contiguous seq (gap or reorder)',
      };
    }
    if (e.previousHash !== prior) {
      return { ok: false, brokenAtSeq: e.seq, checked: events.length, reason: 'previous-hash mismatch' };
    }
    const recomputed = hashEvent(prior, e);
    if (recomputed !== e.eventHash) {
      return {
        ok: false,
        brokenAtSeq: e.seq,
        checked: events.length,
        reason: 'event-hash mismatch (record altered)',
      };
    }
    prior = e.eventHash;
    expectedSeq = e.seq + 1;
  }
  return { ok: true, brokenAtSeq: null, checked: events.length, reason: null };
}
