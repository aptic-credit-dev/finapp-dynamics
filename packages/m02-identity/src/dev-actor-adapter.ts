import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProblemError } from '@finapp/kernel';
import type { ActorResolver, AuthenticatedActor } from './actor-resolver.ts';

/**
 * ============================================================================================
 * DEVELOPMENT-ONLY ACTOR ADAPTER — DELETE IN STAGE 1C.
 * ============================================================================================
 *
 * WHY IT EXISTS. Stage 1B builds identity, not authentication (§3): there is no session, no credential
 * and no token, yet something must populate the actor so the platform is runnable and testable. This is
 * that something, and it is a stopgap with a dated end.
 *
 * WHY IT IS NOT `x-actor-id` WARMED OVER. The problem with `x-actor-id` was never that it was a header —
 * it was that it was **unverified**, in two ways at once. This fixes both:
 *
 *   1. UNFORGEABLE(-ish): the assertion is HMAC-signed with a dev secret and time-limited, so a caller
 *      cannot mint one for an arbitrary account by typing a uuid.
 *   2. VALIDATED: even a perfectly signed assertion is then put through the full ActorResolver — account
 *      active, identity active, membership active. A signature proves who sent it, never that the actor
 *      may act.
 *
 * WHAT IT IS STILL NOT. It is NOT authentication. Nobody proves they are the person; they prove they hold
 * the dev secret. `assurance` is therefore `development` and never anything better. Do not confuse the
 * two, and do not let this reach an environment where that distinction matters.
 *
 * HOW IT IS DISABLED. `isDevActorAdapterAllowed()` — it refuses to construct when NODE_ENV is
 * `production`, and refuses when no dev secret is configured. Both are hard failures at construction, not
 * silent no-ops: a dev auth path that quietly does nothing in production is indistinguishable from one
 * that quietly works.
 *
 * STAGE 1C DELETION PATH (exact):
 *   1. Implement the session store and the login route (m02-auth).
 *   2. In apps/api, replace `DevActorAdapter` with the session-backed resolver. `ActorResolver` and
 *      `AuthenticatedActor` do NOT change — only the thing that produces `claimedAccountId` changes.
 *   3. Delete this file, its smoke assertions, and the `FINAPP_DEV_ACTOR_SECRET` env var.
 *   4. Grep for `x-dev-actor` and expect zero hits.
 */

/** Signed, short-lived, and carries no permissions — only a claim about which account is acting. */
export interface DevAssertion {
  readonly accountId: string;
  /** Unix seconds. Short-lived so a leaked header from a log is useless within minutes. */
  readonly expiresAt: number;
}

export const DEV_ACTOR_HEADER = 'x-dev-actor';
const DEV_SECRET_ENV = 'FINAPP_DEV_ACTOR_SECRET';
/** Minimum entropy for the dev secret. Short secrets make the signature theatre. */
const MIN_SECRET_LENGTH = 32;

/**
 * Whether the adapter may be used at all.
 *
 * Fails closed on anything that is not explicitly a development or test environment. An unset NODE_ENV is
 * NOT treated as development: a container that forgot to set it would otherwise get the dev auth path.
 */
export function isDevActorAdapterAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = env['NODE_ENV'];
  return nodeEnv === 'development' || nodeEnv === 'test';
}

export function devActorAdapterRejectionReason(env: NodeJS.ProcessEnv = process.env): string | null {
  const nodeEnv = env['NODE_ENV'];
  if (nodeEnv === 'production') {
    return 'The development actor adapter must never load in production. Stage 1C provides real authentication.';
  }
  if (!isDevActorAdapterAllowed(env)) {
    return `The development actor adapter requires NODE_ENV=development or test (got ${nodeEnv ?? 'unset'}).`;
  }
  const secret = env[DEV_SECRET_ENV];
  if (secret === undefined || secret.length < MIN_SECRET_LENGTH) {
    return `${DEV_SECRET_ENV} must be set and at least ${MIN_SECRET_LENGTH} characters.`;
  }
  return null;
}

