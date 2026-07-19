import { randomUUID } from 'node:crypto';
import { ProblemError, type RequestContext, type SystemContext } from '@finapp/kernel';
// Type-only: this class is plain and constructor-injected by hand. It is `apps/api`'s ActorModule that
// needs the runtime value, because NestJS resolves dependencies from emitted design-time metadata.
import type { TenantContextResolver } from '@finapp/m01-tenant';
import { contextFromActor, type AuthenticatedActor } from './actor-resolver.ts';
import { systemActorInheritsHumanPermissions } from './domain/types.ts';

/**
 * Extracts the raw actor credential from a request's headers. The transport is not this module's concern:
 * Stage 1B injected a header reader (`x-dev-actor`); Stage 1C injects a session-cookie reader. The factory
 * turns whatever this returns into an actor through the `ActorSource`, and cares only that it is opaque.
 */
export type TokenExtractor = (headers: Readonly<Record<string, string>>) => string | undefined;

/**
 * THE API'S ACTOR BOUNDARY — the one place a request becomes a context.
 *
 * Stage 1A built context out of headers: `x-actor-id` said who you were and the platform believed it.
 * This replaces that entirely. Nothing here trusts a header for identity; the only thing a caller can do
 * is present a signed assertion, and the only thing that turns an assertion into an actor is
 * `ActorResolver` — which asks the database, every time.
 *
 * WHY IT LIVES IN M02 AND NOT IN apps/api. Two reasons, both load-bearing:
 *   1. It must be TESTABLE. Both test lanes run under `node --experimental-strip-types`, which cannot
 *      parse decorator syntax, so anything inside a NestJS controller is unreachable from a test. Keeping
 *      the boundary decorator-free here is what lets the DB spec prove the real code path rather than a
 *      reimplementation of it that happens to agree.
 *   2. It must be SINGULAR. A controller that assembles its own context is a second actor-resolution
 *      implementation, and the second one is always the one that forgets a gate.
 *
 * THE ORDER, and why it is this order (§4):
 *
 *   assertion -> verify signature -> account claim -> ActorResolver (account, identity, membership)
 *             -> M01 tenant gate -> RequestContext
 *
 * Actor resolution comes FIRST, before the tenant is validated. Reversing it would let a caller with no
 * assertion at all probe which tenant ids are real by reading the shape of the refusal. With this order,
 * a caller who cannot prove an actor learns exactly one thing — that they cannot prove an actor.
 */

/** Correlates logs, audit entries and events. Minted when absent — an untraceable request is not allowed. */
export const CORRELATION_HEADER = 'x-correlation-id';
/** The tenant CLAIM. Validated by M01, never trusted. */
export const TENANT_HEADER = 'x-tenant-id';

/**
 * ============================================================================================
 * STAGE 1D — `x-permissions` IS GONE. Permissions come from persistent RBAC.
 * ============================================================================================
 *
 * Through Stage 1C the caller stated their own privileges in an `x-permissions` header — real enforcement,
 * untrusted input. Stage 1D deletes it. `RequestContext.permissions` is now populated by a `PermissionSource`
 * that resolves the actor's EFFECTIVE permissions from persistent role assignments (m02-rbac), fresh per
 * request, keyed to the AUTHENTICATED identity and tenant. The client supplies nothing; a system actor
 * inherits nothing (§4.5). What you may do is now proven against the database, exactly like who you are.
 */

/**
 * Resolves the actor's effective permissions for a scope. Injected so this module does not depend on
 * m02-rbac (which depends on it): apps/api wires the RBAC resolver. Returns [] for a system actor.
 */
export type PermissionSource = (input: {
  identityId: string;
  accountId: string;
  tenantId?: string | undefined;
  isSystemActor: boolean;
  correlationId: string;
}) => Promise<readonly string[]>;

/**
 * Produces a proven actor from whatever the request carried.
 *
 * THE SEAM. Stage 1B's `DevActorAdapter` implemented it; Stage 1C's `SessionActorAdapter` (m02-auth)
 * implements it now, turning a validated session into an account claim. Everything downstream of this
 * interface — the resolver, the gates, this factory, every controller — was unchanged by that swap, which
 * is the point of naming it. `token` is the opaque actor credential the injected `TokenExtractor` produced
 * (a session-cookie value in 1C).
 */
export interface ActorSource {
  resolve(input: {
    token: string | undefined;
    tenantId?: string | undefined;
    correlationId: string;
  }): Promise<AuthenticatedActor>;
}

/** A tenant-scoped request: the actor proved a live membership of the tenant they named. */
export interface TenantScopedRequest {
  readonly scope: 'tenant';
  readonly actor: AuthenticatedActor;
  readonly ctx: RequestContext;
  readonly correlationId: string;
}

/**
 * A platform-scoped request: a proven actor, no tenant.
 *
 * For control-plane work that cannot have a tenant context because the tenant does not exist yet — most
 * of all `POST /tenants`. The actor is proven exactly as strictly as in the tenant-scoped case; only the
 * membership gate is absent, because there is no tenant to be a member of.
 */
export interface PlatformScopedRequest {
  readonly scope: 'platform';
  readonly actor: AuthenticatedActor;
  readonly ctx: SystemContext & { readonly permissions: readonly string[] };
  readonly correlationId: string;
}

export type ScopedRequest = TenantScopedRequest | PlatformScopedRequest;

export class ActorContextFactory {
  private readonly source: ActorSource;
  private readonly tenants: TenantContextResolver;
  private readonly extractToken: TokenExtractor;
  private readonly permissions: PermissionSource;

