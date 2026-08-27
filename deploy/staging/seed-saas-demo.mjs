/**
 * Stage-8 staging-only SYNTHETIC M39 SaaS demo — exercises the REAL plan-version maker-checker and provisions a
 * live entitlement. As the AUTHOR (saas.plan.manage): define plan 'growth' + version 1 + entitlements
 * (treasury_reconciliation / debt_recovery / regulatory_compliance) + validate. As the PUBLISHER
 * (saas.plan.publish, a DISTINCT identity): publish the version passing the AUTHOR as requestedBy — the server
 * enforces approver≠requester (author≠approver SoD). As the SUBSCRIPTION MANAGER: create + activate a
 * subscription, which DERIVES the tenant's effective entitlements from the published version. Result: tenant T1
 * is genuinely entitled to the three verticals via a published plan + active subscription. NON-PRODUCTION ONLY.
 * No PII/secrets. Money is integer minor units. Idempotent (lookup-by-key; skip already-published/active).
 *
 * Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-saas-demo.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const T = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const PW = process.env.LOGIN_PW;
if (!PW) {
  console.error('LOGIN_PW required.');
  process.exit(2);
}
// Deterministic author identity id (persona base 10, k=1, kind id) — mirrors seed-legal-cs-personas uid().
const AUTHOR_ID = '00000000-0000-4000-8000-000000100100';
const CAPS = ['treasury_reconciliation', 'debt_recovery', 'regulatory_compliance'];

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

try {
  const AUTHOR = await login('stg_saas_plan_author');
  const PUBLISHER = await login('stg_saas_plan_publisher');
  const SUBMGR = await login('stg_saas_subscription_manager');

  // 1) plan 'growth' (reuse by key)
  let plan = arr((await call(AUTHOR, 'GET', '/saas/plans')).data, 'plans').find(
    (p) => p.planKey === 'growth',
  );
  if (!plan) {
    const r = await call(AUTHOR, 'POST', '/saas/plans', {
      planKey: 'growth',
      name: 'Growth',
      scope: 'tenant',
    });
    if (!r.ok) throw new Error(`define plan -> ${r.status} ${JSON.stringify(r.data)}`);
    plan = r.data;
  }

  // 2) version 1 (reuse by versionNo)
  let version = arr((await call(AUTHOR, 'GET', `/saas/plans/${plan.id}/versions`)).data, 'versions').find(
    (v) => Number(v.versionNo) === 1,
  );
  if (!version) {
    const r = await call(AUTHOR, 'POST', `/saas/plans/${plan.id}/versions`, {
      versionNo: 1,
      currency: 'USD',
      baseAmountMinor: 4900,
      billingInterval: 'monthly',
    });
    if (!r.ok) throw new Error(`define version -> ${r.status} ${JSON.stringify(r.data)}`);
    version = r.data;
  }
  const versionId = version.id;
  const published = String(version.state).toLowerCase() === 'published';

  // 3) entitlements + validate + publish — only while the version is still a draft
  const entitlements = [];
  let publishRes = { status: 'already-published', ok: true };
  if (!published) {
    const existing = arr(
      (await call(AUTHOR, 'GET', `/saas/versions/${versionId}/entitlements`)).data,
      'entitlements',
    );
    const have = new Set(existing.map((e) => e.capabilityKey));
    for (const cap of CAPS) {
      if (have.has(cap)) {
        entitlements.push({ cap, reused: true });
        continue;
      }
      const r = await call(AUTHOR, 'POST', `/saas/versions/${versionId}/entitlements`, {
        capabilityKey: cap,
        allowance: 'included',
      });
      entitlements.push({ cap, status: r.status, ok: r.ok });
    }
    // validate (author)
    const val = await call(AUTHOR, 'POST', `/saas/versions/${versionId}/validate`);
    if (!val.ok) throw new Error(`validate -> ${val.status} ${JSON.stringify(val.data)}`);
    // publish (PUBLISHER, distinct identity; requestedBy = AUTHOR -> author≠approver)
    const fresh = await call(PUBLISHER, 'GET', `/saas/versions/${versionId}`);
    const ev = Number(fresh.data?.version ?? fresh.data?.planVersion?.version ?? version.version ?? 1);
    publishRes = await call(PUBLISHER, 'POST', `/saas/versions/${versionId}/publish`, {
      version: ev,
      requestedBy: AUTHOR_ID,
    });
  }

  // 4) subscription (reuse by key) + activate -> derives entitlements
  let sub = arr((await call(SUBMGR, 'GET', '/saas/subscriptions')).data, 'subscriptions').find(
    (s) => s.subscriptionKey === 'sub-growth-t1',
  );
  if (!sub) {
    const r = await call(SUBMGR, 'POST', '/saas/subscriptions', {
      subscriptionKey: 'sub-growth-t1',
      planId: plan.id,
      planVersionId: versionId,
    });
    if (!r.ok) throw new Error(`create subscription -> ${r.status} ${JSON.stringify(r.data)}`);
    sub = r.data;
  }
  let activate = { state: sub.state };
  if (String(sub.state).toLowerCase() !== 'active') {
    const r = await call(SUBMGR, 'POST', `/saas/subscriptions/${sub.id}/activate`, {
      version: Number(sub.version ?? 1),
    });
    activate = r.ok ? { state: r.data?.state } : { error: `${r.status} ${JSON.stringify(r.data)}` };
  }

  // 5) prove the tenant is now entitled (self-check, any of the caps)
  const checks = {};
  for (const cap of CAPS) {
    const r = await call(SUBMGR, 'GET', `/saas/entitlements/check?capabilityKey=${encodeURIComponent(cap)}`);
    checks[cap] = r.data?.entitled ?? r.data;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        note: 'staging-only synthetic SaaS plan (maker-checker publish) + active subscription + entitlements',
        plan: { key: 'growth', id: plan.id, state: plan.state },
        version: { id: versionId, versionNo: 1, state: published ? 'published (reused)' : undefined },
        entitlements,
        publish: { status: publishRes.status, ok: publishRes.ok },
        subscription: { key: 'sub-growth-t1', id: sub.id, activate },
        entitlementChecks: checks,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-saas-demo failed:', e.message);
  process.exit(1);
}
