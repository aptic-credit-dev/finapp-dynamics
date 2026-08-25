/**
 * Stage-8 staging-only SYNTHETIC M32 analytics demo seed — drives the CANONICAL analytics API to create a governed
 * FEEDBACK dataset + metrics, publish them through the real maker-checker SoD (author ≠ publisher), and materialize
 * REAL feedback aggregates through the m12 governed read seam. NON-PRODUCTION ONLY. Idempotent-ish (skips create if a
 * published metric key already exists; always re-materializes). No fabricated numbers — the counts come from m12.
 *
 * Personas (must exist — seed-legal-cs-personas.mjs): stg_report_author (author + dataset.manage + feedback.analytics.read),
 * stg_report_reviewer (metric.publish, DISTINCT approver).
 *
 * Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-analytics-demo.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const T = 'ac1fd32d-0929-4729-9b50-b57ec5b5286b';
const PW = process.env.LOGIN_PW;
if (!PW) {
  console.error('LOGIN_PW required.');
  process.exit(2);
}

function client() {
  const jar = {};
  const setck = (r) => {
    for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
  };
  const ck = () =>
    Object.entries(jar)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  return {
    async login(id) {
      const r = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': T },
        body: JSON.stringify({ loginIdentifier: id, password: PW }),
      });
      setck(r);
      const b = await r.json().catch(() => ({}));
      if (!b.authenticated) throw new Error(`login ${id} failed ${r.status}`);
      jar.__csrf = b.csrfToken;
    },
    async call(method, path, body, extraHeaders = {}) {
      const h = { 'x-tenant-id': T, cookie: ck(), ...extraHeaders };
      if (method !== 'GET') {
        h['content-type'] = 'application/json';
        h['x-csrf-token'] = jar.__csrf;
      }
      const r = await fetch(`${BASE}${path}`, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
      });
      const txt = await r.text();
      let data;
      try {
        data = txt ? JSON.parse(txt) : null;
      } catch {
        data = txt;
      }
      return { ok: r.ok, status: r.status, data };
    },
  };
}
const rec = (r) => (r.data && r.data.data ? r.data.data : r.data);

const DATASET_KEY = 'm12_feedback_records';
const DIMS = ['sentiment', 'severity', 'status'];

try {
  const author = client();
  const reviewer = client();
  await author.login('stg_report_author');
  await reviewer.login('stg_report_reviewer');

  const log = [];

  // 1. Dataset (idempotent via idempotency-key)
  let ds = null;
  const existingDs = rec(await author.call('GET', '/analytics/datasets'));
  const dsList = existingDs?.datasets ?? [];
  ds = dsList.find((d) => d.datasetKey === DATASET_KEY) ?? null;
  if (!ds) {
    const r = await author.call(
      'POST',
      '/analytics/datasets',
      {
        sourceModule: 'm12-feedback',
        datasetKey: DATASET_KEY,
        name: 'Feedback records (m12)',
        classification: 'internal',
        dimensions: ['product', 'branch', 'department', 'sentiment', 'severity', 'category', 'status'],
        measures: ['count'],
      },
      { 'idempotency-key': `an-ds-${DATASET_KEY}` },
    );
    if (!r.ok) throw new Error(`defineDataset -> ${r.status} ${JSON.stringify(r.data)}`);
    ds = rec(r);
  }
  log.push({ step: 'dataset', id: ds.id, key: ds.datasetKey, source: ds.sourceModule });

  // 2. Metrics: one per dimension, full author→validate→review→publish(SoD)→materialize
  const publishedMetrics = rec(await author.call('GET', '/analytics/metrics'))?.metrics ?? [];
  for (const dim of DIMS) {
    const metricKey = `feedback.records.by_${dim}`;
    let m = publishedMetrics.find((x) => x.metricKey === metricKey) ?? null;
    if (!m) {
      // author defines
      let r = await author.call(
        'POST',
        '/analytics/metrics',
        {
          datasetId: ds.id,
          metricKey,
          name: `Feedback records by ${dim}`,
          aggregation: 'count',
          measureKey: 'count',
          valueKind: 'count',
          dimensions: [dim],
        },
        { 'idempotency-key': `an-m-${metricKey}` },
      );
      if (!r.ok) throw new Error(`defineMetric ${metricKey} -> ${r.status} ${JSON.stringify(r.data)}`);
      m = rec(r);
      // validate
      r = await author.call('POST', `/analytics/metrics/${m.id}/validate`, { expectedVersion: m.version });
      log.push({ step: 'validate', metricKey, status: r.status, passed: rec(r)?.passed });
      // re-read version
      m = rec(await author.call('GET', `/analytics/metrics/${m.id}`));
      // request review
      r = await author.call('POST', `/analytics/metrics/${m.id}/review`, { expectedVersion: m.version });
      m = rec(r);
      // publish by DISTINCT reviewer (SoD)
      r = await reviewer.call('POST', `/analytics/metrics/${m.id}/publish`, { expectedVersion: m.version });
      log.push({ step: 'publish(SoD reviewer)', metricKey, status: r.status, state: rec(r)?.state });
      if (!r.ok) throw new Error(`publish ${metricKey} -> ${r.status} ${JSON.stringify(r.data)}`);
      m = rec(r);
    }
    // materialize REAL feedback aggregates (author holds dataset.manage + feedback.analytics.read)
    const mat = await author.call('POST', `/analytics/metrics/${m.id}/materialize`, { metricId: m.id });
    log.push({
      step: 'materialize(real m12 seam)',
      metricKey,
      status: mat.status,
      rowCount: rec(mat)?.rowCount,
      generation: rec(mat)?.generation,
    });
    // run the query as the author to confirm real rows come back
    const q = await author.call('POST', '/analytics/query', { metricKey });
    log.push({
      step: 'query',
      metricKey,
      status: q.status,
      rows: (rec(q)?.rows ?? []).map((x) => `${x.dimensionValue}=${x.measure}`),
    });
  }

  console.log(JSON.stringify({ ok: true, dataset: ds.datasetKey, steps: log }, null, 2));
} catch (e) {
  console.error('seed-analytics-demo failed:', e.message);
  process.exit(1);
}
