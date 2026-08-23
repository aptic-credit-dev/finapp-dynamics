/**
 * Stage-8 staging-only SYNTHETIC PERSONA seed — creates a reproducible role × user matrix so the whole
 * application can be exercised with DISTINCT, least-privilege identities (maker vs checker, officer vs manager,
 * auditor, restricted). NON-PRODUCTION ONLY. Idempotent + safe to rerun. Creates NO real PII (synthetic
 * @staging.local identities). Uses the canonical Argon2id credential mechanism from `@finapp/m02-auth`.
 *
 * WHY A DIRECT-SQL SEED (not the canonical API): granting `approvals.*` / domain permissions to a role is
 * grantor-bounded over the API (a caller may only confer permissions it itself holds), and the staging admin
 * holds 0/25 approvals.*. This staging seed uses the elevated (owner) DB role to establish the persona roles
 * that the API could not — exactly like seed-login.mjs. It grants only EXPLICIT canonical permission codes
 * (filtered against the live catalogue) — never a wildcard.
 *
 * Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-personas.mjs
 */
import pg from 'pg';
import { argon2idHasher } from '@finapp/m02-auth';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run: NODE_ENV=production (staging-only synthetic persona seed).');
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

// Deterministic UUID helper: base + a 2-hex slot so reruns are stable and collision-free.
const uid = (kind, n) => {
  const slot = { id: 'c', acc: 'd', role: 'e', asg: 'f' }[kind];
  return `00000000-0000-4000-8000-0000000000${slot}${n}`;
};

