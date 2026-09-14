import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type Assert, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';

/**
 * DAY-1 PRODUCTION SCOPE ISOLATION PROBE (production-exit / Day-1 execution).
 *
 * Proves — over real HTTP against the booted AppModule and the NON-SUPERUSER `finapp_app` role — that the
 * controlled Day-1 module scope (`docs/03-platform/PRODUCTION_DAY1_MODULE_SCOPE.md`) is enforced by the
 * EXISTING, server-authoritative RBAC/entitlement/tenant controls, with no code change and no new feature flag:
 *
 *   1. No session → 401 (authority requires a real session).
 *   2. An ENABLED-scope role (`cases.case.read` only) reaches its module (`GET /cases` → 200).
 *   3. That same role is DENIED every DISABLED module — journals / litigation / analytics → 403.
 *   4. Authority is a DATABASE fact: an `x-permissions` header (and a forged `x-actor-id`) grants NOTHING;
 *      the disabled-module call is still 403. There is no implicit bypass — `can()` is default-deny and keys
 *      only off persisted grants (`packages/m02-rbac/src/rbac-authz.ts`).
 *   5. Positive control: a role that DOES hold `journals.draft.read` reaches `GET /journals/drafts` (200) —
 *      proving the 403s above are the missing grant, not a broken route. (This is exactly why Day-1 provisioning
 *      must NOT hand out the all-permission `platform_admin` role — power there is an EXPLICIT full grant, not a
 *      bypass, so isolation = withhold the disabled modules' permissions.)
 *   6. The three composition verticals are entitlement-gated: a fresh tenant with no subscription is NOT
 *      entitled to `debt_recovery` (`GET /saas/entitlements/check` → entitled:false).
 *   7. Tenant isolation holds at the API: an actor scoped to tenant A cannot borrow tenant B's context by
 *      sending `x-tenant-id: B` — the request is refused (>= 400), never served cross-tenant.
 *
 * Fails closed throughout: 401 anon, 403 unheld permission, refused cross-tenant. M42 remains NO_GO; this is
 * evidence for the Day-1 scope precondition, not a production authorization.
 */

const PASSWORD = 'correct-horse-battery-staple';

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly setCookies: string[];
}
type Client = (
  method: string,
  path: string,
  opts?: { headers?: Record<string, string>; body?: unknown },
) => Promise<Reply>;
interface Auth {
  readonly headers: Record<string, string>;
}
interface Seeded {
  readonly tenantId: string;
  readonly identityId: string;
  readonly membershipId: string;
  readonly login: string;
}

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(';')[0] ?? '')
    .filter((c) => c !== '')
    .join('; ');
}

async function seedActor(ctx: DbSpecContext, code: string): Promise<Seeded> {
  const tenantId = randomUUID();
  const identityId = randomUUID();
  const accountId = randomUUID();
  const membershipId = randomUUID();
  const login = `${code}_${identityId.slice(0, 8)}`;
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at) VALUES ($1,$2,$3,'enterprise_customer','active',now())`,
      [tenantId, `${code}_${tenantId.slice(0, 8)}`, `${code} Ltd`],
    );
    await tx.query(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status) VALUES ($1,'internal_person',$2,$3,$3,'active')`,
      [identityId, `${code} P`, `${code}.${identityId.slice(0, 8)}@example.com`],
    );
    await tx.query(
      `INSERT INTO user_accounts (id, identity_id, account_type, login_identifier, login_identifier_norm, status, activated_at) VALUES ($1,$2,'human',$3,$3,'active',now())`,
      [accountId, identityId, login],
    );
    await tx.query(
      `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status) VALUES ($1,$2,$3,$4,'employee','active')`,
      [tenantId, membershipId, identityId, accountId],
    );
    const hashed = await argon2idHasher.hash(PASSWORD);
    await tx.query(
      `INSERT INTO authentication_credentials (account_id, algorithm, params, secret_hash) VALUES ($1,$2,$3::jsonb,$4)`,
      [accountId, hashed.algorithm, JSON.stringify(hashed.params), hashed.encoded],
    );
  });
  return { tenantId, identityId, membershipId, login };
}

