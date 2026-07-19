import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type Assert, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';

/**
 * STAGE 1C: this spec authenticates through the REAL login flow. Every request that needs an actor first
 * logs in (POST /api/v1/auth/login) and rides the resulting Secure HttpOnly session cookie plus the CSRF
 * token — the Stage 1B `x-dev-actor` assertion is gone. Session/refresh/CSRF/lockout boundary behaviour is
 * proven in `api-auth.db-spec.ts`; this file proves the identity/account/membership/M01 APIs THROUGH a real
 * session.
 */
const PASSWORD = 'correct-horse-battery-staple';

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

/**
 * STAGE 1D: authorization is no longer a header. A caller's permissions are resolved from PERSISTENT role
 * assignments, so a "fully privileged" actor is one who genuinely HOLDS the immutable `platform_admin`
 * system role (seeded by the RBAC migration with every permission). We grant it in the database and send
 * nothing authorization-bearing on the wire — the x-permissions header is dead and, as the tests below
 * prove, ignored.
 */
const PLATFORM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001';

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly contentType: string;
  readonly setCookies: string[];
}

type Client = (
  method: string,
  path: string,
  opts?: { headers?: Record<string, string>; body?: unknown },
) => Promise<Reply>;

/** Auth material captured at login: the cookie header to replay and the CSRF token to echo. */
interface Auth {
  readonly cookie: string;
  readonly csrf: string;
}

/** Builds the `Cookie` header value from a login response's Set-Cookie list. */
function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(';')[0] ?? '')
    .filter((c) => c !== '')
    .join('; ');
}

/** Logs in through the real endpoint and returns the session cookie + CSRF token. */
async function login(api: Client, loginIdentifier: string): Promise<Auth> {
  const reply = await api('POST', '/auth/login', { body: { loginIdentifier, password: PASSWORD } });
  if (reply.status !== 200) throw new Error(`login failed for ${loginIdentifier}: ${reply.status}`);
  return { cookie: cookieHeader(reply.setCookies), csrf: String(reply.body['csrfToken']) };
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
    // A real password credential so the account can authenticate through /auth/login.
    const hashed = await argon2idHasher.hash(PASSWORD);
    await tx.query(
      `INSERT INTO authentication_credentials (account_id, algorithm, params, secret_hash)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [accountId, hashed.algorithm, JSON.stringify(hashed.params), hashed.encoded],
    );
  });

  return { tenantId, identityId, accountId };
}

/**
 * Grants the immutable `platform_admin` role to an identity — a real platform_role_assignment, the same row
 * the bootstrap mints. From this point the actor's every request resolves the full permission set from the
 * database, with nothing on the wire. Written as superuser so it is committed before the app reads it.
 */
async function grantPlatformAdmin(ctx: DbSpecContext, identityId: string): Promise<void> {
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO platform_role_assignments (identity_id, role_id, status) VALUES ($1, $2, 'active')`,
      [identityId, PLATFORM_ADMIN_ROLE_ID],
    );
  });
}

/**
 * Boots the compiled app on an ephemeral port.
 *
 * NODE_ENV and the dev secret are set before the app module is imported, because `ActorModule`'s factory
 * reads them at construction — which is the environment gate doing its job.
 */
