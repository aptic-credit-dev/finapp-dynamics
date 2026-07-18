import { randomUUID } from 'node:crypto';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';

/**
 * M02 DB-integration spec — proves identity isolation against a real PostgreSQL 16.
 *
 * Requires the migrations (`npm run migrate`). CI does that before this lane.
 *
 * THE ROLE THAT MATTERS: every isolation assertion runs through `ctx.asTenant` / `ctx.asSystem`, i.e. as
 * the non-superuser, non-owner application role. A superuser bypasses RLS entirely, so an assertion made
 * as one would pass on a table with no policy at all.
 *
 * THE ASYMMETRY THIS FILE EXISTS TO PROVE:
 *   identities / user_accounts  -> global, readable ONLY in system context
 *   tenant_memberships          -> tenant-scoped, NO system escape
 * So `withSystem` can read the identity plane and sees NOTHING in memberships. That is what stops the
 * escape becoming a way to enumerate every tenant's people.
 */

const GLOBAL_TABLES = [
  'identities',
  'user_accounts',
  'authentication_subjects',
  'identity_status_history',
  'account_status_history',
];
const TENANT_TABLES = ['tenant_memberships', 'membership_status_history'];

function rejectsIn(
  run: (
    fn: (tx: { query: (sql: string, params?: readonly unknown[]) => Promise<unknown> }) => Promise<unknown>,
  ) => Promise<unknown>,
  sql: string,
  params: readonly unknown[] = [],
): Promise<unknown> {
  return run(async (tx) => tx.query(sql, params));
}

async function seedTenant(ctx: DbSpecContext, code: string): Promise<string> {
  const id = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    await tx.query(
      `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at)
       VALUES ($1, $2, $3, 'enterprise_customer', 'active', now())`,
      [id, code, `${code} Ltd`],
    );
  });
  return id;
}

