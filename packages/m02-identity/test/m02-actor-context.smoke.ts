import { defineSuite } from '@finapp/test-runner';
import { ProblemError } from '@finapp/kernel';
import type { TenantContextResolver } from '@finapp/m01-tenant';
import {
  ActorContextFactory,
  requireUuidParam,
  type ActorSource,
  type AuthenticatedActor,
} from '@finapp/m02-identity';

/**
 * The actor boundary's PURE suite — the composition, not the gates.
 *
 * The gates themselves need a database and are proven in `m02-actor-resolution.db-spec.ts`; assertion
 * signing and forgery are proven in `m02-identity.smoke.ts`. What is provable with no I/O, and is worth
 * proving here, is the WIRING: which inputs the factory reads, which it refuses to read, what order it
 * calls things in, and what it does with the answers.
 *
 * These are exactly the properties a reviewer cannot check by eye once the file is a year old, and the
 * ones a regression would make invisible: an `x-actor-id` read that "works" in every test that also sends
 * a valid assertion, a tenant gate called before the actor is proven, a system actor quietly inheriting
 * an administrator's permissions.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const IDENTITY = '22222222-2222-4222-8222-222222222222';
const OTHER_IDENTITY = '33333333-3333-4333-8333-333333333333';
const TENANT = '44444444-4444-4444-8444-444444444444';
const OTHER_TENANT = '55555555-5555-4555-8555-555555555555';

function actorFor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    identityId: IDENTITY,
    accountId: ACCOUNT,
    accountType: 'human',
    correlationId: 'cid',
    assurance: 'development',
    isSystemActor: false,
    ...overrides,
  };
}

/** Records what the factory asked for, so the suite can assert what was and was not read. */
interface Call {
  readonly token: string | undefined;
  readonly tenantId: string | undefined;
}

function fakeSource(actor: AuthenticatedActor | Error, calls: Call[], order: string[]): ActorSource {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- mirrors the async ActorSource contract
    async resolve(input) {
      calls.push({ token: input.token, tenantId: input.tenantId });
      order.push('actor');
      if (actor instanceof Error) throw actor;
      return { ...actor, ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }) };
    },
  };
}

function fakeTenants(order: string[], seen: string[]): TenantContextResolver {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- mirrors the async resolver contract
    async resolve(input: { claimedTenantId: string | undefined }) {
      order.push('tenant');
      seen.push(input.claimedTenantId ?? '<none>');
      return { tenantId: input.claimedTenantId, correlationId: 'cid', permissions: [] };
    },
  } as unknown as TenantContextResolver;
}

