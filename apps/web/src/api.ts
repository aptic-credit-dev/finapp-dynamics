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

// --- M39 Plans & Subscriptions admin — canonical m39-saas commercial engine, reused (no second SaaS engine).
// Reads are RLS-scoped + permission-gated (saas.plan.read / saas.subscription.read); subscription lifecycle is
// permission-gated + audited, carries the mandatory version (optimistic concurrency), and has NO hard delete —
// a subscription suspends / cancels (governed transitions), commercial history is preserved. Published plan
// versions are immutable (DB trigger). Money is minor units as text (never a float). ---
const SA = '/saas';
export const getSaasPlans = (t?: string | null): Promise<ApiResult<{ plans: Row[] }>> =>
  call(`${SA}/plans`, { tenantId: t });
export const getSaasPlan = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${SA}/plans/${encodeURIComponent(id)}`, { tenantId: t });
export const createSaasPlan = (
  body: { planKey: string; name: string; scope?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${SA}/plans`, { method: 'POST', body, tenantId: t });
export const getPlanVersions = (planId: string, t?: string | null): Promise<ApiResult<{ versions: Row[] }>> =>
  call(`${SA}/plans/${encodeURIComponent(planId)}/versions`, { tenantId: t });
export const getVersionEntitlements = (
  versionId: string,
  t?: string | null,
): Promise<ApiResult<{ entitlements: Row[] }>> =>
  call(`${SA}/versions/${encodeURIComponent(versionId)}/entitlements`, { tenantId: t });
export const getSubscriptions = (t?: string | null): Promise<ApiResult<{ subscriptions: Row[] }>> =>
  call(`${SA}/subscriptions`, { tenantId: t });
export const getSubscription = (id: string, t?: string | null): Promise<ApiResult<{ subscription: Row }>> =>
  call(`${SA}/subscriptions/${encodeURIComponent(id)}`, { tenantId: t });
// Lifecycle — the canonical endpoints take `version` (not `expectedVersion`); change-plan also needs the target
// planId + planVersionId. No delete — suspend/cancel are governed transitions.
const subAction = (id: string, action: string, body: Record<string, unknown>, t?: string | null) =>
  call<Row>(`${SA}/subscriptions/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body,
    tenantId: t,
  });
export const activateSubscription = (id: string, ver: number, t?: string | null): Promise<ApiResult<Row>> =>
  subAction(id, 'activate', { version: ver }, t);
export const suspendSubscription = (id: string, ver: number, t?: string | null): Promise<ApiResult<Row>> =>
  subAction(id, 'suspend', { version: ver }, t);
export const cancelSubscription = (id: string, ver: number, t?: string | null): Promise<ApiResult<Row>> =>
  subAction(id, 'cancel', { version: ver }, t);
export const renewSubscription = (id: string, ver: number, t?: string | null): Promise<ApiResult<Row>> =>
  subAction(id, 'renew', { version: ver }, t);
export const changeSubscriptionPlan = (
  id: string,
  ver: number,
  planId: string,
  planVersionId: string,
  t?: string | null,
): Promise<ApiResult<Row>> => subAction(id, 'change-plan', { version: ver, planId, planVersionId }, t);

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

// M43 Treasury OPERATIONAL actions — canonical m20 lifecycle/review, reused (no duplicate engine). Every action
// is permission-gated + audited server-side; all carry the mandatory `expectedVersion` (optimistic concurrency),
// and privileged / reversing actions carry an audit `reason`. There is NO delete — a run reopens, a match
// unmatches, an exception is waived; financial history is preserved.
const rvPost = (path: string, expectedVersion: number, t?: string | null, reason?: string) =>
  call<Row>(`${R}/${path}`, {
    method: 'POST',
    body: { expectedVersion, ...(reason ? { reason } : {}) },
    tenantId: t,
  });
export const executeRun = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  rvPost(`runs/${encodeURIComponent(id)}/execute`, ev, t);
export const completeRun = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  rvPost(`runs/${encodeURIComponent(id)}/complete`, ev, t);
export const reopenRun = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => rvPost(`runs/${encodeURIComponent(id)}/reopen`, ev, t, reason);
export const confirmMatch = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  rvPost(`matches/${encodeURIComponent(id)}/confirm`, ev, t);
export const rejectMatch = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => rvPost(`matches/${encodeURIComponent(id)}/reject`, ev, t, reason);
export const unmatchMatch = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => rvPost(`matches/${encodeURIComponent(id)}/unmatch`, ev, t, reason);
export const resolveException = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => rvPost(`exceptions/${encodeURIComponent(id)}/resolve`, ev, t, reason);
export const waiveException = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => rvPost(`exceptions/${encodeURIComponent(id)}/waive`, ev, t, reason);
export const acceptImport = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  rvPost(`gl-imports/${encodeURIComponent(id)}/accept`, ev, t);
export const rejectImport = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => rvPost(`gl-imports/${encodeURIComponent(id)}/reject`, ev, t, reason);

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

// M21 draft workbench (operational completion). Every mutation carries expectedVersion; amounts are INTEGER
// MINOR UNITS (never a float, ADR-007). m21 NEVER approves or posts — submit hands off to m22; posting is
// approval-gated + period-gated server-side.
export const editJournalDraft = (
  id: string,
  ev: number,
  body: Record<string, unknown>,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${J}/drafts/${encodeURIComponent(id)}/edit`, {
    method: 'POST',
    body: { expectedVersion: ev, ...body },
    tenantId: t,
  });
export const addJournalLine = (
  draftId: string,
  line: DraftLineInput,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${J}/drafts/${encodeURIComponent(draftId)}/lines`, { method: 'POST', body: line, tenantId: t });
export const updateJournalLine = (
  lineId: string,
  ev: number,
  body: Partial<DraftLineInput>,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${J}/lines/${encodeURIComponent(lineId)}/update`, {
    method: 'POST',
    body: { expectedVersion: ev, ...body },
    tenantId: t,
  });
export const removeJournalLine = (lineId: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${J}/lines/${encodeURIComponent(lineId)}/remove`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const withdrawJournalDraft = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${J}/drafts/${encodeURIComponent(id)}/withdraw`, {
    method: 'POST',
    body: { expectedVersion: ev, reason },
    tenantId: t,
  });
export const addJournalNote = (id: string, content: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${J}/drafts/${encodeURIComponent(id)}/notes`, { method: 'POST', body: { content }, tenantId: t });
export const getJournalDraftHistory = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ history: Row[] }>> =>
  call(`${J}/drafts/${encodeURIComponent(id)}/history`, { tenantId: t });
// Posting requests — approval-gated + period-gated. authorize records the OPAQUE m22 approval reference +
// approver (SoD: approver != requester, DB CHECK). recordResult records EVIDENCE of an external/core posting
// outcome — m21 itself never pushes to a core banking/accounting system (m23/m33, deferred post-MVP).
export const preparePostingRequest = (draftId: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${J}/drafts/${encodeURIComponent(draftId)}/posting-requests`, { method: 'POST', tenantId: t });
export const getPostingRequests = (
  draftId: string,
  t?: string | null,
): Promise<ApiResult<{ postingRequests: Row[] }>> =>
  call(`${J}/drafts/${encodeURIComponent(draftId)}/posting-requests`, { tenantId: t });