export default defineDbSpec('m02-identity (Stage 1B)', async (ctx, t) => {
  // --- migrations applied --------------------------------------------------------------------------
  const all = [...GLOBAL_TABLES, ...TENANT_TABLES];
  const tables = await ctx.pool.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
     WHERE relname = ANY($1::text[]) AND relkind = 'r' ORDER BY relname`,
    [all],
  );
  t.equal(tables.rowCount, all.length, 'every M02 table exists — migrations applied');
  if (tables.rowCount !== all.length) {
    throw new Error('M02 migrations have not been applied. Run `npm run migrate` before the DB lane.');
  }
  for (const row of tables.rows) {
    t.ok(row.relrowsecurity, `${row.relname}: RLS is ENABLED`);
    t.ok(row.relforcerowsecurity, `${row.relname}: RLS is FORCED (ADR-003)`);
  }

  const policies = await ctx.pool.query<{ tablename: string; policyname: string }>(
    `SELECT tablename, policyname FROM pg_policies WHERE tablename = ANY($1::text[])`,
    [all],
  );
  t.equal(policies.rowCount, all.length, 'every M02 table has exactly one policy');
  t.ok(
    policies.rows.every((p) => p.policyname === 'tenant_isolation'),
    'the policy is named tenant_isolation everywhere',
  );

  // NO Stage 1D RBAC tables. (Stage 1C credential/session tables now EXIST — m02-auth shipped — so they
  // are no longer forbidden here; the conformance suite asserts they exist and carry no plaintext column.)
  const forbidden = await ctx.pool.query<{ relname: string }>(
    `SELECT relname FROM pg_class WHERE relkind = 'r' AND relname = ANY($1::text[])`,
    [['roles', 'permissions', 'user_roles', 'role_permissions', 'sod_catalogue']],
  );
  t.equal(forbidden.rowCount, 0, 'no Stage 1D RBAC tables exist (authorization is Stage 1D)');

  // No credential column slipped into the identity plane (ADR-009).
  const secrets = await ctx.pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name IN ('identities','user_accounts','authentication_subjects')
       AND (column_name ILIKE '%password%' OR column_name ILIKE '%secret%' OR column_name ILIKE '%token%'
            OR column_name ILIKE '%credential%')`,
  );
  t.equal(
    secrets.rowCount,
    0,
    'no password/secret/token/credential column exists in the identity plane (ADR-009)',
  );

  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');
  const tenantA = await seedTenant(ctx, `ia_${suffix}`);
  const tenantB = await seedTenant(ctx, `ib_${suffix}`);
  const alice = randomUUID();
  const bob = randomUUID();

  try {
    // --- fixtures: identities + accounts live on the GLOBAL plane (system context only) -------------
    await ctx.asSystem(async (tx) => {
      await tx.query(
        `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status)
         VALUES ($1, 'internal_person', 'Alice', $2, $2, 'active'), ($3, 'internal_person', 'Bob', $4, $4, 'active')`,
        [alice, `alice_${suffix}@corp.com`, bob, `bob_${suffix}@corp.com`],
      );
    });

    // --- the identity plane is INVISIBLE without system context ------------------------------------
    await ctx.asTenant(tenantA, async (tx) => {
      const rows = await tx.query('SELECT * FROM identities');
      t.equal(rows.rowCount, 0, 'a tenant CANNOT read the identity plane at all — only system context can');
    });
    await ctx.asTenant(null, async (tx) => {
      const rows = await tx.query('SELECT * FROM user_accounts');
      t.equal(rows.rowCount, 0, 'no context: the identity plane fails closed');
    });
    await ctx.asSystem(async (tx) => {
      const rows = await tx.query('SELECT * FROM identities WHERE id = ANY($1::uuid[])', [[alice, bob]]);
      t.equal(rows.rowCount, 2, 'system context reads the identity plane (the only way in)');
    });

    // --- global email uniqueness -------------------------------------------------------------------
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asSystem(fn),
        `INSERT INTO identities (identity_type, display_name, primary_email, primary_email_norm)
         VALUES ('external_person', 'Impostor', $1, $1)`,
        [`alice_${suffix}@corp.com`],
      ),
      'identity email is globally unique — two tenants sharing a human share the identity',
    );
    // A machine identity must not carry an email — it would be findable as a person.
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asSystem(fn),
        `INSERT INTO identities (identity_type, display_name, primary_email, primary_email_norm)
         VALUES ('service_identity', 'svc', 'svc@corp.com', 'svc@corp.com')`,
      ),
      'a machine identity with an email is rejected... ',
    );
    // ...and a person without one is rejected too.
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asSystem(fn),
        `INSERT INTO identities (identity_type, display_name) VALUES ('internal_person', 'Nameless')`,
      ),
      'a person without an email is rejected',
    );
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asSystem(fn),
        `INSERT INTO identities (identity_type, display_name, primary_email, primary_email_norm) VALUES ('robot', 'R', 'r@x.com', 'r@x.com')`,
      ),
      'identity_type must exist in the catalogue (FK, not a CHECK that can drift)',
    );
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asSystem(fn),
        `INSERT INTO identities (identity_type, display_name, primary_email) VALUES ('internal_person', 'X', 'x@y.com')`,
      ),
      'an email without its normalized twin is rejected — uniqueness would become a guess',
    );

    // --- accounts ----------------------------------------------------------------------------------
    const aliceAccount = await ctx.asSystem(async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO user_accounts (identity_id, account_type, login_identifier, login_identifier_norm, status, activated_at)
         VALUES ($1, 'human', $2, $2, 'active', now()) RETURNING id`,
        [alice, `alice_${suffix}`],
      );
      return r.rows[0]!.id;
    });

    await t.rejects(
      rejectsIn(
        (fn) => ctx.asSystem(fn),
        `INSERT INTO user_accounts (identity_id, account_type, login_identifier, login_identifier_norm)
         VALUES ($1, 'human', $2, $2)`,
        [bob, `alice_${suffix}`],
      ),
      'the login identifier is globally unique — two accounts answering to one login is unresolvable',
    );
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asSystem(fn),
        `INSERT INTO user_accounts (identity_id, account_type, login_identifier, login_identifier_norm, status)
         VALUES ($1, 'human', 'noact', 'noact', 'active')`,
        [bob],
      ),
      'status=active without activated_at is rejected',
    );

    // --- MEMBERSHIP ISOLATION — the heart of this spec ---------------------------------------------
    const membershipA = await ctx.asTenant(tenantA, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, account_id, membership_type, status)
         VALUES ($1, $2, $3, 'employee', 'active') RETURNING id`,
        [tenantA, alice, aliceAccount],
      );
      return r.rows[0]!.id;
    });
    // The same person in tenant B — a multi-tenant identity, one identities row, two memberships.
    await ctx.asTenant(tenantB, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, membership_type, status)
         VALUES ($1, $2, 'partner', 'active')`,
        [tenantB, alice],
      );
    });

    await ctx.asTenant(tenantA, async (tx) => {
      const rows = await tx.query('SELECT * FROM tenant_memberships');
      t.equal(rows.rowCount, 1, 'tenant A sees exactly its own membership');
      const counted = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM tenant_memberships');
      t.equal(counted.rows[0]?.n, '1', 'count(*) reveals no other tenant (no inference via aggregate)');
    });
    await ctx.asTenant(tenantB, async (tx) => {
      const rows = await tx.query('SELECT * FROM tenant_memberships WHERE tenant_id = $1', [tenantA]);
      t.equal(rows.rowCount, 0, "tenant B cannot read tenant A's membership even by naming it");
    });
    await ctx.asTenant(tenantB, async (tx) => {
      const updated = await tx.query(
        `UPDATE tenant_memberships SET status = 'ended', end_date = now() WHERE tenant_id = $1`,
        [tenantA],
      );
      t.equal(updated.rowCount, 0, "tenant B cannot END tenant A's membership");
    });
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asTenant(tenantB, fn),
        `INSERT INTO tenant_memberships (tenant_id, identity_id, membership_type) VALUES ($1, $2, 'employee')`,
        [tenantA, bob],
      ),
      'tenant B cannot create a membership in tenant A (WITH CHECK)',
    );

    // THE ASYMMETRY: system context reads the identity plane but sees NOTHING in memberships.
    await ctx.asSystem(async (tx) => {
      const rows = await tx.query('SELECT * FROM tenant_memberships');
      t.equal(
        rows.rowCount,
        0,
        'system context sees NOTHING in tenant_memberships — the escape does not reach tenant data',
      );
    });

    // --- one live membership per identity per tenant -----------------------------------------------
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asTenant(tenantA, fn),
        `INSERT INTO tenant_memberships (tenant_id, identity_id, membership_type) VALUES ($1, $2, 'contractor')`,
        [tenantA, alice],
      ),
      'an identity cannot hold two live memberships in one tenant',
    );
    // But a leaver may return: ending the old one frees the slot, and the ended row stays as the record
    // that the gap existed.
    await ctx.asTenant(tenantA, async (tx) => {
      await tx.query(`UPDATE tenant_memberships SET status = 'ended', end_date = now() WHERE id = $1`, [
        membershipA,
      ]);
    });
    await ctx.asTenant(tenantA, async (tx) => {
      const r = await tx.query(
        `INSERT INTO tenant_memberships (tenant_id, identity_id, membership_type) VALUES ($1, $2, 'contractor') RETURNING id`,
        [tenantA, alice],
      );
      t.equal(r.rowCount, 1, 'a returning leaver gets a NEW membership; the ended one is retained');
    });

    // --- cross-tenant scope references are impossible (composite FK) --------------------------------
    const entityB = await ctx.asTenant(tenantB, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO tenant_entities (tenant_id, code, legal_name) VALUES ($1, 'sub_b', 'Sub B') RETURNING id`,
        [tenantB],
      );
      return r.rows[0]!.id;
    });
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asTenant(tenantA, fn),
        `INSERT INTO tenant_memberships (tenant_id, identity_id, membership_type, entity_id) VALUES ($1, $2, 'employee', $3)`,
        [tenantA, bob, entityB],
      ),
      "a membership in tenant A cannot be scoped to tenant B's entity (composite FK, ADR-003)",
    );

    // --- pooled-connection reuse -------------------------------------------------------------------
    await ctx.asTenant(null, async (tx) => {
      const rows = await tx.query('SELECT * FROM tenant_memberships');
      t.equal(
        rows.rowCount,
        0,
        'a REUSED connection with no tenant sees nothing and does not error (NULLIF)',
      );
    });
    await ctx.asTenant(tenantB, async (tx) => {
      const rows = await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM tenant_memberships');
      t.ok(
        rows.rows.every((r) => r.tenant_id === tenantB),
        'a reused connection binds the NEW tenant, not the previous one',
      );
    });

    // --- append-only histories, by privilege -------------------------------------------------------
    await ctx.asSystem(async (tx) => {
      await tx.query(
        `INSERT INTO identity_status_history (identity_id, from_status, to_status, action, correlation_id)
         VALUES ($1, 'draft', 'active', 'activate', $2)`,
        [alice, randomUUID()],
      );
    });
    await t.rejects(
      rejectsIn(
        (fn) => ctx.asSystem(fn),
        `UPDATE identity_status_history SET to_status = 'closed' WHERE identity_id = $1`,
        [alice],
      ),
      'identity history cannot be UPDATEd — no such privilege (ADR-005)',
    );
    await t.rejects(
      rejectsIn((fn) => ctx.asSystem(fn), `DELETE FROM identity_status_history WHERE identity_id = $1`, [
        alice,
      ]),
      'identity history cannot be DELETEd',
    );
    await t.rejects(
      rejectsIn((fn) => ctx.asSystem(fn), `DELETE FROM identities WHERE id = $1`, [alice]),
      'an identity cannot be DELETEd — people are retired by status, never removed (ADR-010)',
    );

    // --- the role model itself ---------------------------------------------------------------------
    const appRole = await ctx.pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [ctx.appRole],
    );
    t.equal(appRole.rows[0]?.rolsuper, false, 'the application role is NOT a superuser');
    t.equal(appRole.rows[0]?.rolbypassrls, false, 'the application role does NOT have BYPASSRLS');
  } finally {
    await ctx.asSuperuser(null, async (tx) => {
      await tx.query('DELETE FROM membership_status_history WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await tx.query('DELETE FROM tenant_memberships WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await tx.query('DELETE FROM tenant_entities WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
      await tx.query('DELETE FROM identity_status_history WHERE identity_id = ANY($1::uuid[])', [
        [alice, bob],
      ]);
      await tx.query(
        'DELETE FROM account_status_history WHERE account_id IN (SELECT id FROM user_accounts WHERE identity_id = ANY($1::uuid[]))',
        [[alice, bob]],
      );
      await tx.query(
        'DELETE FROM authentication_subjects WHERE account_id IN (SELECT id FROM user_accounts WHERE identity_id = ANY($1::uuid[]))',
        [[alice, bob]],
      );
      await tx.query('DELETE FROM user_accounts WHERE identity_id = ANY($1::uuid[])', [[alice, bob]]);
      await tx.query('DELETE FROM identities WHERE id = ANY($1::uuid[])', [[alice, bob]]);
      await tx.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    });
  }
});
