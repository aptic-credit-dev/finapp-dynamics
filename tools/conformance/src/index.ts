import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * Platform-wide structural checks (docs/07-engineering/TEST_STRATEGY.md names a conformance suite as a
 * test layer; this is its first slice).
 *
 * WHY THIS EXISTS. `manifests/implementation-manifest.yaml` — the file CLAUDE.md calls "the
 * authoritative, machine-readable plan" — was invalid YAML from Stage 1A until Stage 1B, and nothing
 * noticed. The m01 smoke suite parsed four of the six manifests and happened not to parse that one, so a
 * machine-readable plan that no machine could read merged to main.
 *
 * A file is only authoritative if something reads it on every commit. This does.
 */

export interface ManifestFile {
  readonly name: string;
  readonly path: string;
}

/** Every YAML file under manifests/. Discovered, not listed — a new manifest is covered automatically. */
export function manifestFiles(repoRoot: string): ManifestFile[] {
  const dir = resolve(repoRoot, 'manifests');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map((name) => ({ name, path: resolve(dir, name) }));
}

export interface ParseResult {
  readonly name: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly value?: unknown;
}

/** Parses one manifest. Never throws — a broken file is a reported failure, not a dead suite. */
export function parseManifest(file: ManifestFile): ParseResult {
  let text: string;
  try {
    text = readFileSync(file.path, 'utf8');
  } catch (error: unknown) {
    return { name: file.name, ok: false, error: `unreadable: ${errorMessage(error)}` };
  }
  try {
    return { name: file.name, ok: true, value: parse(text) };
  } catch (error: unknown) {
    return { name: file.name, ok: false, error: errorMessage(error) };
  }
}

export function parseAllManifests(repoRoot: string): ParseResult[] {
  return manifestFiles(repoRoot).map(parseManifest);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
}

// --- source scanning ---------------------------------------------------------------------------------

export interface SourceFile {
  /** Repo-relative, forward-slashed — stable across platforms, and readable in a failure message. */
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

const SOURCE_ROOTS = ['packages', 'apps', 'tools'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.turbo', 'test']);

/**
 * Every LIVE TypeScript source file — the `src` directory of each workspace under `packages`, `apps` and
 * `tools`.
 *
 * `test/` is excluded deliberately. A suite proving that `x-actor-id` no longer works has to mention it,
 * and a check that cannot tell "the header is used" from "the header is proven dead" would force the
 * proof and the prohibition to be mutually exclusive.
 *
 * `dist/` is excluded for the same reason it is gitignored: it is a build artifact of these files, and
 * scanning it would report every finding twice and go stale silently.
 */
export function sourceFiles(repoRoot: string): SourceFile[] {
  const found: SourceFile[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a root that does not exist yet is not an error — modules land stage by stage
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        found.push({
          name: relative(repoRoot, full).replaceAll('\\', '/'),
          path: full,
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  }

  for (const root of SOURCE_ROOTS) {
    const base = resolve(repoRoot, root);
    let isDir = false;
    try {
      isDir = statSync(base).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(base, entry.name, 'src'));
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Drops comment lines, leaving code.
 *
 * Line-oriented and deliberately simple: a line whose first non-space character starts a comment is
 * dropped, and everything else is kept. It does not parse TypeScript, and it does not need to — the
 * question it answers is "does any line of CODE mention this", and the failure mode of a naive strip is
 * the safe one. Keeping a trailing `// ...` comment on a code line risks a FALSE POSITIVE, which a human
 * sees and fixes in a minute; the alternative — a clever strip that mishandles a `//` inside a string
 * literal and silently drops the rest of the line — risks a false NEGATIVE, which is a prohibition that
 * quietly stops prohibiting.
 */
export function stripCommentLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !(
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*/') ||
        trimmed.startsWith('*')
      );
    })
    .join('\n');
}

/** Every `.sql` under any module's `migrations/`. */
export function migrationSql(repoRoot: string): SourceFile[] {
  const found: SourceFile[] = [];
  const base = resolve(repoRoot, 'packages');
  let modules: string[];
  try {
    modules = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return found;
  }

  for (const module of modules) {
    const dir = join(base, module, 'migrations');
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // most modules have no migrations yet
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
      const full = join(dir, entry.name);
      found.push({
        name: relative(repoRoot, full).replaceAll('\\', '/'),
        path: full,
        text: readFileSync(full, 'utf8'),
      });
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Tables a migration creates, lowercased. Covers the `IF NOT EXISTS` form. */
export function createdTables(sql: string): string[] {
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  return [...sql.matchAll(pattern)].map((m) => (m[1] ?? '').toLowerCase()).filter((t) => t !== '');
}

/** Route prefixes a controller declares, e.g. `@Controller('identities')` -> `identities`. */
export function controllerPrefixes(source: string): string[] {
  const pattern = /@Controller\(\s*['"]([^'"]*)['"]\s*\)/g;
  return [...source.matchAll(pattern)].map((m) => m[1] ?? '');
}