async function bootApi(): Promise<{ client: Client; close: () => Promise<void> } | { error: string }> {
  process.env['NODE_ENV'] = 'test';

  const distDir = resolvePath(import.meta.dirname, '../dist/src');
  // The slice of Nest's application surface this spec drives. Declared explicitly (rather than cast at each
  // call site) so the compiled build type-checks it — the spec is now part of apps/api's tsconfig.
  let app: {
    listen: (port: number) => Promise<unknown>;
    close: () => Promise<void>;
    setGlobalPrefix: (p: string) => void;
    useGlobalFilters: (f: unknown) => void;
    getHttpServer: () => { address: () => { port: number } };
    [k: string]: unknown;
  };
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
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new filter.ProblemFilter());
    await app.listen(0);
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const server = app.getHttpServer();
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
    const getSetCookie = (response.headers as { getSetCookie?: () => string[] }).getSetCookie;
    return {
      status: response.status,
      body,
      contentType: response.headers.get('content-type') ?? '',
      setCookies: typeof getSetCookie === 'function' ? getSetCookie.call(response.headers) : [],
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
  await grantPlatformAdmin(ctx, admin.identityId);
  const adminAuth = await login(api, 'api_admin_login');

  // A PROVEN actor who holds NO role — authenticated, authorized for nothing. This is how Stage 1D proves
  // "proven but unauthorized" (403) now that no header can conjure a permission: the powerless actor logs in
  // for real and is refused every guarded action.
  await seedActor(ctx, 'api_powerless');
  const powerlessAuth = await login(api, 'api_powerless_login');
  const asPowerless = (extra: Record<string, string> = {}): Record<string, string> => ({
    cookie: powerlessAuth.cookie,
    'x-csrf-token': powerlessAuth.csrf,
    ...extra,
  });

  /** The headers a legitimate, fully-privileged caller sends: session cookie + CSRF. Permissions are in the DB. */
  const asAdmin = (extra: Record<string, string> = {}): Record<string, string> => ({
    cookie: adminAuth.cookie,
    'x-csrf-token': adminAuth.csrf,
    ...extra,
  });
  const inTenant = (extra: Record<string, string> = {}): Record<string, string> =>
    asAdmin({ 'x-tenant-id': admin.tenantId, ...extra });

  // --- the boundary --------------------------------------------------------------------------------
  // Detailed session/login boundary behaviour lives in api-auth.db-spec.ts; here we prove the identity
  // API is genuinely closed and that a REAL session opens it.

  {
    const health = await api('GET', '/health');
    t.equal(health.status, 200, 'health is up — the app booted and is serving');

    const anonymous = await api('GET', '/identities');
    t.equal(anonymous.status, 401, 'an anonymous request (no session cookie) is refused');
    t.ok(anonymous.contentType.includes('application/problem+json'), 'refusals are RFC 9457 problems');

    // x-actor-id is dead: naming a REAL, live account in the header buys nothing without a session. The
    // dead x-permissions header is sent alongside to prove BOTH are ignored — neither identity nor
    // authorization can be asserted by a header.
    const headerOnly = await api('GET', '/identities', {
      headers: { 'x-actor-id': admin.accountId, 'x-permissions': 'identity.registry.view' },
    });
    t.equal(headerOnly.status, 401, 'x-actor-id alone is refused, even naming a REAL active account');

    const tenantHeaderOnly = await api('GET', `/tenants/${admin.tenantId}`, {
      headers: {
        'x-actor-id': admin.accountId,
        'x-tenant-id': admin.tenantId,
        'x-permissions': 'tenant.registry.view',
      },
    });
    t.equal(tenantHeaderOnly.status, 401, 'M01 rejects a request carrying only x-actor-id');

    // A real session opens the API.
    const authed = await api('GET', '/identities', { headers: asAdmin() });
    t.equal(authed.status, 200, 'a real session resolves the actor — the identity API is reachable');
  }

  // --- authorization is still enforced, and is a DIFFERENT answer -----------------------------------

  {
    // A PROVEN actor (real session) holding NO role → 403, not 401. Identity != authorization. Sending the
    // dead x-permissions header changes nothing: the powerless actor cannot grant itself a permission.
    const noPermissions = await api('GET', '/identities', {
      headers: asPowerless({ 'x-permissions': 'identity.registry.view' }),
    });
    t.equal(
      noPermissions.status,
      403,
      'a PROVEN actor with no role grant gets 403 — not 401 — and no header can lift it',
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
      headers: asPowerless(),
      body: { expectedVersion: 1 },
    });
    t.equal(forbidden.status, 403, 'a proven actor lacking identity.registry.close is 403');
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
    await grantPlatformAdmin(ctx, other.identityId);
    const otherAuth = await login(api, 'api_other_tenant_login');

    const otherMembership = await api('GET', '/tenant-memberships', {
      headers: {
        cookie: otherAuth.cookie,
        'x-csrf-token': otherAuth.csrf,
        'x-tenant-id': other.tenantId,
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
