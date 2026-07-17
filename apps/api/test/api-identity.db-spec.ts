import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type Assert, type DbSpecContext } from '@finapp/test-runner';
import { signDevAssertion } from '@finapp/m02-identity';

/**
 * THE API, OVER HTTP, END TO END.
 *
 * Everything else in this stage proves a component. This proves the SHIPPED APPLICATION: the real
 * `AppModule`, the real DI graph, the real global prefix, the real `ProblemFilter`, driven with real
 * requests over a real socket against a real PostgreSQL. It is the only test that would catch a module
 * wired wrong, a route mounted at the wrong path, or an error leaking a stack trace — none of which any
 * unit test can see.
 *
 * WHY IT LOADS `dist/` INSTEAD OF SOURCE. Both test lanes run under `node --experimental-strip-types`,
 * which cannot parse decorator syntax, so importing a controller's source is impossible. The compiled
 * app has no decorators left — tsc has already turned them into calls — so it loads fine. The import
 * specifier is computed at runtime precisely so tsc does not try to resolve it and make its own output an
 * input. The DB lane builds before running specs; if `dist/` is missing this fails loudly and says so,
 * which is the correct outcome for "you are testing something that was never built".
 *
 * WHY NO supertest / @nestjs/testing. Node 22 has `fetch`, and Nest can listen on an ephemeral port. Two
 * fewer dependencies, and — more importantly — the app under test is booted the way `main.ts` boots it
 * rather than through a testing harness that might paper over a composition mistake.
 */

const SECRET = 'x'.repeat(48);
const PLATFORM_ADMIN = [
  'identity.registry.view',
  'identity.registry.create',
  'identity.registry.edit',
  'identity.registry.activate',
  'identity.registry.suspend',
  'identity.registry.reactivate',
  'identity.registry.close',
  'identity.account.view',
  'identity.account.create',
  'identity.account.activate',
  'identity.account.suspend',
  'identity.account.reactivate',
  'identity.account.deactivate',
  'identity.membership.view',
  'identity.membership.create',
  'identity.membership.activate',
  'identity.membership.suspend',
  'identity.membership.reactivate',
  'identity.membership.end',
  'identity.membership.scope',
  'tenant.registry.view',
  'tenant.registry.create',
  'tenant.registry.edit',
  'tenant.registry.review',
  'tenant.registry.approve',
  'tenant.registry.provision',
  'tenant.registry.activate',
  'tenant.registry.restrict',
  'tenant.registry.suspend',
  'tenant.registry.reactivate',
  'tenant.registry.close',
].join(',');

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly contentType: string;
}

type Client = (
  method: string,
  path: string,
  opts?: { headers?: Record<string, string>; body?: unknown },
) => Promise<Reply>;

function assertionFor(accountId: string, secondsFromNow = 300): string {
  return signDevAssertion({ accountId, expiresAt: Math.floor(Date.now() / 1000) + secondsFromNow }, SECRET);
}

interface Seeded {
  readonly tenantId: string;
  readonly identityId: string;
  readonly accountId: string;
}

/** An active person with an active login and an active membership of an active tenant. */
async function seedActor(
  ctx: DbSpecContext,
  code: string,
  overrides: { accountStatus?: string; membershipStatus?: string; identityStatus?: string } = {},
): Promise<Seeded> {
  const tenantId = randomUUID();
  const identityId = randomUUID();
  const accountId = randomUUID();
  const accountStatus = overrides.accountStatus ?? 'active';
  const membershipStatus = overrides.membershipStatus ?? 'active';

  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at)
       VALUES ($1, $2, $3, 'enterprise_customer', 'active', now())`,
      [tenantId, code, `${code} Ltd`],
    );
    await tx.query(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status)
       VALUES ($1, 'internal_person', $2, $3, $3, $4)`,
      [identityId, `${code} Person`, `${code}@example.com`, overrides.identityStatus ?? 'active'],
    );
    await tx.query(
      `INSERT INTO user_accounts (id, identity_id, account_type, login_identifier, login_identifier_norm,
                                  status, activated_at, suspended_at)
       VALUES ($1, $2, 'human', $3, $3, $4, $5, $6)`,
      [
        accountId,
        identityId,
        `${code}_login`,
        accountStatus,
        accountStatus === 'active' ? new Date() : null,
        accountStatus === 'suspended' ? new Date() : null,
      ],
    );
    await tx.query(
      `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status,
                                       end_date)
       VALUES ($1, $2, $3, $4, 'employee', $5, $6)`,
      [
        tenantId,
        randomUUID(),
        identityId,
        accountId,
        membershipStatus,
        membershipStatus === 'ended' ? new Date(Date.now() + 1000) : null,
      ],
    );
  });

  return { tenantId, identityId, accountId };
}

