import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type Assert, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';

/**
 * AUTHENTICATION & SESSIONS, OVER HTTP, END TO END (Stage 1C).
 *
 * Boots the real `AppModule` and drives `/api/v1/auth` with real requests: login sets Secure HttpOnly
 * cookies, a session-backed actor reaches the identity API, CSRF guards state-changing requests, refresh
 * rotates with reuse detection, logout revokes, and lockout is durable. No response carries a secret.
 */

const PASSWORD = 'correct-horse-battery-staple';

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly rawBody: string;
  readonly setCookies: string[];
  readonly contentType: string;
}
type Client = (
  method: string,
  path: string,
  opts?: { headers?: Record<string, string>; body?: unknown },
) => Promise<Reply>;

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(';')[0] ?? '')
    .filter((c) => c !== '')
    .join('; ');
}

async function seedAccount(
  ctx: DbSpecContext,
  code: string,
  overrides: { accountStatus?: string; withCredential?: boolean } = {},
): Promise<{ accountId: string; identityId: string }> {
  const identityId = randomUUID();
  const accountId = randomUUID();
  const accountStatus = overrides.accountStatus ?? 'active';
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status)
       VALUES ($1, 'internal_person', $2, $3, $3, 'active')`,
      [identityId, `${code} P`, `${code}@example.com`],
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
    if (overrides.withCredential !== false) {
      const hashed = await argon2idHasher.hash(PASSWORD);
      await tx.query(
        `INSERT INTO authentication_credentials (account_id, algorithm, params, secret_hash)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [accountId, hashed.algorithm, JSON.stringify(hashed.params), hashed.encoded],
      );
    }
  });
  return { accountId, identityId };
}

async function bootApi(): Promise<{ client: Client; close: () => Promise<void> } | { error: string }> {
  process.env['NODE_ENV'] = 'test';
  const distDir = resolvePath(import.meta.dirname, '../dist/src');
  let app: {
    listen: (p: number) => Promise<unknown>;
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
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new filter.ProblemFilter());
    await app.listen(0);
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const port = app.getHttpServer().address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;
  const client: Client = async (method, path, opts = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const rawBody = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = rawBody === '' ? {} : (JSON.parse(rawBody) as Record<string, unknown>);
    } catch {
      body = {};
    }
    const getSetCookie = (response.headers as { getSetCookie?: () => string[] }).getSetCookie;
    return {
      status: response.status,
      body,
      rawBody,
      setCookies: typeof getSetCookie === 'function' ? getSetCookie.call(response.headers) : [],
      contentType: response.headers.get('content-type') ?? '',
    };
  };
  return { client, close: () => app.close() };
}

export default defineDbSpec('api-auth (Stage 1C)', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot — run \`npm run build\` first. Cause: ${booted.error}`);
    return;
  }
  const { client: api, close } = booted;
  try {
    await run(ctx, t, api);
  } finally {
    await close();
  }
});

