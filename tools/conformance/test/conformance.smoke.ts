import { resolve } from 'node:path';
import { defineSuite } from '@finapp/test-runner';
import { manifestFiles, parseAllManifests } from '@finapp/conformance';

/**
 * Conformance smoke suite — structural checks across the whole repository.
 *
 * The first check is the one that would have caught a real defect: every manifest must parse. The
 * implementation manifest was invalid YAML from Stage 1A until Stage 1B and merged to main, because the
 * only thing reading manifests was m01's suite and it happened to read the other four.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

export default defineSuite('conformance', (t) => {
  const files = manifestFiles(REPO_ROOT);
  t.ok(files.length >= 6, `manifests/ contains the expected registries (found ${files.length})`);

  // EVERY manifest parses. Discovered from disk, so a new manifest is covered the day it lands rather
  // than the day someone remembers to add it here.
  const results = parseAllManifests(REPO_ROOT);
  for (const result of results) {
    t.ok(result.ok, `${result.name} is valid YAML${result.ok ? '' : ` — ${result.error ?? ''}`}`);
  }

  // A manifest that parses to a scalar or null is technically valid YAML and useless as a plan.
  for (const result of results) {
    if (!result.ok) continue;
    t.ok(
      typeof result.value === 'object' && result.value !== null,
      `${result.name} parses to a mapping, not a bare scalar`,
    );
  }

  // The implementation manifest is THE plan (CLAUDE.md). Assert the shape everything else reads.
  const manifest = results.find((r) => r.name === 'implementation-manifest.yaml');
  t.ok(manifest?.ok === true, 'implementation-manifest.yaml parses');

  const plan = manifest?.value as
    | { stages?: { stage: number; status?: string; modules?: { module: string; status?: string }[] }[] }
    | undefined;
  t.ok(Array.isArray(plan?.stages), 'the manifest declares a stages array');

  const stages = plan?.stages ?? [];
  t.ok(stages.length > 0, 'at least one stage is declared');
  t.deepEqual(
    stages.map((s) => s.stage),
    [...stages.map((s) => s.stage)].sort((a, b) => a - b),
    'stages are listed in ascending order',
  );

  // Statuses must come from the legend. A typo'd status silently drops an item out of every filter that
  // reads this file.
  const LEGEND = ['documented', 'approved_for_build', 'implemented', 'deferred', 'requires_review'];
  for (const stage of stages) {
    if (stage.status !== undefined) {
      t.ok(LEGEND.includes(stage.status), `stage ${stage.stage} status "${stage.status}" is in the legend`);
    }
    for (const module of stage.modules ?? []) {
      if (module.status === undefined) continue;
      t.ok(LEGEND.includes(module.status), `${module.module} status "${module.status}" is in the legend`);
    }
  }

  // --- cross-registry agreement --------------------------------------------------------------------
  // Each registry is authoritative for its own axis (naming-map.yaml), so the failure mode is not a
  // broken file — it is two files that each parse and quietly disagree. That is what GAP-1 was, twice.
  const byName = (n: string) => results.find((r) => r.name === n)?.value;

  const namingMap = byName('naming-map.yaml') as
    | { modules?: { module: string; event_families?: string[]; event_family_registered?: boolean }[] }
    | undefined;
  const eventRegistry = byName('event-registry.yaml') as
    { family_groups?: { families?: string[] }[] } | undefined;
  const registeredFamilies = new Set((eventRegistry?.family_groups ?? []).flatMap((g) => g.families ?? []));

  // THE GAP-1 CHECK. A module whose naming-map row claims its family is registered must actually have it
  // in the event registry. Both m01 and m02 shipped with this flag false and the family missing.
  for (const module of namingMap?.modules ?? []) {
    if (module.event_family_registered !== true) continue;
    for (const family of module.event_families ?? []) {
      t.ok(
        registeredFamilies.has(family),
        `${module.module}: claims event_family_registered but "${family}" is missing from event-registry.yaml`,
      );
    }
  }

  // Audit registry: the declared count must equal the actual number of codes, and codes must be unique
  // and correctly shaped. A duplicated or malformed code is an audit trail that cannot be trusted.
  const auditRegistry = byName('audit-code-registry.yaml') as
    { codes?: { code: string; module?: string }[]; registered_code_count?: number } | undefined;
  const codes = auditRegistry?.codes ?? [];
  t.equal(
    auditRegistry?.registered_code_count,
    codes.length,
    'audit registry: registered_code_count equals len(codes)',
  );
  t.equal(
    new Set(codes.map((c) => c.code)).size,
    codes.length,
    'audit registry: no duplicate codes (ADR-005 — codes are immutable and unique)',
  );
  for (const entry of codes) {
    t.ok(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(entry.code), `audit code ${entry.code} is SCREAMING_SNAKE`);
    t.ok(entry.code.split('_').length >= 3, `audit code ${entry.code} matches <PREFIX>_<ENTITY>_<ACTION>`);
  }

  // Permission registry: every registered code must sit inside its own namespace. A code filed under the
  // wrong namespace is invisible to any grant that reads the namespace.
  const permissionRegistry = byName('permission-registry.yaml') as
    { namespaces?: { namespace: string; codes?: string[] }[] } | undefined;
  for (const ns of permissionRegistry?.namespaces ?? []) {
    // "identity.*" -> "identity." — the prefix every code in the namespace must carry.
    const prefix = ns.namespace.endsWith('*') ? ns.namespace.slice(0, -1) : ns.namespace;
    for (const code of ns.codes ?? []) {
      t.ok(code.startsWith(prefix), `permission ${code} is inside its registered namespace ${ns.namespace}`);
      t.equal(
        code.split('.').length,
        3,
        `permission ${code} has three segments (the kernel's @Endpoint rule)`,
      );
    }
  }
});
