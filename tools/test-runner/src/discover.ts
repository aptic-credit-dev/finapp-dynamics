import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.turbo']);

/** Recursively collects files under `root` whose name ends with `suffix`. Sorted, so runs are stable. */
export async function discover(root: string, suffix: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // a directory that does not exist yet is not an error — modules land stage by stage
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        found.push(resolve(full));
      }
    }
  }

  await walk(resolve(root));
  return found.sort();
}
