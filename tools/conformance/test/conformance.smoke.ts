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
});
