import { randomUUID } from 'node:crypto';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';

/**
 * ADR-134 — SELF-ONLY tenant discovery security matrix, proved against a real PostgreSQL.
 *
 * The capability under test is `auth_self_tenants(uuid)` (m02-identity/migrations/0003) — the ONLY governed
 * way to answer "which tenants may I select?" without weakening the FORCE-RLS no-escape on
 * `tenant_memberships`. Every assertion runs as the NON-owner, NON-superuser application role (`ctx.asTenant`
 * / `ctx.asSystem` bind `ctx.appRole`); a superuser would bypass RLS and make these assertions meaningless.
 *
 * What this file must prove (the 10-point matrix from the switcher spec):
 *   1. a user with exactly one membership gets exactly one tenant
 *   2. the function returns ONLY the passed identity's memberships (no other user's rows leak)
 *   3. there is no way to ask on behalf of another user beyond passing an identity — the function takes a
 *      single uuid and the ENDPOINT (auth.controller) supplies the SESSION identity, never a client value
 *   4. the function signature admits no second/identity-substitution argument
 *   5. an inactive/ended membership is excluded
 *   6. a tenant the user is not a member of is absent
 *   7. a spoofed tenant context (x-tenant-id → app.tenant_id GUC) cannot change the answer
 *   8. generic member enumeration stays impossible — the app role still sees NOTHING in tenant_memberships
 *   9. FORCE RLS on tenant_memberships remains enabled
 *  10. the application DB role still has NOBYPASSRLS (and is not a superuser)
 * plus the function's own containment: SECURITY DEFINER, locked search_path, no PUBLIC execute.
 */