async function grantRole(ctx: DbSpecContext, actor: Seeded, permissions: readonly string[]): Promise<void> {
  const roleId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1,$2,$3,$3,'tenant_custom','active')`,
      [roleId, actor.tenantId, `role_${roleId.slice(0, 8)}`],
    );
    for (const perm of permissions)
      await tx.query(`INSERT INTO role_permissions (role_id, tenant_id, permission_code) VALUES ($1,$2,$3)`, [
        roleId,
        actor.tenantId,
        perm,
      ]);
    await tx.query(
      `INSERT INTO role_assignments (tenant_id, membership_id, identity_id, role_id, scope_level, status) VALUES ($1,$2,$3,$4,'tenant','active')`,
      [actor.tenantId, actor.membershipId, actor.identityId, roleId],
    );
  });
}

async function bootApi(): Promise<{ client: Client; close: () => Promise<void> } | { error: string }> {
  process.env['NODE_ENV'] = 'test';
  const distDir = resolvePath(import.meta.dirname, '../dist/src');
  try {
    try {
      await import(
        pathToFileURL(resolvePath(distDir, '../../../node_modules/reflect-metadata/lib/index.js')).href
      );
    } catch {
      await import('reflect-metadata');
    }
    const core = (await import('@nestjs/core')) as unknown as {
      NestFactory: { create: (m: unknown, o?: unknown) => Promise<Record<string, (a?: unknown) => unknown>> };
    };
    const appModule = (await import(pathToFileURL(resolvePath(distDir, 'app.module.js')).href)) as {
      AppModule: unknown;
    };
    const filter = (await import(pathToFileURL(resolvePath(distDir, 'problem.filter.js')).href)) as {
      ProblemFilter: new () => unknown;
    };
    const app = (await core.NestFactory.create(appModule.AppModule, { logger: false })) as unknown as {
      setGlobalPrefix: (p: string) => void;
      useGlobalFilters: (f: unknown) => void;
      listen: (p: number) => Promise<unknown>;
      close: () => Promise<void>;
      getHttpServer: () => { address: () => { port: number } };
    };
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new filter.ProblemFilter());
    await app.listen(0);
    const port = app.getHttpServer().address().port;
    const base = `http://127.0.0.1:${String(port)}/api/v1`;
    const client: Client = async (method, path, opts = {}) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
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
        setCookies: typeof getSetCookie === 'function' ? getSetCookie.call(response.headers) : [],
      };
    };
    return { client, close: () => app.close() };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function login(api: Client, actor: Seeded): Promise<Auth> {
  const reply = await api('POST', '/auth/login', {
    body: { loginIdentifier: actor.login, password: PASSWORD },
  });
  if (reply.status !== 200) throw new Error(`login failed: ${String(reply.status)}`);
  return {
    headers: {
      cookie: cookieHeader(reply.setCookies),
      'x-csrf-token': String(reply.body['csrfToken']),
      'x-tenant-id': actor.tenantId,
    },
  };
}

export default defineDbSpec('day1-isolation (production Day-1 scope)', async (ctx, t) => {
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
  // 1. No session → 401. Authority requires a real, server-issued session; no cookie means no actor.
  const anon = await api('GET', '/journals/drafts');
  t.equal(anon.status, 401, 'no session → 401 on a disabled-module route (GET /journals/drafts)');

  // 2. An ENABLED-scope role (cases.case.read only) reaches ITS module.
  const enabled = await seedActor(ctx, 'day1_enabled');
  await grantRole(ctx, enabled, ['cases.case.read']);
  const eAuth = await login(api, enabled);
  const cases = await api('GET', '/cases', { headers: eAuth.headers });
  t.equal(cases.status, 200, 'enabled module reachable: cases.case.read → GET /cases → 200');

  // 3. The SAME enabled-scope role is DENIED every DISABLED module — no accidental inheritance.
  const eJournals = await api('GET', '/journals/drafts', { headers: eAuth.headers });
  t.equal(eJournals.status, 403, 'disabled M21 Journals: enabled role → GET /journals/drafts → 403');
  const eLitigation = await api('GET', `/litigation/proceedings/${randomUUID()}/filings`, {
    headers: eAuth.headers,
  });
  t.equal(eLitigation.status, 403, 'disabled M16 Litigation: enabled role → 403');
  const eAnalytics = await api('GET', '/analytics/datasets', { headers: eAuth.headers });
  t.equal(eAnalytics.status, 403, 'disabled M32 Analytics: enabled role → GET /analytics/datasets → 403');

  // 4. Authority is a DATABASE fact — an x-permissions header and a forged x-actor-id grant NOTHING.
  const forged = await api('GET', '/journals/drafts', {
    headers: {
      ...eAuth.headers,
      'x-permissions': 'journals.draft.read journals.draft.create',
      'x-actor-id': randomUUID(),
    },
  });
  t.equal(
    forged.status,
    403,
    'no implicit bypass: x-permissions / x-actor-id headers cannot grant → still 403',
  );

  // 5. Positive control — a role that DOES hold journals.draft.read reaches the SAME route (200), proving the
  //    403s above are the missing grant, not a broken route. (Day-1 therefore isolates by withholding grants.)
  const maker = await seedActor(ctx, 'day1_journals');
  await grantRole(ctx, maker, ['journals.draft.read']);
  const mAuth = await login(api, maker);
  const mJournals = await api('GET', '/journals/drafts', { headers: mAuth.headers });
  t.equal(mJournals.status, 200, 'positive control: journals.draft.read → GET /journals/drafts → 200');

  // 6. Composition verticals are entitlement-gated: a fresh tenant is NOT entitled to debt_recovery.
  const ent = await api('GET', '/saas/entitlements/check?capabilityKey=debt_recovery', {
    headers: eAuth.headers,
  });
  t.equal(ent.status, 200, 'entitlement self-check is reachable (self-scoped read)');
  t.equal(ent.body['entitled'], false, 'vertical entitlement OFF by default: debt_recovery entitled:false');

  // 7. Tenant isolation at the API — actor scoped to tenant A cannot borrow tenant B's context.
  const other = await seedActor(ctx, 'day1_other');
  const cross = await api('GET', '/cases', {
    headers: { ...eAuth.headers, 'x-tenant-id': other.tenantId },
  });
  t.ok(
    cross.status >= 400,
    `tenant isolation: actor A + x-tenant-id:B is refused (status ${String(cross.status)})`,
  );
  t.ok(
    !Array.isArray(cross.body['cases']) || (cross.body['cases'] as unknown[]).length === 0,
    'tenant isolation: no cross-tenant cases are ever returned',
  );
}
