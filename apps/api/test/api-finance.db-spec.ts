import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M19_PERMISSIONS, M19_PERMISSIONS } from '@finapp/m19-finance';

/**
 * THE FINANCE-FOUNDATION API, OVER HTTP, END TO END (Stage 3.1). Boots the real AppModule — including FinanceModule
 * + the m06 outbox m19 publishes through — and drives `/api/v1/finance`. It proves the surface works with
 * permissions from a REAL RBAC grant: register an accounting entity → account type → currency; create a ledger
 * account → activate; create a fiscal year → period → close the period (period.close); create finance config →
 * publish (config.publish); record + read back an EXACT-decimal exchange rate (string, never a float); and
 * fail-closed 401 (no auth) + 403 (forged permission header) + cross-tenant isolation (RLS).
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

export default defineDbSpec('api-finance', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    // Fail closed: an anonymous caller cannot register an entity.
    const anon = await client('POST', '/finance/entities', { body: { code: 'X', name: 'X' } });
    t.equal(anon.status, 401, 'an anonymous caller cannot register an entity (401)');

    const admin = await seedActor(ctx, 'finadmin');
    await grantRole(ctx, admin, ALL_M19_PERMISSIONS, 'finadmin');
    const auth = await login(client, admin);

    // Register entity → account type → currencies.
    const entity = await client('POST', '/finance/entities', {
      headers: auth.headers,
      body: { code: 'ACME', name: 'Acme Ltd', functionalCurrencyCode: 'USD' },
    });
    t.ok(
      entity.status === 200 || entity.status === 201,
      `register an entity over HTTP (got ${String(entity.status)})`,
    );
    const entityId = String(entity.body['id']);
    const at = await client('POST', '/finance/account-types', {
      headers: auth.headers,
      body: { code: 'AST', name: 'Assets', accountClass: 'asset' },
    });
    const accountTypeId = String(at.body['id']);
    const usd = await client('POST', '/finance/currencies', {
      headers: auth.headers,
      body: { code: 'USD', name: 'US Dollar', minorUnits: 2 },
    });
    const eur = await client('POST', '/finance/currencies', {
      headers: auth.headers,
      body: { code: 'EUR', name: 'Euro', minorUnits: 2 },
    });
    const usdId = String(usd.body['id']);
    const eurId = String(eur.body['id']);

    // Ledger account → activate.
    const account = await client('POST', '/finance/accounts', {
      headers: auth.headers,
      body: { entityId, accountTypeId, code: '1000', name: 'Cash', currencyId: usdId },
    });
    t.equal(account.body['status'], 'draft', 'a new account is draft over HTTP');
    const accountId = String(account.body['id']);
    const activated = await client('POST', `/finance/accounts/${accountId}/activate`, {
      headers: auth.headers,
      body: { expectedVersion: account.body['version'] },
    });
    t.equal(activated.body['status'], 'active', 'an account activates over HTTP');

    // Fiscal year → period → close (period.close is privileged).
    const fy = await client('POST', '/finance/fiscal-years', {
      headers: auth.headers,
      body: { entityId, code: 'FY26', startDate: '2026-01-01', endDate: '2026-12-31' },
    });
    const fyId = String(fy.body['id']);
    const period = await client('POST', `/finance/fiscal-years/${fyId}/periods`, {
      headers: auth.headers,
      body: { periodNumber: 1, startDate: '2026-01-01', endDate: '2026-01-31' },
    });
    t.equal(period.body['status'], 'open', 'a new period is open over HTTP');
    const periodId = String(period.body['id']);
    const closedPeriod = await client('POST', `/finance/periods/${periodId}/close`, {
      headers: auth.headers,
      body: { expectedVersion: period.body['version'] },
    });
    t.equal(closedPeriod.body['status'], 'closed', 'a period closes over HTTP (the posting gate)');

    // Finance config → publish.
    const cfg = await client('POST', '/finance/configs', {
      headers: auth.headers,
      body: { entityId, scope: 'default', settings: { defaultCurrency: 'USD' } },
    });
    const cfgId = String(cfg.body['id']);
    const publishedCfg = await client('POST', `/finance/configs/${cfgId}/publish`, {
      headers: auth.headers,
      body: { expectedVersion: cfg.body['version'] },
    });
    t.equal(publishedCfg.body['status'], 'active', 'a finance config publishes over HTTP');

    // DECIMAL-SAFE exchange rate: record + read back as a STRING (no float rounding).
    const rate = await client('POST', '/finance/exchange-rates', {
      headers: auth.headers,
      body: { baseCurrencyId: usdId, quoteCurrencyId: eurId, rate: '1.234567891234', rateDate: '2026-01-01' },
    });
    t.ok(rate.status === 200 || rate.status === 201, 'record an exchange rate over HTTP');
    t.equal(
      rate.body['rate'],
      '1.234567891234',
      'the exact-decimal rate reads back as a string (never a float)',
    );

    // A header cannot grant authority (403).
    const outsider = await seedActor(ctx, 'finoutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/finance/entities', {
      headers: { ...outsiderAuth.headers, 'x-permissions': M19_PERMISSIONS.entityManage },
      body: { code: 'NO', name: 'nope' },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // Another tenant sees nothing.
    const otherAdmin = await seedActor(ctx, 'finother');
    await grantRole(ctx, otherAdmin, ALL_M19_PERMISSIONS, 'finother');
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/finance/entities', { headers: otherAuth.headers });
    t.equal(
      (otherList.body['entities'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant entities (RLS)',
    );
    const otherGet = await client('GET', `/finance/accounts/${accountId}`, { headers: otherAuth.headers });
    t.equal(otherGet.status, 404, "another tenant cannot read this tenant's account (RLS -> 404)");
  } finally {
    await close();
  }
});
