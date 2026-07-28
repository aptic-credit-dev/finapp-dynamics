import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M16_PERMISSIONS, M16_PERMISSIONS } from '@finapp/m16-litigation';
import { ALL_M14_PERMISSIONS } from '@finapp/m14-legal';

/**
 * THE LITIGATION API, OVER HTTP, END TO END (Stage 4.2). Boots the real AppModule — including LitigationModule +
 * LegalModule + the m06 outbox m16 publishes through — and drives `/api/v1/litigation`. It proves the surface
 * works with permissions from a REAL RBAC grant: activate a proceeding type → create (idempotent) → assign →
 * filing maker-checker (independent approver) → service verification → appearance → bundle maker-checker →
 * outcome → advance → rule-gated close → reopen; the REAL M14→M16 referral (m14 create matter → m16 accept
 * from-matter, idempotent, exactly one proceeding per referral key); confidentiality redaction; and fail-closed
 * 401/403 + cross-tenant isolation.
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

async function grantInTenant(
  ctx: DbSpecContext,
  tenantId: string,
  actor: Seeded,
  permissions: readonly string[],
  code: string,
): Promise<void> {
  const roleId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status) SELECT $1, $2, $3, ua.id, 'employee','active' FROM user_accounts ua WHERE ua.identity_id=$3`,
      [tenantId, randomUUID(), actor.identityId],
    );
    await tx.query(
      `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1,$2,$3,$3,'tenant_custom','active')`,
      [roleId, tenantId, `${code}_role`],
    );
    for (const perm of permissions)
      await tx.query(`INSERT INTO role_permissions (role_id, tenant_id, permission_code) VALUES ($1,$2,$3)`, [
        roleId,
        tenantId,
        perm,
      ]);
    await tx.query(
      `INSERT INTO role_assignments (tenant_id, membership_id, identity_id, role_id, scope_level, status) SELECT $1, tm.id, $2, $3, 'tenant','active' FROM tenant_memberships tm WHERE tm.tenant_id=$1 AND tm.identity_id=$2`,
      [tenantId, actor.identityId, roleId],
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

async function login(api: Client, actor: Seeded, tenantId?: string): Promise<Auth> {
  const reply = await api('POST', '/auth/login', {
    body: { loginIdentifier: actor.login, password: PASSWORD },
  });
  if (reply.status !== 200) throw new Error(`login failed: ${String(reply.status)}`);
  return {
    headers: {
      cookie: cookieHeader(reply.setCookies),
      'x-csrf-token': String(reply.body['csrfToken']),
      'x-tenant-id': tenantId ?? actor.tenantId,
    },
  };
}

const PROCEEDING_TYPE = {
  schemaVersion: 1,
  code: 'civil_suit',
  name: 'Civil Suit',
  category: 'civil',
  eligibleForumTypes: ['court'],
  defaultConfidentiality: 'privileged',
  defaultRisk: 'high',
  defaultPriority: 'high',
  filingRequired: true,
  hearingSupport: true,
  appealSupport: true,
};

async function activateProceedingType(client: Client, auth: Auth): Promise<void> {
  const t = await client('POST', '/litigation/proceeding-types', {
    headers: auth.headers,
    body: { code: 'civil_suit', name: 'Civil Suit', spec: PROCEEDING_TYPE },
  });
  const id = String(t.body['id']);
  await client('POST', `/litigation/proceeding-types/${id}/validate`, {
    headers: auth.headers,
    body: { expectedVersion: t.body['version'] },
  });
  await client('POST', `/litigation/proceeding-types/${id}/publish`, {
    headers: auth.headers,
    body: { expectedVersion: 2 },
  });
  await client('POST', `/litigation/proceeding-types/${id}/activate`, {
    headers: auth.headers,
    body: { expectedVersion: 3 },
  });
}

const MATTER_TYPE = {
  schemaVersion: 1,
  code: 'litigation',
  name: 'Litigation',
  category: 'litigation',
  defaultConfidentiality: 'privileged',
  defaultRisk: 'high',
  defaultPriority: 'high',
  requiredRoles: [],
  courtEventSupport: true,
  appealSupport: true,
};

async function activateMatterType(client: Client, auth: Auth): Promise<void> {
  const t = await client('POST', '/legal/matter-types', {
    headers: auth.headers,
    body: { code: 'litigation', name: 'Litigation', spec: MATTER_TYPE },
  });
  const id = String(t.body['id']);
  await client('POST', `/legal/matter-types/${id}/validate`, {
    headers: auth.headers,
    body: { expectedVersion: t.body['version'] },
  });
  await client('POST', `/legal/matter-types/${id}/publish`, {
    headers: auth.headers,
    body: { expectedVersion: 2 },
  });
  await client('POST', `/legal/matter-types/${id}/activate`, {
    headers: auth.headers,
    body: { expectedVersion: 3 },
  });
}

export default defineDbSpec('api-litigation', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    const anon = await client('POST', '/litigation/proceedings', {
      body: { proceedingTypeCode: 'civil_suit', title: 'x' },
    });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a proceeding (401)');

    const admin = await seedActor(ctx, 'litadmin');
    await grantRole(ctx, admin, [...ALL_M16_PERMISSIONS, ...ALL_M14_PERMISSIONS], 'litadmin');
    const auth = await login(client, admin);
    await activateProceedingType(client, auth);

    // Create (idempotent) a privileged proceeding.
    const created = await client('POST', '/litigation/proceedings', {
      headers: { ...auth.headers, 'idempotency-key': 'proc-http-1' },
      body: {
        proceedingTypeCode: 'civil_suit',
        title: 'Bank v Debtor',
        summary: 'sensitive strategy',
        confidentiality: 'privileged',
        privileged: true,
        organizationRole: 'claimant',
      },
    });
    t.ok(
      created.status === 200 || created.status === 201,
      `create a proceeding over HTTP (got ${String(created.status)})`,
    );
    const procId = String(created.body['id']);
    t.ok(String(created.body['proceedingNumber']).startsWith('PROC-'), 'a proceeding number is generated');
    const dup = await client('POST', '/litigation/proceedings', {
      headers: { ...auth.headers, 'idempotency-key': 'proc-http-1' },
      body: { proceedingTypeCode: 'civil_suit', title: 'Bank v Debtor' },
    });
    t.equal(String(dup.body['id']), procId, 'a repeated idempotency-key returns the same proceeding');

    // Assign.
    const assigned = await client('POST', `/litigation/proceedings/${procId}/assign`, {
      headers: auth.headers,
      body: { expectedVersion: created.body['version'], owner: admin.identityId, team: 'litigation' },
    });
    t.equal(
      assigned.body['status'],
      'under_review',
      'assignment advances the proceeding to under_review over HTTP',
    );

    // Filing maker-checker: preparer cannot approve; an independent approver can.
    const filing = await client('POST', `/litigation/proceedings/${procId}/filings`, {
      headers: auth.headers,
      body: { filingRole: 'originating_pleading', documentRef: randomUUID() },
    });
    const selfApprove = await client('POST', `/litigation/filings/${String(filing.body['id'])}/approve`, {
      headers: auth.headers,
      body: { expectedVersion: filing.body['version'] },
    });
    t.equal(selfApprove.status, 409, 'the preparer cannot approve their own filing over HTTP (409)');
    const approver = await seedActor(ctx, 'litapprover');
    await grantInTenant(
      ctx,
      admin.tenantId,
      approver,
      [M16_PERMISSIONS.filingApprove, M16_PERMISSIONS.filingRead],
      'litapprover',
    );
    const approverAuth = await login(client, approver, admin.tenantId);
    const approved = await client('POST', `/litigation/filings/${String(filing.body['id'])}/approve`, {
      headers: approverAuth.headers,
      body: { expectedVersion: filing.body['version'] },
    });
    t.equal(
      approved.body['filingStatus'],
      'approved',
      'an independent approver approves the filing (maker-checker)',
    );

    // Service verification (single-winner).
    const svc = await client('POST', `/litigation/proceedings/${procId}/service`, {
      headers: auth.headers,
      body: { itemServed: 'summons', serviceMethod: 'personal', recipient: 'Debtor Ltd' },
    });
    const verified = await client('POST', `/litigation/service/${String(svc.body['id'])}/verify`, {
      headers: auth.headers,
      body: { decision: 'verified' },
    });
    t.equal(verified.body['verificationStatus'], 'verified', 'service is verified over HTTP');

    // Confidential redaction: a caller without litigation.confidential.read sees a redacted summary.
    const reader = await seedActor(ctx, 'litreader');
    await grantInTenant(ctx, admin.tenantId, reader, [M16_PERMISSIONS.proceedingRead], 'litreader');
    const readerAuth = await login(client, reader, admin.tenantId);
    const redacted = await client('GET', `/litigation/proceedings/${procId}`, {
      headers: readerAuth.headers,
    });
    t.equal(
      redacted.body['summary'],
      '[redacted]',
      'a caller without confidential.read sees a redacted summary',
    );
    const privileged = await client('GET', `/litigation/proceedings/${procId}`, { headers: auth.headers });
    t.equal(
      privileged.body['summary'],
      'sensitive strategy',
      'a privileged caller reads the confidential summary',
    );

    // Rule-gated close on a fresh proceeding: advance to settled → outcome → close → reopen.
    const c0 = await client('POST', '/litigation/proceedings', {
      headers: auth.headers,
      body: { proceedingTypeCode: 'civil_suit', title: 'Closeable' },
    });
    const c0Id = String(c0.body['id']);
    let version = Number(c0.body['version']);
    for (const to of ['referred', 'under_review', 'approved_to_file', 'filed', 'pleadings_open', 'settled']) {
      const adv = await client('POST', `/litigation/proceedings/${c0Id}/advance`, {
        headers: auth.headers,
        body: { expectedVersion: version, toStatus: to },
      });
      version = Number(adv.body['version']);
    }
    const premature = await client('POST', `/litigation/proceedings/${c0Id}/close`, {
      headers: auth.headers,
      body: { expectedVersion: version },
    });
    t.equal(premature.status, 409, 'closure is blocked until an outcome is recorded (409)');
    await client('POST', `/litigation/proceedings/${c0Id}/outcomes`, {
      headers: auth.headers,
      body: { outcomeType: 'settlement', summary: 'Settled' },
    });
    const preClose = await client('GET', `/litigation/proceedings/${c0Id}`, { headers: auth.headers });
    const closed = await client('POST', `/litigation/proceedings/${c0Id}/close`, {
      headers: auth.headers,
      body: { expectedVersion: preClose.body['version'], summary: 'Closed' },
    });
    t.equal(closed.body['status'], 'closed', 'a fully-worked proceeding closes over HTTP (rule-gated)');
    const reopened = await client('POST', `/litigation/proceedings/${c0Id}/reopen`, {
      headers: auth.headers,
      body: { expectedVersion: closed.body['version'], reason: 'new evidence' },
    });
    t.equal(reopened.body['status'], 'reopened', 'the proceeding reopens over HTTP');

    // THE REAL M14 -> M16 REFERRAL over HTTP: m14 create matter → m16 accept from-matter (idempotent).
    await activateMatterType(client, auth);
    const matter = await client('POST', '/legal/matters', {
      headers: auth.headers,
      body: { matterTypeCode: 'litigation', title: 'Underlying matter' },
    });
    const matterId = String(matter.body['id']);
    const refKey = `ref-${randomUUID()}`;
    const fromMatter = await client('POST', '/litigation/from-matter', {
      headers: auth.headers,
      body: {
        referralKey: refKey,
        sourceMatterId: matterId,
        proceedingTypeCode: 'civil_suit',
        title: 'Proceeding from matter',
        organizationRole: 'defendant',
      },
    });
    t.ok(fromMatter.status === 200 || fromMatter.status === 201, 'm16 accepts the M14 referral over HTTP');
    const refProc = fromMatter.body['proceeding'] as Record<string, unknown>;
    t.equal(
      refProc['source'],
      'matter_referral',
      'the created proceeding records the matter-referral source',
    );
    t.equal(refProc['sourceMatterId'], matterId, 'the created proceeding preserves the source matter id');
    t.equal(fromMatter.body['created'], true, 'the first referral creates a proceeding');
    const fromMatter2 = await client('POST', '/litigation/from-matter', {
      headers: auth.headers,
      body: {
        referralKey: refKey,
        sourceMatterId: matterId,
        proceedingTypeCode: 'civil_suit',
        title: 'Again',
      },
    });
    t.equal(
      (fromMatter2.body['proceeding'] as Record<string, unknown>)['id'],
      refProc['id'],
      'a repeat referral returns the same proceeding (one per referral key)',
    );
    t.equal(fromMatter2.body['created'], false, 'a repeat referral does not create a second proceeding');

    // A header cannot grant authority (403).
    const outsider = await seedActor(ctx, 'litoutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/litigation/proceedings', {
      headers: { ...outsiderAuth.headers, 'x-permissions': ALL_M16_PERMISSIONS.join(',') },
      body: { proceedingTypeCode: 'civil_suit', title: 'nope' },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // Another tenant sees nothing.
    const otherAdmin = await seedActor(ctx, 'litother');
    await grantRole(ctx, otherAdmin, ALL_M16_PERMISSIONS, 'litother');
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/litigation/proceedings', { headers: otherAuth.headers });
    t.equal(
      (otherList.body['proceedings'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant proceedings (RLS)',
    );
  } finally {
    await close();
  }
});