export const authorizePosting = (
  id: string,
  ev: number,
  approvalRef: string,
  approvedBy: string,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${J}/posting-requests/${encodeURIComponent(id)}/authorize`, {
    method: 'POST',
    body: { expectedVersion: ev, approvalRef, approvedBy },
    tenantId: t,
  });
export const cancelPostingRequest = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${J}/posting-requests/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { expectedVersion: ev, reason },
    tenantId: t,
  });
export const recordPostingResult = (
  id: string,
  body: { status: string; externalSystem?: string; externalRef?: string; message?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${J}/posting-requests/${encodeURIComponent(id)}/results`, { method: 'POST', body, tenantId: t });

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
  const submitted = await submitJournalDraft(id, v2, tenant);
  if (!submitted.ok) return submitted;
  // Raise the canonical M22 approval request for the submitted adjustment so a DISTINCT checker can decide it
  // in the Approvals inbox (maker-checker). Best-effort: if the maker lacks approvals.request.* the journal is
  // still submitted (PENDING APPROVAL) — the request just isn't raised, and that is surfaced, not swallowed.
  const debitMinor = input.lines
    .filter((l) => l.direction === 'debit')
    .reduce((sum, l) => sum + (Number.isFinite(l.amountMinor) ? l.amountMinor : 0), 0);
  const req = await createApprovalRequest(
    {
      subjectType: 'journal_posting',
      subjectRef: id,
      title: input.description,
      amountMinor: debitMinor,
    },
    tenant,
  );
  if (req.ok && req.data) {
    const reqId = String(((req.data as Row)['request'] as Row | undefined)?.['id'] ?? '');
    const reqV = Number(((req.data as Row)['request'] as Row | undefined)?.['version'] ?? 1);
    if (reqId) await submitApprovalRequest(reqId, reqV, tenant);
  }
  return submitted;
}

// --- approvals (M22 maker-checker / SoD engine) — canonical, reused. THE platform approval choke point: an
// approving actor is NEVER the maker, a blocked SoD attempt is a 403 with a machine-readable reason code, and
// the deciding actor is the authenticated SESSION identity (never a request field). This client never approves
// on anyone's behalf; the server is authoritative. Reused by any module that raises an approval request. ---
const AP = '/approvals';
export const listApprovalRequests = (
  t?: string | null,
  status?: string,
): Promise<ApiResult<{ requests: Row[] }>> =>
  call(`${AP}/requests${status ? `?status=${encodeURIComponent(status)}` : ''}`, { tenantId: t });
export const getApprovalRequest = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ request: Row; steps: Row[] }>> =>
  call(`${AP}/requests/${encodeURIComponent(id)}`, { tenantId: t });
export const getApprovalDecisions = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ decisions: Row[] }>> =>
  call(`${AP}/requests/${encodeURIComponent(id)}/decisions`, { tenantId: t });
export const createApprovalRequest = (
  body: Record<string, unknown>,
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${AP}/requests`, { method: 'POST', body, tenantId: t });
export const submitApprovalRequest = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${AP}/requests/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
// Record a decision (approve/reject/return/escalate). SoD is enforced server-side: a maker deciding their OWN
// request gets a 403 (makerIsChecker), never a silent no-op.
export type ApprovalDecision = 'approve' | 'reject' | 'return' | 'escalate';
export const decideApproval = (
  id: string,
  ev: number,
  decision: ApprovalDecision,
  t?: string | null,
  reason?: string,
): Promise<ApiResult<Row>> =>
  call(`${AP}/requests/${encodeURIComponent(id)}/decisions`, {
    method: 'POST',
    body: { expectedVersion: ev, decision, ...(reason ? { reason } : {}) },
    tenantId: t,
  });

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

// M44 Recovery OPERATIONAL actions — canonical m17 lifecycle, reused (no duplicate recovery engine). Every action
// is permission-gated + audited server-side, carries the mandatory expectedVersion, and respects the m17 state
// machine (an invalid transition fails closed). There is NO hard delete — a case resolves/closes/reopens/archives.
const rcBody = (id: string, action: string, body: Record<string, unknown>, t?: string | null) =>
  call<Row>(`${RC}/recoveries/${encodeURIComponent(id)}/${action}`, { method: 'POST', body, tenantId: t });
export const assignRecovery = (
  id: string,
  ev: number,
  owner: string,
  t?: string | null,
  reassign = false,
): Promise<ApiResult<Row>> => rcBody(id, reassign ? 'reassign' : 'assign', { expectedVersion: ev, owner }, t);
export const advanceRecovery = (
  id: string,
  ev: number,
  toStatus: string,
  t?: string | null,
): Promise<ApiResult<Row>> => rcBody(id, 'advance', { expectedVersion: ev, toStatus }, t);
export const resolveRecovery = (
  id: string,
  ev: number,
  t?: string | null,
  reasonCode?: string,
): Promise<ApiResult<Row>> =>
  rcBody(id, 'resolve', { expectedVersion: ev, ...(reasonCode ? { reasonCode } : {}) }, t);
export const closeRecovery = (
  id: string,
  ev: number,
  t?: string | null,
  summary?: string,
): Promise<ApiResult<Row>> =>
  rcBody(id, 'close', { expectedVersion: ev, ...(summary ? { summary } : {}) }, t);
export const reopenRecovery = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => rcBody(id, 'reopen', { expectedVersion: ev, reason }, t);
export const archiveRecovery = (
  id: string,
  ev: number,
  t?: string | null,
  reason?: string,
): Promise<ApiResult<Row>> =>
  rcBody(id, 'archive', { expectedVersion: ev, ...(reason ? { reason } : {}) }, t);
// Arrangements — canonical m17 maker-checker (the approver is NEVER the proposer; SoD enforced in the m17
// service, NOT a second approval engine). propose → approve/default/complete.
export const proposeArrangement = (
  id: string,
  body: { arrangementType: string; totalAmountMinor?: number; installmentCount?: number; frequency?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => rcBody(id, 'arrangements', body, t);
const arrAction = (aid: string, action: string, body: Record<string, unknown>, t?: string | null) =>
  call<Row>(`${RC}/arrangements/${encodeURIComponent(aid)}/${action}`, { method: 'POST', body, tenantId: t });
export const approveArrangement = (aid: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  arrAction(aid, 'approve', { expectedVersion: ev }, t);
export const defaultArrangement = (
  aid: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => arrAction(aid, 'default', { expectedVersion: ev, reason }, t);
export const completeArrangement = (aid: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  arrAction(aid, 'complete', { expectedVersion: ev }, t);
// Demands + outcomes (append-only outcome evidence).
export const issueDemand = (
  id: string,
  body: { demandType: string; amountDemandedMinor?: number; responseDue?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => rcBody(id, 'demands', body, t);
export const recordOutcome = (
  id: string,
  body: { outcomeType: string; recoveredAmountMinor?: number; summary?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => rcBody(id, 'outcomes', body, t);

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
// Define a GRC CONTROL — canonical m41 `POST /grc/controls` (permission grc.control.manage, audited
// GRC_CONTROL_DEFINED). The canonical create contract is exactly controlKey+framework+title (+ optional scope);
// there is no owner/state field on create, so the UI does not invent one. There is NO update/retire route on the
// canonical surface — a control's posture changes only via append-only assessments (see recordGrcAssessment).
export const createGrcControl = (
  body: { controlKey: string; framework: string; title: string; scope?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${GRC}/controls`, { method: 'POST', body, tenantId: t });