async function seedTenant(ctx: DbSpecContext, code: string, status: string): Promise<string> {
  const id = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at)
       VALUES ($1, $2, $3, 'enterprise_customer', $4, CASE WHEN $4 = 'active' THEN now() ELSE NULL END)`,
      [id, code, `${code} Ltd`, status],
    );
  });
  return id;
}

interface SelfTenantRow {
  tenant_id: string;
  code: string;
  name: string;
  is_primary: boolean;
}
async function selfTenants(ctx: DbSpecContext, identityId: string): Promise<SelfTenantRow[]> {
  // Called AS the application role (asSystem binds ctx.appRole). The function is SECURITY DEFINER, so it —
  // and only it — reads past FORCE RLS, returning nothing but the passed identity's active memberships.
  const r = await ctx.asSystem(async (tx) =>
    tx.query<SelfTenantRow>('SELECT tenant_id, code, name, is_primary FROM auth_self_tenants($1)', [
      identityId,
    ]),
  );
  return (r as { rows: SelfTenantRow[] }).rows;
}

export default defineDbSpec('m02 self-tenant discovery (ADR-134)', async (ctx, t) => {
  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');
  const tenantA = await seedTenant(ctx, `st_a_${suffix}`, 'active'); // alice primary
  const tenantB = await seedTenant(ctx, `st_b_${suffix}`, 'active'); // alice + bob
  const tenantC = await seedTenant(ctx, `st_c_${suffix}`, 'active'); // alice ENDED here → excluded
  const tenantD = await seedTenant(ctx, `st_d_${suffix}`, 'draft'); // alice active member, tenant INACTIVE → excluded
  const alice = randomUUID();
  const bob = randomUUID();
  const solo = randomUUID(); // exactly one membership

  try {
    await ctx.asSystem(async (tx) => {
      await tx.query(
        `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status)
         VALUES ($1,'internal_person','Alice',$2,$2,'active'),
                ($3,'internal_person','Bob',$4,$4,'active'),
                ($5,'internal_person','Solo',$6,$6,'active')`,
        [alice, `alice_${suffix}@corp.com`, bob, `bob_${suffix}@corp.com`, solo, `solo_${suffix}@corp.com`],
      );
    });

    // Memberships (seeded per-tenant so RLS WITH CHECK is satisfied):
    //   alice: A active+primary, B active, C ended, D active (but D tenant is draft)
    //   bob:   B active
    //   solo:  A active
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, membership_type, status, is_primary)
         VALUES ($1,$2,'employee','active',true), ($1,$3,'employee','active',false)`,
        [tenantA, alice, solo],
      );
    });
    await ctx.asTenant(tenantB, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, membership_type, status)
         VALUES ($1,$2,'partner','active'), ($1,$3,'employee','active')`,
        [tenantB, alice, bob],
      );
    });
    await ctx.asTenant(tenantC, async (tx) => {
      // Backdate start_date: the dates check is end_date > start_date, and both default to now().
      await tx.query(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, membership_type, status, start_date, end_date)
         VALUES ($1,$2,'employee','ended', now() - interval '30 days', now())`,
        [tenantC, alice],
      );
    });
    await ctx.asTenant(tenantD, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, membership_type, status)
         VALUES ($1,$2,'employee','active')`,
        [tenantD, alice],
      );
    });

    // --- 1. exactly one membership → exactly one tenant ---------------------------------------------
    const soloRows = await selfTenants(ctx, solo);
    t.equal(soloRows.length, 1, '1) a user with one membership gets exactly one tenant');
    t.equal(soloRows[0]?.tenant_id, tenantA, '1) and it is the tenant they belong to');

    // --- 2. only the passed identity's memberships; primary first ----------------------------------
    const aliceRows = await selfTenants(ctx, alice);
    const aliceTenantIds = aliceRows.map((r) => r.tenant_id).sort();
    t.deepEqual(
      aliceTenantIds,
      [tenantA, tenantB].sort(),
      '2) alice sees exactly her ACTIVE memberships of ACTIVE tenants (A,B) — nobody else`s rows',
    );
    t.equal(aliceRows[0]?.tenant_id, tenantA, '2) her primary membership sorts first (is_primary DESC)');
    t.equal(aliceRows[0]?.is_primary, true, '2) is_primary is surfaced for the UI to mark the default');

    // --- 3. self-only by identity: bob gets bob`s, never alice`s -----------------------------------
    const bobRows = await selfTenants(ctx, bob);
    t.deepEqual(
      bobRows.map((r) => r.tenant_id),
      [tenantB],
      '3) bob sees only his own membership (tenant B)',
    );
    t.ok(
      !bobRows.some((r) => r.tenant_id === tenantA),
      '3) bob CANNOT see alice-only tenant A — passing a different identity only ever returns THAT identity',
    );

    // --- 4. no identity-substitution surface: one uuid argument, nothing else ----------------------
    const sig = await ctx.pool.query<{ pronargs: number; argtypes: string }>(
      `SELECT p.pronargs, pg_catalog.pg_get_function_identity_arguments(p.oid) AS argtypes
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'auth_self_tenants' AND n.nspname = 'public'`,
    );
    t.equal(sig.rowCount, 1, '4) exactly one auth_self_tenants function exists (no overloads)');
    t.equal(sig.rows[0]?.pronargs, 1, '4) it takes exactly ONE argument — no second/substitution parameter');
    t.ok((sig.rows[0]?.argtypes ?? '').includes('uuid'), '4) the sole argument is a uuid identity');

    // --- 5. inactive/ended membership excluded -----------------------------------------------------
    t.ok(
      !aliceRows.some((r) => r.tenant_id === tenantC),
      '5) alice`s ENDED membership (tenant C) is excluded',
    );
    // --- 5b. inactive TENANT excluded even with an active membership -------------------------------
    t.ok(
      !aliceRows.some((r) => r.tenant_id === tenantD),
      '5b) tenant D is excluded — an active membership of an INACTIVE (draft) tenant is not selectable',
    );

    // --- 6. non-member tenant absent ---------------------------------------------------------------
    t.ok(!bobRows.some((r) => r.tenant_id === tenantA), '6) a tenant the user is not a member of is absent');

    // --- 7. a spoofed tenant context cannot change the answer --------------------------------------
    // Bind the session to tenant B, then ask for alice: the result is identity-driven, NOT filtered or
    // widened by the caller`s tenant GUC (what a spoofed x-tenant-id would set). Same answer either way.
    const spoofed = await ctx.asTenant(tenantB, async (tx) =>
      tx.query<SelfTenantRow>('SELECT tenant_id FROM auth_self_tenants($1)', [alice]),
    );
    t.deepEqual(
      (spoofed as { rows: { tenant_id: string }[] }).rows.map((r) => r.tenant_id).sort(),
      [tenantA, tenantB].sort(),
      '7) a spoofed/bound tenant context neither restricts nor expands the self-list — identity decides',
    );

    // --- 8. generic member enumeration stays impossible -------------------------------------------
    await ctx.asSystem(async (tx) => {
      const rows = await tx.query('SELECT * FROM tenant_memberships');
      t.equal(
        rows.rowCount,
        0,
        '8) the app role still sees NOTHING in tenant_memberships directly — no enumeration path was opened',
      );
    });
    // The function cannot be turned into an enumerator: its only input is an identity, and it returns that
    // identity`s tenants — never a tenant`s members. (Proved by 2/3/6 above.)

    // --- 9. FORCE RLS still enabled on tenant_memberships -----------------------------------------
    const rls = await ctx.pool.query<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tenant_memberships'`,
    );
    t.ok(rls.rows[0]?.relrowsecurity, '9) RLS is ENABLED on tenant_memberships');
    t.ok(
      rls.rows[0]?.relforcerowsecurity,
      '9) RLS is still FORCED on tenant_memberships (untouched by ADR-134)',
    );

    // --- 10. the application DB role is still NOBYPASSRLS -----------------------------------------
    const role = await ctx.pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [ctx.appRole],
    );
    t.equal(role.rows[0]?.rolbypassrls, false, '10) the application role still has NOBYPASSRLS');
    t.equal(role.rows[0]?.rolsuper, false, '10) the application role is still NOT a superuser');

    // --- containment of the function itself -------------------------------------------------------
    const fn = await ctx.pool.query<{
      prosecdef: boolean;
      proconfig: string[] | null;
      owner_super: boolean;
      owner_bypass: boolean;
    }>(
      `SELECT p.prosecdef, p.proconfig, r.rolsuper AS owner_super, r.rolbypassrls AS owner_bypass
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname = 'auth_self_tenants' AND n.nspname = 'public'`,
    );
    t.ok(fn.rows[0]?.prosecdef, 'fn) auth_self_tenants is SECURITY DEFINER');
    t.ok(
      (fn.rows[0]?.proconfig ?? []).some((c) => c.startsWith('search_path=')),
      'fn) it pins a search_path (no search-path hijack)',
    );
    t.ok(
      (fn.rows[0]?.owner_super ?? false) || (fn.rows[0]?.owner_bypass ?? false),
      'fn) its definer/owner can read past FORCE RLS (BYPASSRLS/superuser) — the documented ADR-134 requirement',
    );

    // PUBLIC has no execute; the app role does.
    const pubExec = await ctx.pool.query<{ has: boolean }>(
      `SELECT has_function_privilege('public', 'auth_self_tenants(uuid)', 'EXECUTE') AS has`,
    );
    t.equal(pubExec.rows[0]?.has, false, 'fn) EXECUTE is REVOKED from PUBLIC');
    const appExec = await ctx.pool.query<{ has: boolean }>(
      `SELECT has_function_privilege($1, 'auth_self_tenants(uuid)', 'EXECUTE') AS has`,
      [ctx.appRole],
    );
    t.equal(appExec.rows[0]?.has, true, 'fn) EXECUTE is granted to the application role');
  } finally {
    await ctx.asSuperuser(null, async (tx) => {
      await tx.query('DELETE FROM membership_status_history WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB, tenantC, tenantD],
      ]);
      await tx.query('DELETE FROM tenant_memberships WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB, tenantC, tenantD],
      ]);
      await tx.query('DELETE FROM identities WHERE id = ANY($1::uuid[])', [[alice, bob, solo]]);
      await tx.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [
        [tenantA, tenantB, tenantC, tenantD],
      ]);
    });
  }
});
