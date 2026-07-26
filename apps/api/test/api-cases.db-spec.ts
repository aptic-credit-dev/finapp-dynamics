import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M13_PERMISSIONS, M13_PERMISSIONS } from '@finapp/m13-case';
import { ALL_M12_PERMISSIONS } from '@finapp/m12-feedback';

/**
 * THE CASES API, OVER HTTP, END TO END (Stage 3.2). Boots the real AppModule — including CasesModule + the m06
 * outbox m13 publishes through — and drives `/api/v1/cases`. It proves the surface works with permissions from a
 * REAL RBAC grant: activate a case type → create → open → triage → assign → decision (independent approver) →
 * resolve → close; the REAL M12→M13 feedback handoff (m12 request → m13 accept, idempotent, one case per
 * handoff); confidential-case redaction; and fail-closed 401/403 + cross-tenant isolation.
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

const CASE_TYPE = {
  schemaVersion: 1,
  code: 'complaint',
  name: 'Complaint',
  category: 'complaint',
  defaultConfidentiality: 'confidential',
  investigationSupport: true,
};

async function activateType(client: Client, auth: Auth): Promise<void> {
  const t = await client('POST', '/cases/types', {
    headers: auth.headers,
    body: { code: 'complaint', name: 'Complaint', spec: CASE_TYPE },
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

export default defineDbSpec('api-cases', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    const anon = await client('POST', '/cases', { body: { caseTypeCode: 'complaint', title: 'x' } });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a case (401)');

    const admin = await seedActor(ctx, 'caseadmin');
    await grantRole(ctx, admin, [...ALL_M13_PERMISSIONS, ...ALL_M12_PERMISSIONS], 'caseadmin');
    const auth = await login(client, admin);
    await activateType(client, auth);

    // Create (idempotent) a confidential case; a privileged caller sees its detail.
    const created = await client('POST', '/cases', {
      headers: { ...auth.headers, 'idempotency-key': 'case-http-1' },
      body: {
        caseTypeCode: 'complaint',
        title: 'Overcharged',
        description: 'sensitive detail',
        confidentiality: 'confidential',
        severity: 'high',
      },
    });
    t.ok(
      created.status === 200 || created.status === 201,
      `create a case over HTTP (got ${String(created.status)})`,
    );
    const caseId = String(created.body['id']);
    const dup = await client('POST', '/cases', {
      headers: { ...auth.headers, 'idempotency-key': 'case-http-1' },
      body: { caseTypeCode: 'complaint', title: 'Overcharged' },
    });
    t.equal(String(dup.body['id']), caseId, 'a repeated idempotency-key returns the same case');

    // Lifecycle: open → triage → assign → decision (independent approver) → resolve → close.
    const opened = await client('POST', `/cases/${caseId}/open`, {
      headers: auth.headers,
      body: { expectedVersion: created.body['version'] },
    });
    const triaged = await client('POST', `/cases/${caseId}/triage`, {
      headers: auth.headers,
      body: { expectedVersion: opened.body['version'], severity: 'critical', priority: 'urgent' },
    });
    const assigned = await client('POST', `/cases/${caseId}/assign`, {
      headers: auth.headers,
      body: { expectedVersion: triaged.body['version'], owner: admin.identityId },
    });
    t.equal(assigned.body['status'], 'assigned', 'the case is assigned over HTTP');

    const dec = await client('POST', `/cases/${caseId}/decisions`, {
      headers: auth.headers,
      body: { decisionType: 'uphold_complaint', summary: 'Upheld', remedyType: 'refund' },
    });
    const selfApprove = await client('POST', `/cases/decisions/${String(dec.body['id'])}/approve`, {
      headers: auth.headers,
    });
    t.equal(selfApprove.status, 409, 'the submitter cannot approve their own decision over HTTP (409)');

    const approver = await seedActor(ctx, 'caseapprover');
    await grantInTenant(ctx, admin.tenantId, approver, [M13_PERMISSIONS.decisionApprove], 'caseapprover');
    const approverAuth = await login(client, approver, admin.tenantId);
    const approved = await client('POST', `/cases/decisions/${String(dec.body['id'])}/approve`, {
      headers: approverAuth.headers,
    });
    t.equal(
      approved.body['approvalStatus'],
      'approved',
      'an independent approver approves the decision (SoD)',
    );

    const resolved = await client('POST', `/cases/${caseId}/resolve`, {
      headers: auth.headers,
      body: { expectedVersion: assigned.body['version'], summary: 'Refunded' },
    });
    const closed = await client('POST', `/cases/${caseId}/close`, {
      headers: auth.headers,
      body: { expectedVersion: resolved.body['version'] },
    });
    t.equal(closed.body['status'], 'closed', 'a fully-worked case closes over HTTP');

    // Confidential redaction: a caller without cases.confidential.read sees a redacted description.
    const reader = await seedActor(ctx, 'casereader');
    await grantInTenant(ctx, admin.tenantId, reader, [M13_PERMISSIONS.caseRead], 'casereader');
    const readerAuth = await login(client, reader, admin.tenantId);
    const redacted = await client('GET', `/cases/${caseId}`, { headers: readerAuth.headers });
    t.equal(
      redacted.body['description'],
      '[redacted]',
      'a caller without confidential.read sees a redacted description',
    );
    const privileged = await client('GET', `/cases/${caseId}`, { headers: auth.headers });
    t.equal(
      privileged.body['description'],
      'sensitive detail',
      'a privileged caller reads the confidential description',
    );

    // THE REAL M12 -> M13 HANDOFF over HTTP: m12 request a case handoff, m13 accepts it (idempotent).
    await client('POST', '/feedback/source-systems', {
      headers: auth.headers,
      body: { code: 'apticone', name: 'ApticOne', active: true },
    });
    const ing = await client('POST', '/feedback/ingest', {
      headers: auth.headers,
      body: {
        sourceSystem: 'apticone',
        externalTransactionId: 'EXT-CASE-1',
        transactionType: 'loan',
        product: 'loan',
        customerRef: 'cust-9',
      },
    });
    const fb = await client('POST', '/feedback/records', {
      headers: auth.headers,
      body: {
        sourceTransactionId: String(ing.body['transactionId']),
        customerRef: 'cust-9',
        product: 'loan',
        feedbackType: 'complaint',
      },
    });
    const fbId = String(fb.body['id']);
    // Capture the feedback so it is in a state from which converted_to_case is reachable (a raw pending_contact
    // feedback cannot be converted straight to a case).
    await client('POST', `/feedback/records/${fbId}/capture`, {
      headers: auth.headers,
      body: { expectedVersion: fb.body['version'], feedbackType: 'complaint' },
    });
    const ho = await client('POST', `/feedback/records/${fbId}/case-handoff`, {
      headers: auth.headers,
      body: { recommendedCaseType: 'complaint', summary: 'escalate' },
    });
    const handoffId = String(ho.body['id']);
    const accept = await client('POST', '/cases/handoff', {
      headers: auth.headers,
      body: { handoffId, caseTypeCode: 'complaint', title: 'From feedback' },
    });
    t.ok(accept.status === 200 || accept.status === 201, 'accept the M12 handoff over HTTP');
    t.equal(
      (accept.body['case'] as Record<string, unknown>)['source'],
      'feedback_handoff',
      'the created case records the feedback-handoff source',
    );
    const accept2 = await client('POST', '/cases/handoff', {
      headers: auth.headers,
      body: { handoffId, caseTypeCode: 'complaint', title: 'From feedback' },
    });
    t.equal(
      (accept2.body['case'] as Record<string, unknown>)['id'],
      (accept.body['case'] as Record<string, unknown>)['id'],
      'a repeat handoff returns the same case (one case per handoff)',
    );
    const convertedFb = await client('GET', `/feedback/records/${fbId}`, { headers: auth.headers });
    t.equal(
      convertedFb.body['status'],
      'converted_to_case',
      'the m12 feedback transitions to converted_to_case',
    );

    // A header cannot grant authority (403).
    const outsider = await seedActor(ctx, 'caseoutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/cases', {
      headers: { ...outsiderAuth.headers, 'x-permissions': ALL_M13_PERMISSIONS.join(',') },
      body: { caseTypeCode: 'complaint', title: 'nope' },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // Another tenant sees nothing.
    const otherAdmin = await seedActor(ctx, 'caseother');
    await grantRole(ctx, otherAdmin, ALL_M13_PERMISSIONS, 'caseother');
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/cases', { headers: otherAuth.headers });
    t.equal(
      (otherList.body['cases'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant cases (RLS)',
    );
  } finally {
    await close();
  }
});