/** `base64url(payload).hex(hmac)`. Deliberately boring — it is a dev stopgap, not a token format. */
export function signDevAssertion(assertion: DevAssertion, secret: string): string {
  const payload = Buffer.from(JSON.stringify(assertion), 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

export interface DevVerifyResult {
  readonly ok: boolean;
  readonly assertion?: DevAssertion;
  readonly reason?: string;
}

/**
 * Verifies a signed assertion. Pure — no I/O, so the smoke suite can prove the failure modes.
 *
 * Order matters: the signature is checked BEFORE the payload is trusted for anything, and expiry is
 * checked after. Comparing the MAC with `timingSafeEqual` rather than `===` keeps the comparison from
 * leaking the correct signature one byte at a time.
 */
export function verifyDevAssertion(token: string, secret: string, nowSeconds: number): DevVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed assertion' };
  const [payload, mac] = parts as [string, string];

  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const macBuf = Buffer.from(mac, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (macBuf.length !== expectedBuf.length || !timingSafeEqual(macBuf, expectedBuf)) {
    return { ok: false, reason: 'bad signature' };
  }

  let assertion: DevAssertion;
  try {
    assertion = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DevAssertion;
  } catch {
    return { ok: false, reason: 'unreadable payload' };
  }

  if (typeof assertion.accountId !== 'string' || typeof assertion.expiresAt !== 'number') {
    return { ok: false, reason: 'invalid payload shape' };
  }
  if (assertion.expiresAt <= nowSeconds) return { ok: false, reason: 'expired' };

  return { ok: true, assertion };
}

/**
 * Turns a signed dev assertion into a fully-validated actor.
 *
 * Construction throws outside development — so the failure is at boot, loudly, rather than at the first
 * request in an environment where this must not exist.
 */
export class DevActorAdapter {
  private readonly resolver: ActorResolver;
  private readonly secret: string;

  constructor(resolver: ActorResolver, env: NodeJS.ProcessEnv = process.env) {
    const rejection = devActorAdapterRejectionReason(env);
    if (rejection !== null) throw new Error(rejection);

    const secret = env[DEV_SECRET_ENV];
    // Re-checked rather than asserted. devActorAdapterRejectionReason() already refused an absent or
    // weak secret, so this is unreachable — but an empty HMAC key is the one mistake that would make
    // every signature verify, and it is not worth trusting a caller to have called the guard first.
    if (secret === undefined || secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`${DEV_SECRET_ENV} must be set and at least ${MIN_SECRET_LENGTH} characters.`);
    }

    this.resolver = resolver;
    this.secret = secret;
  }

  /**
   * Verifies the assertion, then resolves it through the full three-gate check.
   *
   * The signature only decides WHOSE claim this is. Whether that account may act is the resolver's
   * decision, every time — a valid signature for a suspended account still resolves to nothing.
   */
  async resolve(input: {
    token: string | undefined;
    tenantId?: string | undefined;
    correlationId: string;
    nowSeconds?: number;
  }): Promise<AuthenticatedActor> {
    if (input.token === undefined || input.token === '') {
      throw ProblemError.forbidden('Unknown or inaccessible actor.', input.correlationId);
    }

    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    const verified = verifyDevAssertion(input.token, this.secret, now);
    if (!verified.ok || verified.assertion === undefined) {
      // Same opaque refusal as the resolver's: a caller must not learn whether the signature or the
      // account was the problem.
      console.warn('[dev-actor-rejected]', { correlationId: input.correlationId, why: verified.reason });
      throw ProblemError.forbidden('Unknown or inaccessible actor.', input.correlationId);
    }

    return this.resolver.resolve({
      claimedAccountId: verified.assertion.accountId,
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
      correlationId: input.correlationId,
      // Never anything stronger. This is not authentication.
      assurance: 'development',
    });
  }
}
