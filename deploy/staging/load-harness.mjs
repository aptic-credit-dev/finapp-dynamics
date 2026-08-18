/**
 * Stage-7 Tier-1 provider-neutral LOAD harness — NON-PRODUCTION. Drives HTTP endpoints of a running staging API
 * and records observed metrics (throughput, latency percentiles, status distribution). No SLO PASS/FAIL is
 * computed — acceptance vs SLO is human-approved (OQ#13). Pure `fetch`; no vendor monitoring.
 *
 * SAFETY: refuses production (NODE_ENV=production); refuses a non-loopback target (only localhost/127.0.0.1);
 * validates configuration. It only reads/(un)auth-probes endpoints — it performs no privileged mutation.
 */

export function isLoopbackTarget(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

export function loadEnabled(env = process.env) {
  return env.NODE_ENV !== 'production';
}

/** p-th percentile of an ascending-sorted numeric array (nearest-rank). */
export function percentile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sortedAsc[idx];
}

export function summarize(latencies, statusCounts, elapsedMs) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const total = latencies.length;
  const success = Object.entries(statusCounts)
    .filter(([s]) => Number(s) >= 200 && Number(s) < 400)
    .reduce((a, [, c]) => a + c, 0);
  return {
    requests: total,
    success,
    errors: total - success,
    throughput_rps: elapsedMs > 0 ? Number(((total / elapsedMs) * 1000).toFixed(1)) : 0,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
    max_ms: sorted[sorted.length - 1] ?? null,
    status: statusCounts,
  };
}

function validateConfig(cfg) {
  if (!loadEnabled()) throw new Error('load harness refuses to run under NODE_ENV=production');
  if (!isLoopbackTarget(cfg.url)) throw new Error(`non-loopback target refused: ${cfg.url}`);
  if (!(cfg.concurrency > 0) || !(cfg.durationMs > 0))
    throw new Error('concurrency and durationMs must be > 0');
}

/** Run `concurrency` workers hitting the endpoints for `durationMs`. Returns observed metrics (no PASS/FAIL). */
export async function runLoad(cfg) {
  validateConfig(cfg);
  const {
    url,
    endpoints = ['/api/v1/health'],
    concurrency,
    durationMs,
    tenants = [],
    timeoutMs = 5000,
  } = cfg;
  const latencies = [];
  const statusCounts = {};
  const deadline = Date.now() + durationMs;
  const bump = (s) => (statusCounts[s] = (statusCounts[s] ?? 0) + 1);

  async function worker() {
    let n = 0;
    while (Date.now() < deadline) {
      const ep = endpoints[n % endpoints.length];
      const headers = tenants.length ? { 'x-tenant-id': tenants[n % tenants.length] } : {};
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), timeoutMs);
      const t0 = performance.now();
      try {
        const r = await fetch(`${url}${ep}`, { headers, signal: ac.signal });
        bump(r.status);
      } catch {
        bump('error');
      } finally {
        clearTimeout(to);
        latencies.push(performance.now() - t0);
      }
      n++;
    }
    return n;
  }

  const start = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return summarize(latencies, statusCounts, Date.now() - start);
}

// --- CLI --- (path-anchored so importing this module never triggers the CLI, e.g. from auth-load-harness.mjs)
const entry = process.argv[1] ?? '';
if (entry.endsWith('/load-harness.mjs') || entry.endsWith('\\load-harness.mjs')) {
  const url = process.env.LOAD_TARGET_URL ?? 'http://127.0.0.1:3010';
  const scenarios = [
    { name: 'baseline', concurrency: 2, durationMs: 2000 },
    { name: 'ramp', concurrency: 8, durationMs: 3000 },
    { name: 'sustained', concurrency: 12, durationMs: 4000 },
    { name: 'burst', concurrency: 40, durationMs: 2000 },
    { name: 'multi_tenant', concurrency: 12, durationMs: 3000, tenants: ['t-a', 't-b'] },
  ];
  const endpoints = ['/api/v1/health', '/api/v1/platform-certification/programmes'];
  const out = {};
  for (const s of scenarios) {
    out[s.name] = await runLoad({ url, endpoints, ...s });
    console.log(`[load:${s.name}] ${JSON.stringify(out[s.name])}`);
  }
  console.log(
    `TIER-1 AUTOMATED LOAD EXECUTION — NON-PRODUCTION — NOT OPERATIONAL ACCEPTANCE. ACCEPTANCE AGAINST SLO: PENDING OQ#13 / HUMAN-APPROVED SLO TARGETS`,
  );
}