async function run(ctx: DbSpecContext, t: Assert, api: Client): Promise<void> {
  await seedAccount(ctx, 'apiauth_admin');

  // --- login: cookies, attributes, no secrets -----------------------------------------------------
  const loginReply = await api('POST', '/auth/login', {
    body: { loginIdentifier: 'apiauth_admin_login', password: PASSWORD },
  });
  t.equal(loginReply.status, 200, 'a correct password logs in');
  const cookies = loginReply.setCookies;
  const sessionCookie = cookies.find((c) => c.startsWith('finapp_session='));
  const refreshCookie = cookies.find((c) => c.startsWith('finapp_refresh='));
  const csrfCookie = cookies.find((c) => c.startsWith('finapp_csrf='));
  t.ok(sessionCookie !== undefined, 'a session cookie is set');
  t.ok(/HttpOnly/i.test(sessionCookie ?? ''), 'the session cookie is HttpOnly (JS cannot read it)');
  t.ok(/Secure/i.test(sessionCookie ?? ''), 'and Secure');
  t.ok(/SameSite=Lax/i.test(sessionCookie ?? ''), 'and SameSite=Lax');
  t.ok(/HttpOnly/i.test(refreshCookie ?? ''), 'the refresh cookie is HttpOnly');
  t.ok(
    /Path=\/api\/v1\/auth\/session\/refresh/i.test(refreshCookie ?? ''),
    'and path-scoped to the refresh route',
  );
  t.ok(
    !/HttpOnly/i.test(csrfCookie ?? ''),
    'the CSRF cookie is NOT HttpOnly (the app must read it to echo it)',
  );
  t.ok(!loginReply.rawBody.includes(PASSWORD), 'the login response does not echo the password');
  t.ok(!/[a-f0-9]{64}/.test(loginReply.rawBody), 'and the response body carries no token hash');

  const cookie = cookieHeader(cookies);
  const csrf = String(loginReply.body['csrfToken']);
  const authed = (extra: Record<string, string> = {}): Record<string, string> => ({
    cookie,
    'x-csrf-token': csrf,
    ...extra,
  });

  // --- enumeration resistance ---------------------------------------------------------------------
  const wrong = await api('POST', '/auth/login', {
    body: { loginIdentifier: 'apiauth_admin_login', password: 'wrong-password-x' },
  });
  const unknown = await api('POST', '/auth/login', {
    body: { loginIdentifier: 'ghost_login', password: PASSWORD },
  });
  t.equal(wrong.status, 401, 'a wrong password is 401');
  t.equal(unknown.status, 401, 'an unknown identifier is 401');
  t.equal(wrong.body['detail'], unknown.body['detail'], 'and the two are IDENTICAL — no enumeration oracle');

  await seedAccount(ctx, 'apiauth_susp', { accountStatus: 'suspended' });
  const suspended = await api('POST', '/auth/login', {
    body: { loginIdentifier: 'apiauth_susp_login', password: PASSWORD },
  });
  t.equal(suspended.status, 401, 'a suspended account cannot log in');

  // --- session-backed actor reaches the identity API ----------------------------------------------
  const anon = await api('GET', '/identities');
  t.equal(anon.status, 401, 'no session cookie → 401');
  const withSession = await api('GET', '/identities', {
    headers: authed({ 'x-permissions': 'identity.registry.view' }),
  });
  t.equal(withSession.status, 200, 'a real session resolves the actor and reaches the identity API');

  // x-actor-id / x-dev-actor are dead: they cannot stand in for a session.
  const actorId = await api('GET', '/identities', {
    headers: { 'x-actor-id': randomUUID(), 'x-permissions': 'identity.registry.view' },
  });
  t.equal(actorId.status, 401, 'x-actor-id alone is refused');
  const devActor = await api('GET', '/identities', {
    headers: { 'x-dev-actor': 'anything', 'x-permissions': 'identity.registry.view' },
  });
  t.equal(devActor.status, 401, 'x-dev-actor is refused — the dev adapter is gone');

  // --- current session + listing carry no secrets -------------------------------------------------
  const session = await api('GET', '/auth/session', { headers: authed() });
  t.equal(session.status, 200, 'GET /auth/session returns the current session');
  t.ok(!/[a-f0-9]{64}/.test(session.rawBody), 'and no token hash');
  t.equal(session.body['current'], true, 'flagged as the current session');
  const list = await api('GET', '/auth/sessions', { headers: authed() });
  t.equal(list.status, 200, 'GET /auth/sessions lists the caller sessions');
  t.ok(
    !session.rawBody.includes('token_hash') && !list.rawBody.includes('token_hash'),
    'session views never expose token_hash',
  );

  // --- CSRF on state-changing requests ------------------------------------------------------------
  const noCsrf = await api('POST', '/identities', {
    headers: { cookie, 'x-permissions': 'identity.registry.create' },
    body: { identityType: 'internal_person', displayName: 'X', primaryEmail: `x.${randomUUID()}@e.com` },
  });
  t.equal(noCsrf.status, 403, 'a state-changing request with a session cookie but NO csrf token is 403');
  const badCsrf = await api('POST', '/identities', {
    headers: { cookie, 'x-csrf-token': 'not-the-token', 'x-permissions': 'identity.registry.create' },
    body: { identityType: 'internal_person', displayName: 'X', primaryEmail: `x.${randomUUID()}@e.com` },
  });
  t.equal(badCsrf.status, 403, 'a wrong csrf token is 403');
  const goodCsrf = await api('POST', '/identities', {
    headers: authed({ 'x-permissions': 'identity.registry.create' }),
    body: { identityType: 'internal_person', displayName: 'X', primaryEmail: `x.${randomUUID()}@e.com` },
  });
  t.equal(goodCsrf.status, 201, 'a matching csrf token passes');

  // --- refresh rotation + reuse detection ---------------------------------------------------------
  const refreshed = await api('POST', '/auth/session/refresh', { headers: authed() });
  t.equal(refreshed.status, 200, 'refresh rotates the session');
  const newCookies = refreshed.setCookies;
  t.ok(
    newCookies.some((c) => c.startsWith('finapp_session=')),
    'and sets a new session cookie',
  );
  // The ORIGINAL refresh cookie is now consumed. Replaying it is reuse → 401 + family revoked.
  const reuse = await api('POST', '/auth/session/refresh', { headers: authed() });
  t.equal(reuse.status, 401, 'replaying the rotated refresh token is refused');
  // After reuse detection, the rotated session is revoked too — the whole family is dead.
  const afterReuse = await api('GET', '/auth/session', {
    headers: { cookie: cookieHeader(newCookies), 'x-csrf-token': csrf },
  });
  t.equal(afterReuse.status, 401, 'and the rotated session is revoked — theft response killed the family');

  // --- logout revokes the session -----------------------------------------------------------------
  const fresh = await api('POST', '/auth/login', {
    body: { loginIdentifier: 'apiauth_admin_login', password: PASSWORD },
  });
  const freshCookie = cookieHeader(fresh.setCookies);
  const freshCsrf = String(fresh.body['csrfToken']);
  const loggedOut = await api('POST', '/auth/logout', {
    headers: { cookie: freshCookie, 'x-csrf-token': freshCsrf },
  });
  t.equal(loggedOut.status, 200, 'logout succeeds');
  const afterLogout = await api('GET', '/auth/session', {
    headers: { cookie: freshCookie, 'x-csrf-token': freshCsrf },
  });
  t.equal(afterLogout.status, 401, 'and the session no longer resolves');

  // --- lockout is durable -------------------------------------------------------------------------
  await seedAccount(ctx, 'apiauth_lock');
  for (let i = 0; i < 10; i += 1) {
    await api('POST', '/auth/login', {
      body: { loginIdentifier: 'apiauth_lock_login', password: 'definitely-wrong' },
    });
  }
  const locked = await api('POST', '/auth/login', {
    body: { loginIdentifier: 'apiauth_lock_login', password: PASSWORD },
  });
  t.equal(
    locked.status,
    401,
    'after enough failures the account is locked out — even the correct password is refused',
  );

  // --- admin revocation requires the permission ---------------------------------------------------
  // The original admin session was killed by the refresh-reuse test above, so log the admin in afresh.
  const adminFresh = await api('POST', '/auth/login', {
    body: { loginIdentifier: 'apiauth_admin_login', password: PASSWORD },
  });
  const adminAuth = (extra: Record<string, string> = {}): Record<string, string> => ({
    cookie: cookieHeader(adminFresh.setCookies),
    'x-csrf-token': String(adminFresh.body['csrfToken']),
    ...extra,
  });
  const other = await seedAccount(ctx, 'apiauth_victim');
  const victimLogin = await api('POST', '/auth/login', {
    body: { loginIdentifier: 'apiauth_victim_login', password: PASSWORD },
  });
  const victimSessionId = String(
    (
      await api('GET', '/auth/session', {
        headers: {
          cookie: cookieHeader(victimLogin.setCookies),
          'x-csrf-token': String(victimLogin.body['csrfToken']),
        },
      })
    ).body['id'],
  );

  const forbiddenRevoke = await api('POST', `/auth/admin/sessions/${victimSessionId}/revoke`, {
    headers: adminAuth({ 'x-permissions': 'identity.registry.view' }),
  });
  t.equal(forbiddenRevoke.status, 403, 'admin revocation without auth.session.revoke is 403');
  const okRevoke = await api('POST', `/auth/admin/sessions/${victimSessionId}/revoke`, {
    headers: adminAuth({ 'x-permissions': 'auth.session.revoke' }),
  });
  t.equal(okRevoke.status, 200, 'admin revocation with auth.session.revoke succeeds');
  const victimAfter = await api('GET', '/auth/session', {
    headers: {
      cookie: cookieHeader(victimLogin.setCookies),
      'x-csrf-token': String(victimLogin.body['csrfToken']),
    },
  });
  t.equal(victimAfter.status, 401, "and the victim's session is now revoked");
  t.ok(other.accountId.length > 0, 'sanity: victim seeded');
}
