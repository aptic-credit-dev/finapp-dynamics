/**
 * Stage-8 M44 Debt Recovery DEMO seed (staging-only, synthetic).
 *
 * Grants the synthetic `platform_admin` role the m17-recovery READ + non-privileged operational permissions so
 * the Debt Recovery UI can read cases/analytics/notes/arrangements. Same rationale + shape as seed-recon-demo:
 * platform_admin's role_permissions were seeded point-in-time at the m02-rbac migration, so permissions added by
 * a LATER module (m17 recovery.*) were never granted. This closes that gap for staging via the canonical
 * `role_permissions` table (tenant_id NULL), EXCLUDING the privileged control-plane perms:
 *   - recovery.platform.administer  (platform admin control plane)
 *   - recovery.privileged.create    (create privileged/confidential cases)
 *   - recovery.confidential.read    (read confidential/privileged case bodies + amounts)
 * so no unrestricted power and the confidentiality redaction stays meaningful. SoD/maker-checker unchanged.
 *
 * Connects with the elevated (superuser) DATABASE_URL for seeding. Refuses in prod. No secrets, no PII, no real data.
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

const GRANT_LIKE = 'recovery.%';
const EXCLUDE = ['recovery.platform.administer', 'recovery.privileged.create', 'recovery.confidential.read'];
const PLATFORM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001';

try {
  const inserted = await q(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_code)
       SELECT $1, NULL, p.code FROM permissions p
        WHERE p.code LIKE $2 AND p.code <> ALL($3::text[])
          AND NOT EXISTS (
            SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = $1 AND rp.tenant_id IS NULL AND rp.permission_code = p.code)
     RETURNING permission_code`,
    [PLATFORM_ADMIN_ROLE_ID, GRANT_LIKE, EXCLUDE],
  );
  const total = await q(
    `SELECT count(*)::int c FROM role_permissions
      WHERE role_id = $1 AND tenant_id IS NULL AND permission_code LIKE $2`,
    [PLATFORM_ADMIN_ROLE_ID, GRANT_LIKE],
  );
  const privileged = await q(
    `SELECT count(*)::int c FROM role_permissions
      WHERE role_id = $1 AND tenant_id IS NULL AND permission_code = ANY($2::text[])`,
    [PLATFORM_ADMIN_ROLE_ID, EXCLUDE],
  );
  console.log(
    JSON.stringify({
      ok: true,
      newly_granted: inserted.length,
      platform_admin_recovery_perms: total[0].c,
      excluded_privileged: EXCLUDE,
      privileged_perms_held: privileged[0].c, // MUST be 0
      note: 'staging-only: closes the point-in-time role_permissions gap for platform_admin (m17 recovery READ + non-privileged ops); confidential/privileged/platform-admin perms excluded; SoD/maker-checker unchanged.',
    }),
  );
} catch (e) {
  console.error('seed-recovery-demo failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
