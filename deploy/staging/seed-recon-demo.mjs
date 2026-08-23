/**
 * Stage-8 Treasury & Reconciliation DEMO seed (staging-only, synthetic).
 *
 * Fixes the demo-user RBAC gap and grants the synthetic `platform_admin` role the gl_reconciliation READ +
 * operational permissions. This is NOT a hack: `platform_admin` is the "full platform administration" role, but
 * its role_permissions were seeded point-in-time at the m02-rbac migration (a snapshot of `SELECT code FROM
 * permissions`), so permissions added by LATER modules (m20 gl_reconciliation.*) were never granted to it. This
 * seed closes that gap for staging, using the canonical `role_permissions` table (tenant_id NULL, matching the
 * existing platform_admin grant). It does NOT weaken SoD/maker-checker (those are enforced at execution time
 * regardless of the permission set) and grants NO privileged override (no gl_reconciliation.admin / .override).
 *
 * Connects with the elevated (superuser) DATABASE_URL for seeding (same as bootstrap-synthetic). Refuses in prod.
 * No secrets, no PII, no real data.
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

// The gl_reconciliation permissions the current UI needs (read + the operational/maker-checker set), EXCLUDING
// the privileged control-plane ones (.admin, .certification.override) so we do not grant unrestricted power.
const GRANT_LIKE = 'gl_reconciliation.%';
const EXCLUDE = ['gl_reconciliation.admin', 'gl_reconciliation.certification.override'];
const PLATFORM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001';

try {
  // Grant the (non-privileged) gl_reconciliation permissions to platform_admin (tenant_id NULL, canonical shape),
  // idempotently. `permissions` is the authoritative catalogue; we only grant codes that actually exist.
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
  console.log(
    JSON.stringify({
      ok: true,
      newly_granted: inserted.length,
      platform_admin_gl_reconciliation_perms: total[0].c,
      excluded_privileged: EXCLUDE,
      note: 'staging-only: closes the point-in-time role_permissions gap for platform_admin; SoD/maker-checker unchanged; no privileged override granted.',
    }),
  );
} catch (e) {
  console.error('seed-recon-demo failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
