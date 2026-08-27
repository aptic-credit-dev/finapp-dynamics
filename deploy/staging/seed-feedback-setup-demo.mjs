/**
 * Stage-8 staging-only SYNTHETIC M12 Feedback SETUP demo — drives the CANONICAL feedback catalog API (as the
 * stg_feedback_config_manager persona) to provision the configuration the operational Feedback Management (FMS)
 * workspace consumes: one active SOURCE SYSTEM (gates ingestion), a set of CATEGORIES (classification options),
 * one active QUESTIONNAIRE (drives capture scoring) and one active SLA POLICY (drives SLA due dates). This is
 * exactly the setup→operational linkage the M12 Setup slice proves. NON-PRODUCTION ONLY. No PII, no secrets.
 *
 * HONEST NOTES:
 *  - The config lifecycle uses a SINGLE `.manage` permission per object (no maker-checker / distinct approver for
 *    setup). One manager drives DRAFT→VALIDATE→PUBLISH→ACTIVATE. This seed reflects that real model.
 *  - Categories are NOT runtime-enforced in classify (classify writes a free-text category), so seeding categories
 *    makes them available to the setup surface but does not (yet) constrain the operational classify step.
 *
 * Idempotent: source/category are upserts; questionnaire/SLA are skipped if an ACTIVE spec of that code exists
 * (discovered via the canonical list routes). Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-feedback-setup-demo.mjs
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
    const [k] = c.split(';');
    const i = k.indexOf('=');
    j[k.slice(0, i)] = k.slice(i + 1);
  }
};
const ck = () =>
  Object.entries(j)
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
async function call(m, p, body, extra = {}) {
  const h = { 'x-tenant-id': T, cookie: ck(), ...extra };
  if (m !== 'GET') {
    h['content-type'] = 'application/json';
    h['x-csrf-token'] = j.__csrf;
  }
  const r = await fetch(`${BASE}${p}`, {
    method: m,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let d;
  try {
    d = txt ? JSON.parse(txt) : null;
  } catch {
    d = txt;
  }
  return { ok: r.ok, status: r.status, data: d };
}
const v = (r) => Number(r.data?.version ?? 1);

// --- config definitions ------------------------------------------------------------------------
const SOURCES = [
  { code: 'mobile_app', name: 'Mobile Banking App' },
  { code: 'branch_desk', name: 'Branch Service Desk' },
];
const CATEGORIES = [
  { code: 'service_quality', name: 'Service quality', defaultSentiment: 'neutral' },
  { code: 'transaction_dispute', name: 'Transaction dispute', defaultSentiment: 'negative' },
  { code: 'staff_conduct', name: 'Staff conduct', defaultSentiment: 'neutral' },
  { code: 'product_feedback', name: 'Product feedback', defaultSentiment: 'positive' },
];
const QUESTIONNAIRE = {
  code: 'csat_v1',
  name: 'Customer Satisfaction (CSAT) v1',
  spec: {
    schemaVersion: 1,
    code: 'csat_v1',
    name: 'Customer Satisfaction (CSAT) v1',
    channel: 'mobile_app',
    language: 'en',
    questions: [
      {
        key: 'overall_rating',
        prompt: 'Overall, how satisfied are you?',
        type: 'rating',
        required: true,
        scale: 5,
        metric: 'csat',
      },
      {
        key: 'resolution_effort',
        prompt: 'How easy was it to get your issue resolved?',
        type: 'rating',
        scale: 5,
        metric: 'effort',
      },
      {
        key: 'primary_reason',
        prompt: 'What best describes your feedback?',
        type: 'single_choice',
        options: ['service_quality', 'transaction_dispute', 'staff_conduct', 'product_feedback'],
      },
      { key: 'comments', prompt: 'Anything else you would like to tell us?', type: 'long_text' },
    ],
  },
};
const SLA = {
  code: 'standard_sla',
  name: 'Standard feedback SLA',
  spec: {
    schemaVersion: 1,
    code: 'standard_sla',
    name: 'Standard feedback SLA',
    ackMinutes: 60,
    assignMinutes: 120,
    responseMinutes: 480,
    resolutionMinutes: 2880,
    closureMinutes: 4320,
    warnThresholdPct: 80,
  },
};

async function activateSpec(kind, def) {
  // kind: 'questionnaires' | 'sla-policies'. Skip if an ACTIVE spec of that code already exists.
  const listPath = kind === 'questionnaires' ? '/feedback/questionnaires' : '/feedback/sla-policies';
  const listKey = kind === 'questionnaires' ? 'questionnaires' : 'slaPolicies';
  const existing = (await call('GET', listPath)).data?.[listKey] ?? [];
  if (existing.some((x) => x.code === def.code && String(x.status).toUpperCase() === 'ACTIVE'))
    return { reused: true, code: def.code };
  let r = await call('POST', `/feedback/${kind}`, { code: def.code, name: def.name, spec: def.spec });
  if (!r.ok) return { error: `${kind} ${def.code} create -> ${r.status} ${JSON.stringify(r.data)}` };
  const id = r.data.id;
  r = await call('POST', `/feedback/${kind}/${id}/validate`, { expectedVersion: v(r) });
  if (!r.ok) return { error: `${kind} ${def.code} validate -> ${r.status} ${JSON.stringify(r.data)}` };
  r = await call('POST', `/feedback/${kind}/${id}/publish`, { expectedVersion: v(r) });
  if (!r.ok) return { error: `${kind} ${def.code} publish -> ${r.status} ${JSON.stringify(r.data)}` };
  r = await call('POST', `/feedback/${kind}/${id}/activate`, { expectedVersion: v(r) });
  if (!r.ok) return { error: `${kind} ${def.code} activate -> ${r.status} ${JSON.stringify(r.data)}` };
  return { reused: false, code: def.code, status: r.data?.status };
}

try {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': T },
    body: JSON.stringify({ loginIdentifier: 'stg_feedback_config_manager', password: PW }),
  });
  sc(lr);
  const lb = await lr.json();
  j.__csrf = lb.csrfToken;
  if (!lb.authenticated) throw new Error('feedback_config_manager login failed');

  const sources = [];
  for (const s of SOURCES) {
    const r = await call('POST', '/feedback/source-systems', { code: s.code, name: s.name, active: true });
    sources.push({ code: s.code, status: r.status, ok: r.ok });
  }
  const categories = [];
  for (const c of CATEGORIES) {
    const r = await call('POST', '/feedback/categories', {
      code: c.code,
      name: c.name,
      defaultSentiment: c.defaultSentiment,
      active: true,
    });
    categories.push({ code: c.code, status: r.status, ok: r.ok });
  }
  const questionnaire = await activateSpec('questionnaires', QUESTIONNAIRE);
  const slaPolicy = await activateSpec('sla-policies', SLA);

  console.log(
    JSON.stringify(
      {
        ok: true,
        note: 'staging-only synthetic feedback SETUP (source/category/questionnaire/SLA)',
        sources,
        categories,
        questionnaire,
        slaPolicy,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-feedback-setup-demo failed:', e.message);
  process.exit(1);
}
