import { ProblemError } from '@finapp/kernel';
import { type ActorResolver, type ActorSource, type AuthenticatedActor } from '@finapp/m02-identity';
import { type SessionService } from './session.service.ts';

/**
 * THE seam Stage 1C fills. `DevActorAdapter` implemented `ActorSource` in 1B; this replaces it. The only
 * thing that changes is what produces the account claim: a validated SESSION instead of a signed dev
 * assertion. `ActorResolver` and every controller are untouched.
 *
 * The adapter establishes ONLY the account reference (from a live session). It then hands that reference to
 * `ActorResolver`, which independently re-checks account status, identity status, and — for a tenant-scoped
 * request — tenant membership and tenant context, EVERY request. So a suspended person or ended membership
 * is refused on the next call even with a perfectly valid session. The adapter never duplicates or bypasses
 * any of that authorization logic.
 */
export class SessionActorAdapter implements ActorSource {
  private readonly sessions: SessionService;
  private readonly resolver: ActorResolver;

  constructor(sessions: SessionService, resolver: ActorResolver) {
    this.sessions = sessions;
    this.resolver = resolver;
  }

  async resolve(input: {
    token: string | undefined;
    tenantId?: string | undefined;
    correlationId: string;
  }): Promise<AuthenticatedActor> {
    const resolved = await this.sessions.resolveToken(input.token);
    // No valid session → the same generic refusal the resolver gives; no distinction to probe.
    if (resolved === null) {
      throw ProblemError.unauthorized('Unknown or inaccessible actor.', input.correlationId);
    }
    return this.resolver.resolve({
      claimedAccountId: resolved.accountId,
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      assurance: resolved.assurance,
      sessionRef: resolved.sessionId,
    });
  }
}
