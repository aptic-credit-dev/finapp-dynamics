import { randomUUID } from 'node:crypto';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { ProblemError } from '@finapp/kernel';
import { PgDb } from '@finapp/kernel/pg';
import { TenantContextResolver } from '@finapp/m01-tenant';
import {
  ActorContextFactory,
  ActorResolver,
  type ActorSource,
  type AuthenticatedActor,
} from '@finapp/m02-identity';

/**
 * ACTOR RESOLUTION, AGAINST A REAL DATABASE — the three gates and the boundary above them.
 *
 * `m02-identity.db-spec.ts` proves the SCHEMA isolates. This proves the CODE gates: that a claim for a real
 * account still resolves to nothing when the account is suspended, the person is suspended, or the
 * membership has ended.
 *
 * Stage 1C DELETED the development actor adapter. The boundary is exercised here with a minimal stub
 * `ActorSource` whose "token" IS the claimed account id (standing in for "the session resolved to this
 * account"); the real SessionActorAdapter, cookies and CSRF are proven in m02-auth and the API integration
 * spec. `ActorResolver` itself is UNCHANGED by Stage 1C, so these gate tests carry over verbatim.
 */

const HUMAN = 'employee';
const SESSION_HEADER = 'x-session-token';

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
        accountStatus === 'active' ? new Date() : null,
        accountStatus === 'suspended' ? new Date() : null,
      ],
    );
    await tx.query(
      `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status, end_date)
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
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const resolver = new ActorResolver(db);

  /** The Stage 1C seam, stubbed: the "token" is the claimed account id, resolved through the real gates. */
  const source: ActorSource = {
    resolve: (input): Promise<AuthenticatedActor> =>
      resolver.resolve({
        claimedAccountId: input.token ?? '',
        ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
        correlationId: input.correlationId,
        assurance: 'password',
      }),
  };
  const factory = new ActorContextFactory(source, new TenantContextResolver(db), (h) => h[SESSION_HEADER]);

  const ok = await seedActor(ctx, 'ares_ok');

  // --- the happy path ------------------------------------------------------------------------------
  {
    const actor = await resolver.resolve({
      claimedAccountId: ok.accountId,
      tenantId: ok.tenantId,
      correlationId: randomUUID(),
      assurance: 'password',
    });
    t.equal(actor.identityId, ok.identityId, 'an active account in an active tenant resolves');
    t.equal(actor.accountId, ok.accountId, 'and carries the account it was claimed from');
    t.equal(actor.membershipId, ok.membershipId, 'and the membership that proved it');
    t.equal(actor.tenantId, ok.tenantId, 'and the tenant it is scoped to');
    t.equal(actor.isSystemActor, false, 'a staff identity is not a system actor');
  }

  // --- gate 1: the account -------------------------------------------------------------------------
  for (const status of ['suspended', 'pending_activation', 'deactivated'] as const) {
    const seeded = await seedActor(ctx, `ares_acct_${status}`, { accountStatus: status });
    const refusal = await refusalOf(
      resolver.resolve({
        claimedAccountId: seeded.accountId,
        tenantId: seeded.tenantId,
        correlationId: randomUUID(),
        assurance: 'password',
      }),
    );
    t.equal(refusal?.status, 401, `an account that is ${status} does NOT resolve`);
  }

  // --- gate 2: the identity ------------------------------------------------------------------------
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
        assurance: 'password',
      }),
    );
    t.equal(refusal?.status, 401, `an ACTIVE account whose identity is ${status} does NOT resolve`);
  }

  // --- gate 3: the membership ----------------------------------------------------------------------
  for (const status of ['suspended', 'ended', 'pending'] as const) {
    const seeded = await seedActor(ctx, `ares_mem_${status}`, { membershipStatus: status });
    const refusal = await refusalOf(
      resolver.resolve({
        claimedAccountId: seeded.accountId,
        tenantId: seeded.tenantId,
        correlationId: randomUUID(),
        assurance: 'password',
      }),
    );
    t.equal(refusal?.status, 401, `a membership that is ${status} does NOT resolve`);
  }

  {
    // The same actor resolves with NO tenant — the three gates are independent.
    const seeded = await seedActor(ctx, 'ares_mem_platform', { membershipStatus: 'ended' });
    const actor = await resolver.resolve({
      claimedAccountId: seeded.accountId,
      correlationId: randomUUID(),
      assurance: 'password',
    });
    t.equal(actor.identityId, seeded.identityId, 'an ended membership still resolves platform-scoped');
    t.equal(actor.tenantId, undefined, 'with no tenant, and no membership claim');
  }

  // --- cross-tenant --------------------------------------------------------------------------------
  {
    const a = await seedActor(ctx, 'ares_x_a');
    const b = await seedActor(ctx, 'ares_x_b');
    const refusal = await refusalOf(
      resolver.resolve({
        claimedAccountId: a.accountId,
        tenantId: b.tenantId,
        correlationId: randomUUID(),
        assurance: 'password',
      }),
    );
    t.equal(refusal?.status, 401, "tenant A's actor cannot resolve into tenant B");

    const leaked = await ctx.asTenant(b.tenantId, async (tx) => {
      const result = await tx.query('SELECT id FROM tenant_memberships WHERE identity_id = $1', [
        a.identityId,
      ]);
      return result.rowCount;
    });
    t.equal(leaked, 0, "and tenant A's membership row is invisible from tenant B's context (RLS, not luck)");
  }

  // --- non-enumeration -----------------------------------------------------------------------------
  {
    const suspendedAccount = await seedActor(ctx, 'ares_enum_acct', { accountStatus: 'suspended' });
    const suspendedIdentity = await seedActor(ctx, 'ares_enum_idt', { identityStatus: 'suspended' });
    const otherTenant = await seedActor(ctx, 'ares_enum_other');
    const cid = randomUUID();

    const refusals = await Promise.all(
      [
        { claimedAccountId: randomUUID(), tenantId: ok.tenantId },
        { claimedAccountId: suspendedAccount.accountId, tenantId: suspendedAccount.tenantId },
        { claimedAccountId: suspendedIdentity.accountId, tenantId: suspendedIdentity.tenantId },
        { claimedAccountId: otherTenant.accountId, tenantId: ok.tenantId },
        { claimedAccountId: 'not-a-uuid', tenantId: ok.tenantId },
      ].map((input) => refusalOf(resolver.resolve({ ...input, correlationId: cid, assurance: 'password' }))),
    );
    t.ok(
      refusals.every((r) => r !== null),
      'every one of the five probes is refused',
    );
    t.equal(new Set(refusals.map((r) => r?.status)).size, 1, 'all five refusals share ONE status');
    t.equal(new Set(refusals.map((r) => r?.detail)).size, 1, 'and ONE message — no enumeration oracle');
    t.equal(refusals[0]?.status, 401, 'which is 401: no actor was established');
  }

  // --- the boundary, end to end (real resolver, stub session source) -------------------------------
  {
    const scoped = await factory.forRequest(
      { [SESSION_HEADER]: ok.accountId, 'x-tenant-id': ok.tenantId },
      'read',
    );
    t.equal(scoped.scope, 'tenant', 'the factory produces a tenant context for a live actor');
    t.equal(scoped.scope === 'tenant' ? scoped.ctx.userId : null, ok.identityId, 'userId is the identity');

    // x-actor-id, one last time: it is not consulted at all.
    const headerOnly = await refusalOf(factory.forRequest({ 'x-actor-id': ok.accountId }, 'probe'));
    t.equal(headerOnly?.status, 401, 'x-actor-id alone buys nothing — no session token, no actor');

    const both = await factory.forRequest(
      { [SESSION_HEADER]: ok.accountId, 'x-actor-id': randomUUID(), 'x-tenant-id': ok.tenantId },
      'read',
    );
    t.equal(both.actor.identityId, ok.identityId, 'x-actor-id cannot override the session — it is not read');
  }

  {
    // A suspended TENANT is m01's gate, applied after the actor is proven.
    const suspendedTenant = await seedActor(ctx, 'ares_tnt_susp', { tenantStatus: 'suspended' });
    const refusal = await refusalOf(
      factory.forRequest(
        { [SESSION_HEADER]: suspendedTenant.accountId, 'x-tenant-id': suspendedTenant.tenantId },
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
      assurance: 'password',
    });
    t.equal(actor.isSystemActor, true, 'a system identity resolves as a SYSTEM actor');

    const scoped = await factory.forRequest(
      {
        [SESSION_HEADER]: system.accountId,
        'x-tenant-id': system.tenantId,
        'x-permissions': 'identity.registry.close,tenant.registry.approve',
      },
      'read',
    );
    t.deepEqual(
      scoped.scope === 'tenant' ? [...scoped.ctx.permissions] : ['x'],
      [],
      'and inherits NO human permissions however x-permissions is set — system context is not a human actor',
    );
  }

  // --- pooled connections do not leak context ------------------------------------------------------
  {
    const a = await seedActor(ctx, 'ares_leak_a');
    const b = await seedActor(ctx, 'ares_leak_b');
    for (let i = 0; i < 3; i += 1) {
      const actorA = await resolver.resolve({
        claimedAccountId: a.accountId,
        tenantId: a.tenantId,
        correlationId: randomUUID(),
        assurance: 'password',
      });
      const actorB = await resolver.resolve({
        claimedAccountId: b.accountId,
        tenantId: b.tenantId,
        correlationId: randomUUID(),
        assurance: 'password',
      });
      t.equal(actorA.membershipId, a.membershipId, `pass ${i}: tenant A resolves to A's membership`);
      t.equal(actorB.membershipId, b.membershipId, `pass ${i}: tenant B resolves to B's membership`);
    }
    const bleed = await refusalOf(
      resolver.resolve({
        claimedAccountId: a.accountId,
        tenantId: b.tenantId,
        correlationId: randomUUID(),
        assurance: 'password',
      }),
    );
    t.equal(bleed?.status, 401, 'after all that, A still cannot resolve into B — no GUC bled through');
  }
});
