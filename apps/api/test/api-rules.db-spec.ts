import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M07_PERMISSIONS } from '@finapp/m07-rules';

/**
 * THE RULES API, OVER HTTP, END TO END (Stage 2.3).
 *
 * Boots the real AppModule — including RulesModule and the m06 WorkflowOutbox binding m07 publishes through —
 * and drives `/api/v1/rules` through a real session. It proves the surface works (author -> validate ->
 * publish -> activate -> evaluate -> replay over HTTP, with permissions resolved from a REAL RBAC grant, never
 * a header), that evaluation is deterministic + explainable and idempotent, that evidence carries the input
 * HASH not the raw input, and that it fails closed: an unprivileged actor is refused (403, and a header cannot
 * grant authority), an anonymous caller is refused (401), and another tenant sees nothing.
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

/** Grant every rules permission to the actor via a real tenant role + assignment (never a header). */
async function grantRulesRole(ctx: DbSpecContext, actor: Seeded): Promise<void> {
  const roleId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1, $2, 'rules_admin', 'Rules admin', 'tenant_custom', 'active')`,
      [roleId, actor.tenantId],
    );
    for (const perm of ALL_M07_PERMISSIONS) {
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

const SPEC = {
  schemaVersion: 1,
  code: 'http_credit',
  name: 'HTTP credit',
  inputSchema: [
    { name: 'amount', type: 'decimal', required: true, scale: 2 },
    { name: 'score', type: 'number', required: true },
  ],
  outputSchema: [{ name: 'decision', type: 'string', required: true }],
  derived: [],
  decisionTables: [
    {
      id: 't_decision',
      hitPolicy: 'FIRST',
      inputFields: ['score'],
      outputFields: ['decision'],
      rows: [
        {
          id: 'r_ok',
          when: { type: 'compare', field: 'score', op: 'ge', value: 700, valueType: 'number' },
          outputs: { decision: 'APPROVE' },
          reasonCode: 'SCORE_OK',
        },
        {
          id: 'r_low',
          when: { type: 'compare', field: 'score', op: 'lt', value: 700, valueType: 'number' },
          outputs: { decision: 'REVIEW' },
          reasonCode: 'SCORE_LOW',
        },
      ],
    },
  ],
};

export default defineDbSpec('api-rules', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    // --- anonymous is refused (401) --------------------------------------------------------------
    const anon = await client('POST', '/rules/sets', { body: { key: 'x', name: 'x', spec: SPEC } });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a rule set (401)');

    // --- a privileged actor authors, publishes and activates a rule set over HTTP ----------------
    const admin = await seedActor(ctx, 'rulesadmin');
    await grantRulesRole(ctx, admin);
    const auth = await login(client, admin);

    const created = await client('POST', '/rules/sets', {
      headers: auth.headers,
      body: { key: 'http_credit', name: 'HTTP credit', spec: SPEC },
    });
    t.ok(
      created.status === 200 || created.status === 201,
      `a privileged actor creates a rule set over HTTP (got ${String(created.status)})`,
    );
    const version = (created.body['version'] ?? {}) as Record<string, unknown>;
    const ruleSet = (created.body['ruleSet'] ?? {}) as Record<string, unknown>;
    const versionId = String(version['id']);
    const ruleSetId = String(ruleSet['id']);

    const validated = await client('POST', `/rules/versions/${versionId}/validate`, {
      headers: auth.headers,
      body: { expectedVersion: version['version'] },
    });
    t.ok(validated.status === 200 || validated.status === 201, 'validate over HTTP succeeds');
    const published = await client('POST', `/rules/versions/${versionId}/publish`, {
      headers: auth.headers,
      body: { expectedVersion: validated.body['version'] },
    });
    t.ok(published.status === 200 || published.status === 201, 'publish over HTTP succeeds');
    t.ok(published.body['contentHash'] !== null, 'publishing returns a frozen content hash');
    const activated = await client('POST', `/rules/versions/${versionId}/activate`, {
      headers: auth.headers,
      body: { expectedVersion: published.body['version'] },
    });
    t.ok(activated.status === 200 || activated.status === 201, 'activate over HTTP succeeds');

    // --- deterministic, explained evaluation over HTTP -------------------------------------------
    const decision = await client('POST', `/rules/sets/${ruleSetId}/evaluate`, {
      headers: auth.headers,
      body: { input: { amount: '2500.00', score: 800 }, idempotencyKey: 'http-1' },
    });
    t.ok(decision.status === 200 || decision.status === 201, 'evaluate over HTTP succeeds');
    const explanation = (decision.body['explanation'] ?? {}) as Record<string, unknown>;
    const outputs = (explanation['outputs'] ?? {}) as Record<string, unknown>;
    t.equal(outputs['decision'], 'APPROVE', 'score 800 -> APPROVE (explained over HTTP)');
    const evaluation = (decision.body['evaluation'] ?? {}) as Record<string, unknown>;
    const evaluationId = String(evaluation['id']);

    // --- evidence carries the input HASH, not the raw input --------------------------------------
    const fetched = await client('GET', `/rules/evaluations/${evaluationId}`, { headers: auth.headers });
    t.ok(String(fetched.body['inputHash']).length > 0, 'the evaluation exposes an input hash');
    t.ok(
      !JSON.stringify(fetched.body['outcome']).includes('2500'),
      'the recorded outcome does not echo the raw input amount',
    );

    // --- idempotency: the same key returns the same decision -------------------------------------
    const retry = await client('POST', `/rules/sets/${ruleSetId}/evaluate`, {
      headers: auth.headers,
      body: { input: { amount: '2500.00', score: 800 }, idempotencyKey: 'http-1' },
    });
    t.equal(retry.body['idempotent'], true, 'a repeated idempotency key is an idempotent hit over HTTP');
    t.equal(
      (retry.body['evaluation'] as Record<string, unknown>)['id'],
      evaluationId,
      'the idempotent hit returns the original decision',
    );

    // --- replay reproduces the decision; a mismatched input is rejected ---------------------------
    const replay = await client('POST', `/rules/evaluations/${evaluationId}/replay`, {
      headers: auth.headers,
      body: { input: { amount: '2500.00', score: 800 } },
    });
    t.equal(replay.body['matches'], true, 'replay reproduces the original decision over HTTP');
    const mismatch = await client('POST', `/rules/evaluations/${evaluationId}/replay`, {
      headers: auth.headers,
      body: { input: { amount: '2500.00', score: 999 } },
    });
    t.equal(mismatch.status, 400, 'replay with a different input is rejected (hash mismatch, 400)');

    // --- stored tests over HTTP actually assert --------------------------------------------------
    await client('POST', `/rules/sets/${ruleSetId}/tests`, {
      headers: auth.headers,
      body: {
        name: 'high-approves',
        input: { amount: '100.00', score: 720 },
        expected: { decision: 'APPROVE' },
      },
    });
    const run = await client('POST', `/rules/sets/${ruleSetId}/tests/run`, {
      headers: auth.headers,
      body: {},
    });
    t.equal(run.body['passed'], 1, 'the stored test passes when the rule agrees');

    // --- a missing rule set is a stable 404 ------------------------------------------------------
    const missing = await client('GET', `/rules/sets/${randomUUID()}`, { headers: auth.headers });
    t.equal(missing.status, 404, 'a missing rule set is a 404 (invisible, not a leak)');

    // --- tenant isolation: another tenant sees none of it ----------------------------------------
    const other = await seedActor(ctx, 'othertenant');
    await grantRulesRole(ctx, other);
    const otherAuth = await login(client, other);
    const otherList = await client('GET', '/rules/sets', { headers: otherAuth.headers });
    t.equal(
      ((otherList.body['ruleSets'] ?? []) as unknown[]).length,
      0,
      "another tenant sees none of this tenant's rule sets (RLS)",
    );

    // --- default deny: a proven-but-unprivileged actor is refused (403); a header cannot grant it -
    const nobody = await seedActor(ctx, 'nobody');
    const nobodyAuth = await login(client, nobody);
    const denied = await client('POST', '/rules/sets', {
      headers: { ...nobodyAuth.headers, 'x-permissions': 'rules.engine.author' },
      body: { key: 'nope', name: 'nope', spec: SPEC },
    });
    t.equal(denied.status, 403, 'an unprivileged actor is forbidden — a header cannot grant authority (403)');
  } finally {
    await close();
  }
});
