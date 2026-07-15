import { pathToFileURL } from 'node:url';
import { relative } from 'node:path';
import { discover } from './discover.ts';
import { runSuite, type SmokeSuite, type SuiteResult } from './harness.ts';

/**
 * The smoke lane. Discovers every `*.smoke.ts` and runs it.
 *
 * Zero suites is a green run, not a failure: the lane has to work before any module exists, and it is
 * the discovery + reporting path that Stage 0 is proving.
 */

const ROOTS = ['packages', 'apps', 'tools'];

async function loadSuite(file: string): Promise<SmokeSuite> {
  const module: unknown = await import(pathToFileURL(file).href);
  const suite = (module as { default?: unknown }).default;
  if (
    typeof suite !== 'object' ||
    suite === null ||
    typeof (suite as SmokeSuite).name !== 'string' ||
    typeof (suite as SmokeSuite).run !== 'function'
  ) {
    throw new Error(`${file} must default-export a suite from defineSuite()`);
  }
  return suite as SmokeSuite;
}

async function main(): Promise<void> {
  const files: string[] = [];
  for (const root of ROOTS) files.push(...(await discover(root, '.smoke.ts')));

  if (files.length === 0) {
    console.log('smoke lane: 0 suites, 0 assertions — nothing to run (green).');
    return;
  }

  const results: SuiteResult[] = [];
  for (const file of files) {
    const label = relative(process.cwd(), file).replaceAll('\\', '/');
    try {
      results.push(await runSuite(await loadSuite(file)));
    } catch (error: unknown) {
      results.push({
        name: label,
        passed: 0,
        failures: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let passed = 0;
  let failedSuites = 0;
  for (const result of results) {
    passed += result.passed;
    const broken = result.failures.length > 0 || result.error !== undefined;
    if (broken) failedSuites += 1;
    console.log(`${broken ? 'FAIL' : 'ok  '}  ${result.name}  (${result.passed} assertions)`);
    for (const failure of result.failures) {
      console.log(
        `        x ${failure.message}${failure.detail === undefined ? '' : ` — ${failure.detail}`}`,
      );
    }
    if (result.error !== undefined) console.log(`        ! suite threw: ${result.error}`);
  }

  console.log(
    `\nsmoke lane: ${results.length} suites, ${passed} assertions passed, ${failedSuites} suites failed.`,
  );
  if (failedSuites > 0) process.exitCode = 1;
}

await main();
