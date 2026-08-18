/**
 * Stage-7 staging-only SYNTHETIC LOGIN seed — makes the two synthetic identities from
 * `bootstrap-synthetic.mjs` actually LOGINABLE so an AUTHENTICATED load test can run (login -> session
 * cookie -> authenticated reads/writes). NON-PRODUCTION ONLY. Idempotent + safe to rerun.
 *
 * It uses the CANONICAL credential mechanism: `argon2idHasher.hash()` from `@finapp/m02-auth` produces the
 * Argon2id PHC verifier that the app's own login path verifies — no home-grown crypto, no plaintext stored.
 * The password is read from the `LOGIN_PW` env var and is NEVER printed, logged, or written to disk/DB in
 * clear (only its Argon2id verifier is stored, exactly as a real login would). Connects with the elevated
 * (superuser) role in DATABASE_URL for seeding; the app itself runs as the non-owner `finapp_app` role.
 * Refuses to run when NODE_ENV=production. Creates NO real PII (machine write-type is non-PII; the two human
 * identities use synthetic @staging.local addresses already seeded by bootstrap-synthetic.mjs).
 *
 * Run INSIDE the api container (where `@finapp/m02-auth` + `pg` resolve), e.g.:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-login.mjs
 */
import pg from 'pg';
import { argon2idHasher } from '@finapp/m02-auth';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run: NODE_ENV=production (staging-only synthetic login seed).');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}
const password = process.env.LOGIN_PW;
if (!password || password.length < 12) {
  console.error('LOGIN_PW env var (>= 12 chars) is required; it is never printed or stored in clear.');
  process.exit(2);
}

const PLATFORM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001';
const ID1 = '00000000-0000-4000-8000-0000000000a1'; // privileged synthetic identity (platform_admin)
const ID2 = '00000000-0000-4000-8000-0000000000a2'; // unprivileged synthetic identity (no grant)
const ACC1 = '00000000-0000-4000-8000-0000000000b1'; // privileged login account
const ACC2 = '00000000-0000-4000-8000-0000000000b2'; // unprivileged login account
const ADMIN_LOGIN = 'stg_admin_login';
const UNPRIV_LOGIN = 'stg_user_login';

const pool = new pg.Pool({ connectionString: url });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

async function ensureAccountAndCredential(identityId, accountId, loginId) {
  const idExists = (await q(`SELECT 1 FROM identities WHERE id = $1`, [identityId])).length === 1;
  if (!idExists) throw new Error(`identity ${identityId} missing — run bootstrap-synthetic.mjs first`);

  await q(
    `INSERT INTO user_accounts
       (id, identity_id, account_type, login_identifier, login_identifier_norm, status, activated_at)
     VALUES ($1, $2, 'human', $3, lower($3), 'active', now())
     ON CONFLICT (id) DO UPDATE SET status = 'active'`,
    [accountId, identityId, loginId],
  );

  // Rotate to a fresh single active credential (idempotent + rerun-safe): retire any live one, insert new.
  const hashed = await argon2idHasher.hash(password);
  await q(
    `UPDATE authentication_credentials
        SET status = 'disabled', disabled_at = now(), disabled_reason = 'staging synthetic re-seed'
      WHERE account_id = $1 AND status = 'active'`,
    [accountId],
  );
  await q(
    `INSERT INTO authentication_credentials (account_id, credential_type, algorithm, params, secret_hash, status)
     VALUES ($1, 'password', $2, $3::jsonb, $4, 'active')`,
    [accountId, hashed.algorithm, JSON.stringify(hashed.params), hashed.encoded],
  );
}

async function ensureMembership(tenantId, identityId, accountId, membershipType, isPrimary) {
  // tenant_memberships is FORCE-RLS with NO system escape; set the tenant GUC so WITH CHECK passes even for a
  // non-BYPASSRLS role. Superuser also passes. One live membership per (tenant, identity) — insert if absent.
  await q(`SET app.tenant_id = '${tenantId}'`);
  try {
    const live = (
      await q(
        `SELECT 1 FROM tenant_memberships
         WHERE tenant_id = $1 AND identity_id = $2 AND status <> 'ended'`,
        [tenantId, identityId],
      )
    ).length;
    if (live === 0) {
      await q(
        `INSERT INTO tenant_memberships
           (tenant_id, identity_id, account_id, membership_type, status, is_primary)
         VALUES ($1, $2, $3, $4, 'active', $5)`,
        [tenantId, identityId, accountId, membershipType, isPrimary],
      );
    }
  } finally {
    await q(`RESET app.tenant_id`);
  }
}

try {
  const writeType = (
    await q(`SELECT code FROM identity_type_catalogue WHERE is_human = false ORDER BY code LIMIT 1`)
  )[0]?.code;
  const membershipType = (await q(`SELECT code FROM membership_type_catalogue ORDER BY code LIMIT 1`))[0]
    ?.code;
  if (!writeType || !membershipType)
    throw new Error('required catalogues (identity_type machine / membership_type) are not seeded');

  await ensureAccountAndCredential(ID1, ACC1, ADMIN_LOGIN);
  await ensureAccountAndCredential(ID2, ACC2, UNPRIV_LOGIN);

  // Give the privileged identity a live membership in both synthetic tenants for multi-tenant auth load.
  const tenants = await q(
    `SELECT id, code FROM tenants WHERE code IN ('stg_tenant_1','stg_tenant_2') ORDER BY code`,
  );
  let idx = 0;
  for (const t of tenants) {
    await ensureMembership(t.id, ID1, ACC1, membershipType, idx === 0);
    idx += 1;
  }

  const activeCreds = (
    await q(
      `SELECT count(*)::int c FROM authentication_credentials
       WHERE account_id IN ($1,$2) AND status = 'active'`,
      [ACC1, ACC2],
    )
  )[0].c;
  const memberships = (
    await q(`SELECT count(*)::int c FROM tenant_memberships WHERE identity_id = $1 AND status = 'active'`, [
      ID1,
    ])
  )[0].c;
  const adminHasCreate = (
    await q(
      `SELECT count(*)::int c FROM platform_role_assignments
       WHERE identity_id = $1 AND role_id = $2 AND status = 'active'`,
      [ID1, PLATFORM_ADMIN_ROLE_ID],
    )
  )[0].c;

  console.log(
    JSON.stringify({
      ok: true,
      admin_login: ADMIN_LOGIN,
      unpriv_login: UNPRIV_LOGIN,
      write_identity_type: writeType,
      membership_type: membershipType,
      tenant_ids: tenants.map((t) => t.id),
      active_credentials: activeCreds,
      admin_active_memberships: memberships,
      admin_platform_admin_grant: adminHasCreate,
      note: 'staging-only synthetic login seed; password supplied via LOGIN_PW, never printed or stored in clear',
    }),
  );
} catch (e) {
  console.error('seed-login failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
