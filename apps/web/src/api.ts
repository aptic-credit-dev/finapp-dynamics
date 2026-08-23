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

// 6F entitlement self-check (m39): does MY selected tenant have this commercial capability? Gates a
// composition-vertical's AVAILABILITY; M02 RBAC still governs actions inside it. Server-authoritative
// (the SERVER resolves the entitlement, RLS-scoped) — the UI only reflects the answer.
export async function getEntitlement(
  capabilityKey: string,
  t?: string | null,
): Promise<ApiResult<{ capabilityKey: string; entitled: boolean }>> {
  return call(`/saas/entitlements/check?capabilityKey=${encodeURIComponent(capabilityKey)}`, { tenantId: t });
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
// Record a recovery activity note — the canonical write (POST notes, permission recovery.case.update, audited
// as RECOVERY_NOTE_CREATED). Permission-controlled + tenant-scoped server-side; the UI only surfaces the result.
export const recordRecoveryNote = (
  id: string,
  body: { content: string; headline?: string; noteType?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${RC}/recoveries/${encodeURIComponent(id)}/notes`, {
    method: 'POST',
    body: { noteType: 'general', ...body },
    tenantId: t,
  });

// --- regulatory & compliance (M45 vertical) — reuses the CANONICAL m41 GRC control register + append-only
// assessment evidence (/api/v1/grc). No duplicate GRC engine; reads are RLS-scoped + permission-gated; the one
// write (record assessment) goes through the canonical m41 service and is audited. ---
const GRC = '/grc';
export const getGrcControls = (t?: string | null): Promise<ApiResult<Row[] | { controls?: Row[] }>> =>
  call(`${GRC}/controls`, { tenantId: t });
export const getGrcAssessments = (
  controlId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { assessments?: Row[] }>> =>
  call(`${GRC}/controls/${encodeURIComponent(controlId)}/assessments`, { tenantId: t });
// Record a control ASSESSMENT — canonical append-only evidence (status ∈ compliant/non_compliant/partial/
// not_assessed), permission grc.control.manage/assessment, audited. This records control/evidence state; it is
// NOT a regulatory-compliance certification or approval.
export const recordGrcAssessment = (
  controlId: string,
  body: { status: string; reasonCode?: string; evidenceRef?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${GRC}/controls/${encodeURIComponent(controlId)}/assessments`, {
    method: 'POST',
    body,
    tenantId: t,
  });

// --- administration: users & access (reuses the CANONICAL m02 identity / rbac APIs — NO second identity
// engine). Identities + accounts are GLOBAL resources; memberships, roles and assignments are TENANT-scoped
// (RLS, no escape). Every write is a canonical permissioned + audited endpoint; the server is authoritative,
// this client adds no authorization of its own. Lifecycle is modelled as named POST actions (activate /
// suspend / reactivate / close / end / retire / revoke) — there is NO hard delete anywhere in the platform. ---

// SELF effective permissions for the selected tenant (GET /auth/permissions) — used to HIDE actions the actor
// cannot perform. The server still 403s a hidden action if called directly (UI is not the authz source).
export async function getMyPermissions(
  t?: string | null,
): Promise<ApiResult<{ tenantId: string | null; permissions: string[] }>> {
  return call('/auth/permissions', { tenantId: t });
}

// Identities (global registry) — a person, distinct from their login accounts.
export const listIdentities = (t?: string | null): Promise<ApiResult<Row[]>> =>
  call('/identities', { tenantId: t });
export const getIdentity = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`/identities/${encodeURIComponent(id)}`, { tenantId: t });
export const createIdentity = (body: Record<string, unknown>, t?: string | null): Promise<ApiResult<Row>> =>
  call('/identities', { method: 'POST', body, tenantId: t });
export const updateIdentity = (
  id: string,
  body: Record<string, unknown>,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`/identities/${encodeURIComponent(id)}`, { method: 'PATCH', body, tenantId: t });
export type IdentityAction = 'activate' | 'suspend' | 'reactivate' | 'close';
// Lifecycle actions carry `expectedVersion` (optimistic concurrency, mandatory server-side) and an optional
// `reason` (recorded in the audit trail) — there is no delete; disposal is a governed state transition.
export const identityAction = (
  id: string,
  action: IdentityAction,
  expectedVersion: number,
  t?: string | null,
  reason?: string,
): Promise<ApiResult<Row>> =>
  call(`/identities/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: { expectedVersion, ...(reason ? { reason } : {}) },
    tenantId: t,
  });

// Login accounts (global) — a way IN for an identity. Never carries a credential in any response.
export const listLoginAccounts = (identityId: string, t?: string | null): Promise<ApiResult<Row[]>> =>
  call(`/accounts?identityId=${encodeURIComponent(identityId)}`, { tenantId: t });
export const createLoginAccount = (
  body: { identityId: string; accountType: string; loginIdentifier: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call('/accounts', { method: 'POST', body, tenantId: t });
export type AccountAction = 'activate' | 'suspend' | 'reactivate' | 'deactivate';
export const accountAction = (
  id: string,
  action: AccountAction,
  expectedVersion: number,
  t?: string | null,
  reason?: string,
): Promise<ApiResult<Row>> =>
  call(`/accounts/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: { expectedVersion, ...(reason ? { reason } : {}) },
    tenantId: t,
  });

