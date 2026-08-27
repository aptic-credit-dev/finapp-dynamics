/**
 * Stage-8 staging-only SYNTHETIC M19 Finance Configuration demo — drives the CANONICAL m19 finance API (as the
 * stg_finance_config_manager persona) to provision the finance master data the Journals (m21) + Reconciliation
 * (m20) selectors point at, so users pick REAL entities/accounts instead of pasting UUIDs. Creates: one accounting
 * entity, USD/KES currencies, the 5 account types, a small coherent chart of accounts (cash/bank/receivables/
 * payables/equity/income/expense/clearing), one fiscal year and one OPEN period. NON-PRODUCTION ONLY. No PII/secrets.
 * Money is never touched here (m19 carries no amounts). Idempotent: every object is looked up by code first and
 * reused; only missing objects are created.
 *
 * Run INSIDE the api container:
 *   docker compose exec -T -e LOGIN_PW api node --input-type=module < deploy/staging/seed-finance-config-demo.mjs
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
// list envelopes are either a bare array or { <key>: [...] }
const arr = (data, key) => (Array.isArray(data) ? data : (data?.[key] ?? []));

// Look up an object by code in a list route; return its row (with id) or null.
async function findByCode(listPath, key, code) {
  const r = await call('GET', listPath);
  return arr(r.data, key).find((x) => x.code === code) ?? null;
}

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', minorUnits: 2, symbol: '$' },
  { code: 'KES', name: 'Kenyan Shilling', minorUnits: 2, symbol: 'KSh' },
];
const TYPES = [
  { code: 'ASSET', name: 'Asset', accountClass: 'asset', normalSide: 'debit' },
  { code: 'LIABILITY', name: 'Liability', accountClass: 'liability', normalSide: 'credit' },
  { code: 'EQUITY', name: 'Equity', accountClass: 'equity', normalSide: 'credit' },
  { code: 'INCOME', name: 'Income', accountClass: 'income', normalSide: 'credit' },
  { code: 'EXPENSE', name: 'Expense', accountClass: 'expense', normalSide: 'debit' },
];
const ACCOUNTS = [
  { code: '1000', name: 'Cash on hand', type: 'ASSET' },
  { code: '1010', name: 'Bank — operating', type: 'ASSET' },
  { code: '1200', name: 'Accounts receivable', type: 'ASSET' },
  { code: '1900', name: 'Suspense / clearing', type: 'ASSET' },
  { code: '2000', name: 'Accounts payable', type: 'LIABILITY' },
  { code: '3000', name: 'Retained earnings', type: 'EQUITY' },
  { code: '4000', name: 'Operating revenue', type: 'INCOME' },
  { code: '5000', name: 'Operating expenses', type: 'EXPENSE' },
];

async function ensure(listPath, key, code, createBody) {
  const existing = await findByCode(listPath, key, code);
  if (existing) return { reused: true, code, id: existing.id, version: existing.version };
  const r = await call('POST', listPath, createBody);
  if (!r.ok) return { error: `${listPath} ${code} -> ${r.status} ${JSON.stringify(r.data)}` };
  return { reused: false, code, id: r.data?.id, version: r.data?.version };
}

try {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': T },
    body: JSON.stringify({ loginIdentifier: 'stg_finance_config_manager', password: PW }),
  });
  sc(lr);
  const lb = await lr.json();
  j.__csrf = lb.csrfToken;
  if (!lb.authenticated) throw new Error('finance_config_manager login failed');

  // 1) entity (functional currency USD)
  const entity = await ensure('/finance/entities', 'entities', 'ACME', {
    code: 'ACME',
    name: 'Acme Financial Ltd (synthetic)',
    functionalCurrencyCode: 'USD',
    description: 'Synthetic staging accounting entity',
  });
  if (entity.error) throw new Error('entity: ' + entity.error);
  const entityId = entity.id;

  // 2) currencies
  const currencies = [];
  for (const c of CURRENCIES) currencies.push(await ensure('/finance/currencies', 'currencies', c.code, c));

  // 3) account types (map code -> id)
  const typeIds = {};
  const types = [];
  for (const t of TYPES) {
    const res = await ensure('/finance/account-types', 'accountTypes', t.code, t);
    types.push(res);
    if (res.id) typeIds[t.code] = res.id;
  }

  // 4) chart of accounts (scoped to the entity)
  const accounts = [];
  for (const a of ACCOUNTS) {
    const accTypeId = typeIds[a.type];
    if (!accTypeId) {
      accounts.push({ code: a.code, error: `missing account type ${a.type}` });
      continue;
    }
    const existing = await findByCode(
      `/finance/accounts?entityId=${encodeURIComponent(entityId)}`,
      'accounts',
      a.code,
    );
    if (existing) {
      accounts.push({ reused: true, code: a.code, id: existing.id, status: existing.status });
      continue;
    }
    const r = await call('POST', '/finance/accounts', {
      entityId,
      accountTypeId: accTypeId,
      code: a.code,
      name: a.name,
      postable: true,
    });
    if (!r.ok) {
      accounts.push({ code: a.code, error: `${r.status} ${JSON.stringify(r.data)}` });
      continue;
    }
    // activate so it is a valid (postable + active) journal target
    let row = r.data;
    if (String(row?.status).toLowerCase() === 'draft') {
      const act = await call('POST', `/finance/accounts/${row.id}/activate`, {
        expectedVersion: Number(row.version ?? 1),
      });
      if (act.ok) row = act.data;
    }
    accounts.push({ reused: false, code: a.code, id: row?.id, status: row?.status });
  }

  // 5) fiscal year + one open period
  let fy = await findByCode(
    `/finance/fiscal-years?entityId=${encodeURIComponent(entityId)}`,
    'fiscalYears',
    'FY2026',
  );
  if (!fy) {
    const r = await call('POST', '/finance/fiscal-years', {
      entityId,
      code: 'FY2026',
      name: 'Fiscal Year 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    fy = r.ok ? r.data : null;
    if (!fy) throw new Error(`fiscal-year -> ${r.status} ${JSON.stringify(r.data)}`);
  }
  const periodsR = await call('GET', `/finance/fiscal-years/${fy.id}/periods`);
  let period = arr(periodsR.data, 'periods').find((p) => Number(p.periodNumber) === 1) ?? null;
  if (!period) {
    const r = await call('POST', `/finance/fiscal-years/${fy.id}/periods`, {
      periodNumber: 1,
      name: 'Jan 2026',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    period = r.ok ? r.data : { error: `${r.status} ${JSON.stringify(r.data)}` };
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        note: 'staging-only synthetic finance master data (entity/currencies/types/CoA/fiscal)',
        entity: { code: 'ACME', id: entityId },
        currencies,
        accountTypes: types,
        accounts,
        fiscalYear: { code: 'FY2026', id: fy.id },
        period: {
          number: period?.periodNumber,
          status: period?.status,
          id: period?.id,
          error: period?.error,
        },
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error('seed-finance-config-demo failed:', e.message);
  process.exit(1);
}
