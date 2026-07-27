import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M14_PERMISSIONS, M14_PERMISSIONS } from '@finapp/m14-legal';
import { ALL_M13_PERMISSIONS } from '@finapp/m13-case';

/**
 * THE LEGAL API, OVER HTTP, END TO END (Stage 4.1). Boots the real AppModule — including LegalModule + CasesModule
 * + the m06 outbox m14 publishes through — and drives `/api/v1/legal`. It proves the surface works with permissions
 * from a REAL RBAC grant: activate a matter type → create (idempotent) → controlled instruction accept/reject →
 * open → assign → resolve → record outcome → rule-gated close → reopen; settlement maker-checker (independent
 * approver); confidential/privileged redaction; the REAL M13→M14 conversion (m13 create case → m13 convert-to-matter
 * → m14 accept from-case, idempotent, exactly one matter per source case); and fail-closed 401/403 + cross-tenant
 * isolation.
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

async function activateType(client: Client, auth: Auth): Promise<void> {
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

const CASE_TYPE = {
  schemaVersion: 1,
  code: 'dispute',
  name: 'Dispute',
  category: 'dispute',
  defaultConfidentiality: 'confidential',
};

async function activateCaseType(client: Client, auth: Auth): Promise<void> {
  const t = await client('POST', '/cases/types', {
    headers: auth.headers,
    body: { code: 'dispute', name: 'Dispute', spec: CASE_TYPE },
  });
  const id = String(t.body['id']);
  await client('POST', `/cases/types/${id}/validate`, {
    headers: auth.headers,
    body: { expectedVersion: t.body['version'] },
  });
  await client('POST', `/cases/types/${id}/publish`, { headers: auth.headers, body: { expectedVersion: 2 } });
  await client('POST', `/cases/types/${id}/activate`, {
    headers: auth.headers,
    body: { expectedVersion: 3 },
  });
}

export default defineDbSpec('api-legal', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    const anon = await client('POST', '/legal/matters', {
      body: { matterTypeCode: 'litigation', title: 'x' },
    });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a matter (401)');

    const admin = await seedActor(ctx, 'legaladmin');
    await grantRole(ctx, admin, [...ALL_M14_PERMISSIONS, ...ALL_M13_PERMISSIONS], 'legaladmin');
    const auth = await login(client, admin);
    await activateType(client, auth);

    // Create (idempotent) a privileged matter; a privileged caller sees its detail.
    const created = await client('POST', '/legal/matters', {
      headers: { ...auth.headers, 'idempotency-key': 'matter-http-1' },
      body: {
        matterTypeCode: 'litigation',
        title: 'Bank v Debtor',
        legalDescription: 'sensitive strategy',
        confidentiality: 'privileged',
        privileged: true,
        legalRisk: 'high',
      },
    });
    t.ok(
      created.status === 200 || created.status === 201,
      `create a matter over HTTP (got ${String(created.status)})`,
    );
    const matterId = String(created.body['id']);
    t.ok(String(created.body['matterNumber']).startsWith('MATTER-'), 'a matter number is generated');
    const dup = await client('POST', '/legal/matters', {
      headers: { ...auth.headers, 'idempotency-key': 'matter-http-1' },
      body: { matterTypeCode: 'litigation', title: 'Bank v Debtor' },
    });
    t.equal(String(dup.body['id']), matterId, 'a repeated idempotency-key returns the same matter');

    // Controlled instruction: accept then reject.
    const ins1 = await client('POST', `/legal/matters/${matterId}/instructions`, {
      headers: auth.headers,
      body: { instructionType: 'litigate', summary: 'Defend the claim' },
    });
    const acc = await client('POST', `/legal/instructions/${String(ins1.body['id'])}/accept`, {
      headers: auth.headers,
      body: { expectedVersion: ins1.body['version'] },
    });
    t.equal(acc.body['acceptanceStatus'], 'accepted', 'an instruction is accepted over HTTP');
    const ins2 = await client('POST', `/legal/matters/${matterId}/instructions`, {
      headers: auth.headers,
      body: { instructionType: 'settle', summary: 'Consider settlement' },
    });
    const rej = await client('POST', `/legal/instructions/${String(ins2.body['id'])}/reject`, {
      headers: auth.headers,
      body: { expectedVersion: ins2.body['version'], reason: 'out of mandate' },
    });
    t.equal(rej.body['acceptanceStatus'], 'rejected', 'an instruction is rejected over HTTP');

    // Lifecycle: open → assign → resolve → record outcome → rule-gated close → reopen.
    const opened = await client('POST', `/legal/matters/${matterId}/open`, {
      headers: auth.headers,
      body: { expectedVersion: created.body['version'] },
    });
    const assigned = await client('POST', `/legal/matters/${matterId}/assign`, {
      headers: auth.headers,
      body: { expectedVersion: opened.body['version'], owner: admin.identityId, team: 'litigation' },
    });
    t.equal(
      assigned.body['status'],
      'legal_review',
      'assignment advances the matter to legal_review over HTTP',
    );
    const resolved = await client('POST', `/legal/matters/${matterId}/resolve`, {
      headers: auth.headers,
      body: { expectedVersion: assigned.body['version'], summary: 'Settled' },
    });
    // Closure is rule-gated: an outcome must be recorded first.
    const prematureClose = await client('POST', `/legal/matters/${matterId}/close`, {
      headers: auth.headers,
      body: { expectedVersion: resolved.body['version'] },
    });
    t.equal(prematureClose.status, 409, 'closure is blocked until an outcome is recorded (409)');
    await client('POST', `/legal/matters/${matterId}/outcomes`, {
      headers: auth.headers,
      body: { outcomeType: 'settlement', summary: 'Settled', amountAwardedMinor: 500000, currency: 'KES' },
    });
    // Recording an outcome may stamp the matter, so re-read the current version before closing.
    const preClose = await client('GET', `/legal/matters/${matterId}`, { headers: auth.headers });
    const closed = await client('POST', `/legal/matters/${matterId}/close`, {
      headers: auth.headers,
      body: { expectedVersion: preClose.body['version'], summary: 'Closed' },
    });
    t.equal(closed.body['status'], 'closed', 'a fully-worked matter closes over HTTP (rule-gated)');
    const reopened = await client('POST', `/legal/matters/${matterId}/reopen`, {
      headers: auth.headers,
      body: { expectedVersion: closed.body['version'], reason: 'new evidence' },
    });
    t.equal(reopened.body['status'], 'reopened', 'the matter reopens over HTTP');

    // Settlement maker-checker: the proposer cannot approve; an independent approver can.
    const settle = await client('POST', `/legal/matters/${matterId}/settlements`, {
      headers: auth.headers,
      body: {
        proposal: 'Pay 500k',
        amountMinor: 500000,
        currency: 'KES',
        confidentialTerms: 'secret schedule',
      },
    });
    const selfApprove = await client('POST', `/legal/settlements/${String(settle.body['id'])}/approve`, {
      headers: auth.headers,
    });
    t.equal(selfApprove.status, 409, 'the proposer cannot approve their own settlement over HTTP (409)');
    const approver = await seedActor(ctx, 'legalapprover');
    await grantInTenant(ctx, admin.tenantId, approver, [M14_PERMISSIONS.settlementApprove], 'legalapprover');
    const approverAuth = await login(client, approver, admin.tenantId);
    const approved = await client('POST', `/legal/settlements/${String(settle.body['id'])}/approve`, {
      headers: approverAuth.headers,
    });
    t.equal(
      approved.body['approvalStatus'],
      'approved',
      'an independent approver approves the settlement (SoD)',
    );

    // Confidential/privileged redaction: a caller without legal.confidential.read sees a redacted description.
    const reader = await seedActor(ctx, 'legalreader');
    await grantInTenant(ctx, admin.tenantId, reader, [M14_PERMISSIONS.matterRead], 'legalreader');
    const readerAuth = await login(client, reader, admin.tenantId);
    const redacted = await client('GET', `/legal/matters/${matterId}`, { headers: readerAuth.headers });
    t.equal(
      redacted.body['legalDescription'],
      '[redacted]',
      'a caller without confidential.read sees a redacted description',
    );
    const privileged = await client('GET', `/legal/matters/${matterId}`, { headers: auth.headers });
    t.equal(
      privileged.body['legalDescription'],
      'sensitive strategy',
      'a privileged caller reads the confidential description',
    );

    // THE REAL M13 -> M14 CONVERSION over HTTP: m13 create case → convert-to-matter → m14 accept from-case.
    await activateCaseType(client, auth);
    const theCase = await client('POST', '/cases', {
      headers: auth.headers,
      body: { caseTypeCode: 'dispute', title: 'Escalated dispute' },
    });
    const caseId = String(theCase.body['id']);
    const convert = await client('POST', `/cases/${caseId}/convert-to-matter`, {
      headers: auth.headers,
      body: { recommendedMatterType: 'litigation', reason: 'litigation required' },
    });
    t.ok(convert.status === 200 || convert.status === 201, 'm13 converts the case to a matter over HTTP');
    const fromCase = await client('POST', '/legal/from-case', {
      headers: auth.headers,
      body: {
        sourceCaseId: caseId,
        matterTypeCode: 'litigation',
        title: 'From case',
        recommendedMatterType: 'litigation',
      },
    });
    t.ok(fromCase.status === 200 || fromCase.status === 201, 'm14 accepts the M13 conversion over HTTP');
    const convMatter = fromCase.body['matter'] as Record<string, unknown>;
    t.equal(convMatter['source'], 'case_conversion', 'the created matter records the case-conversion source');
    t.equal(convMatter['sourceCaseId'], caseId, 'the created matter preserves the source case id');
    t.equal(fromCase.body['created'], true, 'the first conversion creates a matter');
    const fromCase2 = await client('POST', '/legal/from-case', {
      headers: auth.headers,
      body: { sourceCaseId: caseId, matterTypeCode: 'litigation', title: 'From case again' },
    });
    t.equal(
      (fromCase2.body['matter'] as Record<string, unknown>)['id'],
      convMatter['id'],
      'a repeat conversion returns the same matter (exactly one matter per source case)',
    );
    t.equal(fromCase2.body['created'], false, 'a repeat conversion does not create a second matter');

    // A header cannot grant authority (403).
    const outsider = await seedActor(ctx, 'legaloutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/legal/matters', {
      headers: { ...outsiderAuth.headers, 'x-permissions': ALL_M14_PERMISSIONS.join(',') },
      body: { matterTypeCode: 'litigation', title: 'nope' },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // Another tenant sees nothing.
    const otherAdmin = await seedActor(ctx, 'legalother');
    await grantRole(ctx, otherAdmin, ALL_M14_PERMISSIONS, 'legalother');
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/legal/matters', { headers: otherAuth.headers });
    t.equal(
      (otherList.body['matters'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant matters (RLS)',
    );
  } finally {
    await close();
  }
});