export default defineSuite('m02-actor-context', async (t) => {
  // --- x-actor-id is not an input ------------------------------------------------------------------
  // THE assertion this stage exists for. Not "x-actor-id is rejected" — it is not consulted at all, so
  // there is nothing to reject. These prove the header cannot influence the outcome in either direction:
  // it cannot grant an actor, and it cannot change one.

  {
    const calls: Call[] = [];
    const order: string[] = [];
    const factory = new ActorContextFactory(
      fakeSource(new ProblemError({ type: 't', title: 'Unauthorized', status: 401 }), calls, order),
      fakeTenants(order, []),
    );

    await t.rejects(
      factory.forRequest({ 'x-actor-id': ACCOUNT }, 'probe'),
      'a request carrying ONLY x-actor-id is refused',
    );
    t.equal(calls.length, 1, 'the request still reached the actor source (it was not short-circuited)');
    t.equal(calls[0]?.token, undefined, 'and the source received NO token — x-actor-id is not one');
  }

  {
    // The subtler failure: a VALID assertion for account A, plus x-actor-id claiming identity B. If the
    // header were read anywhere, this is where it would win — and every other test would still pass.
    const calls: Call[] = [];
    const order: string[] = [];
    const factory = new ActorContextFactory(fakeSource(actorFor(), calls, order), fakeTenants(order, []));

    const scoped = await factory.forRequest(
      { 'x-dev-actor': 'signed-token', 'x-actor-id': OTHER_IDENTITY },
      'read',
    );
    t.equal(scoped.actor.identityId, IDENTITY, "the resolved actor is the ASSERTION's, not x-actor-id's");
    t.equal(calls[0]?.token, 'signed-token', 'the source received the assertion');
  }

  // --- order: actor first, tenant second -----------------------------------------------------------
  // Reversing these would let a caller with no assertion probe which tenant ids are real from the shape
  // of the refusal. The order is a security property, so it is asserted rather than assumed.

  {
    const order: string[] = [];
    const seen: string[] = [];
    const factory = new ActorContextFactory(fakeSource(actorFor(), [], order), fakeTenants(order, seen));

    await factory.forRequest({ 'x-dev-actor': 'tok', 'x-tenant-id': TENANT }, 'read');
    t.deepEqual(order, ['actor', 'tenant'], 'the actor is proven BEFORE the tenant is validated');
    t.deepEqual(seen, [TENANT], 'the tenant gate is asked about the claimed tenant');
  }

  {
    // No assertion => the tenant gate is never reached, so a refusal cannot depend on the tenant existing.
    const order: string[] = [];
    const seen: string[] = [];
    const factory = new ActorContextFactory(
      fakeSource(new ProblemError({ type: 't', title: 'Unauthorized', status: 401 }), [], order),
      fakeTenants(order, seen),
    );

    await t.rejects(factory.forRequest({ 'x-tenant-id': TENANT }, 'probe'), 'no assertion, no context');
    t.deepEqual(seen, [], 'an unproven caller never reaches the tenant gate — no existence oracle');
  }

  // --- the tenant claim reaches the membership gate -------------------------------------------------

  {
    const calls: Call[] = [];
    const factory = new ActorContextFactory(fakeSource(actorFor(), calls, []), fakeTenants([], []));

    await factory.forRequest({ 'x-dev-actor': 'tok', 'x-tenant-id': OTHER_TENANT }, 'read');
    t.equal(
      calls[0]?.tenantId,
      OTHER_TENANT,
      'the claimed tenant is passed to the resolver, so membership is checked against the tenant NAMED',
    );
  }

  // --- scope ---------------------------------------------------------------------------------------

  {
    const factory = new ActorContextFactory(fakeSource(actorFor(), [], []), fakeTenants([], []));

    const platform = await factory.forRequest({ 'x-dev-actor': 'tok' }, 'create tenant draft');
    t.equal(platform.scope, 'platform', 'no x-tenant-id => platform scope');
    t.ok('reason' in platform.ctx, 'a platform context carries the mandatory system reason');
    t.equal(platform.actor.identityId, IDENTITY, 'and a platform request still has a PROVEN actor');

    const tenant = await factory.forRequest({ 'x-dev-actor': 'tok', 'x-tenant-id': TENANT }, 'read');
    t.equal(tenant.scope, 'tenant', 'x-tenant-id => tenant scope');
    t.equal(tenant.scope === 'tenant' ? tenant.ctx.tenantId : null, TENANT, 'bound to the named tenant');
    t.equal(
      tenant.scope === 'tenant' ? tenant.ctx.userId : null,
      IDENTITY,
      'userId is the IDENTITY, not the account — one person with two logins is one actor in audit',
    );
  }

  {
    // forPlatformRequest ignores the tenant claim by contract. Safe only because the work is tenant-less:
    // there is no tenant-scoped row to reach, so skipping the membership gate widens nothing.
    const calls: Call[] = [];
    const order: string[] = [];
    const seen: string[] = [];
    const factory = new ActorContextFactory(fakeSource(actorFor(), calls, order), fakeTenants(order, seen));

    const scoped = await factory.forPlatformRequest(
      { 'x-dev-actor': 'tok', 'x-tenant-id': TENANT },
      'create tenant draft',
    );
    t.equal(scoped.scope, 'platform', 'forPlatformRequest is platform-scoped even with x-tenant-id sent');
    t.equal(calls[0]?.tenantId, undefined, 'and asks for no membership gate — there is no tenant yet');
    t.deepEqual(seen, [], 'nor does it consult the tenant gate');
    t.equal(scoped.actor.identityId, IDENTITY, 'the actor is proven regardless');
  }

  // --- permissions: the temporary channel, contained ------------------------------------------------

  {
    const factory = new ActorContextFactory(fakeSource(actorFor(), [], []), fakeTenants([], []));

    const scoped = await factory.forRequest(
      {
        'x-dev-actor': 'tok',
        'x-tenant-id': TENANT,
        'x-permissions': 'identity.registry.view, tenant.registry.create',
      },
      'read',
    );
    t.deepEqual(
      scoped.scope === 'tenant' ? [...scoped.ctx.permissions] : [],
      ['identity.registry.view', 'tenant.registry.create'],
      'x-permissions still reaches the context (Stage 1D debt), trimmed and split',
    );

    const none = await factory.forRequest({ 'x-dev-actor': 'tok', 'x-tenant-id': TENANT }, 'read');
    t.deepEqual(
      none.scope === 'tenant' ? [...none.ctx.permissions] : ['x'],
      [],
      'absent x-permissions grants nothing — deny by default',
    );

    const empty = await factory.forRequest(
      { 'x-dev-actor': 'tok', 'x-tenant-id': TENANT, 'x-permissions': ' , ,, ' },
      'read',
    );
    t.deepEqual(
      empty.scope === 'tenant' ? [...empty.ctx.permissions] : ['x'],
      [],
      'a header of separators grants nothing — no empty-string permission slips through',
    );
  }

  {
    // §4.5, enforced rather than documented. A system identity presenting an administrator's permissions
    // gets none of them: this is the "use system context as a human actor" attack, and it fails here.
    const factory = new ActorContextFactory(
      fakeSource(actorFor({ isSystemActor: true }), [], []),
      fakeTenants([], []),
    );

    const scoped = await factory.forRequest(
      {
        'x-dev-actor': 'tok',
        'x-tenant-id': TENANT,
        'x-permissions': 'identity.registry.close,tenant.registry.approve',
      },
      'read',
    );
    t.equal(scoped.actor.isSystemActor, true, 'the actor is a system principal');
    t.deepEqual(
      scoped.scope === 'tenant' ? [...scoped.ctx.permissions] : ['x'],
      [],
      'a SYSTEM actor inherits NO human permissions, whatever x-permissions claims (§4.5)',
    );
  }

  // --- correlation ---------------------------------------------------------------------------------

  {
    const factory = new ActorContextFactory(fakeSource(actorFor(), [], []), fakeTenants([], []));

    const given = await factory.forRequest({ 'x-dev-actor': 'tok', 'x-correlation-id': 'abc-123' }, 'r');
    t.equal(given.correlationId, 'abc-123', 'a supplied correlation id is honoured');

    const minted = await factory.forRequest({ 'x-dev-actor': 'tok' }, 'r');
    t.ok(minted.correlationId.length >= 36, 'one is minted when absent — every request is traceable');

    const blank = await factory.forRequest({ 'x-dev-actor': 'tok', 'x-correlation-id': '   ' }, 'r');
    t.ok(blank.correlationId.trim() !== '', 'a blank correlation id is replaced, not propagated');
  }

  // --- uuid path params ----------------------------------------------------------------------------
  // A malformed id must not reach `::uuid`: that raises inside the policy, surfacing as a 500 — a server
  // fault for a client mistake, and a signal that the input reached the database.

  {
    t.equal(requireUuidParam(TENANT, 'tenantId', 'cid'), TENANT, 'a well-formed uuid passes through');
    t.throws(() => requireUuidParam('not-a-uuid', 'identityId', 'cid'), 'a malformed uuid is refused');
    t.throws(() => requireUuidParam("' OR 1=1--", 'identityId', 'cid'), 'an injection attempt is refused');
    t.throws(() => requireUuidParam('', 'identityId', 'cid'), 'an empty id is refused');

    let status = 0;
    try {
      requireUuidParam('nope', 'identityId', 'cid');
    } catch (error: unknown) {
      status = error instanceof ProblemError ? error.status : 0;
    }
    t.equal(status, 400, 'and refused as 400 — a client mistake, not a server fault');
  }
});
