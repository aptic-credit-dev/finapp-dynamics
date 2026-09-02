/**
 * Stage-8 M37 Release Governance (READ-ONLY) — LIVE staging acceptance (API-level). Proves the read-only surface is
 * reachable + permission-gated + tenant-isolated, that it shows genuine backend state, and that it can NEVER mutate,
 * approve, or roll back a release — and introduces no M42 GO/NO_GO verdict and no M22 approval semantics:
 *   • an authorized auditor lists Artifacts / Environments / Releases (backend truth, spread of real states);
 *   • release bodies carry NO verdict/decision field (m37 has no GO/NO_GO — that is m42's);
 *   • a restricted actor (no govrelease perms) is 403 on every read;
 *   • cross-tenant reads are isolated;
 *   • the read persona is 403 on every mutating route (request / artifact-register / approve) — deny-by-default.
 * The script performs the logins (LOGIN_PW from env; never printed). Run INSIDE the api container.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const T = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000ff';
const ART1 = '00000000-0000-4000-8000-000000037101';
const REL1 = '00000000-0000-4000-8000-000000037301';
const PW = process.env.LOGIN_PW;
if (!PW) {
  console.error('LOGIN_PW required.');
  process.exit(2);
}

const jars = new Map();
function sc(login, r) {
  const jar = jars.get(login) || {};
  for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    jar[kv.slice(0, i)] = kv.slice(i + 1);
  }
  jars.set(login, jar);
}
const ckh = (login) =>
  Object.entries(jars.get(login) || {})
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
async function login(loginId) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': T },
    body: JSON.stringify({ loginIdentifier: loginId, password: PW }),
  });
  sc(loginId, r);
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.authenticated) throw new Error(`login ${loginId} failed: ${r.status}`);
  jars.get(loginId).__csrf = b.csrfToken;
  return loginId;
}
async function call(loginId, m, p, body, tenant = T) {
  const jar = jars.get(loginId);
  const h = { 'x-tenant-id': tenant, cookie: ckh(loginId) };
  if (m !== 'GET') {
    h['content-type'] = 'application/json';
    h['x-csrf-token'] = jar.__csrf;
  }
  const r = await fetch(`${BASE}${p}`, {
    method: m,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let d;
  try {
    d = text ? JSON.parse(text) : null;
  } catch {
    d = text;
  }
  return { status: r.status, ok: r.ok, data: d, raw: text };
}
const arr = (data, key) => (Array.isArray(data) ? data : (data?.[key] ?? []));
const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail ?? '' });

try {
  const AUD = await login('stg_release_auditor');
  const RES = await login('stg_developer_restricted'); // no govrelease perms → the restricted actor

  // --- reads (authorized auditor) ---
  const arts = await call(AUD, 'GET', '/releases/artifacts');
  check(
    'auditor lists artifacts (200, includes seeded internal artifact)',
    arts.status === 200 &&
      arr(arts.data, 'artifacts').some((a) => a.id === ART1 && a.artifactKind === 'internal'),
    `status=${arts.status} n=${arr(arts.data, 'artifacts').length}`,
  );
  const envs = await call(AUD, 'GET', '/releases/environments');
  check(
    'auditor lists environments (200, >=2)',
    envs.status === 200 && arr(envs.data, 'environments').length >= 2,
    `n=${arr(envs.data, 'environments').length}`,
  );
  const rels = await call(AUD, 'GET', '/releases');
  const relRows = arr(rels.data, 'releases');
  const states = new Set(relRows.map((r) => r.state));
  check(
    'auditor lists releases (200, includes a released record)',
    rels.status === 200 && relRows.some((r) => r.state === 'released'),
    `status=${rels.status} n=${relRows.length}`,
  );
  check(
    'releases show a spread of real backend states',
    ['released', 'review_pending', 'qa_passed', 'draft'].every((s) => states.has(s)),
    `states=${[...states].join(',')}`,
  );
  // No M42 GO/NO_GO verdict semantics anywhere in the release payloads.
  check(
    'release payloads carry NO GO/NO_GO verdict/decision (m37 has none — that is m42)',
    rels.status === 200 && !/verdict|no_go|"decision"|conditional_go/i.test(rels.raw),
    'scanned releases body',
  );

  // --- restricted actor: no govrelease perms → 403 on every read ---
  check(
    'restricted actor cannot read artifacts (403)',
    (await call(RES, 'GET', '/releases/artifacts')).status === 403,
  );
  check('restricted actor cannot read releases (403)', (await call(RES, 'GET', '/releases')).status === 403);

  // --- cross-tenant isolation ---
  const crossA = await call(AUD, 'GET', '/releases/artifacts', undefined, OTHER_TENANT);
  check(
    'cross-tenant: auditor cannot read another tenant’s artifacts',
    crossA.status !== 200 || arr(crossA.data, 'artifacts').length === 0,
    `status=${crossA.status}`,
  );
  const crossR = await call(AUD, 'GET', '/releases', undefined, OTHER_TENANT);
  check(
    'cross-tenant: auditor cannot read another tenant’s releases',
    crossR.status !== 200 || arr(crossR.data, 'releases').length === 0,
    `status=${crossR.status}`,
  );

  // --- deny-by-default: the READ persona cannot MUTATE (no request / register / approve). Bodies are complete + valid
  // so the request reaches the in-service permission gate (the controller validates the body first, then authorizes). ---
  const reqRel = await call(AUD, 'POST', '/releases', {
    artifactId: ART1,
    environmentId: '00000000-0000-4000-8000-000000037201',
    releaseKey: 'deny-probe-r9',
    toVersion: 9,
  });
  check('read persona cannot request a release (403)', reqRel.status === 403, `status=${reqRel.status}`);
  const regArt = await call(AUD, 'POST', '/releases/artifacts', {
    artifactKey: 'deny-probe',
    artifactKind: 'internal',
    artifactRef: 'internal:deny-probe',
    name: 'Deny Probe',
  });
  check('read persona cannot register an artifact (403)', regArt.status === 403, `status=${regArt.status}`);
  const appr = await call(AUD, 'POST', `/releases/${REL1}/approve`, { expectedVersion: 1 });
  check(
    'read persona cannot approve a release (403 — no approval capability)',
    appr.status === 403,
    `status=${appr.status}`,
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(
    JSON.stringify({ ok: passed === results.length, passed, total: results.length, results }, null, 2),
  );
  if (passed !== results.length) process.exit(1);
} catch (e) {
  console.error('m37-releases-accept failed:', e.message);
  process.exit(1);
}
