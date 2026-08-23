import { useCallback, useEffect, useState } from 'react';
import * as api from './api.ts';

// ---------- helpers ----------
type Session = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const pick = (row: api.Row, ...keys: string[]): string => {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null && row[k] !== '') return String(row[k]);
  return '';
};
// Format integer MINOR units for DISPLAY. The value is a string end-to-end and is NEVER parsed to a float
// (ADR-007) — the decimal point is inserted by string surgery so no rounding error can be introduced.
const fmtMinor = (v: unknown): string => {
  const s = str(v).trim();
  if (s === '' || !/^-?\d+$/.test(s)) return '—';
  const neg = s.startsWith('-');
  const padded = (neg ? s.slice(1) : s).padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  return `${neg ? '-' : ''}${whole}.${padded.slice(-2)}`;
};
// Reconciliation status semantics — label + glyph + colour (never colour alone). Accepts one or more signals
// (e.g. confidence band + match type + status); the FIRST that classifies wins. Order matters: "unmatched"
// is tested before "matched" (and "matched" is word-bounded) so an unmatched item is never mislabelled as an
// exact match — `'unmatched'.includes('matched')` is true, which the old ordering got wrong. Real
// gl_reconciliation confidence bands are exact / strong / partial / review / unmatched; match types include
// split; so those vocabularies are recognised alongside the generic words.
function matchPill(...signals: (string | undefined)[]): JSX.Element {
  const s = signals.filter(Boolean).join(' ').toLowerCase();
  const has = (...keys: string[]): boolean => keys.some((k) => s.includes(k));
  if (has('unmatch', 'exception', 'unresolved', 'reject'))
    return (
      <span className="pill bad">
        <span className="glyph">!</span> Unmatched
      </span>
    );
  if (has('split', 'partial'))
    return (
      <span className="pill warn">
        <span className="glyph">⧉</span> Split / partial
      </span>
    );
  if (has('probable', 'strong', 'likely', 'fuzzy', 'suggest'))
    return (
      <span className="pill info">
        <span className="glyph">≈</span> Probable match
      </span>
    );
  if (has('exact', 'confirm') || /\bmatched\b/.test(s) || s.includes('100'))
    return (
      <span className="pill ok">
        <span className="glyph">✓</span> Exact match
      </span>
    );
  if (has('active', 'completed', 'reconciled', 'resolved', 'cleared'))
    return (
      <span className="pill ok">
        <span className="glyph">✓</span> {signals.find(Boolean) || 'OK'}
      </span>
    );
  return (
    <span className="pill warn">
      <span className="glyph">?</span> {signals.find(Boolean) || 'Pending review'}
    </span>
  );
}

// ---------- login ----------
function Login({ onIn }: { onIn: (s: Session) => void }): JSX.Element {
  const [id, setId] = useState('stg_admin_login');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await api.login(id, pw);
    if (!r.ok) {
      setErr(r.status === 401 ? 'Invalid credentials.' : (r.error ?? 'Login failed.'));
      setBusy(false);
      return;
    }
    const s = await api.getSession();
    onIn(s.data ?? { authenticated: true });
  };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <span className="mark">A</span> Aptic Dynamics
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Financial operations platform — staging environment
        </p>
        <div className="field">
          <label>Login</label>
          <input value={id} onChange={(e) => setId(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn" disabled={busy || pw === ''}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted" style={{ fontSize: 11, marginTop: 16, textAlign: 'center' }}>
          Authorised staging access only · synthetic data · M02 RBAC enforced server-side
        </p>
      </form>
    </div>
  );
}

