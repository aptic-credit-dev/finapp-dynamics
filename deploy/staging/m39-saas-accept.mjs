/**
 * M39 SaaS — LIVE staging acceptance (API-level). The headline proof is the plan-version PUBLISH maker-checker:
 * an author (saas.plan.manage) authors+validates a fresh version; the author CANNOT publish (no saas.plan.publish
 * -> 403); a publisher passing requestedBy=SELF is REJECTED (approver≠requester SoD); the publisher passing
 * requestedBy=AUTHOR succeeds. Plus: auditor read-only / restricted fail-closed / the seeded subscription entitles
 * the tenant. The script performs the logins (LOGIN_PW from env; never printed). Creates a fresh throwaway plan
 * version each run (append-only; no destructive change). Run INSIDE the api container.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const T = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const PW = process.env.LOGIN_PW;
if (!PW) {
  console.error('LOGIN_PW required.');
  process.exit(2);
}
const AUTHOR_ID = '00000000-0000-4000-8000-000000100100'; // saas_plan_author (base 10, k1)
const PUBLISHER_ID = '00000000-0000-4000-8000-000000100200'; // saas_plan_publisher (base 10, k2)

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
async function call(loginId, m, p, body) {
  const jar = jars.get(loginId);
  const h = { 'x-tenant-id': T, cookie: ckh(loginId) };
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
  const AUTHOR = await login('stg_saas_plan_author');
  const PUBLISHER = await login('stg_saas_plan_publisher');
  const AUDITOR = await login('stg_saas_auditor');
  const RESTRICTED = await login('stg_saas_restricted');

  // Ensure a plan and author a FRESH draft version (next version number).
  let plan = arr((await call(AUTHOR, 'GET', '/saas/plans')).data, 'plans').find(
    (p) => p.planKey === 'accept-test',
  );
  if (!plan) {
    plan = (
      await call(AUTHOR, 'POST', '/saas/plans', {
        planKey: 'accept-test',
        name: 'Acceptance Test',
        scope: 'tenant',
      })
    ).data;
  }
  const versions = arr((await call(AUTHOR, 'GET', `/saas/plans/${plan.id}/versions`)).data, 'versions');
  const nextNo = versions.reduce((m, v) => Math.max(m, Number(v.versionNo) || 0), 0) + 1;
  const defV = await call(AUTHOR, 'POST', `/saas/plans/${plan.id}/versions`, {
    versionNo: nextNo,
    currency: 'USD',
    baseAmountMinor: 1000,
    billingInterval: 'monthly',
  });
  check('author defines a draft version', defV.ok, `status=${defV.status} v${nextNo}`);
  const versionId = defV.data?.id;
  await call(AUTHOR, 'POST', `/saas/versions/${versionId}/entitlements`, {
    capabilityKey: 'treasury_reconciliation',
    allowance: 'included',
  });
  const val = await call(AUTHOR, 'POST', `/saas/versions/${versionId}/validate`);
  check('author validates the version', val.ok, `status=${val.status}`);

  // The OPTIMISTIC-LOCK version: GET /saas/versions/:id wraps the DTO as { version: <view> }; the lock is
  // view.version (NOT the business versionNo). Read it fresh before EACH publish (a preceding call may bump it).
  const evNow = async () => {
    const r = await call(PUBLISHER, 'GET', `/saas/versions/${versionId}`);
    const view = r.data?.version ?? r.data;
    return Number(view?.version);
  };
  const brief = (r) => `status=${r.status} body=${JSON.stringify(r.data)?.slice(0, 160)}`;

  // RBAC: the AUTHOR lacks saas.plan.publish. The request is otherwise fully valid (fresh lock + valid requestedBy),
  // so a 403 proves RBAC — not a malformed request.
  const authorEv = await evNow();
  const authorPub = await call(AUTHOR, 'POST', `/saas/versions/${versionId}/publish`, {
    version: authorEv,
    requestedBy: AUTHOR_ID,
  });
  check(
    'RBAC: author (no saas.plan.publish) cannot publish -> 403',
    authorPub.status === 403,
    brief(authorPub),
  );

  // SoD: the PUBLISHER holds the permission but sets requestedBy = itself -> governance rejection (approver=requester).
  const selfPub = await call(PUBLISHER, 'POST', `/saas/versions/${versionId}/publish`, {
    version: await evNow(),
    requestedBy: PUBLISHER_ID,
  });
  check(
    'SoD: publisher self-approval (approver=requester) rejected',
    !selfPub.ok && selfPub.status !== 200 && String(selfPub.data?.state).toLowerCase() !== 'published',
    brief(selfPub),
  );

  // VALID maker-checker: distinct publisher (≠ requestedBy author) publishes -> PUBLISHED.
  const goodPub = await call(PUBLISHER, 'POST', `/saas/versions/${versionId}/publish`, {
    version: await evNow(),
    requestedBy: AUTHOR_ID,
  });
  const afterView = (await call(PUBLISHER, 'GET', `/saas/versions/${versionId}`)).data?.version;
  check(
    'maker-checker: distinct publisher (author≠approver) publishes -> PUBLISHED',
    goodPub.ok && String(afterView?.state).toLowerCase() === 'published',
    `${brief(goodPub)} finalState=${afterView?.state}`,
  );

  // auditor read-only
  check('auditor reads plans (200)', (await call(AUDITOR, 'GET', '/saas/plans')).status === 200, '');
  check(
    'auditor cannot define a plan (403)',
    (await call(AUDITOR, 'POST', '/saas/plans', { planKey: 'nope', name: 'x' })).status === 403,
    '',
  );
  // restricted fail-closed
  check(
    'restricted cannot read plans (403)',
    (await call(RESTRICTED, 'GET', '/saas/plans')).status === 403,
    '',
  );

  // seeded subscription entitles the tenant (self-check)
  const ent = await call(AUDITOR, 'GET', '/saas/entitlements/check?capabilityKey=treasury_reconciliation');
  check(
    'tenant entitled to treasury_reconciliation (seeded active subscription)',
    ent.data?.entitled === true,
    JSON.stringify(ent.data),
  );

  // --- read models (usage / overrides / billing) RBAC + data (seeded by seed-saas-demo) ---------
  const OVERRIDE = await login('stg_saas_override_approver');
  // usage: auditor (saas.usage.read) reads 200; restricted 403
  const uAud = await call(AUDITOR, 'GET', '/saas/usage');
  check(
    'auditor lists usage (200, saas.usage.read now enforced)',
    uAud.status === 200,
    `status=${uAud.status}`,
  );
  check(
    'usage read returns the seeded event',
    arr(uAud.data, 'usageEvents').some((u) => u.capabilityKey === 'treasury_reconciliation'),
    `n=${arr(uAud.data, 'usageEvents').length}`,
  );
  check(
    'restricted cannot list usage (403)',
    (await call(RESTRICTED, 'GET', '/saas/usage')).status === 403,
    '',
  );
  // overrides: privileged read — auditor (no override.administer) 403; override approver 200 with data
  check(
    'auditor cannot list overrides (403 — privileged, no override.read code)',
    (await call(AUDITOR, 'GET', '/saas/overrides')).status === 403,
    '',
  );
  const ovList = await call(OVERRIDE, 'GET', '/saas/overrides');
  check('override approver lists overrides (200)', ovList.status === 200, `status=${ovList.status}`);
  check(
    'override read shows approver != requester (maker-checker evidence)',
    arr(ovList.data, 'overrides').some(
      (o) => o.approvedBy && o.requestedBy && o.approvedBy !== o.requestedBy,
    ),
    `n=${arr(ovList.data, 'overrides').length}`,
  );
  // billing: auditor (saas.subscription.read) lists the growth subscription's cycles
  const subs = arr((await call(AUDITOR, 'GET', '/saas/subscriptions')).data, 'subscriptions');
  const growth = subs.find((s) => s.subscriptionKey === 'sub-growth-t1');
  const bcList = growth
    ? await call(AUDITOR, 'GET', `/saas/subscriptions/${growth.id}/billing-cycles`)
    : { status: 0, data: null };
  check('auditor lists billing cycles (200)', bcList.status === 200, `status=${bcList.status}`);
  check(
    'billing read shows cycle period metadata (no amount on cycle)',
    arr(bcList.data, 'billingCycles').some((c) => c.cycleStart && c.cycleEnd),
    `n=${arr(bcList.data, 'billingCycles').length}`,
  );
  check(
    'restricted cannot list billing cycles (403)',
    growth
      ? (await call(RESTRICTED, 'GET', `/saas/subscriptions/${growth.id}/billing-cycles`)).status === 403
      : false,
    '',
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(
    JSON.stringify({ ok: passed === results.length, passed, total: results.length, results }, null, 2),
  );
  if (passed !== results.length) process.exit(1);
} catch (e) {
  console.error('m39-saas-accept failed:', e.message);
  process.exit(1);
}
