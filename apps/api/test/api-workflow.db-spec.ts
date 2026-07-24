import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M06_PERMISSIONS } from '@finapp/m06-workflow';

/**
 * THE WORKFLOW API, OVER HTTP, END TO END (Stage 2.2).
 *
 * Boots the real AppModule — including WorkflowModule and the WorkflowOutbox binding — and drives
 * `/api/v1/workflow` through a real session. It proves the surface works (author -> validate -> publish ->
 * activate -> start over HTTP, with permissions resolved from a REAL RBAC grant, never a header) and that it
 * fails closed: a proven-but-unprivileged actor is refused (403, and a header cannot grant authority), and an
 * anonymous caller is refused (401).
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

/** Grant every workflow permission to the actor via a real tenant role + assignment (never a header). */
async function grantWorkflowRole(ctx: DbSpecContext, actor: Seeded): Promise<void> {
  const roleId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1, $2, 'wf_admin', 'Workflow admin', 'tenant_custom', 'active')`,
      [roleId, actor.tenantId],
    );
    for (const perm of ALL_M06_PERMISSIONS) {
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
  // Tenant permissions resolve only when the request claims the tenant (x-tenant-id); the RBAC resolver then
  // reads the actor's role assignments IN that tenant. The claim is verified against a real membership.
  return {
    headers: {
      cookie: cookieHeader(reply.setCookies),
      'x-csrf-token': String(reply.body['csrfToken']),
      'x-tenant-id': actor.tenantId,
    },
  };
}

const SPEC = {
  schemaVersion: 1,
  code: 'http_flow',
  name: 'HTTP flow',
  variables: [{ name: 'amount', type: 'number' }],
  nodes: [
    { key: 'start', type: 'START' },
    { key: 'review', type: 'HUMAN_TASK' },
    { key: 'done', type: 'END' },
  ],
  transitions: [
    { key: 't0', from: 'start', to: 'review' },
    { key: 't1', from: 'review', to: 'done' },
  ],
};

export default defineDbSpec('api-workflow', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    // --- anonymous is refused (401) --------------------------------------------------------------
    const anon = await client('POST', '/workflow/definitions', {
      body: { code: 'x', name: 'x', spec: SPEC },
    });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a workflow definition (401)');

    // --- a privileged actor authors, publishes, activates and starts a workflow over HTTP --------
    const admin = await seedActor(ctx, 'wfadmin');
    await grantWorkflowRole(ctx, admin);
    const auth = await login(client, admin);

    const created = await client('POST', '/workflow/definitions', {
      headers: auth.headers,
      body: { code: 'http_flow', name: 'HTTP flow', spec: SPEC },
    });
    t.ok(
      created.status === 200 || created.status === 201,
      `a privileged actor creates a definition over HTTP (got ${String(created.status)})`,
    );
    const version = (created.body['version'] ?? {}) as Record<string, unknown>;
    const definition = (created.body['definition'] ?? {}) as Record<string, unknown>;
    const versionId = String(version['id']);
    const definitionId = String(definition['id']);

    const validated = await client('POST', `/workflow/definitions/${versionId}/validate`, {
      headers: auth.headers,
      body: { expectedVersion: version['version'] },
    });
    t.ok(validated.status === 200 || validated.status === 201, 'validate over HTTP succeeds');
    const published = await client('POST', `/workflow/definitions/${versionId}/publish`, {
      headers: auth.headers,
      body: { expectedVersion: validated.body['version'] },
    });
    t.ok(published.status === 200 || published.status === 201, 'publish over HTTP succeeds');
    const activated = await client('POST', `/workflow/definitions/${versionId}/activate`, {
      headers: auth.headers,
      body: { expectedVersion: published.body['version'] },
    });
    t.ok(activated.status === 200 || activated.status === 201, 'activate over HTTP succeeds');

    const started = await client('POST', '/workflow/instances', {
      headers: auth.headers,
      body: { definitionId, businessKey: 'http-1', variables: { amount: 10 } },
    });
    t.ok(
      started.status === 200 || started.status === 201,
      `start an instance over HTTP (got ${String(started.status)})`,
    );
    t.equal(started.body['status'], 'WAITING', 'the instance parks WAITING at the human task');

    // --- a missing instance is a stable 404 ------------------------------------------------------
    const missing = await client('GET', `/workflow/instances/${randomUUID()}`, { headers: auth.headers });
    t.equal(missing.status, 404, 'a missing instance is a 404 (invisible, not a leak)');

    // --- default deny: a proven-but-unprivileged actor is refused (403); a header cannot grant it -
    const nobody = await seedActor(ctx, 'nobody');
    const nobodyAuth = await login(client, nobody);
    const denied = await client('POST', '/workflow/definitions', {
      headers: { ...nobodyAuth.headers, 'x-permissions': 'workflow.definition.create' },
      body: { code: 'nope', name: 'nope', spec: SPEC },
    });
    t.equal(denied.status, 403, 'an unprivileged actor is forbidden — a header cannot grant authority (403)');
  } finally {
    await close();
  }
});
