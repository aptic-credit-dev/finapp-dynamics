/**
 * Stage-8 M37 Release Governance DEMO seed — staging-only, SYNTHETIC. NON-PRODUCTION ONLY. Idempotent.
 *
 * Seeds a least-privilege READ-ONLY persona and synthetic, tenant-safe governance data for the read-only Release
 * Governance surface (Artifacts / Environments / Releases):
 *   stg_release_auditor   govrelease.artifact.read + govrelease.release.read  (reads only; NO manage/author/
 *                         gate/approve/execute/administer → every mutating route is 403 server-side).
 *
 * Data is INTERNAL-kind only (the intrinsically-releasable path): two internal artifacts, two environments, and a
 * spread of releases across real states (released / review_pending / qa_passed / draft) so the read surface shows
 * genuine backend truth. This seed records NO secret material (no signature refs), fabricates NO GO/NO_GO verdict
 * (m37 has no such concept — that is m42's), and adds NO approval semantics. Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-releases-demo.mjs
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
const CORR = '00000000-0000-4000-8000-000000037000';
const REQ = '00000000-0000-4000-8000-0000000373a1';

const AUD = {
  login: 'stg_release_auditor',
  name: 'Release Governance auditor read-only (synthetic)',
  code: 'release_auditor',
  perms: ['govrelease.artifact.read', 'govrelease.release.read'],
  identityId: '00000000-0000-4000-8000-000000037001',
  accountId: '00000000-0000-4000-8000-000000037002',
  roleId: '00000000-0000-4000-8000-000000037003',
  asgId: '00000000-0000-4000-8000-000000037004',
};

const ART1 = '00000000-0000-4000-8000-000000037101'; // core-api (internal)
const ART2 = '00000000-0000-4000-8000-000000037102'; // batch-worker (internal)
const ENV_STG = '00000000-0000-4000-8000-000000037201';
const ENV_PROD = '00000000-0000-4000-8000-000000037202';
const REL1 = '00000000-0000-4000-8000-000000037301'; // released   (core-api → staging)
const REL2 = '00000000-0000-4000-8000-000000037302'; // review_pending (core-api → production)
const REL3 = '00000000-0000-4000-8000-000000037303'; // qa_passed  (batch-worker → staging)
const REL4 = '00000000-0000-4000-8000-000000037304'; // draft      (batch-worker → production)

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

  // ---- persona ----
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
     VALUES ($1,$2,$3,$4,'tenant_custom',false,'active','normal',1,$5,now())
     ON CONFLICT (id) DO UPDATE SET status='active', name=EXCLUDED.name`,
    [AUD.roleId, T1, AUD.code, AUD.name, ADMIN],
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

  // ---- artifacts (INTERNAL kind only) ----
  const artifact = async (id, key, name) =>
    q(
      `INSERT INTO govrelease_artifact (tenant_id, id, scope, artifact_key, artifact_kind, artifact_ref, name, status, version, correlation_id, created_by, updated_by)
       VALUES ($1,$2,'tenant',$3,'internal',$4,$5,'active',1,$6,$7,$7)
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [T1, id, key, `internal:${key}`, name, CORR, ADMIN],
    );
  await artifact(ART1, 'core-api', 'Core API');
  await artifact(ART2, 'batch-worker', 'Batch Worker');

  // ---- environments ----
  const environment = async (id, key, tier) =>
    q(
      `INSERT INTO govrelease_environment (tenant_id, id, scope, env_key, tier, requires_approval, status, version, correlation_id, created_by, updated_by)
       VALUES ($1,$2,'tenant',$3,$4,true,'active',1,$5,$6,$6)
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [T1, id, key, tier, CORR, ADMIN],
    );
  await environment(ENV_STG, 'staging', 1);
  await environment(ENV_PROD, 'production', 2);

  // ---- releases (spread of real states; evidence_ck: review_pending/released require qa_passed=true) ----
  const release = async (id, artId, envId, key, fromV, toV, state, qa) =>
    q(
      `INSERT INTO govrelease_release (tenant_id, id, artifact_id, environment_id, scope, release_key, from_version, to_version, state, qa_passed, requested_by, content_hash, version, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'tenant',$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$13)
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [T1, id, artId, envId, key, fromV, toV, state, qa, REQ, `sha256:${key}`, CORR, ADMIN],
    );
  await release(REL1, ART1, ENV_STG, 'core-api-staging-r3', 2, 3, 'released', true);
  await release(REL2, ART1, ENV_PROD, 'core-api-prod-r2', 1, 2, 'review_pending', true);
  await release(REL3, ART2, ENV_STG, 'batch-worker-staging-r1', null, 1, 'qa_passed', true);
  await release(REL4, ART2, ENV_PROD, 'batch-worker-prod-r1', null, 1, 'draft', false);

  await q(`RESET app.tenant_id`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        tenant: T1,
        persona: { login: AUD.login, perms_held: heldNow, skipped_missing_codes: missing },
        artifacts: { 'core-api': ART1, 'batch-worker': ART2 },
        environments: { staging: ENV_STG, production: ENV_PROD },
        releases: { released: REL1, review_pending: REL2, qa_passed: REL3, draft: REL4 },
        note: 'SYNTHETIC, INTERNAL-kind only. No secret material, no GO/NO_GO verdict, no approval semantics. Read-only surface. Password via LOGIN_PW (never printed).',
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-releases-demo failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
