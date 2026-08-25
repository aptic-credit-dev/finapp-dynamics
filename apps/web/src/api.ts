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
