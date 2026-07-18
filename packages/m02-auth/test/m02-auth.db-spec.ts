import { randomUUID } from 'node:crypto';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { ProblemError } from '@finapp/kernel';
import { PgDb } from '@finapp/kernel/pg';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { AuthEmitter, AuthService, CredentialService, SessionService, hashToken } from '@finapp/m02-auth';

/**
 * M02-auth against a real PostgreSQL — credentials, sessions, rotation and reuse, expiry, RLS isolation,
 * and the no-plaintext invariant. Everything runs through the real `PgDb` on the non-superuser application
 * role, so every query is subject to the real RLS policy and the real system escape.
 */

const PASSWORD = 'correct-horse-battery-staple';

async function seedAccount(
  ctx: DbSpecContext,
  code: string,
  overrides: { accountStatus?: string; identityStatus?: string } = {},
): Promise<{ accountId: string; identityId: string }> {
  const identityId = randomUUID();
  const accountId = randomUUID();
  const accountStatus = overrides.accountStatus ?? 'active';
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status)
       VALUES ($1, 'internal_person', $2, $3, $3, $4)`,
      [identityId, `${code} P`, `${code}@example.com`, overrides.identityStatus ?? 'active'],
    );
    await tx.query(
      `INSERT INTO user_accounts (id, identity_id, account_type, login_identifier, login_identifier_norm,
                                  status, activated_at, suspended_at)
       VALUES ($1, $2, 'human', $3, $3, $4, $5, $6)`,
      [
        accountId,
        identityId,
        `${code}_login`,
        accountStatus,
        accountStatus === 'active' ? new Date() : null,
        accountStatus === 'suspended' ? new Date() : null,
      ],
    );
  });
  return { accountId, identityId };
}

export default defineDbSpec('m02-auth (Stage 1C)', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const emitter = new AuthEmitter(new RecordingAudit(), new RecordingOutbox());
  const credentials = new CredentialService(db, emitter);
  const sessions = new SessionService(db, emitter);
  const auth = new AuthService(db, emitter, credentials, sessions);

  // --- credential creation + the no-plaintext invariant -------------------------------------------
  const alice = await seedAccount(ctx, 'auth_alice');
  await credentials.createCredential(
    { correlationId: randomUUID() },
    { accountId: alice.accountId, password: PASSWORD, actor: alice.identityId },
  );

  const stored = await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ algorithm: string; secret_hash: string }>(
      `SELECT algorithm, secret_hash FROM authentication_credentials WHERE account_id = $1`,
      [alice.accountId],
    );
    return r.rows[0];
  });
  t.equal(stored?.algorithm, 'argon2id', 'the credential is stored as argon2id');
  t.ok(stored?.secret_hash.startsWith('$argon2id$'), 'and the secret is a PHC hash');
  t.ok(
    !(stored?.secret_hash ?? '').includes(PASSWORD),
    'the stored secret does NOT contain the plaintext password',
  );

  // A second credential for the same account is refused (one active per account).
  const dup = await refusal(
    credentials.createCredential(
      { correlationId: randomUUID() },
      { accountId: alice.accountId, password: PASSWORD, actor: null },
    ),
  );
  t.equal(dup?.status, 409, 'a second password credential for an account is a conflict');

  // --- login: success, wrong password, unknown, suspended ------------------------------------------
  const ok = await auth.login({
    loginIdentifier: 'auth_alice_login',
    password: PASSWORD,
    clientIp: '10.0.0.1',
    userAgent: 'test',
  });
  t.ok(ok.issued.rawToken.length > 20, 'login issues a session token');
  t.ok(ok.issued.rawRefresh.length > 20, 'and a refresh token');
  t.ok(ok.csrfToken.length > 20, 'and a CSRF token');
  t.equal(ok.identityId, alice.identityId, 'and identifies the acting identity');

  const wrong = await refusal(
    auth.login({
      loginIdentifier: 'auth_alice_login',
      password: 'wrong-password-xx',
      clientIp: '10.0.0.1',
      userAgent: 'test',
    }),
  );
  t.equal(wrong?.status, 401, 'a wrong password is 401');
  t.equal(wrong?.detail, 'Invalid credentials.', 'with the generic message');

  const unknown = await refusal(
    auth.login({
      loginIdentifier: 'nobody_here',
      password: PASSWORD,
      clientIp: '10.0.0.1',
      userAgent: 'test',
    }),
  );
  t.equal(unknown?.status, 401, 'an unknown identifier is 401');
  t.equal(unknown?.detail, wrong?.detail, 'and IDENTICAL to a wrong password — no enumeration oracle');

  const suspended = await seedAccount(ctx, 'auth_susp', { accountStatus: 'suspended' });
  await credentials.createCredential(
    { correlationId: randomUUID() },
    { accountId: suspended.accountId, password: PASSWORD, actor: null },
  );
  const suspLogin = await refusal(
    auth.login({ loginIdentifier: 'auth_susp_login', password: PASSWORD, clientIp: null, userAgent: null }),
  );
  t.equal(suspLogin?.status, 401, 'a suspended account cannot log in, even with the right password');

  // Attempts are recorded (durably), and never carry the password.
  const attempts = await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ outcome: string; failure_reason: string | null }>(
      `SELECT outcome, failure_reason FROM login_attempts ORDER BY created_at`,
    );
    return r.rows;
  });
  t.ok(
    attempts.some((a) => a.outcome === 'succeeded'),
    'a successful attempt is recorded',
  );
  t.ok(
    attempts.some((a) => a.outcome === 'failed'),
    'failed attempts are recorded (they survive the 401 rollback)',
  );
  const attemptCols = await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'login_attempts'`,
    );
    return r.rows.map((c) => c.column_name);
  });
  t.ok(!attemptCols.some((c) => /password|secret/.test(c)), 'login_attempts has no password/secret column');

  // --- session resolution + refresh rotation + reuse detection -------------------------------------
  const resolved = await sessions.resolveToken(ok.issued.rawToken);
  t.equal(resolved?.accountId, alice.accountId, 'the session token resolves to its account');
  t.equal(resolved?.identityId, alice.identityId, 'and its identity');

  const rot = await sessions.refresh(ok.issued.rawRefresh);
  t.equal(rot.outcome, 'rotated', 'a valid refresh rotates');
  const rotated = rot.outcome === 'rotated' ? rot.issued : null;
  t.ok(rotated !== null && rotated.rawToken !== ok.issued.rawToken, 'a NEW session token is issued');
  t.ok(rotated !== null && rotated.rawRefresh !== ok.issued.rawRefresh, 'and a NEW refresh token');

  // The OLD refresh token is now consumed; presenting it again is REUSE → the whole family is revoked.
  const reuse = await sessions.refresh(ok.issued.rawRefresh);
  t.equal(reuse.outcome, 'reuse', 'reusing a rotated refresh token is detected as reuse');
  const afterReuse = await sessions.resolveToken(rotated?.rawToken ?? '');
  t.equal(afterReuse, null, 'and the rotated session (same family) is now revoked — theft response');

  // The just-issued refresh from the rotation is also dead (family revoked).
  const reuseNew = await sessions.refresh(rotated?.rawRefresh ?? '');
  t.ok(reuseNew.outcome !== 'rotated', 'the family is dead — even the newest refresh cannot rotate');

  // --- idle / absolute expiry ---------------------------------------------------------------------
  const bob = await seedAccount(ctx, 'auth_bob');
  await credentials.createCredential(
    { correlationId: randomUUID() },
    { accountId: bob.accountId, password: PASSWORD, actor: null },
  );
  const bobLogin = await auth.login({
    loginIdentifier: 'auth_bob_login',
    password: PASSWORD,
    clientIp: null,
    userAgent: null,
  });
  // Force the idle window into the past.
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(`UPDATE sessions SET idle_expires_at = now() - interval '1 hour' WHERE token_hash = $1`, [
      hashToken(bobLogin.issued.rawToken),
    ]);
  });
  const expiredResolve = await sessions.resolveToken(bobLogin.issued.rawToken);
  t.equal(expiredResolve, null, 'a session past its idle window does not resolve');
  const expiredStatus = await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ status: string }>(`SELECT status FROM sessions WHERE token_hash = $1`, [
      hashToken(bobLogin.issued.rawToken),
    ]);
    return r.rows[0]?.status;
  });
  t.equal(expiredStatus, 'expired', 'and it is marked expired in place');
  const expiredHistory = await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM session_status_history WHERE to_status = 'expired'`,
    );
    return Number(r.rows[0]?.n ?? '0');
  });
  t.ok(expiredHistory >= 1, 'the expiry is recorded in the append-only history');

  // --- credential change revokes all sessions -----------------------------------------------------
  const carol = await seedAccount(ctx, 'auth_carol');
  await credentials.createCredential(
    { correlationId: randomUUID() },
    { accountId: carol.accountId, password: PASSWORD, actor: null },
  );
  const carolLogin = await auth.login({
    loginIdentifier: 'auth_carol_login',
    password: PASSWORD,
    clientIp: null,
    userAgent: null,
  });
  await auth.changePassword(
    { correlationId: randomUUID() },
    { accountId: carol.accountId, newPassword: 'a-brand-new-passphrase', actor: carol.identityId },
  );
  const afterChange = await sessions.resolveToken(carolLogin.issued.rawToken);
  t.equal(afterChange, null, 'changing the password revokes every existing session');
  const newLogin = await auth.login({
    loginIdentifier: 'auth_carol_login',
    password: 'a-brand-new-passphrase',
    clientIp: null,
    userAgent: null,
  });
  t.ok(newLogin.issued.rawToken.length > 20, 'and the new password now logs in');

  // --- RLS: the auth plane is invisible without system context ------------------------------------
  const leak = await ctx.asTenant(randomUUID(), async (tx) => {
    const cred = await tx.query(`SELECT count(*)::int AS n FROM authentication_credentials`);
    const sess = await tx.query(`SELECT count(*)::int AS n FROM sessions`);
    return { cred: (cred.rows[0] as { n: number }).n, sess: (sess.rows[0] as { n: number }).n };
  });
  t.equal(leak.cred, 0, 'credentials are invisible from a tenant context (RLS system-escape only)');
  t.equal(leak.sess, 0, 'sessions are invisible from a tenant context');

  // --- no DELETE privilege on the auth plane ------------------------------------------------------
  const del = await ctx.asSystem(async (tx) => {
    try {
      await tx.query(`DELETE FROM sessions WHERE id = $1`, [randomUUID()]);
      return 'allowed';
    } catch (error: unknown) {
      return (error as { code?: string }).code === '42501' ? 'denied' : 'other';
    }
  });
  t.equal(del, 'denied', 'the application role has NO DELETE on sessions — retire by status, never remove');
});

async function refusal(promise: Promise<unknown>): Promise<{ status: number; detail: string } | null> {
  try {
    await promise;
    return null;
  } catch (error: unknown) {
    if (error instanceof ProblemError) return { status: error.status, detail: error.detail ?? '' };
    throw error;
  }
}
