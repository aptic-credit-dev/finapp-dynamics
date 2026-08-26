/**
 * Stage-8 staging-only SYNTHETIC M28 Executive Copilot demo — drives the CANONICAL copilot query flow so the demo
 * question "What are the main customer feedback issues right now?" is answered by the governed pipeline and GROUNDED
 * in the LIVE m32 Feedback analytics adapter (real published metrics), with citations/provenance. NON-PRODUCTION ONLY.
 * Read-only: the copilot never mutates anything. No fabricated answers — everything comes from the server.
 *
 * Persona: stg_exec_viewer (ai.copilot.read/query/feedback + analytics.metric.read so evidence is not masked).
 *
 * Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-copilot-demo.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const T = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const PW = process.env.LOGIN_PW;
if (!PW) {
  console.error('LOGIN_PW required.');
  process.exit(2);
}
const j = {};
const sc = (r) => {
  for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    j[kv.slice(0, i)] = kv.slice(i + 1);
  }
};
const ck = () =>
  Object.entries(j)
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
async function call(m, p, body) {
  const h = { 'x-tenant-id': T, cookie: ck() };
  if (m !== 'GET') {
    h['content-type'] = 'application/json';
    h['x-csrf-token'] = j.__csrf;
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
  return { ok: r.ok, status: r.status, data: d };
}

try {
  // login as the executive viewer
  const lr = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': T },
    body: JSON.stringify({ loginIdentifier: 'stg_exec_viewer', password: PW }),
  });
  sc(lr);
  const lb = await lr.json();
  j.__csrf = lb.csrfToken;
  if (!lb.authenticated) throw new Error('exec_viewer login failed');

  // 1. session
  const s = await call('POST', '/copilot/sessions', {
    scopeLevel: 'tenant',
    subjectLabel: 'Feedback review',
  });
  if (!s.ok) throw new Error(`session -> ${s.status} ${JSON.stringify(s.data)}`);
  const sessionId = s.data.id;

  // 2. the demo question — executive_question draws the analytics evidence port (real m32 adapter)
  const q = await call('POST', '/copilot/queries', {
    sessionId,
    question: 'What are the main customer feedback issues right now?',
    intentClass: 'executive_question',
    scopeLevel: 'tenant',
  });
  if (!q.ok) throw new Error(`query -> ${q.status} ${JSON.stringify(q.data)}`);
  const query = q.data.query;
  const response = q.data.response;

  // 3. citations (the grounding/provenance)
  const c = await call('GET', `/copilot/queries/${query.id}/citations`);
  const citations = (c.data && c.data.citations) || [];

  console.log(
    JSON.stringify(
      {
        ok: true,
        sessionId,
        query: {
          id: query.id,
          intentClass: query.intentClass,
          status: query.status,
          readOnly: query.readOnly,
          sourceCount: query.sourceCount,
          refusalReasonCode: query.refusalReasonCode,
        },
        response: response && {
          status: response.status,
          confidencePct: (Number(response.confidenceBps ?? 0) / 100).toFixed(1),
          citationCount: response.citationCount,
          citationsRequired: response.citationsRequired,
          reviewRequired: response.reviewRequired,
          reasonCode: response.reasonCode,
        },
        citations: citations.map((x) => ({
          sourceModule: x.sourceModule,
          sourceType: x.sourceType,
          location: x.location,
          recordRef: x.recordRef,
          version: x.documentVersion,
          confidencePct: (Number(x.confidenceBps ?? 0) / 100).toFixed(1),
          entitlement: x.entitlementResult,
        })),
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-copilot-demo failed:', e.message);
  process.exit(1);
}