// --- M19 finance fiscal calendar — the canonical accounting-period control surface (`/api/v1/finance`). Reuses
// the m19 CalendarService: fiscal years (create/close/reopen) and accounting periods (open/close/lock/reopen),
// each permission-gated + audited + expectedVersion + RLS server-side. m19 NEVER posts and carries NO monetary
// amounts (ADR-007); period close/lock is the CROSS-MODULE gate m21 posting honours. There is NO hard delete and
// NO unlock (a locked period is a terminal seal). The accounting entity comes from the canonical GET
// /finance/entities list (no invented entity master). ---
const FIN = '/finance';
export const getFinanceEntities = (
  t?: string | null,
  status?: string,
): Promise<ApiResult<Row[] | { entities?: Row[] }>> =>
  call(`${FIN}/entities${status ? `?status=${encodeURIComponent(status)}` : ''}`, { tenantId: t });
export const getFiscalYears = (
  entityId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { fiscalYears?: Row[] }>> =>
  call(`${FIN}/fiscal-years?entityId=${encodeURIComponent(entityId)}`, { tenantId: t });
export const createFiscalYear = (
  body: { entityId: string; code: string; startDate: string; endDate: string; name?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${FIN}/fiscal-years`, { method: 'POST', body, tenantId: t });
export const closeFiscalYear = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${FIN}/fiscal-years/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const reopenFiscalYear = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${FIN}/fiscal-years/${encodeURIComponent(id)}/reopen`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const getFiscalPeriods = (
  fiscalYearId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { periods?: Row[] }>> =>
  call(`${FIN}/fiscal-years/${encodeURIComponent(fiscalYearId)}/periods`, { tenantId: t });
export const getPeriodHistory = (
  periodId: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { history?: Row[] }>> =>
  call(`${FIN}/periods/${encodeURIComponent(periodId)}/history`, { tenantId: t });
export const openPeriod = (
  fiscalYearId: string,
  body: { periodNumber: number; startDate: string; endDate: string; name?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${FIN}/fiscal-years/${encodeURIComponent(fiscalYearId)}/periods`, {
    method: 'POST',
    body,
    tenantId: t,
  });
// close / lock / reopen carry ONLY expectedVersion — the canonical endpoints derive the reasonCode server-side
// (closed/locked/reopened); they accept NO user reason, so the client sends none. Lock is a terminal seal.
const periodAction = (id: string, action: string, ev: number, t?: string | null) =>
  call<Row>(`${FIN}/periods/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const closePeriod = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  periodAction(id, 'close', ev, t);
export const lockPeriod = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  periodAction(id, 'lock', ev, t);
export const reopenPeriod = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  periodAction(id, 'reopen', ev, t);

// --- M19 finance CONFIGURATION — the canonical finance MASTER-DATA surface (`/api/v1/finance`): GL accounts
// (Chart of Accounts), account types, currencies. Reuses the same m19 services (no second finance engine); every
// read is RLS-scoped + permission-gated, every write is permission-gated + audited + carries expectedVersion
// where a lifecycle needs it. There is NO maker-checker on m19 config — a single .manage / .create / .activate
// holder drives it (unlike operational posting) — and NO hard delete: an account ARCHIVES by status, a currency
// DEACTIVATES; master-data history is preserved (accounts expose an append-only history). m19 carries NO monetary
// amounts (ADR-007) and FX/tax rates are exact-decimal STRINGS — never coerced to a float. ---
export const getAccountTypes = (t?: string | null): Promise<ApiResult<Row[] | { accountTypes?: Row[] }>> =>
  call(`${FIN}/account-types`, { tenantId: t });
export const createAccountType = (
  body: { code: string; name: string; accountClass: string; normalSide?: string; description?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${FIN}/account-types`, { method: 'POST', body, tenantId: t });
export const getCurrencies = (
  t?: string | null,
  status?: string,
): Promise<ApiResult<Row[] | { currencies?: Row[] }>> =>
  call(`${FIN}/currencies${status ? `?status=${encodeURIComponent(status)}` : ''}`, { tenantId: t });
export const createCurrency = (
  body: { code: string; name: string; minorUnits?: number; symbol?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${FIN}/currencies`, { method: 'POST', body, tenantId: t });
export const deactivateCurrency = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${FIN}/currencies/${encodeURIComponent(id)}/deactivate`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
// GL accounts — entityId is REQUIRED on the list (else 400); status filters (draft/active/inactive/archived).
export const getFinanceAccounts = (
  entityId: string,
  t?: string | null,
  status?: string,
): Promise<ApiResult<Row[] | { accounts?: Row[] }>> =>
  call(
    `${FIN}/accounts?entityId=${encodeURIComponent(entityId)}${
      status ? `&status=${encodeURIComponent(status)}` : ''
    }`,
    { tenantId: t },
  );
export const getFinanceAccount = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${FIN}/accounts/${encodeURIComponent(id)}`, { tenantId: t });
export const getFinanceAccountHistory = (
  id: string,
  t?: string | null,
): Promise<ApiResult<Row[] | { history?: Row[] }>> =>
  call(`${FIN}/accounts/${encodeURIComponent(id)}/history`, { tenantId: t });
export const createFinanceAccount = (
  body: {
    entityId: string;
    accountTypeId: string;
    code: string;
    name: string;
    parentAccountId?: string;
    currencyId?: string;
    description?: string;
    postable?: boolean;
  },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${FIN}/accounts`, { method: 'POST', body, tenantId: t });
// Edit mutable fields — the caller assembles the body (it must include expectedVersion for optimistic concurrency).
export const updateFinanceAccount = (
  id: string,
  body: Record<string, unknown>,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${FIN}/accounts/${encodeURIComponent(id)}`, { method: 'POST', body, tenantId: t });
// Lifecycle (draft → active ↔ inactive → archived) — each carries ONLY expectedVersion; there is NO hard delete.
export const accountLifecycle = (
  id: string,
  action: 'activate' | 'deactivate' | 'archive',
  ev: number,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${FIN}/accounts/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });

// --- privacy / DLP / security-incident READ MODEL (m41) — closes the write-only backend gap. These are
// canonical RLS-scoped, permission-gated GET endpoints (privacy.policy.read / security.dlp.read); NO mutation is
// added here (the writes stay where they are). DLP findings are auto-generated append-only evidence (read-only);
// privacy records expose only an OPAQUE subject reference — never personal data. ---
const PRIV = '/privacy';
const SEC = '/security';
export const getPrivacyClassifications = (
  t?: string | null,
): Promise<ApiResult<Row[] | { classifications?: Row[] }>> =>
  call(`${PRIV}/classifications`, { tenantId: t });
export const getPrivacyRecords = (t?: string | null): Promise<ApiResult<Row[] | { records?: Row[] }>> =>
  call(`${PRIV}/records`, { tenantId: t });
export const getDlpPolicies = (t?: string | null): Promise<ApiResult<Row[] | { policies?: Row[] }>> =>
  call(`${SEC}/dlp/policies`, { tenantId: t });
export const getDlpFindings = (t?: string | null): Promise<ApiResult<Row[] | { findings?: Row[] }>> =>
  call(`${SEC}/dlp/findings`, { tenantId: t });
export const getSecurityIncidents = (t?: string | null): Promise<ApiResult<Row[] | { incidents?: Row[] }>> =>
  call(`${SEC}/incidents`, { tenantId: t });

// --- M13 Case management (Legal workspace) — canonical m13-case engine, reused (no second case engine). Every
// mutation is permission-gated + audited + carries expectedVersion where required; lifecycle is named POST
// actions (open/triage/assign/reassign/resolve/close/reopen/archive/escalate) — there is NO hard delete. Party
// CONTACT details are redacted server-side unless the caller holds cases.party_contact.read, and a genuine
// contact reveal is itself audited (CASE_PARTY_CONTACT_ACCESSED). ---
const CS = '/cases';
export const getCases = (
  t?: string | null,
  filters?: Record<string, string>,
): Promise<ApiResult<{ cases: Row[] }>> => {
  const qs = filters
    ? '?' +
      Object.entries(filters)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  return call(`${CS}${qs}`, { tenantId: t });
};
export const getCase = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${CS}/${encodeURIComponent(id)}`, { tenantId: t });
export const createCase = (
  body: { caseTypeCode: string; title: string; [k: string]: unknown },
  t?: string | null,
): Promise<ApiResult<Row>> => call(CS, { method: 'POST', body, tenantId: t });
const caseAction = (id: string, action: string, body: Record<string, unknown>, t?: string | null) =>
  call<Row>(`${CS}/${encodeURIComponent(id)}/${action}`, { method: 'POST', body, tenantId: t });
export const openCase = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  caseAction(id, 'open', { expectedVersion: ev }, t);
export const triageCase = (
  id: string,
  ev: number,
  body: Record<string, unknown>,
  t?: string | null,
): Promise<ApiResult<Row>> => caseAction(id, 'triage', { expectedVersion: ev, ...body }, t);
export const assignCase = (
  id: string,
  ev: number,
  owner: string,
  t?: string | null,
  reassign = false,
): Promise<ApiResult<Row>> =>
  caseAction(id, reassign ? 'reassign' : 'assign', { expectedVersion: ev, owner }, t);
export const resolveCase = (
  id: string,
  ev: number,
  t?: string | null,
  summary?: string,
): Promise<ApiResult<Row>> =>
  caseAction(id, 'resolve', { expectedVersion: ev, ...(summary ? { summary } : {}) }, t);
export const closeCase = (
  id: string,
  ev: number,
  t?: string | null,
  summary?: string,
): Promise<ApiResult<Row>> =>
  caseAction(id, 'close', { expectedVersion: ev, ...(summary ? { summary } : {}) }, t);
export const reopenCase = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => caseAction(id, 'reopen', { expectedVersion: ev, reason }, t);
export const archiveCase = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  caseAction(id, 'archive', { expectedVersion: ev }, t);
export const escalateCase = (id: string, reason: string, t?: string | null): Promise<ApiResult<Row>> =>
  caseAction(id, 'escalate', { reason }, t);
export const getCaseParties = (id: string, t?: string | null): Promise<ApiResult<{ parties: Row[] }>> =>
  call(`${CS}/${encodeURIComponent(id)}/parties`, { tenantId: t });
export const addCaseParty = (
  id: string,
  body: { partyType: string; role?: string; displayLabel?: string; contactRef?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${CS}/${encodeURIComponent(id)}/parties`, { method: 'POST', body, tenantId: t });
export const removeCaseParty = (pid: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${CS}/parties/${encodeURIComponent(pid)}/remove`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const getCaseActivities = (id: string, t?: string | null): Promise<ApiResult<{ activities: Row[] }>> =>
  call(`${CS}/${encodeURIComponent(id)}/activities`, { tenantId: t });
export const addCaseActivity = (
  id: string,
  body: { activityType: string; headline: string; description?: string; direction?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${CS}/${encodeURIComponent(id)}/activities`, { method: 'POST', body, tenantId: t });
export const getCaseDeadlines = (id: string, t?: string | null): Promise<ApiResult<{ deadlines: Row[] }>> =>
  call(`${CS}/${encodeURIComponent(id)}/deadlines`, { tenantId: t });
export const getCaseRelationships = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ relationships: Row[] }>> =>
  call(`${CS}/${encodeURIComponent(id)}/relationships`, { tenantId: t });

// --- M14 Legal Matters — canonical m14-legal engine, reused (no second legal engine). Every mutation is
// permission-gated + audited + carries expectedVersion where required; lifecycle is named POST actions
// (open/assign/reassign/resolve/close/reopen/archive/escalate) — NO hard delete. A matter can be created from an
// M13 case via the canonical from-case conversion (server-backed sourceCaseId link). Settlements are the
// canonical maker-checker (proposer != approver, SoD server-side). Party CONTACT is redacted unless the caller
// holds legal.party_contact.read, and a genuine reveal is audited (LEGAL_PARTY_CONTACT_ACCESSED). ---
const LG = '/legal';
export const getMatters = (
  t?: string | null,
  filters?: Record<string, string>,
): Promise<ApiResult<{ matters: Row[] }>> => {
  const qs = filters
    ? '?' +
      Object.entries(filters)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  return call(`${LG}/matters${qs}`, { tenantId: t });
};
export const getMatter = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${LG}/matters/${encodeURIComponent(id)}`, { tenantId: t });
export const createMatter = (
  body: { matterTypeCode: string; title: string; [k: string]: unknown },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${LG}/matters`, { method: 'POST', body, tenantId: t });
export const matterFromCase = (
  body: { sourceCaseId: string; matterTypeCode: string; title: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${LG}/from-case`, { method: 'POST', body, tenantId: t });
const matterAction = (id: string, action: string, body: Record<string, unknown>, t?: string | null) =>
  call<Row>(`${LG}/matters/${encodeURIComponent(id)}/${action}`, { method: 'POST', body, tenantId: t });
export const openMatter = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  matterAction(id, 'open', { expectedVersion: ev }, t);
export const assignMatter = (
  id: string,
  ev: number,
  owner: string,
  t?: string | null,
  reassign = false,
): Promise<ApiResult<Row>> =>
  matterAction(id, reassign ? 'reassign' : 'assign', { expectedVersion: ev, owner }, t);
export const resolveMatter = (
  id: string,
  ev: number,
  t?: string | null,
  summary?: string,
): Promise<ApiResult<Row>> =>
  matterAction(id, 'resolve', { expectedVersion: ev, ...(summary ? { summary } : {}) }, t);
export const closeMatter = (
  id: string,
  ev: number,
  t?: string | null,
  summary?: string,
): Promise<ApiResult<Row>> =>
  matterAction(id, 'close', { expectedVersion: ev, ...(summary ? { summary } : {}) }, t);
export const reopenMatter = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => matterAction(id, 'reopen', { expectedVersion: ev, reason }, t);
export const archiveMatter = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  matterAction(id, 'archive', { expectedVersion: ev }, t);
export const escalateMatter = (id: string, reason: string, t?: string | null): Promise<ApiResult<Row>> =>
  matterAction(id, 'escalate', { reason }, t);
const mget = (id: string, sub: string, t?: string | null) =>
  call<Row[] | Record<string, Row[]>>(`${LG}/matters/${encodeURIComponent(id)}/${sub}`, { tenantId: t });
export const getMatterParties = (id: string, t?: string | null) => mget(id, 'parties', t);
export const getMatterActivities = (id: string, t?: string | null) => mget(id, 'activities', t);
export const getMatterPositions = (id: string, t?: string | null) => mget(id, 'positions', t);
export const getMatterOpinions = (id: string, t?: string | null) => mget(id, 'opinions', t);
export const getMatterCounsel = (id: string, t?: string | null) => mget(id, 'counsel', t);
export const getMatterDeadlines = (id: string, t?: string | null) => mget(id, 'deadlines', t);
export const getMatterSettlements = (id: string, t?: string | null) => mget(id, 'settlements', t);
export const getMatterRelationships = (id: string, t?: string | null) => mget(id, 'relationships', t);
export const addMatterActivity = (
  id: string,
  body: { activityType: string; headline: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${LG}/matters/${encodeURIComponent(id)}/activities`, { method: 'POST', body, tenantId: t });
export const addMatterPosition = (
  id: string,
  body: { positionType?: string; summary: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${LG}/matters/${encodeURIComponent(id)}/positions`, { method: 'POST', body, tenantId: t });
export const addMatterOpinion = (
  id: string,
  body: { opinionType?: string; riskRating?: string; documentRef?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${LG}/matters/${encodeURIComponent(id)}/opinions`, { method: 'POST', body, tenantId: t });
export const addMatterCounsel = (
  id: string,
  body: { lawFirmRef?: string; advocateRef?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${LG}/matters/${encodeURIComponent(id)}/counsel`, { method: 'POST', body, tenantId: t });
export const proposeSettlement = (
  id: string,
  body: { proposal?: string; amountMinor?: number; monetaryTerms?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${LG}/matters/${encodeURIComponent(id)}/settlements`, { method: 'POST', body, tenantId: t });
export const approveSettlement = (sid: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${LG}/settlements/${encodeURIComponent(sid)}/approve`, { method: 'POST', tenantId: t });

// --- M12 Feedback Management (Customer Service) — canonical m12-feedback engine, reused (no second feedback
// engine). The Aptic FMS model: capture → classify → assign/escalate → HOD resolution (submit → approve, a
// DISTINCT approver = SoD) → customer confirmation → rule-gated close. Every mutation is permission-gated +
// audited + carries expectedVersion where required; closure is gated server-side (customer confirmation etc.);
// NO hard delete. Customer contact is redacted unless the caller holds feedback.customer_contact.read, and a
// reveal is audited (FEEDBACK_CONTACT_ACCESSED) server-side. Serious feedback can hand off to an M13 case. ---
const FB = '/feedback';
export const getFeedbackRecords = (
  t?: string | null,
  filters?: Record<string, string>,
): Promise<ApiResult<{ records: Row[] }>> => {
  const qs = filters
    ? '?' +
      Object.entries(filters)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  return call(`${FB}/records${qs}`, { tenantId: t });
};
export const getFeedbackRecord = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${FB}/records/${encodeURIComponent(id)}`, { tenantId: t });
export const getFeedbackAnalytics = (
  dimension: string,
  t?: string | null,
): Promise<ApiResult<{ dimension: string; buckets: Row[] }>> =>
  call(`${FB}/analytics?dimension=${encodeURIComponent(dimension)}`, { tenantId: t });
export const createFeedback = (body: Record<string, unknown>, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${FB}/records`, { method: 'POST', body, tenantId: t });
const fbAction = (id: string, action: string, body: Record<string, unknown>, t?: string | null) =>
  call<Row>(`${FB}/records/${encodeURIComponent(id)}/${action}`, { method: 'POST', body, tenantId: t });
export const captureFeedback = (
  id: string,
  ev: number,
  body: { rating?: number; ratingScale?: number; narrative?: string; feedbackType?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => fbAction(id, 'capture', { expectedVersion: ev, ...body }, t);
export const classifyFeedback = (
  id: string,
  ev: number,
  body: { sentiment: string; severity: string; category?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => fbAction(id, 'classify', { expectedVersion: ev, ...body }, t);
export const assignFeedback = (
  id: string,
  ev: number,
  owner: string,
  t?: string | null,
  kind?: string,
): Promise<ApiResult<Row>> =>
  fbAction(id, 'assign', { expectedVersion: ev, owner, ...(kind ? { kind } : {}) }, t);
export const escalateFeedback = (id: string, reason: string, t?: string | null): Promise<ApiResult<Row>> =>
  fbAction(id, 'escalate', { reason }, t);
export const submitResolution = (
  id: string,
  body: {
    summary?: string;
    resolutionType?: string;
    rootCauseCategory?: string;
    responseCustomerFacing?: string;
  },
  t?: string | null,
): Promise<ApiResult<Row>> => fbAction(id, 'resolution', body, t);
export const approveResolution = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${FB}/records/${encodeURIComponent(id)}/resolution/approve`, { method: 'POST', tenantId: t });
export const recordConfirmation = (
  id: string,
  ev: number,
  satisfied: boolean,
  t?: string | null,
): Promise<ApiResult<Row>> => fbAction(id, 'confirmation', { expectedVersion: ev, satisfied }, t);
export const closeFeedback = (
  id: string,
  ev: number,
  t?: string | null,
  waiveCustomerConfirmation = false,
): Promise<ApiResult<Row>> =>
  fbAction(
    id,
    'close',
    { expectedVersion: ev, ...(waiveCustomerConfirmation ? { waiveCustomerConfirmation: true } : {}) },
    t,
  );
export const reopenFeedback = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => fbAction(id, 'reopen', { expectedVersion: ev, reason }, t);
export const requestFeedbackCaseHandoff = (
  id: string,
  body: { recommendedCaseType?: string; summary?: string },
  t?: string | null,
): Promise<ApiResult<Row>> => fbAction(id, 'case-handoff', body, t);
export const getFeedbackActivities = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ activities: Row[] }>> =>
  call(`${FB}/records/${encodeURIComponent(id)}/activities`, { tenantId: t });
export const addFeedbackActivity = (
  id: string,
  body: { activityType: string; headline: string; description?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${FB}/records/${encodeURIComponent(id)}/activities`, { method: 'POST', body, tenantId: t });
export const getFeedbackResolution = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ resolution: Row | null }>> =>
  call(`${FB}/records/${encodeURIComponent(id)}/resolution`, { tenantId: t });
export const getFeedbackSla = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${FB}/records/${encodeURIComponent(id)}/sla`, { tenantId: t });

// --- M12 Feedback SETUP / CONFIGURATION (Customer Service) — the CANONICAL config surface (questionnaires, SLA
// policies, categories, source systems) for the SAME m12 engine reused above (no second feedback engine). Config
// lifecycle is a single-permission state machine (DRAFT→VALIDATED→PUBLISHED→ACTIVE) driven by one .manage holder
// — NO maker≠checker on setup (unlike operational resolution). Spec rows carry an optimistic-lock `version`; each
// lifecycle POST returns the new version, so chain reads. There is NO draft UPDATE endpoint — "editing while
// mutable" is a new POST with the same `code` (produces a fresh DRAFT versionNumber). Source systems hold NO
// credentials/secrets — the API exposes only {code,name,active,updatedAt,version}. All server-authoritative
// (RBAC + tenant isolation + audit); the UI never computes SLA windows/statuses. ---
export interface SpecView {
  id: string;
  code: string;
  versionNumber: number;
  name: string;
  scope: string;
  status: string; // DRAFT | VALIDATED | PUBLISHED | ACTIVE | RETIRED | ARCHIVED
  spec: Row;
  contentHash: string;
  version: number; // optimistic-lock version
}
export interface CategoryView {
  code: string;
  name: string;
  defaultSentiment: string;
  active: boolean;
  updatedAt: string;
  version: number;
}
export interface SourceSystemView {
  code: string;
  name: string;
  active: boolean;
  updatedAt: string;
  version: number;
}
export type SpecLifecycleAction = 'validate' | 'publish' | 'activate';
export const getFeedbackQuestionnaires = (
  t?: string | null,
): Promise<ApiResult<{ questionnaires: SpecView[] }>> => call(`${FB}/questionnaires`, { tenantId: t });
export const getFeedbackQuestionnaire = (id: string, t?: string | null): Promise<ApiResult<SpecView>> =>
  call(`${FB}/questionnaires/${encodeURIComponent(id)}`, { tenantId: t });
export const getFeedbackSlaPolicies = (t?: string | null): Promise<ApiResult<{ slaPolicies: SpecView[] }>> =>
  call(`${FB}/sla-policies`, { tenantId: t });
export const getFeedbackSlaPolicy = (id: string, t?: string | null): Promise<ApiResult<SpecView>> =>
  call(`${FB}/sla-policies/${encodeURIComponent(id)}`, { tenantId: t });
export const getFeedbackCategories = (
  t?: string | null,
): Promise<ApiResult<{ categories: CategoryView[] }>> => call(`${FB}/categories`, { tenantId: t });
export const getFeedbackSourceSystems = (
  t?: string | null,
): Promise<ApiResult<{ sourceSystems: SourceSystemView[] }>> => call(`${FB}/source-systems`, { tenantId: t });
export const setFeedbackSource = (
  body: { code: string; name: string; active?: boolean },
  t?: string | null,
): Promise<ApiResult<{ ok: true }>> => call(`${FB}/source-systems`, { method: 'POST', body, tenantId: t });
export const setFeedbackCategory = (
  body: { code: string; name: string; defaultSentiment?: string; active?: boolean },
  t?: string | null,
): Promise<ApiResult<{ ok: true }>> => call(`${FB}/categories`, { method: 'POST', body, tenantId: t });
export const createFeedbackQuestionnaire = (
  body: { code: string; name: string; scope?: string; spec: Row },
  t?: string | null,
): Promise<ApiResult<SpecView>> => call(`${FB}/questionnaires`, { method: 'POST', body, tenantId: t });
export const questionnaireLifecycle = (
  id: string,
  action: SpecLifecycleAction,
  expectedVersion: number,
  t?: string | null,
): Promise<ApiResult<SpecView>> =>
  call(`${FB}/questionnaires/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: { expectedVersion },
    tenantId: t,
  });
export const createFeedbackSlaPolicy = (
  body: { code: string; name: string; scope?: string; spec: Row },
  t?: string | null,
): Promise<ApiResult<SpecView>> => call(`${FB}/sla-policies`, { method: 'POST', body, tenantId: t });
export const slaPolicyLifecycle = (
  id: string,
  action: SpecLifecycleAction,
  expectedVersion: number,
  t?: string | null,
): Promise<ApiResult<SpecView>> =>
  call(`${FB}/sla-policies/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: { expectedVersion },
    tenantId: t,
  });

// --- M16 Litigation — canonical m16-litigation engine, reused (no second litigation engine). Every mutation is
// permission-gated + audited + carries expectedVersion where required; lifecycle is named POST actions
// (assign/reassign/advance/conclude/close/reopen/archive/escalate) — NO hard delete. A proceeding is created
// from an M14 matter via the canonical from-matter referral (server-backed sourceMatterId link). Filings are the
// canonical maker-checker (submit -> review -> approve [distinct filing.approve] -> file; approver != submitter,
// SoD server-side). Party CONTACT is redacted unless permitted; a reveal is audited
// (LITIGATION_PARTY_CONTACT_ACCESSED). ---
const LIT = '/litigation';
export const getProceedings = (
  t?: string | null,
  filters?: Record<string, string>,
): Promise<ApiResult<{ proceedings: Row[] }>> => {
  const qs = filters
    ? '?' +
      Object.entries(filters)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  return call(`${LIT}/proceedings${qs}`, { tenantId: t });
};
export const getProceeding = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${LIT}/proceedings/${encodeURIComponent(id)}`, { tenantId: t });
export const createProceeding = (
  body: { proceedingTypeCode: string; title: string; [k: string]: unknown },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${LIT}/proceedings`, { method: 'POST', body, tenantId: t });
export const proceedingFromMatter = (
  body: { referralKey: string; sourceMatterId: string; proceedingTypeCode: string; title: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${LIT}/from-matter`, { method: 'POST', body, tenantId: t });
const procAction = (id: string, action: string, body: Record<string, unknown>, t?: string | null) =>
  call<Row>(`${LIT}/proceedings/${encodeURIComponent(id)}/${action}`, { method: 'POST', body, tenantId: t });
export const assignProceeding = (
  id: string,
  ev: number,
  owner: string,
  t?: string | null,
  reassign = false,
): Promise<ApiResult<Row>> =>
  procAction(id, reassign ? 'reassign' : 'assign', { expectedVersion: ev, owner }, t);
export const concludeProceeding = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  procAction(id, 'conclude', { expectedVersion: ev }, t);
export const closeProceeding = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  procAction(id, 'close', { expectedVersion: ev }, t);
export const reopenProceeding = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => procAction(id, 'reopen', { expectedVersion: ev, reason }, t);
export const archiveProceeding = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  procAction(id, 'archive', { expectedVersion: ev }, t);
export const escalateProceeding = (id: string, reason: string, t?: string | null): Promise<ApiResult<Row>> =>
  procAction(id, 'escalate', { reason }, t);
const pget = (id: string, sub: string, t?: string | null) =>
  call<Record<string, Row[]>>(`${LIT}/proceedings/${encodeURIComponent(id)}/${sub}`, { tenantId: t });
export const getProceedingParties = (id: string, t?: string | null) => pget(id, 'parties', t);
export const getProceedingFilings = (id: string, t?: string | null) => pget(id, 'filings', t);
export const getProceedingService = (id: string, t?: string | null) => pget(id, 'service', t);
export const getProceedingAppearances = (id: string, t?: string | null) => pget(id, 'appearances', t);
export const getProceedingWitnesses = (id: string, t?: string | null) => pget(id, 'witnesses', t);
// Filings maker-checker: submit -> review -> approve (distinct litigation.filing.approve) -> file.
export const submitFiling = (
  id: string,
  body: { filingType: string; filingRole: string; documentRef?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${LIT}/proceedings/${encodeURIComponent(id)}/filings`, { method: 'POST', body, tenantId: t });
const filingAction = (fid: string, action: string, ev: number, t?: string | null) =>
  call<Row>(`${LIT}/filings/${encodeURIComponent(fid)}/${action}`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const reviewFiling = (fid: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  filingAction(fid, 'review', ev, t);
export const approveFiling = (fid: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  filingAction(fid, 'approve', ev, t);
export const fileFiling = (fid: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  filingAction(fid, 'file', ev, t);

// --- M18 Legal Documents (knowledge + template library) — canonical m18-legaldocs engine, reused (no second
// document/knowledge engine, no second blob store — files live in m09 by reference). The editorial lifecycle is
// maker-checker: create → submit → review/request-changes → approve (DISTINCT approver, SoD server-side) →
// publish → supersede/withdraw. Every mutation is permission-gated + audited + carries expectedVersion; a
// published version is immutable (content hash frozen). A list view never returns privileged content (ADR-076). ---
const LD = '/legaldocs';
export const getKnowledge = (
  t?: string | null,
  filters?: Record<string, string>,
): Promise<ApiResult<{ results: Row[] }>> => {
  const qs = filters
    ? '?' +
      Object.entries(filters)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  return call(`${LD}/knowledge${qs}`, { tenantId: t });
};
export const getKnowledgeItem = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${LD}/knowledge/${encodeURIComponent(id)}`, { tenantId: t });
export const createKnowledge = (
  body: { knowledgeType: string; title: string; [k: string]: unknown },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${LD}/knowledge`, { method: 'POST', body, tenantId: t });
const knAction = (id: string, action: string, body: Record<string, unknown>, t?: string | null) =>
  call<Row>(`${LD}/knowledge/${encodeURIComponent(id)}/${action}`, { method: 'POST', body, tenantId: t });
export const submitKnowledge = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  knAction(id, 'submit', { expectedVersion: ev }, t);
export const reviewKnowledge = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  knAction(id, 'review', { expectedVersion: ev }, t);
export const requestKnowledgeChanges = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => knAction(id, 'request-changes', { expectedVersion: ev, reason }, t);
export const approveKnowledge = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  knAction(id, 'approve', { expectedVersion: ev }, t);
export const publishKnowledge = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  knAction(id, 'publish', { expectedVersion: ev }, t);
export const withdrawKnowledge = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => knAction(id, 'withdraw', { expectedVersion: ev, reason }, t);
export const getKnowledgeReviews = (id: string, t?: string | null): Promise<ApiResult<{ reviews: Row[] }>> =>
  call(`${LD}/knowledge/${encodeURIComponent(id)}/reviews`, { tenantId: t });
// Templates (maker-checker: submit → approve [templateApprove, SoD] → publish → withdraw/supersede).
export const getTemplates = (t?: string | null): Promise<ApiResult<{ templates: Row[] }>> =>
  call(`${LD}/templates`, { tenantId: t });
export const getTemplate = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${LD}/templates/${encodeURIComponent(id)}`, { tenantId: t });
const tplAction = (id: string, action: string, body: Record<string, unknown>, t?: string | null) =>
  call<Row>(`${LD}/templates/${encodeURIComponent(id)}/${action}`, { method: 'POST', body, tenantId: t });
export const submitTemplate = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  tplAction(id, 'submit', { expectedVersion: ev }, t);
export const approveTemplate = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  tplAction(id, 'approve', { expectedVersion: ev }, t);
export const publishTemplate = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  tplAction(id, 'publish', { expectedVersion: ev }, t);
export const withdrawTemplate = (
  id: string,
  ev: number,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> => tplAction(id, 'withdraw', { expectedVersion: ev, reason }, t);
// Read-only legal registries.
export const getAuthorities = (t?: string | null): Promise<ApiResult<{ authorities: Row[] }>> =>
  call(`${LD}/authorities`, { tenantId: t });
export const getPrecedents = (t?: string | null): Promise<ApiResult<{ precedents: Row[] }>> =>
  call(`${LD}/precedents`, { tenantId: t });

// --- M32 Analytics / Reporting — canonical m32 analytics engine, reused (no second reporting/analytics engine).
// All GOVERNED READS: datasets → metrics → reports are DEFINITION objects on a maker-checker publish lifecycle
// (author → validate → review → publish; approver ≠ author; a published definition is immutable). The single
// POST (`/query`) RUNS a published metric server-side and returns MATERIALIZED aggregates — no number is ever
// computed in the browser. Reads are RLS-scoped + permission-gated (analytics.dataset.read / analytics.metric.read
// / analytics.report.read / analytics.query.run) and audited server-side; this client adds no authorization. ---
const AN = '/analytics';
export const getDatasets = (t?: string | null): Promise<ApiResult<{ datasets: Row[] }>> =>
  call(`${AN}/datasets`, { tenantId: t });
export const getDataset = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${AN}/datasets/${encodeURIComponent(id)}`, { tenantId: t });
export const getDatasetMetrics = (id: string, t?: string | null): Promise<ApiResult<{ metrics: Row[] }>> =>
  call(`${AN}/datasets/${encodeURIComponent(id)}/metrics`, { tenantId: t });
export const getPublishedMetrics = (t?: string | null): Promise<ApiResult<{ metrics: Row[] }>> =>
  call(`${AN}/metrics`, { tenantId: t });
export const getMetric = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${AN}/metrics/${encodeURIComponent(id)}`, { tenantId: t });
export const getReports = (t?: string | null): Promise<ApiResult<{ reports: Row[] }>> =>
  call(`${AN}/reports`, { tenantId: t });
export const getReport = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${AN}/reports/${encodeURIComponent(id)}`, { tenantId: t });
// The one POST is a GOVERNED READ of materialized aggregates: it RUNS a published metric (never posts, never
// computes in the browser) and returns { metricKey, metricVersion, valueKind, lineageId, rows } for provenance.
export const runAnalyticsQuery = (
  metricKey: string,
  t?: string | null,
  opts?: { scope?: string; groupBy?: string[] },
): Promise<ApiResult<Row>> =>
  call(`${AN}/query`, {
    method: 'POST',
    body: {
      metricKey,
      ...(opts?.scope ? { scope: opts.scope } : {}),
      ...(opts?.groupBy ? { groupBy: opts.groupBy } : {}),
    },
    tenantId: t,
  });

// --- M28 Executive Copilot — canonical m28 copilot governance surface (`/copilot`), reused (no second AI /
// advisory engine). A grounded, READ-ONLY executive advisory: the copilot analyses, explains, CITES and
// recommends — it NEVER approves, posts, closes, files, disburses or executes any controlled action
// (server-enforced). Each query runs the governed m24 pipeline server-side; the ANSWER is stored by reference
// (answerRef) and a response with no citations / below the confidence threshold is held as review_required —
// never surfaced as a confident answer. Reads are RLS-scoped + permission-gated (ai.copilot.read /
// ai.copilot.query / ai.copilot.feedback / ai.copilot.configure) and audited server-side; this client adds no
// authorization of its own, and no answer or number is ever fabricated in the browser. ---
const CP = '/copilot';
export const createCopilotSession = (
  t?: string | null,
  body?: { scopeLevel?: string; subjectLabel?: string; classification?: string },
): Promise<ApiResult<Row>> => call(`${CP}/sessions`, { method: 'POST', body: body ?? {}, tenantId: t });
export const getCopilotSessions = (t?: string | null): Promise<ApiResult<{ sessions: Row[] }>> =>
  call(`${CP}/sessions`, { tenantId: t });
export const askCopilot = (
  body: {
    sessionId: string;
    question: string;
    intentClass?: string;
    scopeLevel?: string;
    classification?: string;
  },
  t?: string | null,
): Promise<ApiResult<{ query: Row; response: Row | null }>> =>
  call(`${CP}/queries`, { method: 'POST', body, tenantId: t });
export const getCopilotQueries = (
  t?: string | null,
  sessionId?: string,
): Promise<ApiResult<{ queries: Row[] }>> =>
  call(`${CP}/queries${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`, { tenantId: t });
export const getCopilotQuery = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ query: Row; response: Row | null }>> =>
  call(`${CP}/queries/${encodeURIComponent(id)}`, { tenantId: t });
export const getCopilotResponse = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${CP}/queries/${encodeURIComponent(id)}/response`, { tenantId: t });
export const getCopilotCitations = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ citations: Row[] }>> =>
  call(`${CP}/queries/${encodeURIComponent(id)}/citations`, { tenantId: t });
export const sendCopilotFeedback = (
  responseId: string,
  body: { rating: string; reasonCode?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${CP}/responses/${encodeURIComponent(responseId)}/feedback`, { method: 'POST', body, tenantId: t });
export const getCopilotConfig = (t?: string | null): Promise<ApiResult<{ config: Row[] }>> =>
  call(`${CP}/config`, { tenantId: t });
export const getCopilotCapabilities = (t?: string | null): Promise<ApiResult<Row>> =>
  call(`${CP}/capabilities`, { tenantId: t });
export const createCopilotConfig = (
  body: { name?: string; minConfidenceBps?: number; maxSources?: number },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${CP}/config`, { method: 'POST', body, tenantId: t });
export const publishCopilotConfig = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${CP}/config/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const exportCopilotQuery = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${CP}/queries/${encodeURIComponent(id)}/export`, { method: 'POST', tenantId: t });

// --- M08 Notifications — canonical m08 notification engine, reused (no second notification / delivery engine).
// The in-app INBOX is a governed READ + a one-way mark-read (no hard delete). Email/SMS/webhook are
// DELIVERY-TRACKED: a request fans out to append-only delivery attempts (evidence — never mutated), and
// retry/cancel are governed transitions carrying the mandatory `expectedVersion` (optimistic concurrency).
// security/legal categories are mandatory and BYPASS preferences (server-enforced). Reads are RLS-scoped +
// permission-gated (notifications.inbox.view / notifications.inbox.manage / notifications.preference.view /
// notifications.preference.update / notifications.request.read / notifications.request.retry /
// notifications.request.cancel / notifications.template.read) and audited server-side; this client adds no
// authorization of its own, and no notification is ever fabricated in the browser. ---
const NT = '/notifications';
export const getInbox = (t?: string | null, status?: string): Promise<ApiResult<{ inbox: Row[] }>> =>
  call(`${NT}/inbox${status ? `?status=${encodeURIComponent(status)}` : ''}`, { tenantId: t });
export const markInboxRead = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${NT}/inbox/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const getNotifPreferences = (t?: string | null): Promise<ApiResult<{ preferences: Row[] }>> =>
  call(`${NT}/preferences`, { tenantId: t });
export const updateNotifPreference = (
  body: { channel: string; optIn?: boolean; suppressed?: boolean; quietHours?: unknown },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${NT}/preferences`, { method: 'POST', body, tenantId: t });
export const getNotifRequests = (t?: string | null): Promise<ApiResult<{ requests: Row[] }>> =>
  call(`${NT}/requests`, { tenantId: t });
export const getNotifRequest = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${NT}/requests/${encodeURIComponent(id)}`, { tenantId: t });
export const getNotifDeliveries = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ deliveries: Row[] }>> =>
  call(`${NT}/requests/${encodeURIComponent(id)}/deliveries`, { tenantId: t });
export const retryNotifRequest = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${NT}/requests/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const cancelNotifRequest = (id: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${NT}/requests/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const getNotifTemplates = (t?: string | null): Promise<ApiResult<{ templates: Row[] }>> =>
  call(`${NT}/templates`, { tenantId: t });
export const getNotifTemplateVersions = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ versions: Row[] }>> =>
  call(`${NT}/templates/${encodeURIComponent(id)}/versions`, { tenantId: t });

// --- M09 Documents — canonical m09-docs engine, reused (no second document / content store). Metadata +
// governance (classification, legal hold, retention/disposition maker-checker with SoD, immutable versions,
// relationships, per-document access grants, the type/retention CATALOG) are REAL and server-enforced: reads are
// RLS-scoped + permission-gated (documents.document.read etc.) and every mutation is audited + carries
// expectedVersion where required. Byte UPLOAD/DOWNLOAD is FRAMEWORK-ONLY on staging (no object store bound):
// `versions/:id/complete` fails closed and `versions/:id/download` returns not-found — so this client exposes the
// `initiate` step + a download button but NEVER fabricates bytes or a scan result; the workspace surfaces the
// storage limitation truthfully. Per-document grants are recorded + audited GOVERNANCE, not a read/download
// boundary (denial = RBAC permission + tenant RLS). This client adds no authorization of its own. ---
const DOC = '/documents';
export const getDocuments = (
  t?: string | null,
  filters?: Record<string, string>,
): Promise<ApiResult<{ documents: Row[] }>> => {
  const qs = filters
    ? '?' +
      Object.entries(filters)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  return call(`${DOC}/documents${qs}`, { tenantId: t });
};
export const getDocument = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}`, { tenantId: t });
export const getDocumentVersions = (id: string, t?: string | null): Promise<ApiResult<{ versions: Row[] }>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}/versions`, { tenantId: t });
export const getVersionScans = (id: string, t?: string | null): Promise<ApiResult<{ scans: Row[] }>> =>
  call(`${DOC}/versions/${encodeURIComponent(id)}/scans`, { tenantId: t });
export const getDocumentRelationships = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ relationships: Row[] }>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}/relationships`, { tenantId: t });
export const getDocumentGrants = (id: string, t?: string | null): Promise<ApiResult<{ grants: Row[] }>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}/grants`, { tenantId: t });
export const getDocumentLegalHold = (
  id: string,
  t?: string | null,
): Promise<ApiResult<{ hold: Row | null }>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}/legal-hold`, { tenantId: t });
export const getDisposition = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${DOC}/dispositions/${encodeURIComponent(id)}`, { tenantId: t });
export const getDocTypes = (t?: string | null): Promise<ApiResult<{ types: Row[] }>> =>
  call(`${DOC}/types`, { tenantId: t });
