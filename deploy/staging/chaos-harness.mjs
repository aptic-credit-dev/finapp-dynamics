/**
 * Stage-7 Tier-1 CHAOS harness — NON-PRODUCTION. Controlled, reversible, safe scenarios against a running staging
 * API. NEVER destroys data, touches production, runs an uncontrolled DoS, injects shell, or attacks external
 * providers. Records failure + recovery observations. No SLO PASS/FAIL (acceptance is human/OQ#13).
 *
 * SAFETY: refuses production; refuses a non-loopback target. Scenarios are bounded (short, low absolute volume).
 */
import { runLoad, isLoopbackTarget, loadEnabled } from './load-harness.mjs';

async function health(url, timeoutMs = 3000) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const r = await fetch(`${url}/api/v1/health`, { signal: ac.signal });
    return { ok: r.ok, status: r.status, ms: performance.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - t0, error: e.name };
  } finally {
    clearTimeout(to);
  }
}

/** Poll health until ok (or timeout); returns recovery duration ms (null if never recovered). */
async function awaitRecovery(url, budgetMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const h = await health(url);
    if (h.ok) return Date.now() - start;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

export async function malformedTraffic(url, n = 50) {
  const statuses = {};
  for (let i = 0; i < n; i++) {
    try {
      const r = await fetch(`${url}/api/v1/platform-certification/programmes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ this is : not, valid json ]',
      });
      statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    } catch {
      statuses['error'] = (statuses['error'] ?? 0) + 1;
    }
  }
  const after = await health(url);
  const no5xx = !Object.keys(statuses).some((s) => Number(s) >= 500);
  return { scenario: 'malformed_traffic', statuses, no_5xx: no5xx, health_after_ok: after.ok };
}

export async function burstSpike(url) {
  const before = await health(url);
  const during = await runLoad({ url, endpoints: ['/api/v1/health'], concurrency: 60, durationMs: 2000 });
  const recoveryMs = await awaitRecovery(url);
  const after = await health(url);
  return {
    scenario: 'burst_spike',
    before_health_ms: Number(before.ms.toFixed(1)),
    during_p95_ms: during.p95_ms,
    during_status: during.status,
    recovery_ms: recoveryMs,
    after_health_ok: after.ok,
    after_health_ms: Number(after.ms.toFixed(1)),
  };
}

export async function connectionExhaustion(url) {
  const during = await runLoad({ url, endpoints: ['/api/v1/health'], concurrency: 120, durationMs: 2000 });
  const recoveryMs = await awaitRecovery(url);
  return {
    scenario: 'connection_exhaustion',
    requests: during.requests,
    p99_ms: during.p99_ms,
    max_ms: during.max_ms,
    status: during.status,
    recovery_ms: recoveryMs,
  };
}

export async function dependencyTimeout(url) {
  // Client-side very-short timeout induces aborts; the server must not crash and health recovers.
  const during = await runLoad({
    url,
    endpoints: ['/api/v1/health'],
    concurrency: 20,
    durationMs: 1500,
    timeoutMs: 1,
  });
  const after = await health(url);
  return { scenario: 'dependency_timeout', aborts_or_errors: during.errors, after_health_ok: after.ok };
}

if (process.argv[1]?.endsWith('chaos-harness.mjs')) {
  const url = process.env.LOAD_TARGET_URL ?? 'http://127.0.0.1:3010';
  if (!loadEnabled()) throw new Error('chaos harness refuses production');
  if (!isLoopbackTarget(url)) throw new Error(`non-loopback target refused: ${url}`);
  for (const fn of [malformedTraffic, burstSpike, connectionExhaustion, dependencyTimeout]) {
    const r = await fn(url);
    console.log(`[chaos] ${JSON.stringify(r)}`);
  }
  console.log('TIER-1 AUTOMATED CHAOS EXECUTION — NON-PRODUCTION — NOT OPERATIONAL ACCEPTANCE.');
}
