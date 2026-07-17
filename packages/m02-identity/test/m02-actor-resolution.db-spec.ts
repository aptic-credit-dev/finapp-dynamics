import { randomUUID } from 'node:crypto';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { ProblemError } from '@finapp/kernel';
import { PgDb } from '@finapp/kernel/pg';
import { TenantContextResolver } from '@finapp/m01-tenant';
import { ActorContextFactory, ActorResolver, DevActorAdapter, signDevAssertion } from '@finapp/m02-identity';

/**
 * ACTOR RESOLUTION, AGAINST A REAL DATABASE — the three gates and the boundary above them.
 *
 * `m02-identity.db-spec.ts` proves the SCHEMA isolates. This proves the CODE gates, which is a different
 * claim and the one Stage 1B is defined by: that a signed assertion for a real account still resolves to
 * nothing when the account is suspended, the person is suspended, or the membership has ended.
 *
 * WHY IT RUNS THROUGH `PgDb` AND NOT THE SPEC HARNESS. The harness's `asTenant`/`asSystem` are a
 * lookalike of what the kernel does. Here the resolver is handed a real `PgDb` bound to the real
 * non-superuser application role, so every query goes through the same `SET LOCAL ROLE` + GUC path
 * production uses, subject to the same policies. A pass here is evidence about the shipped code.
 *
 * THE SUPERUSER POOL IS FOR SEEDING ONLY. A superuser bypasses RLS entirely, so nothing is ever PROVEN
 * through it — it is how rows get into place, and that is all.
 */

const SECRET = 'x'.repeat(48);
const HUMAN = 'employee';

/** A live assertion for `accountId`. The only legitimate way to present an actor in Stage 1B. */
function assertionFor(accountId: string, secondsFromNow = 300): string {
  return signDevAssertion({ accountId, expiresAt: Math.floor(Date.now() / 1000) + secondsFromNow }, SECRET);
}

interface Seeded {
  readonly tenantId: string;
  readonly identityId: string;
  readonly accountId: string;
  readonly membershipId: string;
}

/** A tenant, an active person, an active login, and an active membership. The happy path, in full. */
async function seedActor(
  ctx: DbSpecContext,
  code: string,
  overrides: {
    identityStatus?: string;
    accountStatus?: string;
    membershipStatus?: string;
    identityType?: string;
    tenantStatus?: string;
  } = {},
): Promise<Seeded> {
  const tenantId = randomUUID();
  const identityId = randomUUID();
  const accountId = randomUUID();
  const membershipId = randomUUID();
  const identityType = overrides.identityType ?? 'internal_person';
  const isMachine = identityType === 'service_identity' || identityType === 'system_identity';
  const accountStatus = overrides.accountStatus ?? 'active';
  const membershipStatus = overrides.membershipStatus ?? 'active';

  await ctx.asSuperuser(null, async (tx) => {
    // tenants_suspended_ck requires suspended_at when status = 'suspended'.
    const tenantStatus = overrides.tenantStatus ?? 'active';
    await tx.query(
      `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at, suspended_at)
       VALUES ($1, $2, $3, 'enterprise_customer', $4, now(), $5)`,
      [tenantId, code, `${code} Ltd`, tenantStatus, tenantStatus === 'suspended' ? new Date() : null],
    );
    // The human/machine email constraint is biconditional, so the email must track the type.
    await tx.query(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status,
                               data_classification)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        identityId,
        identityType,
        `${code} Person`,
        isMachine ? null : `${code}@example.com`,
        isMachine ? null : `${code}@example.com`,
        overrides.identityStatus ?? 'active',
        isMachine ? 'internal' : 'confidential',
      ],
    );
    await tx.query(
      `INSERT INTO user_accounts (id, identity_id, account_type, login_identifier, login_identifier_norm,
                                  status, activated_at, suspended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        accountId,
        identityId,
        isMachine ? 'system' : 'human',
        `${code}_login`,
        `${code}_login`,
        accountStatus,
        // The CHECK constraints demand these track the status.
        accountStatus === 'active' ? new Date() : null,
        accountStatus === 'suspended' ? new Date() : null,
      ],
    );
    await tx.query(
      `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status,
                                       end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        membershipId,
        identityId,
        accountId,
        HUMAN,
        membershipStatus,
        membershipStatus === 'ended' ? new Date(Date.now() + 1000) : null,
      ],
    );
  });

  return { tenantId, identityId, accountId, membershipId };
}

