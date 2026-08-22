/**
 * Stage-7 staging-only SYNTHETIC bootstrap. Idempotent + safe to rerun. NON-PRODUCTION ONLY.
 *
 * Creates the minimum synthetic scaffold for auth/RBAC/tenant-isolation testing:
 *   - 2 synthetic tenants
 *   - 2 synthetic identities: one granted the seeded `platform_admin` role (PRIVILEGED), one with no grant
 *     (UNPRIVILEGED)
 * Catalogue codes are discovered from the DB (schema-driven), never hardcoded to a guess.
 *
 * It connects with the elevated (superuser) role in DATABASE_URL for seeding; the application itself runs as the
 * non-owner `finapp_app` role. It refuses to run when NODE_ENV=production. It creates NO real customer PII and NO
 * login credentials — full HTTP login accounts (argon2 credentials, sessions) are exercised by the app's own auth
 * service and the DB/API integration lane; this seed provides the tenant + identity + role STRUCTURE only.
 */
import pg from 'pg';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run: NODE_ENV=production (staging-only synthetic bootstrap).');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const PLATFORM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001';
const ID1 = '00000000-0000-4000-8000-0000000000a1'; // privileged synthetic identity
const ID2 = '00000000-0000-4000-8000-0000000000a2'; // unprivileged synthetic identity

const pool = new pg.Pool({ connectionString: url });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

try {
  const tt = (await q(`SELECT code FROM tenant_type_catalogue ORDER BY code LIMIT 1`))[0]?.code;
  const it = (
    await q(`SELECT code FROM identity_type_catalogue WHERE is_human = true ORDER BY code LIMIT 1`)
  )[0]?.code;
  if (!tt || !it) throw new Error('required catalogues (tenant_type / identity_type) are not seeded');

  // Synthetic tenants (idempotent on the unique code). Count is env-tunable for multi-tenant load testing:
  // STG_TENANT_COUNT (default 2) creates stg_tenant_1..N. Higher N spreads authenticated write load across N
  // per-tenant audit hash-chains (see STAGE_7_AUDIT_CHAIN_CONTENTION_ANALYSIS.md) — synthetic, no PII.
  const tenantCountRaw = Number(process.env.STG_TENANT_COUNT ?? '2');
  const tenantCount = Number.isInteger(tenantCountRaw) && tenantCountRaw >= 2 ? tenantCountRaw : 2;
  for (let n = 1; n <= tenantCount; n += 1) {
    await q(
      `INSERT INTO tenants (code, legal_name, tenant_type, status, activated_at)
       VALUES ($1, $2, $3, 'active', now())
       ON CONFLICT (code) DO NOTHING`,
      [`stg_tenant_${n}`, `Stage-7 Synthetic Tenant ${n}`, tt],
    );
  }

  // 2 synthetic identities (idempotent on fixed ids); classification 'internal' (synthetic, non-PII).
  // A human identity requires an email (identities_human_email_ck) — use synthetic @staging.local addresses.
  for (const [id, name, email] of [
    [ID1, 'Stage-7 Synthetic Admin (privileged)', 'stg-admin@staging.local'],
    [ID2, 'Stage-7 Synthetic User (unprivileged)', 'stg-user@staging.local'],
  ]) {
    await q(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status, data_classification)
       VALUES ($1, $2, $3, $4, lower($4), 'active', 'internal')
       ON CONFLICT (id) DO NOTHING`,
      [id, it, name, email],
    );
  }

  // Grant platform_admin to identity #1 (privileged). Idempotent against the one-active partial unique index.
  await q(
    `INSERT INTO platform_role_assignments (identity_id, role_id, status)
     SELECT $1, $2, 'active'
     WHERE NOT EXISTS (
       SELECT 1 FROM platform_role_assignments
       WHERE identity_id = $1 AND role_id = $2 AND status IN ('active','suspended'))`,
    [ID1, PLATFORM_ADMIN_ROLE_ID],
  );

  const tenants = (await q(`SELECT count(*)::int c FROM tenants WHERE code LIKE 'stg_tenant_%'`))[0].c;
  const ids = (await q(`SELECT count(*)::int c FROM identities WHERE id IN ($1,$2)`, [ID1, ID2]))[0].c;
  const priv = (
    await q(
      `SELECT count(*)::int c FROM platform_role_assignments WHERE identity_id=$1 AND role_id=$2 AND status='active'`,
      [ID1, PLATFORM_ADMIN_ROLE_ID],
    )
  )[0].c;
  console.log(
    JSON.stringify({
      ok: true,
      tenant_type: tt,
      identity_type: it,
      synthetic_tenants: tenants,
      synthetic_identities: ids,
      privileged_platform_admin_grants: priv,
      note: 'staging-only synthetic scaffold; no PII, no credentials',
    }),
  );
} catch (e) {
  console.error('bootstrap failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
