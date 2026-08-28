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
const AUTHOR_ID = '00000000-0000-4000-8000-000000100100'; // saas_plan_author (base 10, k1)
const PUBLISHER_ID = '00000000-0000-4000-8000-000000100200'; // saas_plan_publisher (base 10, k2)
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
async function call(loginId, m, p, body, extra = {}) {
  const jar = jars.get(loginId);
  const h = { 'x-tenant-id': T, cookie: ckh(loginId), ...extra };
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

  // GET /saas/versions/:id wraps the DTO as { version: <view> }; the OPTIMISTIC-LOCK number is view.version.
  // (An earlier bug read data.version — the whole view object — giving NaN and a silently-failed publish.)
  const readVersion = async (who) => {
    const r = await call(who, 'GET', `/saas/versions/${versionId}`);
    return r.data?.version ?? r.data ?? null;
  };

  // 3) CONVERGE the version to PUBLISHED through the canonical author→publisher maker-checker. Idempotent across
  //    every rerun state (draft / validated / published). NEVER proceed to a subscription unless PUBLISHED — and
  //    NEVER infer success just because a version already existed. Fail loudly otherwise.
  const entitlements = [];
  let cur = await readVersion(AUTHOR);
  let publishRes = { status: 'reused', ok: true };
  if (String(cur?.state).toLowerCase() !== 'published') {
    // ensure the three entitlements exist on the draft (published versions are immutable — this only runs on draft)
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
    // validate (author) — safe to re-run on a draft; sets validation_passed
    const val = await call(AUTHOR, 'POST', `/saas/versions/${versionId}/validate`);
    if (!val.ok) throw new Error(`validate -> ${val.status} ${JSON.stringify(val.data)}`);
    // publish (PUBLISHER — a DISTINCT identity; requestedBy = AUTHOR => approver≠requester) with the FRESH optlock
    cur = await readVersion(PUBLISHER);
    const ev = Number(cur?.version);
    if (!Number.isInteger(ev)) throw new Error(`could not read version optlock (got ${JSON.stringify(cur)})`);
    publishRes = await call(PUBLISHER, 'POST', `/saas/versions/${versionId}/publish`, {
      version: ev,
      requestedBy: AUTHOR_ID,
    });
    if (!publishRes.ok) throw new Error(`publish -> ${publishRes.status} ${JSON.stringify(publishRes.data)}`);
  }
  // HARD GATE — require PUBLISHED before any subscription. Do NOT weaken the plan_not_published control.
  cur = await readVersion(AUTHOR);
  const versionState = String(cur?.state).toLowerCase();
  if (versionState !== 'published')
    throw new Error(
      `version ${versionId} is ${versionState}, not PUBLISHED — refusing to create a subscription`,
    );

  // 4) subscription (reuse by key) bound to the VERIFIED-published version + activate -> derives entitlements
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
  if (String(sub.state).toLowerCase() !== 'active') {
    const r = await call(SUBMGR, 'POST', `/saas/subscriptions/${sub.id}/activate`, {
      version: Number(sub.version ?? 1),
    });
    if (!r.ok) throw new Error(`activate subscription -> ${r.status} ${JSON.stringify(r.data)}`);
  }

  // 5) read-model data: usage (author), override (approver — maker-checker), billing cycle (subscription mgr)
  //    so the Usage / Overrides / Billing admin tabs render real, governed data.
  const readData = {};
  const OVERRIDE = await login('stg_saas_override_approver');

  // USAGE — provision a quota period, then record a usage event (idempotent via idempotency-key HEADER). A
  // duplicate returns recorded:false (still 200). Then RE-READ /saas/usage and PROVE the row exists (never treat
  // a bare status as success).
  await call(AUTHOR, 'POST', '/saas/quota', {
    capabilityKey: 'treasury_reconciliation',
    meterKey: 'api_calls',
    periodKey: '2026-08',
    limitHard: 1000,
  });
  const usage = await call(
    AUTHOR,
    'POST',
    '/saas/usage',
    { capabilityKey: 'treasury_reconciliation', meterKey: 'api_calls', periodKey: '2026-08', quantity: 5 },
    { 'idempotency-key': 'seed-usage-t1-1' },
  );
  if (!usage.ok) throw new Error(`record usage -> ${usage.status} ${JSON.stringify(usage.data)}`);
  const usageRead = await call(AUTHOR, 'GET', '/saas/usage');
  const usagePresent = arr(usageRead.data, 'usageEvents').some(
    (u) => u.capabilityKey === 'treasury_reconciliation' && u.meterKey === 'api_calls',
  );
  readData.usage = {
    created: usage.data?.recorded === true,
    reused: usage.data?.recorded === false,
    readStatus: usageRead.status,
    present: usagePresent,
  };

  // OVERRIDE — apply ONE debt_recovery override (append-only). Idempotent: skip if present. Approver passes the
  // AUTHOR as requestedBy (approver≠requester). Then RE-READ /saas/overrides and prove presence.
  const findOv = async () =>
    arr((await call(OVERRIDE, 'GET', '/saas/overrides')).data, 'overrides').find(
      (o) => o.capabilityKey === 'debt_recovery',
    );
  let ovRow = await findOv();
  if (!ovRow) {
    const ov = await call(OVERRIDE, 'POST', '/saas/overrides', {
      targetKind: 'entitlement',
      capabilityKey: 'debt_recovery',
      requestedBy: AUTHOR_ID,
      reasonCode: 'promotional_grant',
      allowance: 'included',
    });
    if (!ov.ok) throw new Error(`apply override -> ${ov.status} ${JSON.stringify(ov.data)}`);
    ovRow = await findOv();
  }
  const overridePresent = !!ovRow && ovRow.approvedBy !== ovRow.requestedBy;
  readData.override = { present: overridePresent, requesterNotApprover: overridePresent };

  // BILLING — open ONE cycle (metadata only; no settlement). UNIQUE (tenant, subscription, cycle_start) —
  // idempotent: skip if a cycle already starts in this window. Then RE-READ and prove presence.
  const findBc = async () =>
    arr(
      (await call(SUBMGR, 'GET', `/saas/subscriptions/${sub.id}/billing-cycles`)).data,
      'billingCycles',
    ).find((c) => String(c.cycleStart).slice(0, 7) === '2026-08');
  let bcRow = await findBc();
  if (!bcRow) {
    const bc = await call(SUBMGR, 'POST', `/saas/subscriptions/${sub.id}/billing-cycles`, {
      cycleStart: '2026-08-01',
      cycleEnd: '2026-08-31',
    });
    if (!bc.ok) throw new Error(`open billing cycle -> ${bc.status} ${JSON.stringify(bc.data)}`);
    bcRow = await findBc();
  }
  const billingPresent = !!bcRow;
  readData.billingCycle = { present: billingPresent, status: bcRow?.status };

  // 6) DETERMINISTIC SELF-CHECK — the seed must establish published version -> active subscription -> effective
  //    entitlement, or FAIL LOUDLY (never report ok on a partial state).
  const checks = {};
  for (const cap of CAPS) {
    const r = await call(SUBMGR, 'GET', `/saas/entitlements/check?capabilityKey=${encodeURIComponent(cap)}`);
    checks[cap] = r.data?.entitled === true;
  }
  const finalSub = arr((await call(SUBMGR, 'GET', '/saas/subscriptions')).data, 'subscriptions').find(
    (s) => s.subscriptionKey === 'sub-growth-t1',
  );
  const subActive = String(finalSub?.state).toLowerCase() === 'active';
  const allEntitled = CAPS.every((c) => checks[c] === true);
  const authorIsDistinct = AUTHOR_ID !== PUBLISHER_ID;
  // Presence of the read-model rows is part of the deterministic check — fail loudly, never on bare status.
  if (
    versionState !== 'published' ||
    !subActive ||
    !allEntitled ||
    !authorIsDistinct ||
    !usagePresent ||
    !overridePresent ||
    !billingPresent
  ) {
    throw new Error(
      `seed self-check failed: versionState=${versionState} subActive=${subActive} entitled=${JSON.stringify(checks)} authorDistinct=${authorIsDistinct} usage=${usagePresent} override=${overridePresent} billing=${billingPresent}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        note: 'staging-only synthetic SaaS: maker-checker published plan + active subscription + entitlements + read-model data',
        plan: { key: 'growth', id: plan.id },
        version: { id: versionId, versionNo: 1, state: versionState.toUpperCase() },
        makerChecker: {
          authorIdentity: AUTHOR_ID,
          publisherIdentity: PUBLISHER_ID,
          authorNotEqualPublisher: authorIsDistinct,
          publish: { status: publishRes.status, ok: publishRes.ok },
        },
        entitlements,
        subscription: { key: 'sub-growth-t1', id: sub.id, state: finalSub?.state },
        effectiveEntitlements: checks,
        readData,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-saas-demo failed:', e.message);
  process.exit(1);
}
