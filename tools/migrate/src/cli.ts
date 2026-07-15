import pg from 'pg';
import { resolve } from 'node:path';
import { planMigrations } from './plan.ts';
import { migrate } from './runner.ts';

/**
 * `npm run migrate [-- --dry-run]`
 *
 * Fails loudly with no DATABASE_URL rather than defaulting to a connection string. A migration runner
 * that guesses where to connect is a migration runner that eventually runs against the wrong database.
 */

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const plan = await planMigrations(repoRoot);

  if (plan.length === 0) {
    console.log('migrate: no migrations found (no module owns a table yet).');
    return;
  }

  if (dryRun) {
    console.log(`migrate --dry-run: ${plan.length} migration(s) in order:`);
    for (const migration of plan) {
      console.log(`  ${migration.module}/${migration.filename}  [${migration.checksum.slice(0, 12)}]`);
    }
    return;
  }

  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    console.error('migrate: DATABASE_URL is not set. Refusing to guess a target database.');
    process.exitCode = 1;
    return;
  }

  const pool = new pg.Pool({ connectionString: url });
  try {
    const result = await migrate(pool, plan);
    for (const applied of result.applied) {
      console.log(`applied  ${applied.module}/${applied.filename}  (${applied.durationMs}ms)`);
    }
    console.log(`\nmigrate: ${result.applied.length} applied, ${result.skipped} already up to date.`);
  } catch (error: unknown) {
    console.error(`migrate: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
