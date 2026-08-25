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
  perms,
  onClose,
  onChanged,
}: {
  matchId: string;
  tenant: string | null;
  perms: Set<string>;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [match, setMatch] = useState<api.Row | null>(null);
  const [lines, setLines] = useState<api.Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
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
  }, [matchId, tenant, nonce]);
  const m = match ?? {};
  const mStatus = pick(m, 'status').toLowerCase();
  const mVersion = Number(m['version'] ?? 1);
  const report = (r: api.ApiResult<api.Row>, okMsg: string): void => {
    setMsg(r.ok ? { ok: true, msg: okMsg } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) {
      setNonce((x) => x + 1);
      onChanged();
    }
  };
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
            <div className="admin-actions">
              <ActionButton
                label="Confirm"
                allowed={
                  /propos|suggest|pending|review/.test(mStatus) && can('gl_reconciliation.match.review')
                }
                onRun={() =>
                  api
                    .confirmMatch(matchId, mVersion, tenant)
                    .then((r) => report(r, 'Match confirmed (audited).'))
                }
              />
              <ActionButton
                label="Reject"
                allowed={
                  /propos|suggest|pending|review/.test(mStatus) && can('gl_reconciliation.match.review')
                }
                danger
                needsReason
                onRun={(reason) =>
                  api
                    .rejectMatch(matchId, mVersion, reason ?? '', tenant)
                    .then((r) => report(r, 'Match rejected (audited).'))
                }
              />
              <ActionButton
                label="Unmatch"
                allowed={/matched|confirm/.test(mStatus) && can('gl_reconciliation.match.unmatch')}
                danger
                needsReason
                onRun={(reason) =>
                  api
                    .unmatchMatch(matchId, mVersion, reason ?? '', tenant)
                    .then((r) => report(r, 'Match unmatched (privileged, audited).'))
                }
              />
            </div>
            {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
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
function RunsWorkspace({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const runs = useRows(() => api.getRuns(tenant), [tenant, nonce]);
  const [runId, setRunId] = useState<string | null>(null);
  const [openMatch, setOpenMatch] = useState<string | null>(null);
  const selectedRun = runId ?? (runs.rows[0] ? pick(runs.rows[0], 'id') : null);
  const runRow = runs.rows.find((r) => pick(r, 'id') === selectedRun) ?? null;
  const runStatus = runRow ? pick(runRow, 'status').toLowerCase() : '';
  const runVersion = runRow ? Number(runRow['version'] ?? 1) : 1;
  const matches = useRows(
    () =>
      selectedRun
        ? api.getRunMatches(selectedRun, tenant)
        : Promise.resolve({ ok: true, status: 200, data: [], error: null }),
    [selectedRun, tenant, nonce],
  );
  const report = (r: api.ApiResult<api.Row>, okMsg: string): void => {
    setMsg(r.ok ? { ok: true, msg: okMsg } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) setNonce((x) => x + 1);
  };
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
          {selectedRun && (
            <div className="admin-actions" style={{ padding: '0 16px 8px' }}>
              <ActionButton
                label="Execute"
                allowed={/draft|review_required/.test(runStatus) && can('gl_reconciliation.run.execute')}
                onRun={() =>
                  api
                    .executeRun(selectedRun, runVersion, tenant)
                    .then((r) => report(r, 'Run executed — balance invariant + matching (audited).'))
                }
              />
              <ActionButton
                label="Complete"
                allowed={/review_required|running/.test(runStatus) && can('gl_reconciliation.run.execute')}
                onRun={() =>
                  api
                    .completeRun(selectedRun, runVersion, tenant)
                    .then((r) => report(r, 'Run completed (fails closed if a required exception is open).'))
                }
              />
              <ActionButton
                label="Reopen"
                allowed={/completed/.test(runStatus) && can('gl_reconciliation.run.reopen')}
                danger
                needsReason
                onRun={(reason) =>
                  api
                    .reopenRun(selectedRun, runVersion, reason ?? '', tenant)
                    .then((r) => report(r, 'Run reopened (audited).'))
                }
              />
            </div>
          )}
          {msg && (
            <div className={msg.ok ? 'ok-note' : 'error'} style={{ margin: '0 16px 8px' }}>
              {msg.msg}
            </div>
          )}
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
      {openMatch && (
        <MatchDrawer
          matchId={openMatch}
          tenant={tenant}
          perms={perms}
          onClose={() => setOpenMatch(null)}
          onChanged={() => setNonce((x) => x + 1)}
        />
      )}
    </div>
  );
}

// GL imports are per-account on the API; this card loads the tenant's accounts then their imports and shows
// them together (with the owning account name), so the tenant-wide view works despite the per-account endpoint.
function ImportsCard({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const accounts = useRows(() => api.getAccounts(tenant), [tenant]);
  const [rows, setRows] = useState<api.Row[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const acctKey = accounts.rows.map((a) => pick(a, 'id', 'account_id')).join(',');
  const report = (r: api.ApiResult<api.Row>, okMsg: string): void => {
    setMsg(r.ok ? { ok: true, msg: okMsg } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) setNonce((x) => x + 1);
  };
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
  }, [tenant, accounts.loading, acctKey, nonce]);
  return (
    <div className="card">
      <header>
        <h3>GL / statement imports</h3>
        <span className="demo-note">SYNTHETIC</span>
      </header>
      {msg && (
        <div className={msg.ok ? 'ok-note' : 'error'} style={{ margin: '0 16px 8px' }}>
          {msg.msg}
        </div>
      )}
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((im, i) => {
              const id = pick(im, 'id');
              const ev = Number(im['version'] ?? 1);
              const st = pick(im, 'status', 'state').toLowerCase();
              const actionable = /validat|pending|created/.test(st);
              return (
                <tr key={id || i}>
                  <td>{pick(im, 'fileName', 'reference', 'name', 'id') || '—'}</td>
                  <td>{pick(im, '_account', 'glAccountId') || '—'}</td>
                  <td className="muted">
                    {pick(im, 'periodStart') ? `${pick(im, 'periodStart')}…${pick(im, 'periodEnd')}` : '—'}
                  </td>
                  <td className="muted">{pick(im, 'sourceFormat', 'format') || '—'}</td>
                  <td>{matchPill(pick(im, 'status', 'state'))}</td>
                  <td>
                    <div className="admin-actions">
                      <ActionButton
                        label="Accept"
                        allowed={actionable && can('gl_reconciliation.import.accept')}
                        onRun={() =>
                          api
                            .acceptImport(id, ev, tenant)
                            .then((r) => report(r, 'Import accepted (audited).'))
                        }
                      />
                      <ActionButton
                        label="Reject"
                        allowed={actionable && can('gl_reconciliation.import.reject')}
                        danger
                        needsReason
                        onRun={(reason) =>
                          api
                            .rejectImport(id, ev, reason ?? '', tenant)
                            .then((r) => report(r, 'Import rejected (audited).'))
                        }
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
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

function Reconciliation({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  return (
    <>
      <h1 className="page-title">Reconciliation workspace</h1>
      <p className="page-sub">
        Match confidence uses labels + glyphs, never colour alone. Adjustments post through maker-checker
        journals (server-enforced). Run, match and exception actions are permission-gated + audited.
      </p>
      <RunsWorkspace tenant={tenant} perms={perms} />
      <AdjustmentsCard tenant={tenant} />
      <ImportsCard tenant={tenant} perms={perms} />
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
function Exceptions({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const runs = useRows(() => api.getRuns(tenant), [tenant]);
  const [runId, setRunId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const selectedRun = runId ?? (runs.rows[0] ? pick(runs.rows[0], 'id') : null);
  const exceptions = useRows(
    () =>
      selectedRun
        ? api.getRunExceptions(selectedRun, tenant)
        : Promise.resolve({ ok: true, status: 200, data: [], error: null }),
    [selectedRun, tenant, nonce],
  );
  const report = (r: api.ApiResult<api.Row>, okMsg: string): void => {
    setMsg(r.ok ? { ok: true, msg: okMsg } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) setNonce((x) => x + 1);
  };
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
            {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.rows.map((ex, i) => {
                    const open = !/resolv|waiv|closed/i.test(pick(ex, 'status'));
                    const id = pick(ex, 'id');
                    const ev = Number(ex['version'] ?? 1);
                    return (
                      <tr key={id || i}>
                        <td>{pick(ex, 'exceptionType') || '—'}</td>
                        <td>{matchPill(pick(ex, 'status'))}</td>
                        <td className="muted">{pick(ex, 'reason') || '—'}</td>
                        <td className="num">{pick(ex, 'ageDays') || '0'}</td>
                        <td className="muted">{pick(ex, 'assignedTo') || 'Unassigned'}</td>
                        <td>
                          <div className="admin-actions">
                            <ActionButton
                              label="Resolve"
                              allowed={open && can('gl_reconciliation.exception.resolve')}
                              needsReason
                              onRun={(reason) =>
                                api
                                  .resolveException(id, ev, reason ?? '', tenant)
                                  .then((r) => report(r, 'Exception resolved (audited).'))
                              }
                            />
                            <ActionButton
                              label="Waive"
                              allowed={open && can('gl_reconciliation.exception.waive')}
                              danger
                              needsReason
                              onRun={(reason) =>
                                api
                                  .waiveException(id, ev, reason ?? '', tenant)
                                  .then((r) => report(r, 'Exception waived (privileged, audited).'))
                              }
                            />
                            {!open && <span className="muted">—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
const ARRANGEMENT_TYPES = [
  'installment',
  'lump_sum',
  'structured_settlement',
  'moratorium',
  'restructure',
  'standstill',
];
const DEMAND_TYPES = [
  'informal_demand',
  'formal_demand',
  'final_demand',
  'letter_before_action',
  'notice_to_pay',
  'statutory_demand',
  'notice_of_default',
];
const OUTCOME_TYPES = [
  'partially_recovered',
  'fully_recovered',
  'settled',
  'written_off',
  'uncollectible',
  'withdrawn',
  'referred_out',
  'other',
];

function RecoveryDrawer({
  id,
  tenant,
  perms,
  actorId,
  onClose,
}: {
  id: string;
  tenant: string | null;
  perms: Set<string>;
  actorId: string;
  onClose: () => void;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [rec, setRec] = useState<api.Row | null>(null);
  const [notes, setNotes] = useState<api.Row[]>([]);
  const [arrs, setArrs] = useState<api.Row[]>([]);
  const [demands, setDemands] = useState<api.Row[]>([]);
  const [outcomes, setOutcomes] = useState<api.Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [activity, setActivity] = useState('');
  const [arrForm, setArrForm] = useState({ arrangementType: 'installment', amount: '' });
  const [demForm, setDemForm] = useState({ demandType: 'formal_demand', amount: '' });
  const [outForm, setOutForm] = useState({ outcomeType: 'partially_recovered', amount: '' });
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([
      api.getRecovery(id, tenant),
      api.getRecoverySub(id, 'notes', tenant),
      api.getRecoverySub(id, 'arrangements', tenant),
      api.getRecoverySub(id, 'demands', tenant),
      api.getRecoverySub(id, 'outcomes', tenant),
    ]).then(([r, n, a, d, o]) => {
      if (!live) return;
      if (r.ok) setRec((r.data as api.Row | null) ?? null);
      setNotes(api.asRows(n.data));
      setArrs(api.asRows(a.data));
      setDemands(api.asRows(d.data));
      setOutcomes(api.asRows(o.data));
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [id, tenant, nonce]);
  const r = rec ?? {};
  const version = Number(r['version'] ?? 1);
  const status = pick(r, 'status').toLowerCase();
  const openish = !/closed|archived|resolved|withdrawn/.test(status);
  const report = (res: api.ApiResult<api.Row>, okMsg: string): void => {
    setMsg(res.ok ? { ok: true, msg: okMsg } : { ok: false, msg: res.error ?? 'Action failed.' });
    if (res.ok) setNonce((x) => x + 1);
  };
  const recordActivity = async (): Promise<void> => {
    if (activity.trim() === '') return;
    const res = await api.recordRecoveryNote(
      id,
      { content: activity.trim(), headline: 'Contact / activity' },
      tenant,
    );
    report(res, 'Activity recorded (audited).');
    if (res.ok) setActivity('');
  };
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
              <dt>Recovered</dt>
              <dd>{fmtMinor(r['recoveredAmountMinor'])}</dd>
              <dt>Enforcement stage</dt>
              <dd>{pick(r, 'enforcementStage') || '—'}</dd>
              <dt>Owner</dt>
              <dd>{pick(r, 'legalOwner', 'recoveryTeam', 'businessOwner') || '—'}</dd>
              <dt>Legal / litigation</dt>
              <dd className="muted">
                {pick(r, 'sourceMatterId') ? 'm14 linked' : 'no matter'} ·{' '}
                {pick(r, 'sourceProceedingId') ? 'm16 linked' : 'no proceeding'}
              </dd>
            </dl>

            <h4 className="drawer-sub">Case actions</h4>
            <div className="admin-actions">
              <ActionButton
                label="Take ownership"
                allowed={openish && can('recovery.case.assign')}
                onRun={() =>
                  api
                    .assignRecovery(id, version, actorId, tenant)
                    .then((res) => report(res, 'Case assigned to you (audited).'))
                }
              />
              <ActionButton
                label="Resolve"
                allowed={openish && can('recovery.case.resolve')}
                onRun={() =>
                  api
                    .resolveRecovery(id, version, tenant)
                    .then((res) => report(res, 'Case resolved (audited).'))
                }
              />
              <ActionButton
                label="Close"
                allowed={openish && can('recovery.case.close')}
                danger
                needsReason
                onRun={(reason) =>
                  api
                    .closeRecovery(id, version, tenant, reason)
                    .then((res) => report(res, 'Case closed (rule-gated, audited).'))
                }
              />
              <ActionButton
                label="Reopen"
                allowed={!openish && can('recovery.case.reopen')}
                needsReason
                onRun={(reason) =>
                  api
                    .reopenRecovery(id, version, reason ?? '', tenant)
                    .then((res) => report(res, 'Case reopened (audited).'))
                }
              />
              <ActionButton
                label="Archive"
                allowed={/closed|resolved/.test(status) && can('recovery.case.archive')}
                danger
                needsReason
                onRun={(reason) =>
                  api
                    .archiveRecovery(id, version, tenant, reason)
                    .then((res) => report(res, 'Case archived (audited).'))
                }
              />
            </div>
            {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}

            <h4 className="drawer-sub">Payment arrangements (maker-checker)</h4>
            {arrs.length === 0 ? (
              <div className="empty">No arrangements.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {arrs.map((a, i) => {
                    const aid = pick(a, 'id');
                    const av = Number(a['version'] ?? 1);
                    const ast = pick(a, 'status').toLowerCase();
                    const pendingApproval = /propos|pending|draft/.test(ast);
                    const active = /active|approved/.test(ast);
                    return (
                      <tr key={aid || i}>
                        <td>{(pick(a, 'arrangementType') || '—').replace(/_/g, ' ')}</td>
                        <td className="num">{fmtMinor(a['totalAmountMinor'])}</td>
                        <td>{recoveryPill(pick(a, 'status'))}</td>
                        <td>
                          <div className="admin-actions">
                            <ActionButton
                              label="Approve"
                              allowed={pendingApproval && can('recovery.arrangement.approve')}
                              onRun={() =>
                                api
                                  .approveArrangement(aid, av, tenant)
                                  .then((res) =>
                                    report(res, 'Arrangement approved (SoD: not the proposer; audited).'),
                                  )
                              }
                            />
                            <ActionButton
                              label="Default"
                              allowed={active && can('recovery.arrangement.manage')}
                              danger
                              needsReason
                              onRun={(reason) =>
                                api
                                  .defaultArrangement(aid, av, reason ?? '', tenant)
                                  .then((res) => report(res, 'Arrangement defaulted (audited).'))
                              }
                            />
                            <ActionButton
                              label="Complete"
                              allowed={active && can('recovery.arrangement.manage')}
                              onRun={() =>
                                api
                                  .completeArrangement(aid, av, tenant)
                                  .then((res) => report(res, 'Arrangement completed (audited).'))
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {can('recovery.arrangement.manage') && openish && (
              <div className="inline-form">
                <select
                  value={arrForm.arrangementType}
                  onChange={(e) => setArrForm({ ...arrForm, arrangementType: e.target.value })}
                >
                  {ARRANGEMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <input
                  value={arrForm.amount}
                  placeholder="Total amount (e.g. 5000.00)"
                  onChange={(e) => setArrForm({ ...arrForm, amount: e.target.value })}
                />
                <button
                  className="btn secondary sm"
                  disabled={toMinorUnits(arrForm.amount) === null}
                  onClick={() =>
                    void api
                      .proposeArrangement(
                        id,
                        {
                          arrangementType: arrForm.arrangementType,
                          totalAmountMinor: toMinorUnits(arrForm.amount) ?? 0,
                        },
                        tenant,
                      )
                      .then((res) => {
                        report(res, 'Arrangement proposed (pending approval by a DIFFERENT checker).');
                        if (res.ok) setArrForm({ ...arrForm, amount: '' });
                      })
                  }
                >
                  + Propose arrangement
                </button>
              </div>
            )}

            <h4 className="drawer-sub">Demands</h4>
            {demands.length === 0 ? (
              <div className="empty">No demands issued.</div>
            ) : (
              <ul className="timeline">
                {demands.map((d, i) => (
                  <li key={pick(d, 'id') || i}>
                    <span className="t-type">{(pick(d, 'demandType') || 'demand').replace(/_/g, ' ')}</span>{' '}
                    {recoveryPill(pick(d, 'status'))}{' '}
                    <span className="muted">{fmtMinor(d['amountDemandedMinor'])}</span>
                  </li>
                ))}
              </ul>
            )}
            {can('recovery.demand.manage') && openish && (
              <div className="inline-form">
                <select
                  value={demForm.demandType}
                  onChange={(e) => setDemForm({ ...demForm, demandType: e.target.value })}
                >
                  {DEMAND_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <input
                  value={demForm.amount}
                  placeholder="Amount demanded"
                  onChange={(e) => setDemForm({ ...demForm, amount: e.target.value })}
                />
                <button
                  className="btn secondary sm"
                  disabled={toMinorUnits(demForm.amount) === null}
                  onClick={() =>
                    void api
                      .issueDemand(
                        id,
                        {
                          demandType: demForm.demandType,
                          amountDemandedMinor: toMinorUnits(demForm.amount) ?? 0,
                        },
                        tenant,
                      )
                      .then((res) => {
                        report(res, 'Demand issued (audited).');
                        if (res.ok) setDemForm({ ...demForm, amount: '' });
                      })
                  }
                >
                  + Issue demand
                </button>
              </div>
            )}

            <h4 className="drawer-sub">Outcomes (append-only)</h4>
            {outcomes.length === 0 ? (
              <div className="empty">No outcome recorded.</div>
            ) : (
              <ul className="timeline">
                {outcomes.map((o, i) => (
                  <li key={pick(o, 'id') || i}>
                    <span className="t-type">{(pick(o, 'outcomeType') || 'outcome').replace(/_/g, ' ')}</span>{' '}
                    <span className="muted">recovered {fmtMinor(o['recoveredAmountMinor'])}</span>
                  </li>
                ))}
              </ul>
            )}
            {can('recovery.outcome.manage') && (
              <div className="inline-form">
                <select
                  value={outForm.outcomeType}
                  onChange={(e) => setOutForm({ ...outForm, outcomeType: e.target.value })}
                >
                  {OUTCOME_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <input
                  value={outForm.amount}
                  placeholder="Recovered amount"
                  onChange={(e) => setOutForm({ ...outForm, amount: e.target.value })}
                />
                <button
                  className="btn secondary sm"
                  disabled={toMinorUnits(outForm.amount) === null}
                  onClick={() =>
                    void api
                      .recordOutcome(
                        id,
                        {
                          outcomeType: outForm.outcomeType,
                          recoveredAmountMinor: toMinorUnits(outForm.amount) ?? 0,
                        },
                        tenant,
                      )
                      .then((res) => {
                        report(res, 'Outcome recorded (append-only, audited).');
                        if (res.ok) setOutForm({ ...outForm, amount: '' });
                      })
                  }
                >
                  + Record outcome
                </button>
              </div>
            )}

            <h4 className="drawer-sub">Record activity</h4>
            <div className="inline-form">
              <input
                value={activity}
                placeholder="Record a call / contact / field visit…"
                onChange={(e) => setActivity(e.target.value)}
              />
              <button
                className="btn secondary sm"
                disabled={activity.trim() === '' || !can('recovery.case.update')}
                onClick={recordActivity}
              >
                Record activity
              </button>
            </div>
            <p className="muted" style={{ fontSize: 11, margin: '6px 0' }}>
              All writes go through the canonical m17 recovery service (permission-gated, tenant-scoped,
              audited). No hard delete — a case resolves/closes/reopens/archives. Restricted users are denied
              server-side.
            </p>
            <h4 className="drawer-sub">Case timeline</h4>
            {notes.length === 0 ? (
              <div className="empty">No notes recorded.</div>
            ) : (
              <ul className="timeline">
                {notes.map((n, i) => (
                  <li key={pick(n, 'id') || i}>
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

function RecoveryCases({
  tenant,
  perms,
  actorId,
}: {
  tenant: string | null;
  perms: Set<string>;
  actorId: string;
}): JSX.Element {
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
      {openId && (
        <RecoveryDrawer
          id={openId}
          tenant={tenant}
          perms={perms}
          actorId={actorId}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

// ---------- Finance → Fiscal Calendar (M19) — operational UI over the CANONICAL m19 CalendarService. No second
// finance engine, no monetary amounts (ADR-007), no hard delete, no invented maker-checker: period transitions
// are single-actor privileged controls (permission + expectedVersion + audit), NOT dual approval — that lives in
// m21 posting. Period close/lock is the cross-module gate m21 honours. A locked period is a TERMINAL seal (there
// is no canonical unlock). The accounting entity comes from the canonical GET /finance/entities list. ----------
const periodPill = (status: string, locked: boolean): JSX.Element => {
  const s = (status || '').toLowerCase();
  if (locked || s === 'locked')
    return (
      <span className="pill bad">
        <span className="glyph">🔒</span> Locked (sealed)
      </span>
    );
  if (s === 'closed') return <span className="pill warn">Closed</span>;
  if (s === 'open') return <span className="pill ok">Open</span>;
  return <span className="pill info">{status || '—'}</span>;
};

function PeriodHistoryDrawer({
  period,
  tenant,
  onClose,
}: {
  period: api.Row;
  tenant: string | null;
  onClose: () => void;
}): JSX.Element {
  const id = pick(period, 'id');
  const [rows, setRows] = useState<api.Row[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    void api.getPeriodHistory(id, tenant).then((r) => {
      if (live) setRows(api.asRows(r.data));
    });
    return () => {
      live = false;
    };
  }, [id, tenant]);
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Period history"
      >
        <header className="drawer-head">
          <h3>Period {pick(period, 'periodNumber')} — history</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <p className="muted" style={{ fontSize: 12 }}>
            Canonical append-only calendar transitions (m19). Reason codes are derived server-side.
          </p>
          {rows === null ? (
            <div className="loading">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty">No transitions recorded.</div>
          ) : (
            <ul className="timeline">
              {rows.map((h, i) => (
                <li key={pick(h, 'id') || i}>
                  <span className="t-head">
                    {(pick(h, 'fromStatus') || '—') + ' → ' + pick(h, 'toStatus')}
                  </span>{' '}
                  <span className="muted">
                    {pick(h, 'reasonCode') || pick(h, 'reason') || ''}
                    {pick(h, 'byUser') ? ` · ${pick(h, 'byUser')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function PeriodsPanel({
  fiscalYear,
  tenant,
  perms,
}: {
  fiscalYear: api.Row;
  tenant: string | null;
  perms: Set<string>;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const fyId = pick(fiscalYear, 'id');
  const fyOpen = pick(fiscalYear, 'status').toLowerCase() === 'open';
  const [nonce, setNonce] = useState(0);
  const periods = useRows(() => api.getFiscalPeriods(fyId, tenant), [fyId, tenant, nonce]);
  const [history, setHistory] = useState<api.Row | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [num, setNum] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const refresh = (): void => setNonce((x) => x + 1);
  const run = async (p: Promise<api.ApiResult<api.Row>>, okMsg: string): Promise<void> => {
    const r = await p;
    setMsg(r.ok ? { ok: true, msg: okMsg } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) refresh();
  };
  const rows = periods.rows;
  return (
    <div className="card">
      <header>
        <h3>Periods · {pick(fiscalYear, 'code')}</h3>
        <span className="demo-note">SYNTHETIC</span>
      </header>
      {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
      {can('finance.period.open') && fyOpen && (
        <div className="run-picker" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            style={{ width: 90 }}
            value={num}
            placeholder="Period #"
            onChange={(e) => setNum(e.target.value)}
          />
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          <button
            className="btn"
            disabled={!/^\d+$/.test(num.trim()) || start === '' || end === ''}
            onClick={() =>
              void run(
                api.openPeriod(
                  fyId,
                  { periodNumber: Number(num.trim()), startDate: start, endDate: end },
                  tenant,
                ),
                'Period opened.',
              ).then(() => {
                setNum('');
                setStart('');
                setEnd('');
              })
            }
          >
            Open period
          </button>
        </div>
      )}
      {periods.loading ? (
        <div className="loading">Loading periods…</div>
      ) : periods.error ? (
        <div className="empty">Could not load periods ({periods.error}).</div>
      ) : rows.length === 0 ? (
        <div className="empty">No periods in this fiscal year yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Start</th>
              <th>End</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const id = pick(p, 'id');
              const ev = Number(p['version'] ?? 1);
              const status = pick(p, 'status').toLowerCase();
              const locked = status === 'locked' || pick(p, 'lockedAt') !== '';
              return (
                <tr key={id || i}>
                  <td className="num">{pick(p, 'periodNumber')}</td>
                  <td className="muted">{pick(p, 'startDate')}</td>
                  <td className="muted">{pick(p, 'endDate')}</td>
                  <td>{periodPill(status, locked)}</td>
                  <td>
                    <div className="action-row">
                      <ActionButton
                        label="Close"
                        allowed={status === 'open' && can('finance.period.close')}
                        onRun={() => run(api.closePeriod(id, ev, tenant), 'Period closed.')}
                      />
                      <ActionButton
                        label="Reopen"
                        allowed={status === 'closed' && can('finance.period.reopen')}
                        onRun={() => run(api.reopenPeriod(id, ev, tenant), 'Period reopened.')}
                      />
                      <ActionButton
                        label="Lock / seal"
                        danger
                        allowed={(status === 'open' || status === 'closed') && can('finance.period.lock')}
                        onRun={() => run(api.lockPeriod(id, ev, tenant), 'Period locked (sealed).')}
                      />
                      <button className="btn link sm" onClick={() => setHistory(p)}>
                        History
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
        Locking a period <strong>seals the posting window</strong>: per canonical m19/m21 rules, journals can
        no longer post into it. A lock is <strong>terminal</strong> — there is no unlock (a closed period may
        be reopened; a locked one cannot). All actions are permission-gated, versioned and audited
        server-side.
      </p>
      {history && <PeriodHistoryDrawer period={history} tenant={tenant} onClose={() => setHistory(null)} />}
    </div>
  );
}

function FiscalCalendar({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const entities = useRows(() => api.getFinanceEntities(tenant), [tenant]);
  const [entityId, setEntityId] = useState('');
  const entityKey = entities.rows.map((e) => pick(e, 'id')).join(',');
  useEffect(() => {
    // Default to the first entity once entities load / tenant changes (clears stale selection on tenant switch).
    const first = entities.rows[0] ? pick(entities.rows[0], 'id') : '';
    setEntityId((cur) => (entities.rows.some((e) => pick(e, 'id') === cur) ? cur : first));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey, tenant]);
  const [fyNonce, setFyNonce] = useState(0);
  const fys = useRows(
    () =>
      entityId
        ? api.getFiscalYears(entityId, tenant)
        : Promise.resolve({ ok: true, data: [] } as api.ApiResult<unknown>),
    [entityId, tenant, fyNonce],
  );
  const [selFy, setSelFy] = useState<api.Row | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [code, setCode] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const refreshFy = (): void => {
    setFyNonce((x) => x + 1);
    setSelFy(null);
  };
  const run = async (p: Promise<api.ApiResult<api.Row>>, okMsg: string): Promise<void> => {
    const r = await p;
    setMsg(r.ok ? { ok: true, msg: okMsg } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) refreshFy();
  };
  return (
    <>
      <h1 className="page-title">Fiscal calendar</h1>
      <p className="page-sub">
        Accounting periods over the canonical m19 fiscal calendar · synthetic staging data. Period close/lock
        is the posting-window control m21 honours. RBAC + tenant isolation + audit enforced server-side; no
        monetary amounts, no hard delete.
      </p>
      <div className="card">
        <div className="run-picker">
          <label>Accounting entity</label>
          {entities.loading ? (
            <span className="muted">Loading entities…</span>
          ) : entities.rows.length === 0 ? (
            <span className="muted">
              No accounting entities (register one in Finance configuration first).
            </span>
          ) : (
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {entities.rows.map((e) => (
                <option key={pick(e, 'id')} value={pick(e, 'id')}>
                  {pick(e, 'code')} — {pick(e, 'name')}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {entityId !== '' && (
        <div className="card">
          <header>
            <h3>Fiscal years</h3>
            <span className="demo-note">SYNTHETIC</span>
          </header>
          {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
          {can('finance.fiscal_year.manage') && (
            <div className="run-picker" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input
                style={{ width: 120 }}
                value={code}
                placeholder="Code (e.g. FY2026)"
                onChange={(e) => setCode(e.target.value)}
              />
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              <button
                className="btn"
                disabled={code.trim() === '' || start === '' || end === ''}
                onClick={() =>
                  void run(
                    api.createFiscalYear(
                      { entityId, code: code.trim(), startDate: start, endDate: end },
                      tenant,
                    ),
                    'Fiscal year created.',
                  ).then(() => {
                    setCode('');
                    setStart('');
                    setEnd('');
                  })
                }
              >
                Create fiscal year
              </button>
            </div>
          )}
          {fys.loading ? (
            <div className="loading">Loading fiscal years…</div>
          ) : fys.error ? (
            <div className="empty">Could not load fiscal years ({fys.error}).</div>
          ) : fys.rows.length === 0 ? (
            <div className="empty">No fiscal years for this entity yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fys.rows.map((fy, i) => {
                  const id = pick(fy, 'id');
                  const ev = Number(fy['version'] ?? 1);
                  const status = pick(fy, 'status').toLowerCase();
                  const selected = selFy !== null && pick(selFy, 'id') === id;
                  return (
                    <tr key={id || i} className={selected ? 'row-selected' : ''}>
                      <td>{pick(fy, 'code')}</td>
                      <td className="muted">{pick(fy, 'startDate')}</td>
                      <td className="muted">{pick(fy, 'endDate')}</td>
                      <td>{statusPill(pick(fy, 'status'))}</td>
                      <td>
                        <div className="action-row">
                          <button className="btn link sm" onClick={() => setSelFy(selected ? null : fy)}>
                            {selected ? 'Hide periods' : 'View periods'}
                          </button>
                          <ActionButton
                            label="Close year"
                            allowed={status === 'open' && can('finance.fiscal_year.close')}
                            onRun={() => run(api.closeFiscalYear(id, ev, tenant), 'Fiscal year closed.')}
                          />
                          <ActionButton
                            label="Reopen year"
                            allowed={status === 'closed' && can('finance.fiscal_year.reopen')}
                            onRun={() => run(api.reopenFiscalYear(id, ev, tenant), 'Fiscal year reopened.')}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {selFy && <PeriodsPanel fiscalYear={selFy} tenant={tenant} perms={perms} />}
    </>
  );
}

// ---------- Finance → Journals & Posting (M21) — operational workspace over the CANONICAL m21 engine, with the
// checker path routed through the CANONICAL m22 Approvals inbox (no second journal engine, no second approval
// engine, no direct-post bypass, no reversal — none exists canonically). Amounts are INTEGER MINOR UNITS,
// decimal-safe (ADR-007); posting is approval-gated + period-gated (from merged M19) server-side. m21 records
// posting-result EVIDENCE only — it never pushes to a core banking/accounting system (m23/m33, deferred). ----------
function JournalDraftDrawer({
  draftId,
  tenant,
  perms,
  onClose,
  onChanged,
}: {
  draftId: string;
  tenant: string | null;
  perms: Set<string>;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [draft, setDraft] = useState<api.Row | null>(null);
  const [lines, setLines] = useState<api.Row[]>([]);
  const [preqs, setPreqs] = useState<api.Row[]>([]);
  const [approvals, setApprovals] = useState<api.Row[]>([]);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  // add/edit-line form
  const [acct, setAcct] = useState('');
  const [dir, setDir] = useState<'debit' | 'credit'>('debit');
  const [amt, setAmt] = useState('');
  const [ldesc, setLdesc] = useState('');
  const [editLine, setEditLine] = useState<api.Row | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    void api.getJournalDraft(draftId, tenant).then((r) => {
      if (!live) return;
      const d = (r.data as { draft?: api.Row; lines?: api.Row[] } | null) ?? {};
      setDraft(d.draft ?? null);
      setLines(d.lines ?? []);
    });
    void api.getPostingRequests(draftId, tenant).then((r) => {
      if (live) setPreqs((r.data as { postingRequests?: api.Row[] } | null)?.postingRequests ?? []);
    });
    void api.listApprovalRequests(tenant).then((r) => {
      if (live) setApprovals((r.data as { requests?: api.Row[] } | null)?.requests ?? []);
    });
    return () => {
      live = false;
    };
  }, [draftId, tenant, nonce]);
  const refresh = (): void => {
    setNonce((x) => x + 1);
    onChanged();
  };
  const run = async (p: Promise<api.ApiResult<api.Row>>, ok: string): Promise<void> => {
    const r = await p;
    setMsg(r.ok ? { ok: true, msg: ok } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) refresh();
  };
  if (draft === null)
    return (
      <div className="drawer-overlay" onClick={onClose} role="presentation">
        <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog">
          <div className="loading">Loading draft…</div>
        </aside>
      </div>
    );
  const status = pick(draft, 'status').toLowerCase();
  const version = Number(draft['version'] ?? 1);
  const mutable = status === 'draft' || status === 'validated';
  const periodStatus = pick(draft, 'periodStatus').toLowerCase() || 'open';
  const periodOpen = periodStatus === 'open';
  const debits = pick(draft, 'totalDebitsMinor');
  const credits = pick(draft, 'totalCreditsMinor');
  const balanced = String(draft['isBalanced']) === 'true';
  const submitLine = (): void => {
    const minor = Number(amt.trim());
    if (!Number.isInteger(minor) || minor <= 0) {
      setMsg({ ok: false, msg: 'Amount must be a positive integer (minor units).' });
      return;
    }
    const body = {
      direction: dir,
      amountMinor: minor,
      ...(acct.trim() ? { accountRef: acct.trim() } : {}),
      ...(ldesc.trim() ? { description: ldesc.trim() } : {}),
    };
    const after = (): void => {
      setAcct('');
      setAmt('');
      setLdesc('');
      setEditLine(null);
    };
    if (editLine) {
      void run(
        api.updateJournalLine(pick(editLine, 'id'), Number(editLine['version'] ?? 1), body, tenant),
        'Line updated.',
      ).then(after);
    } else {
      void run(api.addJournalLine(draftId, body as api.DraftLineInput, tenant), 'Line added.').then(after);
    }
  };
  // Submit hands off to m22: submit the draft, then raise + submit a canonical approval request so a DISTINCT
  // checker can decide it in the Approvals inbox (best-effort — if the maker lacks approvals.request.* the draft
  // is still submitted PENDING APPROVAL and that is surfaced, not swallowed).
  const submitDraft = async (): Promise<void> => {
    const r = await api.submitJournalDraft(draftId, version, tenant);
    if (!r.ok) {
      setMsg({ ok: false, msg: r.error ?? 'Submit failed.' });
      return;
    }
    const req = await api.createApprovalRequest(
      {
        subjectType: 'journal_posting',
        subjectRef: draftId,
        title: pick(draft, 'description') || 'Journal posting',
        amountMinor: Number(debits) || 0,
      },
      tenant,
    );
    if (req.ok && req.data) {
      const rq = (req.data as { request?: api.Row } | null)?.request;
      if (rq) await api.submitApprovalRequest(pick(rq, 'id'), Number(rq['version'] ?? 1), tenant);
      setMsg({ ok: true, msg: 'Submitted → approval request raised in the Approvals inbox (m22).' });
    } else {
      setMsg({
        ok: true,
        msg: 'Submitted (PENDING APPROVAL). Approval request not raised: ' + (req.error ?? ''),
      });
    }
    refresh();
  };
  const approvalFor = approvals.find(
    (a) => pick(a, 'subjectRef') === draftId && pick(a, 'status').toLowerCase() === 'approved',
  );
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside
        className="drawer wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Journal draft"
      >
        <header className="drawer-head">
          <h3>{pick(draft, 'description') || 'Journal draft'}</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <dl className="kv">
            <dt>Status</dt>
            <dd>{statusPill(pick(draft, 'status'))}</dd>
            <dt>Entity</dt>
            <dd>{pick(draft, 'entityRef') || '—'}</dd>
            <dt>Period</dt>
            <dd>
              {pick(draft, 'periodRef') || '—'} {periodPill(periodStatus, periodStatus === 'locked')}
            </dd>
            <dt>Date</dt>
            <dd>{pick(draft, 'journalDate') || '—'}</dd>
          </dl>
          {!periodOpen && (
            <div className="error">
              This draft's accounting period is <strong>{periodStatus}</strong> — per canonical m19/m21 rules
              it cannot be submitted or posted until the period is reopened (M19).
            </div>
          )}
          {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}

          <h4 className="drawer-sub">Lines</h4>
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Account</th>
                <th>Dr/Cr</th>
                <th className="num">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={pick(l, 'id') || i}>
                  <td className="num">{pick(l, 'lineNo')}</td>
                  <td className="muted">{pick(l, 'accountRef') || '—'}</td>
                  <td>{pick(l, 'direction')}</td>
                  <td className="num">{fmtMinor(pick(l, 'amountMinor'))}</td>
                  <td>
                    {mutable && can('journals.line.manage') && (
                      <span className="action-row">
                        <button
                          className="btn link sm"
                          onClick={() => {
                            setEditLine(l);
                            setAcct(pick(l, 'accountRef'));
                            setDir(pick(l, 'direction') === 'credit' ? 'credit' : 'debit');
                            setAmt(pick(l, 'amountMinor'));
                            setLdesc(pick(l, 'description'));
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn link sm"
                          onClick={() =>
                            void run(
                              api.removeJournalLine(pick(l, 'id'), Number(l['version'] ?? 1), tenant),
                              'Line removed.',
                            )
                          }
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No lines yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="balance-bar">
            <span>
              Debits <strong>{fmtMinor(debits)}</strong>
            </span>
            <span>
              Credits <strong>{fmtMinor(credits)}</strong>
            </span>
            <span>
              Diff <strong>{fmtMinor(String(Number(debits) - Number(credits)))}</strong>
            </span>
            {balanced ? (
              <span className="pill ok">Balanced</span>
            ) : (
              <span className="pill bad">Not balanced</span>
            )}
          </div>

          {mutable && can('journals.line.manage') && (
            <div className="run-picker" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input
                style={{ width: 120 }}
                value={acct}
                placeholder="Account ref"
                onChange={(e) => setAcct(e.target.value)}
              />
              <select value={dir} onChange={(e) => setDir(e.target.value === 'credit' ? 'credit' : 'debit')}>
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
              <input
                style={{ width: 130 }}
                value={amt}
                placeholder="Amount (minor)"
                onChange={(e) => setAmt(e.target.value)}
              />
              <input
                style={{ width: 140 }}
                value={ldesc}
                placeholder="Description"
                onChange={(e) => setLdesc(e.target.value)}
              />
              <button className="btn" onClick={submitLine}>
                {editLine ? 'Update line' : 'Add line'}
              </button>
              {editLine && (
                <button
                  className="btn link"
                  onClick={() => {
                    setEditLine(null);
                    setAcct('');
                    setAmt('');
                    setLdesc('');
                  }}
                >
                  Cancel edit
                </button>
              )}
            </div>
          )}

          <h4 className="drawer-sub">Actions</h4>
          <div className="action-row">
            <ActionButton
              label="Validate"
              allowed={mutable && lines.length > 0 && can('journals.validation.run')}
              onRun={() => run(api.validateJournalDraft(draftId, version, tenant), 'Validation run.')}
            />
            <ActionButton
              label="Submit for approval"
              allowed={status === 'validated' && balanced && periodOpen && can('journals.draft.submit')}
              onRun={submitDraft}
            />
            <ActionButton
              label="Withdraw"
              danger
              needsReason
              allowed={status === 'submitted' && can('journals.draft.withdraw')}
              onRun={(reason) =>
                run(api.withdrawJournalDraft(draftId, version, reason ?? '', tenant), 'Draft withdrawn.')
              }
            />
          </div>
          {can('journals.note.add') && (
            <div className="run-picker" style={{ gap: 6 }}>
              <input
                value={note}
                placeholder="Add a note…"
                onChange={(e) => setNote(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn secondary"
                disabled={note.trim() === ''}
                onClick={() =>
                  void run(api.addJournalNote(draftId, note.trim(), tenant), 'Note added.').then(() =>
                    setNote(''),
                  )
                }
              >
                Add note
              </button>
            </div>
          )}

          <h4 className="drawer-sub">Posting requests (approval-gated)</h4>
          <p className="muted" style={{ fontSize: 11, margin: '0 0 6px' }}>
            A posting request needs a DISTINCT m22 approver (maker ≠ checker, enforced server-side + DB) and
            an open period. m21 records posting-result <strong>evidence</strong> only — it does not push to a
            core banking/accounting system (m23/m33, deferred post-MVP).
          </p>
          {status === 'submitted' && can('journals.posting_request.create') && (
            <ActionButton
              label="Prepare posting request"
              allowed={periodOpen}
              onRun={() => run(api.preparePostingRequest(draftId, tenant), 'Posting request prepared.')}
            />
          )}
          {preqs.length === 0 ? (
            <div className="empty">No posting requests.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th className="num">Amount</th>
                  <th>Approval</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {preqs.map((pr, i) => {
                  const prId = pick(pr, 'id');
                  const prEv = Number(pr['version'] ?? 1);
                  const prStatus = pick(pr, 'status').toLowerCase();
                  return (
                    <tr key={prId || i}>
                      <td>{statusPill(pick(pr, 'status'))}</td>
                      <td className="num">{fmtMinor(pick(pr, 'amountMinor'))}</td>
                      <td className="muted">
                        {pick(pr, 'approvalRef') || (approvalFor ? 'approved (m22)' : '—')}
                      </td>
                      <td>
                        <div className="action-row">
                          <ActionButton
                            label="Authorize"
                            allowed={
                              prStatus === 'prepared' &&
                              approvalFor !== undefined &&
                              periodOpen &&
                              can('journals.posting_request.authorize')
                            }
                            onRun={() =>
                              run(
                                api.authorizePosting(
                                  prId,
                                  prEv,
                                  pick(approvalFor as api.Row, 'id'),
                                  pick(approvalFor as api.Row, 'finalApprover'),
                                  tenant,
                                ),
                                'Posting request authorized (m22 approval recorded).',
                              )
                            }
                          />
                          <ActionButton
                            label="Cancel"
                            danger
                            needsReason
                            allowed={
                              (prStatus === 'prepared' || prStatus === 'ready') &&
                              can('journals.posting_request.cancel')
                            }
                            onRun={(reason) =>
                              run(
                                api.cancelPostingRequest(prId, prEv, reason ?? '', tenant),
                                'Posting request cancelled.',
                              )
                            }
                          />
                          <ActionButton
                            label="Record result"
                            allowed={prStatus === 'ready' && can('journals.posting_result.record')}
                            onRun={() =>
                              run(
                                api.recordPostingResult(
                                  prId,
                                  {
                                    status: 'recorded',
                                    externalSystem: 'deferred',
                                    message: 'evidence only',
                                  },
                                  tenant,
                                ),
                                'Posting-result evidence recorded (external core posting deferred).',
                              )
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>
  );
}

function JournalsWorkspace({
  tenant,
  perms,
  actorId,
}: {
  tenant: string | null;
  perms: Set<string>;
  actorId: string;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [nonce, setNonce] = useState(0);
  const drafts = useRows(() => api.getJournalDrafts(tenant), [tenant, nonce]);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [desc, setDesc] = useState('');
  const [entity, setEntity] = useState('');
  const shown = drafts.rows.filter((d) => status === '' || pick(d, 'status') === status);
  const createDraft = async (): Promise<void> => {
    const r = await api.createJournalDraft(
      {
        description: desc.trim() || 'Journal draft',
        ...(entity.trim() ? { entityRef: entity.trim() } : {}),
        journalDate: '2026-08-24',
        sourceType: 'manual',
      },
      tenant,
    );
    if (r.ok && r.data) {
      setCreating(false);
      setDesc('');
      setEntity('');
      setNonce((x) => x + 1);
      setOpenId(pick(r.data as api.Row, 'id'));
    }
  };
  return (
    <>
      <h1 className="page-title">Journals &amp; posting</h1>
      <p className="page-sub">
        Draft → validate → submit → m22 approval → authorize → posting-result evidence, over the canonical m21
        engine · synthetic staging data. No direct post; posting is approval-gated (m22) and period-gated
        (M19). Actor: <span className="muted">{actorId || '—'}</span>.
      </p>
      <div className="card">
        <header>
          <h3>Journal drafts</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        <div className="run-picker" style={{ gap: 6 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['draft', 'validated', 'submitted', 'posted', 'withdrawn'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {can('journals.draft.create') && !creating && (
            <button className="btn" onClick={() => setCreating(true)}>
              New draft
            </button>
          )}
          {creating && (
            <>
              <input value={desc} placeholder="Description" onChange={(e) => setDesc(e.target.value)} />
              <input value={entity} placeholder="Entity ref" onChange={(e) => setEntity(e.target.value)} />
              <button className="btn" onClick={createDraft}>
                Create
              </button>
              <button className="btn link" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
        {drafts.loading ? (
          <div className="loading">Loading drafts…</div>
        ) : shown.length === 0 ? (
          <div className="empty">No drafts.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Status</th>
                <th className="num">Debits</th>
                <th className="num">Credits</th>
                <th>Balanced</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d, i) => (
                <tr key={pick(d, 'id') || i}>
                  <td>{pick(d, 'description') || '—'}</td>
                  <td>{statusPill(pick(d, 'status'))}</td>
                  <td className="num">{fmtMinor(pick(d, 'totalDebitsMinor'))}</td>
                  <td className="num">{fmtMinor(pick(d, 'totalCreditsMinor'))}</td>
                  <td>{String(d['isBalanced']) === 'true' ? '✓' : '—'}</td>
                  <td>
                    <button className="btn link" onClick={() => setOpenId(pick(d, 'id'))}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openId && (
        <JournalDraftDrawer
          draftId={openId}
          tenant={tenant}
          perms={perms}
          onClose={() => setOpenId(null)}
          onChanged={() => setNonce((x) => x + 1)}
        />
      )}
    </>
  );
}

// ---------- Customer Service → Feedback Management (M12) — operational FMS workspace over the CANONICAL
// m12-feedback engine. The Aptic model: capture → classify → assign/escalate → HOD resolution (submit → approve,
// a DISTINCT approver = SoD) → customer confirmation → rule-gated close. No second feedback engine, no hard
// delete. Verbatim customer narrative preserved. Customer contact redacted unless permitted (reveal audited
// server-side). Serious feedback can hand off to an M13 case. ----------
const sentimentPill = (s: string): JSX.Element => {
  const v = (s || '').toLowerCase();
  const cls = /positive/.test(v) ? 'ok' : /negative/.test(v) ? 'bad' : /neutral/.test(v) ? 'warn' : 'info';
  return <span className={`pill ${cls}`}>{s || '—'}</span>;
};

function FeedbackDrawer({
  recordId,
  tenant,
  perms,
  actorId,
  onClose,
  onChanged,
}: {
  recordId: string;
  tenant: string | null;
  perms: Set<string>;
  actorId: string;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [f, setF] = useState<api.Row | null>(null);
  const [acts, setActs] = useState<api.Row[]>([]);
  const [sla, setSla] = useState<api.Row | null>(null);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [owner, setOwner] = useState('');
  const [rating, setRating] = useState('');
  const [narrative, setNarrative] = useState('');
  const [sentiment, setSentiment] = useState('negative');
  const [severity, setSeverity] = useState('medium');
  const [resText, setResText] = useState('');
  useEffect(() => {
    let live = true;
    void api.getFeedbackRecord(recordId, tenant).then((r) => live && setF((r.data as api.Row) ?? null));
    void api
      .getFeedbackActivities(recordId, tenant)
      .then((r) => live && setActs((r.data as { activities?: api.Row[] } | null)?.activities ?? []));
    void api.getFeedbackSla(recordId, tenant).then((r) => live && setSla((r.data as api.Row) ?? null));
    return () => {
      live = false;
    };
  }, [recordId, tenant, nonce]);
  const refresh = (): void => {
    setNonce((x) => x + 1);
    onChanged();
  };
  const run = async (p: Promise<api.ApiResult<api.Row>>, ok: string): Promise<void> => {
    const r = await p;
    setMsg(r.ok ? { ok: true, msg: ok } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) refresh();
  };
  if (f === null)
    return (
      <div className="drawer-overlay" onClick={onClose} role="presentation">
        <aside className="drawer wide" onClick={(e) => e.stopPropagation()} role="dialog">
          <div className="loading">Loading feedback…</div>
        </aside>
      </div>
    );
  const ev = Number(f['version'] ?? 1);
  const status = pick(f, 'status').toLowerCase();
  const resStatus = pick(f, 'resolutionStatus').toLowerCase();
  const closed = pick(f, 'closureStatus').toLowerCase() === 'closed' || /closed/.test(status);
  const confirmed = String(f['customerConfirmed']) === 'true';
  const handoff = pick(f, 'caseHandoffStatus');
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside className="drawer wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Feedback">
        <header className="drawer-head">
          <h3>
            {pick(f, 'code') || 'Feedback'} — {sentimentPill(pick(f, 'sentiment'))}
          </h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              {statusPill(pick(f, 'status'))}
              {resStatus && ` · resolution ${resStatus}`}
              {confirmed ? ' · ✓ customer confirmed' : ''}
            </dd>
            <dt>Customer</dt>
            <dd>
              {pick(f, 'customerRef') || '—'}{' '}
              <span className="muted">
                {pick(f, 'customerContact') ? `· ${pick(f, 'customerContact')}` : '· contact redacted'}
              </span>
            </dd>
            <dt>Product / channel</dt>
            <dd>
              {pick(f, 'product') || '—'} · {pick(f, 'channel') || '—'} · {pick(f, 'feedbackType') || '—'}
            </dd>
            <dt>Branch / RO</dt>
            <dd>
              {pick(f, 'branch') || '—'} · {pick(f, 'responsibleOfficer') || '—'}
            </dd>
            <dt>Rating / severity</dt>
            <dd>
              {pick(f, 'rating') || '—'}
              {pick(f, 'ratingScale') ? `/${pick(f, 'ratingScale')}` : ''} · {pick(f, 'severity') || '—'}
            </dd>
            <dt>Owner / SLA</dt>
            <dd>
              {pick(f, 'currentOwner') || 'unassigned'} ·{' '}
              {sla
                ? `${pick(sla, 'state') || pick(sla, 'status') || 'sla'}${String(sla['breached']) === 'true' ? ' ⚠ BREACHED' : ''}`
                : pick(f, 'slaPolicyCode') || 'no SLA'}
            </dd>
          </dl>
          {pick(f, 'narrative') && (
            <div className="card" style={{ padding: '8px 12px', margin: '6px 0' }}>
              <span className="muted" style={{ fontSize: 11 }}>
                VERBATIM CUSTOMER FEEDBACK
              </span>
              <div>{pick(f, 'narrative')}</div>
            </div>
          )}
          {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}

          <h4 className="drawer-sub">Workflow</h4>
          <div className="action-row">
            <ActionButton
              label="Capture"
              allowed={!closed && can('feedback.record.capture')}
              onRun={() =>
                run(
                  api.captureFeedback(
                    recordId,
                    ev,
                    {
                      ...(rating.trim() ? { rating: Number(rating.trim()) } : {}),
                      ...(narrative.trim() ? { narrative: narrative.trim() } : {}),
                    },
                    tenant,
                  ),
                  'Feedback captured.',
                )
              }
            />
            <ActionButton
              label="Classify"
              allowed={!closed && can('feedback.record.classify')}
              onRun={() =>
                run(
                  api.classifyFeedback(recordId, ev, { sentiment, severity }, tenant),
                  'Feedback classified.',
                )
              }
            />
            <ActionButton
              label="Escalate to HOD"
              needsReason
              allowed={!closed && can('feedback.escalation.trigger')}
              onRun={(reason) =>
                run(api.escalateFeedback(recordId, reason ?? '', tenant), 'Escalated to HOD.')
              }
            />
            <ActionButton
              label="Approve resolution"
              allowed={resStatus === 'submitted' && can('feedback.resolution.approve')}
              onRun={() =>
                run(api.approveResolution(recordId, tenant), 'Resolution approved (SoD: not the submitter).')
              }
            />
            <ActionButton
              label="Customer confirmed"
              allowed={(resStatus === 'approved' || !closed) && can('feedback.confirmation.record')}
              onRun={() =>
                run(api.recordConfirmation(recordId, ev, true, tenant), 'Customer confirmation recorded.')
              }
            />
            <ActionButton
              label="Close"
              allowed={!closed && can('feedback.record.close')}
              onRun={() => run(api.closeFeedback(recordId, ev, tenant), 'Feedback closed (rule-gated).')}
            />
            <ActionButton
              label="Reopen"
              needsReason
              allowed={closed && can('feedback.record.reopen')}
              onRun={(reason) =>
                run(api.reopenFeedback(recordId, ev, reason ?? '', tenant), 'Feedback reopened.')
              }
            />
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0' }}>
            Closure is rule-gated server-side (e.g. a negative case needs an approved resolution + customer
            confirmation). A blocked close returns the unmet requirement.
          </p>

          {!closed && (can('feedback.record.capture') || can('feedback.record.classify')) && (
            <div className="run-picker" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input
                style={{ width: 70 }}
                value={rating}
                placeholder="Rating"
                onChange={(e) => setRating(e.target.value)}
              />
              <select value={sentiment} onChange={(e) => setSentiment(e.target.value)}>
                {['positive', 'neutral', 'negative'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {['low', 'medium', 'high', 'critical'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              <input
                style={{ flex: 1 }}
                value={narrative}
                placeholder="Customer comments (verbatim)"
                onChange={(e) => setNarrative(e.target.value)}
              />
            </div>
          )}

          {!closed && can('feedback.assignment.manage') && (
            <div className="run-picker" style={{ gap: 6 }}>
              <input
                value={owner}
                placeholder="Assign to (actor id)"
                onChange={(e) => setOwner(e.target.value)}
              />
              <button
                className="btn"
                disabled={owner.trim() === ''}
                onClick={() =>
                  void run(api.assignFeedback(recordId, ev, owner.trim(), tenant), 'Feedback assigned.').then(
                    () => setOwner(''),
                  )
                }
              >
                Assign
              </button>
              <button
                className="btn secondary"
                onClick={() => void run(api.assignFeedback(recordId, ev, actorId, tenant), 'Assigned to me.')}
              >
                Take ownership
              </button>
            </div>
          )}

          {!closed && can('feedback.resolution.submit') && (
            <div className="run-picker" style={{ gap: 6 }}>
              <input
                style={{ flex: 1 }}
                value={resText}
                placeholder="HOD resolution / root cause / action taken"
                onChange={(e) => setResText(e.target.value)}
              />
              <button
                className="btn"
                onClick={() =>
                  void run(
                    api.submitResolution(
                      recordId,
                      { summary: resText.trim() || 'Resolution (synthetic)' },
                      tenant,
                    ),
                    'Resolution submitted (awaiting a distinct approver).',
                  ).then(() => setResText(''))
                }
              >
                Submit resolution
              </button>
            </div>
          )}

          <h4 className="drawer-sub">Activity timeline</h4>
          <ul className="timeline">
            {acts.map((a, i) => (
              <li key={pick(a, 'id') || i}>
                <span className="t-head">{pick(a, 'headline') || pick(a, 'activityType')}</span>{' '}
                <span className="muted">{pick(a, 'status')}</span>
              </li>
            ))}
            {acts.length === 0 && <li className="muted">No activities.</li>}
          </ul>

          <h4 className="drawer-sub">Case management</h4>
          <div className="linkrow">
            {handoff && handoff.toLowerCase() !== 'none' ? (
              <span className="pill info">M13 case handoff: {handoff}</span>
            ) : can('feedback.case_handoff.request') && !closed ? (
              <button
                className="btn secondary sm"
                onClick={() =>
                  void run(
                    api.requestFeedbackCaseHandoff(
                      recordId,
                      { summary: 'Serious feedback — escalate to case' },
                      tenant,
                    ),
                    'Case handoff requested (M13).',
                  )
                }
              >
                Hand off to a case (M13)
              </button>
            ) : (
              <span className="muted">No case link.</span>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function FeedbackWorkspace({
  tenant,
  perms,
  actorId,
}: {
  tenant: string | null;
  perms: Set<string>;
  actorId: string;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState('');
  const [sentiment, setSentiment] = useState('');
  const [product, setProduct] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cust, setCust] = useState('');
  const [prod, setProd] = useState('');
  const [narr, setNarr] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const records = useRows(async () => {
    const r = await api.getFeedbackRecords(tenant, { status, sentiment, product });
    return { ...r, data: (r.data as { records?: api.Row[] } | null)?.records ?? [] };
  }, [tenant, nonce, status, sentiment, product]);
  // canonical aggregate counts (no fabrication) — from the m12 analytics endpoint.
  const [bySentiment, setBySentiment] = useState<Record<string, number>>({});
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    const load = (dim: string, set: (m: Record<string, number>) => void): void => {
      void api.getFeedbackAnalytics(dim, tenant).then((r) => {
        if (!live) return;
        const b = (r.data as { buckets?: api.Row[] } | null)?.buckets ?? [];
        const m: Record<string, number> = {};
        b.forEach(
          (x) =>
            (m[pick(x, 'key').toLowerCase() || pick(x, 'bucket').toLowerCase()] = Number(
              pick(x, 'count') || 0,
            )),
        );
        set(m);
      });
    };
    load('sentiment', setBySentiment);
    load('status', setByStatus);
    return () => {
      live = false;
    };
  }, [tenant, nonce]);
  const ql = q.trim().toLowerCase();
  const shown = records.rows.filter(
    (r) =>
      ql === '' ||
      pick(r, 'code').toLowerCase().includes(ql) ||
      pick(r, 'customerRef').toLowerCase().includes(ql),
  );
  const sum = (m: Record<string, number>): number => Object.values(m).reduce((a, b) => a + b, 0);
  const tiles = [
    { k: 'Total feedback', v: sum(byStatus) || records.rows.length },
    { k: 'Positive', v: bySentiment['positive'] ?? 0 },
    { k: 'Negative', v: bySentiment['negative'] ?? 0 },
    { k: 'Open', v: (byStatus['open'] ?? 0) + (byStatus['in_progress'] ?? 0) + (byStatus['assigned'] ?? 0) },
    { k: 'Closed', v: byStatus['closed'] ?? 0 },
  ];
  const createFb = async (): Promise<void> => {
    const r = await api.createFeedback(
      {
        ...(cust.trim() ? { customerRef: cust.trim() } : {}),
        ...(prod.trim() ? { product: prod.trim() } : {}),
        ...(narr.trim() ? { narrative: narr.trim() } : {}),
        channel: 'phone',
      },
      tenant,
    );
    if (r.ok && r.data) {
      setMsg({ ok: true, msg: 'Feedback record created.' });
      setCreating(false);
      setCust('');
      setProd('');
      setNarr('');
      setNonce((x) => x + 1);
      setOpenId(pick(r.data as api.Row, 'id'));
    } else {
      setMsg({ ok: false, msg: r.error ?? 'Could not create feedback.' });
    }
  };
  return (
    <>
      <h1 className="page-title">Feedback Management</h1>
      <p className="page-sub">
        Customer feedback over the canonical m12 engine · synthetic staging data. Capture → classify →
        assign/escalate → HOD resolution (maker-checker) → customer confirmation → rule-gated close. RBAC +
        tenant isolation + audit enforced server-side; customer contacts redacted unless permitted; no hard
        delete.
      </p>
      {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
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
          <h3>Feedback queue</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        <div className="run-picker" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['new', 'captured', 'assigned', 'in_progress', 'resolved', 'closed', 'reopened'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={sentiment} onChange={(e) => setSentiment(e.target.value)}>
            <option value="">All sentiment</option>
            {['positive', 'neutral', 'negative'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={product}
            placeholder="Product"
            onChange={(e) => setProduct(e.target.value)}
            style={{ width: 120 }}
          />
          <input value={q} placeholder="Search #/customer…" onChange={(e) => setQ(e.target.value)} />
          {can('feedback.record.create') && !creating && (
            <button className="btn" onClick={() => setCreating(true)}>
              New feedback
            </button>
          )}
          {creating && (
            <>
              <input value={cust} placeholder="Customer ref" onChange={(e) => setCust(e.target.value)} />
              <input value={prod} placeholder="Product" onChange={(e) => setProd(e.target.value)} />
              <input
                value={narr}
                placeholder="Comments"
                onChange={(e) => setNarr(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={createFb}>
                Create
              </button>
              <button className="btn link" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
        {records.loading ? (
          <div className="loading">Loading feedback…</div>
        ) : records.error ? (
          <div className="empty">Could not load feedback ({records.error}).</div>
        ) : shown.length === 0 ? (
          <div className="empty">No feedback matches.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ref</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Sentiment</th>
                <th>Status</th>
                <th>Owner</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={pick(r, 'id') || i}>
                  <td className="muted">{pick(r, 'code') || '—'}</td>
                  <td className="muted">{pick(r, 'customerRef') || '—'}</td>
                  <td className="muted">{pick(r, 'product') || '—'}</td>
                  <td>{sentimentPill(pick(r, 'sentiment'))}</td>
                  <td>{statusPill(pick(r, 'status'))}</td>
                  <td className="muted">{pick(r, 'currentOwner') || 'unassigned'}</td>
                  <td>
                    <button className="btn link" onClick={() => setOpenId(pick(r, 'id'))}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openId && (
        <FeedbackDrawer
          recordId={openId}
          tenant={tenant}
          perms={perms}
          actorId={actorId}
          onClose={() => setOpenId(null)}
          onChanged={() => setNonce((x) => x + 1)}
        />
      )}
    </>
  );
}

// ---------- Legal → Matters (M14) — operational legal-matter workspace over the CANONICAL m14-legal engine.
// No second legal engine, no hard delete (open/assign/resolve/close/reopen/archive/escalate are governed
// transitions). A matter can be created from an M13 case via the canonical from-case conversion (server-backed
// sourceCaseId link — never a duplicated case). Settlements are the canonical maker-checker (proposer != approver,
// SoD server-side). Party CONTACT is redacted unless permitted, and a reveal is audited. Links to m16 litigation
// are shown truthfully as references. ----------
const MATTER_LINKS: { field: string; label: string }[] = [
  { field: 'sourceCaseId', label: 'Originating case (m13)' },
  { field: 'courtReference', label: 'Litigation (m16)' },
];

function MatterDrawer({
  matterId,
  tenant,
  perms,
  actorId,
  onClose,
  onChanged,
}: {
  matterId: string;
  tenant: string | null;
  perms: Set<string>;
  actorId: string;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [m, setM] = useState<api.Row | null>(null);
  const [positions, setPositions] = useState<api.Row[]>([]);
  const [opinions, setOpinions] = useState<api.Row[]>([]);
  const [counsel, setCounsel] = useState<api.Row[]>([]);
  const [acts, setActs] = useState<api.Row[]>([]);
  const [settlements, setSettlements] = useState<api.Row[]>([]);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [owner, setOwner] = useState('');
  const [posText, setPosText] = useState('');
  const [opText, setOpText] = useState('');
  const [firmRef, setFirmRef] = useState('');
  const [actHead, setActHead] = useState('');
  const grab = (r: api.ApiResult<unknown>, key: string): api.Row[] =>
    ((r.data as Record<string, api.Row[]> | null)?.[key] ?? []) as api.Row[];
  useEffect(() => {
    let live = true;
    void api.getMatter(matterId, tenant).then((r) => live && setM((r.data as api.Row) ?? null));
    void api.getMatterPositions(matterId, tenant).then((r) => live && setPositions(grab(r, 'positions')));
    void api.getMatterOpinions(matterId, tenant).then((r) => live && setOpinions(grab(r, 'opinions')));
    void api.getMatterCounsel(matterId, tenant).then((r) => live && setCounsel(grab(r, 'counsel')));
    void api.getMatterActivities(matterId, tenant).then((r) => live && setActs(grab(r, 'activities')));
    void api
      .getMatterSettlements(matterId, tenant)
      .then((r) => live && setSettlements(grab(r, 'settlements')));
    return () => {
      live = false;
    };
  }, [matterId, tenant, nonce]);
  const refresh = (): void => {
    setNonce((x) => x + 1);
    onChanged();
  };
  const run = async (p: Promise<api.ApiResult<api.Row>>, ok: string): Promise<void> => {
    const r = await p;
    setMsg(r.ok ? { ok: true, msg: ok } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) refresh();
  };
  if (m === null)
    return (
      <div className="drawer-overlay" onClick={onClose} role="presentation">
        <aside className="drawer wide" onClick={(e) => e.stopPropagation()} role="dialog">
          <div className="loading">Loading matter…</div>
        </aside>
      </div>
    );
  const status = pick(m, 'status').toLowerCase();
  const ev = Number(m['version'] ?? 1);
  const terminal = /closed|archived/.test(status);
  const hasOwner = pick(m, 'currentOwner') !== '';
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside className="drawer wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Matter">
        <header className="drawer-head">
          <h3>
            {pick(m, 'matterNumber') || 'Matter'} — {pick(m, 'title')}
          </h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              {statusPill(pick(m, 'status'))} {pick(m, 'currentStage') && `· ${pick(m, 'currentStage')}`}
            </dd>
            <dt>Type / jurisdiction</dt>
            <dd>
              {pick(m, 'matterTypeCode') || '—'} · {pick(m, 'jurisdiction') || '—'}
            </dd>
            <dt>Owner / team</dt>
            <dd>
              {pick(m, 'currentOwner') || 'unassigned'} · {pick(m, 'legalTeam') || '—'}
            </dd>
            <dt>Priority / risk</dt>
            <dd>
              {pick(m, 'priority') || '—'} / {pick(m, 'legalRisk') || '—'}
            </dd>
            <dt>SLA</dt>
            <dd>
              {pick(m, 'slaPolicyCode') || '—'}
              {String(m['legalHold']) === 'true' ? ' · ⚖ legal hold' : ''}
              {String(m['privileged']) === 'true' ? ' · 🔒 privileged' : ''}
            </dd>
          </dl>
          {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}

          <h4 className="drawer-sub">Actions</h4>
          <div className="action-row">
            <ActionButton
              label="Open"
              allowed={/draft|registered|new|intake/.test(status) && can('legal.matter.open')}
              onRun={() => run(api.openMatter(matterId, ev, tenant), 'Matter opened.')}
            />
            <ActionButton
              label="Resolve"
              allowed={!terminal && status !== 'resolved' && can('legal.matter.resolve')}
              onRun={() => run(api.resolveMatter(matterId, ev, tenant), 'Matter resolved.')}
            />
            <ActionButton
              label="Close"
              allowed={(status === 'resolved' || !terminal) && can('legal.matter.close')}
              onRun={() => run(api.closeMatter(matterId, ev, tenant), 'Matter closed.')}
            />
            <ActionButton
              label="Reopen"
              needsReason
              allowed={(status === 'resolved' || status === 'closed') && can('legal.matter.reopen')}
              onRun={(reason) =>
                run(api.reopenMatter(matterId, ev, reason ?? '', tenant), 'Matter reopened.')
              }
            />
            <ActionButton
              label="Archive"
              danger
              allowed={status === 'closed' && can('legal.matter.archive')}
              onRun={() => run(api.archiveMatter(matterId, ev, tenant), 'Matter archived.')}
            />
            <ActionButton
              label="Escalate"
              needsReason
              allowed={!terminal && can('legal.matter.update')}
              onRun={(reason) =>
                run(api.escalateMatter(matterId, reason ?? '', tenant), 'Escalation triggered.')
              }
            />
          </div>
          {!terminal && can('legal.matter.assign') && (
            <div className="run-picker" style={{ gap: 6 }}>
              <input
                value={owner}
                placeholder={hasOwner ? 'Reassign to (actor id)' : 'Assign to (actor id)'}
                onChange={(e) => setOwner(e.target.value)}
              />
              <button
                className="btn"
                disabled={owner.trim() === ''}
                onClick={() =>
                  void run(
                    api.assignMatter(matterId, ev, owner.trim(), tenant, hasOwner),
                    hasOwner ? 'Matter reassigned.' : 'Matter assigned.',
                  ).then(() => setOwner(''))
                }
              >
                {hasOwner ? 'Reassign' : 'Assign'}
              </button>
              <button
                className="btn secondary"
                onClick={() =>
                  void run(api.assignMatter(matterId, ev, actorId, tenant, hasOwner), 'Assigned to me.')
                }
              >
                Take ownership
              </button>
            </div>
          )}

          <h4 className="drawer-sub">Legal positions</h4>
          <ul className="timeline">
            {positions.map((p, i) => (
              <li key={pick(p, 'id') || i}>
                <span className="t-head">{pick(p, 'summary') || pick(p, 'positionType') || 'Position'}</span>{' '}
                <span className="muted">{pick(p, 'approvalStatus') || pick(p, 'status') || ''}</span>
              </li>
            ))}
            {positions.length === 0 && <li className="muted">No positions.</li>}
          </ul>
          {can('legal.position.manage') && !terminal && (
            <div className="run-picker" style={{ gap: 6 }}>
              <input
                value={posText}
                placeholder="Position summary"
                onChange={(e) => setPosText(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn"
                disabled={posText.trim() === ''}
                onClick={() =>
                  void run(
                    api.addMatterPosition(matterId, { summary: posText.trim() }, tenant),
                    'Position added.',
                  ).then(() => setPosText(''))
                }
              >
                Add position
              </button>
            </div>
          )}

          <h4 className="drawer-sub">Legal opinions</h4>
          <ul className="timeline">
            {opinions.map((o, i) => (
              <li key={pick(o, 'id') || i}>
                <span className="t-head">{pick(o, 'opinionType') || 'Opinion'}</span>{' '}
                <span className="muted">
                  {pick(o, 'riskRating') && `risk ${pick(o, 'riskRating')} · `}
                  {pick(o, 'approvalStatus') || 'recorded'}
                </span>
              </li>
            ))}
            {opinions.length === 0 && <li className="muted">No opinions.</li>}
          </ul>
          {can('legal.opinion.manage') && !terminal && (
            <div className="run-picker" style={{ gap: 6 }}>
              <input
                value={opText}
                placeholder="Opinion type (e.g. merits)"
                onChange={(e) => setOpText(e.target.value)}
              />
              <button
                className="btn"
                disabled={opText.trim() === ''}
                onClick={() =>
                  void run(
                    api.addMatterOpinion(matterId, { opinionType: opText.trim() }, tenant),
                    'Opinion recorded.',
                  ).then(() => setOpText(''))
                }
              >
                Add opinion
              </button>
            </div>
          )}

          <h4 className="drawer-sub">External counsel</h4>
          <ul className="timeline">
            {counsel.map((c, i) => (
              <li key={pick(c, 'id') || i}>
                <span className="t-head">{pick(c, 'lawFirmRef') || 'Counsel'}</span>{' '}
                <span className="muted">
                  {pick(c, 'advocateRef')} · {pick(c, 'status')}
                </span>
              </li>
            ))}
            {counsel.length === 0 && <li className="muted">No counsel assigned.</li>}
          </ul>
          {can('legal.external_counsel.manage') && !terminal && (
            <div className="run-picker" style={{ gap: 6 }}>
              <input
                value={firmRef}
                placeholder="Law firm ref"
                onChange={(e) => setFirmRef(e.target.value)}
              />
              <button
                className="btn"
                disabled={firmRef.trim() === ''}
                onClick={() =>
                  void run(
                    api.addMatterCounsel(matterId, { lawFirmRef: firmRef.trim() }, tenant),
                    'Counsel assigned.',
                  ).then(() => setFirmRef(''))
                }
              >
                Assign counsel
              </button>
            </div>
          )}

          <h4 className="drawer-sub">Settlements (maker-checker)</h4>
          <p className="muted" style={{ fontSize: 11, margin: '0 0 4px' }}>
            A settlement needs a DISTINCT approver (proposer ≠ approver, SoD enforced server-side).
          </p>
          <table>
            <thead>
              <tr>
                <th>Proposal</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((st, i) => {
                const sid = pick(st, 'id');
                const sstatus = pick(st, 'approvalStatus') || pick(st, 'status');
                return (
                  <tr key={sid || i}>
                    <td>{pick(st, 'proposal') || '—'}</td>
                    <td className="num">{fmtMinor(pick(st, 'amountMinor'))}</td>
                    <td>{statusPill(sstatus)}</td>
                    <td>
                      <ActionButton
                        label="Approve"
                        allowed={
                          /proposed|pending|submitted/.test(sstatus.toLowerCase()) &&
                          can('legal.settlement.approve')
                        }
                        onRun={() =>
                          run(
                            api.approveSettlement(sid, tenant),
                            'Settlement approved (SoD: not the proposer).',
                          )
                        }
                      />
                    </td>
                  </tr>
                );
              })}
              {settlements.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No settlements.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {can('legal.settlement.submit') && !terminal && (
            <button
              className="btn secondary"
              onClick={() =>
                void run(
                  api.proposeSettlement(matterId, { proposal: 'Proposed settlement (synthetic)' }, tenant),
                  'Settlement proposed (awaiting a distinct approver).',
                )
              }
            >
              Propose settlement
            </button>
          )}

          <h4 className="drawer-sub">Activity timeline</h4>
          <ul className="timeline">
            {acts.map((a, i) => (
              <li key={pick(a, 'id') || i}>
                <span className="t-head">{pick(a, 'headline') || pick(a, 'activityType')}</span>{' '}
                <span className="muted">{pick(a, 'status')}</span>
              </li>
            ))}
            {acts.length === 0 && <li className="muted">No activities.</li>}
          </ul>
          {can('legal.activity.create') && !terminal && (
            <div className="run-picker" style={{ gap: 6 }}>
              <input
                value={actHead}
                placeholder="Activity headline"
                onChange={(e) => setActHead(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn"
                disabled={actHead.trim() === ''}
                onClick={() =>
                  void run(
                    api.addMatterActivity(
                      matterId,
                      { activityType: 'note', headline: actHead.trim() },
                      tenant,
                    ),
                    'Activity added.',
                  ).then(() => setActHead(''))
                }
              >
                Add
              </button>
            </div>
          )}

          <h4 className="drawer-sub">Cross-module links</h4>
          <div className="linkrow">
            {MATTER_LINKS.filter((l) => pick(m, l.field) !== '').map((l) => (
              <span key={l.field} className="pill info">
                {l.label}: {pick(m, l.field).slice(0, 12)}
                {l.field === 'courtReference' ? ' — litigation workspace coming next' : ''}
              </span>
            ))}
            {MATTER_LINKS.every((l) => pick(m, l.field) === '') && (
              <span className="muted">No linked case / litigation.</span>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function MattersWorkspace({
  tenant,
  perms,
  actorId,
}: {
  tenant: string | null;
  perms: Set<string>;
  actorId: string;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<'' | 'new' | 'from-case'>('');
  const [typeCode, setTypeCode] = useState('');
  const [title, setTitle] = useState('');
  const [caseId, setCaseId] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const matters = useRows(async () => {
    const r = await api.getMatters(tenant, { status });
    return { ...r, data: (r.data as { matters?: api.Row[] } | null)?.matters ?? [] };
  }, [tenant, nonce, status]);
  const ql = q.trim().toLowerCase();
  const shown = matters.rows.filter(
    (m) =>
      ql === '' ||
      pick(m, 'title').toLowerCase().includes(ql) ||
      pick(m, 'matterNumber').toLowerCase().includes(ql),
  );
  const create = async (): Promise<void> => {
    const r =
      creating === 'from-case'
        ? await api.matterFromCase(
            { sourceCaseId: caseId.trim(), matterTypeCode: typeCode.trim(), title: title.trim() },
            tenant,
          )
        : await api.createMatter({ matterTypeCode: typeCode.trim(), title: title.trim() }, tenant);
    if (r.ok && r.data) {
      const row = (r.data as { matter?: api.Row } | null)?.matter ?? (r.data as api.Row);
      setMsg({
        ok: true,
        msg: creating === 'from-case' ? 'Matter opened from case (server-backed link).' : 'Matter created.',
      });
      setCreating('');
      setTypeCode('');
      setTitle('');
      setCaseId('');
      setNonce((x) => x + 1);
      setOpenId(pick(row, 'id'));
    } else {
      setMsg({ ok: false, msg: r.error ?? 'Could not create matter (a published matter type is required).' });
    }
  };
  return (
    <>
      <h1 className="page-title">Legal matters</h1>
      <p className="page-sub">
        Legal-matter management over the canonical m14 engine · synthetic staging data. A matter can be opened
        from an m13 case (server-backed link). RBAC + tenant isolation + audit enforced server-side; party
        contacts redacted unless permitted; settlements are maker-checker; no hard delete.
      </p>
      {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
      <div className="card">
        <header>
          <h3>Matters</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        <div className="run-picker" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['draft', 'open', 'assigned', 'resolved', 'closed', 'archived'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input value={q} placeholder="Search #/title…" onChange={(e) => setQ(e.target.value)} />
          {can('legal.matter.create') && creating === '' && (
            <button className="btn" onClick={() => setCreating('new')}>
              New matter
            </button>
          )}
          {can('legal.conversion.accept') && creating === '' && (
            <button className="btn secondary" onClick={() => setCreating('from-case')}>
              From case
            </button>
          )}
          {creating !== '' && (
            <>
              {creating === 'from-case' && (
                <input
                  value={caseId}
                  placeholder="Source case id"
                  onChange={(e) => setCaseId(e.target.value)}
                />
              )}
              <input
                value={typeCode}
                placeholder="Matter type code"
                onChange={(e) => setTypeCode(e.target.value)}
              />
              <input value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
              <button
                className="btn"
                disabled={
                  typeCode.trim() === '' ||
                  title.trim() === '' ||
                  (creating === 'from-case' && caseId.trim() === '')
                }
                onClick={create}
              >
                {creating === 'from-case' ? 'Open from case' : 'Create'}
              </button>
              <button className="btn link" onClick={() => setCreating('')}>
                Cancel
              </button>
            </>
          )}
        </div>
        {matters.loading ? (
          <div className="loading">Loading matters…</div>
        ) : matters.error ? (
          <div className="empty">Could not load matters ({matters.error}).</div>
        ) : shown.length === 0 ? (
          <div className="empty">No matters match.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Matter #</th>
                <th>Title</th>
                <th>Type</th>
                <th>Jurisdiction</th>
                <th>Status</th>
                <th>Owner</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m, i) => (
                <tr key={pick(m, 'id') || i}>
                  <td className="muted">{pick(m, 'matterNumber') || '—'}</td>
                  <td>{pick(m, 'title')}</td>
                  <td className="muted">{pick(m, 'matterTypeCode')}</td>
                  <td className="muted">{pick(m, 'jurisdiction') || '—'}</td>
                  <td>{statusPill(pick(m, 'status'))}</td>
                  <td className="muted">{pick(m, 'currentOwner') || 'unassigned'}</td>
                  <td>
                    <button className="btn link" onClick={() => setOpenId(pick(m, 'id'))}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openId && (
        <MatterDrawer
          matterId={openId}
          tenant={tenant}
          perms={perms}
          actorId={actorId}
          onClose={() => setOpenId(null)}
          onChanged={() => setNonce((x) => x + 1)}
        />
      )}
    </>
  );
}

// ---------- Legal → Cases (M13) — operational case workspace over the CANONICAL m13-case engine. No second case
// engine, no hard delete (open/triage/assign/resolve/close/reopen/archive/escalate are governed transitions).
// Party CONTACT details are redacted server-side unless the caller holds cases.party_contact.read, and a genuine
// contact reveal is audited (CASE_PARTY_CONTACT_ACCESSED). Links to m14/m16/m17/m18 are shown truthfully as
// references — those workspaces come next; no fake detail routes. ----------
const CASE_LINKS: { field: string; label: string }[] = [
  { field: 'legalStatus', label: 'Legal matter (m14)' },
  { field: 'courtReference', label: 'Litigation (m16)' },
  { field: 'recoveryState', label: 'Recovery (m17)' },
];

function CaseDrawer({
  caseId,
  tenant,
  perms,
  actorId,
  onClose,
  onChanged,
}: {
  caseId: string;
  tenant: string | null;
  perms: Set<string>;
  actorId: string;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [c, setC] = useState<api.Row | null>(null);
  const [parties, setParties] = useState<api.Row[]>([]);
  const [acts, setActs] = useState<api.Row[]>([]);
  const [deadlines, setDeadlines] = useState<api.Row[]>([]);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [owner, setOwner] = useState('');
  const [pType, setPType] = useState('complainant');
  const [pLabel, setPLabel] = useState('');
  const [pContact, setPContact] = useState('');
  const [actType, setActType] = useState('note');
  const [actHead, setActHead] = useState('');
  useEffect(() => {
    let live = true;
    void api.getCase(caseId, tenant).then((r) => {
      if (live) setC((r.data as api.Row) ?? null);
    });
    void api.getCaseParties(caseId, tenant).then((r) => {
      if (live) setParties((r.data as { parties?: api.Row[] } | null)?.parties ?? []);
    });
    void api.getCaseActivities(caseId, tenant).then((r) => {
      if (live) setActs((r.data as { activities?: api.Row[] } | null)?.activities ?? []);
    });
    void api.getCaseDeadlines(caseId, tenant).then((r) => {
      if (live) setDeadlines((r.data as { deadlines?: api.Row[] } | null)?.deadlines ?? []);
    });
    return () => {
      live = false;
    };
  }, [caseId, tenant, nonce]);
  const refresh = (): void => {
    setNonce((x) => x + 1);
    onChanged();
  };
  const run = async (p: Promise<api.ApiResult<api.Row>>, ok: string): Promise<void> => {
    const r = await p;
    setMsg(r.ok ? { ok: true, msg: ok } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) refresh();
  };
  if (c === null)
    return (
      <div className="drawer-overlay" onClick={onClose} role="presentation">
        <aside className="drawer wide" onClick={(e) => e.stopPropagation()} role="dialog">
          <div className="loading">Loading case…</div>
        </aside>
      </div>
    );
  const status = pick(c, 'status').toLowerCase();
  const ev = Number(c['version'] ?? 1);
  const terminal = /closed|archived/.test(status);
  const hasOwner = pick(c, 'currentOwner') !== '';
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside className="drawer wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Case">
        <header className="drawer-head">
          <h3>
            {pick(c, 'caseNumber') || 'Case'} — {pick(c, 'title')}
          </h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              {statusPill(pick(c, 'status'))} {pick(c, 'currentStage') && `· ${pick(c, 'currentStage')}`}
            </dd>
            <dt>Priority / severity</dt>
            <dd>
              {pick(c, 'priority') || '—'} / {pick(c, 'severity') || '—'}
            </dd>
            <dt>Owner / team</dt>
            <dd>
              {pick(c, 'currentOwner') || 'unassigned'} · {pick(c, 'responsibleTeam') || '—'}
            </dd>
            <dt>SLA policy</dt>
            <dd>{pick(c, 'slaPolicyCode') || '—'}</dd>
            <dt>Customer</dt>
            <dd>{pick(c, 'customerRef') || '—'}</dd>
            <dt>Confidentiality</dt>
            <dd>
              {pick(c, 'confidentiality') || 'standard'}
              {String(c['legalHold']) === 'true' ? ' · ⚖ legal hold' : ''}
            </dd>
          </dl>
          {pick(c, 'summary') && <p className="muted">{pick(c, 'summary')}</p>}
          {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}

          <h4 className="drawer-sub">Actions</h4>
          <div className="action-row">
            <ActionButton
              label="Open"
              allowed={/draft|registered|new|intake/.test(status) && can('cases.case.open')}
              onRun={() => run(api.openCase(caseId, ev, tenant), 'Case opened.')}
            />
            <ActionButton
              label="Resolve"
              allowed={!terminal && status !== 'resolved' && can('cases.case.resolve')}
              onRun={() => run(api.resolveCase(caseId, ev, tenant), 'Case resolved.')}
            />
            <ActionButton
              label="Close"
              allowed={(status === 'resolved' || !terminal) && can('cases.case.close')}
              onRun={() => run(api.closeCase(caseId, ev, tenant), 'Case closed.')}
            />
            <ActionButton
              label="Reopen"
              allowed={(status === 'resolved' || status === 'closed') && can('cases.case.reopen')}
              needsReason
              onRun={(reason) => run(api.reopenCase(caseId, ev, reason ?? '', tenant), 'Case reopened.')}
            />
            <ActionButton
              label="Archive"
              allowed={status === 'closed' && can('cases.case.archive')}
              danger
              onRun={() => run(api.archiveCase(caseId, ev, tenant), 'Case archived.')}
            />
            <ActionButton
              label="Escalate"
              allowed={!terminal && can('cases.case.update')}
              needsReason
              onRun={(reason) => run(api.escalateCase(caseId, reason ?? '', tenant), 'Escalation triggered.')}
            />
          </div>
          {!terminal && can('cases.case.assign') && (
            <div className="run-picker" style={{ gap: 6 }}>
              <input
                value={owner}
                placeholder={hasOwner ? 'Reassign to (actor id)' : 'Assign to (actor id)'}
                onChange={(e) => setOwner(e.target.value)}
              />
              <button
                className="btn"
                disabled={owner.trim() === ''}
                onClick={() =>
                  void run(
                    api.assignCase(caseId, ev, owner.trim(), tenant, hasOwner),
                    hasOwner ? 'Case reassigned.' : 'Case assigned.',
                  ).then(() => setOwner(''))
                }
              >
                {hasOwner ? 'Reassign' : 'Assign'}
              </button>
              <button
                className="btn secondary"
                onClick={() =>
                  void run(api.assignCase(caseId, ev, actorId, tenant, hasOwner), 'Assigned to me.')
                }
              >
                Take ownership
              </button>
            </div>
          )}

          <h4 className="drawer-sub">Parties</h4>
          <table>
            <thead>
              <tr>
                <th>Type / role</th>
                <th>Label</th>
                <th>Contact</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p, i) => (
                <tr key={pick(p, 'id') || i}>
                  <td className="muted">
                    {pick(p, 'partyType')} {pick(p, 'role') && `· ${pick(p, 'role')}`}
                  </td>
                  <td>{pick(p, 'displayLabel') || '—'}</td>
                  <td className="muted">{pick(p, 'contactRef') || '—'}</td>
                  <td>
                    {can('cases.party.manage') && String(p['active']) === 'true' && (
                      <button
                        className="btn link sm"
                        onClick={() =>
                          void run(
                            api.removeCaseParty(pick(p, 'id'), Number(p['version'] ?? 1), tenant),
                            'Party removed.',
                          )
                        }
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {parties.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No parties.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {can('cases.party.manage') && !terminal && (
            <div className="run-picker" style={{ gap: 6, flexWrap: 'wrap' }}>
              <select value={pType} onChange={(e) => setPType(e.target.value)}>
                {['complainant', 'respondent', 'witness', 'representative', 'third_party'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              <input value={pLabel} placeholder="Display label" onChange={(e) => setPLabel(e.target.value)} />
              <input
                value={pContact}
                placeholder="Contact ref (optional)"
                onChange={(e) => setPContact(e.target.value)}
              />
              <button
                className="btn"
                onClick={() =>
                  void run(
                    api.addCaseParty(
                      caseId,
                      {
                        partyType: pType,
                        ...(pLabel.trim() ? { displayLabel: pLabel.trim() } : {}),
                        ...(pContact.trim() ? { contactRef: pContact.trim() } : {}),
                      },
                      tenant,
                    ),
                    'Party added.',
                  ).then(() => {
                    setPLabel('');
                    setPContact('');
                  })
                }
              >
                Add party
              </button>
            </div>
          )}

          <h4 className="drawer-sub">Activity timeline</h4>
          <ul className="timeline">
            {acts.map((a, i) => (
              <li key={pick(a, 'id') || i}>
                <span className="t-head">{pick(a, 'headline') || pick(a, 'activityType')}</span>{' '}
                <span className="muted">
                  {pick(a, 'activityType')} · {pick(a, 'status')}
                  {pick(a, 'outcome') ? ` · ${pick(a, 'outcome')}` : ''}
                </span>
              </li>
            ))}
            {acts.length === 0 && <li className="muted">No activities.</li>}
          </ul>
          {can('cases.activity.create') && !terminal && (
            <div className="run-picker" style={{ gap: 6 }}>
              <select value={actType} onChange={(e) => setActType(e.target.value)}>
                {['note', 'call', 'email', 'meeting', 'correspondence', 'task'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              <input
                value={actHead}
                placeholder="Headline"
                onChange={(e) => setActHead(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn"
                disabled={actHead.trim() === ''}
                onClick={() =>
                  void run(
                    api.addCaseActivity(caseId, { activityType: actType, headline: actHead.trim() }, tenant),
                    'Activity added.',
                  ).then(() => setActHead(''))
                }
              >
                Add
              </button>
            </div>
          )}

          {deadlines.length > 0 && (
            <>
              <h4 className="drawer-sub">Deadlines</h4>
              <ul className="timeline">
                {deadlines.map((d, i) => (
                  <li key={pick(d, 'id') || i}>
                    <span className="t-head">
                      {pick(d, 'deadlineType') || pick(d, 'label') || 'Deadline'}
                    </span>{' '}
                    <span className="muted">
                      {pick(d, 'dueAt') || pick(d, 'dueDate') || ''} · {pick(d, 'status')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4 className="drawer-sub">Cross-module links</h4>
          <div className="linkrow">
            {CASE_LINKS.filter((l) => pick(c, l.field) !== '').map((l) => (
              <span key={l.field} className="pill info" title="Workspace coming next">
                {l.label}: {pick(c, l.field)} — web workspace coming next
              </span>
            ))}
            {CASE_LINKS.every((l) => pick(c, l.field) === '') && (
              <span className="muted">No linked matter / litigation / recovery.</span>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function CasesWorkspace({
  tenant,
  perms,
  actorId,
}: {
  tenant: string | null;
  perms: Set<string>;
  actorId: string;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [typeCode, setTypeCode] = useState('');
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const cases = useRows(async () => {
    const r = await api.getCases(tenant, { status, priority });
    return { ...r, data: (r.data as { cases?: api.Row[] } | null)?.cases ?? [] };
  }, [tenant, nonce, status, priority]);
  const ql = q.trim().toLowerCase();
  const shown = cases.rows.filter(
    (c) =>
      ql === '' ||
      pick(c, 'title').toLowerCase().includes(ql) ||
      pick(c, 'caseNumber').toLowerCase().includes(ql),
  );
  const createCase = async (): Promise<void> => {
    const r = await api.createCase({ caseTypeCode: typeCode.trim(), title: title.trim() }, tenant);
    if (r.ok && r.data) {
      setMsg({ ok: true, msg: 'Case created.' });
      setCreating(false);
      setTypeCode('');
      setTitle('');
      setNonce((x) => x + 1);
      setOpenId(pick(r.data as api.Row, 'id'));
    } else {
      setMsg({ ok: false, msg: r.error ?? 'Could not create case (a published case type is required).' });
    }
  };
  return (
    <>
      <h1 className="page-title">Cases</h1>
      <p className="page-sub">
        Case management over the canonical m13 engine · synthetic staging data. RBAC + tenant isolation +
        audit enforced server-side; party contacts are redacted unless permitted (and a reveal is audited). No
        hard delete — cases resolve / close / archive.
      </p>
      {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
      <div className="card">
        <header>
          <h3>Cases</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        <div className="run-picker" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['draft', 'open', 'assigned', 'resolved', 'closed', 'archived'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">All priorities</option>
            {['low', 'medium', 'high', 'urgent'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input value={q} placeholder="Search #/title…" onChange={(e) => setQ(e.target.value)} />
          {can('cases.case.create') && !creating && (
            <button className="btn" onClick={() => setCreating(true)}>
              New case
            </button>
          )}
          {creating && (
            <>
              <input
                value={typeCode}
                placeholder="Case type code"
                onChange={(e) => setTypeCode(e.target.value)}
              />
              <input value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
              <button
                className="btn"
                disabled={typeCode.trim() === '' || title.trim() === ''}
                onClick={createCase}
              >
                Create
              </button>
              <button className="btn link" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
        {cases.loading ? (
          <div className="loading">Loading cases…</div>
        ) : cases.error ? (
          <div className="empty">Could not load cases ({cases.error}).</div>
        ) : shown.length === 0 ? (
          <div className="empty">No cases match.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Case #</th>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Owner</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c, i) => (
                <tr key={pick(c, 'id') || i}>
                  <td className="muted">{pick(c, 'caseNumber') || '—'}</td>
                  <td>{pick(c, 'title')}</td>
                  <td className="muted">{pick(c, 'caseTypeCode')}</td>
                  <td>{statusPill(pick(c, 'status'))}</td>
                  <td className="muted">{pick(c, 'priority') || '—'}</td>
                  <td className="muted">{pick(c, 'currentOwner') || 'unassigned'}</td>
                  <td>
                    <button className="btn link" onClick={() => setOpenId(pick(c, 'id'))}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openId && (
        <CaseDrawer
          caseId={openId}
          tenant={tenant}
          perms={perms}
          actorId={actorId}
          onClose={() => setOpenId(null)}
          onChanged={() => setNonce((x) => x + 1)}
        />
      )}
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
function useControlsWithStatus(
  tenant: string | null,
  nonce = 0,
): {
  rows: (api.Row & { _latest: string })[];
  loading: boolean;
  error: string | null;
} {
  const controls = useRows(() => api.getGrcControls(tenant), [tenant, nonce]);
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

// Define a new control — canonical m41 `POST /grc/controls` (grc.control.manage, audited). Rendered only when the
// actor holds the permission; the server stays authoritative (a hidden form still 403s if the route is called
// directly). This is the ONLY governed write here besides append-only assessments — there is no update/retire.
function CreateControlCard({
  tenant,
  onCreated,
}: {
  tenant: string | null;
  onCreated: () => void;
}): JSX.Element {
  const [controlKey, setControlKey] = useState('');
  const [framework, setFramework] = useState('kenya_dpa');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const valid = controlKey.trim() !== '' && title.trim() !== '';
  const submit = async (): Promise<void> => {
    setSaving(true);
    setMsg(null);
    const r = await api.createGrcControl(
      {
        controlKey: controlKey.trim(),
        framework,
        title: title.trim(),
        ...(scope.trim() ? { scope: scope.trim() } : {}),
      },
      tenant,
    );
    setSaving(false);
    if (r.ok) {
      setMsg({ ok: true, msg: 'Control defined (canonical m41, audited GRC_CONTROL_DEFINED).' });
      setControlKey('');
      setTitle('');
      setScope('');
      onCreated();
    } else {
      setMsg({ ok: false, msg: r.error ?? 'Could not define control.' });
    }
  };
  return (
    <div className="card">
      <header>
        <h3>Define control</h3>
        <span className="demo-note">grc.control.manage</span>
      </header>
      <div className="field">
        <input
          value={controlKey}
          placeholder="Control key (e.g. DPA-07)"
          onChange={(e) => setControlKey(e.target.value)}
        />
      </div>
      <div className="field">
        <input value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="run-picker" style={{ padding: 0, border: 'none' }}>
        <label>Framework</label>
        <select value={framework} onChange={(e) => setFramework(e.target.value)}>
          {Object.entries(FRAMEWORK_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <input value={scope} placeholder="Scope (optional)" onChange={(e) => setScope(e.target.value)} />
      </div>
      {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
      <button className="btn" disabled={!valid || saving} onClick={submit}>
        {saving ? 'Defining…' : 'Define control'}
      </button>
      <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
        Canonical create only (controlKey · framework · title · optional scope). Posture then changes via
        append-only assessments — there is no control update or hard delete.
      </p>
    </div>
  );
}

function ComplianceRegister({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [nonce, setNonce] = useState(0);
  const { rows, loading, error } = useControlsWithStatus(tenant, nonce);
  const [fw, setFw] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<api.Row | null>(null);
  const frameworks = Array.from(new Set(rows.map((r) => pick(r, 'framework')))).filter(Boolean);
  const ql = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (fw === '' || pick(r, 'framework') === fw) &&
      (ql === '' ||
        pick(r, 'controlKey').toLowerCase().includes(ql) ||
        pick(r, 'title').toLowerCase().includes(ql)),
  );
  return (
    <>
      <h1 className="page-title">Control register</h1>
      <p className="page-sub">
        Compliance controls + latest assessment evidence over the canonical GRC register (m41) · synthetic
        staging data. RBAC + tenant isolation enforced server-side.
      </p>
      {can('grc.control.manage') && (
        <CreateControlCard tenant={tenant} onCreated={() => setNonce((x) => x + 1)} />
      )}
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
          <input
            value={q}
            placeholder="Search key or title…"
            onChange={(e) => setQ(e.target.value)}
            style={{ marginLeft: 8 }}
          />
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

// ---------- Administration → Plans & Subscriptions (M39) — canonical m39-saas commercial engine. No second SaaS
// engine, no hard delete (suspend/cancel are governed transitions; published versions immutable). Entitlement
// (subscription/assignment) decides MODULE AVAILABILITY; M02 RBAC still decides actor actions inside a module —
// the two are never collapsed. ----------
const VERTICAL_CAPS: { key: string; label: string }[] = [
  { key: 'treasury_reconciliation', label: 'Treasury reconciliation' },
  { key: 'debt_recovery', label: 'Debt recovery' },
  { key: 'regulatory_compliance', label: 'Regulatory compliance' },
];

function PlanVersionsDrawer({
  plan,
  tenant,
  onClose,
}: {
  plan: api.Row;
  tenant: string | null;
  onClose: () => void;
}): JSX.Element {
  const planId = pick(plan, 'id');
  const [versions, setVersions] = useState<api.Row[] | null>(null);
  const [ents, setEnts] = useState<Record<string, api.Row[]>>({});
  useEffect(() => {
    let live = true;
    setVersions(null);
    void api.getPlanVersions(planId, tenant).then(async (r) => {
      const vs = (r.data as { versions?: api.Row[] } | null)?.versions ?? [];
      if (!live) return;
      setVersions(vs);
      const map: Record<string, api.Row[]> = {};
      for (const v of vs) {
        const er = await api.getVersionEntitlements(pick(v, 'id'), tenant);
        map[pick(v, 'id')] = (er.data as { entitlements?: api.Row[] } | null)?.entitlements ?? [];
      }
      if (live) setEnts(map);
    });
    return () => {
      live = false;
    };
  }, [planId, tenant]);
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Plan versions">
        <header className="drawer-head">
          <h3>{pick(plan, 'name') || pick(plan, 'planKey')}</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <dl className="kv">
            <dt>Plan key</dt>
            <dd>{pick(plan, 'planKey')}</dd>
            <dt>State</dt>
            <dd>{statusPill(pick(plan, 'state'))}</dd>
            <dt>Current version</dt>
            <dd>{pick(plan, 'currentVersionNo') || '—'}</dd>
          </dl>
          <h4 className="drawer-sub">Versions</h4>
          {versions === null ? (
            <div className="loading">Loading…</div>
          ) : versions.length === 0 ? (
            <div className="empty">No versions yet.</div>
          ) : (
            versions.map((v, i) => (
              <div className="card" key={pick(v, 'id') || i} style={{ marginBottom: 8 }}>
                <header>
                  <h3>
                    v{pick(v, 'versionNo')} · {fmtMinor(pick(v, 'baseAmountMinor'))} {pick(v, 'currency')}
                  </h3>
                  {statusPill(pick(v, 'state'))}
                </header>
                <p className="muted" style={{ fontSize: 12, margin: '2px 0' }}>
                  Billing {pick(v, 'billingInterval') || '—'} · validation{' '}
                  {String(v['validationPassed']) === 'true' ? '✓' : '—'} ·{' '}
                  {String(v['state']).toLowerCase() === 'published' ? 'immutable (published)' : 'draft'}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Capability</th>
                      <th>Allowance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ents[pick(v, 'id')] ?? []).map((e, j) => (
                      <tr key={pick(e, 'id') || j}>
                        <td className="muted">{pick(e, 'capabilityKey')}</td>
                        <td>{pick(e, 'allowance')}</td>
                      </tr>
                    ))}
                    {(ents[pick(v, 'id')] ?? []).length === 0 && (
                      <tr>
                        <td colSpan={2} className="muted">
                          No entitlements in this version.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function PlansSubscriptionsAdmin({
  tenant,
  perms,
}: {
  tenant: string | null;
  perms: Set<string>;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [tab, setTab] = useState<'plans' | 'subscriptions' | 'entitlements'>('plans');
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [openPlan, setOpenPlan] = useState<api.Row | null>(null);
  const plans = useRows(async () => {
    const r = await api.getSaasPlans(tenant);
    return { ...r, data: (r.data as { plans?: api.Row[] } | null)?.plans ?? [] };
  }, [tenant, nonce]);
  const subs = useRows(async () => {
    const r = await api.getSubscriptions(tenant);
    return { ...r, data: (r.data as { subscriptions?: api.Row[] } | null)?.subscriptions ?? [] };
  }, [tenant, nonce]);
  // effective entitlements for the current tenant (the canonical resolver self-check).
  const [ent, setEnt] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let live = true;
    setEnt(null);
    if (!tenant) return;
    void Promise.all(VERTICAL_CAPS.map((c) => api.getEntitlement(c.key, tenant))).then((rs) => {
      if (!live) return;
      const m: Record<string, boolean> = {};
      rs.forEach((r, i) => (m[VERTICAL_CAPS[i].key] = r.ok && r.data ? r.data.entitled === true : false));
      setEnt(m);
    });
    return () => {
      live = false;
    };
  }, [tenant, nonce]);
  const [planKey, setPlanKey] = useState('');
  const [planName, setPlanName] = useState('');
  const run = async (p: Promise<api.ApiResult<api.Row>>, ok: string): Promise<void> => {
    const r = await p;
    setMsg(r.ok ? { ok: true, msg: ok } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) setNonce((x) => x + 1);
  };
  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'plans', label: 'Plans' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'entitlements', label: 'Effective entitlements' },
  ];
  return (
    <>
      <h1 className="page-title">Plans &amp; subscriptions</h1>
      <p className="page-sub">
        Commercial catalogue + subscriptions over the canonical m39 engine · synthetic staging data.
        Entitlement (subscription) decides module <strong>availability</strong>; M02 RBAC still governs
        actions inside a module. RBAC + tenant isolation enforced server-side; no hard delete.
      </p>
      {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
      <div className="card">
        <div className="run-picker">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`btn ${tab === t.id ? '' : 'secondary'}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'plans' && (
          <>
            {can('saas.plan.manage') && (
              <div className="run-picker" style={{ gap: 6 }}>
                <input value={planKey} placeholder="Plan key" onChange={(e) => setPlanKey(e.target.value)} />
                <input value={planName} placeholder="Name" onChange={(e) => setPlanName(e.target.value)} />
                <button
                  className="btn"
                  disabled={planKey.trim() === '' || planName.trim() === ''}
                  onClick={() =>
                    void run(
                      api.createSaasPlan({ planKey: planKey.trim(), name: planName.trim() }, tenant),
                      'Plan defined (draft).',
                    ).then(() => {
                      setPlanKey('');
                      setPlanName('');
                    })
                  }
                >
                  Define plan
                </button>
              </div>
            )}
            {plans.loading ? (
              <div className="loading">Loading plans…</div>
            ) : plans.rows.length === 0 ? (
              <div className="empty">No plans.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Name</th>
                    <th>State</th>
                    <th className="num">Current ver.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {plans.rows.map((p, i) => (
                    <tr key={pick(p, 'id') || i}>
                      <td className="muted">{pick(p, 'planKey')}</td>
                      <td>{pick(p, 'name')}</td>
                      <td>{statusPill(pick(p, 'state'))}</td>
                      <td className="num">{pick(p, 'currentVersionNo') || '—'}</td>
                      <td>
                        <button className="btn link" onClick={() => setOpenPlan(p)}>
                          Versions
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'subscriptions' &&
          (subs.loading ? (
            <div className="loading">Loading subscriptions…</div>
          ) : subs.rows.length === 0 ? (
            <div className="empty">No subscriptions.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Plan / version</th>
                  <th>Status</th>
                  <th>Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {subs.rows.map((sub, i) => {
                  const id = pick(sub, 'id');
                  const ver = Number(sub['version'] ?? 1);
                  const st = pick(sub, 'state').toLowerCase();
                  const m = can('saas.subscription.manage');
                  return (
                    <tr key={id || i}>
                      <td className="muted">{pick(sub, 'subscriptionKey')}</td>
                      <td className="muted">
                        {pick(sub, 'planId').slice(0, 8)} / {pick(sub, 'planVersionId').slice(0, 8)}
                      </td>
                      <td>{statusPill(pick(sub, 'state'))}</td>
                      <td>
                        <div className="action-row">
                          <ActionButton
                            label="Activate"
                            allowed={m && st !== 'active' && st !== 'cancelled'}
                            onRun={() =>
                              run(api.activateSubscription(id, ver, tenant), 'Subscription activated.')
                            }
                          />
                          <ActionButton
                            label="Suspend"
                            allowed={m && st === 'active'}
                            onRun={() =>
                              run(api.suspendSubscription(id, ver, tenant), 'Subscription suspended.')
                            }
                          />
                          <ActionButton
                            label="Renew"
                            allowed={m && st === 'active'}
                            onRun={() => run(api.renewSubscription(id, ver, tenant), 'Subscription renewed.')}
                          />
                          <ActionButton
                            label="Cancel"
                            danger
                            needsReason
                            allowed={m && st !== 'cancelled'}
                            onRun={() =>
                              run(api.cancelSubscription(id, ver, tenant), 'Subscription cancelled.')
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}

        {tab === 'entitlements' && (
          <>
            <p className="muted" style={{ fontSize: 12 }}>
              The current tenant's effective vertical entitlements, from the canonical resolver (`GET
              /saas/entitlements/check`). This governs whether a vertical's nav group is AVAILABLE; a member
              still needs the M02 permission to act inside it.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Entitled</th>
                </tr>
              </thead>
              <tbody>
                {VERTICAL_CAPS.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td>
                      {ent === null ? (
                        '…'
                      ) : ent[c.key] ? (
                        <span className="pill ok">Included</span>
                      ) : (
                        <span className="pill bad">Not entitled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      {openPlan && <PlanVersionsDrawer plan={openPlan} tenant={tenant} onClose={() => setOpenPlan(null)} />}
    </>
  );
}

// ---------- Privacy & Security read model (M41) — RLS-scoped, permission-gated READS over the canonical
// privacy/DLP/incident tables. No mutation here; no regulatory conclusions — canonical fields only. DLP findings
// + privacy records are append-only evidence (privacy records show only an OPAQUE subject reference). ----------
const sevPill = (s: string): JSX.Element => {
  const v = (s || '').toLowerCase();
  const cls = /critical|high/.test(v) ? 'bad' : /medium/.test(v) ? 'warn' : 'info';
  return <span className={`pill ${cls}`}>{s || '—'}</span>;
};

function PrivacySecurityWorkspace({
  tenant,
  perms,
}: {
  tenant: string | null;
  perms: Set<string>;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const canPrivacy = can('privacy.policy.read');
  const canSec = can('security.dlp.read');
  const tabs = (
    [
      canPrivacy && { id: 'classifications', label: 'Data classifications' },
      canPrivacy && { id: 'records', label: 'Privacy records' },
      canSec && { id: 'policies', label: 'DLP policies' },
      canSec && { id: 'findings', label: 'DLP findings' },
      canSec && { id: 'incidents', label: 'Security incidents' },
    ] as ({ id: string; label: string } | false)[]
  ).filter(Boolean) as { id: string; label: string }[];
  const [tab, setTab] = useState(tabs[0]?.id ?? 'none');
  const list = useRows(() => {
    switch (tab) {
      case 'classifications':
        return api.getPrivacyClassifications(tenant);
      case 'records':
        return api.getPrivacyRecords(tenant);
      case 'policies':
        return api.getDlpPolicies(tenant);
      case 'findings':
        return api.getDlpFindings(tenant);
      case 'incidents':
        return api.getSecurityIncidents(tenant);
      default:
        return Promise.resolve({ ok: true, data: [] } as api.ApiResult<unknown>);
    }
  }, [tenant, tab]);
  const rows = list.rows;
  return (
    <>
      <h1 className="page-title">Privacy &amp; security</h1>
      <p className="page-sub">
        Read-only view over the canonical m41 privacy / DLP / incident evidence · synthetic staging data. RLS
        + RBAC enforced server-side. Shows control/evidence <strong>state</strong> — not a regulatory
        conclusion.
      </p>
      {tabs.length === 0 ? (
        <div className="card">
          <div className="empty">
            Reading these surfaces needs <code>privacy.policy.read</code> or <code>security.dlp.read</code>.
            Your role has neither — the server denies the read (this is not merely hidden UI).
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="run-picker">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                className={`btn ${tab === tb.id ? '' : 'secondary'}`}
                onClick={() => setTab(tb.id)}
              >
                {tb.label}
              </button>
            ))}
          </div>
          <span className="demo-note">SYNTHETIC</span>
          {list.loading ? (
            <div className="loading">Loading…</div>
          ) : list.error ? (
            <div className="empty">Could not load ({list.error}).</div>
          ) : rows.length === 0 ? (
            <div className="empty">No records.</div>
          ) : tab === 'classifications' ? (
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Level</th>
                  <th>Retention (days)</th>
                  <th>Scope</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={pick(r, 'id') || i}>
                    <td className="muted">{pick(r, 'classificationKey')}</td>
                    <td>{statusPill(pick(r, 'level'))}</td>
                    <td>{pick(r, 'retentionDays') || '—'}</td>
                    <td className="muted">{pick(r, 'scope')}</td>
                    <td>{statusPill(pick(r, 'state'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === 'records' ? (
            <table>
              <thead>
                <tr>
                  <th>Subject ref (opaque)</th>
                  <th>Action</th>
                  <th>Classification</th>
                  <th>Reason</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={pick(r, 'id') || i}>
                    <td className="muted">{pick(r, 'subjectRef')}</td>
                    <td>{pick(r, 'action')}</td>
                    <td className="muted">{pick(r, 'classification') || '—'}</td>
                    <td className="muted">{pick(r, 'reasonCode') || '—'}</td>
                    <td className="muted">{pick(r, 'createdAt').slice(0, 19).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === 'policies' ? (
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Classification</th>
                  <th>Action</th>
                  <th>Scope</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={pick(r, 'id') || i}>
                    <td className="muted">{pick(r, 'policyKey')}</td>
                    <td>{statusPill(pick(r, 'classification'))}</td>
                    <td>{pick(r, 'action')}</td>
                    <td className="muted">{pick(r, 'scope')}</td>
                    <td>{statusPill(pick(r, 'state'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === 'findings' ? (
            <table>
              <thead>
                <tr>
                  <th>Classification</th>
                  <th>Action</th>
                  <th className="num">Count</th>
                  <th>Reason</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={pick(r, 'id') || i}>
                    <td>{statusPill(pick(r, 'classification'))}</td>
                    <td>{pick(r, 'action')}</td>
                    <td className="num">{pick(r, 'findingCount')}</td>
                    <td className="muted">{pick(r, 'reasonCode') || '—'}</td>
                    <td className="muted">{pick(r, 'createdAt').slice(0, 19).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Severity</th>
                  <th>Category</th>
                  <th>State</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={pick(r, 'id') || i}>
                    <td className="muted">{pick(r, 'incidentKey')}</td>
                    <td>{sevPill(pick(r, 'severity'))}</td>
                    <td>{pick(r, 'category')}</td>
                    <td>{statusPill(pick(r, 'state'))}</td>
                    <td className="muted">{pick(r, 'createdAt').slice(0, 19).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
            Canonical m41 read model (permission-gated, tenant-scoped by FORCE RLS, no audit on reads). DLP
            findings and privacy records are append-only evidence — there is no update or delete.
          </p>
        </div>
      )}
    </>
  );
}

// ---------- administration: users & access (M02 identity/RBAC — no second identity engine) ----------
// Permission-aware UI: an action control is HIDDEN when the actor lacks the permission (fetched via
// GET /auth/permissions), but the server stays authoritative — a hidden action still 403s if called directly.
// There is NO hard delete: disposal is a governed transition (suspend / close / end / retire / revoke), and
// sensitive transitions demand an in-app confirm + reason (never a native dialog — it would block automation).

const statusPill = (s: string): JSX.Element => {
  const v = s.toLowerCase();
  const cls = /active|granted|published|compliant/.test(v)
    ? 'ok'
    : /suspend|reject|revok|closed|retired|ended|inactive|deactivat|non_compliant/.test(v)
      ? 'bad'
      : /draft|pending|review|partial/.test(v)
        ? 'warn'
        : 'info';
  return <span className={`pill ${cls}`}>{s || '—'}</span>;
};

/** Permission-aware, inline-confirm action control. Renders nothing when `allowed` is false. */
function ActionButton({
  label,
  allowed,
  danger,
  needsReason,
  onRun,
}: {
  label: string;
  allowed: boolean;
  danger?: boolean;
  needsReason?: boolean;
  onRun: (reason: string | undefined) => Promise<void>;
}): JSX.Element | null {
  const [armed, setArmed] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!allowed) return null;
  if (!armed)
    return (
      <button className={`btn ${danger ? 'danger' : 'secondary'} sm`} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  const go = async (): Promise<void> => {
    if (needsReason && reason.trim() === '') return;
    setBusy(true);
    await onRun(needsReason ? reason.trim() : undefined);
    setBusy(false);
    setArmed(false);
    setReason('');
  };
  return (
    <span className="confirm-inline">
      {needsReason && (
        <input
          className="confirm-reason"
          value={reason}
          placeholder="Reason (required)"
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <button className={`btn ${danger ? 'danger' : 'primary'} sm`} disabled={busy} onClick={go}>
        {busy ? '…' : `Confirm ${label}`}
      </button>
      <button className="btn link sm" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

function UserDrawer({
  identity,
  tenant,
  perms,
  onClose,
  onChanged,
}: {
  identity: api.Row;
  tenant: string | null;
  perms: Set<string>;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const id = pick(identity, 'id');
  // Hold a local, refetched copy so status + version stay live after each lifecycle action — a stale version
  // would 409 the NEXT action (optimistic concurrency). The list is refreshed separately via onChanged.
  const [ident, setIdent] = useState<api.Row>(identity);
  const version = Number(ident['version'] ?? 1);
  const status = pick(ident, 'status');
  const [accounts, setAccounts] = useState<api.Row[] | null>(null);
  const [memberships, setMemberships] = useState<api.Row[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [login, setLogin] = useState('');
  useEffect(() => {
    let live = true;
    setAccounts(null);
    setMemberships(null);
    void api.getIdentity(id, tenant).then((r) => live && r.ok && r.data && setIdent(r.data));
    void api.listLoginAccounts(id, tenant).then((r) => live && setAccounts(api.asRows(r.data)));
    void api.listMemberships(tenant).then((r) => {
      if (!live) return;
      setMemberships(api.asRows(r.data).filter((m) => pick(m, 'identityId') === id));
    });
    return () => {
      live = false;
    };
  }, [id, tenant, nonce]);
  const refresh = (): void => {
    setNonce((x) => x + 1);
    onChanged();
  };
  const report = (r: api.ApiResult<api.Row>, okMsg: string): void => {
    setMsg(r.ok ? { ok: true, msg: okMsg } : { ok: false, msg: r.error ?? 'Action failed.' });
    if (r.ok) refresh();
  };
  const lifecycle: { action: api.IdentityAction; label: string; perm: string; danger?: boolean }[] = [
    { action: 'activate', label: 'Activate', perm: 'identity.registry.activate' },
    { action: 'suspend', label: 'Suspend', perm: 'identity.registry.suspend', danger: true },
    { action: 'reactivate', label: 'Reactivate', perm: 'identity.registry.reactivate' },
    { action: 'close', label: 'Close', perm: 'identity.registry.close', danger: true },
  ];
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="User">
        <header className="drawer-head">
          <h3>{pick(ident, 'displayName') || 'User'}</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <dl className="kv">
            <dt>Type</dt>
            <dd>{pick(ident, 'identityType') || '—'}</dd>
            <dt>Email</dt>
            <dd>{pick(ident, 'primaryEmail') || '—'}</dd>
            <dt>Status</dt>
            <dd>{statusPill(status)}</dd>
          </dl>
          <div className="admin-actions">
            {lifecycle.map((l) => (
              <ActionButton
                key={l.action}
                label={l.label}
                allowed={can(l.perm)}
                danger={l.danger}
                needsReason={l.danger}
                onRun={(reason) =>
                  api
                    .identityAction(id, l.action, version, tenant, reason)
                    .then((r) => report(r, `Identity ${l.action} recorded (audited).`))
                }
              />
            ))}
          </div>
          {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}

          <h4 className="drawer-sub">Login accounts</h4>
          {accounts === null ? (
            <div className="loading">Loading…</div>
          ) : accounts.length === 0 ? (
            <div className="empty">No login accounts.</div>
          ) : (
            <ul className="timeline">
              {accounts.map((a, i) => (
                <li key={pick(a, 'id') || i}>
                  <span className="t-head">{pick(a, 'loginIdentifier')}</span> · {pick(a, 'accountType')}{' '}
                  {statusPill(pick(a, 'status'))}
                  <div className="admin-actions">
                    <ActionButton
                      label="Activate"
                      allowed={can('identity.account.activate')}
                      onRun={(reason) =>
                        api
                          .accountAction(pick(a, 'id'), 'activate', Number(a['version'] ?? 1), tenant, reason)
                          .then((r) => report(r, 'Account activated (audited).'))
                      }
                    />
                    <ActionButton
                      label="Suspend"
                      allowed={can('identity.account.suspend')}
                      danger
                      needsReason
                      onRun={(reason) =>
                        api
                          .accountAction(pick(a, 'id'), 'suspend', Number(a['version'] ?? 1), tenant, reason)
                          .then((r) => report(r, 'Account suspended (audited).'))
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {can('identity.account.create') && (
            <div className="inline-form">
              <input
                value={login}
                placeholder="login identifier (e.g. jane.doe)"
                onChange={(e) => setLogin(e.target.value)}
              />
              <button
                className="btn secondary sm"
                disabled={login.trim() === ''}
                onClick={() =>
                  void api
                    .createLoginAccount(
                      { identityId: id, accountType: 'human', loginIdentifier: login.trim() },
                      tenant,
                    )
                    .then((r) => {
                      report(r, 'Login account created (pending activation).');
                      if (r.ok) setLogin('');
                    })
                }
              >
                + Add login account
              </button>
            </div>
          )}

          <h4 className="drawer-sub">Tenant membership</h4>
          {memberships === null ? (
            <div className="loading">Loading…</div>
          ) : memberships.length === 0 ? (
            <>
              <div className="empty">Not a member of this tenant.</div>
              {can('identity.membership.create') && (
                <button
                  className="btn secondary sm"
                  onClick={() =>
                    void api
                      .createMembership({ identityId: id, membershipType: 'employee' }, tenant)
                      .then((r) => report(r, 'Membership created (pending). Activate it to grant access.'))
                  }
                >
                  + Add to this tenant
                </button>
              )}
            </>
          ) : (
            <ul className="timeline">
              {memberships.map((m, i) => (
                <li key={pick(m, 'id') || i}>
                  <span className="t-head">{pick(m, 'membershipType')}</span> {statusPill(pick(m, 'status'))}
                  <div className="admin-actions">
                    <ActionButton
                      label="Activate"
                      allowed={can('identity.membership.activate')}
                      onRun={(reason) =>
                        api
                          .membershipAction(
                            pick(m, 'id'),
                            'activate',
                            Number(m['version'] ?? 1),
                            tenant,
                            reason,
                          )
                          .then((r) => report(r, 'Membership activated (audited).'))
                      }
                    />
                    <ActionButton
                      label="End"
                      allowed={can('identity.membership.end')}
                      danger
                      needsReason
                      onRun={(reason) =>
                        api
                          .membershipAction(pick(m, 'id'), 'end', Number(m['version'] ?? 1), tenant, reason)
                          .then((r) => report(r, 'Membership ended (audited).'))
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            Canonical m02 identity/RBAC · tenant-scoped + audited server-side. No credential is ever shown. No
            hard delete — disposal is a governed transition.
          </p>
        </div>
      </aside>
    </div>
  );
}

function UsersAdmin({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [rows, setRows] = useState<api.Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<api.Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ displayName: '', primaryEmail: '' });
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    setErr(null);
    void api.listIdentities(tenant).then((r) => {
      if (!live) return;
      if (r.ok) setRows(api.asRows(r.data));
      else setErr(r.error);
    });
    return () => {
      live = false;
    };
  }, [tenant, nonce]);
  const create = async (): Promise<void> => {
    setMsg(null);
    const r = await api.createIdentity(
      {
        identityType: 'internal_person',
        displayName: form.displayName.trim(),
        ...(form.primaryEmail.trim() ? { primaryEmail: form.primaryEmail.trim() } : {}),
      },
      tenant,
    );
    if (r.ok) {
      setMsg({ ok: true, msg: 'Identity created (draft). Add a login + tenant membership to grant access.' });
      setForm({ displayName: '', primaryEmail: '' });
      setCreating(false);
      setNonce((x) => x + 1);
    } else setMsg({ ok: false, msg: r.error ?? 'Could not create identity.' });
  };
  return (
    <>
      <h1 className="page-title">Users &amp; Access</h1>
      <p className="page-sub">
        People, their login accounts and tenant membership over the canonical m02 identity registry ·
        synthetic staging data. RBAC + tenant isolation enforced server-side; actions you cannot perform are
        hidden.
      </p>
      <div className="card">
        <header>
          <h3>Identities</h3>
          {can('identity.registry.create') && (
            <button className="btn primary sm" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : '+ Add user'}
            </button>
          )}
        </header>
        {creating && (
          <div className="inline-form">
            <input
              value={form.displayName}
              placeholder="Display name"
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
            <input
              value={form.primaryEmail}
              placeholder="Email (optional)"
              onChange={(e) => setForm({ ...form, primaryEmail: e.target.value })}
            />
            <button className="btn primary sm" disabled={form.displayName.trim() === ''} onClick={create}>
              Create
            </button>
          </div>
        )}
        {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
        {rows === null ? (
          <div className="loading">Loading identities…</div>
        ) : err ? (
          <div className="empty">Could not load identities ({err}).</div>
        ) : rows.length === 0 ? (
          <div className="empty">No identities visible.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Email</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={pick(u, 'id') || i}>
                  <td>{pick(u, 'displayName') || '—'}</td>
                  <td className="muted">{pick(u, 'identityType') || '—'}</td>
                  <td className="muted">{pick(u, 'primaryEmail') || '—'}</td>
                  <td>{statusPill(pick(u, 'status'))}</td>
                  <td>
                    <button className="btn link" onClick={() => setOpen(u)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && (
        <UserDrawer
          identity={open}
          tenant={tenant}
          perms={perms}
          onClose={() => setOpen(null)}
          onChanged={() => setNonce((x) => x + 1)}
        />
      )}
    </>
  );
}

function RoleDrawer({
  role,
  tenant,
  perms,
  catalogue,
  onClose,
  onChanged,
}: {
  role: api.Row;
  tenant: string | null;
  perms: Set<string>;
  catalogue: api.Row[];
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const id = pick(role, 'id');
  // Local, refetched copy so status + version stay live after each action (a stale version 409s the next one).
  const [roleState, setRoleState] = useState<api.Row>(role);
  const version = Number(roleState['version'] ?? 1);
  const immutable = roleState['isImmutable'] === true;
  const [held, setHeld] = useState<string[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [add, setAdd] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    let live = true;
    setHeld(null);
    void api.getRole(id, tenant).then((r) => live && r.ok && r.data && setRoleState(r.data));
    void api.getRolePermissions(id, tenant).then((r) => {
      if (live) setHeld(r.ok && r.data ? r.data.permissions : []);
    });
    return () => {
      live = false;
    };
  }, [id, tenant, nonce]);
  const refresh = (): void => {
    setNonce((x) => x + 1);
    onChanged();
  };
  const grantable = catalogue
    .filter((p) => p['tenantAssignable'] !== false && !(held ?? []).includes(pick(p, 'code')))
    .map((p) => pick(p, 'code'))
    .filter(Boolean);
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Role">
        <header className="drawer-head">
          <h3>{pick(roleState, 'name') || pick(roleState, 'code') || 'Role'}</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">
          <dl className="kv">
            <dt>Code</dt>
            <dd>{pick(roleState, 'code') || '—'}</dd>
            <dt>Kind</dt>
            <dd>{pick(roleState, 'kind') || '—'}</dd>
            <dt>Status</dt>
            <dd>{statusPill(pick(roleState, 'status'))}</dd>
          </dl>
          {immutable && (
            <p className="muted" style={{ fontSize: 12 }}>
              System role — immutable. Permissions and lifecycle cannot be changed.
            </p>
          )}
          {!immutable && (
            <div className="admin-actions">
              <ActionButton
                label="Activate"
                allowed={can('rbac.role.activate')}
                onRun={(r) =>
                  api
                    .roleAction(id, 'activate', version, tenant, r)
                    .then((res) => setMsgAnd(setMsg, res, 'Role activated (audited).', refresh))
                }
              />
              <ActionButton
                label="Suspend"
                allowed={can('rbac.role.suspend')}
                danger
                needsReason
                onRun={(r) =>
                  api
                    .roleAction(id, 'suspend', version, tenant, r)
                    .then((res) => setMsgAnd(setMsg, res, 'Role suspended (audited).', refresh))
                }
              />
              <ActionButton
                label="Retire"
                allowed={can('rbac.role.retire')}
                danger
                needsReason
                onRun={(r) =>
                  api
                    .roleAction(id, 'retire', version, tenant, r)
                    .then((res) => setMsgAnd(setMsg, res, 'Role retired (audited).', refresh))
                }
              />
            </div>
          )}
          {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}

          <h4 className="drawer-sub">Permissions</h4>
          {held === null ? (
            <div className="loading">Loading…</div>
          ) : held.length === 0 ? (
            <div className="empty">No permissions granted.</div>
          ) : (
            <ul className="perm-list">
              {held.map((p) => (
                <li key={p}>
                  <code>{p}</code>
                  {!immutable && can('rbac.role.edit') && (
                    <ActionButton
                      label="Remove"
                      allowed
                      danger
                      onRun={() =>
                        api
                          .changeRolePermissions(id, { remove: [p] }, tenant)
                          .then((res) => setMsgAnd(setMsg, res, 'Permission removed (audited).', refresh))
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {!immutable && can('rbac.role.edit') && (
            <div className="inline-form">
              <select value={add} onChange={(e) => setAdd(e.target.value)}>
                <option value="">Grant a permission…</option>
                {grantable.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                className="btn secondary sm"
                disabled={add === ''}
                onClick={() =>
                  void api.changeRolePermissions(id, { add: [add] }, tenant).then((res) => {
                    setMsgAnd(setMsg, res, 'Permission granted (audited).', refresh);
                    if (res.ok) setAdd('');
                  })
                }
              >
                + Grant
              </button>
            </div>
          )}
          <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            A grantor can only confer permissions it itself holds (anti-escalation, server-enforced).
          </p>
        </div>
      </aside>
    </div>
  );
}

function setMsgAnd(
  setMsg: (m: { ok: boolean; msg: string }) => void,
  res: api.ApiResult<api.Row>,
  okMsg: string,
  refresh: () => void,
): void {
  setMsg(res.ok ? { ok: true, msg: okMsg } : { ok: false, msg: res.error ?? 'Action failed.' });
  if (res.ok) refresh();
}

function RolesAdmin({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [rows, setRows] = useState<api.Row[] | null>(null);
  const [catalogue, setCatalogue] = useState<api.Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<api.Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', description: '' });
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    setErr(null);
    void api.listRoles(tenant).then((r) => {
      if (!live) return;
      if (r.ok) setRows(api.asRows(r.data));
      else setErr(r.error);
    });
    void api.getPermissionCatalogue(tenant).then((r) => live && setCatalogue(api.asRows(r.data)));
    return () => {
      live = false;
    };
  }, [tenant, nonce]);
  const create = async (): Promise<void> => {
    setMsg(null);
    const r = await api.createRole(
      {
        code: form.code.trim(),
        name: form.name.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      },
      tenant,
    );
    if (r.ok) {
      setMsg({ ok: true, msg: 'Role created (draft). Grant permissions, then activate it.' });
      setForm({ code: '', name: '', description: '' });
      setCreating(false);
      setNonce((x) => x + 1);
    } else setMsg({ ok: false, msg: r.error ?? 'Could not create role.' });
  };
  return (
    <>
      <h1 className="page-title">Roles &amp; Permissions</h1>
      <p className="page-sub">
        Tenant custom roles over the canonical m02 RBAC engine · synthetic staging data. System roles are
        visible and immutable. A grantor can only confer permissions it itself holds.
      </p>
      <div className="card">
        <header>
          <h3>Roles</h3>
          {can('rbac.role.create') && (
            <button className="btn primary sm" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : '+ Add role'}
            </button>
          )}
        </header>
        {creating && (
          <div className="inline-form">
            <input
              value={form.code}
              placeholder="code (e.g. treasury_officer)"
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
            <input
              value={form.name}
              placeholder="Name"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <button
              className="btn primary sm"
              disabled={form.code.trim() === '' || form.name.trim() === ''}
              onClick={create}
            >
              Create
            </button>
          </div>
        )}
        {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
        {rows === null ? (
          <div className="loading">Loading roles…</div>
        ) : err ? (
          <div className="empty">Could not load roles ({err}).</div>
        ) : rows.length === 0 ? (
          <div className="empty">No roles visible.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Code</th>
                <th>Kind</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={pick(r, 'id') || i}>
                  <td>{pick(r, 'name') || '—'}</td>
                  <td className="muted">{pick(r, 'code') || '—'}</td>
                  <td className="muted">{pick(r, 'kind') || '—'}</td>
                  <td>{statusPill(pick(r, 'status'))}</td>
                  <td>
                    <button className="btn link" onClick={() => setOpen(r)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && (
        <RoleDrawer
          role={open}
          tenant={tenant}
          perms={perms}
          catalogue={catalogue}
          onClose={() => setOpen(null)}
          onChanged={() => setNonce((x) => x + 1)}
        />
      )}
    </>
  );
}

function AccessAdmin({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const [assignments, setAssignments] = useState<api.Row[] | null>(null);
  const [memberships, setMemberships] = useState<api.Row[]>([]);
  const [roles, setRoles] = useState<api.Row[]>([]);
  const [identities, setIdentities] = useState<Record<string, string>>({});
  const [nonce, setNonce] = useState(0);
  const [sel, setSel] = useState({ membershipId: '', roleId: '' });
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    let live = true;
    setAssignments(null);
    void api.listAssignments(tenant).then((r) => live && setAssignments(api.asRows(r.data)));
    void api.listMemberships(tenant).then((r) => live && setMemberships(api.asRows(r.data)));
    void api.listRoles(tenant).then((r) => live && setRoles(api.asRows(r.data)));
    void api.listIdentities(tenant).then((r) => {
      if (!live) return;
      const map: Record<string, string> = {};
      api.asRows(r.data).forEach((u) => (map[pick(u, 'id')] = pick(u, 'displayName')));
      setIdentities(map);
    });
    return () => {
      live = false;
    };
  }, [tenant, nonce]);
  const refresh = (): void => setNonce((x) => x + 1);
  const grant = async (): Promise<void> => {
    setMsg(null);
    const r = await api.grantAssignment({ membershipId: sel.membershipId, roleId: sel.roleId }, tenant);
    setMsgAnd(setMsg, r, 'Role assigned (SoD-checked, audited).', refresh);
    if (r.ok) setSel({ membershipId: '', roleId: '' });
  };
  const roleName = (rid: string): string =>
    pick(roles.find((r) => pick(r, 'id') === rid) ?? {}, 'name') || rid;
  const memberName = (mid: string): string => {
    const m = memberships.find((x) => pick(x, 'id') === mid);
    return m ? identities[pick(m, 'identityId')] || pick(m, 'identityId') : mid;
  };
  return (
    <>
      <h1 className="page-title">Access Assignments</h1>
      <p className="page-sub">
        Role grants to tenant memberships over the canonical m02 RBAC engine · synthetic staging data.
        Separation-of-duties and grantor-bounded escalation are enforced server-side.
      </p>
      {can('rbac.assignment.grant') && (
        <div className="card">
          <header>
            <h3>Grant a role</h3>
          </header>
          <div className="inline-form">
            <select
              value={sel.membershipId}
              onChange={(e) => setSel({ ...sel, membershipId: e.target.value })}
            >
              <option value="">Member…</option>
              {memberships.map((m) => (
                <option key={pick(m, 'id')} value={pick(m, 'id')}>
                  {identities[pick(m, 'identityId')] || pick(m, 'identityId')} · {pick(m, 'membershipType')}
                </option>
              ))}
            </select>
            <select value={sel.roleId} onChange={(e) => setSel({ ...sel, roleId: e.target.value })}>
              <option value="">Role…</option>
              {roles.map((r) => (
                <option key={pick(r, 'id')} value={pick(r, 'id')}>
                  {pick(r, 'name') || pick(r, 'code')}
                </option>
              ))}
            </select>
            <button
              className="btn primary sm"
              disabled={sel.membershipId === '' || sel.roleId === ''}
              onClick={grant}
            >
              + Grant role
            </button>
          </div>
          {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
        </div>
      )}
      <div className="card">
        <header>
          <h3>Assignments</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        {assignments === null ? (
          <div className="loading">Loading assignments…</div>
        ) : assignments.length === 0 ? (
          <div className="empty">No role assignments in this tenant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a, i) => (
                <tr key={pick(a, 'id') || i}>
                  <td>{memberName(pick(a, 'membershipId'))}</td>
                  <td>{roleName(pick(a, 'roleId'))}</td>
                  <td>{statusPill(pick(a, 'status'))}</td>
                  <td>
                    <ActionButton
                      label="Revoke"
                      allowed={can('rbac.assignment.revoke')}
                      danger
                      needsReason
                      onRun={(reason) =>
                        api
                          .assignmentAction(
                            pick(a, 'id'),
                            'revoke',
                            Number(a['version'] ?? 1),
                            tenant,
                            reason,
                          )
                          .then((r) => setMsgAnd(setMsg, r, 'Assignment revoked (audited).', refresh))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ---------- approvals (M22 maker-checker inbox) ----------
// A reusable approvals area over the canonical m22 request+decision engine. The maker-checker + SoD choke point
// lives server-side: an approving actor is never the maker (403 makerIsChecker), the deciding actor is the
// session identity. Decision buttons are permission-aware; the server stays authoritative.
const SUBJECT_LABEL: Record<string, string> = {
  journal_adjustment: 'Treasury · journal adjustment',
  journal_posting: 'Treasury · journal posting',
  recovery_writeoff: 'Recovery · write-off',
  recovery_arrangement: 'Recovery · arrangement',
};
const subjectLabel = (s: string): string => SUBJECT_LABEL[s] || s || '—';

function ApprovalDrawer({
  requestId,
  tenant,
  perms,
  onClose,
  onChanged,
}: {
  requestId: string;
  tenant: string | null;
  perms: Set<string>;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const can = (p: string): boolean => perms.has(p);
  const canDecide = can('approvals.decision.approve');
  const [req, setReq] = useState<api.Row | null>(null);
  const [decisions, setDecisions] = useState<api.Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([
      api.getApprovalRequest(requestId, tenant),
      api.getApprovalDecisions(requestId, tenant),
    ]).then(([r, d]) => {
      if (!live) return;
      setReq(r.ok && r.data ? r.data.request : null);
      setDecisions(d.ok && d.data ? d.data.decisions : []);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [requestId, tenant, nonce]);
  const r = req ?? {};
  const status = pick(r, 'status').toLowerCase();
  const version = Number(r['version'] ?? 1);
  const decidable = status === 'pending' || status === 'escalated';
  const report = (res: api.ApiResult<api.Row>, okMsg: string): void => {
    setMsg(res.ok ? { ok: true, msg: okMsg } : { ok: false, msg: res.error ?? 'Action failed.' });
    if (res.ok) {
      setNonce((x) => x + 1);
      onChanged();
    }
  };
  const decide = (d: api.ApprovalDecision, okMsg: string) => (reason: string | undefined) =>
    api.decideApproval(requestId, version, d, tenant, reason).then((res) => report(res, okMsg));
  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Approval request"
      >
        <header className="drawer-head">
          <h3>{pick(r, 'title') || 'Approval request'}</h3>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>
        {loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <div className="drawer-body">
            <div className="drawer-status">{statusPill(pick(r, 'status'))}</div>
            <dl className="kv">
              <dt>Source</dt>
              <dd>{subjectLabel(pick(r, 'subjectType'))}</dd>
              <dt>Subject ref</dt>
              <dd className="muted">{pick(r, 'subjectRef') || '—'}</dd>
              <dt>Amount</dt>
              <dd>{r['amountMinor'] != null ? fmtMinor(r['amountMinor']) : '—'}</dd>
              <dt>Requested by</dt>
              <dd className="muted">{pick(r, 'requestedBy', 'preparedBy') || '—'}</dd>
              <dt>Approvals</dt>
              <dd>
                {pick(r, 'approvalsCount') || 0} / {pick(r, 'requiredApprovals') || 1}
              </dd>
            </dl>
            <div className="admin-actions">
              <ActionButton
                label="Approve"
                allowed={decidable && canDecide}
                onRun={decide('approve', 'Approved (SoD-checked, audited).')}
              />
              <ActionButton
                label="Reject"
                allowed={decidable && canDecide && can('approvals.decision.reject')}
                danger
                needsReason
                onRun={decide('reject', 'Rejected (audited).')}
              />
              <ActionButton
                label="Return"
                allowed={decidable && canDecide && can('approvals.decision.return')}
                needsReason
                onRun={decide('return', 'Returned to maker (audited).')}
              />
              <ActionButton
                label="Escalate"
                allowed={decidable && canDecide && can('approvals.decision.escalate')}
                needsReason
                onRun={decide('escalate', 'Escalated (audited).')}
              />
            </div>
            {msg && <div className={msg.ok ? 'ok-note' : 'error'}>{msg.msg}</div>}
            {decidable && !canDecide && (
              <p className="muted" style={{ fontSize: 11 }}>
                You do not hold an approval-decision permission for this request. A distinct checker must
                decide it — and the maker can never approve their own (Segregation of Duties,
                server-enforced).
              </p>
            )}
            <h4 className="drawer-sub">Decision history</h4>
            {decisions.length === 0 ? (
              <div className="empty">No decisions recorded yet.</div>
            ) : (
              <ul className="timeline">
                {decisions.map((d, i) => (
                  <li key={pick(d, 'id') || i}>
                    {statusPill(pick(d, 'decision'))}{' '}
                    <span className="t-head">{pick(d, 'actor', 'decidedBy') || ''}</span>{' '}
                    <span className="muted">{pick(d, 'reason', 'reasonCode') || ''}</span>
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

function ApprovalsInbox({ tenant, perms }: { tenant: string | null; perms: Set<string> }): JSX.Element {
  const [status, setStatus] = useState('pending');
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const requests = useRows(
    () => api.listApprovalRequests(tenant, status === 'all' ? undefined : status),
    [tenant, status, nonce],
  );
  return (
    <>
      <h1 className="page-title">Approvals</h1>
      <p className="page-sub">
        Maker-checker requests over the canonical m22 engine · synthetic staging data. An approving actor is
        never the maker (Segregation of Duties, server-enforced); the deciding actor is your session identity.
      </p>
      <div className="card">
        <header>
          <h3>Approval requests</h3>
          <span className="demo-note">SYNTHETIC</span>
        </header>
        <div className="run-picker">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="escalated">Escalated</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="returned">Returned</option>
            <option value="all">All</option>
          </select>
        </div>
        {requests.loading ? (
          <div className="loading">Loading approvals…</div>
        ) : requests.error ? (
          <div className="empty">Could not load approvals ({requests.error}).</div>
        ) : requests.rows.length === 0 ? (
          <div className="empty">No approval requests in this status.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>Requested by</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.rows.map((rq, i) => {
                const id = pick(rq, 'id');
                return (
                  <tr key={id || i}>
                    <td>{pick(rq, 'title') || '—'}</td>
                    <td className="muted">{subjectLabel(pick(rq, 'subjectType'))}</td>
                    <td className="muted">{pick(rq, 'requestedBy', 'preparedBy') || '—'}</td>
                    <td className="num">{rq['amountMinor'] != null ? fmtMinor(rq['amountMinor']) : '—'}</td>
                    <td>{statusPill(pick(rq, 'status'))}</td>
                    <td>
                      <button className="btn link" onClick={() => setOpen(id)} disabled={id === ''}>
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {open && (
        <ApprovalDrawer
          requestId={open}
          tenant={tenant}
          perms={perms}
          onClose={() => setOpen(null)}
          onChanged={() => setNonce((x) => x + 1)}
        />
      )}
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
  { id: 'finance-calendar', label: 'Fiscal calendar', icon: '📅', group: 'Finance' },
  { id: 'finance-journals', label: 'Journals', icon: '📒', group: 'Finance' },
  { id: 'compliance', label: 'Compliance', icon: '❖', group: 'Compliance' },
  { id: 'compliance-register', label: 'Control register', icon: '▤', group: 'Compliance' },
  { id: 'compliance-privacy', label: 'Privacy & security', icon: '🔒', group: 'Compliance' },
  { id: 'feedback', label: 'Feedback Management', icon: '💬', group: 'Customer Service' },
  { id: 'legal-cases', label: 'Cases', icon: '⚖', group: 'Legal' },
  { id: 'legal-matters', label: 'Matters', icon: '§', group: 'Legal' },
  { id: 'approvals', label: 'Approvals', icon: '✔', group: 'Approvals' },
  { id: 'admin-users', label: 'Users & Access', icon: '👥', group: 'Administration' },
  { id: 'admin-roles', label: 'Roles & Permissions', icon: '🛡', group: 'Administration' },
  { id: 'admin-assignments', label: 'Access Assignments', icon: '🔑', group: 'Administration' },
  { id: 'admin-billing', label: 'Plans & Subscriptions', icon: '🧾', group: 'Administration' },
];

// The Administration group is NOT entitlement-gated (it is a platform capability, not a commercial vertical):
// it is governed by M02 RBAC. A member sees it only if they hold at least one relevant read permission.
const ADMIN_READ_PERMS = [
  'identity.registry.view',
  'identity.membership.view',
  'rbac.role.view',
  'rbac.assignment.view',
  'saas.plan.read',
  'saas.subscription.read',
];

// Finance (m19 fiscal calendar) is a platform finance-CONTROL capability, not a commercial vertical, so — like
// Administration — it is RBAC-gated (visible to anyone who may read the calendar), not entitlement-gated.
const FINANCE_READ_PERMS = [
  'finance.period.read',
  'finance.fiscal_year.read',
  'finance.entity.read',
  'journals.draft.read',
];

// Legal (m13 case management, + m14/m16/m18 later) is a platform operational capability. It is RBAC-gated on
// case-read for now (visible to anyone who may read cases) rather than entitlement-gated: a `legal_services`
// entitlement would need to be seeded per tenant first, and gating on an unseeded capability would hide the
// group for everyone (fail closed). Switch to entitlement-gating once `legal_services` is seeded (see the
// web-completeness doc).
const LEGAL_READ_PERMS = ['cases.case.read', 'legal.matter.read'];

// Customer Service (m12 feedback management) is a daily operational workspace — RBAC-gated on feedback read.
const CS_READ_PERMS = ['feedback.record.read', 'feedback.queue.read'];

// 6F entitlement gating (ADR-135): each Stage-8 vertical GROUP is available only if the selected tenant is
// entitled to its capability. The "Overview" group is always available. Entitlement decides AVAILABILITY;
// M02 RBAC still governs actions inside an available vertical (an entitled tenant's under-permissioned actor
// still gets 403). The check is server-authoritative (GET /saas/entitlements/check).
const GROUP_ENTITLEMENT: Record<string, string> = {
  Treasury: 'treasury_reconciliation',
  Recovery: 'debt_recovery',
  Compliance: 'regulatory_compliance',
};
const routeGroup = (routeId: string): string => NAV.find((n) => n.id === routeId)?.group ?? 'Overview';

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
  // Entitlements for the current tenant (capabilityKey -> entitled). null = still resolving.
  const [entitled, setEntitled] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let live = true;
    setEntitled(null);
    if (!tenant) return;
    const caps = Array.from(new Set(Object.values(GROUP_ENTITLEMENT)));
    void Promise.all(caps.map((c) => api.getEntitlement(c, tenant))).then((rs) => {
      if (!live) return;
      const map: Record<string, boolean> = {};
      rs.forEach((r, i) => {
        map[caps[i]] = r.ok && r.data ? r.data.entitled === true : false;
      });
      setEntitled(map);
    });
    return () => {
      live = false;
    };
  }, [tenant]);
  // Effective permissions of the caller in the selected tenant (server-authoritative). Drives permission-aware
  // Administration nav + action visibility; the server still 403s a hidden action if invoked directly.
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [actorId, setActorId] = useState('');
  useEffect(() => {
    let live = true;
    setPerms(new Set());
    if (!tenant) return;
    void api.getMyPermissions(tenant).then((r) => {
      if (!live) return;
      setPerms(new Set(r.ok && r.data ? r.data.permissions : []));
      setActorId(r.ok && r.data ? r.data.actorId : '');
    });
    return () => {
      live = false;
    };
  }, [tenant]);
  const groupAvailable = (g: string): boolean => {
    if (g === 'Administration') return ADMIN_READ_PERMS.some((p) => perms.has(p));
    // Approvals is RBAC-gated (a platform capability, not a commercial vertical): visible to anyone who may
    // read approval requests (makers to track their own, checkers to decide). Not entitlement-gated.
    if (g === 'Approvals') return perms.has('approvals.request.read');
    if (g === 'Finance') return FINANCE_READ_PERMS.some((p) => perms.has(p));
    if (g === 'Legal') return LEGAL_READ_PERMS.some((p) => perms.has(p));
    if (g === 'Customer Service') return CS_READ_PERMS.some((p) => perms.has(p));
    const cap = GROUP_ENTITLEMENT[g];
    if (!cap) return true; // Overview always
    return entitled?.[cap] === true;
  };
  // Fail closed: if the active route belongs to a group the caller may not access (unentitled vertical OR an
  // Administration area they lack the RBAC read for), drop to Dashboard. Recomputes on tenant/permission change.
  useEffect(() => {
    if (!groupAvailable(routeGroup(route)) && route !== 'dashboard') setRoute('dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitled, perms, route]);
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
        {Object.entries(grouped)
          .filter(([g]) => groupAvailable(g))
          .map(([g, items]) => (
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
        {route === 'reconciliation' && <Reconciliation tenant={tenant} perms={perms} />}
        {route === 'accounts' && (
          <>
            <h1 className="page-title">Bank accounts</h1>
            <p className="page-sub">Accounts under reconciliation · synthetic staging data</p>
            <AccountsCard tenant={tenant} />
          </>
        )}
        {route === 'exceptions' && <Exceptions tenant={tenant} perms={perms} />}
        {route === 'reports' && <Reports tenant={tenant} />}
        {route === 'recovery' && <RecoveryDashboard tenant={tenant} />}
        {route === 'recovery-cases' && <RecoveryCases tenant={tenant} perms={perms} actorId={actorId} />}
        {route === 'finance-calendar' && <FiscalCalendar tenant={tenant} perms={perms} />}
        {route === 'finance-journals' && (
          <JournalsWorkspace tenant={tenant} perms={perms} actorId={actorId} />
        )}
        {route === 'compliance' && <ComplianceDashboard tenant={tenant} />}
        {route === 'compliance-register' && <ComplianceRegister tenant={tenant} perms={perms} />}
        {route === 'compliance-privacy' && <PrivacySecurityWorkspace tenant={tenant} perms={perms} />}
        {route === 'feedback' && <FeedbackWorkspace tenant={tenant} perms={perms} actorId={actorId} />}
        {route === 'legal-cases' && <CasesWorkspace tenant={tenant} perms={perms} actorId={actorId} />}
        {route === 'legal-matters' && <MattersWorkspace tenant={tenant} perms={perms} actorId={actorId} />}
        {route === 'approvals' && <ApprovalsInbox tenant={tenant} perms={perms} />}
        {route === 'admin-users' && <UsersAdmin tenant={tenant} perms={perms} />}
        {route === 'admin-roles' && <RolesAdmin tenant={tenant} perms={perms} />}
        {route === 'admin-assignments' && <AccessAdmin tenant={tenant} perms={perms} />}
        {route === 'admin-billing' && <PlansSubscriptionsAdmin tenant={tenant} perms={perms} />}
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
