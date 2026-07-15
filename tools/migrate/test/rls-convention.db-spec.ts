import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * THE RLS CONVENTION PROOF (Stage 0 acceptance).
 *
 * Applies the sample migration to throwaway tables, proves tenant isolation actually holds, then drops
 * them. Nothing survives. Every tenant-scoped table in every later stage copies the shape this proves,
 * so if this spec is green the convention is real rather than aspirational — and if a later change
 * weakens RLS FORCE or the `tenant_isolation` policy, this spec goes red on its own.
 *
 * THREE ROLES, and the difference between them is the entire point:
 *
 *   superuser    Bypasses RLS COMPLETELY. FORCE does not constrain it. Proving isolation here would
 *                prove nothing — which is why the application must never connect as one.
 *   owner        Owns the tables. Exempt from RLS under ENABLE; bound by it under FORCE. This is what
 *                FORCE buys, and the reason ENABLE alone is not enough.
 *   app          Neither superuser nor owner. What production connects as, and where a leak would
 *                actually happen.
 */

const SAMPLES = resolve(import.meta.dirname, '../samples');

export default defineDbSpec('rls-convention (Stage 0)', async (ctx, t) => {
  const up = await readFile(resolve(SAMPLES, 'rls_convention_sample.sql'), 'utf8');
  const down = await readFile(resolve(SAMPLES, 'rls_convention_sample_down.sql'), 'utf8');

  // Always start from a clean slate — a previous crashed run must not fail this one.
  await ctx.pool.query(down);
  // Applied AS THE OWNER ROLE, so the tables are owned by a non-superuser and FORCE is meaningful.
  await ctx.asOwner(null, async (tx) => {
    await tx.query(up);
  });

  try {
    await ctx.pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON rls_sample_tenant, rls_sample_parent, rls_sample_child
       TO "${ctx.appRole}"`,
    );

    // --- the migration applied --------------------------------------------------------------------
    const tables = await ctx.pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      owner: string;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c WHERE c.relname IN ('rls_sample_parent', 'rls_sample_child') ORDER BY c.relname`,
    );
    t.equal(tables.rowCount, 2, 'the sample migration applied — both tenant-scoped tables exist');
    for (const row of tables.rows) {
      t.ok(row.relrowsecurity, `${row.relname}: row level security is ENABLED`);
      t.ok(row.relforcerowsecurity, `${row.relname}: row level security is FORCED (ADR-003)`);
      t.equal(row.owner, ctx.ownerRole, `${row.relname}: owned by the non-superuser owner role`);
    }

    const policies = await ctx.pool.query<{ tablename: string; policyname: string }>(
      `SELECT tablename, policyname FROM pg_policies
       WHERE tablename IN ('rls_sample_parent', 'rls_sample_child') ORDER BY tablename`,
    );
    t.equal(policies.rowCount, 2, 'each tenant-scoped table has exactly one policy');
    t.ok(
      policies.rows.every((p) => p.policyname === 'tenant_isolation'),
      'the policy is named tenant_isolation on every tenant table',
    );

    // --- fixtures ---------------------------------------------------------------------------------
    const tenantA = (
      await ctx.pool.query<{ id: string }>(`INSERT INTO rls_sample_tenant (name) VALUES ('A') RETURNING id`)
    ).rows[0]!.id;
    const tenantB = (
      await ctx.pool.query<{ id: string }>(`INSERT INTO rls_sample_tenant (name) VALUES ('B') RETURNING id`)
    ).rows[0]!.id;

    const parentA = await ctx.asOwner(tenantA, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO rls_sample_parent (tenant_id, label) VALUES ($1, 'A-parent') RETURNING id`,
        [tenantA],
      );
      await tx.query(`INSERT INTO rls_sample_child (tenant_id, parent_id, note) VALUES ($1, $2, 'A-child')`, [
        tenantA,
        r.rows[0]!.id,
      ]);
      return r.rows[0]!.id;
    });

    await ctx.asOwner(tenantB, async (tx) => {
      await tx.query(`INSERT INTO rls_sample_parent (tenant_id, label) VALUES ($1, 'B-parent')`, [tenantB]);
    });

    // --- READ isolation, through the application role ----------------------------------------------
    await ctx.asTenant(tenantA, async (tx) => {
      const rows = await tx.query<{ label: string }>('SELECT label FROM rls_sample_parent');
      t.equal(rows.rowCount, 1, 'tenant A sees exactly its own row');
      t.equal(rows.rows[0]?.label, 'A-parent', 'tenant A sees A-parent and not B-parent');
    });

    await ctx.asTenant(tenantB, async (tx) => {
      const rows = await tx.query<{ label: string }>('SELECT label FROM rls_sample_parent');
      t.equal(rows.rowCount, 1, 'tenant B sees exactly its own row');
      t.equal(rows.rows[0]?.label, 'B-parent', 'tenant B does not see tenant A data');
    });

    // A query that "forgets" the tenant filter still cannot leak across tenants (ADR-001 rationale).
    await ctx.asTenant(tenantA, async (tx) => {
      const rows = await tx.query(`SELECT * FROM rls_sample_parent WHERE tenant_id = $1`, [tenantB]);
      t.equal(rows.rowCount, 0, 'explicitly querying another tenant returns nothing, not an error page');
    });

    // --- FAIL CLOSED: no tenant context => no rows, never all rows --------------------------------
    // Order matters here. These run AFTER the queries above, so the pool hands back a connection that
    // has already had app.tenant_id set and reverted to '' at COMMIT. That is the case that breaks a
    // policy written without NULLIF, and it is invisible if you only ever test a fresh connection.
    await ctx.asTenant(null, async (tx) => {
      const rows = await tx.query('SELECT * FROM rls_sample_parent');
      t.equal(rows.rowCount, 0, 'with NO tenant context the policy matches nothing (fails closed)');
    });
    await ctx.asTenant(null, async (tx) => {
      const rows = await tx.query('SELECT * FROM rls_sample_child');
      t.equal(rows.rowCount, 0, 'a REUSED pooled connection with no tenant sees nothing, and does not error');
    });

    // --- FORCE: the non-superuser OWNER is bound by the policy too ---------------------------------
    await ctx.asOwner(null, async (tx) => {
      const rows = await tx.query('SELECT * FROM rls_sample_parent');
      t.equal(rows.rowCount, 0, 'FORCE binds the table OWNER too — this is what ENABLE alone would not do');
    });
    await ctx.asOwner(tenantA, async (tx) => {
      const rows = await tx.query('SELECT * FROM rls_sample_parent');
      t.equal(rows.rowCount, 1, 'the owner in tenant A context sees only tenant A');
    });

    // --- the superuser bypass, asserted rather than assumed ----------------------------------------
    // Documented here because it is the sharpest edge in the whole model: RLS is not a control on a
    // superuser, at all. The proof that isolation works is only meaningful because the app role above
    // is neither superuser nor owner.
    await ctx.asSuperuser(null, async (tx) => {
      const rows = await tx.query('SELECT * FROM rls_sample_parent');
      t.equal(rows.rowCount, 2, 'a SUPERUSER bypasses RLS entirely — hence the app must never be one');
    });

    // --- WRITE isolation (WITH CHECK) -------------------------------------------------------------
    await ctx.asTenant(tenantA, async (tx) => {
      await t.rejects(
        tx.query(`INSERT INTO rls_sample_parent (tenant_id, label) VALUES ($1, 'smuggled')`, [tenantB]),
        'cannot INSERT a row into another tenant while in tenant A context (WITH CHECK)',
      );
    });

    await ctx.asTenant(tenantA, async (tx) => {
      const updated = await tx.query(`UPDATE rls_sample_parent SET label = 'hijacked' WHERE tenant_id = $1`, [
        tenantB,
      ]);
      t.equal(updated.rowCount, 0, 'cannot UPDATE another tenant’s row — it is simply not visible to update');
    });

    await ctx.asTenant(tenantA, async (tx) => {
      const deleted = await tx.query(`DELETE FROM rls_sample_parent WHERE tenant_id = $1`, [tenantB]);
      t.equal(deleted.rowCount, 0, 'cannot DELETE another tenant’s row');
    });

    // --- composite FK: a child cannot reference a parent in another tenant -------------------------
    await ctx.asOwner(tenantB, async (tx) => {
      await t.rejects(
        tx.query(
          `INSERT INTO rls_sample_child (tenant_id, parent_id, note) VALUES ($1, $2, 'cross-tenant')`,
          [tenantB, parentA],
        ),
        'the composite FK refuses a child in tenant B pointing at a parent in tenant A (ADR-003)',
      );
    });

    // --- soft delete (ADR-010) --------------------------------------------------------------------
    await ctx.asOwner(tenantA, async (tx) => {
      await t.rejects(
        tx.query(`UPDATE rls_sample_parent SET status = 'removed' WHERE tenant_id = $1`, [tenantA]),
        'status=removed without removed_at violates the removal check — soft delete cannot be half-done',
      );
    });
    await ctx.asOwner(tenantA, async (tx) => {
      const r = await tx.query(
        `UPDATE rls_sample_parent SET status = 'removed', removed_at = now() WHERE tenant_id = $1`,
        [tenantA],
      );
      t.equal(r.rowCount, 1, 'a complete soft delete (status + removed_at) is accepted');
    });
  } finally {
    // The throwaway tables are removed whether or not the proof passed (Stage 0 acceptance).
    await ctx.pool.query(down);
  }

  const left = await ctx.pool.query(
    `SELECT 1 FROM pg_class WHERE relname LIKE 'rls_sample_%' AND relkind = 'r'`,
  );
  t.equal(left.rowCount, 0, 'the sample tables were removed — no business tables remain after Stage 0');
});
