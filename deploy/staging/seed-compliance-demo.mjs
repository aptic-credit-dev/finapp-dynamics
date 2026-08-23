/**
 * Stage-8 M45 Regulatory & Compliance DEMO seed (staging-only, synthetic).
 *
 * Grants the synthetic `platform_admin` role the m41 GRC permissions so the Compliance UI can read the control
 * register + assessment evidence and record an assessment. Same rationale + canonical role_permissions shape as
 * seed-recon-demo / seed-recovery-demo: platform_admin's role_permissions were seeded point-in-time at the
 * m02-rbac migration, so m41 grc.* perms were never granted.
 *
 * The full grc.* namespace is only three permissions and NONE are privileged (there is no grc.admin / wildcard):
 *   - grc.control.read       (read the control register + assessments)
 *   - grc.control.manage     (define a control)
 *   - grc.assessment.record  (record an append-only control assessment = evidence)
 *
 * Recording an assessment records CONTROL/EVIDENCE state — it is NOT a regulatory-compliance certification.
 * Connects with the elevated (superuser) DATABASE_URL for seeding. Refuses in prod. No secrets/PII/real data.
 */
import pg from 'pg';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run: NODE_ENV=production (staging-only synthetic seed).');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
const q = async (text, params) => (await pool.query(text, params)).rows;

const GRANT = ['grc.control.read', 'grc.control.manage', 'grc.assessment.record'];
const PLATFORM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001';

try {
  const inserted = await q(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_code)
       SELECT $1, NULL, p.code FROM permissions p
        WHERE p.code = ANY($2::text[])
          AND NOT EXISTS (
            SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = $1 AND rp.tenant_id IS NULL AND rp.permission_code = p.code)
     RETURNING permission_code`,
    [PLATFORM_ADMIN_ROLE_ID, GRANT],
  );
  const total = await q(
    `SELECT count(*)::int c FROM role_permissions
      WHERE role_id = $1 AND tenant_id IS NULL AND permission_code LIKE 'grc.%'`,
    [PLATFORM_ADMIN_ROLE_ID],
  );
  console.log(
    JSON.stringify({
      ok: true,
      newly_granted: inserted.length,
      platform_admin_grc_perms: total[0].c,
      granted: GRANT,
      note: 'staging-only: closes the point-in-time role_permissions gap for platform_admin (m41 grc.* — no privileged/admin perm exists in this namespace); records control/evidence state, not certification.',
    }),
  );
} catch (e) {
  console.error('seed-compliance-demo failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
