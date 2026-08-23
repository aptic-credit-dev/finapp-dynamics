import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineSuite } from '@finapp/test-runner';
import {
  controllerPrefixes,
  createdTables,
  manifestFiles,
  migrationSql,
  parseAllManifests,
  sourceFiles,
  stripCommentLines,
} from '@finapp/conformance';

/**
 * Conformance smoke suite — structural checks across the whole repository.
 *
 * The first check is the one that would have caught a real defect: every manifest must parse. The
 * implementation manifest was invalid YAML from Stage 1A until Stage 1B and merged to main, because the
 * only thing reading manifests was m01's suite and it happened to read the other four.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * ADR-135 — implemented-status criteria. A DOMAIN module (default) marked `implemented` must ship real source
 * in its own `packages/<module>/src/` (generalises the m02 rule — CLAUDE.md: no `implemented` without real
 * code). A `composition_vertical` (a UI/orchestration experience over existing engines) instead must DECLARE
 * and satisfy the composition criteria and must NOT own a domain package. Pure function so both the manifest
 * scan and explicit positive/negative unit cases can exercise it. Returns the list of violations (empty = ok).
 */
interface ModuleRec {
  readonly module: string;
  readonly status?: string;
  readonly kind?: string;
  readonly reuses?: unknown;
  readonly surface?: unknown;
  readonly controls?: unknown;
  readonly acceptance?: unknown;
}
export function validateImplementedModule(m: ModuleRec, hasPackage: boolean): string[] {
  const errs: string[] = [];
  if (m.status !== 'implemented') return errs; // only `implemented` is gated
  if (m.kind === 'composition_vertical') {
    // ADR-135: a composition vertical owns NO new domain engine.
    if (hasPackage)
      errs.push(`${m.module}: composition_vertical must NOT own a packages/${m.module} domain package`);
    if (!Array.isArray(m.reuses) || m.reuses.length === 0)
      errs.push(`${m.module}: composition_vertical implemented needs a non-empty reuses[] dependency map`);
    if (typeof m.surface !== 'string' || m.surface.trim() === '')
      errs.push(`${m.module}: composition_vertical implemented needs a declared surface`);
    const c = (m.controls ?? {}) as Record<string, unknown>;
    if (!c['rbac'] || !c['audit'] || !c['tenancy'])
      errs.push(`${m.module}: composition_vertical implemented needs controls.{rbac,audit,tenancy}`);
    if (typeof m.acceptance !== 'string' || m.acceptance.trim() === '')
      errs.push(`${m.module}: composition_vertical implemented needs an acceptance-evidence reference`);
  } else {
    // Domain module (default): must have real source in its own package. No loophole.
    if (!hasPackage)
      errs.push(`${m.module}: implemented domain module must ship packages/${m.module}/src/ source`);
  }
  return errs;
}

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
  // Module (software) build statuses, plus the operational-programme lifecycle (ADR-130) for stages whose
  // deliverables are external assurance/operational exercises rather than software modules (e.g. Stage 7
  // Hardening). `approved_for_build` is module-only and is never reused for an operational programme.
  const LEGEND = [
    'documented',
    'approved_for_build',
    'implemented',
    'deferred',
    'requires_review',
    // operational-programme lifecycle (ADR-130)
    'approved_for_execution',
    'in_execution',
    'evidence_complete',
    'conditionally_closed',
    'closed',
  ];
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

  // --- Stage 1B: x-actor-id is dead ----------------------------------------------------------------
  //
  // THE CHECK THIS STAGE EXISTS TO LEAVE BEHIND. Stage 1B removed `x-actor-id` from the tenant
  // controller, and nothing structural stopped it coming back — it is one convenient line, and it would
  // pass review as an obvious way to know who is calling. A test that a request carrying only
  // `x-actor-id` fails would NOT catch it either: a controller could read the header and still refuse
  // that request, and every behavioural test would stay green while the header quietly became load-
  // bearing again somewhere else.
  //
  // So the prohibition is structural: no line of live CODE may mention it. Comments may — the removal is
  // worth documenting, and `test/` is excluded so the suites proving the header is dead can name it.

  const sources = sourceFiles(REPO_ROOT);
  t.ok(sources.length > 0, `source scan found files to check (${sources.length})`);

  const actorHeaderUsers = sources.filter((f) => /x-actor-id/i.test(stripCommentLines(f.text)));
  t.deepEqual(
    actorHeaderUsers.map((f) => f.name),
    [],
    'no live source reads x-actor-id — identity comes from ActorResolver, never a raw header',
  );

  // Stage 1C DELETED the development actor assertion. Like x-actor-id, it must have zero live source use —
  // authentication is a real session now, and the dev bypass cannot creep back in.
  const devActorUsers = sources.filter((f) => /x-dev-actor/i.test(stripCommentLines(f.text)));
  t.deepEqual(
    devActorUsers.map((f) => f.name),
    [],
    'no live source names x-dev-actor — the Stage 1B dev adapter was deleted in Stage 1C',
  );

  // Stage 1D PAID the x-permissions debt. It was the last input a caller could use to state their own
  // privileges; permissions are now resolved from persistent role assignments, so like x-actor-id and
  // x-dev-actor the header must have ZERO live source use. A reader creeping back would mean a client can
  // once again inject its own authorization — the exact failure default-deny RBAC exists to end.
  const permissionHeaderUsers = sources.filter((f) => /x-permissions/i.test(stripCommentLines(f.text)));
  t.deepEqual(
    permissionHeaderUsers.map((f) => f.name),
    [],
    'no live source reads x-permissions — permissions come from persistent RBAC, never a client header',
  );

  // ContextAuthz (the Stage 1A stand-in that trusted whatever permissions were already on the context) is
  // DELETED. AUTHZ is bound to the persistent RbacAuthz. No live source may name the retired class, or a
  // second authorization implementation has survived alongside the real one.
  const contextAuthzUsers = sources.filter((f) => /\bContextAuthz\b/.test(stripCommentLines(f.text)));
  t.deepEqual(
    contextAuthzUsers.map((f) => f.name),
    [],
    'no live source names ContextAuthz — the stand-in authorizer was replaced by RbacAuthz (m02-rbac)',
  );

  // The platform binding proves it positively: AUTHZ resolves to RbacAuthz, the persistent authorizer.
  const platformModule = sources.find((f) => f.name === 'apps/api/src/platform.module.ts')?.text ?? '';
  t.ok(
    /provide:\s*AUTHZ[\s\S]*?useClass:\s*RbacAuthz/.test(platformModule),
    'AUTHZ is bound to the persistent RbacAuthz, not a permissive stand-in',
  );

  // --- route prefixes match the naming map ---------------------------------------------------------
  // The naming map is authoritative for API prefixes. A controller mounting a prefix nobody registered
  // is an API surface that no ownership map describes.

  const registeredPrefixes = new Set(
    (byName('naming-map.yaml') as { modules?: { api_prefixes?: string[] }[] } | undefined)?.modules?.flatMap(
      (m) => m.api_prefixes ?? [],
    ) ?? [],
  );
  // `/api/v1` is the global prefix main.ts applies; a controller declares only the segment after it.
  const HOST_ROUTES = new Set(['health']);

  for (const file of sources) {
    for (const prefix of controllerPrefixes(file.text)) {
      if (HOST_ROUTES.has(prefix)) continue;
      t.ok(
        registeredPrefixes.has(`/api/v1/${prefix}`),
        `${file.name}: route prefix /api/v1/${prefix} is registered in naming-map.yaml`,
      );
    }
  }

  // --- Stage 1C tables exist; NO plaintext credential; still no Stage 1D tables --------------------

  const migrations = migrationSql(REPO_ROOT);
  t.ok(migrations.length > 0, `migration scan found files to check (${migrations.length})`);
  const tables = migrations.flatMap((m) => createdTables(m.text).map((table) => ({ table, in: m.name })));

  // Stage 1C IS built now: its account-plane tables must exist.
  for (const expected of [
    'authentication_credentials',
    'sessions',
    'login_attempts',
    'session_refresh_tokens',
  ]) {
    t.ok(
      tables.some((row) => row.table === expected),
      `Stage 1C table "${expected}" exists`,
    );
  }

  // NO PLAINTEXT credential or token column (ADR-009). Secrets are stored ONLY as `*_hash` / `secret_hash`.
  // A bare `password text`, `token text`, `secret text` or `refresh_token text` column would be the exact
  // failure this stage exists to make impossible.
  const authMigration = migrations.find((m) => m.name.includes('m02-auth'))?.text ?? '';
  const plaintextColumn =
    /\b(password|secret|token|refresh_token|session_token|access_token)\s+(text|varchar|char|bytea)\b/i;
  t.ok(
    !plaintextColumn.test(authMigration),
    'no plaintext password/token/secret column exists — credentials and tokens are hash-only',
  );

  // Stage 1D IS built now: the RBAC persistence tables must exist. These are the role model, the grant
  // model and the segregation-of-duties model — the tables that make authorization a fact in the database
  // rather than a claim on a request.
  for (const expected of ['permissions', 'roles', 'role_permissions', 'role_assignments', 'sod_rules']) {
    t.ok(
      tables.some((row) => row.table === expected),
      `Stage 1D RBAC table "${expected}" exists`,
    );
  }

  // --- m02 status is internally consistent ---------------------------------------------------------
  // A module marked `implemented` in the plan while its own package is absent is the manifest lying, and
  // CLAUDE.md forbids marking an item implemented without real code.

  const modulesInPlan = stages.flatMap((s) => s.modules ?? []);
  const m02 = modulesInPlan.find((m) => m.module === 'm02-identity');
  t.ok(m02 !== undefined, 'm02-identity appears in the implementation manifest');

  const m02Sources = sources.filter((f) => f.name.startsWith('packages/m02-identity/src/'));
  if (m02?.status === 'implemented') {
    t.ok(m02Sources.length > 0, 'm02-identity is marked implemented and has source (no empty claim)');
    t.ok(
      m02Sources.some((f) => f.name.endsWith('actor-resolver.ts')),
      'm02-identity is marked implemented and ships the actor resolver the stage is defined by',
    );
  }

  // --- ADR-135: every `implemented` module satisfies its kind's criteria --------------------------
  // Domain modules need their own package (generalises the m02 rule above — no loophole); a
  // `composition_vertical` needs its declared composition criteria and NO domain package.
  for (const m of modulesInPlan as ModuleRec[]) {
    if (m.status !== 'implemented') continue;
    // A manifest entry may name a compound module (e.g. "m15-recon + m15a-matching"); a domain module is
    // "backed" if ANY of its mNN- package tokens ships source. (composition_vertical must own NONE — see below.)
    const tokens = m.module.match(/m\d+[a-z]?-[a-z0-9-]+/g) ?? [m.module];
    const hasPackage = tokens.some((tok) => sources.some((f) => f.name.startsWith(`packages/${tok}/src/`)));
    const errs = validateImplementedModule(m, hasPackage);
    t.equal(
      errs.length,
      0,
      `${m.module}: implemented-status criteria met (ADR-135)${errs.length ? ' — ' + errs.join('; ') : ''}`,
    );
  }

  // ADR-135 validator — explicit positive AND negative cases (so the rule cannot silently rot).
  const cv = {
    module: 'mcv',
    status: 'implemented',
    kind: 'composition_vertical',
    reuses: ['m20-glrecon'],
    surface: 'apps/web',
    controls: { rbac: true, audit: true, tenancy: true },
    acceptance: 'evidence_2026',
  } satisfies ModuleRec;
  t.equal(
    validateImplementedModule({ module: 'x', status: 'approved_for_build' }, false).length,
    0,
    'ADR-135: a non-implemented module is not gated',
  );
  t.equal(
    validateImplementedModule({ module: 'm02-identity', status: 'implemented' }, true).length,
    0,
    'ADR-135 (+): implemented DOMAIN module WITH its package passes',
  );
  t.ok(
    validateImplementedModule({ module: 'm02-identity', status: 'implemented' }, false).length > 0,
    'ADR-135 (−): implemented DOMAIN module WITHOUT a package FAILS',
  );
  t.equal(
    validateImplementedModule(cv, false).length,
    0,
    'ADR-135 (+): composition_vertical meeting all criteria (no package) passes',
  );
  t.ok(
    validateImplementedModule(cv, true).length > 0,
    'ADR-135 (−): composition_vertical that OWNS a domain package FAILS',
  );
  t.ok(
    validateImplementedModule({ ...cv, reuses: [] }, false).length > 0,
    'ADR-135 (−): composition_vertical with an EMPTY reuses map FAILS',
  );
  t.ok(
    validateImplementedModule({ ...cv, controls: { rbac: true } }, false).length > 0,
    'ADR-135 (−): composition_vertical missing controls.audit/tenancy FAILS',
  );
  t.ok(
    validateImplementedModule({ ...cv, acceptance: undefined }, false).length > 0,
    'ADR-135 (−): composition_vertical without acceptance evidence FAILS',
  );

  // --- every workspace's tests live inside its own tsconfig (lint needs no prior build) ------------
  // REGRESSION GUARD for the Stage 1B CI failure. apps/api excluded test/** from its tsconfig, so its
  // integration spec could only be type-aware-linted through a separate classic-`project` eslint tsconfig
  // that resolved `@finapp/*` types via BUILT dist/*.d.ts. CI's Smoke lane lints BEFORE it builds, so dist
  // was absent and lint failed with 173 "type that cannot be resolved" errors — while every developer
  // machine passed because a prior build had left dist in place. Keeping each test dir inside its own
  // workspace tsconfig means projectService redirects those imports to SOURCE, so `npm run lint` succeeds
  // on a clean checkout. This asserts that invariant so the same trap cannot be reintroduced silently.
  for (const group of ['apps', 'packages', 'tools']) {
    const groupDir = resolve(REPO_ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const ws of readdirSync(groupDir, { withFileTypes: true })) {
      if (!ws.isDirectory()) continue;
      const testDir = resolve(groupDir, ws.name, 'test');
      const tsconfigPath = resolve(groupDir, ws.name, 'tsconfig.json');
      if (!existsSync(testDir) || !existsSync(tsconfigPath)) continue;
      if (!readdirSync(testDir).some((f) => f.endsWith('.ts'))) continue;
      // Collapse whitespace and comment lines, then require an `include` array that names `test/`.
      const cleaned = stripCommentLines(readFileSync(tsconfigPath, 'utf8')).replace(/\s+/g, ' ');
      t.ok(
        /"include"\s*:\s*\[[^\]]*test\//.test(cleaned),
        `${group}/${ws.name}/tsconfig.json includes its test/ dir (type-aware lint must not need a prior build)`,
      );
    }
  }
});
