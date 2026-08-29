/**
 * M41 Secrets & Keys (Phase 1) — LIVE staging acceptance (API-level). Proves the read-only admin console is
 * reachable + permission-gated + tenant-isolated + metadata-only, and that the deferred WRITE lifecycle stays
 * fail-closed for a read persona:
 *   - security auditor (security.secret.read) lists secrets / reads detail / versions / reveal history / provider
 *     status -> 200, and every response body is scanned for FORBIDDEN secret-material keys (none may appear);
 *   - restricted actor (no security.*) -> 403 on the list (fail closed, not merely hidden);
 *   - cross-tenant: the auditor (a member of Tenant 1 only) cannot enumerate another tenant's secrets;
 *   - the read persona cannot define / rotate / reveal / destroy a secret -> 403 (Phase-2 writes stay closed).
 * The script performs the logins (LOGIN_PW from env; never printed). Read-only — it creates no data. Run INSIDE
 * the api container. RLS row-level isolation of versions/reveals is proven exhaustively in the m41 DB specs.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const T = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000ff'; // a tenant the auditor is NOT a member of
const PW = process.env.LOGIN_PW;
if (!PW) {
  console.error('LOGIN_PW required.');
  process.exit(2);
}
const AUDITOR_ID = '00000000-0000-4000-8000-000000004101'; // stg_security_auditor identity (seed-security-demo)

// Any of these keys appearing in a response body would be a secret-material leak — Phase 1 must expose NONE.
const FORBIDDEN_KEYS = [
  'value',
  'plaintext',
  'plainText',
  'decrypted',
  'decryptedValue',
  'keyMaterial',
  'material',
  'token',
  'password',
  'credential',
  'privateKey',
  'secret_value',
  'secretValue',
  'ciphertext',
];
function forbiddenHits(obj, path = '') {
  const hits = [];
  if (Array.isArray(obj)) obj.forEach((v, i) => hits.push(...forbiddenHits(v, `${path}[${i}]`)));
  else if (obj && typeof obj === 'object')
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.includes(k)) hits.push(`${path}.${k}`);
      hits.push(...forbiddenHits(v, `${path}.${k}`));
    }
  return hits;
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
  const t = await r.text();
  let d;
  try {
    d = t ? JSON.parse(t) : null;
  } catch {
    d = t;
  }
  return { status: r.status, ok: r.ok, data: d };
}
const arr = (data, key) => (Array.isArray(data) ? data : (data?.[key] ?? []));
const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });

try {
  const AUDITOR = await login('stg_security_auditor');
  const RESTRICTED = await login('stg_restricted');

  // 1) auditor lists secrets -> 200 + data
  const list = await call(AUDITOR, 'GET', '/security/secrets');
  const secrets = arr(list.data, 'secrets');
  check('auditor lists secrets (200)', list.status === 200, `status=${list.status} n=${secrets.length}`);
  check(
    'secret list carries no material fields',
    forbiddenHits(list.data).length === 0,
    forbiddenHits(list.data).join(','),
  );
  const target = secrets.find((s) => s.secretKey === 'staging/webhook-signing') || secrets[0];
  const id = target?.id;
  check('a synthetic secret is present', !!id, `secretKey=${target?.secretKey}`);

  // 2) detail -> 200, metadata only (opaque secretRef; no value)
  const detail = await call(AUDITOR, 'GET', `/security/secrets/${id}`);
  const secretView = detail.data?.secret ?? null;
  check(
    'auditor reads secret detail (200)',
    detail.status === 200 && !!secretView,
    `status=${detail.status}`,
  );
  check(
    'detail exposes only an opaque secretref (secretref: prefix), never a value',
    typeof secretView?.secretRef === 'string' && secretView.secretRef.startsWith('secretref:'),
    `secretRef=${secretView?.secretRef}`,
  );
  check(
    'detail carries no material fields',
    forbiddenHits(detail.data).length === 0,
    forbiddenHits(detail.data).join(','),
  );

  // 3) versions -> 200 (rotation history; opaque provider_ref only)
  const versions = await call(AUDITOR, 'GET', `/security/secrets/${id}/versions`);
  check(
    'auditor reads version history (200, >=1)',
    versions.status === 200 && arr(versions.data, 'versions').length >= 1,
    `status=${versions.status} n=${arr(versions.data, 'versions').length}`,
  );
  check(
    'versions carry no material fields',
    forbiddenHits(versions.data).length === 0,
    forbiddenHits(versions.data).join(','),
  );

  // 4) reveal history -> 200 (maker-checker evidence; approver != requester; no material)
  const reveals = await call(AUDITOR, 'GET', `/security/secrets/${id}/reveals`);
  const revRows = arr(reveals.data, 'reveals');
  check(
    'auditor reads reveal history (200)',
    reveals.status === 200,
    `status=${reveals.status} n=${revRows.length}`,
  );
  check(
    'reveal history shows approver != requester (maker-checker evidence)',
    revRows.some((r) => r.approvedBy && r.requestedBy && r.approvedBy !== r.requestedBy),
    `n=${revRows.length}`,
  );
  check(
    'reveal history carries no material fields',
    forbiddenHits(reveals.data).length === 0,
    forbiddenHits(reveals.data).join(','),
  );

  // 5) provider status -> safe metadata only (available + reasonCode; nothing else)
  const status = await call(AUDITOR, 'GET', `/security/secrets/${id}/provider-status`);
  const keys =
    status.data && typeof status.data === 'object' ? Object.keys(status.data).sort().join(',') : '';
  check(
    'provider status returns safe metadata only {available,reasonCode}',
    status.status === 200 && keys === 'available,reasonCode',
    `status=${status.status} keys=${keys}`,
  );
  check(
    'provider status carries no material fields',
    forbiddenHits(status.data).length === 0,
    forbiddenHits(status.data).join(','),
  );

  // 6) restricted actor -> 403 on the list (fail closed)
  check(
    'restricted (no security.secret.read) cannot list secrets (403)',
    (await call(RESTRICTED, 'GET', '/security/secrets')).status === 403,
    '',
  );

  // 7) cross-tenant: the auditor is a member of Tenant 1 only -> cannot enumerate another tenant's secrets
  const cross = await call(AUDITOR, 'GET', '/security/secrets', undefined, OTHER_TENANT);
  check(
    'cross-tenant: auditor cannot list another tenant’s secrets (not 200 with rows)',
    cross.status !== 200 || arr(cross.data, 'secrets').length === 0,
    `status=${cross.status} n=${arr(cross.data, 'secrets').length}`,
  );

  // 8) Phase-2 WRITE lifecycle stays fail-closed for the read persona (permission guard denies BEFORE any body work)
  check(
    'read persona cannot define a secret (403)',
    (await call(AUDITOR, 'POST', '/security/secrets', { secretKey: 'x', secretRef: 'secretref:x' }))
      .status === 403,
    '',
  );
  check(
    'read persona cannot rotate a secret (403)',
    (await call(AUDITOR, 'POST', `/security/secrets/${id}/rotate`, { version: 1, requestedBy: AUDITOR_ID }))
      .status === 403,
    '',
  );
  check(
    'read persona cannot request a reveal (403)',
    (await call(AUDITOR, 'POST', `/security/secrets/${id}/reveal`, { requestedBy: AUDITOR_ID, purpose: 'x' }))
      .status === 403,
    '',
  );
  check(
    'read persona cannot destroy a secret (403)',
    (await call(AUDITOR, 'POST', `/security/secrets/${id}/destroy`, { version: 1, requestedBy: AUDITOR_ID }))
      .status === 403,
    '',
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(
    JSON.stringify({ ok: passed === results.length, passed, total: results.length, results }, null, 2),
  );
  if (passed !== results.length) process.exit(1);
} catch (e) {
  console.error('m41-security-accept failed:', e.message);
  process.exit(1);
}
