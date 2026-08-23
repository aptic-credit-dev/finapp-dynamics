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
        {route === 'reports' && <Reports tenant={tenant} />}
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
