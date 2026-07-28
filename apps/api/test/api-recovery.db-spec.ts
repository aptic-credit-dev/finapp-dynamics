import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { argon2idHasher } from '@finapp/m02-auth';
import { ALL_M17_PERMISSIONS, M17_PERMISSIONS } from '@finapp/m17-recovery';
import { ALL_M16_PERMISSIONS } from '@finapp/m16-litigation';

/**
 * THE RECOVERY API, OVER HTTP, END TO END (Stage 4.3). Boots the real AppModule — including RecoveryModule +
 * LitigationModule + the m06 outbox m17 publishes through — and drives `/api/v1/recovery`. It proves the surface
 * works with permissions from a REAL RBAC grant: activate a recovery type → create (idempotent) → assign →
 * strategy → arrangement maker-checker (independent approver) → write-off maker-checker → rule-gated close →
 * reopen; the REAL M16→M17 referral (m16 create proceeding → m17 accept from-proceeding, idempotent, exactly one
 * recovery per referral key); confidentiality redaction; and fail-closed 401/403 + cross-tenant isolation.
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

const RECOVERY_TYPE = {
  schemaVersion: 1,
  code: 'judgment_recovery',
  name: 'Judgment Recovery',
  category: 'litigation',
  eligibleInstruments: ['judgment'],
  eligibleStrategies: ['demand', 'enforcement'],
  defaultConfidentiality: 'privileged',
  defaultRisk: 'high',
  defaultPriority: 'high',
  enforcementSupport: true,
};

async function activateRecoveryType(client: Client, auth: Auth): Promise<void> {
  const t = await client('POST', '/recovery/recovery-types', {
    headers: auth.headers,
    body: { code: 'judgment_recovery', name: 'Judgment Recovery', spec: RECOVERY_TYPE },
  });
  const id = String(t.body['id']);
  await client('POST', `/recovery/recovery-types/${id}/validate`, {
    headers: auth.headers,
    body: { expectedVersion: t.body['version'] },
  });
  await client('POST', `/recovery/recovery-types/${id}/publish`, {
    headers: auth.headers,
    body: { expectedVersion: 2 },
  });
  await client('POST', `/recovery/recovery-types/${id}/activate`, {
    headers: auth.headers,
    body: { expectedVersion: 3 },
  });
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

export default defineDbSpec('api-recovery', async (ctx, t) => {
  const booted = await bootApi();
  if ('error' in booted) {
    t.ok(false, `the API failed to boot: ${booted.error}`);
    return;
  }
  const { client, close } = booted;
  try {
    const anon = await client('POST', '/recovery/recoveries', {
      body: { recoveryTypeCode: 'judgment_recovery', title: 'x' },
    });
    t.equal(anon.status, 401, 'an anonymous caller cannot create a recovery (401)');

    const admin = await seedActor(ctx, 'recadmin');
    await grantRole(ctx, admin, [...ALL_M17_PERMISSIONS, ...ALL_M16_PERMISSIONS], 'recadmin');
    const auth = await login(client, admin);
    await activateRecoveryType(client, auth);

    // Create (idempotent) a privileged recovery.
    const created = await client('POST', '/recovery/recoveries', {
      headers: { ...auth.headers, 'idempotency-key': 'rec-http-1' },
      body: {
        recoveryTypeCode: 'judgment_recovery',
        title: 'Bank v Debtor',
        summary: 'sensitive debt',
        confidentiality: 'privileged',
        privileged: true,
        principalAmountMinor: 1000000,
        currency: 'KES',
      },
    });
    t.ok(
      created.status === 200 || created.status === 201,
      `create a recovery over HTTP (got ${String(created.status)})`,
    );
    const recId = String(created.body['id']);
    t.ok(String(created.body['recoveryNumber']).startsWith('REC-'), 'a recovery number is generated');
    const dup = await client('POST', '/recovery/recoveries', {
      headers: { ...auth.headers, 'idempotency-key': 'rec-http-1' },
      body: { recoveryTypeCode: 'judgment_recovery', title: 'Bank v Debtor' },
    });
    t.equal(String(dup.body['id']), recId, 'a repeated idempotency-key returns the same recovery');

    // Assign + strategy.
    const assigned = await client('POST', `/recovery/recoveries/${recId}/assign`, {
      headers: auth.headers,
      body: { expectedVersion: created.body['version'], owner: admin.identityId, team: 'recovery' },
    });
    t.equal(
      assigned.body['status'],
      'under_review',
      'assignment advances the recovery to under_review over HTTP',
    );
    await client('POST', `/recovery/recoveries/${recId}/strategy`, {
      headers: auth.headers,
      body: {
        expectedVersion: assigned.body['version'],
        strategy: 'enforcement',
        rationale: 'judgment obtained',
      },
    });

    // Arrangement maker-checker: proposer cannot approve; an independent approver can.
    const arr = await client('POST', `/recovery/recoveries/${recId}/arrangements`, {
      headers: auth.headers,
      body: {
        arrangementType: 'installment',
        totalAmountMinor: 1000000,
        installmentCount: 4,
        installmentAmountMinor: 250000,
        currency: 'KES',
      },
    });
    const selfApproveArr = await client('POST', `/recovery/arrangements/${String(arr.body['id'])}/approve`, {
      headers: auth.headers,
      body: { expectedVersion: arr.body['version'] },
    });
    t.equal(selfApproveArr.status, 409, 'the proposer cannot approve their own arrangement over HTTP (409)');
    const approver = await seedActor(ctx, 'recapprover');
    await grantInTenant(
      ctx,
      admin.tenantId,
      approver,
      [
        M17_PERMISSIONS.arrangementApprove,
        M17_PERMISSIONS.arrangementRead,
        M17_PERMISSIONS.writeoffApprove,
        M17_PERMISSIONS.writeoffRead,
      ],
      'recapprover',
    );
    const approverAuth = await login(client, approver, admin.tenantId);
    const arrApproved = await client('POST', `/recovery/arrangements/${String(arr.body['id'])}/approve`, {
      headers: approverAuth.headers,
      body: { expectedVersion: arr.body['version'] },
    });
    t.equal(
      arrApproved.body['status'],
      'active',
      'an independent approver activates the arrangement (maker-checker)',
    );

    // Write-off recommendation maker-checker.
    const wo = await client('POST', `/recovery/recoveries/${recId}/writeoffs`, {
      headers: auth.headers,
      body: {
        reasonCode: 'cost_exceeds_recovery',
        amountMinor: 150000,
        currency: 'KES',
        narrative: 'residual',
      },
    });
    const selfApproveWo = await client('POST', `/recovery/writeoffs/${String(wo.body['id'])}/approve`, {
      headers: auth.headers,
      body: { expectedVersion: wo.body['version'] },
    });
    t.equal(selfApproveWo.status, 409, 'the recommender cannot approve their own write-off over HTTP (409)');
    const woApproved = await client('POST', `/recovery/writeoffs/${String(wo.body['id'])}/approve`, {
      headers: approverAuth.headers,
      body: { expectedVersion: wo.body['version'] },
    });
    t.equal(
      woApproved.body['approvalStatus'],
      'approved',
      'an independent approver approves the write-off (maker-checker)',
    );

    // Confidential redaction: a caller without recovery.confidential.read sees a redacted summary.
    const reader = await seedActor(ctx, 'recreader');
    await grantInTenant(ctx, admin.tenantId, reader, [M17_PERMISSIONS.recoveryRead], 'recreader');
    const readerAuth = await login(client, reader, admin.tenantId);
    const redacted = await client('GET', `/recovery/recoveries/${recId}`, { headers: readerAuth.headers });
    t.equal(
      redacted.body['summary'],
      '[redacted]',
      'a caller without confidential.read sees a redacted summary',
    );
    const privileged = await client('GET', `/recovery/recoveries/${recId}`, { headers: auth.headers });
    t.equal(
      privileged.body['summary'],
      'sensitive debt',
      'a privileged caller reads the confidential summary',
    );

    // Rule-gated close on a fresh recovery: advance to settled → outcome → close → reopen.
    const c0 = await client('POST', '/recovery/recoveries', {
      headers: auth.headers,
      body: { recoveryTypeCode: 'judgment_recovery', title: 'Closeable' },
    });
    const c0Id = String(c0.body['id']);
    let version = Number(c0.body['version']);
    for (const to of ['referred', 'strategy_selection', 'negotiation', 'settled']) {
      const adv = await client('POST', `/recovery/recoveries/${c0Id}/advance`, {
        headers: auth.headers,
        body: { expectedVersion: version, toStatus: to },
      });
      version = Number(adv.body['version']);
    }
    const premature = await client('POST', `/recovery/recoveries/${c0Id}/close`, {
      headers: auth.headers,
      body: { expectedVersion: version },
    });
    t.equal(premature.status, 409, 'closure is blocked until an outcome is recorded (409)');
    await client('POST', `/recovery/recoveries/${c0Id}/outcomes`, {
      headers: auth.headers,
      body: { outcomeType: 'settled', summary: 'Settled', recoveredAmountMinor: 600000, currency: 'KES' },
    });
    const preClose = await client('GET', `/recovery/recoveries/${c0Id}`, { headers: auth.headers });
    const closed = await client('POST', `/recovery/recoveries/${c0Id}/close`, {
      headers: auth.headers,
      body: { expectedVersion: preClose.body['version'], summary: 'Closed' },
    });
    t.equal(closed.body['status'], 'closed', 'a fully-worked recovery closes over HTTP (rule-gated)');
    const reopened = await client('POST', `/recovery/recoveries/${c0Id}/reopen`, {
      headers: auth.headers,
      body: { expectedVersion: closed.body['version'], reason: 'new asset traced' },
    });
    t.equal(reopened.body['status'], 'reopened', 'the recovery reopens over HTTP');

    // THE REAL M16 -> M17 REFERRAL over HTTP: m16 create proceeding → m17 accept from-proceeding (idempotent).
    await activateProceedingType(client, auth);
    const proceeding = await client('POST', '/litigation/proceedings', {
      headers: auth.headers,
      body: { proceedingTypeCode: 'civil_suit', title: 'Underlying proceeding' },
    });
    const proceedingId = String(proceeding.body['id']);
    const refKey = `ref-${randomUUID()}`;
    const fromProceeding = await client('POST', '/recovery/from-proceeding', {
      headers: auth.headers,
      body: {
        referralKey: refKey,
        sourceProceedingId: proceedingId,
        recoveryTypeCode: 'judgment_recovery',
        title: 'Recovery from proceeding',
        instrumentType: 'judgment',
      },
    });
    t.ok(
      fromProceeding.status === 200 || fromProceeding.status === 201,
      'm17 accepts the M16 referral over HTTP',
    );
    const refRec = fromProceeding.body['recovery'] as Record<string, unknown>;
    t.equal(
      refRec['source'],
      'enforcement_referral',
      'the created recovery records the enforcement-referral source',
    );
    t.equal(
      refRec['sourceProceedingId'],
      proceedingId,
      'the created recovery preserves the source proceeding id',
    );
    t.equal(fromProceeding.body['created'], true, 'the first referral creates a recovery');
    const fromProceeding2 = await client('POST', '/recovery/from-proceeding', {
      headers: auth.headers,
      body: {
        referralKey: refKey,
        sourceProceedingId: proceedingId,
        recoveryTypeCode: 'judgment_recovery',
        title: 'Again',
      },
    });
    t.equal(
      (fromProceeding2.body['recovery'] as Record<string, unknown>)['id'],
      refRec['id'],
      'a repeat referral returns the same recovery (one per referral key)',
    );
    t.equal(fromProceeding2.body['created'], false, 'a repeat referral does not create a second recovery');

    // A header cannot grant authority (403).
    const outsider = await seedActor(ctx, 'recoutsider');
    const outsiderAuth = await login(client, outsider);
    const forged = await client('POST', '/recovery/recoveries', {
      headers: { ...outsiderAuth.headers, 'x-permissions': ALL_M17_PERMISSIONS.join(',') },
      body: { recoveryTypeCode: 'judgment_recovery', title: 'nope' },
    });
    t.equal(forged.status, 403, 'an unprivileged actor is refused even with an x-permissions header (403)');

    // Another tenant sees nothing.
    const otherAdmin = await seedActor(ctx, 'recother');
    await grantRole(ctx, otherAdmin, ALL_M17_PERMISSIONS, 'recother');
    const otherAuth = await login(client, otherAdmin);
    const otherList = await client('GET', '/recovery/recoveries', { headers: otherAuth.headers });
    t.equal(
      (otherList.body['recoveries'] as unknown[]).length,
      0,
      'another tenant sees none of the first tenant recoveries (RLS)',
    );
  } finally {
    await close();
  }
});
