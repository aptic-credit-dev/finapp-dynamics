import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M18_PERMISSIONS, M18_PERMISSIONS } from '@finapp/m18-legaldocs';

/**
 * THE LEGAL-DOCUMENTS API, OVER HTTP, END TO END (Stage 4.4). Boots the real AppModule — including LegaldocsModule
 * + the m06 outbox m18 publishes through — and drives `/api/v1/legaldocs`. It proves the surface works with
 * permissions from a REAL RBAC grant: create a knowledge record (idempotent) → submit → approve (independent
 * approver, maker-checker) → publish (content_hash frozen); a document template AND a clause each through the
 * maker-checker publish path; an opaque cross-module document reference; keyword search; confidentiality redaction
 * of the sensitive `abstract` on read; and fail-closed 401 (no auth) + 403 (forged permission header) +
 * cross-tenant isolation (RLS).
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

export default defineDbSpec('api-legaldocs', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    // Fail closed: an anonymous caller cannot create a knowledge record.
    const anon = await client('POST', '/legaldocs/knowledge', {
      body: { knowledgeType: 'legal_memo', title: 'x' },
    });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a knowledge record (401)');

    const admin = await seedActor(ctx, 'ldadmin');
    await grantRole(ctx, admin, ALL_M18_PERMISSIONS, 'ldadmin');
    const auth = await login(client, admin);

    const SENSITIVE = `privileged-abstract-${randomUUID()}`;

    // Create (idempotent) a confidential/privileged knowledge record.
    const created = await client('POST', '/legaldocs/knowledge', {
      headers: { ...auth.headers, 'idempotency-key': 'kn-http-1' },
      body: {
        knowledgeType: 'legal_memo',
        title: 'Charge Enforcement Memo',
        summary: 'public summary',
        abstract: SENSITIVE,
        confidentiality: 'confidential',
        privileged: true,
        practiceArea: 'banking',
        jurisdiction: 'KE',
      },
    });
    t.ok(
      created.status === 200 || created.status === 201,
      `create a knowledge record over HTTP (got ${String(created.status)})`,
    );
    const knId = String(created.body['id']);
    t.ok(String(created.body['knowledgeNumber']).startsWith('KNOW-'), 'a knowledge number is generated');
    const dup = await client('POST', '/legaldocs/knowledge', {
      headers: { ...auth.headers, 'idempotency-key': 'kn-http-1' },
      body: { knowledgeType: 'legal_memo', title: 'Charge Enforcement Memo' },
    });
    t.equal(String(dup.body['id']), knId, 'a repeated idempotency-key returns the same record');

    // Lifecycle: submit → (self-approve blocked) → independent approve → publish.
    const submitted = await client('POST', `/legaldocs/knowledge/${knId}/submit`, {
      headers: auth.headers,
      body: { expectedVersion: created.body['version'] },
    });
    t.equal(submitted.body['status'], 'under_review', 'submit advances to under_review over HTTP');
    const selfApprove = await client('POST', `/legaldocs/knowledge/${knId}/approve`, {
      headers: auth.headers,
      body: { expectedVersion: submitted.body['version'] },
    });
    t.equal(selfApprove.status, 409, 'the submitter cannot approve their own record over HTTP (409)');

    const approverActor = await seedActor(ctx, 'ldapprover');
    await grantInTenant(
      ctx,
      admin.tenantId,
      approverActor,
      [
        M18_PERMISSIONS.knowledgeRead,
        M18_PERMISSIONS.knowledgeApprove,
        M18_PERMISSIONS.knowledgePublish,
        M18_PERMISSIONS.templateRead,
        M18_PERMISSIONS.templateApprove,
        M18_PERMISSIONS.templatePublish,
        M18_PERMISSIONS.clauseRead,
        M18_PERMISSIONS.clauseApprove,
        M18_PERMISSIONS.clausePublish,
      ],
      'ldapprover',
    );
    const approverAuth = await login(client, approverActor, admin.tenantId);
    const approved = await client('POST', `/legaldocs/knowledge/${knId}/approve`, {
      headers: approverAuth.headers,
      body: { expectedVersion: submitted.body['version'] },
    });
    t.equal(
      approved.body['status'],
      'approved',
      'an independent approver approves over HTTP (maker-checker)',
    );
    const published = await client('POST', `/legaldocs/knowledge/${knId}/publish`, {
      headers: auth.headers,
      body: { expectedVersion: approved.body['version'] },
    });
    t.equal(published.body['status'], 'published', 'an approved record publishes over HTTP');
    t.ok(published.body['contentHash'] !== null, 'publishing freezes a content hash');

    // An opaque cross-module document reference (m09 bytes; m18 stores the reference only).
    const ref = await client('POST', `/legaldocs/knowledge/${knId}/references`, {
      headers: auth.headers,
      body: { refType: 'document', targetId: randomUUID(), label: 'source brief' },
    });
    t.ok(ref.status === 200 || ref.status === 201, 'a cross-module document reference is linked over HTTP');
    t.equal(ref.body['refType'], 'document', 'the reference records the document module');

    // A document TEMPLATE through the maker-checker publish path.
    const tmpl = await client('POST', '/legaldocs/templates', {
      headers: auth.headers,
      body: {
        templateCode: 'nda',
        title: 'NDA Template',
        guidance: 'sensitive guidance',
        contentRef: randomUUID(),
      },
    });
    const tmplId = String(tmpl.body['id']);
    const tmplSub = await client('POST', `/legaldocs/templates/${tmplId}/submit`, {
      headers: auth.headers,
      body: { expectedVersion: tmpl.body['version'] },
    });
    const tmplSelf = await client('POST', `/legaldocs/templates/${tmplId}/approve`, {
      headers: auth.headers,
      body: { expectedVersion: tmplSub.body['version'] },
    });
    t.equal(tmplSelf.status, 409, 'the template submitter cannot approve over HTTP (409)');
    const tmplApp = await client('POST', `/legaldocs/templates/${tmplId}/approve`, {
      headers: approverAuth.headers,
      body: { expectedVersion: tmplSub.body['version'] },
    });
    t.equal(
      tmplApp.body['status'],
      'approved',
      'an independent approver approves the template (maker-checker)',
    );
    const tmplPub = await client('POST', `/legaldocs/templates/${tmplId}/publish`, {
      headers: auth.headers,
      body: { expectedVersion: tmplApp.body['version'] },
    });
    t.equal(tmplPub.body['status'], 'published', 'the template publishes over HTTP');

    // A library CLAUSE through the maker-checker publish path.
    const clause = await client('POST', '/legaldocs/clauses', {
      headers: auth.headers,
      body: { clauseCode: 'governing-law', title: 'Governing Law', contentRef: randomUUID() },
    });
    const clauseId = String(clause.body['id']);
    const clauseSub = await client('POST', `/legaldocs/clauses/${clauseId}/submit`, {
      headers: auth.headers,
      body: { expectedVersion: clause.body['version'] },
    });
    const clauseApp = await client('POST', `/legaldocs/clauses/${clauseId}/approve`, {
      headers: approverAuth.headers,
      body: { expectedVersion: clauseSub.body['version'] },
    });
    t.equal(
      clauseApp.body['status'],
      'approved',
      'an independent approver approves the clause (maker-checker)',
    );
    const clausePub = await client('POST', `/legaldocs/clauses/${clauseId}/publish`, {
      headers: auth.headers,
      body: { expectedVersion: clauseApp.body['version'] },
    });
    t.equal(clausePub.body['status'], 'published', 'the clause publishes over HTTP');

    // Keyword search returns the published knowledge record.
    const search = await client('GET', '/legaldocs/knowledge?knowledgeType=legal_memo', {
      headers: auth.headers,
    });
    t.ok(
      (search.body['results'] as unknown[]).length >= 1,
      'keyword search returns the published knowledge record',
    );

    // Confidentiality redaction: a caller without confidential.read sees a nulled abstract.
    const reader = await seedActor(ctx, 'ldreader');
    await grantInTenant(ctx, admin.tenantId, reader, [M18_PERMISSIONS.knowledgeRead], 'ldreader');
    const readerAuth = await login(client, reader, admin.tenantId);
    const redacted = await client('GET', `/legaldocs/knowledge/${knId}`, { headers: readerAuth.headers });
    t.equal(redacted.body['abstract'], null, 'a caller without confidential.read sees a nulled abstract');
    const privileged = await client('GET', `/legaldocs/knowledge/${knId}`, { headers: auth.headers });
    t.equal(privileged.body['abstract'], SENSITIVE, 'a caller with confidential.read reads the abstract');

    // A header cannot grant authority (403).
    const outsider = await seedActor(ctx, 'ldoutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/legaldocs/knowledge', {
      headers: { ...outsiderAuth.headers, 'x-permissions': ALL_M18_PERMISSIONS.join(',') },
      body: { knowledgeType: 'legal_memo', title: 'nope' },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // Another tenant sees nothing.
    const otherAdmin = await seedActor(ctx, 'ldother');
    await grantRole(ctx, otherAdmin, ALL_M18_PERMISSIONS, 'ldother');
    const otherAuth = await login(client, otherAdmin);
    const otherSearch = await client('GET', '/legaldocs/knowledge', { headers: otherAuth.headers });
    t.equal(
      (otherSearch.body['results'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant records (RLS)',
    );
    const otherGet = await client('GET', `/legaldocs/knowledge/${knId}`, { headers: otherAuth.headers });
    t.equal(otherGet.status, 404, "another tenant cannot read this tenant's record (RLS -> 404)");
  } finally {
    await close();
  }
});
