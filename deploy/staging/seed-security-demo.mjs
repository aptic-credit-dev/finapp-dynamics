/**
 * Stage-8 M41 Secrets & Keys (Phase 1) DEMO seed — staging-only, SYNTHETIC. NON-PRODUCTION ONLY. Idempotent.
 *
 * Two things, both least-privilege and metadata-only:
 *
 * 1) A bounded security-admin persona `stg_security_auditor` (tenant-custom role `security_auditor`) granted ONLY
 *    `security.secret.read`. It is deliberately NOT granted security.secret.manage/rotate/reveal/destroy or
 *    security.control.administer — so the acceptance harness can prove those writes fail closed (403). The 403-on-read
 *    restricted actor is the existing `stg_restricted` persona (seed-personas.mjs), which holds no security.* perm.
 *    Uses the canonical Argon2id credential mechanism (@finapp/m02-auth), exactly like seed-personas.mjs.
 *
 * 2) SYNTHETIC secret/key METADATA in Tenant 1 covering multiple lifecycle states, version/rotation history and
 *    maker-checker reveal-grant evidence. There is NO secret value anywhere — a secret carries only an OPAQUE
 *    `secretref:` pointer + an approved algorithm id; a version carries only an opaque provider_ref (null here, since
 *    the provider is the fail-closed framework-only default); a reveal records only the GRANT (requester/approver/
 *    purpose/expiry). No real credentials, tokens, private keys or PII are ever created.
 *
 * Connects with the elevated (superuser/owner) DATABASE_URL for seeding; the app runs as non-owner finapp_app.
 * Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-security-demo.mjs
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
const CORR = '00000000-0000-4000-8000-000000410000'; // fixed synthetic correlation id for these seed rows

// Bounded security-admin persona — ONLY security.secret.read (no manage/rotate/reveal/destroy/administer).
const AUD = {
  login: 'stg_security_auditor',
  name: 'Security Auditor read-only (synthetic)',
  code: 'security_auditor',
  risk: 'normal',
  perms: ['security.secret.read'],
  identityId: '00000000-0000-4000-8000-000000004101',
  accountId: '00000000-0000-4000-8000-000000004102',
  roleId: '00000000-0000-4000-8000-000000004103',
  asgId: '00000000-0000-4000-8000-000000004104',
};

// Synthetic secret/key metadata. `versions` model rotation history (at most ONE active version per secret — the DB
// one-active partial unique index). `reveals` are maker-checker grants (approved_by <> requested_by). NO material.
const sid = (n) => `00000000-0000-4000-8000-0000004102${n}`; // secret ids
const vid = (n) => `00000000-0000-4000-8000-0000004103${n}`; // version ids
const rid = (n) => `00000000-0000-4000-8000-0000004104${n}`; // reveal ids
const SECRETS = [
  {
    id: sid('01'),
    materialKind: 'secret',
    secretKey: 'staging/webhook-signing',
    secretRef: 'secretref:staging/webhook-signing',
    algorithm: 'aes-256-gcm',
    state: 'active',
    currentVersionNo: 2,
    version: 3,
    versions: [
      { id: vid('01'), versionNo: 1, state: 'retired', activated: true },
      { id: vid('02'), versionNo: 2, state: 'active', activated: true },
    ],
    reveals: [
      {
        id: rid('01'),
        requestedBy: AUD.identityId,
        approvedBy: ADMIN,
        purpose: 'incident triage — verify webhook signature (synthetic)',
        granted: true,
      },
    ],
  },
  {
    id: sid('02'),
    materialKind: 'key',
    secretKey: 'staging/document-encryption',
    secretRef: 'secretref:staging/document-encryption',
    algorithm: 'rsa-4096',
    state: 'active',
    currentVersionNo: 1,
    version: 2,
    versions: [{ id: vid('03'), versionNo: 1, state: 'active', activated: true }],
    reveals: [],
  },
  {
    id: sid('03'),
    materialKind: 'secret',
    secretKey: 'staging/partner-integration',
    secretRef: 'secretref:staging/partner-integration',
    algorithm: 'chacha20-poly1305',
    state: 'pending_approval',
    currentVersionNo: 0,
    version: 1,
    versions: [{ id: vid('04'), versionNo: 1, state: 'pending', activated: false }],
    reveals: [],
  },
  {
    id: sid('04'),
    materialKind: 'secret',
    secretKey: 'staging/legacy-hmac',
    secretRef: 'secretref:staging/legacy-hmac',
    algorithm: 'aes-256-gcm',
    state: 'revoked',
    currentVersionNo: 1,
    version: 3,
    versions: [{ id: vid('05'), versionNo: 1, state: 'revoked', activated: true }],
    reveals: [],
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

  // ---- 1) security-admin persona (least privilege: security.secret.read only) ----
  const email = `${AUD.login}@staging.local`;
  await q(
    `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status,
       data_classification, version, created_by, created_at)
     VALUES ($1,'internal_person',$2,$3,lower($3),'active','internal',1,$4,now())
     ON CONFLICT (id) DO UPDATE SET status='active', display_name=EXCLUDED.display_name`,
    [AUD.identityId, AUD.name, email, ADMIN],
  );
  await ensureCredential(AUD.accountId, AUD.identityId, AUD.login);
  const live = await q(
    `SELECT id FROM tenant_memberships WHERE tenant_id=$1 AND identity_id=$2 AND status<>'ended'`,
    [T1, AUD.identityId],
  );
  let membershipId = live[0]?.id;
  if (!membershipId) {
    membershipId = (
      await q(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, account_id, membership_type, status, is_primary)
         VALUES ($1,$2,$3,'employee','active',false) RETURNING id`,
        [T1, AUD.identityId, AUD.accountId],
      )
    )[0].id;
  }
  await q(
    `INSERT INTO roles (id, tenant_id, code, name, kind, is_immutable, status, risk, version, created_by, created_at)
     VALUES ($1,$2,$3,$4,'tenant_custom',false,'active',$5,1,$6,now())
     ON CONFLICT (id) DO UPDATE SET status='active', name=EXCLUDED.name`,
    [AUD.roleId, T1, AUD.code, AUD.name, AUD.risk, ADMIN],
  );
  const granted = await q(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_code, granted_by)
     SELECT $1,$2,code,$3 FROM permissions WHERE code = ANY($4)
     ON CONFLICT DO NOTHING RETURNING permission_code`,
    [AUD.roleId, T1, ADMIN, AUD.perms],
  );
  const heldNow = (await q(`SELECT count(*)::int c FROM role_permissions WHERE role_id=$1`, [AUD.roleId]))[0]
    .c;
  const missing = AUD.perms.filter((c) => !granted.find((g) => g.permission_code === c));
  await q(
    `INSERT INTO role_assignments (tenant_id, id, membership_id, identity_id, role_id, scope_level, status, version, granted_by, granted_at)
     VALUES ($1,$2,$3,$4,$5,'tenant','active',1,$6,now())
     ON CONFLICT (tenant_id, id) DO UPDATE SET status='active'`,
    [T1, AUD.asgId, membershipId, AUD.identityId, AUD.roleId, ADMIN],
  );

  // ---- 2) synthetic secret/key METADATA (opaque secretref: + approved algorithm id; ZERO value) ----
  let secretCount = 0,
    versionCount = 0,
    revealCount = 0;
  for (const s of SECRETS) {
    await q(
      `INSERT INTO security_secret (tenant_id, id, material_kind, scope, secret_key, secret_ref, algorithm, state,
         current_version_no, version, correlation_id, created_by)
       VALUES ($1,$2,$3,'tenant',$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [
        T1,
        s.id,
        s.materialKind,
        s.secretKey,
        s.secretRef,
        s.algorithm,
        s.state,
        s.currentVersionNo,
        s.version,
        CORR,
        ADMIN,
      ],
    );
    secretCount += 1;
    for (const v of s.versions) {
      // Append-only/immutable evidence — DO NOTHING on rerun (never UPDATE a non-pending version; the DB trigger
      // would reject it and it must stay immutable anyway). provider_ref is null (fail-closed framework-only default).
      await q(
        `INSERT INTO security_secret_version (tenant_id, id, secret_id, version_no, state, provider_ref, activated_at,
           version, correlation_id, created_by)
         VALUES ($1,$2,$3,$4,$5,NULL, CASE WHEN $6 THEN now() ELSE NULL END, 1, $7, $8)
         ON CONFLICT (tenant_id, id) DO NOTHING`,
        [T1, v.id, s.id, v.versionNo, v.state, v.activated, CORR, ADMIN],
      );
      versionCount += 1;
    }
    for (const r of s.reveals) {
      await q(
        `INSERT INTO security_reveal (tenant_id, id, secret_id, requested_by, approved_by, purpose, reason_code,
           granted, expires_at, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,'reveal_granted',$7, now() + interval '1 hour', $8)
         ON CONFLICT (tenant_id, id) DO NOTHING`,
        [T1, r.id, s.id, r.requestedBy, r.approvedBy, r.purpose, r.granted, CORR],
      );
      revealCount += 1;
    }
  }

  await q(`RESET app.tenant_id`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        tenant: T1,
        persona: { login: AUD.login, role: AUD.code, perms_held: heldNow, skipped_missing_codes: missing },
        secrets: secretCount,
        versions: versionCount,
        reveals: revealCount,
        note: 'staging-only synthetic metadata: opaque secretref: pointers + approved algorithm ids only; ZERO secret value; password via LOGIN_PW (never printed).',
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-security-demo failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
