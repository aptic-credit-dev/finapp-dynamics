import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type Assert, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';

/**
 * THE RBAC API, OVER HTTP, END TO END (Stage 1D).
 *
 * Boots the real `AppModule` — including `RbacModule` — and drives `/api/v1/rbac` with real requests through
 * a real session: create a role, activate it, grant it a permission, assign it to a membership, read the
 * catalogue. Then it proves the two things the surface exists to guarantee: a proven-but-unprivileged actor
 * is refused (403, not 401), and a grant that would breach segregation of duties is blocked (409). Authority
 * is never a header — every privileged call rides a platform_admin grant that lives in the database.
 */

const PASSWORD = 'correct-horse-battery-staple';
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

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(';')[0] ?? '')
    .filter((c) => c !== '')
    .join('; ');
}

interface Seeded {
  readonly tenantId: string;
  readonly identityId: string;
  readonly membershipId: string;
}

/** A tenant + an active person with a login and a membership; the tenant is created unless one is given. */
async function seedActor(ctx: DbSpecContext, code: string, tenantId?: string): Promise<Seeded> {
  const resolvedTenant = tenantId ?? randomUUID();
  const identityId = randomUUID();
  const accountId = randomUUID();
  const membershipId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    if (tenantId === undefined) {
      await tx.query(
        `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at)
         VALUES ($1, $2, $3, 'enterprise_customer', 'active', now())`,
        [resolvedTenant, `${code}_${resolvedTenant.slice(0, 8)}`, `${code} Ltd`],
      );
    }
    await tx.query(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status)
       VALUES ($1, 'internal_person', $2, $3, $3, 'active')`,
      [identityId, `${code} P`, `${code}.${identityId.slice(0, 8)}@example.com`],
    );
    await tx.query(
      `INSERT INTO user_accounts (id, identity_id, account_type, login_identifier, login_identifier_norm, status, activated_at)
       VALUES ($1, $2, 'human', $3, $3, 'active', now())`,
      [accountId, identityId, `${code}_login`],
    );
    await tx.query(
      `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status)
       VALUES ($1, $2, $3, $4, 'employee', 'active')`,
      [resolvedTenant, membershipId, identityId, accountId],
    );
    const hashed = await argon2idHasher.hash(PASSWORD);
    await tx.query(
      `INSERT INTO authentication_credentials (account_id, algorithm, params, secret_hash)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [accountId, hashed.algorithm, JSON.stringify(hashed.params), hashed.encoded],
    );
  });
  return { tenantId: resolvedTenant, identityId, membershipId };
}

async function grantPlatformAdmin(ctx: DbSpecContext, identityId: string): Promise<void> {
  await ctx.asSuperuser(null, (tx) =>
    tx.query(
      `INSERT INTO platform_role_assignments (identity_id, role_id, status) VALUES ($1, $2, 'active')`,
      [identityId, PLATFORM_ADMIN_ROLE_ID],
    ),
  );
}

