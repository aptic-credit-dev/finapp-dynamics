/**
 * Stage-8 M35 Developer Portal — LIVE staging acceptance (API-level). Proves the developer portal is browser-operable
 * for authenticated developers over the CANONICAL m35 service, with every governed boundary intact:
 *   • an authorized developer lists/opens its apps, products, catalog scopes;
 *   • credential metadata is readable and carries ZERO secret material (no hash, ref or value in the body);
 *   • the one-time credential secret is returned exactly ONCE on issue/rotate and is never retrievable afterwards;
 *   • subscriptions are a PRIVILEGED read (subscription.manage) — a self-service developer gets 403;
 *   • maker-checker holds: a distinct approver activates a requested subscription; self-approval is 403 (SoD);
 *   • PUBLIC exposure FAILS CLOSED (approving a public-product subscription is denied — not production-enabled);
 *   • a read-only persona is 403 on every write; cross-tenant reads are isolated.
 * The script performs the logins (LOGIN_PW from env; never printed). Run INSIDE the api container.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const T = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000ff';
const APP1 = '00000000-0000-4000-8000-000000035101';
const P_BILLING = '00000000-0000-4000-8000-000000035201';
const P_PUBLIC = '00000000-0000-4000-8000-000000035202';
const SUB_REQ = '00000000-0000-4000-8000-000000035302';
const SUB_PUBREQ = '00000000-0000-4000-8000-000000035303';
const PW = process.env.LOGIN_PW;
if (!PW) {
  console.error('LOGIN_PW required.');
  process.exit(2);
}
const stamp = `${Date.now()}`;

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
// Forbidden secret-material markers that must NEVER appear in a read body.
const LEAK = /secret_hash|secret_ref|secretRef|secretHash|"secret"|plaintext|dps_[0-9a-f]/i;

try {
  const DEV = await login('stg_developer');
  const ADM = await login('stg_developer_admin');
  const RES = await login('stg_developer_restricted');

  // --- reads (developer) ---
  const apps = await call(DEV, 'GET', '/developer/apps');
  check(
    'developer lists own apps (200, includes seeded app)',
    apps.status === 200 && arr(apps.data, 'apps').some((a) => a.id === APP1),
    `status=${apps.status} n=${arr(apps.data, 'apps').length}`,
  );
  const appDetail = await call(DEV, 'GET', `/developer/apps/${APP1}`);
  check(
    'developer opens application detail (200)',
    appDetail.status === 200 && appDetail.data?.app?.id === APP1,
    `status=${appDetail.status}`,
  );
  const cred = await call(DEV, 'GET', `/developer/apps/${APP1}/credentials`);
  check(
    'credential metadata readable (200, >=1)',
    cred.status === 200 && arr(cred.data, 'credentials').length >= 1,
    `n=${arr(cred.data, 'credentials').length}`,
  );
  check(
    'credential metadata carries ZERO secret material (no hash/ref/value in body)',
    cred.status === 200 && !LEAK.test(cred.raw),
    'scanned response body',
  );
  const prods = await call(DEV, 'GET', '/developer/products');
  check(
    'developer browses the catalog (200, includes billing+public+connector)',
    prods.status === 200 &&
      ['billing-api', 'public-ledger-api', 'partner-sync-api'].every((k) =>
        arr(prods.data, 'products').some((p) => p.productKey === k),
      ),
    `n=${arr(prods.data, 'products').length}`,
  );
  const pdet = await call(DEV, 'GET', `/developer/products/${P_BILLING}`);
  check(
    'developer opens product detail (200, published)',
    pdet.status === 200 && pdet.data?.product?.state === 'published',
  );
  const scopes = await call(DEV, 'GET', `/developer/products/${P_BILLING}/scopes`);
  check(
    'exposed operations carry a 3-segment m02 permission (facade rule)',
    scopes.status === 200 &&
      arr(scopes.data, 'scopes').some((s) => String(s.requiredPermission).split('.').length === 3),
    `n=${arr(scopes.data, 'scopes').length}`,
  );

  // --- writes (developer): register + one-time credential secret + rotate + revoke ---
  const reg = await call(DEV, 'POST', '/developer/apps', {
    appKey: `accept-${stamp}`,
    name: `Acceptance App ${stamp}`,
  });
  const newAppId = reg.data?.id ?? '';
  check('developer registers an app (2xx)', reg.ok && newAppId !== '', `status=${reg.status}`);
  const issue = await call(DEV, 'POST', `/developer/apps/${newAppId}/credentials`, { purpose: 'api' });
  const oneTime = String(issue.data?.secret ?? '');
  const newCredId = issue.data?.credential?.id ?? '';
  check(
    'issuing a credential returns the plaintext secret ONCE (dps_…)',
    issue.ok && oneTime.startsWith('dps_'),
    `status=${issue.status}`,
  );
  const credAfter = await call(DEV, 'GET', `/developer/apps/${newAppId}/credentials`);
  check(
    'the one-time secret is NOT retrievable afterwards (no recovery path)',
    credAfter.status === 200 && !credAfter.raw.includes(oneTime) && !LEAK.test(credAfter.raw),
    'scanned credentials list body',
  );
  const rot = await call(DEV, 'POST', `/developer/credentials/${newCredId}/rotate`);
  check(
    'rotation returns a NEW one-time secret (distinct from the first)',
    rot.ok && String(rot.data?.secret ?? '').startsWith('dps_') && rot.data.secret !== oneTime,
    `status=${rot.status}`,
  );
  const newCred2 = rot.data?.credential?.id ?? '';
  const rev = await call(DEV, 'POST', `/developer/credentials/${newCred2}/revoke`);
  check('developer revokes a credential (2xx)', rev.ok, `status=${rev.status}`);

  // --- subscriptions are PRIVILEGED (subscription.manage) ---
  check(
    'self-service developer CANNOT read subscriptions (403 — privileged)',
    (await call(DEV, 'GET', '/developer/subscriptions')).status === 403,
  );
  const subs = await call(ADM, 'GET', '/developer/subscriptions');
  check(
    'admin reads subscriptions (200, includes seeded)',
    subs.status === 200 && arr(subs.data, 'subscriptions').some((s) => s.id === SUB_REQ),
    `n=${arr(subs.data, 'subscriptions').length}`,
  );

  // maker-checker SUCCESS: SUB_REQ was requested by stg_developer → a DIFFERENT admin approves it.
  const appr = await call(ADM, 'POST', '/developer/subscriptions/approve', { subscriptionId: SUB_REQ });
  check(
    'admin approves a requested subscription (maker-checker, approver != requester)',
    appr.ok || /only a requested subscription/i.test(appr.raw), // tolerate an already-active re-run
    `status=${appr.status}`,
  );

  // PUBLIC exposure FAILS CLOSED: SUB_PUBREQ targets a public product → approval denied (m39 quota unavailable).
  const pub = await call(ADM, 'POST', '/developer/subscriptions/approve', { subscriptionId: SUB_PUBREQ });
  check(
    'approving a PUBLIC-product subscription FAILS CLOSED (public exposure not production-enabled)',
    pub.status !== 200 && /quota|public|forbidden|exposure/i.test(pub.raw),
    `status=${pub.status}`,
  );

  // SoD: admin cannot self-approve its OWN request.
  const sodReg = await call(ADM, 'POST', '/developer/apps', {
    appKey: `accept-sod-${stamp}`,
    name: `SoD App ${stamp}`,
  });
  const sodApp = sodReg.data?.id ?? '';
  const sodReq = await call(ADM, 'POST', '/developer/subscriptions', {
    appId: sodApp,
    productId: P_BILLING,
  });
  const sodSubId = sodReq.data?.id ?? '';
  const selfAppr = await call(ADM, 'POST', '/developer/subscriptions/approve', { subscriptionId: sodSubId });
  check(
    'self-approval is blocked (SoD — approver must differ from requester)',
    selfAppr.status !== 200 && /self_approval|self-approval|forbidden|approver/i.test(selfAppr.raw),
    `status=${selfAppr.status}`,
  );

  // --- restricted persona: reads yes, writes no; subscriptions invisible ---
  check(
    'restricted persona reads the catalog (200)',
    (await call(RES, 'GET', '/developer/products')).status === 200,
  );
  check(
    'restricted persona cannot register an app (403)',
    (await call(RES, 'POST', '/developer/apps', { appKey: `x-${stamp}`, name: 'x' })).status === 403,
  );
  check(
    'restricted persona cannot issue a credential (403)',
    (await call(RES, 'POST', `/developer/apps/${APP1}/credentials`, { purpose: 'api' })).status === 403,
  );
  check(
    'restricted persona cannot read subscriptions (403 — privileged)',
    (await call(RES, 'GET', '/developer/subscriptions')).status === 403,
  );

  // --- cross-tenant isolation ---
  const cross = await call(DEV, 'GET', '/developer/apps', undefined, OTHER_TENANT);
  check(
    'cross-tenant: developer cannot read another tenant’s apps',
    cross.status !== 200 || arr(cross.data, 'apps').length === 0,
    `status=${cross.status}`,
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(
    JSON.stringify({ ok: passed === results.length, passed, total: results.length, results }, null, 2),
  );
  if (passed !== results.length) process.exit(1);
} catch (e) {
  console.error('m35-devportal-accept failed:', e.message);
  process.exit(1);
}
