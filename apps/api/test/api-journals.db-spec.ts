import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M21_PERMISSIONS, M21_PERMISSIONS } from '@finapp/m21-journal';

/**
 * THE JOURNAL ENGINE API, OVER HTTP, END TO END (Stage 3). Boots the real AppModule — including JournalsModule + the
 * m06 outbox m21 publishes through — and drives `/api/v1/journals`. It proves the surface works with permissions from
 * a REAL RBAC grant: create a BALANCED draft (debits == credits, INTEGER MINOR UNITS as strings) → run deterministic
 * validation → submit for approval; idempotent config create (same Idempotency-Key → same row); and fail-closed
 * 401 (no auth) + 403 (forged permission header) + 409 (stale expectedVersion) + 404 cross-tenant (RLS). It also
 * proves there is NO approve route and NO external-post route (m21 never approves or posts).
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

async function grantRole(
  ctx: DbSpecContext,
  actor: Seeded,
  permissions: readonly string[],
  code: string,
): Promise<void> {
  const roleId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1,$2,$3,$3,'tenant_custom','active')`,
      [roleId, actor.tenantId, `${code}_role`],
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

export default defineDbSpec('api-journals', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    // Fail closed: an anonymous caller cannot create a draft.
    const anon = await client('POST', '/journals/drafts', { body: { entityRef: randomUUID() } });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a draft (401)');

    const admin = await seedActor(ctx, 'jrnladmin');
    await grantRole(ctx, admin, ALL_M21_PERMISSIONS, 'jrnladmin');
    const auth = await login(client, admin);

    const entityRef = randomUUID();
    const currencyRef = randomUUID();

    // Create a BALANCED draft over HTTP (debits == credits, minor units as strings).
    const draft = await client('POST', '/journals/drafts', {
      headers: auth.headers,
      body: {
        entityRef,
        currencyRef,
        periodStatus: 'open',
        description: 'api journal',
        lines: [
          { accountRef: randomUUID(), direction: 'debit', amountMinor: 10000, currencyRef },
          { accountRef: randomUUID(), direction: 'credit', amountMinor: 10000, currencyRef },
        ],
      },
    });
    t.ok(
      draft.status === 200 || draft.status === 201,
      `create a draft over HTTP (got ${String(draft.status)})`,
    );
    t.equal(draft.body['status'], 'draft', 'a new draft is draft over HTTP');
    t.equal(
      draft.body['totalDebitsMinor'],
      '10000',
      'money reads back as a STRING in minor units (never a float)',
    );
    t.equal(draft.body['isBalanced'], true, 'the draft is balanced (debits == credits)');
    const draftId = String(draft.body['id']);

    // Deterministic validation → validated.
    const validated = await client('POST', `/journals/drafts/${draftId}/validate`, {
      headers: auth.headers,
      body: { expectedVersion: draft.body['version'] },
    });
    t.equal(validated.body['draftStatus'], 'validated', 'a balanced draft validates over HTTP');

    // Submit for approval (m22).
    const current = await client('GET', `/journals/drafts/${draftId}`, { headers: auth.headers });
    const draftBody = current.body['draft'] as Record<string, unknown>;
    const submitted = await client('POST', `/journals/drafts/${draftId}/submit`, {
      headers: auth.headers,
      body: { expectedVersion: draftBody['version'] },
    });
    t.equal(submitted.body['status'], 'submitted', 'a validated draft submits for approval over HTTP');

    // 409: a stale expectedVersion on submit is a conflict.
    const stale = await client('POST', `/journals/drafts/${draftId}/withdraw`, {
      headers: auth.headers,
      body: { expectedVersion: 1, reason: 'stale attempt' },
    });
    t.equal(stale.status, 409, 'a stale expectedVersion is a conflict (409)');

    // Idempotent config create: same Idempotency-Key → same row.
    const idem = `cfg-${randomUUID()}`;
    const c1 = await client('POST', '/journals/config', {
      headers: { ...auth.headers, 'idempotency-key': idem },
      body: { scope: 'default', name: 'v1' },
    });
    const c2 = await client('POST', '/journals/config', {
      headers: { ...auth.headers, 'idempotency-key': idem },
      body: { scope: 'default', name: 'v1' },
    });
    t.equal(
      c1.body['id'],
      c2.body['id'],
      'a repeated Idempotency-Key returns the same config (idempotent create)',
    );

    // NO approve route + NO external-post route (m21 never approves or posts).
    const approve = await client('POST', `/journals/drafts/${draftId}/approve`, {
      headers: auth.headers,
      body: { expectedVersion: 1 },
    });
    t.equal(approve.status, 404, 'there is no approve route on the journal engine (m21 never approves)');
    const post = await client('POST', `/journals/drafts/${draftId}/post`, {
      headers: auth.headers,
      body: { expectedVersion: 1 },
    });
    t.equal(post.status, 404, 'there is no external-post route on the journal engine (m21 never posts)');

    // 403: a header cannot grant authority.
    const outsider = await seedActor(ctx, 'jrnloutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/journals/drafts', {
      headers: { ...outsiderAuth.headers, 'x-permissions': M21_PERMISSIONS.draftCreate },
      body: { entityRef: randomUUID() },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // Another tenant sees nothing.
    const otherAdmin = await seedActor(ctx, 'jrnlother');
    await grantRole(ctx, otherAdmin, ALL_M21_PERMISSIONS, 'jrnlother');
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/journals/drafts', { headers: otherAuth.headers });
    t.equal(
      (otherList.body['drafts'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant drafts (RLS)',
    );
    const otherGet = await client('GET', `/journals/drafts/${draftId}`, { headers: otherAuth.headers });
    t.equal(otherGet.status, 404, "another tenant cannot read this tenant's draft (RLS -> 404)");
  } finally {
    await close();
  }
});