export const getRetentionPolicies = (t?: string | null): Promise<ApiResult<{ retentionPolicies: Row[] }>> =>
  call(`${DOC}/retention-policies`, { tenantId: t });
export const createDocument = (body: Record<string, unknown>, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${DOC}/documents`, { method: 'POST', body, tenantId: t });
export const updateDocumentClassification = (
  id: string,
  ev: number,
  classification: string,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}/classification`, {
    method: 'POST',
    body: { expectedVersion: ev, classification },
    tenantId: t,
  });
export const initiateDocVersion = (
  id: string,
  body: { filename: string; mediaType: string; changeSummary?: string },
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}/versions/initiate`, {
    method: 'POST',
    body,
    tenantId: t,
  });
export const archiveDocument = (id: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}/archive`, { method: 'POST', tenantId: t });
export const placeLegalHold = (id: string, reason: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}/legal-holds`, {
    method: 'POST',
    body: { reason },
    tenantId: t,
  });
export const releaseLegalHold = (holdId: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${DOC}/legal-holds/${encodeURIComponent(holdId)}/release`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const requestDisposition = (
  id: string,
  action: string,
  reason: string,
  t?: string | null,
): Promise<ApiResult<Row>> =>
  call(`${DOC}/documents/${encodeURIComponent(id)}/dispositions`, {
    method: 'POST',
    body: { action, reason },
    tenantId: t,
  });
