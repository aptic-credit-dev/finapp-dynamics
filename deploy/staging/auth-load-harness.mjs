/**
 * Stage-7 Tier-1 AUTHENTICATED load harness — NON-PRODUCTION. Unlike `load-harness.mjs` (unauthenticated
 * GET/probe only), this performs a real cookie/session login and drives AUTHENTICATED reads and WRITES
 * (create identity), multi-tenant concurrency, and a negative security matrix (401/403 positives), recording
 * observed throughput/latency/status metrics. It computes NO SLO PASS/FAIL — acceptance vs SLO is a human
 * decision (OQ#13); observed values are printed beside the approved thresholds for information only.
 *
 * Auth model (m02): POST /api/v1/auth/login {loginIdentifier,password} -> 200 + Set-Cookie finapp_session/
 * finapp_csrf and body.csrfToken. Reads send the session cookie; writes also send x-csrf-token (double-submit).
 * Tenant context is the x-tenant-id header (validated against a live membership). No bearer token exists.
 *
 * SAFETY: refuses production (NODE_ENV=production); refuses a non-loopback target (localhost/127.0.0.1 only).
 * The password is read from LOGIN_PW and never printed. Writes create ONLY synthetic non-PII machine identities.
 */
import { percentile, summarize, isLoopbackTarget, loadEnabled } from './load-harness.mjs';

export { percentile, summarize, isLoopbackTarget, loadEnabled };

