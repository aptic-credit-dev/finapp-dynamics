/**
 * Stage-8 M41 Secrets & Keys (Phase 2) DEMO seed — staging-only, SYNTHETIC. NON-PRODUCTION ONLY. Idempotent.
 *
 * Creates two least-privilege SECRET OFFICER personas so the privileged lifecycle can be proven under maker-checker
 * with two DISTINCT authorized humans (each can approve the other's request; neither can self-approve):
 *   - stg_secret_officer_a
 *   - stg_secret_officer_b
 *
 * Each is granted ONLY the tenant-scoped M41 lifecycle permissions required — security.secret.{read,manage,rotate,
 * reveal,destroy} — and deliberately NOT security.control.administer (no platform-scope authority) nor any identity/
 * rbac read (no member enumeration). The read-only stg_security_auditor and the negative stg_restricted personas
 * (seeded elsewhere) remain the read / denied actors. Uses the canonical Argon2id credential mechanism.
 *
 * This seed creates NO secret rows — the lifecycle acceptance harness defines/activates/rotates/revokes/destroys its
 * own throwaway secrets through the governed API, so nothing here touches secret material. Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-security-lifecycle-demo.mjs
 */
import pg from 'pg';
import { argon2idHasher } from '@finapp/m02-auth';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run: NODE_ENV=production (staging-only synthetic seed).');
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

const T1 = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b'; // Stage-7 Synthetic Tenant 1
const ADMIN = '00000000-0000-4000-8000-0000000000a1'; // granted_by / created_by (existing platform_admin)

// Minimum tenant-scoped M41 lifecycle permissions — NO security.control.administer, NO identity/rbac reads.
const OFFICER_PERMS = [
  'security.secret.read',
  'security.secret.manage',
  'security.secret.rotate',
  'security.secret.reveal',
  'security.secret.destroy',
];

const OFFICERS = [
  {
    login: 'stg_secret_officer_a',
    name: 'Secret Officer A (synthetic)',
    code: 'secret_officer_a',
    identityId: '00000000-0000-4000-8000-000000004201',
    accountId: '00000000-0000-4000-8000-000000004202',
    roleId: '00000000-0000-4000-8000-000000004203',
    asgId: '00000000-0000-4000-8000-000000004204',
  },
  {
    login: 'stg_secret_officer_b',
    name: 'Secret Officer B (synthetic)',
    code: 'secret_officer_b',
    identityId: '00000000-0000-4000-8000-000000004211',
    accountId: '00000000-0000-4000-8000-000000004212',
    roleId: '00000000-0000-4000-8000-000000004213',
    asgId: '00000000-0000-4000-8000-000000004214',
  },
];

const pool = new pg.Pool({ connectionString: url });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

async function ensureCredential(accountId, identityId, loginId) {
  await q(
    `INSERT INTO user_accounts (id, identity_id, account_type, login_identifier, login_identifier_norm, status, activated_at)
     VALUES ($1, $2, 'human', $3, lower($3), 'active', now())
     ON CONFLICT (id) DO UPDATE SET status='active'`,
    [accountId, identityId, loginId],
  );
  const hashed = await argon2idHasher.hash(password);
  await q(
    `UPDATE authentication_credentials SET status='disabled', disabled_at=now(), disabled_reason='persona re-seed'
      WHERE account_id=$1 AND status='active'`,
    [accountId],
  );
  await q(
    `INSERT INTO authentication_credentials (account_id, credential_type, algorithm, params, secret_hash, status)
     VALUES ($1, 'password', $2, $3::jsonb, $4, 'active')`,
    [accountId, hashed.algorithm, JSON.stringify(hashed.params), hashed.encoded],
  );
}

try {
  await q(`SET app.tenant_id = '${T1}'`);
  const out = [];
  for (const o of OFFICERS) {
    const email = `${o.login}@staging.local`;
    await q(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status,
         data_classification, version, created_by, created_at)
       VALUES ($1,'internal_person',$2,$3,lower($3),'active','internal',1,$4,now())
       ON CONFLICT (id) DO UPDATE SET status='active', display_name=EXCLUDED.display_name`,
      [o.identityId, o.name, email, ADMIN],
    );
    await ensureCredential(o.accountId, o.identityId, o.login);
    const live = await q(
      `SELECT id FROM tenant_memberships WHERE tenant_id=$1 AND identity_id=$2 AND status<>'ended'`,
      [T1, o.identityId],
    );
    let membershipId = live[0]?.id;
    if (!membershipId) {
      membershipId = (
        await q(
          `INSERT INTO tenant_memberships (tenant_id, identity_id, account_id, membership_type, status, is_primary)
           VALUES ($1,$2,$3,'employee','active',false) RETURNING id`,
          [T1, o.identityId, o.accountId],
        )
      )[0].id;
    }
    await q(
      `INSERT INTO roles (id, tenant_id, code, name, kind, is_immutable, status, risk, version, created_by, created_at)
       VALUES ($1,$2,$3,$4,'tenant_custom',false,'active','critical',1,$5,now())
       ON CONFLICT (id) DO UPDATE SET status='active', name=EXCLUDED.name`,
      [o.roleId, T1, o.code, o.name, ADMIN],
    );
    const granted = await q(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_code, granted_by)
       SELECT $1,$2,code,$3 FROM permissions WHERE code = ANY($4)
       ON CONFLICT DO NOTHING RETURNING permission_code`,
      [o.roleId, T1, ADMIN, OFFICER_PERMS],
    );
    const heldNow = (await q(`SELECT count(*)::int c FROM role_permissions WHERE role_id=$1`, [o.roleId]))[0]
      .c;
    const missing = OFFICER_PERMS.filter((c) => !granted.find((g) => g.permission_code === c));
    await q(
      `INSERT INTO role_assignments (tenant_id, id, membership_id, identity_id, role_id, scope_level, status, version, granted_by, granted_at)
       VALUES ($1,$2,$3,$4,$5,'tenant','active',1,$6,now())
       ON CONFLICT (tenant_id, id) DO UPDATE SET status='active'`,
      [T1, o.asgId, membershipId, o.identityId, o.roleId, ADMIN],
    );
    out.push({
      login: o.login,
      identityId: o.identityId,
      perms_held: heldNow,
      skipped_missing_codes: missing,
    });
  }
  await q(`RESET app.tenant_id`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        tenant: T1,
        officers: out,
        note: 'staging-only: two least-privilege secret officers (security.secret.{read,manage,rotate,reveal,destroy}; NO control.administer). Password via LOGIN_PW, never printed. No secret rows seeded.',
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-security-lifecycle-demo failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
