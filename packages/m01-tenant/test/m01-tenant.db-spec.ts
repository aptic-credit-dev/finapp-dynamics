import { randomUUID } from 'node:crypto';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';

/**
 * M01 DB-integration spec — proves tenant isolation against a real PostgreSQL 16.
 *
 * Requires the migrations to have been applied (`npm run migrate`). CI does that before this lane.
 *
 * THE ROLE THAT MATTERS. Every isolation assertion below runs through `ctx.asTenant`, i.e. as the
 * non-superuser, non-owner application role — the role production actually connects as, and the only
 * role a leak could happen through. A superuser bypasses RLS entirely and the table owner is exempt
 * unless FORCE is set, so an assertion made as either would pass on a table whose RLS had been dropped
 * and would prove nothing. That distinction is the single most important thing in this file, and it is
 * asserted explicitly at the end rather than assumed.
 */

const TENANT_TABLES = [
  'tenants',
  'tenant_status_history',
  'tenant_environments',
  'tenant_entities',
  'tenant_departments',
  'tenant_branches',
];

/** Creates a tenant directly, bypassing the service — the spec is testing the database, not the service. */
async function seedTenant(ctx: DbSpecContext, code: string): Promise<string> {
  const id = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    // activated_at must be set in the SAME statement as status='active': tenants_activated_ck refuses a
    // row that claims to be active without an activation date, and it is right to.
    await tx.query(
      `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at)
       VALUES ($1, $2, $3, 'enterprise_customer', 'active', now())`,
      [id, code, `${code} Ltd`],
    );
  });
  return id;
}

/**
 * Runs one statement that MUST be rejected, in its own transaction.
 *
 * Each expected failure needs its own transaction: PostgreSQL aborts the whole transaction on the first
 * error, so batching several `rejects` together makes every one after the first fail with "current
 * transaction is aborted" — which looks like a passing rejection but proves nothing about the constraint
 * it was meant to test.
 */
function rejectsIn(
  run: (
    fn: (tx: { query: (sql: string, params?: readonly unknown[]) => Promise<unknown> }) => Promise<unknown>,
  ) => Promise<unknown>,
  sql: string,
  params: readonly unknown[] = [],
): Promise<unknown> {
  return run(async (tx) => tx.query(sql, params));
}

