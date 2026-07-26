import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M12_PERMISSIONS, M12_PERMISSIONS } from '@finapp/m12-feedback';

/**
 * THE FEEDBACK API, OVER HTTP, END TO END (Stage 3.1). Boots the real AppModule — including FeedbackModule and
 * the m06 outbox m12 publishes through — and drives `/api/v1/feedback`. It proves the surface works with
 * permissions from a REAL RBAC grant: configure a source → ingest → claim → create → capture → classify → assign
 * → resolve (independent approver) → close; that the feedback view REDACTS the customer contact for a caller
 * without `feedback.customer_contact.read`; that ingestion + record creation are idempotent by the
 * `idempotency-key` header; and that it fails closed: 401 anon, 403 unprivileged (an x-permissions header cannot
 * grant), and another tenant sees nothing.
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

async function grantRole(ctx: DbSpecContext, actor: Seeded, permissions: readonly string[]): Promise<void> {
  const roleId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1,$2,'fb_role','Feedback role','tenant_custom','active')`,
      [roleId, actor.tenantId],
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

const Q_SPEC = {
  schemaVersion: 1,
  code: 'loan_csat',
  name: 'Loan CSAT',
  questions: [
    {
      key: 'satisfaction',
      prompt: 'How satisfied?',
      type: 'rating',
      scale: 5,
      metric: 'csat',
      required: true,
    },
    { key: 'recommend', prompt: 'Recommend us?', type: 'rating', scale: 10, metric: 'nps' },
  ],
};

async function activateQuestionnaire(client: Client, auth: Auth): Promise<void> {
  const q = await client('POST', '/feedback/questionnaires', {
    headers: auth.headers,
    body: { code: 'loan_csat', name: 'Loan CSAT', spec: Q_SPEC },
  });
  const id = String(q.body['id']);
  await client('POST', `/feedback/questionnaires/${id}/validate`, {
    headers: auth.headers,
    body: { expectedVersion: q.body['version'] },
  });
  await client('POST', `/feedback/questionnaires/${id}/publish`, {
    headers: auth.headers,
    body: { expectedVersion: 2 },
  });
  await client('POST', `/feedback/questionnaires/${id}/activate`, {
    headers: auth.headers,
    body: { expectedVersion: 3 },
  });
}

export default defineDbSpec('api-feedback', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    const anon = await client('POST', '/feedback/records', { body: { customerRef: 'x' } });
    t.equal(anon.status, 401, 'an anonymous caller cannot create feedback (401)');

    const admin = await seedActor(ctx, 'fbadmin');
    await grantRole(ctx, admin, ALL_M12_PERMISSIONS);
    const auth = await login(client, admin);

    // Configure a source and activate a questionnaire.
    await client('POST', '/feedback/source-systems', {
      headers: auth.headers,
      body: { code: 'apticone', name: 'ApticOne', active: true },
    });
    await activateQuestionnaire(client, auth);

    // Ingest (idempotent) → claim → contact.
    const ing = await client('POST', '/feedback/ingest', {
      headers: { ...auth.headers, 'idempotency-key': 'txn-http-1' },
      body: {
        sourceSystem: 'apticone',
        externalTransactionId: 'EXT-HTTP-1',
        transactionType: 'loan_disbursed',
        product: 'loan',
        branch: 'HQ',
        customerRef: 'cust-1',
      },
    });
    t.ok(
      ing.status === 200 || ing.status === 201,
      `ingest a source transaction over HTTP (got ${String(ing.status)})`,
    );
    const queueItemId = String(ing.body['queueItemId']);
    const claim = await client('POST', `/feedback/queue/${queueItemId}/claim`, { headers: auth.headers });
    t.equal(claim.body['status'], 'claimed', 'the queue item is claimed over HTTP');

    // Create feedback (idempotent) with a sensitive contact.
    const created = await client('POST', '/feedback/records', {
      headers: { ...auth.headers, 'idempotency-key': 'fb-http-1' },
      body: {
        customerRef: 'cust-1',
        customerContact: '+254700000000',
        product: 'loan',
        branch: 'HQ',
        feedbackType: 'complaint',
      },
    });
    t.ok(created.status === 200 || created.status === 201, 'create feedback over HTTP');
    const feedbackId = String(created.body['id']);
    const dup = await client('POST', '/feedback/records', {
      headers: { ...auth.headers, 'idempotency-key': 'fb-http-1' },
      body: { customerRef: 'cust-1' },
    });
    t.equal(String(dup.body['id']), feedbackId, 'a repeated idempotency-key returns the same feedback');

    // A privileged caller sees the real contact.
    const privileged = await client('GET', `/feedback/records/${feedbackId}`, { headers: auth.headers });
    t.equal(
      privileged.body['customerContact'],
      '+254700000000',
      'a privileged caller reads the customer contact',
    );

    // Capture → classify → assign → resolve → close.
    const cap = await client('POST', `/feedback/records/${feedbackId}/capture`, {
      headers: auth.headers,
      body: {
        expectedVersion: created.body['version'],
        questionnaireCode: 'loan_csat',
        answers: { satisfaction: 4, recommend: 9 },
      },
    });
    t.equal(cap.body['csat'], '80.00', 'CSAT is computed and returned over HTTP');
    const cls = await client('POST', `/feedback/records/${feedbackId}/classify`, {
      headers: auth.headers,
      body: {
        expectedVersion: cap.body['version'],
        sentiment: 'negative',
        category: 'service',
        severity: 'high',
      },
    });
    const asg = await client('POST', `/feedback/records/${feedbackId}/assign`, {
      headers: auth.headers,
      body: { expectedVersion: cls.body['version'], owner: admin.identityId },
    });
    t.equal(asg.body['status'], 'assigned', 'the feedback is assigned over HTTP');
    await client('POST', `/feedback/records/${feedbackId}/resolution`, {
      headers: auth.headers,
      body: {
        summary: 'Fixed',
        resolutionType: 'corrected',
        rootCauseCategory: 'process',
        responseCustomerFacing: 'We fixed it',
      },
    });

    // Segregation of duties: an independent approver must resolve.
    const selfApprove = await client('POST', `/feedback/records/${feedbackId}/resolution/approve`, {
      headers: auth.headers,
    });
    t.equal(selfApprove.status, 409, 'the submitter cannot approve their own resolution over HTTP (409)');
    const approver = await seedActor(ctx, 'fbapprover');
    // Give the approver a role in the FIRST tenant so they can act on the same feedback.
    const approverRoleId = randomUUID();
    await ctx.asSuperuser(null, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status) SELECT $1, $2, $3, ua.id, 'employee','active' FROM user_accounts ua WHERE ua.identity_id=$3`,
        [admin.tenantId, randomUUID(), approver.identityId],
      );
      await tx.query(
        `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1,$2,'fb_approver','Feedback approver','tenant_custom','active')`,
        [approverRoleId, admin.tenantId],
      );
      await tx.query(`INSERT INTO role_permissions (role_id, tenant_id, permission_code) VALUES ($1,$2,$3)`, [
        approverRoleId,
        admin.tenantId,
        M12_PERMISSIONS.resolutionApprove,
      ]);
      await tx.query(
        `INSERT INTO role_assignments (tenant_id, membership_id, identity_id, role_id, scope_level, status) SELECT $1, tm.id, $2, $3, 'tenant','active' FROM tenant_memberships tm WHERE tm.tenant_id=$1 AND tm.identity_id=$2`,
        [admin.tenantId, approver.identityId, approverRoleId],
      );
    });
    const approverAuth: Auth = {
      headers: { ...(await login(client, approver)).headers, 'x-tenant-id': admin.tenantId },
    };
    const approved = await client('POST', `/feedback/records/${feedbackId}/resolution/approve`, {
      headers: approverAuth.headers,
    });
    t.equal(approved.body['status'], 'resolved', 'an independent approver resolves the feedback (SoD)');

    const confirmed = await client('POST', `/feedback/records/${feedbackId}/confirmation`, {
      headers: auth.headers,
      body: { expectedVersion: approved.body['version'], satisfied: true },
    });
    const closed = await client('POST', `/feedback/records/${feedbackId}/close`, {
      headers: auth.headers,
      body: { expectedVersion: confirmed.body['version'] },
    });
    t.equal(closed.body['status'], 'closed', 'a fully-worked complaint closes over HTTP');

    // Redaction: a caller without the contact permission sees a redacted contact.
    const reader = await seedActor(ctx, 'fbreader');
    const readerRoleId = randomUUID();
    await ctx.asSuperuser(null, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status) SELECT $1, $2, $3, ua.id, 'employee','active' FROM user_accounts ua WHERE ua.identity_id=$3`,
        [admin.tenantId, randomUUID(), reader.identityId],
      );
      await tx.query(
        `INSERT INTO roles (id, tenant_id, code, name, kind, status) VALUES ($1,$2,'fb_reader','Feedback reader','tenant_custom','active')`,
        [readerRoleId, admin.tenantId],
      );
      await tx.query(
        `INSERT INTO role_permissions (role_id, tenant_id, permission_code) VALUES ($1,$2,'feedback.record.read')`,
        [readerRoleId, admin.tenantId],
      );
      await tx.query(
        `INSERT INTO role_assignments (tenant_id, membership_id, identity_id, role_id, scope_level, status) SELECT $1, tm.id, $2, $3, 'tenant','active' FROM tenant_memberships tm WHERE tm.tenant_id=$1 AND tm.identity_id=$2`,
        [admin.tenantId, reader.identityId, readerRoleId],
      );
    });
    const readerAuth: Auth = {
      headers: { ...(await login(client, reader)).headers, 'x-tenant-id': admin.tenantId },
    };
    const redacted = await client('GET', `/feedback/records/${feedbackId}`, { headers: readerAuth.headers });
    t.equal(
      redacted.body['customerContact'],
      '[redacted]',
      'a caller without the contact permission sees a redacted contact',
    );

    // A header cannot grant authority (403).
    const outsider = await seedActor(ctx, 'fboutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/feedback/records', {
      headers: { ...outsiderAuth.headers, 'x-permissions': ALL_M12_PERMISSIONS.join(',') },
      body: { customerRef: 'nope' },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // Another tenant sees nothing.
    const otherAdmin = await seedActor(ctx, 'fbother');
    await grantRole(ctx, otherAdmin, ALL_M12_PERMISSIONS);
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/feedback/records', { headers: otherAuth.headers });
    t.equal(
      (otherList.body['records'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant feedback (RLS)',
    );
  } finally {
    await close();
  }
});