  constructor(
    source: ActorSource,
    tenants: TenantContextResolver,
    extractToken: TokenExtractor,
    permissions: PermissionSource,
  ) {
    this.source = source;
    this.tenants = tenants;
    this.extractToken = extractToken;
    this.permissions = permissions;
  }

  /** Resolves the actor's effective permissions from persistent RBAC. A system actor inherits nothing. */
  private async permissionsFor(actor: AuthenticatedActor, tenantId: string | undefined): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- read the rule from the domain
    if (actor.isSystemActor && !systemActorInheritsHumanPermissions()) return [];
    const resolved = await this.permissions({
      identityId: actor.identityId,
      accountId: actor.accountId,
      tenantId,
      isSystemActor: actor.isSystemActor,
      correlationId: actor.correlationId,
    });
    return [...resolved];
  }

  /**
   * Resolves a request that is platform-level BY CONTRACT — no tenant, whatever the caller sent.
   *
   * For the handful of operations that cannot have a tenant context because they precede the tenant's
   * existence: `POST /tenants` above all. M01's `createDraft` takes a `SystemContext` and nothing else,
   * which is the domain saying the same thing in the type system.
   *
   * THE TENANT CLAIM IS IGNORED HERE, DELIBERATELY. An administrator creating a new tenant while working
   * inside an existing one is ordinary, and refusing them for having sent `x-tenant-id` would be pedantry.
   * Ignoring it is safe precisely because the work is tenant-less: there is no tenant-scoped row to reach,
   * so skipping the membership gate cannot widen what this request can touch.
   *
   * The ACTOR is proven exactly as strictly as anywhere else — account active, identity active. Only the
   * membership gate is absent, because there is no tenant to be a member of. "Platform-level" has never
   * meant "unauthenticated", and Stage 1A's bug was that it accidentally did.
   */
  async forPlatformRequest(
    headers: Readonly<Record<string, string>>,
    reason: string,
  ): Promise<PlatformScopedRequest> {
    const correlationId = correlationOf(headers);
    const actor = await this.source.resolve({ token: this.extractToken(headers), correlationId });
    return {
      scope: 'platform',
      actor,
      ctx: { reason, correlationId, permissions: await this.permissionsFor(actor, undefined) },
      correlationId,
    };
  }

  /**
   * Resolves a request into a context, or refuses.
   *
   * `reason` describes the platform-scoped case for the audit trail — `Db.withSystem` demands one, so
   * every use of the control-plane escape is explainable in review rather than incidental.
   */
  async forRequest(headers: Readonly<Record<string, string>>, reason: string): Promise<ScopedRequest> {
    const correlationId = correlationOf(headers);
    const token = this.extractToken(headers);
    const claimedTenant = headers[TENANT_HEADER];

    // Gate 1-3. Nothing above this line has been trusted, and nothing below it runs unless this passes.
    // A malformed or absent assertion, a suspended account, a suspended identity, an ended membership and
    // an unknown tenant all end here, with one message and one status.
    const actor = await this.source.resolve({
      token,
      ...(claimedTenant === undefined ? {} : { tenantId: claimedTenant }),
      correlationId,
    });

    const permissions = await this.permissionsFor(actor, claimedTenant);

    if (claimedTenant === undefined) {
      return {
        scope: 'platform',
        actor,
        ctx: { reason, correlationId, permissions },
        correlationId,
      };
    }

    // Gate 4 — M01's, reused rather than re-implemented. The actor has a live membership of this tenant,
    // but a membership of a suspended or closed tenant must not become a usable context: that is M01's
    // rule and M01 remains the only module that knows it. M02 asks; it does not decide.
    //
    // This runs AFTER actor resolution on purpose (see the header comment): no assertion, no answer.
    await this.tenants.resolve({ claimedTenantId: claimedTenant, correlationId, permissions });

    return {
      scope: 'tenant',
      actor,
      // The only constructor of a tenant RequestContext, and the only writer of `userId` — which is the
      // IDENTITY, not the account, so a person with two logins is one actor in the audit trail.
      ctx: contextFromActor(actor, permissions),
      correlationId,
    };
  }
}

/**
 * The temporary permission channel, with the one rule the domain will not bend on.
 *
 * A SYSTEM actor gets nothing from it. `x-permissions` is the channel a human administrator's privileges
 * arrive on, and §4.5 forbids a system identity inheriting human permissions —
 * `systemActorInheritsHumanPermissions()` returns `false` with no flag to change it. Honouring that here
 * rather than trusting every future caller to check is what makes "the scheduler acted as an
 * administrator" unrepresentable instead of merely discouraged.
 *
 * Stage 1D gives machine principals their own grants. Until then a system actor can authenticate and can
 * be audited, and can do nothing else — which is the correct amount for a stage with no role model.
 */
function correlationOf(headers: Readonly<Record<string, string>>): string {
  const raw = headers[CORRELATION_HEADER];
  return raw === undefined || raw.trim() === '' ? randomUUID() : raw;
}

/**
 * Rejects a malformed uuid path parameter before it reaches SQL.
 *
 * `::uuid` on a bad value raises, which surfaces as a 500 — a server fault for what is a client mistake,
 * and one that tells a prober their input reached the database.
 */
export function requireUuidParam(value: string, field: string, correlationId: string): string {
  if (!UUID_PARAM_PATTERN.test(value)) {
    throw new ProblemError({
      type: 'https://finapp.dynamics/problems/validation',
      title: 'Bad Request',
      status: 400,
      detail: `Invalid ${field}.`,
      correlationId,
    });
  }
  return value;
}

const UUID_PARAM_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
