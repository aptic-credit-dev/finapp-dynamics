/**
 * The PURE smoke harness.
 *
 * Framework-free on purpose (docs/07-engineering/TEST_STRATEGY.md): suites run under
 * `node --experimental-strip-types` with nothing installed, so a module's deterministic safety core —
 * state machines, gates, scoring, decision engines — stays testable with no database, no DI container,
 * and no bundler in the way.
 *
 * The harness counts assertions, not just suites, because the baseline is defined as the sum of passing
 * assertions and "a new module must not reduce the baseline".
 */

export interface Assert {
  ok(condition: unknown, message: string): void;
  equal<T>(actual: T, expected: T, message: string): void;
  notEqual<T>(actual: T, expected: T, message: string): void;
  deepEqual<T>(actual: T, expected: T, message: string): void;
  throws(fn: () => unknown, message: string): void;
  rejects(promise: Promise<unknown>, message: string): Promise<void>;
}

export interface SmokeSuite {
  readonly name: string;
  run(t: Assert): void | Promise<void>;
}

export interface AssertionFailure {
  readonly message: string;
  readonly detail?: string;
}

export interface SuiteResult {
  readonly name: string;
  readonly passed: number;
  readonly failures: AssertionFailure[];
  readonly error?: string;
}

/** Declares a suite. The default export of every `*.smoke.ts` file. */
export function defineSuite(name: string, run: (t: Assert) => void | Promise<void>): SmokeSuite {
  return { name, run };
}

function render(value: unknown): string {
  // The cases JSON.stringify answers `undefined` for are handled up front, so the call below really
  // does return a string — which is what its type claims but not what it does.
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    // Circular structures, a throwing toJSON, a BigInt nested somewhere. String(value) here would say
    // "[object Object]", which tells the reader of a failed assertion nothing at all.
    return `[unserialisable ${Object.prototype.toString.call(value)}]`;
  }
}

class Recorder implements Assert {
  passed = 0;
  readonly failures: AssertionFailure[] = [];

  private pass(): void {
    this.passed += 1;
  }

  private fail(message: string, detail?: string): void {
    this.failures.push(detail === undefined ? { message } : { message, detail });
  }

  ok(condition: unknown, message: string): void {
    if (condition) this.pass();
    else this.fail(message, `expected truthy, got ${render(condition)}`);
  }

  equal<T>(actual: T, expected: T, message: string): void {
    if (Object.is(actual, expected)) this.pass();
    else this.fail(message, `expected ${render(expected)}, got ${render(actual)}`);
  }

  notEqual<T>(actual: T, expected: T, message: string): void {
    if (!Object.is(actual, expected)) this.pass();
    else this.fail(message, `expected something other than ${render(expected)}`);
  }

  deepEqual<T>(actual: T, expected: T, message: string): void {
    const a = render(actual);
    const b = render(expected);
    if (a === b) this.pass();
    else this.fail(message, `expected ${b}, got ${a}`);
  }

  throws(fn: () => unknown, message: string): void {
    try {
      fn();
      this.fail(message, 'expected a throw, none happened');
    } catch {
      this.pass();
    }
  }

  async rejects(promise: Promise<unknown>, message: string): Promise<void> {
    try {
      await promise;
      this.fail(message, 'expected a rejection, none happened');
    } catch {
      this.pass();
    }
  }
}

/** Runs one suite. Never throws: a suite that blows up is a reported failure, not a dead run. */
export async function runSuite(suite: SmokeSuite): Promise<SuiteResult> {
  const recorder = new Recorder();
  try {
    await suite.run(recorder);
  } catch (error: unknown) {
    return {
      name: suite.name,
      passed: recorder.passed,
      failures: recorder.failures,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
  return { name: suite.name, passed: recorder.passed, failures: recorder.failures };
}
