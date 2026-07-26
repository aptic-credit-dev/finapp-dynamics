import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M08_PERMISSIONS } from '@finapp/m08-notify';

/**
 * THE NOTIFICATIONS API, OVER HTTP, END TO END (Stage 2.4).
 *
 * Boots the real AppModule — including NotifyModule and the m06 WorkflowOutbox m08 publishes through — and
 * drives `/api/v1/notifications` through a real session. It proves the surface works (author → validate →
 * publish → activate a template, then create/read/cancel a request, set a preference, read the inbox over
 * HTTP, with permissions resolved from a REAL RBAC grant, never a header), that request views REDACT the raw
 * variable values, and that it fails closed: an unprivileged actor is refused (403, and an `x-permissions`
 * header cannot grant authority), an anonymous caller is refused (401), and another tenant sees nothing.
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
  readonly login: string;
}

async function seedActor(ctx: DbSpecContext, code: string): Promise<Seeded> {
  const tenantId = randomUUID();
  const identityId = randomUUID();
  const accountId = randomUUID();
  const membershipId = randomUUID();
  const login = `${code}_${identityId.slice(0, 8)}`;
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at)
       VALUES ($1, $2, $3, 'enterprise_customer', 'active', now())`,
      [tenantId, `${code}_${tenantId.slice(0, 8)}`, `${code} Ltd`],
    );
    await tx.query(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status)
       VALUES ($1, 'internal_person', $2, $3, $3, 'active')`,
      [identityId, `${code} P`, `${code}.${identityId.slice(0, 8)}@example.com`],
    );
    await tx.query(
      `INSERT INTO user_accounts (id, identity_id, account_type, login_identifier, login_identifier_norm, status, activated_at)
       VALUES ($1, $2, 'human', $3, $3, 'active', now())`,
      [accountId, identityId, login],
    );
    await tx.query(
      `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status)
       VALUES ($1, $2, $3, $4, 'employee', 'active')`,
      [tenantId, membershipId, identityId, accountId],
    );
    const hashed = await argon2idHasher.hash(PASSWORD);
    await tx.query(
      `INSERT INTO authentication_credentials (account_id, algorithm, params, secret_hash)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [accountId, hashed.algorithm, JSON.stringify(hashed.params), hashed.encoded],
    );
  });
  return { tenantId, identityId, membershipId, login };
}

/** Grant every m08 permission to the actor via a real tenant role + assignment (never a header). */
async function grantNotifyRole(ctx: DbSpecContext, actor: Seeded): Promise<void> {
  const roleId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1, $2, 'notify_admin', 'Notify admin', 'tenant_custom', 'active')`,
      [roleId, actor.tenantId],
    );
    for (const perm of ALL_M08_PERMISSIONS) {
      await tx.query(
        `INSERT INTO role_permissions (role_id, tenant_id, permission_code) VALUES ($1, $2, $3)`,
        [roleId, actor.tenantId, perm],
      );
    }
    await tx.query(
      `INSERT INTO role_assignments (tenant_id, membership_id, identity_id, role_id, scope_level, status)
       VALUES ($1, $2, $3, $4, 'tenant', 'active')`,
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
  if (reply.status !== 200) throw new Error(`login failed for ${actor.login}: ${String(reply.status)}`);
  return {
    headers: {
      cookie: cookieHeader(reply.setCookies),
      'x-csrf-token': String(reply.body['csrfToken']),
      'x-tenant-id': actor.tenantId,
    },
  };
}

const TEMPLATE = {
  schemaVersion: 1,
  code: 'http_welcome',
  name: 'HTTP welcome',
  channel: 'email',
  subjectTemplate: 'Hi {{ name }}',
  bodyTemplate: 'Welcome {{ name }}',
  variables: [{ name: 'name', type: 'string', required: true }],
};

export default defineDbSpec('api-notify', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    // --- anonymous is refused (401) --------------------------------------------------------------
    const anon = await client('POST', '/notifications/templates', {
      body: { key: 'x', name: 'x', spec: TEMPLATE },
    });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a template (401)');

    // --- a privileged actor authors, publishes, activates a template over HTTP -------------------
    const admin = await seedActor(ctx, 'notifyadmin');
    await grantNotifyRole(ctx, admin);
    const auth = await login(client, admin);

    const created = await client('POST', '/notifications/templates', {
      headers: auth.headers,
      body: { key: 'http_welcome', name: 'HTTP welcome', spec: TEMPLATE },
    });
    t.ok(
      created.status === 200 || created.status === 201,
      `create template over HTTP (got ${String(created.status)})`,
    );
    const version = (created.body['version'] ?? {}) as Record<string, unknown>;
    const versionId = String(version['id']);

    const validated = await client('POST', `/notifications/versions/${versionId}/validate`, {
      headers: auth.headers,
      body: { expectedVersion: version['version'] },
    });
    t.ok(validated.status === 200 || validated.status === 201, 'validate over HTTP succeeds');
    const published = await client('POST', `/notifications/versions/${versionId}/publish`, {
      headers: auth.headers,
      body: { expectedVersion: validated.body['version'] },
    });
    t.ok(published.status === 200 || published.status === 201, 'publish over HTTP succeeds');
    t.ok(published.body['contentHash'] !== null, 'publishing returns a frozen content hash');
    const activated = await client('POST', `/notifications/versions/${versionId}/activate`, {
      headers: auth.headers,
      body: { expectedVersion: published.body['version'] },
    });
    t.ok(activated.status === 200 || activated.status === 201, 'activate over HTTP succeeds');

    // --- create a request; idempotent by header --------------------------------------------------
    const reqBody = {
      templateKey: 'http_welcome',
      destination: 'user@example.com',
      variables: { name: 'Ada' },
    };
    const req = await client('POST', '/notifications/requests', {
      headers: { ...auth.headers, 'idempotency-key': 'http-notify-1' },
      body: reqBody,
    });
    t.ok(req.status === 200 || req.status === 201, 'create a notification request over HTTP');
    t.equal(req.body['status'], 'queued', 'the request is queued');
    const requestId = String(req.body['id']);
    // Redaction: the raw variable value must not appear in the response.
    t.ok(!JSON.stringify(req.body).includes('Ada'), 'the request view redacts raw variable values');
    t.ok(String(req.body['variablesHash']).length > 0, 'the request view exposes a variables hash instead');

    const dup = await client('POST', '/notifications/requests', {
      headers: { ...auth.headers, 'idempotency-key': 'http-notify-1' },
      body: reqBody,
    });
    t.equal(String(dup.body['id']), requestId, 'a repeated idempotency-key returns the same request');

    const fetched = await client('GET', `/notifications/requests/${requestId}`, { headers: auth.headers });
    t.equal(String(fetched.body['id']), requestId, 'the request reads back');
    t.ok(fetched.body['lockedBy'] === undefined, 'the request view does not expose the worker lease');

    const cancelled = await client('POST', `/notifications/requests/${requestId}/cancel`, {
      headers: auth.headers,
      body: { expectedVersion: fetched.body['version'], reason: 'test' },
    });
    t.equal(cancelled.body['status'], 'cancelled', 'the request cancels over HTTP');

    // --- a header cannot grant authority (403) ---------------------------------------------------
    const outsider = await seedActor(ctx, 'notifyoutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/notifications/templates', {
      headers: { ...outsiderAuth.headers, 'x-permissions': ALL_M08_PERMISSIONS.join(',') },
      body: { key: 'nope', name: 'nope', spec: TEMPLATE },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // --- another tenant sees none of the first tenant templates ----------------------------------
    const otherAdmin = await seedActor(ctx, 'notifyother');
    await grantNotifyRole(ctx, otherAdmin);
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/notifications/templates', { headers: otherAuth.headers });
    const templates = (otherList.body['templates'] ?? []) as unknown[];
    t.equal(templates.length, 0, 'another tenant sees none of the first tenant templates (RLS)');

    // --- self-service preference + inbox ---------------------------------------------------------
    const pref = await client('POST', '/notifications/preferences', {
      headers: auth.headers,
      body: { channel: 'email', optIn: false },
    });
    t.ok(pref.status === 200 || pref.status === 201, 'set a notification preference over HTTP');
    t.equal(pref.body['optIn'], false, 'the preference reflects opt-out');

    const box = await client('GET', '/notifications/inbox', { headers: auth.headers });
    t.ok(box.status === 200, 'the inbox reads over HTTP');
    t.ok(Array.isArray(box.body['inbox']), 'the inbox returns a list');
  } finally {
    await close();
  }
});
