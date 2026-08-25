/**
 * Stage-8 staging-only SYNTHETIC PERSONA seed — Customer Service + Legal cluster.
 * Adds least-privilege, EXPLICIT-code personas for M12 Feedback + M14/M16 Legal + M18 Legal Documents so the
 * maker-checker / SoD chains can be exercised with DISTINCT identities. NON-PRODUCTION ONLY. Idempotent.
 * Creates NO real PII (synthetic @staging.local). Uses canonical Argon2id from @finapp/m02-auth. No wildcards.
 * Mirrors deploy/staging/seed-personas.mjs exactly; distinct UUID base (…0b0k0s) so it never collides with it.
 *
 * Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-legal-cs-personas.mjs
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
const ADMIN = '00000000-0000-4000-8000-0000000000a1';

// Distinct base from seed-personas.mjs (which uses …0000000000{slot}{n}); here …0000000b0{k}0{s}.
const S = { id: '0', acc: '1', role: '2', asg: '3' };
const uid = (kind, k) => `00000000-0000-4000-8000-0000000b0${k}0${S[kind]}`;

const PERSONAS = [
  {
    k: '0',
    login: 'stg_demo_manager',
    name: 'Demo Manager — read-only navigation (synthetic)',
    code: 'demo_manager',
    risk: 'normal',
    perms: [
      // identity / rbac (view)
      'identity.registry.view',
      'identity.account.view',
      'identity.membership.view',
      'rbac.role.view',
      'rbac.assignment.view',
      'rbac.permission.view',
      'rbac.sod.view',
      // treasury / reconciliation
      'gl_reconciliation.account.read',
      'gl_reconciliation.run.read',
      'gl_reconciliation.match.read',
      'gl_reconciliation.exception.read',
      // approvals (read only — cannot decide)
      'approvals.request.read',
      // recovery
      'recovery.case.read',
      'recovery.arrangement.read',
      'recovery.demand.read',
      'recovery.analytics.read',
      // compliance / grc + privacy / security
      'grc.control.read',
      'privacy.policy.read',
      'security.dlp.read',
      // finance fiscal calendar + journals (read only — cannot post)
      'finance.period.read',
      'finance.fiscal_year.read',
      'finance.entity.read',
      'finance.account.read',
      'finance.config.read',
      'finance.currency.read',
      'journals.draft.read',
      'journals.posting_request.read',
      'journals.posting_result.read',
      'journals.type.read',
      'journals.validation.read',
      // saas plans & subscriptions
      'saas.plan.read',
      'saas.subscription.read',
      'saas.entitlement.read',
      'saas.quota.read',
      'saas.usage.read',
      // feedback (read + contact reveal for demo; audited server-side)
      'feedback.record.read',
      'feedback.queue.read',
      'feedback.assignment.read',
      'feedback.escalation.read',
      'feedback.response.read',
      'feedback.activity.read',
      'feedback.sla.read',
      'feedback.analytics.read',
      'feedback.case_handoff.read',
      'feedback.customer_contact.read',
      // legal cases
      'cases.case.read',
      'cases.activity.read',
      'cases.party.read',
      'cases.relationship.read',
      'cases.decision.read',
      'cases.settlement.read',
      // legal matters
      'legal.matter.read',
      'legal.position.read',
      'legal.opinion.read',
      'legal.counsel_report.read',
      'legal.activity.read',
      'legal.settlement.read',
      // litigation
      'litigation.proceeding.read',
      'litigation.filing.read',
      'litigation.party.read',
      'litigation.service.read',
      'litigation.appearance.read',
      'litigation.witness.read',
      // legal documents
      'legaldocs.knowledge.read',
      'legaldocs.template.read',
      'legaldocs.authority.read',
      'legaldocs.precedent.read',
      'legaldocs.review.read',
      // reporting / analytics (read + run only)
      'analytics.dataset.read',
      'analytics.metric.read',
      'analytics.report.read',
      'analytics.query.run',
    ],
  },
  {
    k: 'a',
    login: 'stg_report_author',
    name: 'Report Author (synthetic)',
    code: 'report_author',
    risk: 'elevated',
    perms: [
      'analytics.dataset.read',
      'analytics.dataset.manage',
      'analytics.metric.read',
      'analytics.metric.author',
      'analytics.report.read',
      'analytics.report.author',
      'analytics.query.run',
      // needed to materialize the REAL feedback dataset through the canonical m12 aggregate seam
      'feedback.analytics.read',
    ],
  },
  {
    k: 'b',
    login: 'stg_report_reviewer',
    name: 'Report Reviewer / Publisher (synthetic)',
    code: 'report_reviewer',
    risk: 'critical',
    perms: [
      'analytics.dataset.read',
      'analytics.metric.read',
      'analytics.metric.publish',
      'analytics.report.read',
      'analytics.report.publish',
      'analytics.query.run',
    ],
  },
  {
    k: 'c',
    login: 'stg_management_viewer',
    name: 'Management Viewer (synthetic)',
    code: 'management_viewer',
    risk: 'normal',
    perms: [
      'analytics.dataset.read',
      'analytics.metric.read',
      'analytics.report.read',
      'analytics.query.run',
    ],
  },
  {
    k: '1',
    login: 'stg_cso',
    name: 'Customer Service Officer (synthetic)',
    code: 'cs_officer',
    risk: 'elevated',
    perms: [
      'feedback.record.read',
      'feedback.record.create',
      'feedback.record.capture',
      'feedback.record.classify',
      'feedback.record.update',
      'feedback.record.close',
      'feedback.queue.read',
      'feedback.queue.claim',
      'feedback.assignment.read',
      'feedback.escalation.read',
      'feedback.escalation.trigger',
      'feedback.confirmation.record',
      'feedback.activity.read',
      'feedback.activity.create',
      'feedback.activity.complete',
      'feedback.response.read',
      'feedback.sla.read',
      'feedback.case_handoff.read',
      'feedback.case_handoff.request',
      'feedback.customer_contact.read',
    ],
  },
  {
    k: '2',
    login: 'stg_cs_manager',
    name: 'Customer Service Manager (synthetic)',
    code: 'cs_manager',
    risk: 'critical',
    perms: [
      'feedback.record.read',
      'feedback.record.reopen',
      'feedback.queue.read',
      'feedback.queue.assign',
      'feedback.assignment.read',
      'feedback.assignment.manage',
      'feedback.escalation.read',
      'feedback.resolution.approve',
      'feedback.analytics.read',
      'feedback.sla.read',
      'feedback.activity.read',
    ],
  },
  {
    k: '3',
    login: 'stg_cs_hod',
    name: 'Customer Service HOD (synthetic)',
    code: 'cs_hod',
    risk: 'critical',
    perms: [
      'feedback.record.read',
      'feedback.record.update',
      'feedback.escalation.read',
      'feedback.resolution.submit',
      'feedback.response.submit',
      'feedback.root_cause.manage',
      'feedback.activity.read',
      'feedback.activity.create',
      'feedback.customer_contact.read',
      'feedback.sla.read',
    ],
  },
  {
    k: '4',
    login: 'stg_legal_officer',
    name: 'Legal Officer (synthetic)',
    code: 'legal_officer',
    risk: 'elevated',
    perms: [
      'legal.matter.read',
      'legal.matter.create',
      'legal.matter.open',
      'legal.matter.update',
      'legal.matter.assign',
      'legal.matter.resolve',
      'legal.position.read',
      'legal.position.manage',
      'legal.opinion.read',
      'legal.counsel_report.read',
      'legal.activity.read',
      'legal.activity.create',
      'legal.deadline.read',
      'legal.settlement.submit',
      'legal.instruction.read',
      'cases.case.read',
      'cases.party.read',
      'litigation.proceeding.read',
      'litigation.filing.read',
      'litigation.filing.manage',
      'litigation.party.read',
      'legaldocs.knowledge.read',
      'legaldocs.template.read',
    ],
  },
  {
    k: '5',
    login: 'stg_legal_manager',
    name: 'Legal Manager (synthetic)',
    code: 'legal_manager',
    risk: 'critical',
    perms: [
      'legal.matter.read',
      'legal.matter.close',
      'legal.matter.archive',
      'legal.matter.reassign',
      'legal.matter.reopen',
      'legal.settlement.read',
      'legal.settlement.approve',
      'legal.opinion.manage',
      'legal.analytics.read',
      'cases.case.read',
      'litigation.proceeding.read',
      'litigation.proceeding.create',
      'litigation.proceeding.assign',
      'litigation.proceeding.conclude',
      'litigation.proceeding.close',
      'litigation.proceeding.reopen',
      'litigation.proceeding.archive',
      'litigation.party.read',
      'litigation.party.manage',
    ],
  },
  {
    k: '6',
    login: 'stg_filing_approver',
    name: 'Litigation Filing Approver (synthetic)',
    code: 'filing_approver',
    risk: 'critical',
    perms: ['litigation.proceeding.read', 'litigation.filing.read', 'litigation.filing.approve'],
  },
  {
    k: '7',
    login: 'stg_knowledge_author',
    name: 'Legal Knowledge Author (synthetic)',
    code: 'knowledge_author',
    risk: 'elevated',
    perms: [
      'legaldocs.knowledge.read',
      'legaldocs.knowledge.create',
      'legaldocs.knowledge.update',
      'legaldocs.knowledge.submit',
      'legaldocs.template.read',
      'legaldocs.template.manage',
      'legaldocs.authority.read',
      'legaldocs.precedent.read',
    ],
  },
  {
    k: '8',
    login: 'stg_legal_reviewer',
    name: 'Legal Knowledge Reviewer (synthetic)',
    code: 'legal_reviewer',
    risk: 'critical',
    perms: [
      'legaldocs.knowledge.read',
      'legaldocs.knowledge.review',
      'legaldocs.review.read',
      'legaldocs.review.manage',
    ],
  },
  {
    k: '9',
    login: 'stg_legal_publisher',
    name: 'Legal Knowledge Publisher (synthetic)',
    code: 'legal_publisher',
    risk: 'critical',
    perms: [
      'legaldocs.knowledge.read',
      'legaldocs.knowledge.approve',
      'legaldocs.knowledge.publish',
      'legaldocs.knowledge.supersede',
      'legaldocs.knowledge.withdraw',
      'legaldocs.template.read',
      'legaldocs.template.approve',
      'legaldocs.template.publish',
    ],
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
    const idId = uid('id', p.k),
      accId = uid('acc', p.k),
      roleId = uid('role', p.k),
      asgId = uid('asg', p.k);
    const email = `${p.login}@staging.local`;
    await q(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status,
         data_classification, version, created_by, created_at)
       VALUES ($1,'internal_person',$2,$3,lower($3),'active','internal',1,$4,now())
       ON CONFLICT (id) DO UPDATE SET status='active', display_name=EXCLUDED.display_name`,
      [idId, p.name, email, ADMIN],
    );
    await ensureCredential(accId, idId, p.login);
    const live = await q(
      `SELECT id FROM tenant_memberships WHERE tenant_id=$1 AND identity_id=$2 AND status<>'ended'`,
      [T1, idId],
    );
    let membershipId = live[0]?.id;
    if (!membershipId) {
      membershipId = (
        await q(
          `INSERT INTO tenant_memberships (tenant_id, identity_id, account_id, membership_type, status, is_primary)
           VALUES ($1,$2,$3,'employee','active',false) RETURNING id`,
          [T1, idId, accId],
        )
      )[0].id;
    }
    await q(
      `INSERT INTO roles (id, tenant_id, code, name, kind, is_immutable, status, risk, version, created_by, created_at)
       VALUES ($1,$2,$3,$4,'tenant_custom',false,'active',$5,1,$6,now())
       ON CONFLICT (id) DO UPDATE SET status='active', name=EXCLUDED.name`,
      [roleId, T1, p.code, p.name, p.risk, ADMIN],
    );
    const granted = await q(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_code, granted_by)
       SELECT $1,$2,code,$3 FROM permissions WHERE code = ANY($4)
       ON CONFLICT DO NOTHING RETURNING permission_code`,
      [roleId, T1, ADMIN, p.perms],
    );
    const heldNow = (await q(`SELECT count(*)::int c FROM role_permissions WHERE role_id=$1`, [roleId]))[0].c;
    const missing = p.perms.filter((c) => !granted.find((g) => g.permission_code === c));
    await q(
      `INSERT INTO role_assignments (tenant_id, id, membership_id, identity_id, role_id, scope_level, status, version, granted_by, granted_at)
       VALUES ($1,$2,$3,$4,$5,'tenant','active',1,$6,now())
       ON CONFLICT (tenant_id, id) DO UPDATE SET status='active'`,
      [T1, asgId, membershipId, idId, roleId, ADMIN],
    );
    out.push({ login: p.login, role: p.code, perms_held: heldNow, skipped_missing_codes: missing });
  }
  await q(`RESET app.tenant_id`);
  console.log(
    JSON.stringify(
      { ok: true, tenant: T1, personas: out, note: 'password via LOGIN_PW; never printed' },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-legal-cs-personas failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
