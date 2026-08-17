/**
 * Stage-7 load/chaos harness SAFETY self-test. Verifies the guards + metric math without needing the API for the
 * pure cases; the timeout case targets a dead loopback port. Exits non-zero on any failure.
 */
import { percentile, summarize, isLoopbackTarget, loadEnabled, runLoad } from './load-harness.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

// production refusal
{
  const save = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  check('production_disabled', loadEnabled() === false);
  let threw = false;
  try {
    await runLoad({ url: 'http://127.0.0.1:3010', concurrency: 1, durationMs: 10 });
  } catch {
    threw = true;
  }
  check('production_refusal_throws', threw);
  process.env.NODE_ENV = save ?? 'staging';
}

// invalid (non-loopback) target refusal
{
  check('rejects_external_target', isLoopbackTarget('http://example.com') === false);
  check('rejects_ip_target', isLoopbackTarget('http://10.0.0.5:3010') === false);
  check('accepts_localhost', isLoopbackTarget('http://localhost:3010') === true);
  check('accepts_loopback_ip', isLoopbackTarget('http://127.0.0.1:3010') === true);
  process.env.NODE_ENV = 'staging';
  let threw = false;
  try {
    await runLoad({ url: 'http://example.com', concurrency: 1, durationMs: 10 });
  } catch {
    threw = true;
  }
  check('external_target_throws', threw);
}

// unsafe config rejection
{
  process.env.NODE_ENV = 'staging';
  let a = false,
    b = false;
  try {
    await runLoad({ url: 'http://127.0.0.1:3010', concurrency: 0, durationMs: 10 });
  } catch {
    a = true;
  }
  try {
    await runLoad({ url: 'http://127.0.0.1:3010', concurrency: 1, durationMs: 0 });
  } catch {
    b = true;
  }
  check('rejects_zero_concurrency', a);
  check('rejects_zero_duration', b);
}

// percentile calculation
{
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  check('percentile_p50', percentile(s, 50) === 5);
  check('percentile_p90', percentile(s, 90) === 9);
  check('percentile_p100', percentile(s, 100) === 10);
  check('percentile_empty_null', percentile([], 95) === null);
}

// metrics calculation
{
  const m = summarize([10, 20, 30, 40], { 200: 3, 500: 1 }, 1000);
  check('summarize_requests', m.requests === 4);
  check('summarize_success', m.success === 3);
  check('summarize_errors', m.errors === 1, `errors=${m.errors}`);
  check('summarize_throughput', m.throughput_rps === 4.0, `rps=${m.throughput_rps}`);
  check('summarize_max', m.max_ms === 40);
}

// timeout handling — dead loopback port; must NOT throw, aborts/errors are counted
{
  process.env.NODE_ENV = 'staging';
  const m = await runLoad({
    url: 'http://127.0.0.1:59999',
    endpoints: ['/api/v1/health'],
    concurrency: 2,
    durationMs: 500,
    timeoutMs: 200,
  });
  check(
    'timeout_no_throw_and_counts',
    m.requests > 0 && m.errors === m.requests,
    `req=${m.requests} err=${m.errors}`,
  );
}

console.log(`LOAD/CHAOS HARNESS SAFETY SELF-TEST — failures=${failed}`);
process.exit(failed > 0 ? 1 : 0);
