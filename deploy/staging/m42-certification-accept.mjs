/**
 * M42 Certification Evidence Console (Stage-8, READ-ONLY) — LIVE staging acceptance (API-level). Proves the console's
 * evidence chain + DERIVED decision preview are reachable and permission-gated, tenant-isolated, and that the read
 * persona CANNOT mutate certification state (so the browser can never issue/select a GO). Deny-by-default preserved:
 * the verdict is server-derived; the read persona holds no manage/waiver/signoff/decision permission. Read-only — it
 * creates no data (the synthetic programme is seeded separately, incomplete-by-design → an honest NO_GO). The script
 * performs the logins (LOGIN_PW from env; never printed). Run INSIDE the api container.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const T = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000ff';
const PROGRAMME_ID = '00000000-0000-4000-8000-000000042001';
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
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail ?? '' });
const C = `/platform-certification/programmes/${PROGRAMME_ID}`;

try {
  const AUD = await login('stg_cert_auditor');
  const RES = await login('stg_restricted');

  // Reads — all 200
  const progs = await call(AUD, 'GET', '/platform-certification/programmes');
  check(
    'certifier lists programmes (200)',
    progs.status === 200 && arr(progs.data, 'programmes').some((p) => p.id === PROGRAMME_ID),
    `status=${progs.status} n=${arr(progs.data, 'programmes').length}`,
  );
  check('certifier reads programme detail (200)', (await call(AUD, 'GET', C)).status === 200);
  const asmt = await call(AUD, 'GET', `${C}/assessments`);
  check(
    'assessment matrix readable (200, >=1)',
    asmt.status === 200 && arr(asmt.data, 'assessments').length >= 1,
    `n=${arr(asmt.data, 'assessments').length}`,
  );
  const find = await call(AUD, 'GET', `${C}/findings`);
  check(
    'findings readable (200, includes an open critical)',
    find.status === 200 &&
      arr(find.data, 'findings').some((f) => f.severity === 'critical' && f.status === 'open'),
    `n=${arr(find.data, 'findings').length}`,
  );
  check('waivers readable (200)', (await call(AUD, 'GET', `${C}/waivers`)).status === 200);
  check('readiness readable (200)', (await call(AUD, 'GET', `${C}/readiness`)).status === 200);
  check('sign-offs readable (200)', (await call(AUD, 'GET', `${C}/signoffs`)).status === 200);
  check('closure readable (200, none yet)', (await call(AUD, 'GET', `${C}/closure`)).status === 200);

  // Decision preview — server-derived verdict + blockers; honest NO_GO (evidence incomplete by design)
  const prev = await call(AUD, 'GET', `${C}/decision/preview`);
  const decision = String(prev.data?.decision ?? '');
  const blockers = Array.isArray(prev.data?.blockers) ? prev.data.blockers : [];
  check('decision preview returns 200', prev.status === 200, `status=${prev.status}`);
  check(
    'verdict is server-derived and one of go/conditional_go/no_go',
    ['go', 'conditional_go', 'no_go'].includes(decision),
    `decision=${decision}`,
  );
  check(
    'honest NO_GO with a non-empty blocker list (Stage-7 evidence incomplete)',
    decision === 'no_go' && blockers.length > 0,
    `decision=${decision} blockers=${blockers.length}`,
  );

  // Restricted actor blocked
  check(
    'restricted actor cannot read programmes (403)',
    (await call(RES, 'GET', '/platform-certification/programmes')).status === 403,
  );

  // Cross-tenant isolation
  const cross = await call(AUD, 'GET', '/platform-certification/programmes', undefined, OTHER_TENANT);
  check(
    'cross-tenant: certifier cannot read another tenant’s programmes',
    cross.status !== 200 || arr(cross.data, 'programmes').length === 0,
    `status=${cross.status}`,
  );

  // Deny-by-default: the READ persona cannot mutate — the browser can NEVER issue/select a GO or alter evidence.
  check(
    'read persona cannot open a programme (403)',
    (
      await call(AUD, 'POST', '/platform-certification/programmes', {
        programmeKey: 'x',
        stageKey: 's',
        title: 't',
      })
    ).status === 403,
  );
  check(
    'read persona cannot record an assessment (403)',
    (await call(AUD, 'POST', `${C}/assessments`, { domainKey: 'm30', aspectKey: 'security', status: 'pass' }))
      .status === 403,
  );
  check(
    'read persona cannot issue a decision / GO (403)',
    (await call(AUD, 'POST', `${C}/decision`, { requestedBy: 'x', idempotencyKey: 'k' })).status === 403,
  );
  check(
    'read persona cannot close the stage (403)',
    (
      await call(AUD, 'POST', `${C}/closure`, {
        requestedBy: 'x',
        idempotencyKey: 'k',
        assessedModules: 'm30',
      })
    ).status === 403,
  );
  check(
    'read persona cannot approve a waiver (403)',
    (
      await call(
        AUD,
        'POST',
        '/platform-certification/waivers/00000000-0000-4000-8000-000000042999/approve',
        {
          version: 1,
          validTo: '2027-01-01T00:00:00Z',
        },
      )
    ).status === 403,
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(
    JSON.stringify(
      {
        ok: passed === results.length,
        passed,
        total: results.length,
        previewDecision: decision,
        blockerCount: blockers.length,
        results,
      },
      null,
      2,
    ),
  );
  if (passed !== results.length) process.exit(1);
} catch (e) {
  console.error('m42-certification-accept failed:', e.message);
  process.exit(1);
}
