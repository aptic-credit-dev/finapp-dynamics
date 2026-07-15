import { ProblemError, type Db, type RequestContext } from '@finapp/kernel';
import {
  accountCanResolve,
  identityCanResolve,
  isAccountStatus,
  isIdentityStatus,
  isMembershipStatus,
  membershipCanResolve,
} from './domain/lifecycles.ts';
import type { AccountType } from './domain/types.ts';
import { IdentityRepository } from './repository.ts';

/**
 * ACTOR RESOLUTION — the authoritative answer to "who is acting?".
 *
 * Stage 1A had no answer: `x-actor-id` was a header, taken at face value, never checked against
 * anything. Stage 1B replaces it. A claimed account id is a CLAIM; this is the only code allowed to turn
 * one into an actor, and it does so only after the database agrees.
 *
 * THE THREE GATES, all of which must pass (§16):
 *   1. the ACCOUNT exists and is `active`
 *   2. its IDENTITY exists and is `active`
 *   3. for a tenant-scoped request, a MEMBERSHIP of that tenant exists and is `active`
 *
 * All three matter independently. Suspending a person must not require hunting down their accounts;
 * suspending one login must not lock a person out of everything; ending a membership must not disable an
 * account that other tenants still rely on. Any one of the three being non-active means no actor.
 */

/** Who is acting, once proven. Never constructed from request data — only returned by this resolver. */
export interface AuthenticatedActor {
  readonly identityId: string;
  readonly accountId: string;
  readonly accountType: AccountType;
  /** Present only for a tenant-scoped request. */
  readonly tenantId?: string;
  readonly membershipId?: string;
  readonly correlationId: string;
  /**
   * How strongly the actor's identity was proven.
   *
   * `development` is the ONLY value Stage 1B can produce, and it says so out loud. Stage 1C introduces
   * `password`, `mfa`, `federated`. A placeholder that claimed "authenticated" would make the eventual
   * arrival of real authentication invisible in logs and in audit.
   */
  readonly assurance: 'none' | 'development' | 'password' | 'mfa' | 'federated';
  /** Stage 1C. Declared so the shape does not change when sessions arrive. */
  readonly sessionRef?: string;
  /** True only for the platform's own machine principals (§4.5). Never for a human. */
  readonly isSystemActor: boolean;
}