export default defineDbSpec('m01-tenant (Stage 1A)', async (ctx, t) => {
  // --- migrations applied --------------------------------------------------------------------------
  const tables = await ctx.pool.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `SELECT relname, relrowsecurity, relforcerowsecurity
     FROM pg_class WHERE relname = ANY($1::text[]) AND relkind = 'r' ORDER BY relname`,
    [TENANT_TABLES],
  );
  t.equal(tables.rowCount, TENANT_TABLES.length, 'every M01 table exists — migrations applied');
  if (tables.rowCount !== TENANT_TABLES.length) {
    throw new Error('M01 migrations have not been applied. Run `npm run migrate` before the DB lane.');
  }
  for (const row of tables.rows) {
    t.ok(row.relrowsecurity, `${row.relname}: RLS is ENABLED`);
    t.ok(row.relforcerowsecurity, `${row.relname}: RLS is FORCED (ADR-003)`);
  }

  const policies = await ctx.pool.query<{ tablename: string; policyname: string }>(
    `SELECT tablename, policyname FROM pg_policies WHERE tablename = ANY($1::text[])`,
    [TENANT_TABLES],
  );
  t.equal(policies.rowCount, TENANT_TABLES.length, 'every M01 table has exactly one policy');
  t.ok(
    policies.rows.every((p) => p.policyname === 'tenant_isolation'),
    'the policy is named tenant_isolation on every M01 table',
  );

  // The type catalogue is a global reference registry — deliberately NOT tenant-scoped (ADR-001).
  const catalogue = await ctx.pool.query<{ relrowsecurity: boolean }>(
    `SELECT relrowsecurity FROM pg_class WHERE relname = 'tenant_type_catalogue'`,
  );
  t.equal(catalogue.rows[0]?.relrowsecurity, false, 'tenant_type_catalogue is global reference data, no RLS');
  const types = await ctx.pool.query(`SELECT code FROM tenant_type_catalogue`);
  t.equal(types.rowCount, 10, 'ten tenant types seeded');

  // --- fixtures ------------------------------------------------------------------------------------
  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');
  const tenantA = await seedTenant(ctx, `a_${suffix}`);
  const tenantB = await seedTenant(ctx, `b_${suffix}`);

  try {
    // --- constraints -------------------------------------------------------------------------------
    // One transaction per expectation — see rejectsIn().
    const su = (fn: Parameters<typeof ctx.asSuperuser>[1]) => ctx.asSuperuser(null, fn);

    await t.rejects(
      rejectsIn(su, `INSERT INTO tenants (code, legal_name, tenant_type) VALUES ($1, 'Dup', 'partner')`, [
        `a_${suffix}`,
      ]),
      'tenant code is globally unique',
    );
    await t.rejects(
      rejectsIn(
        su,
        `INSERT INTO tenants (code, legal_name, tenant_type) VALUES ('bad_type_x', 'X', 'not_a_type')`,
      ),
      'tenant_type must exist in the catalogue (FK, not a CHECK that can drift)',
    );
    await t.rejects(
      rejectsIn(
        su,
        `INSERT INTO tenants (code, legal_name, tenant_type, status) VALUES ('badstat_x', 'X', 'partner', 'enabled')`,
      ),
      'an unknown status is rejected',
    );
    await t.rejects(
      rejectsIn(
        su,
        `INSERT INTO tenants (code, legal_name, tenant_type) VALUES ('Bad-Code', 'X', 'partner')`,
      ),
      'a malformed tenant code is rejected at the database too',
    );
    // The status/timestamp agreement checks: the row cannot claim a status its timestamps contradict.
    await t.rejects(
      rejectsIn(
        su,
        `INSERT INTO tenants (code, legal_name, tenant_type, status) VALUES ('actnots_x', 'X', 'partner', 'active')`,
      ),
      'status=active without activated_at is rejected',
    );
    await t.rejects(
      rejectsIn(
        su,
        `INSERT INTO tenants (code, legal_name, tenant_type, status) VALUES ('clonots_x', 'X', 'partner', 'closed')`,
      ),
      'status=closed without closed_at is rejected',
    );

    // --- READ isolation, through the APPLICATION role ----------------------------------------------
    await ctx.asTenant(tenantA, async (tx) => {
      const rows = await tx.query<{ id: string }>('SELECT id FROM tenants');
      t.equal(rows.rowCount, 1, 'tenant A sees exactly one tenant row — its own');
      t.equal(rows.rows[0]?.id, tenantA, 'and that row is tenant A');
    });

    // The enumeration check the prompt calls for: a tenant must not be able to infer that others exist.
    await ctx.asTenant(tenantA, async (tx) => {
      const counted = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM tenants');
      t.equal(counted.rows[0]?.n, '1', 'count(*) reveals no other tenant (no inference via aggregate)');
      const other = await tx.query('SELECT * FROM tenants WHERE id = $1', [tenantB]);
      t.equal(other.rowCount, 0, 'directly naming another tenant returns nothing');
    });

    // --- WRITE isolation ---------------------------------------------------------------------------
    await ctx.asTenant(tenantA, async (tx) => {
      const updated = await tx.query(`UPDATE tenants SET legal_name = 'hijacked' WHERE id = $1`, [tenantB]);
      t.equal(updated.rowCount, 0, 'tenant A cannot UPDATE tenant B');
    });
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asTenant(tenantA, fn),
        `INSERT INTO tenant_environments (tenant_id, code, environment_type) VALUES ($1, 'sneaky', 'production')`,
        [tenantB],
      ),
      'tenant A cannot INSERT a row into tenant B (WITH CHECK)',
    );

    // No DELETE privilege anywhere — ADR-010 soft delete is enforced by grant, not by convention.
    await t.rejects(
      rejectsIn((fn) => ctx.asTenant(tenantA, fn), 'DELETE FROM tenants WHERE id = $1', [tenantA]),
      'the application role holds no DELETE on tenants (ADR-010)',
    );

    // --- FAIL CLOSED + pooled-connection reuse -----------------------------------------------------
    // These run AFTER the queries above, so the pool hands back a connection whose app.tenant_id has
    // already been set and reverted to '' at COMMIT. That is the case a policy without NULLIF breaks on.
    await ctx.asTenant(null, async (tx) => {
      const rows = await tx.query('SELECT * FROM tenants');
      t.equal(
        rows.rowCount,
        0,
        'no tenant context on a REUSED connection: zero rows, no error (fails closed)',
      );
    });
    await ctx.asTenant(null, async (tx) => {
      const rows = await tx.query('SELECT * FROM tenant_environments');
      t.equal(rows.rowCount, 0, 'tenant-scoped tables also fail closed with no context');
    });
    // And the GUC really is transaction-local: the next transaction on the same pool sees its own tenant.
    await ctx.asTenant(tenantB, async (tx) => {
      const rows = await tx.query<{ id: string }>('SELECT id FROM tenants');
      t.equal(rows.rows[0]?.id, tenantB, 'a reused connection binds the NEW tenant, not the previous one');
    });

    // --- the system-context escape (ADR-014) -------------------------------------------------------
    // `tenants` admits an explicit system context so a platform administrator can list across tenants.
    await ctx.asSystem(async (tx) => {
      const rows = await tx.query('SELECT * FROM tenants WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
      t.equal(rows.rowCount, 2, 'system context sees across tenants on the control plane (ADR-014)');
    });
    // ...but tenant-scoped tables have NO escape. This asymmetry is the point: withSystem must not
    // become a way to read another tenant's business data.
    await ctx.asSystem(async (tx) => {
      const rows = await tx.query('SELECT * FROM tenant_environments');
      t.equal(rows.rowCount, 0, 'system context sees NOTHING in tenant-scoped tables — no escape there');
    });

    // --- composite FK: no cross-tenant references --------------------------------------------------
    const entityA = await ctx.asTenant(tenantA, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO tenant_entities (tenant_id, code, legal_name) VALUES ($1, 'sub_a', 'Sub A') RETURNING id`,
        [tenantA],
      );
      return r.rows[0]!.id;
    });

    await t.rejects(
      rejectsIn(
        (fn) => ctx.asTenant(tenantB, fn),
        `INSERT INTO tenant_departments (tenant_id, entity_id, code, name) VALUES ($1, $2, 'dept_x', 'Dept')`,
        [tenantB, entityA],
      ),
      'a department in tenant B cannot reference an entity in tenant A (composite FK, ADR-003)',
    );

    // --- one default environment per tenant --------------------------------------------------------
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_environments (tenant_id, code, environment_type, is_default)
         VALUES ($1, 'prod', 'production', true)`,
        [tenantA],
      );
    });
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asTenant(tenantA, fn),
        `INSERT INTO tenant_environments (tenant_id, code, environment_type, is_default)
         VALUES ($1, 'prod2', 'production', true)`,
        [tenantA],
      ),
      'a tenant cannot have two default environments (partial unique index)',
    );
    // The same code IS allowed in a different tenant — uniqueness is per tenant, not global.
    await ctx.asTenant(tenantB, async (tx) => {
      const r = await tx.query(
        `INSERT INTO tenant_environments (tenant_id, code, environment_type, is_default)
         VALUES ($1, 'prod', 'production', true) RETURNING id`,
        [tenantB],
      );
      t.equal(r.rowCount, 1, 'tenant B may reuse an environment code that tenant A already uses');
    });

    // --- status history is append-only, by privilege -----------------------------------------------
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_status_history (tenant_id, from_status, to_status, action, correlation_id)
         VALUES ($1, 'draft', 'under_review', 'submit_review', $2)`,
        [tenantA, randomUUID()],
      );
    });
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asTenant(tenantA, fn),
        `UPDATE tenant_status_history SET to_status = 'active' WHERE tenant_id = $1`,
        [tenantA],
      ),
      'status history cannot be UPDATEd — the application role holds no such privilege (ADR-005)',
    );
    await t.rejects(
      rejectsIn((fn) => ctx.asTenant(tenantA, fn), `DELETE FROM tenant_status_history WHERE tenant_id = $1`, [
        tenantA,
      ]),
      'status history cannot be DELETEd',
    );
    await ctx.asTenant(tenantB, async (tx) => {
      const rows = await tx.query('SELECT * FROM tenant_status_history');
      t.equal(rows.rowCount, 0, "tenant B cannot read tenant A's status history");
    });

    // --- effective dates ---------------------------------------------------------------------------
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asTenant(tenantA, fn),
        `INSERT INTO tenant_entities (tenant_id, code, legal_name, effective_from, effective_to)
         VALUES ($1, 'baddate', 'X', now(), now() - interval '1 day')`,
        [tenantA],
      ),
      'effective_to before effective_from is rejected',
    );

    // --- soft delete agreement ---------------------------------------------------------------------
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asTenant(tenantA, fn),
        `UPDATE tenant_entities SET status = 'removed' WHERE id = $1`,
        [entityA],
      ),
      'status=removed without removed_at is rejected — soft delete cannot be half-done (ADR-010)',
    );

    // --- the role model itself ---------------------------------------------------------------------
    // If this ever fails, every isolation assertion above is worthless — a BYPASSRLS or superuser app
    // role would pass them all on a table with no policy at all.
    const appRole = await ctx.pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [ctx.appRole],
    );
    t.equal(appRole.rows[0]?.rolsuper, false, 'the application role is NOT a superuser');
    t.equal(appRole.rows[0]?.rolbypassrls, false, 'the application role does NOT have BYPASSRLS');

    const owns = await ctx.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE c.relname = ANY($1::text[]) AND r.rolname = $2`,
      [TENANT_TABLES, ctx.appRole],
    );
    t.equal(
      owns.rows[0]?.n,
      '0',
      'the application role owns none of the M01 tables (owners are RLS-exempt without FORCE)',
    );
  } finally {
    // Fixtures are removed as superuser — the application role holds no DELETE by design.
    await ctx.asSuperuser(null, async (tx) => {
      await tx.query('DELETE FROM tenant_status_history WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await tx.query('DELETE FROM tenant_departments WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await tx.query('DELETE FROM tenant_branches WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
      await tx.query('DELETE FROM tenant_entities WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
      await tx.query('DELETE FROM tenant_environments WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await tx.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    });
  }
});
