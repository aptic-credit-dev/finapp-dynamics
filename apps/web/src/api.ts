// Aptic Dynamics API client. Same-origin (nginx serves the UI and proxies /api to the API), so the session
// cookie flows automatically; writes carry the CSRF token (double-submit) returned by login. This client adds
// NO authorization logic of its own — M02 RBAC on the server is authoritative; the UI only reflects what the
// API allows (a 401/403 is surfaced, never worked around).

const BASE = '/api/v1';

let csrfToken: string | null = null;
export function setCsrf(token: string | null): void {
  csrfToken = token;
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
  if (method !== 'GET' && csrfToken !== null) headers['x-csrf-token'] = csrfToken;
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
export const getBalances = (t?: string | null): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/balances`, { tenantId: t });
export const getGlImports = (t?: string | null): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/gl-imports`, { tenantId: t });
export const getRuns = (t?: string | null): Promise<ApiResult<Row[] | { items?: Row[] }>> =>
  call(`${R}/runs`, { tenantId: t });
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
  ]) {
    if (Array.isArray(d[k])) return d[k] as Row[];
  }
  for (const v of Object.values(d)) if (Array.isArray(v)) return v as Row[];
  return [];
}
