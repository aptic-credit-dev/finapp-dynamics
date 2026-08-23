// Aptic Dynamics API client. Same-origin (nginx serves the UI and proxies /api to the API), so the session
// cookie flows automatically; writes carry the CSRF token (double-submit) returned by login. This client adds
// NO authorization logic of its own — M02 RBAC on the server is authoritative; the UI only reflects what the
// API allows (a 401/403 is surfaced, never worked around).

const BASE = '/api/v1';

let csrfToken: string | null = null;
export function setCsrf(token: string | null): void {
  csrfToken = token;
}
// The server's CSRF guard is double-submit: the `x-csrf-token` header must equal the (non-HttpOnly) finapp_csrf
// cookie. Login returns the token and we keep it in memory, but that is lost on a page reload — so fall back to
// reading the cookie. Without this, the first state-changing request after any reload (including a fresh login
// over a still-present session cookie) fails CSRF even though the cookie is present. Cookie-read only; the
// HttpOnly session cookie is never exposed, so this is not a weakening of the control.
function csrfCookie(): string | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)finapp_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

async function call<T>(
  path: string,
  opts: { method?: string; body?: unknown; tenantId?: string | null } = {},
): Promise<ApiResult<T>> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrfToken ?? csrfCookie();
    if (token !== null) headers['x-csrf-token'] = token;
  }
  if (opts.tenantId) headers['x-tenant-id'] = opts.tenantId;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const msg =
        (parsed as { detail?: string; message?: string } | null)?.detail ??
        (parsed as { message?: string } | null)?.message ??
        `HTTP ${res.status}`;
      return { ok: false, status: res.status, data: null, error: msg };
    }
    return { ok: true, status: res.status, data: parsed as T, error: null };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : 'network error' };
  }
}

// --- auth ---
export interface LoginResult {
  authenticated: boolean;
  csrfToken: string;
}
export async function login(loginIdentifier: string, password: string): Promise<ApiResult<LoginResult>> {
  const r = await call<LoginResult>('/auth/login', { method: 'POST', body: { loginIdentifier, password } });
  if (r.ok && r.data) setCsrf(r.data.csrfToken);
  return r;
}
export async function getSession(): Promise<ApiResult<Record<string, unknown>>> {
  return call<Record<string, unknown>>('/auth/session');
}
export async function logout(): Promise<void> {
  await call('/auth/logout', { method: 'POST' });
  setCsrf(null);
}

// Self-only tenant discovery (ADR-134): the tenants the AUTHENTICATED caller may select. Identity is derived
// server-side from the session — this sends no id and cannot ask on behalf of anyone else.
export interface SelfTenant {
  tenantId: string;
  code: string;
  name: string;
  isPrimary: boolean;
}
export async function getTenants(): Promise<ApiResult<{ tenants: SelfTenant[] }>> {
  return call<{ tenants: SelfTenant[] }>('/auth/tenants');
}

// --- reconciliation (reuses the existing gl-reconciliation API; no duplicate engine) ---
export type Row = Record<string, unknown>;
const R = '/gl-reconciliation';
export const getAccounts = (t?: string | null): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/accounts`, { tenantId: t });
// GL imports and balances are PER-ACCOUNT on the API (they require a glAccountId query param, else 400) — so
// tenant-wide callers must aggregate across accounts (see the Dashboard). Passing the id is mandatory.
export const getGlImports = (
  glAccountId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/gl-imports?glAccountId=${encodeURIComponent(glAccountId)}`, { tenantId: t });
export const getBalances = (
  glAccountId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/balances?glAccountId=${encodeURIComponent(glAccountId)}`, { tenantId: t });
export const getRuns = (t?: string | null): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/runs`, { tenantId: t });
export const getRunSummaries = (
  runId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/runs/${encodeURIComponent(runId)}/summaries`, { tenantId: t });
export const getRunReconcilingItems = (
  runId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/runs/${encodeURIComponent(runId)}/reconciling-items`, { tenantId: t });
export const getRunCertifications = (
  runId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/runs/${encodeURIComponent(runId)}/certifications`, { tenantId: t });
export const getRunMatches = (
  runId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/runs/${encodeURIComponent(runId)}/matches`, { tenantId: t });