// Persona matrix — EXPLICIT canonical permission codes only (no wildcards). Non-existent codes are skipped.
const PERSONAS = [
  {
    n: '1', login: 'stg_treasury_maker', name: 'Treasury Maker (synthetic)', code: 'treasury_maker', risk: 'elevated',
    perms: ['journals.draft.create', 'journals.draft.submit', 'journals.draft.read', 'journals.line.manage',
      'journals.validation.run', 'approvals.request.create', 'approvals.request.submit', 'approvals.request.read',
      'approvals.note.add', 'gl_reconciliation.account.read', 'gl_reconciliation.run.read',
      'gl_reconciliation.match.read', 'gl_reconciliation.exception.read'],
  },
  {
    n: '2', login: 'stg_treasury_approver', name: 'Treasury Approver (synthetic)', code: 'treasury_approver', risk: 'critical',
    perms: ['approvals.request.read', 'approvals.request.create', 'approvals.request.submit',
      'approvals.decision.approve', 'approvals.decision.reject', 'approvals.decision.return',
      'approvals.decision.escalate', 'journals.draft.read', 'gl_reconciliation.run.read'],
  },
  {
    n: '3', login: 'stg_recovery_officer', name: 'Recovery Officer (synthetic)', code: 'recovery_officer', risk: 'elevated',
    perms: ['recovery.case.read', 'recovery.case.create', 'recovery.case.update', 'recovery.case.assign',
      'recovery.arrangement.read', 'recovery.arrangement.manage', 'recovery.demand.read', 'recovery.demand.manage',
      'recovery.analytics.read'],
  },
  {
    n: '4', login: 'stg_recovery_manager', name: 'Recovery Manager (synthetic)', code: 'recovery_manager', risk: 'critical',
    perms: ['recovery.case.read', 'recovery.arrangement.read', 'recovery.arrangement.approve',
      'recovery.writeoff.read', 'recovery.writeoff.approve', 'recovery.analytics.read', 'approvals.request.read',
      'approvals.decision.approve', 'approvals.decision.reject'],
  },
  {
    n: '5', login: 'stg_compliance_officer', name: 'Compliance Officer (synthetic)', code: 'compliance_officer', risk: 'elevated',
    perms: ['grc.control.read', 'grc.control.manage', 'grc.assessment.record'],
  },
  {
    n: '6', login: 'stg_compliance_reviewer', name: 'Compliance Reviewer (synthetic)', code: 'compliance_reviewer', risk: 'critical',
    perms: ['grc.control.read', 'approvals.request.read', 'approvals.decision.approve', 'approvals.decision.reject'],
  },
  {
    n: '7', login: 'stg_auditor', name: 'Auditor read-only (synthetic)', code: 'auditor_readonly', risk: 'normal',
    perms: ['identity.registry.view', 'rbac.role.view', 'rbac.assignment.view', 'gl_reconciliation.account.read',
      'gl_reconciliation.run.read', 'gl_reconciliation.match.read', 'gl_reconciliation.exception.read',
      'recovery.case.read', 'grc.control.read', 'approvals.request.read'],
  },
  {
    n: '8', login: 'stg_restricted', name: 'Restricted User (synthetic)', code: 'restricted_user', risk: 'normal',
    perms: ['gl_reconciliation.account.read'],
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
  const out = [];
  await q(`SET app.tenant_id = '${T1}'`);
  for (const p of PERSONAS) {
    const idId = uid('id', p.n), accId = uid('acc', p.n), roleId = uid('role', p.n), asgId = uid('asg', p.n);
    const email = `${p.login}@staging.local`;

    // 1. identity (global)
    await q(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status,
         data_classification, version, created_by, created_at)
       VALUES ($1,'internal_person',$2,$3,lower($3),'active','internal',1,$4,now())
       ON CONFLICT (id) DO UPDATE SET status='active', display_name=EXCLUDED.display_name`,
      [idId, p.name, email, ADMIN],
    );
    // 2. account + credential
    await ensureCredential(accId, idId, p.login);
    // 3. membership in T1 (active)
    const live = (await q(
      `SELECT id FROM tenant_memberships WHERE tenant_id=$1 AND identity_id=$2 AND status<>'ended'`, [T1, idId],
    ));
    let membershipId = live[0]?.id;
    if (!membershipId) {
      membershipId = (await q(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, account_id, membership_type, status, is_primary)
         VALUES ($1,$2,$3,'employee','active',false) RETURNING id`, [T1, idId, accId],
      ))[0].id;
    }
    // 4. tenant-custom role (active)
    await q(
      `INSERT INTO roles (id, tenant_id, code, name, kind, is_immutable, status, risk, version, created_by, created_at)
       VALUES ($1,$2,$3,$4,'tenant_custom',false,'active',$5,1,$6,now())
       ON CONFLICT (id) DO UPDATE SET status='active', name=EXCLUDED.name`,
      [roleId, T1, p.code, p.name, p.risk, ADMIN],
    );
    // 5. grant ONLY existing canonical permission codes (no wildcard)
    const granted = await q(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_code, granted_by)
       SELECT $1,$2,code,$3 FROM permissions WHERE code = ANY($4)
       ON CONFLICT DO NOTHING RETURNING permission_code`,
      [roleId, T1, ADMIN, p.perms],
    );
    const heldNow = (await q(`SELECT count(*)::int c FROM role_permissions WHERE role_id=$1`, [roleId]))[0].c;
    const missing = p.perms.filter(
      (c) => !granted.find((g) => g.permission_code === c),
    );
    // 6. assign role to membership (active)
    await q(
      `INSERT INTO role_assignments (tenant_id, id, membership_id, identity_id, role_id, scope_level, status, version, granted_by, granted_at)
       VALUES ($1,$2,$3,$4,$5,'tenant','active',1,$6,now())
       ON CONFLICT (tenant_id, id) DO UPDATE SET status='active'`,
      [T1, asgId, membershipId, idId, roleId, ADMIN],
    );
    out.push({ login: p.login, role: p.code, perms_held: heldNow, skipped_missing_codes: missing });
  }
  await q(`RESET app.tenant_id`);
  console.log(JSON.stringify({ ok: true, tenant: T1, personas: out, note: 'password via LOGIN_PW; never printed' }, null, 2));
} catch (e) {
  console.error('seed-personas failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