export const approveDisposition = (dispId: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${DOC}/dispositions/${encodeURIComponent(dispId)}/approve`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const executeDisposition = (dispId: string, ev: number, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${DOC}/dispositions/${encodeURIComponent(dispId)}/execute`, {
    method: 'POST',
    body: { expectedVersion: ev },
    tenantId: t,
  });
export const addDocumentRelationship = (
  body: { fromDocumentId: string; toDocumentId: string; relationshipType: string },
  t?: string | null,
): Promise<ApiResult<Row>> => call(`${DOC}/relationships`, { method: 'POST', body, tenantId: t });
// Byte transfer is framework-only on staging: this POSTs the server-mediated download authorization, which fails
// closed (no stored object) — the workspace surfaces the returned error as a storage limitation, never a file.
export const downloadDocumentVersion = (versionId: string, t?: string | null): Promise<ApiResult<Row>> =>
  call(`${DOC}/versions/${encodeURIComponent(versionId)}/download`, { method: 'POST', tenantId: t });

// --- administration: users & access (reuses the CANONICAL m02 identity / rbac APIs — NO second identity
// engine). Identities + accounts are GLOBAL resources; memberships, roles and assignments are TENANT-scoped
// (RLS, no escape). Every write is a canonical permissioned + audited endpoint; the server is authoritative,
// this client adds no authorization of its own. Lifecycle is modelled as named POST actions (activate /
// suspend / reactivate / close / end / retire / revoke) — there is NO hard delete anywhere in the platform. ---

// SELF effective permissions for the selected tenant (GET /auth/permissions) — used to HIDE actions the actor
// cannot perform. The server still 403s a hidden action if called directly (UI is not the authz source).
export async function getMyPermissions(
  t?: string | null,
): Promise<ApiResult<{ actorId: string; tenantId: string | null; permissions: string[] }>> {
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
