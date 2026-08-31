/**
 * Stage-8 M42 Certification Evidence Console DEMO seed — staging-only, SYNTHETIC. NON-PRODUCTION ONLY. Idempotent.
 *
 * Two things:
 * 1) A least-privilege READ-ONLY certifier persona `stg_cert_auditor` granted ONLY the M42 read permissions
 *    (platform_certification.programme.read / assessment.read / finding.read / evidence.read). It holds NO
 *    manage/waiver/signoff/decision permission — so the console is read-only and the deny-by-default decision path
 *    is never reachable from the browser.
 * 2) A SYNTHETIC, tenant-scoped certification PROGRAMME with DELIBERATELY INCOMPLETE evidence so the server-derived
 *    verdict is an honest **NO_GO** with a real blocker list (a mostly-green 12×8 matrix with a few genuine gaps: one
 *    failed cell, two not-assessed cells, a critical OPEN finding, incomplete readiness, and missing sign-offs).
 *
 * IMPORTANT: this seed NEVER fabricates a GO. It records genuine-looking-but-incomplete evidence; seeing NO_GO
 * (or CONDITIONAL_GO once conditions are attached via the API) because real evidence is incomplete is the CORRECT
 * outcome. It records only opaque evidence references — no secret/PII/raw body. Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-certification-demo.mjs
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
const CORR = '00000000-0000-4000-8000-000000420000';
const ASSESSOR = '00000000-0000-4000-8000-0000004200a0';
const SIGNER_ENG = '00000000-0000-4000-8000-0000004200e1';
const SIGNER_SEC = '00000000-0000-4000-8000-0000004200e2';

const AUD = {
  login: 'stg_cert_auditor',
  name: 'Certification Auditor read-only (synthetic)',
  code: 'cert_auditor',
  perms: [
    'platform_certification.programme.read',
    'platform_certification.assessment.read',
    'platform_certification.finding.read',
    'platform_certification.evidence.read',
  ],
  identityId: '00000000-0000-4000-8000-000000004301',
  accountId: '00000000-0000-4000-8000-000000004302',
  roleId: '00000000-0000-4000-8000-000000004303',
  asgId: '00000000-0000-4000-8000-000000004304',
};

const PROGRAMME_ID = '00000000-0000-4000-8000-000000042001';
const DOMAINS = ['m30', 'm31', 'm32', 'm33', 'm34', 'm35', 'm36', 'm37', 'm38', 'm39', 'm40', 'm41'];
const ASPECTS = [
  'architecture',
  'security',
  'tenancy_rls',
  'sod_maker_checker',
  'events_outbox',
  'shared_service_boundaries',
  'tests_ci',
  'data_migration',
];
// Genuine gaps (everything else recorded as pass). These produce real blockers — NO fabricated GO.
const FAILED = new Set(['m41|security']); // one failed cell
const SKIP = new Set(['m40|data_migration', 'm40|tests_ci']); // two not-assessed cells (omitted → blockers)

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

  // ---- 1) read-only certifier persona ----
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

  // ---- 2) synthetic programme + INCOMPLETE evidence (honest NO_GO) ----
  await q(
    `INSERT INTO certification_programme (tenant_id, id, scope, programme_key, stage_key, title, state, correlation_id, created_by)
     VALUES ($1,$2,'tenant','stage6-closure-demo','stage-6','Stage-6 Platform Certification (synthetic)','assessing',$3,$4)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, PROGRAMME_ID, CORR, ADMIN],
  );
  let assessed = 0;
  for (const d of DOMAINS) {
    for (const a of ASPECTS) {
      const key = `${d}|${a}`;
      if (SKIP.has(key)) continue; // leave genuinely not-assessed → blocker
      const status = FAILED.has(key) ? 'fail' : 'pass';
      await q(
        `INSERT INTO certification_assessment (tenant_id, programme_id, domain_key, aspect_key, status, evidence_ref, assessed_by, correlation_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [T1, PROGRAMME_ID, d, a, status, `evidence:cert/${d}/${a}`, ASSESSOR, CORR, ADMIN],
      );
      assessed += 1;
    }
  }
  // one critical OPEN finding (a real blocker) on the failed cell
  await q(
    `INSERT INTO certification_finding (tenant_id, id, programme_id, domain_key, aspect_key, severity, status, title, evidence_ref, correlation_id, created_by)
     VALUES ($1,$2,$3,'m41','security','critical','open','Pending external penetration test (Stage-7)','evidence:cert/m41/security/finding',$4,$5)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [T1, '00000000-0000-4000-8000-000000042101', PROGRAMME_ID, CORR, ADMIN],
  );
  // readiness: migration+uat pass; pilot pending (blocker); release omitted (blocker)
  const READINESS = [
    ['migration', 'mig-2026-08', 'pass'],
    ['uat', 'uat-2026-08', 'pass'],
    ['pilot', 'pilot-2026-08', 'pending'],
  ];
  for (const [kind, refKey, result] of READINESS) {
    await q(
      `INSERT INTO certification_readiness (tenant_id, programme_id, kind, ref_key, result, evidence_ref, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [T1, PROGRAMME_ID, kind, refKey, result, `evidence:cert/readiness/${kind}`, CORR, ADMIN],
    );
  }
  // sign-offs: engineering + security approve; operations + product missing (blockers)
  const SIGNOFFS = [
    ['engineering', SIGNER_ENG],
    ['security', SIGNER_SEC],
  ];
  for (const [roleKey, signer] of SIGNOFFS) {
    await q(
      `INSERT INTO certification_signoff (tenant_id, programme_id, role_key, signed_by, disposition, correlation_id)
       VALUES ($1,$2,$3,$4,'approve',$5) ON CONFLICT DO NOTHING`,
      [T1, PROGRAMME_ID, roleKey, signer, CORR],
    );
  }

  await q(`RESET app.tenant_id`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        tenant: T1,
        persona: { login: AUD.login, perms_held: heldNow, skipped_missing_codes: missing },
        programmeId: PROGRAMME_ID,
        assessments_recorded: assessed,
        gaps: { failed: [...FAILED], not_assessed: [...SKIP] },
        readiness: 'migration/uat pass; pilot pending; release omitted',
        signoffs: 'engineering + security approved; operations + product missing',
        note: 'INCOMPLETE by design → server-derived verdict is an honest NO_GO with a real blocker list. No GO is ever fabricated. Opaque evidence refs only; password via LOGIN_PW (never printed).',
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-certification-demo failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
