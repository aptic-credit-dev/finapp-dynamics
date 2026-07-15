import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { orderedModules } from './module-order.ts';

export interface PlannedMigration {
  readonly module: string;
  readonly filename: string;
  readonly path: string;
  readonly sql: string;
  readonly checksum: string;
}

/** `0001_create_tenants.sql` -> sequence 1. */
const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function checksum(sql: string): string {
  // Normalise line endings first: a checkout on Windows must not appear to tamper with a migration
  // that was committed on Linux.
  return createHash('sha256').update(sql.replaceAll('\r\n', '\n'), 'utf8').digest('hex');
}

/** Validates a migration filename. Returns the reason it is invalid, or null when it is fine. */
export function validateMigrationFilename(filename: string): string | null {
  if (!MIGRATION_FILE_PATTERN.test(filename)) {
    return `"${filename}" must be NNNN_snake_case.sql (four-digit sequence, e.g. 0001_create_tenants.sql)`;
  }
  return null;
}

export function sequenceOf(filename: string): number {
  const match = MIGRATION_FILE_PATTERN.exec(filename);
  const sequence = match?.[1];
  if (sequence === undefined) throw new Error(`Not a migration filename: ${filename}`);
  return Number.parseInt(sequence, 10);
}

/**
 * Orders one module's migration filenames and rejects a malformed or duplicated sequence.
 *
 * Duplicate sequence numbers are an error rather than a tie broken by name: two developers adding
 * `0007_*` on separate branches must resolve the collision deliberately, because the order the two run
 * in is the difference between a working schema and a broken one.
 */
export function orderMigrationFilenames(module: string, filenames: readonly string[]): string[] {
  const migrations = filenames.filter((f) => f.endsWith('.sql'));

  const problems = migrations.map((f) => validateMigrationFilename(f)).filter((p): p is string => p !== null);
  if (problems.length > 0) {
    throw new Error(`${module}: invalid migration filename(s): ${problems.join('; ')}`);
  }

  const bySequence = new Map<number, string[]>();
  for (const filename of migrations) {
    const sequence = sequenceOf(filename);
    const existing = bySequence.get(sequence);
    if (existing === undefined) bySequence.set(sequence, [filename]);
    else existing.push(filename);
  }

  const collisions = [...bySequence.entries()].filter(([, files]) => files.length > 1);
  if (collisions.length > 0) {
    const detail = collisions.map(([seq, files]) => `${seq}: ${files.join(', ')}`).join('; ');
    throw new Error(`${module}: duplicate migration sequence(s): ${detail}`);
  }

  return migrations.sort((a, b) => sequenceOf(a) - sequenceOf(b));
}

/**
 * Builds the ordered plan: every module's migrations, modules in dependency order, files in sequence
 * order within a module.
 */
export async function planMigrations(repoRoot: string): Promise<PlannedMigration[]> {
  const plan: PlannedMigration[] = [];

  for (const module of orderedModules()) {
    const dir = resolve(repoRoot, 'packages', module, 'migrations');
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // module has no migrations yet
    }

    for (const filename of orderMigrationFilenames(module, entries)) {
      const path = join(dir, filename);
      const sql = await readFile(path, 'utf8');
      plan.push({ module, filename, path, sql, checksum: checksum(sql) });
    }
  }

  return plan;
}
