/**
 * Stage-8 staging-only SYNTHETIC M09 Documents demo — drives the CANONICAL documents API to author a retention
 * policy + document types, create synthetic documents (metadata-only), place a legal hold, and link a prior/current
 * lineage. NON-PRODUCTION ONLY. Idempotent (skips catalog already active; documents keyed by idempotency-key + code).
 *
 * BYTES ARE NOT SEEDED: m09 staging storage is framework-only (in-memory double, no object store), so version
 * upload/download move no real bytes. Governance (classification, legal hold, retention/disposition, relationships)
 * is fully real and metadata-only-seedable — that is what this seed exercises. No real files, PII, or secrets.
 *
 * Persona: stg_doc_manager (type/retention manage + document create + legal hold + relationships).
 *
 * Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-documents-demo.mjs
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

const RETENTION = {
  schemaVersion: 1,
  code: 'std',
  name: 'Standard 30-day',
  retentionDays: 30,
  trigger: 'on_activation',
  dispositionAction: 'review',
  reviewRequired: true,
};
const typeSpec = (code, name, cls) => ({
  schemaVersion: 1,
  code,
  name,
  allowedMediaTypes: ['application/pdf'],
  defaultClassification: cls,
  retentionPolicyCode: 'std',
  requiredMetadata: [],
  approvalRequired: false,
  signatureRequired: false,
  scanRequired: true,
});

async function ensureActiveSpec(kind, code, name, spec) {
  // kind: 'retention-policies' | 'types'; skip if an ACTIVE spec of that code already exists
  const listPath = kind === 'types' ? '/documents/types' : '/documents/retention-policies';
  const listKey = kind === 'types' ? 'types' : 'retentionPolicies';
  const existing = (await call('GET', listPath)).data?.[listKey] ?? [];
  if (existing.some((x) => x.code === code && String(x.status).toLowerCase() === 'active'))
    return { reused: true, code };
  let r = await call('POST', `/documents/${kind}`, { code, name, spec });
  if (!r.ok) return { error: `${kind} ${code} -> ${r.status} ${JSON.stringify(r.data)}` };
  const id = r.data.id;
  r = await call('POST', `/documents/${kind}/${id}/validate`, { expectedVersion: v(r) });
  r = await call('POST', `/documents/${kind}/${id}/publish`, { expectedVersion: v(r) });
  r = await call('POST', `/documents/${kind}/${id}/activate`, { expectedVersion: v(r) });
  return { reused: false, code, status: r.data?.status };
}

const DOCS = [
  {
    code: 'DOC-INT-001',
    title: 'Q3 operations summary (internal)',
    type: 'internal_doc',
    mod: 'm04',
    et: 'internal',
  },
  {
    code: 'DOC-LEG-001',
    title: 'Matter engagement letter',
    type: 'legal_doc',
    mod: 'm14',
    et: 'legal_matter',
  },
  {
    code: 'DOC-LIT-001',
    title: 'Litigation filing attachment',
    type: 'legal_doc',
    mod: 'm16',
    et: 'litigation_filing',
  },
  {
    code: 'DOC-FBK-001',
    title: 'Feedback evidence pack',
    type: 'internal_doc',
    mod: 'm12',
    et: 'feedback_record',
  },
  { code: 'DOC-RES-001', title: 'Restricted board memo', type: 'restricted_doc', mod: 'm04', et: 'internal' },
  {
    code: 'DOC-INT-000',
    title: 'Q2 operations summary (superseded)',
    type: 'internal_doc',
    mod: 'm04',
    et: 'internal',
  },
];

try {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': T },
    body: JSON.stringify({ loginIdentifier: 'stg_doc_manager', password: PW }),
  });
  sc(lr);
  const lb = await lr.json();
  j.__csrf = lb.csrfToken;
  if (!lb.authenticated) throw new Error('doc_manager login failed');

  const catalog = [];
  catalog.push(await ensureActiveSpec('retention-policies', 'std', 'Standard 30-day', RETENTION));
  catalog.push(
    await ensureActiveSpec(
      'types',
      'internal_doc',
      'Internal document',
      typeSpec('internal_doc', 'Internal document', 'internal'),
    ),
  );
  catalog.push(
    await ensureActiveSpec(
      'types',
      'legal_doc',
      'Legal document',
      typeSpec('legal_doc', 'Legal document', 'confidential'),
    ),
  );
  catalog.push(
    await ensureActiveSpec(
      'types',
      'restricted_doc',
      'Restricted document',
      typeSpec('restricted_doc', 'Restricted document', 'restricted'),
    ),
  );

  const created = {};
  for (const d of DOCS) {
    const r = await call(
      'POST',
      '/documents/documents',
      { code: d.code, title: d.title, documentType: d.type, originModule: d.mod, originEntityType: d.et },
      { 'idempotency-key': `doc-${d.code}` },
    );
    created[d.code] = { status: r.status, id: r.data?.id, classification: r.data?.classification };
  }

  // legal hold on the restricted memo
  const restricted = created['DOC-RES-001'];
  let hold = null;
  if (restricted?.id) {
    const h = await call('POST', `/documents/documents/${restricted.id}/legal-holds`, {
      reason: 'Synthetic litigation hold — board memo.',
    });
    hold = { status: h.status, holdStatus: h.data?.status };
  }

  // lineage: DOC-INT-000 (prior) superseded_by DOC-INT-001 (current)
  let rel = null;
  if (created['DOC-INT-001']?.id && created['DOC-INT-000']?.id) {
    const r = await call('POST', '/documents/relationships', {
      fromDocumentId: created['DOC-INT-001'].id,
      toDocumentId: created['DOC-INT-000'].id,
      relationshipType: 'supersedes',
    });
    rel = { status: r.status, type: r.data?.relationshipType };
  }

  console.log(JSON.stringify({ ok: true, catalog, created, legalHold: hold, relationship: rel }, null, 2));
} catch (e) {
  console.error('seed-documents-demo failed:', e.message);
  process.exit(1);
}