export interface ResolveInput {
  /** The account the caller CLAIMS to be. Never trusted; always looked up. */
  readonly claimedAccountId: string;
  /** Present for a tenant-scoped request. Membership is then mandatory. */
  readonly tenantId?: string | undefined;
  readonly correlationId: string;
  readonly assurance: AuthenticatedActor['assurance'];
  readonly sessionRef?: string | undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ActorResolver {
  private readonly db: Db;
  private readonly repo: IdentityRepository;

  constructor(db: Db, repo: IdentityRepository = new IdentityRepository()) {
    this.db = db;
    this.repo = repo;
  }

  /**
   * Resolves a claimed account into a proven actor, or refuses.
   *
   * EVERY refusal is the same message and the same status. A caller probing account ids must not be able
   * to tell "no such account" from "suspended account" from "not a member of this tenant" — each
   * distinction is an oracle that maps the platform's people. The specific reason goes to the log under
   * the correlation id, where an operator can see it and an attacker cannot.
   */
  async resolve(input: ResolveInput): Promise<AuthenticatedActor> {
    if (!UUID_PATTERN.test(input.claimedAccountId)) {
      // Rejected before SQL: `::uuid` on a malformed value raises, turning a bad claim into a 500 that
      // looks like a server fault.
      throw this.refuse(input.correlationId, 'claimed account id is not a uuid');
    }
    // The same hazard on the tenant claim, and the one that is actually reachable from a header. Every
    // `tenant_isolation` policy reads `app.tenant_id` through `NULLIF(...)::uuid`, so binding a malformed
    // value raises inside the policy — a 500 for what is a bad request, and a signal to a prober that
    // their input reached the database.
    if (input.tenantId !== undefined && !UUID_PATTERN.test(input.tenantId)) {
      throw this.refuse(input.correlationId, 'claimed tenant id is not a uuid');
    }

    // The lookup runs in system context because the identity control plane is global and there is no
    // tenant context to enter yet — resolving the actor is what PRODUCES the context. This is the
    // narrowest possible use of the escape: two rows by primary key.
    const found = await this.db.withSystem(
      { reason: 'actor resolution (m02)', correlationId: input.correlationId },
      (tx) => this.repo.findAccountWithIdentity(tx, input.claimedAccountId),
    );

    if (found === null) throw this.refuse(input.correlationId, 'no such account');

    // The status is narrowed, never cast. A value the domain does not recognise means the database and
    // the code disagree — which is a data-integrity problem, and the safe answer to it is "no actor",
    // not "assume it is fine".
    if (!isAccountStatus(found.account_status)) {
      throw this.refuse(input.correlationId, `unrecognised account status ${found.account_status}`);
    }
    if (!isIdentityStatus(found.identity_status)) {
      throw this.refuse(input.correlationId, `unrecognised identity status ${found.identity_status}`);
    }
    if (!accountCanResolve(found.account_status)) {
      throw this.refuse(input.correlationId, `account status is ${found.account_status}`);
    }
    if (!identityCanResolve(found.identity_status)) {
      throw this.refuse(input.correlationId, `identity status is ${found.identity_status}`);
    }

    const base = {
      identityId: found.identity_id,
      accountId: found.account_id,
      accountType: found.account_type as AccountType,
      correlationId: input.correlationId,
      assurance: input.assurance,
      // A system actor is one bound to a system identity. It never inherits human permissions — see
      // domain/types.ts systemActorInheritsHumanPermissions().
      isSystemActor: found.identity_type === 'system_identity',
      ...(input.sessionRef === undefined ? {} : { sessionRef: input.sessionRef }),
    };

    if (input.tenantId === undefined) return base;

    // Gate 3. Read INSIDE the tenant's own context, not through the system escape: tenant_memberships
    // has no escape, so this query is subject to the same policy any other caller faces. The membership
    // must therefore genuinely exist in that tenant — RLS proves it, not this code.
    const membership = await this.db.withTenant(
      { tenantId: input.tenantId, correlationId: input.correlationId, permissions: [] },
      (tx) => this.repo.findLiveMembership(tx, found.identity_id),
    );

    if (membership === null) throw this.refuse(input.correlationId, 'no membership in this tenant');
    if (!isMembershipStatus(membership.status)) {
      throw this.refuse(input.correlationId, `unrecognised membership status ${membership.status}`);
    }
    if (!membershipCanResolve(membership.status)) {
      throw this.refuse(input.correlationId, `membership status is ${membership.status}`);
    }

    return { ...base, tenantId: input.tenantId, membershipId: membership.id };
  }

  /**
   * One refusal, one message, one status.
   *
   * `detail` never varies, so no probe can distinguish the cases. The real reason is logged next to the
   * correlation id.
   *
   * 401, not 403: every case reaching here means no actor was established — unknown account, suspended
   * account, suspended identity, no membership. "Who are you" is unanswered, so authorization never got a
   * turn. 403 is reserved for a PROVEN actor who lacks a permission, and keeping the two apart is what
   * stops a permission denial and an identity probe looking the same.
   */
  private refuse(correlationId: string, why: string): ProblemError {
    console.warn('[actor-resolution-refused]', { correlationId, why });
    return ProblemError.unauthorized('Unknown or inaccessible actor.', correlationId);
  }
}

/**
 * Builds the kernel `RequestContext` from a proven actor.
 *
 * The ONLY place `userId` is populated. `userId` is the identity, not the account: audit and events name
 * the person, and a person with two logins must not appear as two actors in an audit trail.
 *
 * `permissions` still arrives from outside — Stage 1D replaces that with RBAC. That is the last remaining
 * piece of the old header trust, and it is deliberately explicit here rather than hidden.
 */
export function contextFromActor(actor: AuthenticatedActor, permissions: readonly string[]): RequestContext {
  if (actor.tenantId === undefined) {
    throw new Error(
      'contextFromActor requires a tenant-scoped actor. Use the actor directly for platform work.',
    );
  }
  return {
    tenantId: actor.tenantId,
    userId: actor.identityId,
    correlationId: actor.correlationId,
    permissions,
  };
}

export { UUID_PATTERN };
