/**
 * Stage-8 M35 Developer Portal DEMO seed — staging-only, SYNTHETIC. NON-PRODUCTION ONLY. Idempotent.
 *
 * Seeds three least-privilege developer personas whose permission separation is REAL (drawn from the 8 canonical
 * devportal.* permissions), plus synthetic, tenant-safe portal data that tells the HONEST runtime story:
 *
 *   stg_developer            app.read + product.read + app.manage + credential.manage
 *                            → registers apps, issues/rotates/revokes credentials, browses the catalog.
 *                              Holds NO subscription.manage → cannot see/manage subscriptions.
 *   stg_developer_admin      the above + product.author + product.publish + subscription.manage
 *                            → authors/publishes products (internal) and manages subscriptions (maker-checker).
 *                              Holds NO devportal.control.administer → PUBLIC exposure stays fail-closed.
 *   stg_developer_restricted app.read + product.read ONLY
 *                            → read-only; every write is 403, and subscriptions are invisible (privileged read).
 *
 * Data: two active applications (one with a hash-only credential — ZERO plaintext), and three products that make
 * the runtime boundary explicit: an INTERNAL published "Billing API" (the only live end-to-end path), a PUBLIC
 * published "Public Ledger API" (visible, but subscription approval FAILS CLOSED on the m39 quota), and a
 * CONNECTOR-sourced draft "Partner Sync API" (m33 runtime framework-only). Subscriptions: one ACTIVE (Billing),
 * one REQUESTED by stg_developer awaiting maker-checker approval (Billing — a DIFFERENT approver can activate it),
 * and one REQUESTED against the PUBLIC product (approving it fails closed — the honest public-exposure boundary).
 *
 * A credential is stored as a one-way sha256: hash ONLY — no plaintext is ever seeded. Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-devportal-demo.mjs
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
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const CORR = '00000000-0000-4000-8000-000000035000';

const PERSONAS = [
  {
    login: 'stg_developer',
    name: 'Developer self-service (synthetic)',
    code: 'developer',
    perms: [
      'devportal.app.read',
      'devportal.product.read',
      'devportal.app.manage',
      'devportal.credential.manage',
    ],
    identityId: '00000000-0000-4000-8000-000000035001',
    accountId: '00000000-0000-4000-8000-000000035002',
    roleId: '00000000-0000-4000-8000-000000035003',
    asgId: '00000000-0000-4000-8000-000000035004',
  },
  {
    login: 'stg_developer_admin',
    name: 'Developer portal admin (synthetic)',
    code: 'developer_admin',
    perms: [
      'devportal.app.read',
      'devportal.product.read',
      'devportal.app.manage',
      'devportal.credential.manage',
      'devportal.product.author',
      'devportal.product.publish',
      'devportal.subscription.manage',
    ],
    identityId: '00000000-0000-4000-8000-000000035011',
    accountId: '00000000-0000-4000-8000-000000035012',
    roleId: '00000000-0000-4000-8000-000000035013',
    asgId: '00000000-0000-4000-8000-000000035014',
  },
  {
    login: 'stg_developer_restricted',
    name: 'Developer read-only (synthetic)',
    code: 'developer_restricted',
    perms: ['devportal.app.read', 'devportal.product.read'],
    identityId: '00000000-0000-4000-8000-000000035021',
    accountId: '00000000-0000-4000-8000-000000035022',
    roleId: '00000000-0000-4000-8000-000000035023',
    asgId: '00000000-0000-4000-8000-000000035024',
  },
];
const DEV_ID = PERSONAS[0].identityId; // requester for the maker-checker subscription (approver must differ)

// Fixed synthetic ids for the portal data.
const APP1 = '00000000-0000-4000-8000-000000035101'; // Acme Integration (has a credential)
const APP2 = '00000000-0000-4000-8000-000000035102'; // Beta Service
const CRED1 = '00000000-0000-4000-8000-000000035111';
const P_BILLING = '00000000-0000-4000-8000-000000035201'; // internal, published (LIVE)
const P_PUBLIC = '00000000-0000-4000-8000-000000035202'; // public, published (fail-closed subscription)
const P_CONN = '00000000-0000-4000-8000-000000035203'; // connector, draft (m33 framework-only)
const SCOPE1 = '00000000-0000-4000-8000-000000035211';
const SUB_ACTIVE = '00000000-0000-4000-8000-000000035301';
const SUB_REQ = '00000000-0000-4000-8000-000000035302';
const SUB_PUBREQ = '00000000-0000-4000-8000-000000035303';
const REQ1 = '00000000-0000-4000-8000-0000000353a1';
const REQ2 = '00000000-0000-4000-8000-0000000353a2';
const HASH = `sha256:${'a'.repeat(64)}`; // a well-formed one-way hash — NEVER a plaintext value

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

async function seedPersona(p) {
  const email = `${p.login}@staging.local`;
  await q(
    `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status,
       data_classification, version, created_by, created_at)
     VALUES ($1,'internal_person',$2,$3,lower($3),'active','internal',1,$4,now())
     ON CONFLICT (id) DO UPDATE SET status='active', display_name=EXCLUDED.display_name`,
    [p.identityId, p.name, email, ADMIN],
  );
  await ensureCredential(p.accountId, p.identityId, p.login);
  const live = await q(
    `SELECT id FROM tenant_memberships WHERE tenant_id=$1 AND identity_id=$2 AND status<>'ended'`,
    [T1, p.identityId],
  );
  let membershipId = live[0]?.id;
  if (!membershipId) {
    membershipId = (
      await q(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, account_id, membership_type, status, is_primary)
         VALUES ($1,$2,$3,'employee','active',false) RETURNING id`,
        [T1, p.identityId, p.accountId],
      )
    )[0].id;
  }
  await q(
    `INSERT INTO roles (id, tenant_id, code, name, kind, is_immutable, status, risk, version, created_by, created_at)
     VALUES ($1,$2,$3,$4,'tenant_custom',false,'active','normal',1,$5,now())
     ON CONFLICT (id) DO UPDATE SET status='active', name=EXCLUDED.name`,
    [p.roleId, T1, p.code, p.name, ADMIN],
  );
  const granted = await q(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_code, granted_by)
     SELECT $1,$2,code,$3 FROM permissions WHERE code = ANY($4)
     ON CONFLICT DO NOTHING RETURNING permission_code`,
    [p.roleId, T1, ADMIN, p.perms],
  );
  const heldNow = (await q(`SELECT count(*)::int c FROM role_permissions WHERE role_id=$1`, [p.roleId]))[0].c;
  const missing = p.perms.filter((c) => !granted.find((g) => g.permission_code === c));
  await q(
    `INSERT INTO role_assignments (tenant_id, id, membership_id, identity_id, role_id, scope_level, status, version, granted_by, granted_at)
     VALUES ($1,$2,$3,$4,$5,'tenant','active',1,$6,now())
     ON CONFLICT (tenant_id, id) DO UPDATE SET status='active'`,
    [T1, p.asgId, membershipId, p.identityId, p.roleId, ADMIN],
  );
  return { login: p.login, perms_held: heldNow, skipped_missing_codes: missing };
}

try {
  await q(`SET app.tenant_id = '${T1}'`);

  const personaReport = [];
  for (const p of PERSONAS) personaReport.push(await seedPersona(p));

  // ---- applications (2 active) ----
  await q(
    `INSERT INTO devportal_app (tenant_id, id, scope, app_key, name, description, owner_ref, status, version, correlation_id, created_by, updated_by)
     VALUES ($1,$2,'tenant','acme-integration','Acme Integration','Synthetic first-party integration app.','team-acme','active',1,$3,$4,$4)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, APP1, CORR, ADMIN],
  );
  await q(
    `INSERT INTO devportal_app (tenant_id, id, scope, app_key, name, description, owner_ref, status, version, correlation_id, created_by, updated_by)
     VALUES ($1,$2,'tenant','beta-service','Beta Service','Synthetic second app (no credentials yet).','team-beta','active',1,$3,$4,$4)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, APP2, CORR, ADMIN],
  );

  // ---- a hash-only credential for Acme (ZERO plaintext) ----
  await q(
    `INSERT INTO devportal_credential (tenant_id, id, app_id, key_id, purpose, secret_hash, status, version, correlation_id, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'api',$5,'active',1,$6,$7,$7)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, CRED1, APP1, 'dpk_00000000000000000000000000035111', HASH, CORR, ADMIN],
  );

  // ---- products: internal published (LIVE), public published (fail-closed sub), connector draft (framework-only) ----
  await q(
    `INSERT INTO devportal_api_product (tenant_id, id, scope, product_key, title, summary, category, visibility, source_kind, source_ref, state, validation_passed, content_hash, version, correlation_id, created_by, updated_by)
     VALUES ($1,$2,'tenant','billing-api','Billing API','Internal, tenant-scoped billing product (live end-to-end).','finance','tenant','internal',NULL,'published',true,'sha256:billing',1,$3,$4,$4)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, P_BILLING, CORR, ADMIN],
  );
  await q(
    `INSERT INTO devportal_api_product (tenant_id, id, scope, product_key, title, summary, category, visibility, source_kind, source_ref, state, validation_passed, content_hash, version, correlation_id, created_by, updated_by)
     VALUES ($1,$2,'tenant','public-ledger-api','Public Ledger API','PUBLIC visibility — exposure not yet production-enabled (m39 quota fail-closed).','data','public','internal',NULL,'published',true,'sha256:public',1,$3,$4,$4)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, P_PUBLIC, CORR, ADMIN],
  );
  await q(
    `INSERT INTO devportal_api_product (tenant_id, id, scope, product_key, title, summary, category, visibility, source_kind, source_ref, state, validation_passed, content_hash, version, correlation_id, created_by, updated_by)
     VALUES ($1,$2,'tenant','partner-sync-api','Partner Sync API','Connector-sourced (m33) — runtime framework-only, cannot be published.','integration','tenant','connector','connector:partner-sync','draft',false,'sha256:partner',1,$3,$4,$4)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, P_CONN, CORR, ADMIN],
  );
  // an allow-listed operation on the internal product — carries the m02 permission it requires (facade rule).
  await q(
    `INSERT INTO devportal_product_scope (tenant_id, id, product_id, operation_ref, required_permission, description, correlation_id, created_by)
     VALUES ($1,$2,$3,'GET /invoices','finance.invoice.read','Read invoices',$4,$5)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, SCOPE1, P_BILLING, CORR, ADMIN],
  );

  // ---- subscriptions ----
  // S1 ACTIVE — Acme → Billing (an active entitlement; requester != approver).
  await q(
    `INSERT INTO devportal_subscription (tenant_id, id, app_id, product_id, status, requested_by, approved_by, version, correlation_id, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'active',$5,$6,1,$7,$8,$8)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, SUB_ACTIVE, APP1, P_BILLING, REQ1, REQ2, CORR, ADMIN],
  );
  // S2 REQUESTED — Beta → Billing, requested by stg_developer → a DIFFERENT admin approves it in the browser (SoD).
  await q(
    `INSERT INTO devportal_subscription (tenant_id, id, app_id, product_id, status, requested_by, approved_by, version, correlation_id, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'requested',$5,NULL,1,$6,$7,$7)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, SUB_REQ, APP2, P_BILLING, DEV_ID, CORR, ADMIN],
  );
  // S3 REQUESTED — Acme → Public Ledger, requested by stg_developer → approving it FAILS CLOSED (public exposure).
  await q(
    `INSERT INTO devportal_subscription (tenant_id, id, app_id, product_id, status, requested_by, approved_by, version, correlation_id, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'requested',$5,NULL,1,$6,$7,$7)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, SUB_PUBREQ, APP1, P_PUBLIC, DEV_ID, CORR, ADMIN],
  );

  await q(`RESET app.tenant_id`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        tenant: T1,
        personas: personaReport,
        apps: [APP1, APP2],
        credentials: [CRED1],
        products: { internal_published: P_BILLING, public_published: P_PUBLIC, connector_draft: P_CONN },
        subscriptions: { active: SUB_ACTIVE, requested_billing: SUB_REQ, requested_public: SUB_PUBREQ },
        note: 'SYNTHETIC. Credentials are one-way sha256 hashes ONLY (no plaintext). Public/connector products are shown as NOT production-enabled. Password via LOGIN_PW (never printed).',
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-devportal-demo failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
