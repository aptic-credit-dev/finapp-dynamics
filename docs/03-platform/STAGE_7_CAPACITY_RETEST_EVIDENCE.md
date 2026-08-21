# Stage 7 — Capacity Retest Evidence (authenticated write-burst; DATABASE_POOL_MAX matrix + root cause)

> Tier-1 remediation **retest** under **ADR-131**, executed on the Contabo staging host (`vmi3515072`, 12 vCPU /
> 48 GB, postgres:16.15) against **merged main** (`00909cb`; PR #127). It tests the `DATABASE_POOL_MAX` lever added
> by PR #127 and **instruments the database** to find the real bottleneck behind the 32-concurrency write-burst
> latency signal. **Headline: the connection-pool hypothesis is NOT confirmed.** The dominant bottleneck is
> **serialization on the m03-audit tamper-evident hash-chain advisory lock**, a correctness control that is **not**
> weakened here. All data below is **real and measured**; nothing is fabricated. No RBAC/CSRF/audit/outbox/RLS/
> maker-checker control was weakened for performance. This is **not** Tier-2 acceptance and issues **no** GO;
> `load_and_chaos_at_scale` stays `requires_review`.

---

## 1. What was executed (real environment)

- Host: Contabo staging `169.58.194.151` (`vmi3515072`), **12 vCPU / 48 GB (46 GB free)**, Docker Compose v5.5.0.
- Deployed **merged main** (`00909cb`) via `git archive | tar -x` over the existing deploy, then
  `docker compose build api` (multi-stage; `npm ci` + `npm run build`), `down -v` (fresh synthetic DB), `up -d`
  (**82 migrations applied, 0 pending**), `bootstrap-synthetic.mjs` (2 tenants + 2 identities), `seed-login.mjs`
  (Argon2id login creds; password from an env var held in a **root-only file, never printed/committed, shredded
  after**).
- Load: `deploy/staging/auth-load-harness.mjs` `AUTHLOAD_ONLY=auth_write_burst` at **32 concurrency**, authenticated
  (cookie session + CSRF), each write = `POST /api/v1/identities` → **row + audit event + transactional-outbox
  entry** through auth → RBAC → CSRF → audit → outbox → RLS. Burst durations 2 s / 6 s / 8 s across trials.
- Instrumentation: `pg_stat_activity` (state / wait_event_type), `pg_locks` (ungranted) joined to the blocking
  query, `docker stats` (container CPU), plus PG durability settings.
- **Synthetic, loopback-only, reversible.** After the matrix, the pool was restored to the default (unset →
  node-postgres 10) and the stack left healthy on merged main.

## 2. The pool matrix (32-concurrency write burst; all trials **0 errors**)

| Pool `max` (M) | burst len | p50 ms | p95 ms | p99 ms | rps | errors |
| --- | --- | --- | --- | --- | --- | --- |
| **10 (baseline — PR #126 original)** | 2 s | 397.4 | **508.0** | 529.7 | 73.7 | 0 |
| 10 | 8 s | 628.8 | 1057.4 | 1119.6 | 48.9 | 0 |
| 10 | 2 s (rep 1) | 430.6 | 918.7 | 1070.1 | 59.1 | 0 |
| 10 | 2 s (rep 2) | 525.3 | 860.9 | 928.8 | 52.0 | 0 |
| 10 | 6 s (probe) | — | **603.5** | — | 82.2 | 0 |
| 16 | 8 s | 479.5 | 814.6 | 929.1 | 62.3 | 0 |
| 16 | 2 s (rep 1) | 458.8 | 1264.3 | 1323.7 | 49.0 | 0 |
| 16 | 2 s (rep 2) | 485.2 | 1156.9 | 1241.8 | 49.2 | 0 |
| 20 | 8 s | 557.8 | 1439.7 | 1631.1 | 47.9 | 0 |
| 20 | 2 s (rep 1) | 880.5 | 1160.0 | 1257.1 | 34.4 | 0 |
| 20 | 2 s (rep 2) | 468.6 | 1284.8 | 1323.8 | 47.4 | 0 |
| 24 | 8 s | 501.1 | 717.2 | 869.9 | 58.0 | 0 |
| 24 | 2 s (rep 1) | 535.5 | 916.4 | 1060.8 | 49.8 | 0 |
| 24 | 2 s (rep 2) | 556.3 | 858.3 | 919.1 | 50.2 | 0 |
| 24 | 6 s (probe) | — | **2113.0** | — | 32.8 | 0 |

**Two facts jump out and both refute the pool hypothesis:**

1. **No monotonic pool dependence.** Larger pools did not reliably lower latency; M=20 was often the *worst*, and in
   the 6 s probe M=10 (p95 **604 ms**, 82 rps) *beat* M=24 (p95 **2113 ms**, 33 rps). If pool-acquisition queueing
   were dominant, latency would fall as M rose toward 32. It did not.
2. **Run-to-run variance dwarfs the pool effect.** At a **fixed** config (M=10, 32-conc), p95 ranged **508 → 1057 →
   861 → 919 → 604 ms** across sessions. That spread (≈4×) is far larger than any difference between pool sizes,
   which means the pool size is **not** the controlling variable at this measurement fidelity.

## 3. Root cause (DB-instrumented — this is the real bottleneck)

During a 32-concurrency burst, `pg_stat_activity` for the app connections showed the writers **blocked on a
transaction-level advisory lock**, not queued on the pool and not CPU-bound:

```
state  | wait_event_type | count
active | Lock            |   8      <-- 8 of ~10 active conns waiting on a heavyweight lock
active | (running)       |   1
active | IO              |   1      <-- 1 in WAL/commit I/O
idle   | Client          |   1
```

`pg_locks` (ungranted) joined to the blocking query pinpointed it exactly:

```
wait_event_type | locktype | relation   | mode          | waiters
Lock            | advisory | (non-rel)  | ExclusiveLock |   6
-- blockers were executing:  SELECT pg_advisory_xact_lock(hashtext($1)::bigint)   (x7)
```

That statement is **`packages/m03-audit/src/repository.ts:112`**, in `nextChainLink()`:

```ts
await tx.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [scopeKey]);
// then reads the last (seq, event_hash) for scopeKey and appends the next tamper-evident link
```

**Every audited write** (and per CLAUDE.md every mutating route is audited) takes this per-`scope_key` advisory
lock so the **audit hash-chain** stays strictly ordered and tamper-evident (each event links to the prior
`event_hash`). Under 32 concurrent writers sharing an audit scope, they **serialize** on this lock — ~6–8 blocked
at any instant. This is the queue; the connection pool is not.

**Why enlarging the pool doesn't help (and trends worse):** more pool slots simply admit more writers to contend
the **same** advisory lock. That is consistent with M=24 sometimes being worse than M=10 — more concurrent lock
waiters, more context-switching, no more forward progress through the serialized critical section.

**Supporting measurements:**
- **CPU is not the limit at the container level:** during bursts, api ≈ 1.1–1.4 cores and db ≈ 1.2–1.5 cores of
  **12** available. (Large cross-session variance also implicates shared-VPS CPU steal, invisible to `docker stats`
  — see §5.)
- **DB durability is stock/untuned:** `synchronous_commit=on`, `fsync=on`, `wal_level=replica`,
  **`shared_buffers=128 MB`** (postgres default), `max_wal_size=1 GB`. The audit link's critical section includes a
  WAL-durable commit, so per-lock hold time is partly fsync-bound.
- **Errors stayed 0 across every trial and pool size** — nothing failed; writes serialized and slowed.

## 4. What this means for remediation (honest, control-preserving)

- **The `DATABASE_POOL_MAX` lever is NOT the remediation for this burst breach.** It remains a legitimate, safe,
  reversible operational knob (e.g. to bound connections against `max_connections`), and PR #127 keeps its default
  unchanged — but it does **not** move the 32-concurrency write burst within the p95 ≤ 200 ms SLO, and setting it to
  32 is explicitly **not** justified (it can worsen contention). The original `STAGE_7_CAPACITY_REMEDIATION.md`
  pool-queueing hypothesis is **superseded by this measured evidence.**
- **The bottleneck is a deliberate correctness control** — the m03-audit tamper-evident hash-chain — **not a
  defect.** It **must not** be weakened for performance (audit is load-bearing; CLAUDE.md). No change to the audit
  serialization is made here.
- **The real levers are capacity/design decisions, none of which is a repo knob and none of which weakens a
  control:**
  1. **Audit `scope_key` granularity review (ADR-track).** Contention is per `scope_key`. If writes that need not
     share a hash-chain currently share one scope, a finer scope partition would reduce contention **while
     preserving per-scope tamper-evidence**. This is an **audit-design decision (needs an ADR + m03 owner review)**,
     not a tuning flag — it is flagged here, **not** changed.
  2. **DB tuning to shorten the critical section** — larger `shared_buffers`, WAL/commit tuning — a DBA/capacity
     decision, measured, not guessed.
  3. **Horizontal capacity by tenant/scope** — the per-audit-scope write-concurrency ceiling is bounded; scale out
     by partitioning write load across scopes/replicas. Capacity-planning input for COO/Ops.
  4. **Reproducible measurement on a quiet/dedicated production host** — the ≈4× cross-session variance on this
     shared VPS makes single-node numbers unreliable for acceptance (see §5).

## 5. Measurement-integrity caveat (must be stated)

This retest ran on a **shared Contabo VPS**. The ≈4× run-to-run variance at fixed config, together with container
CPU never exceeding ~1.5 cores while latency swung wildly, is the classic signature of **noisy-neighbour CPU steal**
(invisible to `docker stats`, which reports container %, not steal). Therefore:

- The **root-cause finding is robust** (the advisory-lock contention was observed directly in `pg_locks`/
  `pg_stat_activity`, independent of variance).
- The **absolute latency numbers are NOT acceptance-grade** and must be re-measured on the **dedicated production
  host** with repeated trials before any COO/Ops load acceptance (OQ#13). This is recorded honestly rather than
  presenting one favourable run as "the" result.

## 6. What this establishes / does not establish

- **Establishes (measured):** the 32-conc write-burst breach is dominated by **audit hash-chain advisory-lock
  serialization**, not connection-pool sizing; enlarging the pool does not fix it; CPU is not container-saturated;
  errors are 0; the staging stack now runs merged main on PG16.15 with the pool knob available.
- **Does NOT establish:** an accepted remediation (the fix is a capacity/audit-design decision, not a knob),
  acceptance-grade numbers (VPS variance; re-measure on the dedicated prod host), or operational acceptance of the
  load/chaos workstream (COO/Ops, Tier-2). `load_and_chaos_at_scale` stays `requires_review`. **No GO.**