// Tenant memberships (tenant-scoped) — the ONLY part of identity a tenant may see (RLS, no escape).
export const listMemberships = (t?: string | null): Promise<ApiResult<Row[]>> =>
  call('/tenant-memberships', { tenantId: t });
export const createMembership = (
  body: { identityId: string; membershipType: string; accountId?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call('/tenant-memberships', { method: 'POST', body, tenantId: t });
export type MembershipAction = 'activate' | 'suspend' | 'reactivate' | 'end';
export const membershipAction = (
  id: string,
  action: MembershipAction,
  expectedVersion: number,
  t?: string | null,
  reason?: string,
): Promise<ApiResult<Row>> =>
  call(`/tenant-memberships/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: { expectedVersion, ...(reason ? { reason } : {}) },
    tenantId: t,
  });

// Roles (tenant-scoped custom roles; system roles are visible + immutable) and the permission catalogue.
export const listRoles = (t?: string | null): Promise<ApiResult<Row[]>> =>
  call('/rbac/roles', { tenantId: t });
export const getRole = (roleId: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`/rbac/roles/${encodeURIComponent(roleId)}`, { tenantId: t });
export const getRolePermissions = (
  roleId: string,
  t?: string | null,
): Promise<ApiResult<{ permissions: string[] }>> =>
  call(`/rbac/roles/${encodeURIComponent(roleId)}/permissions`, { tenantId: t });
export const createRole = (
  body: { code: string; name: string; description?: string; risk?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call('/rbac/roles', { method: 'POST', body, tenantId: t });
export const changeRolePermissions = (
  roleId: string,
  body: { add?: string[]; remove?: string[] },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`/rbac/roles/${encodeURIComponent(roleId)}/permissions`, { method: 'PATCH', body, tenantId: t });
export type RoleAction = 'activate' | 'suspend' | 'reactivate' | 'retire';
export const roleAction = (
  id: string,
  action: RoleAction,
  expectedVersion: number,
  t?: string | null,
  reason?: string,
): Promise<ApiResult<Row>> =>
  call(`/rbac/roles/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: { expectedVersion, ...(reason ? { reason } : {}) },
    tenantId: t,
  });
export const getPermissionCatalogue = (t?: string | null): Promise<ApiResult<Row[]>> =>
  call('/rbac/permissions', { tenantId: t });

// Role assignments (tenant-scoped) — grant a role to a membership; SoD + grantor-bounded server-side.
export const listAssignments = (t?: string | null, membershipId?: string): Promise<ApiResult<Row[]>> =>
  call(`/rbac/assignments${membershipId ? `?membershipId=${encodeURIComponent(membershipId)}` : ''}`, {
    tenantId: t,
  });
export const grantAssignment = (
  body: { membershipId: string; roleId: string; justification?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call('/rbac/assignments', { method: 'POST', body, tenantId: t });
export type AssignmentAction = 'revoke' | 'suspend' | 'reactivate';
export const assignmentAction = (
  id: string,
  action: AssignmentAction,
  expectedVersion: number,
  t?: string | null,
  reason?: string,
): Promise<ApiResult<Row>> =>
  call(`/rbac/assignments/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: { expectedVersion, ...(reason ? { reason } : {}) },
    tenantId: t,
  });

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
    'controls',
    'assessments',
  ]) {
    if (Array.isArray(d[k])) return d[k] as Row[];
  }
  for (const v of Object.values(d)) if (Array.isArray(v)) return v as Row[];
  return [];
}