/** Captures the refusal without letting a pass depend on the message. */
async function refusalOf(promise: Promise<unknown>): Promise<{ status: number; detail: string } | null> {
  try {
    await promise;
    return null;
  } catch (error: unknown) {
    if (error instanceof ProblemError) return { status: error.status, detail: error.detail ?? '' };
    throw error;
  }
}

export default defineDbSpec('m02-actor-resolution (Stage 1B)', async (ctx, t) => {
  // The real thing: the application role, the real GUC path, the real policies.
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const resolver = new ActorResolver(db);
  const adapter = new DevActorAdapter(resolver, { NODE_ENV: 'test', FINAPP_DEV_ACTOR_SECRET: SECRET });
  const factory = new ActorContextFactory(adapter, new TenantContextResolver(db));

  const ok = await seedActor(ctx, 'ares_ok');

  // --- the happy path ------------------------------------------------------------------------------
  // Established first. Everything below is a claim that something REFUSES, and those are worthless
  // unless the same shape succeeds when it should — a resolver that refuses everything would pass every
  // negative test in this file.

  {
    const actor = await resolver.resolve({
      claimedAccountId: ok.accountId,
      tenantId: ok.tenantId,
      correlationId: randomUUID(),
      assurance: 'development',
    });
    t.equal(actor.identityId, ok.identityId, 'an active account in an active tenant resolves');
    t.equal(actor.accountId, ok.accountId, 'and carries the account it was claimed from');
    t.equal(actor.membershipId, ok.membershipId, 'and the membership that proved it');
    t.equal(actor.tenantId, ok.tenantId, 'and the tenant it is scoped to');
    t.equal(actor.isSystemActor, false, 'a staff identity is not a system actor');
    t.equal(actor.assurance, 'development', 'assurance is development — this is NOT authentication');
  }

  // --- gate 1: the account -------------------------------------------------------------------------

  for (const status of ['suspended', 'pending_activation', 'deactivated'] as const) {
    const seeded = await seedActor(ctx, `ares_acct_${status}`, { accountStatus: status });
    const refusal = await refusalOf(
      resolver.resolve({
        claimedAccountId: seeded.accountId,
        tenantId: seeded.tenantId,
        correlationId: randomUUID(),
        assurance: 'development',
      }),
    );
    t.equal(refusal?.status, 401, `an account that is ${status} does NOT resolve`);
  }

  // --- gate 2: the identity ------------------------------------------------------------------------
  // Independent of the account. This is the "suspend the person, not their logins" case: the account is
  // active and would resolve on its own terms, and the person's suspension must still stop it.

  for (const status of ['suspended', 'closed', 'draft'] as const) {
    const seeded = await seedActor(ctx, `ares_idt_${status}`, {
      identityStatus: status,
      accountStatus: 'active',
    });
    const refusal = await refusalOf(
      resolver.resolve({
        claimedAccountId: seeded.accountId,
        tenantId: seeded.tenantId,
        correlationId: randomUUID(),
        assurance: 'development',
      }),
    );
    t.equal(refusal?.status, 401, `an ACTIVE account whose identity is ${status} does NOT resolve`);
  }

  // --- gate 3: the membership ----------------------------------------------------------------------
  // Also independent: person and login are both active, and the tenant relationship is what is gone.

  for (const status of ['suspended', 'ended', 'pending'] as const) {
    const seeded = await seedActor(ctx, `ares_mem_${status}`, { membershipStatus: status });
    const refusal = await refusalOf(
      resolver.resolve({
        claimedAccountId: seeded.accountId,
        tenantId: seeded.tenantId,
        correlationId: randomUUID(),
        assurance: 'development',
      }),
    );
    t.equal(refusal?.status, 401, `a membership that is ${status} does NOT resolve`);
  }

  {
    // ...and the same actor still resolves with NO tenant, because the membership gate is the only thing
    // that failed. Proves the three gates are genuinely independent rather than one check in a trench
    // coat: a lapsed tenant relationship must not disable a person's platform identity.
    const seeded = await seedActor(ctx, 'ares_mem_platform', { membershipStatus: 'ended' });
    const actor = await resolver.resolve({
      claimedAccountId: seeded.accountId,
      correlationId: randomUUID(),
      assurance: 'development',
    });
    t.equal(actor.identityId, seeded.identityId, 'an ended membership still resolves platform-scoped');
    t.equal(actor.tenantId, undefined, 'with no tenant, and no membership claim');
  }

  // --- cross-tenant --------------------------------------------------------------------------------
  // THE isolation claim. Two fully-valid actors in two tenants; each must be unable to become the other's.

  {
    const a = await seedActor(ctx, 'ares_x_a');
    const b = await seedActor(ctx, 'ares_x_b');

    const refusal = await refusalOf(
      resolver.resolve({
        claimedAccountId: a.accountId,
        tenantId: b.tenantId,
        correlationId: randomUUID(),
        assurance: 'development',
      }),
    );
    t.equal(refusal?.status, 401, "tenant A's actor cannot resolve into tenant B");

    // Not because the row is missing — it exists, and RLS is what hides it. Proven by reading the same
    // membership through the app role in the WRONG tenant's context and seeing nothing.
    const leaked = await ctx.asTenant(b.tenantId, async (tx) => {
      const result = await tx.query('SELECT id FROM tenant_memberships WHERE identity_id = $1', [
        a.identityId,
      ]);
      return result.rowCount;
    });
    t.equal(leaked, 0, "and tenant A's membership row is invisible from tenant B's context (RLS, not luck)");

    const own = await ctx.asTenant(a.tenantId, async (tx) => {
      const result = await tx.query('SELECT id FROM tenant_memberships WHERE identity_id = $1', [
        a.identityId,
      ]);
      return result.rowCount;
    });
    t.equal(own, 1, 'while the same row IS visible from its own tenant — the check is not vacuous');
  }

  // --- non-enumeration -----------------------------------------------------------------------------
  // Every refusal must be byte-identical. A caller probing account ids must not be able to tell "no such
  // account" from "suspended" from "not a member here" — each distinction maps the platform's people.

  {
    const suspendedAccount = await seedActor(ctx, 'ares_enum_acct', { accountStatus: 'suspended' });
    const suspendedIdentity = await seedActor(ctx, 'ares_enum_idt', { identityStatus: 'suspended' });
    const otherTenant = await seedActor(ctx, 'ares_enum_other');
    const cid = randomUUID();

    const refusals = await Promise.all(
      [
        // does not exist
        { claimedAccountId: randomUUID(), tenantId: ok.tenantId },
        // exists, suspended account
        { claimedAccountId: suspendedAccount.accountId, tenantId: suspendedAccount.tenantId },
        // exists, suspended person
        { claimedAccountId: suspendedIdentity.accountId, tenantId: suspendedIdentity.tenantId },
        // exists and is fine, but not a member of the tenant named
        { claimedAccountId: otherTenant.accountId, tenantId: ok.tenantId },
        // not a uuid at all
        { claimedAccountId: 'not-a-uuid', tenantId: ok.tenantId },
      ].map((input) =>
        refusalOf(resolver.resolve({ ...input, correlationId: cid, assurance: 'development' })),
      ),
    );

    t.ok(
      refusals.every((r) => r !== null),
      'every one of the five probes is refused',
    );
    t.equal(new Set(refusals.map((r) => r?.status)).size, 1, 'all five refusals share ONE status');
    t.equal(new Set(refusals.map((r) => r?.detail)).size, 1, 'and ONE message — no enumeration oracle');
    t.equal(refusals[0]?.status, 401, 'which is 401: no actor was established, so authorization never ran');
  }

  {
    // A malformed tenant claim must be refused, not raise. `NULLIF(...)::uuid` inside the policy would
    // turn it into a 500 — a server fault for a client mistake, and a signal the input reached the
    // database. This is the guard added alongside this spec.
    const refusal = await refusalOf(
      resolver.resolve({
        claimedAccountId: ok.accountId,
        tenantId: "'; DROP TABLE identities;--",
        correlationId: randomUUID(),
        assurance: 'development',
      }),
    );
    t.equal(refusal?.status, 401, 'a malformed tenant claim is refused as 401, not raised as a 500');

    const alive = await ctx.asSystem(async (tx) => {
      const result = await tx.query('SELECT count(*)::int AS n FROM identities');
      return (result.rows[0] as { n: number }).n;
    });
    t.ok(alive > 0, 'and the identities table is still there — the claim never reached SQL');
  }

  // --- the dev adapter, end to end -----------------------------------------------------------------
  // Signature first, gates second. A valid signature proves who SENT the claim; it never proves the actor
  // may act, and these separate the two.

  {
    const cid = randomUUID();
    const actor = await adapter.resolve({
      token: assertionFor(ok.accountId),
      tenantId: ok.tenantId,
      correlationId: cid,
    });
    t.equal(actor.identityId, ok.identityId, 'a correctly-signed assertion for a live actor resolves');

    const forged = await refusalOf(
      adapter.resolve({
        token: signDevAssertion(
          { accountId: ok.accountId, expiresAt: Math.floor(Date.now() / 1000) + 300 },
          'w'.repeat(48), // the attacker's secret, not ours
        ),
        tenantId: ok.tenantId,
        correlationId: cid,
      }),
    );
    t.equal(forged?.status, 401, 'an assertion signed with the WRONG secret is refused');

    const expired = await refusalOf(
      adapter.resolve({
        token: assertionFor(ok.accountId, -60),
        tenantId: ok.tenantId,
        correlationId: cid,
      }),
    );
    t.equal(expired?.status, 401, 'an EXPIRED assertion is refused, even correctly signed');

    const absent = await refusalOf(
      adapter.resolve({ token: undefined, tenantId: ok.tenantId, correlationId: cid }),
    );
    t.equal(absent?.status, 401, 'no assertion is refused');

    // THE POINT OF THE WHOLE DESIGN: a perfect signature over a suspended account still resolves to
    // nothing. Signature and authorization are separate questions, and the database answers the second.
    const suspended = await seedActor(ctx, 'ares_signed_susp', { accountStatus: 'suspended' });
    const signedButSuspended = await refusalOf(
      adapter.resolve({
        token: assertionFor(suspended.accountId),
        tenantId: suspended.tenantId,
        correlationId: cid,
      }),
    );
    t.equal(
      signedButSuspended?.status,
      401,
      'a PERFECTLY SIGNED assertion for a SUSPENDED account is refused — a signature is not authority',
    );

    // Tampering: re-point a valid assertion at another account without re-signing.
    const victim = await seedActor(ctx, 'ares_signed_victim');
    const original = assertionFor(ok.accountId);
    const [, mac] = original.split('.') as [string, string];
    const swappedPayload = Buffer.from(
      JSON.stringify({ accountId: victim.accountId, expiresAt: Math.floor(Date.now() / 1000) + 300 }),
      'utf8',
    ).toString('base64url');
    const tampered = await refusalOf(
      adapter.resolve({
        token: `${swappedPayload}.${mac}`,
        tenantId: victim.tenantId,
        correlationId: cid,
      }),
    );
    t.equal(tampered?.status, 401, 'swapping the account id without re-signing is refused');
  }

  {
    // Permission injection: extra fields in the signed payload must not become privileges. The assertion
    // says WHO, never WHAT-MAY-THEY-DO — those arrive on a separate channel, from a separate source.
    const payload = { accountId: ok.accountId, expiresAt: Math.floor(Date.now() / 1000) + 300 };
    const injected = signDevAssertion(
      { ...payload, permissions: ['identity.registry.close'] } as never,
      SECRET,
    );
    const scoped = await factory.forRequest({ 'x-dev-actor': injected, 'x-tenant-id': ok.tenantId }, 'read');
    t.deepEqual(
      scoped.scope === 'tenant' ? [...scoped.ctx.permissions] : ['x'],
      [],
      'permissions injected into the SIGNED payload are ignored — the assertion carries no authority',
    );
  }

  // --- the boundary, end to end --------------------------------------------------------------------

  {
    const cid = randomUUID();
    const scoped = await factory.forRequest(
      { 'x-dev-actor': assertionFor(ok.accountId), 'x-tenant-id': ok.tenantId, 'x-correlation-id': cid },
      'read',
    );
    t.equal(scoped.scope, 'tenant', 'the factory produces a tenant context for a live actor');
    t.equal(scoped.scope === 'tenant' ? scoped.ctx.userId : null, ok.identityId, 'userId is the identity');
    t.equal(scoped.correlationId, cid, 'and the correlation id is carried through');

    // x-actor-id, one last time, against the real database and the real resolver.
    const headerOnly = await refusalOf(factory.forRequest({ 'x-actor-id': ok.accountId }, 'probe'));
    t.equal(headerOnly?.status, 401, 'x-actor-id alone buys nothing, even for a REAL live account');

    const headerVsAssertion = await seedActor(ctx, 'ares_hdr_other');
    const both = await factory.forRequest(
      {
        'x-dev-actor': assertionFor(ok.accountId),
        'x-actor-id': headerVsAssertion.accountId,
        'x-tenant-id': ok.tenantId,
      },
      'read',
    );
    t.equal(
      both.actor.identityId,
      ok.identityId,
      'and cannot override a valid assertion — the header is not read at all',
    );
  }

  {
    // A suspended TENANT is m01's gate, applied after the actor is proven. The membership is live; the
    // tenant is not, so there is no usable context.
    const suspendedTenant = await seedActor(ctx, 'ares_tnt_susp', { tenantStatus: 'suspended' });
    const refusal = await refusalOf(
      factory.forRequest(
        {
          'x-dev-actor': assertionFor(suspendedTenant.accountId),
          'x-tenant-id': suspendedTenant.tenantId,
        },
        'read',
      ),
    );
    t.ok(refusal !== null, 'a live membership of a SUSPENDED tenant yields no context (m01 gate)');
    t.ok(
      refusal?.status === 401 || refusal?.status === 403,
      'refused non-disclosingly (401/403), never a 500',
    );
  }

  // --- system actors -------------------------------------------------------------------------------

  {
    const system = await seedActor(ctx, 'ares_sys', { identityType: 'system_identity' });
    const actor = await resolver.resolve({
      claimedAccountId: system.accountId,
      tenantId: system.tenantId,
      correlationId: randomUUID(),
      assurance: 'development',
    });
    t.equal(actor.isSystemActor, true, 'a system identity resolves as a SYSTEM actor');

    const scoped = await factory.forRequest(
      {
        'x-dev-actor': assertionFor(system.accountId),
        'x-tenant-id': system.tenantId,
        'x-permissions': 'identity.registry.close,tenant.registry.approve',
      },
      'read',
    );
    t.deepEqual(
      scoped.scope === 'tenant' ? [...scoped.ctx.permissions] : ['x'],
      [],
      'and inherits NO human permissions however x-permissions is set (§4.5) — system context is not a human actor',
    );
  }

  // --- the adapter refuses to exist in production ---------------------------------------------------

  {
    t.throws(
      () => new DevActorAdapter(resolver, { NODE_ENV: 'production', FINAPP_DEV_ACTOR_SECRET: SECRET }),
      'the dev adapter CANNOT be constructed in production — it throws at boot, not at request time',
    );
    t.throws(
      () => new DevActorAdapter(resolver, { NODE_ENV: 'test' }),
      'nor without a secret — an empty HMAC key would verify every signature',
    );
    t.throws(
      () => new DevActorAdapter(resolver, { NODE_ENV: 'test', FINAPP_DEV_ACTOR_SECRET: 'short' }),
      'nor with a weak secret — a guessable key makes the signature theatre',
    );
  }

  // --- pooled connections do not leak context ------------------------------------------------------
  // SET LOCAL is transaction-scoped, so a connection returned to the pool cannot carry one request's
  // tenant into the next request that borrows it. This is the single most important property of PgDb,
  // and the one whose failure would be silent and catastrophic.

  {
    const a = await seedActor(ctx, 'ares_leak_a');
    const b = await seedActor(ctx, 'ares_leak_b');

    // Resolve in A, then immediately in B, repeatedly — the pool hands back the same connections.
    for (let i = 0; i < 3; i += 1) {
      const actorA = await resolver.resolve({
        claimedAccountId: a.accountId,
        tenantId: a.tenantId,
        correlationId: randomUUID(),
        assurance: 'development',
      });
      const actorB = await resolver.resolve({
        claimedAccountId: b.accountId,
        tenantId: b.tenantId,
        correlationId: randomUUID(),
        assurance: 'development',
      });
      t.equal(actorA.membershipId, a.membershipId, `pass ${i}: tenant A resolves to A's membership`);
      t.equal(actorB.membershipId, b.membershipId, `pass ${i}: tenant B resolves to B's membership`);
    }

    // And a reused connection has no tenant bound at the start of the next transaction.
    const bleed = await refusalOf(
      resolver.resolve({
        claimedAccountId: a.accountId,
        tenantId: b.tenantId,
        correlationId: randomUUID(),
        assurance: 'development',
      }),
    );
    t.equal(bleed?.status, 401, 'after all that, A still cannot resolve into B — no GUC bled through');
  }
});
