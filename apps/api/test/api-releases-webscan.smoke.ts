import { readFileSync } from 'node:fs';
import { defineSuite } from '@finapp/test-runner';

/**
 * M37 Release Governance (Stage-8, READ-ONLY) — web no-mutation PURE assertion. The release-governance surface must
 * be strictly read-only: it may list artifacts / environments / releases, but it must NEVER be able to request,
 * approve, roll back, validate, gate or otherwise mutate a release, and it must introduce NO M42 GO/NO_GO verdict
 * and NO M22 approval semantics. This suite scans the web sources and proves:
 *   (1) the M37 client block exposes ONLY the three GET readers (no POST, no lifecycle route);
 *   (2) no release-mutation client function exists anywhere in the api client;
 *   (3) the ReleaseGovernance component calls ONLY those three read client fns — no approve/rollback/verdict path.
 * This guards the read-only contract at the source boundary, complementing the live staging acceptance (which
 * proves the read persona is 403 on every mutating route server-side).
 */
function slice(src: string, startRe: RegExp, endRe: RegExp): string {
  const start = src.search(startRe);
  if (start < 0) return '';
  const rest = src.slice(start + 1);
  const end = rest.search(endRe);
  return end < 0 ? src.slice(start) : src.slice(start, start + 1 + end);
}

export default defineSuite('api-releases-webscan', (t) => {
  const apiSrc = readFileSync(new URL('../../web/src/api.ts', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../../web/src/app.tsx', import.meta.url), 'utf8');

  // (1) the M37 client block = from `const REL = '/releases'` to the next top-level section comment.
  const relBlock = slice(apiSrc, /const REL = '\/releases'/, /\n\/\/ ---/);
  t.ok(relBlock.length > 0, 'the M37 release client block is present');
  t.ok(relBlock.includes('getGovArtifacts'), 'exposes getGovArtifacts (GET)');
  t.ok(relBlock.includes('getGovEnvironments'), 'exposes getGovEnvironments (GET)');
  t.ok(relBlock.includes('getGovReleases'), 'exposes getGovReleases (GET)');
  t.ok(!/method:\s*'POST'/.test(relBlock), 'the release client block issues NO POST (read-only)');
  for (const route of ['/approve', '/rollback', '/gates', '/validate', '/review', '/checks', '/retire'])
    t.ok(!relBlock.includes(route), `the release client block has no ${route} lifecycle route`);

  // (2) no release-mutation client function anywhere in api.ts.
  for (const fn of [
    'requestRelease',
    'approveRelease',
    'rejectRelease',
    'rollbackRelease',
    'recordReleaseCheck',
    'addReleaseGate',
    'validateRelease',
    'addReleaseEvidence',
    'registerArtifact',
    'retireArtifact',
    'defineEnvironment',
  ])
    t.ok(!apiSrc.includes(fn), `api client has no release-mutation fn (${fn})`);

  // (3) the ReleaseGovernance component calls ONLY the three read client fns — no mutation / verdict / approval path.
  const comp = slice(appSrc, /function ReleaseGovernance\(/, /\nconst NAV = \[/);
  t.ok(comp.length > 0, 'the ReleaseGovernance component is present');
  // Only invocations `api.fn(` — not type references like `api.ApiResult<…>`.
  const apiCalls = [...comp.matchAll(/api\.([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1] ?? '');
  const allowed = new Set(['getGovArtifacts', 'getGovEnvironments', 'getGovReleases']);
  const disallowed = [...new Set(apiCalls)].filter((c) => !allowed.has(c));
  t.equal(
    disallowed.length,
    0,
    `ReleaseGovernance calls only the three read client fns (offenders: ${disallowed.join(',') || 'none'})`,
  );
  // No M42 verdict pill / GO-NO_GO decision widget and no maker-checker approval control in the component.
  t.ok(!comp.includes('verdictPill'), 'ReleaseGovernance renders no M42 verdict pill');
  t.ok(!comp.includes('ActionButton'), 'ReleaseGovernance renders no action/mutation control');
  t.ok(
    !/onClick=\{[^}]*(approve|rollback|request|issue)/i.test(comp),
    'no approve/rollback/request onClick handler',
  );
});
