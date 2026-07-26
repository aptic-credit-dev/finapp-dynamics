import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M09_PERMISSIONS } from '@finapp/m09-docs';

/**
 * THE DOCUMENTS API, OVER HTTP, END TO END (Stage 2.5). Boots the real AppModule — including DocumentsModule and
 * the m06 WorkflowOutbox m09 publishes through — and drives `/api/v1/documents`. It proves the surface works
 * (author type/retention → create document → initiate upload → legal hold → disposition, with permissions from a
 * REAL RBAC grant), that version views REDACT the internal storage reference, that upload completion is
 * server-verified (a completion with no stored object fails), and that it fails closed: 401 anon, 403
 * unprivileged (an x-permissions header cannot grant), and another tenant sees nothing.
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

async function grantDocsRole(ctx: DbSpecContext, actor: Seeded): Promise<void> {
  const roleId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1,$2,'docs_admin','Docs admin','tenant_custom','active')`,
      [roleId, actor.tenantId],
    );
    for (const perm of ALL_M09_PERMISSIONS)
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

const RETENTION = {
  schemaVersion: 1,
  code: 'std',
  name: 'Standard',
  retentionDays: 30,
  trigger: 'on_activation',
  dispositionAction: 'review',
  reviewRequired: true,
};
const TYPE = {
  schemaVersion: 1,
  code: 'contract',
  name: 'Contract',
  allowedMediaTypes: ['application/pdf'],
  defaultClassification: 'confidential',
  retentionPolicyCode: 'std',
  requiredMetadata: [{ name: 'counterparty', type: 'string', required: true }],
  approvalRequired: false,
  signatureRequired: false,
  scanRequired: true,
};

async function publishType(client: Client, auth: Auth): Promise<void> {
  const rp = await client('POST', '/documents/retention-policies', {
    headers: auth.headers,
    body: { code: 'std', name: 'Standard', spec: RETENTION },
  });
  await client('POST', `/documents/retention-policies/${(rp.body as { id: string }).id}/validate`, {
    headers: auth.headers,
    body: { expectedVersion: rp.body['version'] },
  });
  const rpv = await client('POST', `/documents/retention-policies/${String(rp.body['id'])}/publish`, {
    headers: auth.headers,
    body: { expectedVersion: 2 },
  });
  await client('POST', `/documents/retention-policies/${String(rp.body['id'])}/activate`, {
    headers: auth.headers,
    body: { expectedVersion: rpv.body['version'] },
  });
  const ty = await client('POST', '/documents/types', {
    headers: auth.headers,
    body: { code: 'contract', name: 'Contract', spec: TYPE },
  });
  await client('POST', `/documents/types/${String(ty.body['id'])}/validate`, {
    headers: auth.headers,
    body: { expectedVersion: ty.body['version'] },
  });
  const typ = await client('POST', `/documents/types/${String(ty.body['id'])}/publish`, {
    headers: auth.headers,
    body: { expectedVersion: 2 },
  });
  await client('POST', `/documents/types/${String(ty.body['id'])}/activate`, {
    headers: auth.headers,
    body: { expectedVersion: typ.body['version'] },
  });
}

export default defineDbSpec('api-documents', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    const anon = await client('POST', '/documents/documents', {
      body: { code: 'x', title: 'x', documentType: 'contract' },
    });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a document (401)');

    const admin = await seedActor(ctx, 'docsadmin');
    await grantDocsRole(ctx, admin);
    const auth = await login(client, admin);
    await publishType(client, auth);

    const created = await client('POST', '/documents/documents', {
      headers: { ...auth.headers, 'idempotency-key': 'doc-http-1' },
      body: {
        code: 'DOC-HTTP-1',
        title: 'HTTP Contract',
        documentType: 'contract',
        metadata: { counterparty: 'Acme' },
      },
    });
    t.ok(
      created.status === 200 || created.status === 201,
      `create a document over HTTP (got ${String(created.status)})`,
    );
    t.equal(created.body['classification'], 'confidential', 'classification defaults from the type');
    const documentId = String(created.body['id']);

    const dup = await client('POST', '/documents/documents', {
      headers: { ...auth.headers, 'idempotency-key': 'doc-http-1' },
      body: {
        code: 'DOC-HTTP-1',
        title: 'HTTP Contract',
        documentType: 'contract',
        metadata: { counterparty: 'Acme' },
      },
    });
    t.equal(String(dup.body['id']), documentId, 'a repeated idempotency-key returns the same document');

    const initiate = await client('POST', `/documents/documents/${documentId}/versions/initiate`, {
      headers: auth.headers,
      body: { filename: 'contract.pdf', mediaType: 'application/pdf' },
    });
    t.ok(initiate.status === 200 || initiate.status === 201, 'initiate an upload over HTTP');
    t.ok(
      !JSON.stringify(initiate.body).includes('storageRef') &&
        !JSON.stringify(initiate.body).includes('storage_ref'),
      'the initiate response redacts the internal storage reference',
    );
    const versionId = (initiate.body['version'] as { id: string }).id;
    const versionVer = (initiate.body['version'] as { version: number }).version;

    // Completion with no stored object must fail closed (no completion forgery over HTTP).
    const forge = await client('POST', `/documents/versions/${versionId}/complete`, {
      headers: auth.headers,
      body: { expectedVersion: versionVer, contentHash: 'sha256:' + 'a'.repeat(64), byteSize: 10 },
    });
    t.ok(
      forge.status === 400 || forge.status === 409,
      'completing an upload with no verified object is refused',
    );

    // Legal hold over HTTP.
    const hold = await client('POST', `/documents/documents/${documentId}/legal-holds`, {
      headers: auth.headers,
      body: { reason: 'litigation' },
    });
    t.ok(hold.status === 200 || hold.status === 201, 'place a legal hold over HTTP');
    const heldDoc = await client('GET', `/documents/documents/${documentId}`, { headers: auth.headers });
    t.equal(heldDoc.body['legalHold'], true, 'the document reports the legal hold');

    // Disposition is blocked while held.
    const dispBlocked = await client('POST', `/documents/documents/${documentId}/dispositions`, {
      headers: auth.headers,
      body: { action: 'review' },
    });
    t.equal(dispBlocked.status, 409, 'a disposition request is blocked by the active legal hold (409)');

    // A header cannot grant authority (403).
    const outsider = await seedActor(ctx, 'docsoutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/documents/documents', {
      headers: { ...outsiderAuth.headers, 'x-permissions': ALL_M09_PERMISSIONS.join(',') },
      body: { code: 'NOPE', title: 'nope', documentType: 'contract' },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // Another tenant sees nothing.
    const otherAdmin = await seedActor(ctx, 'docsother');
    await grantDocsRole(ctx, otherAdmin);
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/documents/documents', { headers: otherAuth.headers });
    t.equal(
      (otherList.body['documents'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant documents (RLS)',
    );
  } finally {
    await close();
  }
});