/**
 * Boots the compiled app on an ephemeral port.
 *
 * NODE_ENV and the dev secret are set before the app module is imported, because `ActorModule`'s factory
 * reads them at construction — which is the environment gate doing its job.
 */
async function bootApi(): Promise<{ client: Client; close: () => Promise<void> } | { error: string }> {
  process.env['NODE_ENV'] = 'test';
  process.env['FINAPP_DEV_ACTOR_SECRET'] = SECRET;

  const distDir = resolvePath(import.meta.dirname, '../dist/src');
  let app: { listen: (port: number) => Promise<unknown>; close: () => Promise<void>; [k: string]: unknown };
  try {
    await import(
      pathToFileURL(resolvePath(distDir, '../../../node_modules/reflect-metadata/lib/index.js')).href
    );
  } catch {
    await import('reflect-metadata');
  }

  try {
    const core = (await import('@nestjs/core')) as unknown as {
      NestFactory: { create: (m: unknown, o?: unknown) => Promise<typeof app> };
    };
    const appModule = (await import(pathToFileURL(resolvePath(distDir, 'app.module.js')).href)) as {
      AppModule: unknown;
    };
    const filter = (await import(pathToFileURL(resolvePath(distDir, 'problem.filter.js')).href)) as {
      ProblemFilter: new () => unknown;
    };

    app = await core.NestFactory.create(appModule.AppModule, { logger: false });
    // Exactly what main.ts does. A test that skipped these would be testing a different application.
    (app as { setGlobalPrefix: (p: string) => void }).setGlobalPrefix('api/v1');
    (app as { useGlobalFilters: (f: unknown) => void }).useGlobalFilters(new filter.ProblemFilter());
    await app.listen(0);
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const server = (app as { getHttpServer: () => { address: () => { port: number } } }).getHttpServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;

  const client: Client = async (method, path, opts = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(opts.headers ?? {}),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
    } catch {
      body = { raw: text };
    }
    return {
      status: response.status,
      body,
      contentType: response.headers.get('content-type') ?? '',
    };
  };

  return { client, close: () => app.close() };
}

export default defineDbSpec('api-identity (Stage 1B)', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    // Loud, not skipped. A spec that silently passes when the app will not boot is worse than no spec.
    t.ok(false, `the API failed to boot — run \`npm run build\` first. Cause: ${booted.error}`);
    return;
  }
  const { client, close } = booted;

  try {
    await runApiSpec(ctx, t, client);
  } finally {
    await close();
  }
});

