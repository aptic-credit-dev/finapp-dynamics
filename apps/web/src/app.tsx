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
  const runs = useRows(() => api.getRuns(tenant), [tenant]);
  // GL imports and balances are per-account endpoints — aggregate across the tenant's accounts once they load.
  const [agg, setAgg] = useState<{ imports: number; balances: number } | null>(null);
  const acctKey = accounts.rows.map((a) => pick(a, 'id', 'account_id')).join(',');
  useEffect(() => {
    let live = true;
    setAgg(null);
    if (accounts.loading) return;
    const ids = accounts.rows.map((a) => pick(a, 'id', 'account_id')).filter(Boolean);
    if (ids.length === 0) {
      setAgg({ imports: 0, balances: 0 });
      return;
    }
    void Promise.all(
      ids.map(async (id) => ({
        imports: api.asRows((await api.getGlImports(id, tenant)).data).length,
        balances: api.asRows((await api.getBalances(id, tenant)).data).length,
      })),
    ).then((per) => {
      if (!live) return;
      setAgg({
        imports: per.reduce((s, x) => s + x.imports, 0),
        balances: per.reduce((s, x) => s + x.balances, 0),
      });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, accounts.loading, acctKey]);
  const dash = (v: number | undefined): string => (accounts.loading || v === undefined ? '—' : String(v));
  const tiles = [
    { k: 'Bank / GL accounts', v: accounts.loading ? '—' : String(accounts.rows.length) },
    { k: 'GL imports', v: dash(agg?.imports) },
    { k: 'Balance records', v: dash(agg?.balances) },
    { k: 'Reconciliation runs', v: runs.loading ? '—' : String(runs.rows.length) },
  ];
  return (
    <>
      <h1 className="page-title">Treasury &amp; Reconciliation</h1>
      <p className="page-sub">Bank ↔ general-ledger reconciliation overview · synthetic staging data</p>
      <div className="tiles">
        {tiles.map((t) => (
          <div className="tile" key={t.k}>
            <div className="k">{t.k}</div>
            <div className="v">{t.v}</div>
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

// GL imports are per-account on the API; this card loads the tenant's accounts then their imports and shows
// them together (with the owning account name), so the tenant-wide view works despite the per-account endpoint.
function ImportsCard({ tenant }: { tenant: string | null }): JSX.Element {
  const accounts = useRows(() => api.getAccounts(tenant), [tenant]);
  const [rows, setRows] = useState<api.Row[] | null>(null);
  const acctKey = accounts.rows.map((a) => pick(a, 'id', 'account_id')).join(',');
  useEffect(() => {
    let live = true;
    setRows(null);
    if (accounts.loading) return;
    const accts = accounts.rows.map((a) => ({
      id: pick(a, 'id', 'account_id'),
      name: pick(a, 'name', 'code'),
    }));
    if (accts.length === 0) {
      setRows([]);
      return;
    }
    void Promise.all(
      accts
        .filter((a) => a.id)
        .map(async (a) =>
          api.asRows((await api.getGlImports(a.id, tenant)).data).map((im) => ({ ...im, _account: a.name })),
        ),
    ).then((per) => {
      if (live) setRows(per.flat());
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, accounts.loading, acctKey]);
  return (
    <div className="card">
      <header>
        <h3>GL / statement imports</h3>
        <span className="demo-note">SYNTHETIC</span>
      </header>
      {rows === null ? (
        <div className="loading">Loading imports…</div>
      ) : rows.length === 0 ? (
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
              <th>Format</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((im, i) => (
              <tr key={pick(im, 'id') || i}>
                <td>{pick(im, 'fileName', 'reference', 'name', 'id') || '—'}</td>
                <td>{pick(im, '_account', 'glAccountId') || '—'}</td>
                <td className="muted">
                  {pick(im, 'periodStart') ? `${pick(im, 'periodStart')}…${pick(im, 'periodEnd')}` : '—'}
                </td>
                <td className="muted">{pick(im, 'sourceFormat', 'format') || '—'}</td>
                <td>{matchPill(pick(im, 'status', 'state'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Parse a major-unit amount string ("450" / "450.5" / "450.55") to INTEGER minor units without float.
const toMinorUnits = (v: string): number | null => {
  const m = v.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 100 + parseInt((m[2] ?? '').padEnd(2, '0'), 10);
};

// Propose a reconciliation adjustment via the CANONICAL M21 maker-checker journal path (create balanced draft
// → validate → submit → PENDING APPROVAL). No posting: a separate approver authorises server-side (M22 SoD).
function ProposeAdjustment({
  tenant,
  onClose,
  onDone,
}: {
  tenant: string | null;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [desc, setDesc] = useState('Reconciliation adjustment');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const minor = toMinorUnits(amount);
  const submit = async (): Promise<void> => {
    if (minor === null || minor <= 0) {
      setResult({ ok: false, msg: 'Enter a positive amount (e.g. 450.00).' });
      return;
    }
    setBusy(true);
    setResult(null);
    // entity/account refs are the (synthetic) tenant reconciliation context; the workflow — not the specific
    // account master data — is what this demonstrates. Two balanced lines: DR suspense / CR bank clearing.
    const r = await api.proposeAdjustment(tenant, {
      description: desc,
      entityRef: tenant ?? '',
      lines: [
        {
          direction: 'debit',
          amountMinor: minor,
          accountRef: tenant ?? undefined,
          description: 'DR — Reconciliation suspense',
        },
        {
          direction: 'credit',
          amountMinor: minor,
          accountRef: tenant ?? undefined,
          description: 'CR — Bank clearing',
        },
      ],
    });
    setBusy(false);
    if (r.ok) {
      setResult({
        ok: true,
        msg: 'Adjustment proposed — status PENDING APPROVAL. A separate approver must authorise it; you cannot approve your own.',
      });
      onDone();
    } else {
      setResult({ ok: false, msg: r.error ?? 'Could not propose adjustment.' });
    }
  };
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Propose adjustment"
      >
        <header className="drawer-head">
          <h3>Propose adjustment</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <p className="page-sub" style={{ marginTop: 0 }}>
            Creates a <strong>balanced</strong> journal through the canonical maker-checker workflow. It is{' '}
            <strong>submitted for approval, never posted here</strong> — a separate approver authorises
            posting (segregation of duties, server-enforced).
          </p>
          <div className="field">
            <label>Description</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="field">
            <label>Amount (balanced DR/CR)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="450.00"
              inputMode="decimal"
            />
          </div>
          {minor !== null && minor > 0 && (
            <dl className="kv">
              <dt>DR — Reconciliation suspense</dt>
              <dd>{fmtMinor(minor)}</dd>
              <dt>CR — Bank clearing</dt>
              <dd>{fmtMinor(minor)}</dd>
              <dt>Balanced</dt>
              <dd>✓ debits = credits</dd>
            </dl>
          )}
          {result && <div className={result.ok ? 'ok-note' : 'error'}>{result.msg}</div>}
          <button
            className="btn"
            style={{ marginTop: 14 }}
            disabled={busy || minor === null || minor <= 0}
            onClick={submit}
          >
            {busy ? 'Proposing…' : 'Propose for approval'}
          </button>
          <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
            Synthetic staging · entity/account references are synthetic; this demonstrates the maker-checker
            workflow, not posting. M02 RBAC + M03 audit + tenant isolation apply on every step.
          </p>
        </div>
      </aside>
    </div>
  );
}

// Lists proposed adjustments (journal drafts) for the tenant and launches the Propose-adjustment modal.
function AdjustmentsCard({ tenant }: { tenant: string | null }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const drafts = useRows(() => api.getJournalDrafts(tenant), [tenant, nonce]);
  return (
    <div className="card">
      <header>
        <h3>Proposed adjustments</h3>
        <button className="btn secondary" onClick={() => setOpen(true)}>
          + Propose adjustment
        </button>
      </header>
      {drafts.loading ? (
        <div className="loading">Loading adjustments…</div>
      ) : drafts.error ? (
        <div className="empty">Could not load adjustments ({drafts.error}).</div>
      ) : drafts.rows.length === 0 ? (
        <div className="empty">No proposed adjustments yet. Use “Propose adjustment” to create one.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Amount</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {drafts.rows.map((d, i) => (
              <tr key={pick(d, 'id') || i}>
                <td>{pick(d, 'description') || '—'}</td>
                <td className="num">{fmtMinor(d['totalDebitsMinor'])}</td>
                <td className="muted">{pick(d, 'sourceType') || '—'}</td>
                <td>{adjustmentPill(pick(d, 'status'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <ProposeAdjustment
          tenant={tenant}
          onClose={() => setOpen(false)}
          onDone={() => setNonce((n) => n + 1)}
        />
      )}
    </div>
  );
}

// Journal draft status → label + colour. "submitted"/"pending" reads as PENDING APPROVAL (the key demo state).
function adjustmentPill(status: string): JSX.Element {
  const s = status.toLowerCase();
  if (s.includes('submit') || s.includes('pending') || s.includes('approval'))
    return (
      <span className="pill warn">
        <span className="glyph">⏳</span> Pending approval
      </span>
    );
  if (s.includes('post') || s.includes('approved'))
    return (
      <span className="pill ok">
        <span className="glyph">✓</span> {status}
      </span>
    );
  if (s.includes('reject') || s.includes('withdraw') || s.includes('cancel'))
    return (
      <span className="pill bad">
        <span className="glyph">!</span> {status}
      </span>
    );
  return (
    <span className="pill info">
      <span className="glyph">✎</span> {status || 'Draft'}
    </span>
  );
}

function Reconciliation({ tenant }: { tenant: string | null }): JSX.Element {
  return (
    <>
      <h1 className="page-title">Reconciliation workspace</h1>
      <p className="page-sub">
        Match confidence uses labels + glyphs, never colour alone. Adjustments post through maker-checker
        journals (server-enforced).
      </p>
      <RunsWorkspace tenant={tenant} />
      <AdjustmentsCard tenant={tenant} />
      <ImportsCard tenant={tenant} />
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

// Reports — a bank reconciliation statement per run, built entirely from existing gl-reconciliation APIs
// (runs + per-run summaries + certifications). Money is formatted from integer minor-unit strings (no float).
// Print-friendly: the "Print" button calls window.print(); print CSS hides the app chrome.
interface RunReport extends api.Row {
  _variance?: string;
  _cert?: string;
}
function Reports({ tenant }: { tenant: string | null }): JSX.Element {
  const accounts = useRows(() => api.getAccounts(tenant), [tenant]);
  const runs = useRows(() => api.getRuns(tenant), [tenant]);
  const [enriched, setEnriched] = useState<RunReport[] | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const runKey = runs.rows.map((r) => pick(r, 'id')).join(',');
  const acctName = (id: string): string => {
    const a = accounts.rows.find((x) => pick(x, 'id', 'account_id') === id);
    return a ? pick(a, 'name', 'code') || id : id;
  };
  useEffect(() => {
    let live = true;
    setEnriched(null);
    if (runs.loading) return;
    void Promise.all(
      runs.rows.map(async (r) => {
        const id = pick(r, 'id');
        const summaries = api.asRows((await api.getRunSummaries(id, tenant)).data);
        const certs = api.asRows((await api.getRunCertifications(id, tenant)).data);
        return {
          ...r,
          _variance: summaries[0] ? str(summaries[0]['balanceVarianceMinor']) : '',
          _cert: certs[0] ? pick(certs[0], 'status') : '',
        } as RunReport;
      }),
    ).then((rows) => {
      if (live) setEnriched(rows);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, runs.loading, runKey]);
  const rows = (enriched ?? []).filter(
    (r) => statusFilter === 'all' || pick(r, 'status').toLowerCase() === statusFilter,
  );
  return (
    <>
      <div className="report-head">
        <div>
          <h1 className="page-title">Reconciliation reports</h1>
          <p className="page-sub">
            Bank ↔ GL reconciliation statement per run · synthetic staging data. Built from the reconciliation
            API — read-only.
          </p>
        </div>
        <div className="report-actions no-print">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="review_required">Review required</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="draft">Draft</option>
          </select>
          <button className="btn secondary" onClick={() => window.print()} disabled={rows.length === 0}>
            Print
          </button>
        </div>
      </div>
      <div className="card">
        <header>
          <h3>Reconciliation statements</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        {enriched === null ? (
          <div className="loading">Loading reports…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No reconciliation runs match this filter.</div>
        ) : (
          <div className="report-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Period</th>
                  <th className="num">Opening</th>
                  <th className="num">GL closing</th>
                  <th className="num">Matched</th>
                  <th className="num">Unmatched</th>
                  <th className="num">Exceptions</th>
                  <th className="num">Reconciling</th>
                  <th className="num">Difference</th>
                  <th>Status</th>
                  <th>Certification</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={pick(r, 'id') || i}>
                    <td>{acctName(pick(r, 'glAccountId'))}</td>
                    <td className="muted">
                      {pick(r, 'periodStart') ? `${pick(r, 'periodStart')}…${pick(r, 'periodEnd')}` : '—'}
                    </td>
                    <td className="num">{fmtMinor(r['openingBalanceMinor'])}</td>
                    <td className="num">{fmtMinor(r['closingBalanceMinor'])}</td>
                    <td className="num">{pick(r, 'matchedCount') || '0'}</td>
                    <td className="num">{pick(r, 'unmatchedCount') || '0'}</td>
                    <td className="num">{pick(r, 'exceptionCount') || '0'}</td>
                    <td className="num">{pick(r, 'itemCount') || '0'}</td>
                    <td className="num">{r._variance ? fmtMinor(r._variance) : '—'}</td>
                    <td>{matchPill(pick(r, 'status'))}</td>
                    <td className="muted">{r._cert || 'Not certified'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="page-sub no-print" style={{ fontSize: 12 }}>
        Preparer / reviewer / approver sign-off is captured through the reconciliation certification workflow
        (maker-checker, server-enforced); certified runs show their certification status above.
      </p>
    </>
  );
}

// ---------- shell ----------
// ---------- Debt Recovery (M44) — UI over the existing m17-recovery API; no duplicate engine ----------
// The recovery lifecycle has 29 canonical statuses; group them into visible lifecycle bands for label+colour.
function recoveryPill(status: string): JSX.Element {
  const s = (status || '').toLowerCase();
  const label = (status || '').replace(/_/g, ' ') || '—';
  let cls = 'info';
  let glyph = '•';
  if (/recovered|settled|resolved|closed/.test(s)) {
    cls = 'ok';
    glyph = '✓';
  } else if (/default|write_?off|written_off|uncollectible|withdrawn/.test(s)) {
    cls = 'bad';
    glyph = '!';
  } else if (/enforcement|attachment|execution|auction|security_realization/.test(s)) {
    cls = 'bad';
    glyph = '§';
  } else if (/arrangement_active|partial_recovery|agent_recovery/.test(s)) {
    cls = 'ok';
    glyph = '≈';
  } else if (/demand|negotiation|awaiting|arrangement_pending/.test(s)) {
    cls = 'warn';
    glyph = '⏳';
  }
  return (
    <span className={`pill ${cls}`}>
      <span className="glyph">{glyph}</span> {label}
    </span>
  );
}
// Sum integer MINOR units (strings) exactly — no float; values are well within 2^53.
const sumMinor = (rows: api.Row[], key: string): number =>
  rows.reduce((s, r) => s + (Number.isInteger(Number(r[key])) ? Number(r[key]) : 0), 0);

function RecoveryDashboard({ tenant }: { tenant: string | null }): JSX.Element {
  const cases = useRows(() => api.getRecoveries(tenant), [tenant]);
  const byStatus = useRows(() => api.getRecoveryAnalytics('status', tenant), [tenant]);
  const has = (re: RegExp): number => cases.rows.filter((c) => re.test(pick(c, 'status'))).length;
  const n = (v: number): string => (cases.loading ? '—' : String(v));
  const tiles = [
    { k: 'Active recovery cases', v: cases.loading ? '—' : String(cases.rows.length) },
    { k: 'Outstanding', v: cases.loading ? '—' : fmtMinor(sumMinor(cases.rows, 'outstandingAmountMinor')) },
    { k: 'Promises to pay', v: n(has(/arrangement_active/)) },
    { k: 'Broken promises', v: n(has(/arrangement_default/)) },
    { k: 'Legal / enforcement', v: n(has(/enforcement|attachment|execution|auction/)) },
    { k: 'Litigation', v: n(has(/enforcement_active|execution|attachment|auction/)) },
    { k: 'Recovered / closed', v: n(has(/recovered|settled|resolved|closed/)) },
  ];
  return (
    <>
      <h1 className="page-title">Debt Recovery &amp; Enforcement</h1>
      <p className="page-sub">
        Collections → arrangement → enforcement → litigation → recovery, over the existing recovery API ·
        synthetic staging data. Read-only; actions stay permission-controlled + audited server-side.
      </p>
      <div className="tiles">
        {tiles.map((t) => (
          <div className="tile" key={t.k}>
            <div className="k">{t.k}</div>
            <div className="v">{t.v}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <header>
          <h3>Cases by lifecycle status</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        {byStatus.loading ? (
          <div className="loading">Loading analytics…</div>
        ) : byStatus.rows.length === 0 ? (
          <div className="empty">No recovery cases yet. Seed synthetic data to populate this view.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th className="num">Cases</th>
              </tr>
            </thead>
            <tbody>
              {byStatus.rows.map((b, i) => (
                <tr key={pick(b, 'dim', 'value', 'key', 'status') || i}>
                  <td>{recoveryPill(pick(b, 'dim', 'value', 'key', 'status', 'label'))}</td>
                  <td className="num">{pick(b, 'count', 'total', 'n', 'cases') || '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// Case-detail drawer — recovery header + notes/arrangements/demands (canonical sub-resources).
function RecoveryDrawer({
  id,
  tenant,
  onClose,
}: {
  id: string;
  tenant: string | null;
  onClose: () => void;
}): JSX.Element {
  const [rec, setRec] = useState<api.Row | null>(null);
  const [notes, setNotes] = useState<api.Row[]>([]);
  const [arrs, setArrs] = useState<api.Row[]>([]);
  const [demands, setDemands] = useState<api.Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [activity, setActivity] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([
      api.getRecovery(id, tenant),
      api.getRecoverySub(id, 'notes', tenant),
      api.getRecoverySub(id, 'arrangements', tenant),
      api.getRecoverySub(id, 'demands', tenant),
    ]).then(([r, n, a, d]) => {
      if (!live) return;
      if (r.ok) setRec((r.data as api.Row | null) ?? null);
      setNotes(api.asRows(n.data));
      setArrs(api.asRows(a.data));
      setDemands(api.asRows(d.data));
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [id, tenant, nonce]);
  const recordActivity = async (): Promise<void> => {
    if (activity.trim() === '') return;
    setSaving(true);
    setActionMsg(null);
    const res = await api.recordRecoveryNote(
      id,
      { content: activity.trim(), headline: 'Contact / activity' },
      tenant,
    );
    setSaving(false);
    if (res.ok) {
      setActivity('');
      setActionMsg({ ok: true, msg: 'Activity recorded (audited).' });
      setNonce((x) => x + 1);
    } else {
      setActionMsg({ ok: false, msg: res.error ?? 'Could not record activity.' });
    }
  };
  const r = rec ?? {};
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Recovery case">
        <header className="drawer-head">
          <h3>{pick(r, 'recoveryNumber') || 'Recovery case'}</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        {loading ? (
          <div className="loading">Loading case…</div>
        ) : (
          <div className="drawer-body">
            <div className="drawer-status">{recoveryPill(pick(r, 'status'))}</div>
            <h4 style={{ margin: '4px 0 12px' }}>{pick(r, 'title') || '—'}</h4>
            <dl className="kv">
              <dt>Type</dt>
              <dd>{pick(r, 'recoveryTypeCode') || '—'}</dd>
              <dt>Outstanding</dt>
              <dd>{fmtMinor(r['outstandingAmountMinor'])}</dd>
              <dt>Recoverable</dt>
              <dd>{fmtMinor(r['recoverableAmountMinor'])}</dd>
              <dt>Recovered</dt>
              <dd>{fmtMinor(r['recoveredAmountMinor'])}</dd>
              <dt>Enforcement stage</dt>
              <dd>{pick(r, 'enforcementStage') || '—'}</dd>
              <dt>Priority / risk</dt>
              <dd>{(pick(r, 'priority') || '—') + ' / ' + (pick(r, 'recoveryRisk') || '—')}</dd>
              <dt>Owner</dt>
              <dd>{pick(r, 'legalOwner', 'recoveryTeam', 'businessOwner') || '—'}</dd>
              <dt>Jurisdiction</dt>
              <dd>{pick(r, 'jurisdiction') || '—'}</dd>
              <dt>Legal matter (m14)</dt>
              <dd className="muted">{pick(r, 'sourceMatterId') || 'Not linked'}</dd>
              <dt>Litigation (m16)</dt>
              <dd className="muted">{pick(r, 'sourceProceedingId') || 'Not linked'}</dd>
            </dl>
            <h4 className="drawer-sub">Payment arrangements</h4>
            {arrs.length === 0 ? (
              <div className="empty">No arrangements.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {arrs.map((a, i) => (
                    <tr key={pick(a, 'id') || i}>
                      <td>{pick(a, 'arrangementType') || '—'}</td>
                      <td className="num">{fmtMinor(a['totalAmountMinor'])}</td>
                      <td>{recoveryPill(pick(a, 'status'))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h4 className="drawer-sub">Demands</h4>
            {demands.length === 0 ? (
              <div className="empty">No demands issued.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {demands.map((d, i) => (
                    <tr key={pick(d, 'id') || i}>
                      <td className="muted">{pick(d, 'demandNumber', 'reference', 'id') || '—'}</td>
                      <td>{recoveryPill(pick(d, 'status'))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h4 className="drawer-sub">Record activity</h4>
            <div className="field">
              <input
                value={activity}
                placeholder="Record a call / contact / field visit…"
                onChange={(e) => setActivity(e.target.value)}
              />
            </div>
            {actionMsg && <div className={actionMsg.ok ? 'ok-note' : 'error'}>{actionMsg.msg}</div>}
            <button
              className="btn secondary"
              style={{ marginBottom: 8 }}
              disabled={saving || activity.trim() === ''}
              onClick={recordActivity}
            >
              {saving ? 'Recording…' : 'Record activity'}
            </button>
            <p className="muted" style={{ fontSize: 11, margin: '0 0 6px' }}>
              Writes through the canonical m17 recovery service (permission recovery.case.update,
              tenant-scoped, audited as RECOVERY_NOTE_CREATED). Restricted users are denied server-side.
            </p>
            <h4 className="drawer-sub">Case timeline</h4>
            {notes.length + arrs.length + demands.length === 0 ? (
              <div className="empty">No activity recorded.</div>
            ) : (
              <ul className="timeline">
                {arrs.map((a, i) => (
                  <li key={'a' + (pick(a, 'id') || i)}>
                    <span className="t-type">arrangement</span>{' '}
                    <span className="t-head">
                      {(pick(a, 'arrangementType') || 'arrangement') +
                        ' · ' +
                        fmtMinor(a['totalAmountMinor'])}
                    </span>{' '}
                    {recoveryPill(pick(a, 'status'))}
                  </li>
                ))}
                {demands.map((d, i) => (
                  <li key={'d' + (pick(d, 'id') || i)}>
                    <span className="t-type">demand</span>{' '}
                    <span className="t-head">
                      {(pick(d, 'demandType') || 'demand').replace(/_/g, ' ') +
                        ' · ' +
                        fmtMinor(d['amountDemandedMinor'])}
                    </span>{' '}
                    {recoveryPill(pick(d, 'status'))}
                  </li>
                ))}
                {notes.map((n, i) => (
                  <li key={'n' + (pick(n, 'id') || i)}>
                    <span className="t-type">note</span>{' '}
                    <span className="t-head">{pick(n, 'headline') || pick(n, 'content') || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function RecoveryCases({ tenant }: { tenant: string | null }): JSX.Element {
  const [statusFilter, setStatusFilter] = useState('');
  const cases = useRows(
    () => api.getRecoveries(tenant, statusFilter ? { status: statusFilter } : undefined),
    [tenant, statusFilter],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const STAGES = [
    ['', 'All statuses'],
    ['referred', 'Referred (early arrears)'],
    ['negotiation', 'Negotiation (collections)'],
    ['arrangement_active', 'Arrangement active (PTP)'],
    ['arrangement_default', 'Arrangement default (broken PTP)'],
    ['enforcement_pending', 'Legal referral'],
    ['enforcement_active', 'Enforcement / litigation'],
    ['recovered', 'Recovered'],
    ['closed', 'Closed'],
  ];
  return (
    <>
      <h1 className="page-title">Recovery cases</h1>
      <p className="page-sub">
        Delinquent / recovery cases over the existing recovery API · synthetic staging data. RBAC + tenant
        isolation enforced server-side.
      </p>
      <div className="card">
        <header>
          <h3>Cases</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        <div className="run-picker">
          <label>Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {cases.loading ? (
          <div className="loading">Loading cases…</div>
        ) : cases.error ? (
          <div className="empty">Could not load recovery cases ({cases.error}).</div>
        ) : cases.rows.length === 0 ? (
          <div className="empty">No recovery cases match this filter.</div>
        ) : (
          <div className="report-scroll">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Customer / matter</th>
                  <th className="num">Outstanding</th>
                  <th>Status</th>
                  <th>Stage</th>
                  <th>Owner</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cases.rows.map((c, i) => {
                  const id = pick(c, 'id');
                  return (
                    <tr key={id || i}>
                      <td className="muted">{pick(c, 'recoveryNumber') || '—'}</td>
                      <td>{pick(c, 'title') || '—'}</td>
                      <td className="num">{fmtMinor(c['outstandingAmountMinor'])}</td>
                      <td>{recoveryPill(pick(c, 'status'))}</td>
                      <td className="muted">{pick(c, 'enforcementStage', 'strategy') || '—'}</td>
                      <td className="muted">
                        {pick(c, 'legalOwner', 'recoveryTeam', 'businessOwner') || '—'}
                      </td>
                      <td>
                        <button className="btn link" onClick={() => setOpenId(id)} disabled={id === ''}>
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {openId && <RecoveryDrawer id={openId} tenant={tenant} onClose={() => setOpenId(null)} />}
    </>
  );
}

// ---------- Regulatory & Compliance (M45) — UI over the canonical m41 GRC control register; no duplicate engine ----------
// Renders CONTROL/EVIDENCE state (an assessment), never a blanket "Aptic is compliant/certified" claim.
const FRAMEWORK_LABEL: Record<string, string> = {
  kenya_dpa: 'Data Protection (Kenya DPA / ODPC)',
  iso27001: 'ISO 27001 (ICT / security)',
  soc2: 'SOC 2',
  gdpr: 'GDPR',
  other: 'Other / internal policy',
};
function assessmentPill(status: string): JSX.Element {
  const s = (status || '').toLowerCase();
  if (s === 'compliant')
    return (
      <span className="pill ok">
        <span className="glyph">✓</span> Assessed compliant
      </span>
    );
  if (s === 'non_compliant')
    return (
      <span className="pill bad">
        <span className="glyph">!</span> Non-compliant
      </span>
    );
  if (s === 'partial')
    return (
      <span className="pill warn">
        <span className="glyph">◐</span> Partial
      </span>
    );
  return (
    <span className="pill info">
      <span className="glyph">•</span> Not assessed
    </span>
  );
}
function useControlsWithStatus(tenant: string | null): {
  rows: (api.Row & { _latest: string })[];
  loading: boolean;
  error: string | null;
} {
  const controls = useRows(() => api.getGrcControls(tenant), [tenant]);
  const [rows, setRows] = useState<(api.Row & { _latest: string })[] | null>(null);
  const key = controls.rows.map((c) => pick(c, 'id')).join(',');
  useEffect(() => {
    let live = true;
    setRows(null);
    if (controls.loading) return;
    void Promise.all(
      controls.rows.map(async (c) => {
        const a = api.asRows((await api.getGrcAssessments(pick(c, 'id'), tenant)).data);
        return { ...c, _latest: a[0] ? pick(a[0], 'status') : 'not_assessed' };
      }),
    ).then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, controls.loading, key]);
  return { rows: rows ?? [], loading: controls.loading || rows === null, error: controls.error };
}

function ComplianceDashboard({ tenant }: { tenant: string | null }): JSX.Element {
  const { rows, loading } = useControlsWithStatus(tenant);
  const count = (st: string): number => rows.filter((r) => r._latest === st).length;
  const tiles = [
    { k: 'Controls tracked', v: loading ? '—' : String(rows.length) },
    { k: 'Assessed compliant', v: loading ? '—' : String(count('compliant')) },
    { k: 'Partial', v: loading ? '—' : String(count('partial')) },
    { k: 'Non-compliant', v: loading ? '—' : String(count('non_compliant')) },
    { k: 'Not assessed', v: loading ? '—' : String(count('not_assessed')) },
  ];
  const frameworks = Array.from(new Set(rows.map((r) => pick(r, 'framework')))).filter(Boolean);
  return (
    <>
      <h1 className="page-title">Regulatory &amp; Compliance</h1>
      <p className="page-sub">
        Control &amp; evidence posture over the canonical GRC register (m41) · synthetic staging data. Shows
        control/evidence <strong>state</strong> — not a regulatory-compliance certification.
      </p>
      <div className="tiles">
        {tiles.map((t) => (
          <div className="tile" key={t.k}>
            <div className="k">{t.k}</div>
            <div className="v">{t.v}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <header>
          <h3>Controls by framework</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        {loading ? (
          <div className="loading">Loading controls…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No controls yet. Seed synthetic controls to populate this view.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Framework</th>
                <th className="num">Controls</th>
                <th className="num">Compliant</th>
                <th className="num">Attention</th>
              </tr>
            </thead>
            <tbody>
              {frameworks.map((f) => {
                const fr = rows.filter((r) => pick(r, 'framework') === f);
                return (
                  <tr key={f}>
                    <td>{FRAMEWORK_LABEL[f] || f}</td>
                    <td className="num">{fr.length}</td>
                    <td className="num">{fr.filter((r) => r._latest === 'compliant').length}</td>
                    <td className="num">{fr.filter((r) => r._latest !== 'compliant').length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ControlDrawer({
  control,
  tenant,
  onClose,
}: {
  control: api.Row;
  tenant: string | null;
  onClose: () => void;
}): JSX.Element {
  const id = pick(control, 'id');
  const [assessments, setAssessments] = useState<api.Row[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState('partial');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    let live = true;
    setAssessments(null);
    void api.getGrcAssessments(id, tenant).then((r) => {
      if (live) setAssessments(api.asRows(r.data));
    });
    return () => {
      live = false;
    };
  }, [id, tenant, nonce]);
  const record = async (): Promise<void> => {
    setSaving(true);
    setMsg(null);
    const r = await api.recordGrcAssessment(
      id,
      { status, ...(reason.trim() ? { reasonCode: reason.trim() } : {}) },
      tenant,
    );
    setSaving(false);
    if (r.ok) {
      setMsg({ ok: true, msg: 'Assessment recorded (append-only evidence, audited).' });
      setReason('');
      setNonce((x) => x + 1);
    } else {
      setMsg({ ok: false, msg: r.error ?? 'Could not record assessment.' });
    }
  };
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Control">
        <header className="drawer-head">
          <h3>{pick(control, 'controlKey') || 'Control'}</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <h4 style={{ margin: '4px 0 12px' }}>{pick(control, 'title') || '—'}</h4>
          <dl className="kv">
            <dt>Framework</dt>
            <dd>{FRAMEWORK_LABEL[pick(control, 'framework')] || pick(control, 'framework') || '—'}</dd>
            <dt>Scope</dt>
            <dd>{pick(control, 'scope') || '—'}</dd>
            <dt>State</dt>
            <dd>{pick(control, 'state') || '—'}</dd>
          </dl>
          <h4 className="drawer-sub">Record assessment</h4>
          <div className="run-picker" style={{ padding: 0, border: 'none' }}>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="compliant">Compliant</option>
              <option value="partial">Partial</option>
              <option value="non_compliant">Non-compliant</option>
              <option value="not_assessed">Not assessed</option>
            </select>
          </div>
          <div className="field">
            <input
              value={reason}
              placeholder="Reason / evidence note (optional)"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
          <button className="btn secondary" style={{ marginBottom: 8 }} disabled={saving} onClick={record}>
            {saving ? 'Recording…' : 'Record assessment'}
          </button>
          <p className="muted" style={{ fontSize: 11, margin: '0 0 6px' }}>
            Canonical m41 append-only evidence (permission-gated, tenant-scoped, audited). Records
            control/evidence state — not a certification. Restricted users are denied server-side.
          </p>
          <h4 className="drawer-sub">Assessment history</h4>
          {assessments === null ? (
            <div className="loading">Loading…</div>
          ) : assessments.length === 0 ? (
            <div className="empty">No assessments recorded.</div>
          ) : (
            <ul className="timeline">
              {assessments.map((a, i) => (
                <li key={pick(a, 'id') || i}>
                  {assessmentPill(pick(a, 'status'))}{' '}
                  <span className="t-head">{pick(a, 'reasonCode') || pick(a, 'evidenceRef') || ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function ComplianceRegister({ tenant }: { tenant: string | null }): JSX.Element {
  const { rows, loading, error } = useControlsWithStatus(tenant);
  const [fw, setFw] = useState('');
  const [open, setOpen] = useState<api.Row | null>(null);
  const frameworks = Array.from(new Set(rows.map((r) => pick(r, 'framework')))).filter(Boolean);
  const shown = rows.filter((r) => fw === '' || pick(r, 'framework') === fw);
  return (
    <>
      <h1 className="page-title">Control register</h1>
      <p className="page-sub">
        Compliance controls + latest assessment evidence over the canonical GRC register (m41) · synthetic
        staging data. RBAC + tenant isolation enforced server-side.
      </p>
      <div className="card">
        <header>
          <h3>Controls</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        <div className="run-picker">
          <label>Framework</label>
          <select value={fw} onChange={(e) => setFw(e.target.value)}>
            <option value="">All frameworks</option>
            {frameworks.map((f) => (
              <option key={f} value={f}>
                {FRAMEWORK_LABEL[f] || f}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <div className="loading">Loading controls…</div>
        ) : error ? (
          <div className="empty">Could not load controls ({error}).</div>
        ) : shown.length === 0 ? (
          <div className="empty">No controls match this filter.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Control</th>
                <th>Title</th>
                <th>Framework</th>
                <th>Latest assessment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c, i) => (
                <tr key={pick(c, 'id') || i}>
                  <td className="muted">{pick(c, 'controlKey') || '—'}</td>
                  <td>{pick(c, 'title') || '—'}</td>
                  <td className="muted">{FRAMEWORK_LABEL[pick(c, 'framework')] || pick(c, 'framework')}</td>
                  <td>{assessmentPill(c._latest)}</td>
                  <td>
                    <button className="btn link" onClick={() => setOpen(c)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <ControlDrawer control={open} tenant={tenant} onClose={() => setOpen(null)} />}
    </>
  );
}

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '▚', group: 'Overview' },
  { id: 'reconciliation', label: 'Reconciliation', icon: '⇄', group: 'Treasury' },
  { id: 'accounts', label: 'Bank accounts', icon: '🏦', group: 'Treasury' },
  { id: 'exceptions', label: 'Exceptions', icon: '!', group: 'Treasury' },
  { id: 'reports', label: 'Reports', icon: '▤', group: 'Treasury' },
  { id: 'recovery', label: 'Debt Recovery', icon: '⚖', group: 'Recovery' },
  { id: 'recovery-cases', label: 'Recovery cases', icon: '▤', group: 'Recovery' },
  { id: 'compliance', label: 'Compliance', icon: '❖', group: 'Compliance' },
  { id: 'compliance-register', label: 'Control register', icon: '▤', group: 'Compliance' },
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
        {route === 'reports' && <Reports tenant={tenant} />}
        {route === 'recovery' && <RecoveryDashboard tenant={tenant} />}
        {route === 'recovery-cases' && <RecoveryCases tenant={tenant} />}
        {route === 'compliance' && <ComplianceDashboard tenant={tenant} />}
        {route === 'compliance-register' && <ComplianceRegister tenant={tenant} />}
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