// ---------- data hook ----------
function useRows(
  fn: () => Promise<api.ApiResult<unknown>>,
  deps: unknown[],
): {
  rows: api.Row[];
  loading: boolean;
  error: string | null;
} {
  const [rows, setRows] = useState<api.Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void fn().then((r) => {
      if (!live) return;
      if (r.ok) {
        setRows(api.asRows(r.data));
        setError(null);
      } else setError(r.error);
      setLoading(false);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { rows, loading, error };
}

// ---------- screens ----------
function Dashboard({ tenant }: { tenant: string | null }): JSX.Element {
  const accounts = useRows(() => api.getAccounts(tenant), [tenant]);
  const imports = useRows(() => api.getGlImports(tenant), [tenant]);
  const balances = useRows(() => api.getBalances(tenant), [tenant]);
  const tiles = [
    { k: 'Bank / GL accounts', v: accounts.rows.length },
    { k: 'GL imports', v: imports.rows.length },
    { k: 'Balance records', v: balances.rows.length },
    {
      k: 'Reconciled accounts',
      v: accounts.rows.filter((a) =>
        pick(a, 'status', 'reconciliation_status').toLowerCase().includes('recon'),
      ).length,
    },
  ];
  return (
    <>
      <h1 className="page-title">Treasury &amp; Reconciliation</h1>
      <p className="page-sub">Bank ↔ general-ledger reconciliation overview · synthetic staging data</p>
      <div className="tiles">
        {tiles.map((t) => (
          <div className="tile" key={t.k}>
            <div className="k">{t.k}</div>
            <div className="v">{accounts.loading ? '—' : t.v}</div>
          </div>
        ))}
      </div>
      <AccountsCard tenant={tenant} />
    </>
  );
}

function AccountsCard({ tenant }: { tenant: string | null }): JSX.Element {
  const { rows, loading, error } = useRows(() => api.getAccounts(tenant), [tenant]);
  return (
    <div className="card">
      <header>
        <h3>Bank &amp; GL accounts</h3>
        <span className="demo-note">SYNTHETIC</span>
      </header>
      {loading ? (
        <div className="loading">Loading accounts…</div>
      ) : error ? (
        <div className="empty">Could not load accounts ({error}).</div>
      ) : rows.length === 0 ? (
        <div className="empty">No accounts yet. Seed synthetic data to populate this view.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Bank</th>
              <th>Number</th>
              <th>Currency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={pick(a, 'id', 'account_id') || i}>
                <td>{pick(a, 'name', 'account_name', 'display_name', 'code') || '—'}</td>
                <td>{pick(a, 'bank', 'bank_name', 'institution') || '—'}</td>
                <td className="muted">
                  {pick(a, 'account_number_masked', 'masked_number', 'number') || '••••'}
                </td>
                <td>{pick(a, 'currency', 'currency_code') || '—'}</td>
                <td>{matchPill(pick(a, 'status', 'reconciliation_status', 'state'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Slide-over showing one match and its matched lines. Read-only: confirm/reject/adjust are maker-checker
// actions that post server-side; this build surfaces the evidence, not a second posting path.
function MatchDrawer({
  matchId,
  tenant,
  onClose,
}: {
  matchId: string;
  tenant: string | null;
  onClose: () => void;
}): JSX.Element {
  const [match, setMatch] = useState<api.Row | null>(null);
  const [lines, setLines] = useState<api.Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([api.getMatch(matchId, tenant), api.getMatchLines(matchId, tenant)]).then(([m, l]) => {
      if (!live) return;
      if (m.ok) setMatch((m.data as api.Row | null) ?? null);
      else setError(m.error);
      if (l.ok) setLines(api.asRows(l.data));
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [matchId, tenant]);
  const m = match ?? {};
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Match detail">
        <header className="drawer-head">
          <h3>Match detail</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        {loading ? (
          <div className="loading">Loading match…</div>
        ) : error ? (
          <div className="empty">Could not load match ({error}).</div>
        ) : (
          <div className="drawer-body">
            <div className="drawer-status">
              {matchPill(pick(m, 'confidenceBand'), pick(m, 'matchType'), pick(m, 'status'))}
            </div>
            <dl className="kv">
              <dt>Type</dt>
              <dd>{pick(m, 'matchType') || '—'}</dd>
              <dt>Confidence</dt>
              <dd>{pick(m, 'confidenceBand') || '—'}</dd>
              <dt>Score</dt>
              <dd>{pick(m, 'score') || '—'}</dd>
              <dt>Amount variance</dt>
              <dd>{fmtMinor(m['amountVarianceMinor'])}</dd>
              <dt>Matched by</dt>
              <dd>{pick(m, 'matchedBy') || '—'}</dd>
            </dl>
            <h4 className="drawer-sub">Matched lines</h4>
            {lines.length === 0 ? (
              <div className="empty">No lines recorded on this match.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Line</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln, i) => (
                    <tr key={pick(ln, 'id') || i}>
                      <td>{pick(ln, 'side') || '—'}</td>
                      <td className="muted">{pick(ln, 'glLineId', 'sourceLineId', 'id') || '—'}</td>
                      <td className="num">{fmtMinor(ln['amountMinor'])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

// Runs → matches, with a click-through match drawer. A run is picked (most recent first); its matches load
// on demand. Everything is tenant-scoped — the API enforces membership + RLS on every call.
function RunsWorkspace({ tenant }: { tenant: string | null }): JSX.Element {
  const runs = useRows(() => api.getRuns(tenant), [tenant]);
  const [runId, setRunId] = useState<string | null>(null);
  const [openMatch, setOpenMatch] = useState<string | null>(null);
  const selectedRun = runId ?? (runs.rows[0] ? pick(runs.rows[0], 'id') : null);
  const matches = useRows(
    () =>
      selectedRun
        ? api.getRunMatches(selectedRun, tenant)
        : Promise.resolve({ ok: true, status: 200, data: [], error: null }),
    [selectedRun, tenant],
  );
  return (
    <div className="card">
      <header>
        <h3>Reconciliation runs &amp; matches</h3>
        <span className="demo-note">SYNTHETIC</span>
      </header>
      {runs.loading ? (
        <div className="loading">Loading runs…</div>
      ) : runs.rows.length === 0 ? (
        <div className="empty">
          No reconciliation runs yet. Seed synthetic runs/matches to populate the matching workspace.
        </div>
      ) : (
        <>
          <div className="run-picker">
            <label>Run</label>
            <select value={selectedRun ?? ''} onChange={(e) => setRunId(e.target.value || null)}>
              {runs.rows.map((r, i) => {
                const id = pick(r, 'id');
                return (
                  <option key={id || i} value={id}>
                    {(pick(r, 'periodStart') || 'run') +
                      '…' +
                      pick(r, 'periodEnd') +
                      ` · ${pick(r, 'status')} · ${pick(r, 'matchedCount') || 0}✓ / ${pick(r, 'exceptionCount') || 0}!`}
                  </option>
                );
              })}
            </select>
          </div>
          {matches.loading ? (
            <div className="loading">Loading matches…</div>
          ) : matches.rows.length === 0 ? (
            <div className="empty">This run has no matches to show.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Type</th>
                  <th className="num">Variance</th>
                  <th>Confidence</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {matches.rows.map((mt, i) => {
                  const id = pick(mt, 'id');
                  return (
                    <tr key={id || i}>
                      <td>
                        {matchPill(pick(mt, 'confidenceBand'), pick(mt, 'matchType'), pick(mt, 'status'))}
                      </td>
                      <td>{pick(mt, 'matchType') || '—'}</td>
                      <td className="num">{fmtMinor(mt['amountVarianceMinor'])}</td>
                      <td className="muted">{pick(mt, 'confidenceBand') || '—'}</td>
                      <td>
                        <button className="btn link" onClick={() => setOpenMatch(id)} disabled={id === ''}>
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
      {openMatch && <MatchDrawer matchId={openMatch} tenant={tenant} onClose={() => setOpenMatch(null)} />}
    </div>
  );
}

function Reconciliation({ tenant }: { tenant: string | null }): JSX.Element {
  const imports = useRows(() => api.getGlImports(tenant), [tenant]);
  return (
    <>
      <h1 className="page-title">Reconciliation workspace</h1>
      <p className="page-sub">
        Match confidence uses labels + glyphs, never colour alone. Adjustments post through maker-checker
        journals (server-enforced).
      </p>
      <RunsWorkspace tenant={tenant} />
      <div className="card">
        <header>
          <h3>GL / statement imports</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        {imports.loading ? (
          <div className="loading">Loading imports…</div>
        ) : imports.rows.length === 0 ? (
          <div className="empty">
            No imports yet. Import a statement or seed synthetic data to see the matching workspace.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Import</th>
                <th>Account</th>
                <th>Period</th>
                <th className="num">Lines</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {imports.rows.map((im, i) => (
                <tr key={pick(im, 'id') || i}>
                  <td>{pick(im, 'reference', 'name', 'id') || '—'}</td>
                  <td>{pick(im, 'account_name', 'account_id', 'account') || '—'}</td>
                  <td className="muted">
                    {pick(im, 'period', 'statement_period', 'as_of', 'created_at') || '—'}
                  </td>
                  <td className="num">{pick(im, 'line_count', 'lines', 'total') || '—'}</td>
                  <td>{matchPill(pick(im, 'status', 'state'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <header>
          <h3>Match confidence legend</h3>
        </header>
        <div style={{ padding: '14px 16px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {matchPill('exact')}
          {matchPill('probable')}
          {matchPill('split')}
          {matchPill('unmatched')}
          {matchPill('pending review')}
        </div>
      </div>
    </>
  );
}

// Real Exceptions screen (ADR-134 tenant context + existing gl-reconciliation API). Exceptions are per-run;
// the most recent run is shown first, with a run selector. Resolve/assign/waive are server-side maker-checker
// actions — this surface lists and explains them, it does not add a second write path.
function Exceptions({ tenant }: { tenant: string | null }): JSX.Element {
  const runs = useRows(() => api.getRuns(tenant), [tenant]);
  const [runId, setRunId] = useState<string | null>(null);
  const selectedRun = runId ?? (runs.rows[0] ? pick(runs.rows[0], 'id') : null);
  const exceptions = useRows(
    () =>
      selectedRun
        ? api.getRunExceptions(selectedRun, tenant)
        : Promise.resolve({ ok: true, status: 200, data: [], error: null }),
    [selectedRun, tenant],
  );
  return (
    <>
      <h1 className="page-title">Reconciliation exceptions</h1>
      <p className="page-sub">
        Unmatched, split and out-of-tolerance items awaiting a human decision. Assignment and resolution are
        maker-checker actions enforced server-side.
      </p>
      <div className="card">
        <header>
          <h3>Exceptions</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        {runs.loading ? (
          <div className="loading">Loading runs…</div>
        ) : runs.rows.length === 0 ? (
          <div className="empty">No reconciliation runs yet — nothing to show exceptions for.</div>
        ) : (
          <>
            <div className="run-picker">
              <label>Run</label>
              <select value={selectedRun ?? ''} onChange={(e) => setRunId(e.target.value || null)}>
                {runs.rows.map((r, i) => {
                  const id = pick(r, 'id');
                  return (
                    <option key={id || i} value={id}>
                      {(pick(r, 'periodStart') || 'run') + '…' + pick(r, 'periodEnd')} ·{' '}
                      {pick(r, 'exceptionCount') || 0} exceptions
                    </option>
                  );
                })}
              </select>
            </div>
            {exceptions.loading ? (
              <div className="loading">Loading exceptions…</div>
            ) : exceptions.rows.length === 0 ? (
              <div className="empty">No exceptions on this run — everything reconciled.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th className="num">Age (days)</th>
                    <th>Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.rows.map((ex, i) => (
                    <tr key={pick(ex, 'id') || i}>
                      <td>{pick(ex, 'exceptionType') || '—'}</td>
                      <td>{matchPill(pick(ex, 'status'))}</td>
                      <td className="muted">{pick(ex, 'reason') || '—'}</td>
                      <td className="num">{pick(ex, 'ageDays') || '0'}</td>
                      <td className="muted">{pick(ex, 'assignedTo') || 'Unassigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Placeholder({ title }: { title: string }): JSX.Element {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <p className="page-sub">
        This module surface is planned. Backend capabilities are available via the API.
      </p>
      <div className="card">
        <div className="empty">
          {title} — coming in a follow-up increment. This build focuses on Treasury &amp; Reconciliation.
        </div>
      </div>
    </>
  );
}

// ---------- shell ----------
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '▚', group: 'Overview' },
  { id: 'reconciliation', label: 'Reconciliation', icon: '⇄', group: 'Treasury' },
  { id: 'accounts', label: 'Bank accounts', icon: '🏦', group: 'Treasury' },
  { id: 'exceptions', label: 'Exceptions', icon: '!', group: 'Treasury' },
  { id: 'reports', label: 'Reports', icon: '▤', group: 'Treasury', placeholder: true },
];

const TENANT_KEY = 'aptic.tenant';
// The stored/URL tenant is only ever a CANDIDATE. It is never trusted until validated against the caller's
// authorised tenants (ADR-134 GET /auth/tenants) — a stale or inaccessible id is discarded, and a tenant the
// caller cannot access is never selected or displayed. The API additionally enforces membership + RLS server-side.
function tenantCandidate(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('tenant');
    if (q) return q;
    return window.localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}
function persistTenant(t: string | null): void {
  try {
    if (t) window.localStorage.setItem(TENANT_KEY, t);
    else window.localStorage.removeItem(TENANT_KEY);
  } catch {
    /* ignore */
  }
}

// Governed tenant switcher (ADR-134): options come ONLY from the caller's authorised tenants. One membership →
// a static label (auto-selected, no manual entry); several → a real dropdown; none → a clear "no access" state.
// A raw UUID field is never shown — management no longer pastes tenant ids.
function TenantSwitcher({
  tenants,
  tenant,
  onSelect,
}: {
  tenants: api.SelfTenant[] | null;
  tenant: string | null;
  onSelect: (t: string | null) => void;
}): JSX.Element {
  if (tenants === null) return <span className="tenant-select muted">Loading tenants…</span>;
  if (tenants.length === 0)
    return (
      <span className="tenant-select muted" title="Your account has no active tenant membership.">
        No tenant access
      </span>
    );
  if (tenants.length === 1) {
    const only = tenants[0];
    return (
      <span className="tenant-select" title={only.tenantId}>
        {only.name || only.code}
      </span>
    );
  }
  return (
    <select
      className="tenant-select"
      value={tenant ?? ''}
      onChange={(e) => onSelect(e.target.value || null)}
      title="Select tenant context — only tenants you are a member of are shown."
      style={{ width: 210 }}
    >
      {tenants.map((t) => (
        <option key={t.tenantId} value={t.tenantId}>
          {(t.name || t.code) + (t.isPrimary ? ' ★' : '')}
        </option>
      ))}
    </select>
  );
}

function Shell({ session, onOut }: { session: Session; onOut: () => void }): JSX.Element {
  const [route, setRoute] = useState('dashboard');
  // `tenants === null` = still discovering; `[]` = caller has no selectable tenant. `tenant` is ALWAYS either
  // null or an id present in `tenants` — never an unvalidated candidate.
  const [tenants, setTenants] = useState<api.SelfTenant[] | null>(null);
  const [tenant, setTenantState] = useState<string | null>(null);
  const setTenant = (t: string | null): void => {
    setTenantState(t);
    persistTenant(t);
  };
  useEffect(() => {
    let live = true;
    void api.getTenants().then((r) => {
      if (!live) return;
      const list = r.ok && r.data ? r.data.tenants : [];
      setTenants(list);
      const candidate = tenantCandidate();
      // preserve ?tenant=/stored ONLY if it is in the authorised list; otherwise discard it and fall back to
      // the primary membership (or the first authorised tenant). Never keep an inaccessible id.
      const validated = candidate && list.some((t) => t.tenantId === candidate) ? candidate : null;
      if (candidate && !validated) persistTenant(null);
      const chosen =
        validated ?? (list.length > 0 ? (list.find((t) => t.isPrimary)?.tenantId ?? list[0].tenantId) : null);
      setTenantState(chosen);
      persistTenant(chosen);
    });
    return () => {
      live = false;
    };
  }, []);
  const who =
    str(session['login'] ?? session['username'] ?? session['account'] ?? session['display_name']) || 'User';
  const initials =
    who
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 2)
      .toUpperCase() || 'AD';
  const grouped = NAV.reduce<Record<string, typeof NAV>>((acc, n) => {
    (acc[n.group] ??= []).push(n);
    return acc;
  }, {});
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">A</span> Aptic Dynamics
        </div>
        {Object.entries(grouped).map(([g, items]) => (
          <div key={g}>
            <div className="nav-section">{g}</div>
            {items.map((n) => (
              <button
                key={n.id}
                className={`nav-item ${route === n.id ? 'active' : ''}`}
                onClick={() => setRoute(n.id)}
              >
                <span aria-hidden>{n.icon}</span> {n.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <header className="topbar">
        <div className="title">{NAV.find((n) => n.id === route)?.label ?? 'Aptic Dynamics'}</div>
        <div className="right">
          <TenantSwitcher tenants={tenants} tenant={tenant} onSelect={setTenant} />
          <div className="usermenu">
            <div className="avatar">{initials}</div>
            <span>{who}</span>
          </div>
          <button className="btn secondary" onClick={onOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="main">
        {route === 'dashboard' && <Dashboard tenant={tenant} />}
        {route === 'reconciliation' && <Reconciliation tenant={tenant} />}
        {route === 'accounts' && (
          <>
            <h1 className="page-title">Bank accounts</h1>
            <p className="page-sub">Accounts under reconciliation · synthetic staging data</p>
            <AccountsCard tenant={tenant} />
          </>
        )}
        {route === 'exceptions' && <Exceptions tenant={tenant} />}
        {route === 'reports' && <Placeholder title="Reconciliation reports" />}
      </main>
    </div>
  );
}

// ---------- root ----------
export function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    void api.getSession().then((r) => {
      if (r.ok) setSession(r.data ?? {});
      setChecking(false);
    });
  }, []);
  const signOut = useCallback(async () => {
    await api.logout();
    setSession(null);
  }, []);
  if (checking)
    return (
      <>
        <div className="staging-banner">STAGING · SYNTHETIC DATA · NOT PRODUCTION</div>
        <div className="loading" style={{ padding: 40 }}>
          Loading…
        </div>
      </>
    );
  return (
    <>
      <div className="staging-banner">STAGING · SYNTHETIC DATA · NOT PRODUCTION</div>
      {session ? <Shell session={session} onOut={signOut} /> : <Login onIn={setSession} />}
    </>
  );
}