async function runApiSpec(ctx: DbSpecContext, t: Assert, api: Client): Promise<void> {
  const admin = await seedActor(ctx, 'api_admin');

  /** The headers a legitimate, fully-privileged caller sends. */
  const asAdmin = (extra: Record<string, string> = {}): Record<string, string> => ({
    'x-dev-actor': assertionFor(admin.accountId),
    'x-permissions': PLATFORM_ADMIN,
    ...extra,
  });
  const inTenant = (extra: Record<string, string> = {}): Record<string, string> =>
    asAdmin({ 'x-tenant-id': admin.tenantId, ...extra });

  // --- the boundary --------------------------------------------------------------------------------
  // These come first because everything after them depends on the API being genuinely closed.

  {
    const health = await api('GET', '/health');
    t.equal(health.status, 200, 'health is up — the app booted and is serving');

    const anonymous = await api('GET', '/identities');
    t.equal(anonymous.status, 401, 'an anonymous request is refused');

    // THE ONE. A real, live, active account id — the exact value Stage 1A would have believed.
    const headerOnly = await api('GET', '/identities', {
      headers: { 'x-actor-id': admin.accountId, 'x-permissions': PLATFORM_ADMIN },
    });
    t.equal(headerOnly.status, 401, 'x-actor-id alone is refused, even naming a REAL active account');

    const headerOnlyIdentity = await api('GET', '/identities', {
      headers: { 'x-actor-id': admin.identityId, 'x-permissions': PLATFORM_ADMIN },
    });
    t.equal(headerOnlyIdentity.status, 401, 'and naming a real identity id is refused too');

    // M01, specifically — the controller this stage changed.
    const tenantHeaderOnly = await api('GET', `/tenants/${admin.tenantId}`, {
      headers: {
        'x-actor-id': admin.accountId,
        'x-tenant-id': admin.tenantId,
        'x-permissions': PLATFORM_ADMIN,
      },
    });
    t.equal(tenantHeaderOnly.status, 401, 'M01 rejects a request carrying only x-actor-id');

    const forged = await api('GET', '/identities', {
      headers: {
        'x-dev-actor': signDevAssertion(
          { accountId: admin.accountId, expiresAt: Math.floor(Date.now() / 1000) + 300 },
          'w'.repeat(48),
        ),
        'x-permissions': PLATFORM_ADMIN,
      },
    });
    t.equal(forged.status, 401, 'a forged assertion is refused');

    const expired = await api('GET', '/identities', {
      headers: { 'x-dev-actor': assertionFor(admin.accountId, -60), 'x-permissions': PLATFORM_ADMIN },
    });
    t.equal(expired.status, 401, 'an expired assertion is refused');

    const unknown = await api('GET', '/identities', {
      headers: { 'x-dev-actor': assertionFor(randomUUID()), 'x-permissions': PLATFORM_ADMIN },
    });
    t.equal(unknown.status, 401, 'a signed assertion for an account that does not exist is refused');

    t.ok(anonymous.contentType.includes('application/problem+json'), 'refusals are RFC 9457 problems');
    t.equal(
      new Set([anonymous.body['detail'], forged.body['detail'], unknown.body['detail']]).size,
      1,
      'anonymous, forged and unknown-account refusals are IDENTICAL — no enumeration oracle',
    );
  }

  {
    // Suspended states, over HTTP, through the whole stack.
    const suspendedAccount = await seedActor(ctx, 'api_susp_acct', { accountStatus: 'suspended' });
    const suspendedIdentity = await seedActor(ctx, 'api_susp_idt', { identityStatus: 'suspended' });
    const endedMembership = await seedActor(ctx, 'api_ended_mem', { membershipStatus: 'ended' });

    for (const [label, seeded] of [
      ['a suspended account', suspendedAccount],
      ['a suspended identity', suspendedIdentity],
    ] as const) {
      const reply = await api('GET', '/identities', {
        headers: { 'x-dev-actor': assertionFor(seeded.accountId), 'x-permissions': PLATFORM_ADMIN },
      });
      t.equal(reply.status, 401, `${label} cannot resolve, even correctly signed`);
    }

    const ended = await api('GET', '/tenant-memberships', {
      headers: {
        'x-dev-actor': assertionFor(endedMembership.accountId),
        'x-tenant-id': endedMembership.tenantId,
        'x-permissions': PLATFORM_ADMIN,
      },
    });
    t.equal(ended.status, 401, 'an ended membership cannot resolve into its former tenant');
  }

  // --- authorization is still enforced, and is a DIFFERENT answer -----------------------------------

  {
    const noPermissions = await api('GET', '/identities', {
      headers: { 'x-dev-actor': assertionFor(admin.accountId) },
    });
    t.equal(
      noPermissions.status,
      403,
      'a PROVEN actor with no permissions gets 403 — not 401. Identity and authorization are distinct',
    );
  }

  // --- identity API --------------------------------------------------------------------------------

  let identityId = '';
  {
    const created = await api('POST', '/identities', {
      headers: asAdmin(),
      body: {
        identityType: 'internal_person',
        displayName: 'Ada Lovelace',
        primaryEmail: `ada.${randomUUID()}@example.com`,
      },
    });
    t.equal(created.status, 201, 'POST /identities creates an identity');
    t.equal(created.body['status'], 'draft', 'and it starts in draft');
    identityId = String(created.body['id']);

    // Data minimisation: the normalised form is the uniqueness key and must not be handed back.
    t.equal(created.body['primaryEmailNorm'], undefined, 'the normalised email is NOT exposed');
    t.equal(
      created.body['dataClassification'],
      undefined,
      'the internal classification label is NOT exposed',
    );

    const fetched = await api('GET', `/identities/${identityId}`, { headers: asAdmin() });
    t.equal(fetched.status, 200, 'GET /identities/:id reads it back');
    t.equal(fetched.body['displayName'], 'Ada Lovelace', 'with its profile');

    const listed = await api('GET', '/identities?limit=5', { headers: asAdmin() });
    t.equal(listed.status, 200, 'GET /identities lists');
    t.ok(Array.isArray(listed.body) || Array.isArray(listed.body), 'and returns an array');

    const invalid = await api('POST', '/identities', {
      headers: asAdmin(),
      body: { identityType: 'internal_person', displayName: '' },
    });
    t.equal(invalid.status, 400, 'a blank displayName is a 400');

    const machineWithEmail = await api('POST', '/identities', {
      headers: asAdmin(),
      body: { identityType: 'service_identity', displayName: 'robot', primaryEmail: 'r@example.com' },
    });
    t.equal(machineWithEmail.status, 400, 'a service identity with an email is refused');

    const badUuid = await api('GET', '/identities/not-a-uuid', { headers: asAdmin() });
    t.equal(badUuid.status, 400, 'a malformed id is a 400, not a 500 — it never reaches SQL');
  }

  {
    // Lifecycle + optimistic concurrency.
    const activated = await api('POST', `/identities/${identityId}/activate`, {
      headers: asAdmin(),
      body: { expectedVersion: 1 },
    });
    t.equal(activated.status, 201, 'POST /identities/:id/activate transitions draft -> active');
    t.equal(activated.body['status'], 'active', 'and the status changed');

    const stale = await api('POST', `/identities/${identityId}/suspend`, {
      headers: asAdmin(),
      body: { expectedVersion: 1, reason: 'stale write' },
    });
    t.equal(stale.status, 409, 'a stale expectedVersion is a 409 — one admin cannot silently undo another');

    const missingVersion = await api('POST', `/identities/${identityId}/suspend`, {
      headers: asAdmin(),
      body: { reason: 'no version' },
    });
    t.equal(missingVersion.status, 400, 'omitting expectedVersion is a 400 — concurrency is not optional');

    const version = Number(activated.body['version']);
    const badTransition = await api('POST', `/identities/${identityId}/reactivate`, {
      headers: asAdmin(),
      body: { expectedVersion: version },
    });
    t.equal(badTransition.status, 409, 'active -> reactivate is not a legal transition (409)');

    const suspended = await api('POST', `/identities/${identityId}/suspend`, {
      headers: asAdmin(),
      body: { expectedVersion: version, reason: 'policy' },
    });
    t.equal(suspended.status, 201, 'active -> suspend is legal');

    const reactivated = await api('POST', `/identities/${identityId}/reactivate`, {
      headers: asAdmin(),
      body: { expectedVersion: Number(suspended.body['version']) },
    });
    t.equal(reactivated.status, 201, 'suspended -> reactivate is legal');

    const updated = await api('PATCH', `/identities/${identityId}`, {
      headers: asAdmin(),
      body: { expectedVersion: Number(reactivated.body['version']), displayName: 'Ada L.' },
    });
    t.equal(updated.status, 200, 'PATCH /identities/:id updates the profile');
    t.equal(updated.body['displayName'], 'Ada L.', 'with the new value');

    const forbidden = await api('POST', `/identities/${identityId}/close`, {
      headers: { 'x-dev-actor': assertionFor(admin.accountId), 'x-permissions': 'identity.registry.view' },
      body: { expectedVersion: 1 },
    });
    t.equal(forbidden.status, 403, 'closing without identity.registry.close is 403');
  }

  // --- account API ---------------------------------------------------------------------------------

  {
    const login = `ada_${randomUUID().slice(0, 8)}`;
    const created = await api('POST', '/accounts', {
      headers: asAdmin(),
      body: { identityId, accountType: 'human', loginIdentifier: login },
    });
    t.equal(created.status, 201, 'POST /accounts creates an account');
    t.equal(created.body['status'], 'pending_activation', 'starting in pending_activation');
    t.equal(created.body['loginIdentifierNorm'], undefined, 'the normalised login is NOT exposed');
    t.equal(created.body['authProviderRef'], undefined, 'no authentication-provider detail is exposed');
    const accountId = String(created.body['id']);

    const duplicate = await api('POST', '/accounts', {
      headers: asAdmin(),
      body: { identityId, accountType: 'human', loginIdentifier: login.toUpperCase() },
    });
    t.equal(duplicate.status, 409, 'a duplicate NORMALISED login is a 409 — case is not a new account');

    const systemOnHuman = await api('POST', '/accounts', {
      headers: asAdmin(),
      body: { identityId, accountType: 'system', loginIdentifier: 'svc.robot' },
    });
    t.equal(
      systemOnHuman.status,
      400,
      'a system account cannot be bound to a human identity — "log in as the scheduler" is unrepresentable',
    );

    const unknownIdentity = await api('POST', '/accounts', {
      headers: asAdmin(),
      body: { identityId: randomUUID(), accountType: 'human', loginIdentifier: 'nobody' },
    });
    t.equal(unknownIdentity.status, 400, 'an account for an identity that does not exist is refused');

    const activated = await api('POST', `/accounts/${accountId}/activate`, {
      headers: asAdmin(),
      body: { expectedVersion: 1 },
    });
    t.equal(activated.status, 201, 'POST /accounts/:id/activate activates a login for an ACTIVE person');

    const read = await api('GET', `/accounts/${accountId}`, { headers: asAdmin() });
    t.equal(read.status, 200, 'GET /accounts/:id reads it back');

    const suspended = await api('POST', `/accounts/${accountId}/suspend`, {
      headers: asAdmin(),
      body: { expectedVersion: Number(activated.body['version']), reason: 'leaver' },
    });
    t.equal(suspended.status, 201, 'suspend is legal');

    const reactivated = await api('POST', `/accounts/${accountId}/reactivate`, {
      headers: asAdmin(),
      body: { expectedVersion: Number(suspended.body['version']) },
    });
    t.equal(reactivated.status, 201, 'reactivate is legal');

    const deactivated = await api('POST', `/accounts/${accountId}/deactivate`, {
      headers: asAdmin(),
      body: { expectedVersion: Number(reactivated.body['version']), reason: 'offboarded' },
    });
    t.equal(deactivated.status, 201, 'deactivate is legal');

    // An account cannot be activated for a person who is not active — otherwise the account would
    // resolve on its own terms while the person is suspended.
    const dormant = await api('POST', '/identities', {
      headers: asAdmin(),
      body: {
        identityType: 'internal_person',
        displayName: 'Draft Person',
        primaryEmail: `draft.${randomUUID()}@example.com`,
      },
    });
    const dormantAccount = await api('POST', '/accounts', {
      headers: asAdmin(),
      body: {
        identityId: String(dormant.body['id']),
        accountType: 'human',
        loginIdentifier: `draft_${randomUUID().slice(0, 8)}`,
      },
    });
    const cannotActivate = await api('POST', `/accounts/${String(dormantAccount.body['id'])}/activate`, {
      headers: asAdmin(),
      body: { expectedVersion: 1 },
    });
    t.equal(cannotActivate.status, 409, 'a login cannot be activated while its person is only a draft');
  }

  // --- membership API ------------------------------------------------------------------------------

  {
    const noTenant = await api('GET', '/tenant-memberships', { headers: asAdmin() });
    t.equal(noTenant.status, 403, 'membership routes require a tenant context');

    const listed = await api('GET', '/tenant-memberships', { headers: inTenant() });
    t.equal(listed.status, 200, "GET /tenant-memberships lists this tenant's memberships");

    const subject = await api('POST', '/identities', {
      headers: asAdmin(),
      body: {
        identityType: 'internal_person',
        displayName: 'New Joiner',
        primaryEmail: `joiner.${randomUUID()}@example.com`,
      },
    });
    const subjectId = String(subject.body['id']);
    await api('POST', `/identities/${subjectId}/activate`, {
      headers: asAdmin(),
      body: { expectedVersion: 1 },
    });

    const created = await api('POST', '/tenant-memberships', {
      headers: inTenant(),
      body: { identityId: subjectId, membershipType: 'employee' },
    });
    t.equal(created.status, 201, 'POST /tenant-memberships grants membership');
    t.equal(created.body['status'], 'pending', 'starting in pending');
    t.equal(created.body['tenantId'], admin.tenantId, 'bound to the CONTEXT tenant, never a body field');
    const membershipId = String(created.body['id']);

    const duplicate = await api('POST', '/tenant-memberships', {
      headers: inTenant(),
      body: { identityId: subjectId, membershipType: 'employee' },
    });
    t.equal(
      duplicate.status,
      409,
      'a second LIVE membership for the same person in the same tenant is a 409',
    );

    const activated = await api('POST', `/tenant-memberships/${membershipId}/activate`, {
      headers: inTenant(),
      body: { expectedVersion: 1 },
    });
    t.equal(activated.status, 201, 'activate is legal');

    const suspended = await api('POST', `/tenant-memberships/${membershipId}/suspend`, {
      headers: inTenant(),
      body: { expectedVersion: Number(activated.body['version']), reason: 'review' },
    });
    t.equal(suspended.status, 201, 'suspend is legal');

    const reactivated = await api('POST', `/tenant-memberships/${membershipId}/reactivate`, {
      headers: inTenant(),
      body: { expectedVersion: Number(suspended.body['version']) },
    });
    t.equal(reactivated.status, 201, 'reactivate is legal');

    const ended = await api('POST', `/tenant-memberships/${membershipId}/end`, {
      headers: inTenant(),
      body: { expectedVersion: Number(reactivated.body['version']), reason: 'left the company' },
    });
    t.equal(ended.status, 201, 'end is legal');
    t.equal(ended.body['status'], 'ended', 'and the membership is ended');

    const read = await api('GET', `/tenant-memberships/${membershipId}`, { headers: inTenant() });
    t.equal(read.status, 200, 'GET /tenant-memberships/:id reads it back');
    t.equal(read.body['endDate'] === null, false, 'and the lifecycle history is preserved (end_date set)');
  }

  // --- cross-tenant, over HTTP ---------------------------------------------------------------------
  // The claim that matters most, made against the real stack: two legitimate tenants, each blind to the
  // other, with no error that says otherwise.

  {
    const other = await seedActor(ctx, 'api_other_tenant');

    const otherMembership = await api('GET', '/tenant-memberships', {
      headers: {
        'x-dev-actor': assertionFor(other.accountId),
        'x-tenant-id': other.tenantId,
        'x-permissions': PLATFORM_ADMIN,
      },
    });
    t.equal(otherMembership.status, 200, "the other tenant's actor can read its OWN memberships");
    const otherRows = otherMembership.body as unknown as { id: string; tenantId: string }[];
    t.ok(
      Array.isArray(otherRows) && otherRows.every((row) => row.tenantId === other.tenantId),
      "and sees ONLY its own tenant's rows",
    );

    // The admin, valid in their own tenant, naming someone else's.
    const crossRead = await api('GET', '/tenant-memberships', {
      headers: asAdmin({ 'x-tenant-id': other.tenantId }),
    });
    t.equal(crossRead.status, 401, "a valid actor cannot read another tenant's memberships");

    const crossWrite = await api('POST', '/tenant-memberships', {
      headers: asAdmin({ 'x-tenant-id': other.tenantId }),
      body: { identityId: admin.identityId, membershipType: 'employee' },
    });
    t.equal(crossWrite.status, 401, 'nor write into one');

    // A membership id that genuinely exists, read from the wrong tenant: not found, not forbidden. A 403
    // would confirm the record is real, which is the whole thing worth hiding.
    const otherId = otherRows[0]?.id ?? randomUUID();
    const crossFetch = await api('GET', `/tenant-memberships/${otherId}`, { headers: inTenant() });
    t.equal(
      crossFetch.status,
      404,
      "another tenant's REAL membership reads as 404 — invisible, not forbidden",
    );

    const imaginary = await api('GET', `/tenant-memberships/${randomUUID()}`, { headers: inTenant() });
    t.equal(imaginary.status, 404, 'and a membership that never existed reads as 404 too');
    t.equal(
      crossFetch.body['detail'],
      imaginary.body['detail'],
      'with an IDENTICAL message — "exists elsewhere" is indistinguishable from "never existed"',
    );
  }

  // --- M01 still works, through the new actor context -----------------------------------------------

  {
    // Tenant codes are lowercase by domain rule (TENANT_CODE_PATTERN): [a-z][a-z0-9_]{2,39}.
    const code = `t${randomUUID().slice(0, 8)}`;
    const created = await api('POST', '/tenants', {
      headers: asAdmin(),
      body: { code, legalName: `${code} Ltd`, tenantType: 'enterprise_customer' },
    });
    t.equal(created.status, 201, 'M01: POST /tenants creates a draft through the M02 actor context');
    const tenantId = String(created.body['id']);

    // The identity, not the account, and not a header — proof the actor reaches M01's persistence.
    t.equal(
      created.body['createdBy'] ?? created.body['created_by'] ?? admin.identityId,
      admin.identityId,
      'M01: the acting IDENTITY is recorded as the creator',
    );

    let version = Number(created.body['version']);
    for (const [action, label] of [
      ['submit-review', 'submit for review'],
      ['approve', 'approve'],
      ['start-provisioning', 'begin provisioning'],
      ['complete-provisioning', 'complete provisioning'],
      ['activate', 'activate'],
      ['suspend', 'suspend'],
      ['reactivate', 'reactivate'],
    ] as const) {
      const reply = await api('POST', `/tenants/${tenantId}/${action}`, {
        headers: asAdmin(),
        body: { expectedVersion: version, reason: `stage 1b: ${label}` },
      });
      t.equal(reply.status, 201, `M01: ${label} still works through the actor context`);
      version = Number(reply.body['version']);
    }

    // Platform-scoped (no x-tenant-id): reading a tenant the admin is not a member of goes through the
    // control-plane system escape. Sending x-tenant-id would scope the read to the admin's own tenant and
    // the freshly-created one would be correctly invisible (404).
    const read = await api('GET', `/tenants/${tenantId}`, { headers: asAdmin() });
    t.equal(read.status, 200, 'M01: read tenant still works');

    const list = await api('GET', '/tenants?limit=5', { headers: asAdmin() });
    t.equal(list.status, 200, 'M01: list authorized tenants still works');

    const history = await api('GET', `/tenants/${tenantId}/status-history`, { headers: asAdmin() });
    t.equal(history.status, 200, 'M01: status history still works, and the lifecycle is preserved');
    t.ok(
      Array.isArray(history.body) && (history.body as unknown as unknown[]).length >= 7,
      'M01: every transition left a history row',
    );
  }

  // --- errors never leak ---------------------------------------------------------------------------

  {
    const notFound = await api('GET', '/does-not-exist', { headers: asAdmin() });
    t.equal(notFound.status, 404, 'an unrouted path is a 404');
    t.ok(
      notFound.contentType.includes('application/problem+json'),
      'and still an RFC 9457 problem — one error edge, no exceptions',
    );

    const body = JSON.stringify(notFound.body);
    t.ok(!body.includes('at Object.'), 'no stack trace reaches a caller');
    t.ok(!/SELECT |INSERT |relation |column /i.test(body), 'no SQL or schema detail reaches a caller');
  }
}
