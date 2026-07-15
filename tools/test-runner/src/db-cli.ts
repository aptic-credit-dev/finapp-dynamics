import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { relative } from 'node:path';
import { discover } from './discover.ts';
import { runSuite, type SuiteResult } from './harness.ts';
import { createSpecContext, type DbSpec } from './db-harness.ts';

/**
 * The DB integration lane. Discovers every `*.db-spec.ts` and runs it against PostgreSQL.
 *
 * No DATABASE_URL => every spec is skipped and the lane is green. That is deliberate: contributors and
 * the PR smoke lane must not need a database, while the DB lane on merge does
 * (docs/07-engineering/TEST_STRATEGY.md). A skip is reported loudly rather than silently, so "green"
 * never quietly means "never ran".
 */

const ROOTS = ['packages', 'apps', 'tools'];
const DEFAULT_APP_ROLE = 'finapp_app';
const DEFAULT_OWNER_ROLE = 'finapp_owner';

async function loadSpec(file: string): Promise<DbSpec> {
  const module: unknown = await import(pathToFileURL(file).href);
  const spec = (module as { default?: unknown }).default;
  if (
    typeof spec !== 'object' ||
    spec === null ||
    typeof (spec as DbSpec).name !== 'string' ||
    typeof (spec as DbSpec).run !== 'function'
  ) {
    throw new Error(`${file} must default-export a spec from defineDbSpec()`);
  }
  return spec as DbSpec;
}

/**
 * Ensures a NOLOGIN, NOBYPASSRLS role exists.
 *
 * Roles are reached via `SET ROLE` on each connection rather than by separate credentials — that keeps
 * the lane credential-free while still exercising RLS as a real non-superuser.
 *
 * NOBYPASSRLS is explicit and load-bearing: a role with BYPASSRLS ignores every policy, so a proof run
 * through one proves nothing at all.
 */
async function ensureRole(pool: pg.Pool, role: string, envVar: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`${envVar} "${role}" must be a plain lower_snake_case identifier.`);
  }
  await pool.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $role$${role}$role$) THEN
         CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS;
       END IF;
     END
     $$;`,
  );
  await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
}

async function ensureRoles(pool: pg.Pool, ownerRole: string, appRole: string): Promise<void> {
  await ensureRole(pool, ownerRole, 'DATABASE_OWNER_ROLE');
  await ensureRole(pool, appRole, 'DATABASE_APP_ROLE');
  // The owner creates the schema. Since PostgreSQL 15 the public schema no longer grants CREATE to
  // PUBLIC, so this grant is required rather than incidental.
  await pool.query(`GRANT CREATE ON SCHEMA public TO "${ownerRole}"`);
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const appRole = process.env['DATABASE_APP_ROLE'] ?? DEFAULT_APP_ROLE;
  const ownerRole = process.env['DATABASE_OWNER_ROLE'] ?? DEFAULT_OWNER_ROLE;

  const files: string[] = [];
  for (const root of ROOTS) files.push(...(await discover(root, '.db-spec.ts')));

  if (url === undefined || url === '') {
    console.log(
      `db lane: SKIPPED — DATABASE_URL is not set (${files.length} spec(s) not run).\n` +
        '         This lane is green when skipped by design; it is required on merge, not on PR.',
    );
    return;
  }

  if (files.length === 0) {
    console.log('db lane: 0 specs, nothing to run (green).');
    return;
  }

  const pool = new pg.Pool({ connectionString: url });

  const results: SuiteResult[] = [];
  try {
    await ensureRoles(pool, ownerRole, appRole);
    const ctx = createSpecContext(pool, ownerRole, appRole);

    for (const file of files) {
      const label = relative(process.cwd(), file).replaceAll('\\', '/');
      try {
        const spec = await loadSpec(file);
        results.push(await runSuite({ name: spec.name, run: (t) => spec.run(ctx, t) }));
      } catch (error: unknown) {
        results.push({
          name: label,
          passed: 0,
          failures: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await pool.end();
  }

  let passed = 0;
  let failedSpecs = 0;
  for (const result of results) {
    passed += result.passed;
    const broken = result.failures.length > 0 || result.error !== undefined;
    if (broken) failedSpecs += 1;
    console.log(`${broken ? 'FAIL' : 'ok  '}  ${result.name}  (${result.passed} assertions)`);
    for (const failure of result.failures) {
      console.log(
        `        x ${failure.message}${failure.detail === undefined ? '' : ` — ${failure.detail}`}`,
      );
    }
    if (result.error !== undefined) console.log(`        ! spec threw: ${result.error}`);
  }

  console.log(
    `\ndb lane: ${results.length} specs, ${passed} assertions passed, ${failedSpecs} specs failed.`,
  );
  if (failedSpecs > 0) process.exitCode = 1;
}

await main();
