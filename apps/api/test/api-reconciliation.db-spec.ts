import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M15_PERMISSIONS, M15_PERMISSIONS } from '@finapp/m15-recon';

/**
 * THE BANK-RECONCILIATION API, OVER HTTP, END TO END (Stage 3). Boots the real AppModule — including
 * ReconciliationModule + the m06 outbox m15 publishes through — and drives `/api/v1/reconciliation`: register a bank
 * account -> create + publish a matching ruleset -> import statement + ledger lines (INTEGER MINOR UNITS) ->
 * create a run -> run deterministic matching -> read the auto-proposed match + confirm it; amounts read back as
 * STRINGS; plus fail-closed 401 (no auth) + 403 (forged permission header) + cross-tenant isolation (RLS).
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

export default defineDbSpec('api-reconciliation', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    const anon = await client('POST', '/reconciliation/bank-accounts', {
      body: { bankName: 'X', accountLabel: 'Y' },
    });
    t.equal(anon.status, 401, 'an anonymous caller cannot register a bank account (401)');

    const admin = await seedActor(ctx, 'reconadmin');
    await grantRole(ctx, admin, ALL_M15_PERMISSIONS, 'reconadmin');
    const auth = await login(client, admin);

    const acct = await client('POST', '/reconciliation/bank-accounts', {
      headers: auth.headers,
      body: { bankName: 'Acme Bank', accountLabel: 'Main' },
    });
    t.ok(
      acct.status === 200 || acct.status === 201,
      `register a bank account over HTTP (got ${String(acct.status)})`,
    );
    const acctId = String(acct.body['id']);

    const rs = await client('POST', '/reconciliation/rulesets', {
      headers: auth.headers,
      body: { code: 'default', dateWindowDays: 5, amountToleranceMinor: 0, requireOppositeDirection: true },
    });
    const rsId = String(rs.body['id']);
    await client('POST', `/reconciliation/rulesets/${rsId}/rules`, {
      headers: auth.headers,
      body: { ruleCode: 'AMT', ruleKind: 'exact_amount', weight: 50 },
    });
    await client('POST', `/reconciliation/rulesets/${rsId}/rules`, {
      headers: auth.headers,
      body: { ruleCode: 'REF', ruleKind: 'exact_reference', weight: 30 },
    });
    await client('POST', `/reconciliation/rulesets/${rsId}/rules`, {
      headers: auth.headers,
      body: { ruleCode: 'DATE', ruleKind: 'date_window', weight: 20 },
    });
    const pub = await client('POST', `/reconciliation/rulesets/${rsId}/publish`, {
      headers: auth.headers,
      body: { expectedVersion: rs.body['version'] },
    });
    t.equal(pub.body['status'], 'active', 'a matching ruleset publishes over HTTP');

    const stmt = await client('POST', '/reconciliation/statement-imports', {
      headers: auth.headers,
      body: {
        bankAccountId: acctId,
        sourceFormat: 'csv',
        fileHash: 'H1',
        lines: [{ txnDate: '2026-01-10', amountMinor: 10000, direction: 'credit', reference: 'INV-001' }],
      },
    });
    t.ok(stmt.status === 200 || stmt.status === 201, 'import a bank statement over HTTP');
    await client('POST', '/reconciliation/ledger-imports', {
      headers: auth.headers,
      body: {
        bankAccountId: acctId,
        sourceFormat: 'api',
        fileHash: 'L1',
        entries: [{ entryDate: '2026-01-10', amountMinor: 10000, direction: 'debit', reference: 'INV-001' }],
      },
    });

    const run = await client('POST', '/reconciliation/runs', {
      headers: auth.headers,
      body: { bankAccountId: acctId, rulesetId: rsId },
    });
    const runId = String(run.body['id']);
    const matched = await client('POST', `/reconciliation/runs/${runId}/run-matching`, {
      headers: auth.headers,
      body: { expectedVersion: run.body['version'] },
    });
    t.equal(matched.body['status'], 'review', 'running matching advances the run to review over HTTP');

    const matches = await client('GET', `/reconciliation/runs/${runId}/matches`, { headers: auth.headers });
    const list = matches.body['matches'] as Record<string, unknown>[];
    t.ok(list.length >= 1, 'the deterministic engine auto-proposed a match');
    const proposed = list.find((m) => m['status'] === 'proposed');
    t.ok(
      proposed !== undefined &&
        (proposed['amountVarianceMinor'] === '0' || proposed['amountVarianceMinor'] === 0),
      'the amount variance reads back deterministically (minor units, not a float)',
    );
    if (proposed !== undefined) {
      const confirm = await client('POST', `/reconciliation/matches/${String(proposed['id'])}/confirm`, {
        headers: auth.headers,
        body: { expectedVersion: proposed['version'] },
      });
      t.equal(confirm.body['status'], 'confirmed', 'a proposed match confirms over HTTP');
    }

    const outsider = await seedActor(ctx, 'reconoutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/reconciliation/bank-accounts', {
      headers: { ...outsiderAuth.headers, 'x-permissions': M15_PERMISSIONS.bankAccountManage },
      body: { bankName: 'no', accountLabel: 'no' },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    const otherAdmin = await seedActor(ctx, 'reconother');
    await grantRole(ctx, otherAdmin, ALL_M15_PERMISSIONS, 'reconother');
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/reconciliation/bank-accounts', { headers: otherAuth.headers });
    t.equal(
      (otherList.body['bankAccounts'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant bank accounts (RLS)',
    );
    const otherGet = await client('GET', `/reconciliation/runs/${runId}`, { headers: otherAuth.headers });
    t.equal(otherGet.status, 404, "another tenant cannot read this tenant's run (RLS -> 404)");
  } finally {
    await close();
  }
});