interface Auth {
  readonly cookie: string;
  readonly csrf: string;
}
async function login(api: Client, loginIdentifier: string): Promise<Auth> {
  const reply = await api('POST', '/auth/login', { body: { loginIdentifier, password: PASSWORD } });
  if (reply.status !== 200) throw new Error(`login failed for ${loginIdentifier}: ${reply.status}`);
  return { cookie: cookieHeader(reply.setCookies), csrf: String(reply.body['csrfToken']) };
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
    get: (token: unknown) => { run: (c: string) => Promise<unknown> };
    [k: string]: unknown;
  };
  try {
    try {
      await import(
        pathToFileURL(resolvePath(distDir, '../../../node_modules/reflect-metadata/lib/index.js')).href
      );
    } catch {
      await import('reflect-metadata');
    }
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

export default defineDbSpec('api-rbac (Stage 1D)', async (ctx, t) => {
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
  const admin = await seedActor(ctx, 'apirbac_admin');
  await grantPlatformAdmin(ctx, admin.identityId);
  const adminAuth = await login(api, 'apirbac_admin_login');
  const inTenant = (extra: Record<string, string> = {}): Record<string, string> => ({
    cookie: adminAuth.cookie,
    'x-csrf-token': adminAuth.csrf,
    'x-tenant-id': admin.tenantId,
    ...extra,
  });
  const asPlatform = (extra: Record<string, string> = {}): Record<string, string> => ({
    cookie: adminAuth.cookie,
    'x-csrf-token': adminAuth.csrf,
    ...extra,
  });

  const subject = await seedActor(ctx, 'apirbac_subject', admin.tenantId);

  // --- the surface is closed by default ------------------------------------------------------------
  {
    const anon = await api('GET', '/rbac/roles', { headers: { 'x-tenant-id': admin.tenantId } });
    t.equal(anon.status, 401, 'an anonymous request to the RBAC API is refused');

    await seedActor(ctx, 'apirbac_powerless', admin.tenantId);
    const powerless = await login(api, 'apirbac_powerless_login');
    const denied = await api('POST', '/rbac/roles', {
      headers: { cookie: powerless.cookie, 'x-csrf-token': powerless.csrf, 'x-tenant-id': admin.tenantId },
      body: { code: 'sneaky_role', name: 'Sneaky' },
    });
    t.equal(denied.status, 403, 'a PROVEN actor without rbac.role.create is 403 — not 401');
  }

  // --- role lifecycle + concrete permissions -------------------------------------------------------
  let roleId = '';
  {
    const created = await api('POST', '/rbac/roles', {
      headers: inTenant(),
      body: { code: 'support_agent', name: 'Support Agent', description: 'Reads identities' },
    });
    t.equal(created.status, 201, 'POST /rbac/roles creates a role');
    t.equal(created.body['status'], 'draft', 'and it starts in draft');
    roleId = String(created.body['id']);

    const activated = await api('POST', `/rbac/roles/${roleId}/activate`, {
      headers: inTenant(),
      body: { expectedVersion: Number(created.body['version']) },
    });
    t.equal(activated.status, 201, 'POST /rbac/roles/:id/activate activates it');
    t.equal(activated.body['status'], 'active', 'the role is now active');

    const granted = await api('PATCH', `/rbac/roles/${roleId}/permissions`, {
      headers: inTenant(),
      body: { add: ['identity.registry.view'] },
    });
    t.equal(granted.status, 200, 'PATCH /rbac/roles/:id/permissions grants a concrete permission');
    t.equal(granted.body['added'], 1, 'one permission was added');

    const perms = await api('GET', `/rbac/roles/${roleId}/permissions`, { headers: inTenant() });
    t.ok(
      Array.isArray(perms.body['permissions']) &&
        (perms.body['permissions'] as string[]).includes('identity.registry.view'),
      'the granted permission reads back',
    );

    // Anti-escalation over HTTP: the admin can only confer permissions it itself holds. A code nobody holds
    // — a bogus one included — fails the escalation bound first, so it is refused (403) before it could ever
    // be written. Either way it does not slip into the role (fail closed).
    const bogus = await api('PATCH', `/rbac/roles/${roleId}/permissions`, {
      headers: inTenant(),
      body: { add: ['identity.registry.doesnotexist'] },
    });
    t.equal(
      bogus.status,
      403,
      'a permission the grantor does not hold (a bogus one included) is refused — no self-escalation',
    );
  }

  // --- assignment ----------------------------------------------------------------------------------
  {
    const granted = await api('POST', '/rbac/assignments', {
      headers: inTenant(),
      body: { membershipId: subject.membershipId, roleId },
    });
    t.equal(granted.status, 201, 'POST /rbac/assignments grants the role to a membership');
    t.equal(granted.body['status'], 'active', 'the assignment is active');
    const assignmentId = String(granted.body['id']);

    const listed = await api('GET', `/rbac/assignments?membershipId=${subject.membershipId}`, {
      headers: inTenant(),
    });
    t.equal(listed.status, 200, 'GET /rbac/assignments lists');
    t.ok(
      Array.isArray(listed.body) && (listed.body as unknown[]).length === 1,
      'and returns the one assignment',
    );

    const revoked = await api('POST', `/rbac/assignments/${assignmentId}/revoke`, {
      headers: inTenant(),
      body: { expectedVersion: Number(granted.body['version']), reason: 'offboarding' },
    });
    t.equal(revoked.status, 201, 'POST /rbac/assignments/:id/revoke revokes it');
    t.equal(revoked.body['status'], 'revoked', 'the assignment is now revoked');
  }

  // --- the permission catalogue --------------------------------------------------------------------
  {
    const catalogue = await api('GET', '/rbac/permissions', { headers: asPlatform() });
    t.equal(catalogue.status, 200, 'GET /rbac/permissions returns the governed catalogue');
    t.ok(
      Array.isArray(catalogue.body) && (catalogue.body as unknown[]).length > 0,
      'the catalogue is non-empty',
    );
  }

  // --- segregation of duties, enforced at the grant ------------------------------------------------
  {
    const sodSubject = await seedActor(ctx, 'apirbac_sod', admin.tenantId);
    const approver = await makeActiveRoleWithPermission(
      api,
      inTenant,
      'sod_approver',
      'tenant.registry.approve',
    );
    const creator = await makeActiveRoleWithPermission(
      api,
      inTenant,
      'sod_creator',
      'tenant.registry.create',
    );

    const first = await api('POST', '/rbac/assignments', {
      headers: inTenant(),
      body: { membershipId: sodSubject.membershipId, roleId: approver },
    });
    t.equal(first.status, 201, 'granting the approver role succeeds');

    const conflict = await api('POST', '/rbac/assignments', {
      headers: inTenant(),
      body: { membershipId: sodSubject.membershipId, roleId: creator },
    });
    t.equal(conflict.status, 409, 'granting the creator role to the same membership is blocked by SoD (409)');
  }
}

/** Creates an active role carrying exactly one permission, returning its id — a small builder for the SoD test. */
async function makeActiveRoleWithPermission(
  api: Client,
  headers: (extra?: Record<string, string>) => Record<string, string>,
  code: string,
  permission: string,
): Promise<string> {
  const created = await api('POST', '/rbac/roles', { headers: headers(), body: { code, name: code } });
  const id = String(created.body['id']);
  await api('POST', `/rbac/roles/${id}/activate`, {
    headers: headers(),
    body: { expectedVersion: Number(created.body['version']) },
  });
  await api('PATCH', `/rbac/roles/${id}/permissions`, { headers: headers(), body: { add: [permission] } });
  return id;
}