export const getRunExceptions = (
  runId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/runs/${encodeURIComponent(runId)}/exceptions`, { tenantId: t });
export const getMatch = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${R}/matches/${encodeURIComponent(id)}`, { tenantId: t });
export const getMatchLines = (id: string, t?: string | null): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/matches/${encodeURIComponent(id)}/lines`, { tenantId: t });

// --- journals (M21) — the reconciliation "Propose adjustment" flow reuses the CANONICAL maker-checker journal
// path. No posting is exposed here: a proposal is created + submitted (PENDING APPROVAL); a separate approver
// authorises posting server-side (M22 SoD). This client never calls a posting endpoint. ---
const J = '/journals';
export interface DraftLineInput {
  direction: 'debit' | 'credit';
  amountMinor: number;
  accountRef?: string;
  description?: string;
}
export const createJournalDraft = (body: unknown, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${J}/drafts`, { method: 'POST', body, tenantId: t });
export const getJournalDraft = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${J}/drafts/${encodeURIComponent(id)}`, { tenantId: t });
export const getJournalDrafts = (t?: string | null): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${J}/drafts`, { tenantId: t });
export const validateJournalDraft = (
  id: string,
  expectedVersion: number,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${J}/drafts/${encodeURIComponent(id)}/validate`, {
    method: 'POST',
    body: { expectedVersion },
    tenantId: t,
  });
export const submitJournalDraft = (
  id: string,
  expectedVersion: number,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${J}/drafts/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
    body: { expectedVersion },
    tenantId: t,
  });

/**
 * Propose a reconciliation adjustment through the canonical M21 flow: create a balanced draft → validate →
 * submit (→ PENDING APPROVAL). Returns the final draft (or the first failing step's error). Never posts.
 */
export async function proposeAdjustment(
  tenant: string | null,
  input: { description: string; entityRef: string; lines: DraftLineInput[] },
): Promise<ApiResult<Row>> {
  const created = await createJournalDraft(
    { sourceType: 'gl_reconciliation', journalDate: new Date().toISOString().slice(0, 10), ...input },
    tenant,
  );
  if (!created.ok || !created.data) return created;
  const id = String((created.data as Row)['id'] ?? '');
  const v1 = Number((created.data as Row)['version'] ?? 1);
  const validated = await validateJournalDraft(id, v1, tenant);
  if (!validated.ok) return validated;
  if (!((validated.data as Row | null)?.['validation'] as Row | undefined)?.['isValid']) {
    return {
      ok: false,
      status: 422,
      data: null,
      error: 'Adjustment did not validate (unbalanced or incomplete).',
    };
  }
  // Re-read the draft to get its current version (validate bumps it), then submit.
  const fresh = await getJournalDraft(id, tenant);
  const v2 = Number((fresh.data as Row | null)?.['version'] ?? v1 + 1);
  return submitJournalDraft(id, v2, tenant);
}

// --- debt recovery (M44 vertical — reuses the existing m17-recovery / m14-legal / m16-litigation APIs; no
// duplicate engine). Read-first; any action stays permission-controlled + audited server-side. ---
const RC = '/recovery';
export const getRecoveries = (
  t?: string | null,
  q?: Record<string, string>,
): Promise<ApiResult<Row[] | { recoveries?: Row[] }>> => {
  const qs = q ? '?' + new URLSearchParams(q).toString() : '';
  return call(`${RC}/recoveries${qs}`, { tenantId: t });
};
export const getRecovery = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${RC}/recoveries/${encodeURIComponent(id)}`, { tenantId: t });
export const getRecoveryAnalytics = (
  dimension: string,
  t?: string | null,
): Promise<ApiResult<{ dimension: string; buckets: Row[] }>> =>
  call(`${RC}/recoveries/analytics/summary?dimension=${encodeURIComponent(dimension)}`, { tenantId: t });
export const getRecoverySub = (
  id: string,
  kind: 'notes' | 'arrangements' | 'demands' | 'enforcement-actions' | 'outcomes' | 'negotiations',
  t?: string | null,
): Promise<ApiResult<Row[] | Record<string, Row[]>>> =>
  call(`${RC}/recoveries/${encodeURIComponent(id)}/${kind}`, { tenantId: t });

/**
 * Normalise the various list envelopes to an array, defensively. The gl-reconciliation API returns
 * domain-keyed envelopes ({accounts:[]}, {imports:[]}, {matches:[]}, {balances:[]}, ...), so after the
 * known keys we fall back to the FIRST array-valued property of the object.
 */
export function asRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data as Row[];
  if (data === null || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  for (const k of [
    'items',
    'rows',
    'data',
    'accounts',
    'imports',
    'runs',
    'matches',
    'exceptions',
    'lines',
    'balances',
    'drafts',
    'recoveries',
    'notes',
    'arrangements',
    'demands',
    'buckets',
  ]) {
    if (Array.isArray(d[k])) return d[k] as Row[];
  }
  for (const v of Object.values(d)) if (Array.isArray(v)) return v as Row[];
  return [];
}
