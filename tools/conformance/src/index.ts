import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
