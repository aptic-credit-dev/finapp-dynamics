/**
 * Stage-8 staging-only SYNTHETIC Feedback Management demo seed — drives the CANONICAL HTTP API (no direct-SQL
 * state forcing) so every record reaches its state through the real lifecycle + real SoD. NON-PRODUCTION ONLY.
 * Idempotent: tags records with customerRef 'SYN-FB-<n>' and skips creation if already present. No real PII.
 *
 * Personas used (must already exist — see seed-legal-cs-personas.mjs): stg_cso, stg_cs_hod, stg_cs_manager.
 * Distinct SoD: HOD submits resolution; CS Manager (distinct) approves; CSO confirms + closes.
 *
 * Run INSIDE the api container (self-calls http://localhost:3000):
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-feedback-demo.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const TENANT = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const PW = process.env.LOGIN_PW;
if (!PW) {
  console.error('LOGIN_PW required.');
  process.exit(2);
}

const jars = new Map();
function parseCookies(res, login) {
  const jar = jars.get(login) || {};
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    jar[kv.slice(0, i)] = kv.slice(i + 1);
  }
  jars.set(login, jar);
  return jar;
}
const cookieHeader = (login) =>
  Object.entries(jars.get(login) || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

async function login(loginId) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT },
    body: JSON.stringify({ loginIdentifier: loginId, password: PW }),
  });
  parseCookies(res, loginId);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.authenticated) throw new Error(`login ${loginId} failed: ${res.status}`);
  jars.get(loginId).__csrf = body.csrfToken;
  return loginId;
}

async function call(loginId, method, path, body) {
  const jar = jars.get(loginId);
  const headers = { 'x-tenant-id': TENANT, cookie: cookieHeader(loginId) };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['x-csrf-token'] = jar.__csrf;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}
// unwrap {data:...} envelope or raw
const rec = (r) => (r.data && r.data.data ? r.data.data : r.data);
const ver = (r) => Number(rec(r)?.version ?? 1);

const CSO = 'stg_cso',
  HOD = 'stg_cs_hod',
  MGR = 'stg_cs_manager';
const CSO_ID = '00000000-0000-4000-8000-0000000b0100';

async function existing() {
  const r = await call(CSO, 'GET', '/feedback/records');
  const list = rec(r)?.records ?? rec(r) ?? [];
  const refs = new Set(list.map((x) => x.customerRef).filter(Boolean));
  return refs;
}

async function createRecord(n, o) {
  const r = await call(CSO, 'POST', '/feedback/records', {
    customerRef: `SYN-FB-${n}`,
    customerContact: o.contact ?? 'synthetic+' + n + '@example.invalid',
    product: o.product ?? 'Retail Loan',
    branch: o.branch ?? 'HQ Branch',
    department: 'Customer Service',
    channel: o.channel ?? 'branch',
    feedbackType: o.type ?? 'complaint',
    narrative: o.narrative,
  });
  if (!r.ok) throw new Error(`create SYN-FB-${n} -> ${r.status} ${JSON.stringify(r.data)}`);
  return rec(r).id;
}

async function drive(n, o, log) {
  const id = await createRecord(n, o);
  const step = async (label, fn) => {
    const r = await fn();
    log.push({ n, step: label, status: r.status, ok: r.ok, recStatus: rec(r)?.status });
    return r;
  };
  // CSO assigns to self, captures, classifies
  let r = await call(CSO, 'GET', `/feedback/records/${id}`);
  await step('assign', () =>
    call(CSO, 'POST', `/feedback/records/${id}/assign`, {
      expectedVersion: ver(r),
      owner: CSO_ID,
      kind: 'officer',
    }),
  );
  r = await call(CSO, 'GET', `/feedback/records/${id}`);
  await step('capture', () =>
    call(CSO, 'POST', `/feedback/records/${id}/capture`, {
      expectedVersion: ver(r),
      rating: o.rating,
      ratingScale: 5,
      narrative: o.narrative,
      feedbackType: o.type ?? 'complaint',
    }),
  );
  r = await call(CSO, 'GET', `/feedback/records/${id}`);
  await step('classify', () =>
    call(CSO, 'POST', `/feedback/records/${id}/classify`, {
      expectedVersion: ver(r),
      sentiment: o.sentiment,
      severity: o.severity,
    }),
  );

  if (o.stopAfter === 'classify') return id;

  if (o.escalate) {
    await step('escalate', () =>
      call(CSO, 'POST', `/feedback/records/${id}/escalate`, { reason: 'Synthetic escalation to HOD.' }),
    );
  }
  if (o.handoff) {
    await step('case-handoff', () =>
      call(CSO, 'POST', `/feedback/records/${id}/case-handoff`, {
        recommendedCaseType: 'complaint',
        summary: 'Synthetic serious complaint → M13 case handoff.',
      }),
    );
  }
  if (o.stopAfter === 'escalate') return id;

  // HOD submits resolution
  await step('resolution(HOD)', () =>
    call(HOD, 'POST', `/feedback/records/${id}/resolution`, {
      summary: 'Synthetic resolution proposed by HOD.',
      resolutionType: 'goodwill',
      rootCauseCategory: 'process',
      responseCustomerFacing: 'We have reviewed your feedback and applied a goodwill adjustment.',
    }),
  );
  if (o.stopAfter === 'resolution') return id;

  // CS Manager (DISTINCT) approves — SoD
  await step('approve(MGR)', () => call(MGR, 'POST', `/feedback/records/${id}/resolution/approve`, {}));
  if (o.stopAfter === 'approve') return id;

  // CSO records customer confirmation + closes
  r = await call(CSO, 'GET', `/feedback/records/${id}`);
  await step('confirm(CSO)', () =>
    call(CSO, 'POST', `/feedback/records/${id}/confirmation`, {
      expectedVersion: ver(r),
      satisfied: true,
    }),
  );
  r = await call(CSO, 'GET', `/feedback/records/${id}`);
  await step('close(CSO)', () =>
    call(CSO, 'POST', `/feedback/records/${id}/close`, {
      expectedVersion: ver(r),
      waiveCustomerConfirmation: o.waiveClose ? true : false,
    }),
  );
  return id;
}

try {
  await login(CSO);
  await login(HOD);
  await login(MGR);
  const have = await existing();
  const log = [];
  const scenarios = [
    // 1 positive → closed
    {
      n: 1,
      o: {
        narrative: 'The new mobile statement feature is excellent — very easy to use. Thank you!',
        sentiment: 'positive',
        severity: 'low',
        rating: 5,
        type: 'compliment',
        waiveClose: true,
      },
    },
    // 2 negative → awaiting HOD (escalated, no resolution yet)
    {
      n: 2,
      o: {
        narrative: 'I was kept waiting 45 minutes at the branch and no one assisted me.',
        sentiment: 'negative',
        severity: 'high',
        rating: 2,
        escalate: true,
        stopAfter: 'escalate',
      },
    },
    // 3 HOD response → awaiting customer callback (resolution submitted + approved, not yet confirmed)
    {
      n: 3,
      o: {
        narrative: 'My loan statement showed a wrong balance for two days.',
        sentiment: 'negative',
        severity: 'high',
        rating: 2,
        escalate: true,
        stopAfter: 'approve',
      },
    },
    // 4 escalated / high-severity (SLA active)
    {
      n: 4,
      o: {
        narrative: 'Repeated failed debit-order attempts caused penalty charges.',
        sentiment: 'negative',
        severity: 'critical',
        rating: 1,
        escalate: true,
        handoff: true,
        stopAfter: 'escalate',
      },
    },
    // 5 neutral (triaged, open)
    {
      n: 5,
      o: {
        narrative: 'Please add a Swahili option to the USSD menu.',
        sentiment: 'neutral',
        severity: 'low',
        rating: 3,
        stopAfter: 'classify',
      },
    },
    // 6 resolved/closed complaint (full chain w/ SoD + confirmation)
    {
      n: 6,
      o: {
        narrative: 'Double charge on my card for a single ATM withdrawal.',
        sentiment: 'negative',
        severity: 'high',
        rating: 2,
        escalate: true,
      },
    },
  ];
  const results = [];
  for (const s of scenarios) {
    if (have.has(`SYN-FB-${s.n}`)) {
      results.push({ n: s.n, skipped: 'already exists' });
      continue;
    }
    try {
      const id = await drive(s.n, s.o, log);
      results.push({ n: s.n, id });
    } catch (e) {
      results.push({ n: s.n, error: e.message });
    }
  }
  console.log(JSON.stringify({ ok: true, results, steps: log }, null, 2));
} catch (e) {
  console.error('seed-feedback-demo failed:', e.message);
  process.exit(1);
}