/** Parse an array of Set-Cookie header strings into a { name: value } map (value = up to the first ';'). */
export function parseSetCookie(setCookies) {
  const jar = {};
  for (const line of setCookies ?? []) {
    const first = String(line).split(';', 1)[0];
    const eq = first.indexOf('=');
    if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
  return jar;
}

/** Serialize a cookie jar map into a Cookie request-header value. */
export function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** Log in and return { cookie, csrf }. Throws on non-200 or a missing session cookie. */
export async function login(base, loginIdentifier, password) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginIdentifier, password }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${loginIdentifier}: HTTP ${res.status}`);
  const jar = parseSetCookie(res.headers.getSetCookie());
  if (!jar.finapp_session) throw new Error(`login for ${loginIdentifier} returned no session cookie`);
  const body = await res.json();
  return { cookie: cookieHeader(jar), csrf: body.csrfToken };
}

function validateConfig(cfg) {
  if (!loadEnabled()) throw new Error('auth load harness refuses to run under NODE_ENV=production');
  if (!isLoopbackTarget(cfg.url)) throw new Error(`non-loopback target refused: ${cfg.url}`);
  if (!(cfg.concurrency > 0) || !(cfg.durationMs > 0))
    throw new Error('concurrency and durationMs must be > 0');
}

let writeSeq = 0;

/**
 * Run `concurrency` authenticated workers for `durationMs`. `mode` is 'read' | 'write' | 'mixed'. Returns
 * observed metrics (no PASS/FAIL). Writes create synthetic non-PII machine identities (unique display names).
 */
export async function runAuthLoad(cfg) {
  validateConfig(cfg);
  const {
    url,
    cookie,
    csrf,
    mode = 'read',
    readPath = '/api/v1/identities',
    writePath = '/api/v1/identities',
    writeType,
    concurrency,
    durationMs,
    tenants = [],
    timeoutMs = 5000,
  } = cfg;
  if ((mode === 'write' || mode === 'mixed') && !writeType)
    throw new Error('writeType is required for write/mixed mode');

  const latencies = [];
  const statusCounts = {};
  const deadline = Date.now() + durationMs;
  const bump = (s) => (statusCounts[s] = (statusCounts[s] ?? 0) + 1);

  async function doRead(n) {
    const headers = { cookie };
    if (tenants.length) headers['x-tenant-id'] = tenants[n % tenants.length];
    return fetch(`${url}${readPath}`, { headers });
  }
  async function doWrite() {
    writeSeq += 1;
    const headers = { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
    const body = JSON.stringify({
      identityType: writeType,
      displayName: `stg-load-${process.pid}-${writeSeq}`,
    });
    return fetch(`${url}${writePath}`, { method: 'POST', headers, body });
  }

  async function worker() {
    let n = 0;
    while (Date.now() < deadline) {
      const write = mode === 'write' || (mode === 'mixed' && n % 2 === 1);
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), timeoutMs);
      const t0 = performance.now();
      try {
        const r = write ? await doWrite() : await doRead(n);
        bump(r.status);
      } catch {
        bump('error');
      } finally {
        clearTimeout(to);
        latencies.push(performance.now() - t0);
      }
      n += 1;
    }
    return n;
  }

  const start = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return summarize(latencies, statusCounts, Date.now() - start);
}

/**
 * A negative-authz matrix: each entry asserts the server DENIES correctly (401 unauthenticated, 403 on
 * missing CSRF / insufficient permission). Returns [{ check, expected, got, pass }].
 */
export async function securityMatrix(base, admin, unprivCookie, writeType) {
  const out = [];
  const record = async (check, expected, run) => {
    let got;
    try {
      got = (await run()).status;
    } catch {
      got = 'error';
    }
    out.push({ check, expected, got, pass: got === expected });
  };

  await record('unauthenticated_read_denied', 401, () => fetch(`${base}/api/v1/identities`));
  await record('write_without_csrf_denied', 403, () =>
    fetch(`${base}/api/v1/identities`, {
      method: 'POST',
      headers: { cookie: admin.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ identityType: writeType, displayName: 'stg-neg-nocsrf' }),
    }),
  );
  await record('unprivileged_write_denied', 403, () =>
    fetch(`${base}/api/v1/identities`, {
      method: 'POST',
      headers: {
        cookie: unprivCookie,
        'x-csrf-token': 'irrelevant-will-be-checked-after-authz-or-csrf',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ identityType: writeType, displayName: 'stg-neg-unpriv' }),
    }),
  );
  return out;
}

// --- CLI --- (path-anchored so a bare import never triggers the CLI)
const entry = process.argv[1] ?? '';
if (entry.endsWith('/auth-load-harness.mjs') || entry.endsWith('\\auth-load-harness.mjs')) {
  const url = process.env.LOAD_TARGET_URL ?? 'http://127.0.0.1:3000';
  const password = process.env.LOGIN_PW;
  const adminLogin = process.env.ADMIN_LOGIN ?? 'stg_admin_login';
  const unprivLogin = process.env.UNPRIV_LOGIN ?? 'stg_user_login';
  const writeType = process.env.WRITE_IDENTITY_TYPE;
  const tenants = (process.env.TENANT_IDS ?? '').split(',').filter(Boolean);
  if (!password) {
    console.error('LOGIN_PW env var is required (never printed).');
    process.exit(2);
  }
  if (!writeType) {
    console.error('WRITE_IDENTITY_TYPE env var is required (a non-human identity type code).');
    process.exit(2);
  }

  const admin = await login(url, adminLogin, password);
  const unpriv = await login(url, unprivLogin, password);
  console.log(`[auth] logged in admin + unprivileged (session cookies acquired; password not shown)`);

  const scenarios = [
    { name: 'auth_read', mode: 'read', concurrency: 12, durationMs: 4000 },
    { name: 'auth_write', mode: 'write', concurrency: 8, durationMs: 4000 },
    { name: 'auth_mixed', mode: 'mixed', concurrency: 12, durationMs: 4000 },
    { name: 'auth_write_burst', mode: 'write', concurrency: 32, durationMs: 2000 },
    { name: 'multi_tenant_read', mode: 'read', concurrency: 12, durationMs: 3000, tenants },
  ];
  const out = {};
  for (const s of scenarios) {
    out[s.name] = await runAuthLoad({
      url,
      cookie: admin.cookie,
      csrf: admin.csrf,
      writeType,
      ...s,
    });
    console.log(`[authload:${s.name}] ${JSON.stringify(out[s.name])}`);
  }

  const matrix = await securityMatrix(url, admin, unpriv.cookie, writeType);
  for (const m of matrix)
    console.log(`[authsec:${m.check}] expected=${m.expected} got=${m.got} pass=${m.pass}`);

  // Observed vs approved SLO (OQ#13) — INFORMATIONAL ONLY, not an acceptance.
  const slo = { p95_ms: 200, p99_ms: 500, error_rate_pct: 0.5 };
  const infos = Object.entries(out).map(([name, r]) => ({
    scenario: name,
    p95_ms: r.p95_ms,
    p99_ms: r.p99_ms,
    error_rate_pct: r.requests ? Number((((r.errors ?? 0) / r.requests) * 100).toFixed(3)) : null,
  }));
  console.log(`[authload:slo_reference] ${JSON.stringify({ approved_slo: slo, observed: infos })}`);
  console.log(
    `TIER-1 AUTHENTICATED LOAD EXECUTION — NON-PRODUCTION — NOT OPERATIONAL ACCEPTANCE. ACCEPTANCE AGAINST SLO (OQ#13) IS A HUMAN COO/OPS DECISION.`,
  );
}
