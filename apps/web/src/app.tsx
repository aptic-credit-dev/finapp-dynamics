import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from './api.ts';

// ---------- helpers ----------
type Session = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const pick = (row: api.Row, ...keys: string[]): string => {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null && row[k] !== '') return String(row[k]);
  return '';
};
// reconciliation match semantics — label + glyph + colour (never colour alone)
function matchPill(status: string, confidence?: string): JSX.Element {
  const s = (status || confidence || '').toLowerCase();
  if (s.includes('exact') || s.includes('confirm') || s.includes('100') || s.includes('matched'))
    return (
      <span className="pill ok">
        <span className="glyph">✓</span> Exact match
      </span>
    );
  if (s.includes('probable') || s.includes('likely') || s.includes('fuzzy') || s.includes('suggest'))
    return (
      <span className="pill info">
        <span className="glyph">≈</span> Probable match
      </span>
    );
  if (s.includes('split') || s.includes('partial'))
    return (
      <span className="pill warn">
        <span className="glyph">⧉</span> Split / partial
      </span>
    );
  if (s.includes('exception') || s.includes('unmatch') || s.includes('unresolved') || s.includes('reject'))
    return (
      <span className="pill bad">
        <span className="glyph">!</span> Unmatched
      </span>
    );
  return (
    <span className="pill warn">
      <span className="glyph">?</span> {status || 'Pending review'}
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

function Reconciliation({ tenant }: { tenant: string | null }): JSX.Element {
  const imports = useRows(() => api.getGlImports(tenant), [tenant]);
  return (
    <>
      <h1 className="page-title">Reconciliation workspace</h1>
      <p className="page-sub">
        Match confidence uses labels + glyphs, never colour alone. Adjustments post through maker-checker
        journals (server-enforced).
      </p>
      <div className="card">
        <header>
          <h3>GL / statement imports &amp; runs</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        {imports.loading ? (
          <div className="loading">Loading imports…</div>
        ) : imports.rows.length === 0 ? (
          <div className="empty">
            No imports/runs yet. Import a statement or seed synthetic data to see the matching workspace.
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
  { id: 'exceptions', label: 'Exceptions', icon: '!', group: 'Treasury', placeholder: true },
  { id: 'reports', label: 'Reports', icon: '▤', group: 'Treasury', placeholder: true },
];

function Shell({ session, onOut }: { session: Session; onOut: () => void }): JSX.Element {
  const [route, setRoute] = useState('dashboard');
  const tenants = useMemo(() => {
    const t = session['tenant_ids'] ?? session['tenants'] ?? session['tenantId'] ?? session['tenant_id'];
    if (Array.isArray(t)) return t.map(String);
    if (typeof t === 'string' && t) return [t];
    return [];
  }, [session]);
  const [tenant, setTenant] = useState<string | null>(tenants[0] ?? null);
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
          {tenants.length > 1 && (
            <select
              className="tenant-select"
              value={tenant ?? ''}
              onChange={(e) => setTenant(e.target.value || null)}
              title="Tenant context"
            >
              {tenants.map((t) => (
                <option key={t} value={t}>
                  Tenant {t.slice(0, 8)}
                </option>
              ))}
            </select>
          )}
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
        {route === 'exceptions' && <Placeholder title="Reconciliation exceptions" />}
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
