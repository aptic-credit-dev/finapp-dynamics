/**
 * M41 Secrets & Keys (Phase 2) — LIVE staging acceptance (API-level). Proves the privileged lifecycle is browser-
 * operable ONLY under the canonical governance: two distinct human officers (A/B), maker-checker/SoD (approver never
 * self-approves), permission + state gating, optimistic version CAS, tenant isolation, revoke-before-destroy, a reveal
 * that returns NO material, and M03 audit + M06 outbox + requester≠approver evidence. Read-only auditor and restricted
 * actor are blocked. Creates its own throwaway secret through the governed API (no secret material anywhere). The script
 * performs the logins (LOGIN_PW from env; never printed) and reads audit/outbox/review evidence directly from PostgreSQL
 * (superuser DATABASE_URL) by the secret's id. Run INSIDE the api container.
 */
import pg from 'pg';

const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const T = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000ff';
const PW = process.env.LOGIN_PW;
if (!PW) {
  console.error('LOGIN_PW required.');
  process.exit(2);
}
const A_ID = '00000000-0000-4000-8000-000000004201'; // stg_secret_officer_a identity
const B_ID = '00000000-0000-4000-8000-000000004211'; // stg_secret_officer_b identity
const TAG = String(Date.now());
const KEY = `staging/lifecycle-${TAG}`;
const REF = `secretref:staging/lifecycle-${TAG}`;

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
const bodies = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail ?? '' });
const record = (r) => {
  if (r && r.data) bodies.push(r.data);
  return r;
};
// Current optimistic version of a secret (as the officer sees it), for the next CAS-guarded action.
async function curVersion(login, id) {
  const r = await call(login, 'GET', `/security/secrets/${id}`);
  return Number(r.data?.secret?.version);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const dbCount = async (sql, params) => Number((await pool.query(sql, params)).rows[0]?.c ?? 0);
const dbList = async (sql, params) => (await pool.query(sql, params)).rows.map((x) => x.action);

try {
  const A = await login('stg_secret_officer_a');
  const B = await login('stg_secret_officer_b');
  const AUD = await login('stg_security_auditor');
  const RES = await login('stg_restricted');

  // 1) DEFINE (creation; permission security.secret.manage; NOT maker-checker)
  const def = record(
    await call(A, 'POST', '/security/secrets', { secretKey: KEY, secretRef: REF, algorithm: 'aes-256-gcm' }),
  );
  const id = def.data?.id;
  check(
    'officer A defines a secret (200, draft)',
    def.status === 200 && def.data?.state === 'draft',
    `status=${def.status} state=${def.data?.state}`,
  );
  check(
    'define response carries no material',
    forbiddenHits(def.data).length === 0,
    forbiddenHits(def.data).join(','),
  );
  check(
    'auditor (read-only) cannot define (403)',
    (await call(AUD, 'POST', '/security/secrets', { secretKey: KEY + '-x', secretRef: REF + '-x' }))
      .status === 403,
  );
  check(
    'restricted cannot define (403)',
    (await call(RES, 'POST', '/security/secrets', { secretKey: KEY + '-y', secretRef: REF + '-y' }))
      .status === 403,
  );

  // 2) ACTIVATE (maker-checker + stale-version CAS)
  const vDraft = await curVersion(A, id);
  check(
    'stale expectedVersion is rejected (409)',
    (await call(B, 'POST', `/security/secrets/${id}/activate`, { version: 999, requestedBy: A_ID }))
      .status === 409,
    `sent version=999`,
  );
  check(
    'self-approval blocked on activate (approver=requester)',
    (await call(B, 'POST', `/security/secrets/${id}/activate`, { version: vDraft, requestedBy: B_ID }))
      .status === 403,
  );
  check(
    'auditor cannot activate (403)',
    (await call(AUD, 'POST', `/security/secrets/${id}/activate`, { version: vDraft, requestedBy: A_ID }))
      .status === 403,
  );
  const act = record(
    await call(B, 'POST', `/security/secrets/${id}/activate`, { version: vDraft, requestedBy: A_ID }),
  );
  check(
    'officer B activates A’s request (maker-checker, 200 active)',
    act.status === 200 && act.data?.state === 'active',
    `status=${act.status} state=${act.data?.state}`,
  );

  // 3) ROTATE (maker-checker + stale)
  const vActive = await curVersion(A, id);
  check(
    'self-approval blocked on rotate',
    (await call(A, 'POST', `/security/secrets/${id}/rotate`, { version: vActive, requestedBy: A_ID }))
      .status === 403,
  );
  const rot = record(
    await call(A, 'POST', `/security/secrets/${id}/rotate`, { version: vActive, requestedBy: B_ID }),
  );
  check(
    'officer A rotates B’s request (200)',
    rot.status === 200 && rot.data?.state === 'active',
    `status=${rot.status}`,
  );
  check(
    're-using the pre-rotate version conflicts (409)',
    (await call(A, 'POST', `/security/secrets/${id}/rotate`, { version: vActive, requestedBy: B_ID }))
      .status === 409,
  );
  const verList = record(await call(A, 'GET', `/security/secrets/${id}/versions`));
  check(
    'rotation produced a 2nd version',
    arr(verList.data, 'versions').length >= 2,
    `n=${arr(verList.data, 'versions').length}`,
  );

  // 4) REVEAL AUTHORIZATION (maker-checker; NO material)
  check(
    'self-approval blocked on reveal',
    (await call(B, 'POST', `/security/secrets/${id}/reveal`, { requestedBy: B_ID, purpose: 'x' })).status ===
      403,
  );
  check(
    'auditor cannot request reveal (403)',
    (await call(AUD, 'POST', `/security/secrets/${id}/reveal`, { requestedBy: A_ID, purpose: 'x' }))
      .status === 403,
  );
  const rev = record(
    await call(B, 'POST', `/security/secrets/${id}/reveal`, {
      requestedBy: A_ID,
      purpose: 'incident triage (synthetic)',
    }),
  );
  const revId = rev.data?.id;
  check(
    'reveal authorization recorded, returns NO material',
    rev.status === 200 &&
      rev.data?.reasonCode === 'secret_provider_unavailable' &&
      forbiddenHits(rev.data).length === 0,
    `status=${rev.status} reason=${rev.data?.reasonCode}`,
  );
  const revHist = record(await call(A, 'GET', `/security/secrets/${id}/reveals`));
  check(
    'reveal history shows approver != requester',
    arr(revHist.data, 'reveals').some((x) => x.approvedBy && x.requestedBy && x.approvedBy !== x.requestedBy),
  );

  // 5) REVOKE-BEFORE-DESTROY, REVOKE, DESTROY (terminal)
  const vPreRevoke = await curVersion(A, id);
  check(
    'destroy blocked while active (revoke-before-destroy; invalid transition)',
    (await call(B, 'POST', `/security/secrets/${id}/destroy`, { version: vPreRevoke, requestedBy: A_ID }))
      .status === 403,
  );
  const rvk = record(
    await call(A, 'POST', `/security/secrets/${id}/revoke`, { version: vPreRevoke, requestedBy: B_ID }),
  );
  check(
    'officer A revokes B’s request (200 revoked)',
    rvk.status === 200 && rvk.data?.state === 'revoked',
    `status=${rvk.status} state=${rvk.data?.state}`,
  );
  const vRevoked = await curVersion(A, id);
  const dst = record(
    await call(B, 'POST', `/security/secrets/${id}/destroy`, { version: vRevoked, requestedBy: A_ID }),
  );
  check(
    'officer B destroys A’s request (200 destroyed)',
    dst.status === 200 && dst.data?.state === 'destroyed',
    `status=${dst.status} state=${dst.data?.state}`,
  );
  check(
    'destroyed is terminal — further rotate blocked',
    (
      await call(A, 'POST', `/security/secrets/${id}/rotate`, {
        version: await curVersion(A, id),
        requestedBy: B_ID,
      })
    ).status === 403,
  );

  // 6) CROSS-TENANT + RESTRICTED
  const cross = await call(A, 'GET', '/security/secrets', undefined, OTHER_TENANT);
  check(
    'cross-tenant: officer cannot list another tenant’s secrets',
    cross.status !== 200 || arr(cross.data, 'secrets').length === 0,
    `status=${cross.status}`,
  );
  check(
    'restricted cannot rotate (403)',
    (await call(RES, 'POST', `/security/secrets/${id}/rotate`, { version: 1, requestedBy: A_ID })).status ===
      403,
  );

  // 7) EVIDENCE — M03 audit, M06 outbox, requester≠approver (security_review), zero material
  const codes = await dbList(
    `SELECT DISTINCT action FROM audit_events WHERE resource_id=$1 AND action LIKE 'SEC_%' ORDER BY action`,
    [id],
  );
  const expectCodes = [
    'SEC_SECRET_DEFINED',
    'SEC_SECRET_ACTIVATED',
    'SEC_SECRET_ROTATED',
    'SEC_SECRET_REVOKED',
    'SEC_SECRET_DESTROYED',
  ];
  check(
    'M03 audit: lifecycle codes recorded',
    expectCodes.every((c) => codes.includes(c)),
    codes.join(','),
  );
  const revealCodes = await dbCount(
    `SELECT count(*)::int c FROM audit_events WHERE resource_id=$1 AND action LIKE 'SEC_REVEAL%'`,
    [revId],
  );
  check('M03 audit: reveal grant recorded', revealCodes >= 1, `n=${revealCodes}`);
  // The M41 crypto payload keys its record via `recordId` (the outbox's aggregate_id falls back to the eventId), so
  // match on the envelope payload — proves the events landed on the ONE m06 outbox for THIS secret.
  const outbox = await dbCount(
    `SELECT count(*)::int c FROM workflow_event_outbox WHERE family LIKE 'security.%' AND envelope->'payload'->>'recordId' = $1`,
    [id],
  );
  check('M06 outbox: security lifecycle events published (one outbox)', outbox >= 4, `n=${outbox}`);
  const sod = await dbCount(
    `SELECT count(*)::int c FROM security_review WHERE target_id=$1 AND decided_by<>requested_by`,
    [id],
  );
  check('requester != approver evidence (security_review)', sod >= 4, `n=${sod}`);
  const selfReview = await dbCount(
    `SELECT count(*)::int c FROM security_review WHERE target_id=$1 AND decided_by=requested_by`,
    [id],
  );
  check('zero self-approved reviews', selfReview === 0, `n=${selfReview}`);
  const allHits = bodies.flatMap((b) => forbiddenHits(b));
  check('zero secret material across all API responses', allHits.length === 0, allHits.join(','));

  const passed = results.filter((r) => r.pass).length;
  console.log(
    JSON.stringify(
      { ok: passed === results.length, passed, total: results.length, secretId: id, results },
      null,
      2,
    ),
  );
  await pool.end();
  if (passed !== results.length) process.exit(1);
} catch (e) {
  console.error('m41-lifecycle-accept failed:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
