# Stage 7 — Capacity Remediation Analysis (authenticated write-burst latency)

> Tier-1 remediation **analysis** under **ADR-131**. It analyses the already-captured authenticated-load evidence
> (`STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md`) and applies **safe, control-neutral** staging tuning levers. It does
> **NOT** transition `load_and_chaos_at_scale` (stays `requires_review`), is **NOT** Tier-2 operational acceptance,
> and issues **NO** GO. **The before/after re-run must be executed on the Contabo staging host; the "after" numbers
> in this document are a TEMPLATE and are deliberately left UNFILLED — they are not fabricated here.** No RBAC,
> CSRF, audit, outbox, RLS, or maker-checker control is weakened for performance. Baseline: merged `main` `f11c388`
> (PR #126).

---

## 1. The signal being remediated

From `STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md` (real PG16, 0 errors across all scenarios):

| Scenario | Conc | p50 ms | p95 ms | p99 ms | max ms | rps | vs SLO (p95≤200 / p99≤500) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| auth_write (POST /identities) | 8 | 74.0 | 125.1 | 142.3 | 152.6 | 99.7 | **meets** |
| auth_mixed | 12 | 82.7 | 161.1 | 188.6 | 212.8 | 135.8 | meets |
| **auth_write_burst** | **32** | **397.4** | **508.0** | **529.7** | **538.1** | **73.7** | **exceeds latency SLO** |

Only the 32-concurrency write burst breaches the approved SLO (OQ#13: p95 ≤ 200 ms, p99 ≤ 500 ms, err ≤ 0.5%).
Error rate stayed **0%** — nothing failed; requests **queued**.

## 2. Root-cause analysis (from the measured shape, not speculation)

The measured shape points at **connection-pool saturation as the dominant first-order cause**:

1. **The pool default is 10; the burst offered 32 concurrent writers.** The API builds its pool with
   `new pg.Pool({ connectionString })` (`apps/api/src/platform.module.ts`), and node-postgres defaults `max` to
   **10**. At 32 concurrent writers, ~22 writers are **blocked in `pool.connect()`** waiting for one of 10
   connections to free — before any SQL runs. That waiting time is added to every slow request's latency.
2. **The breach is not a tail artefact — the whole distribution shifts.** `p50` rises from 74 ms (8 conc) to
   **397 ms** (32 conc): the *median* request is slow, which is the signature of a queue in front of a fixed-size
   resource, not of occasional GC/tail stalls.
3. **Throughput goes DOWN, not up, under more concurrency.** rps falls from 99.7 (8 writers) to **73.7** (32
   writers). More offered concurrency yielding *less* throughput is the classic saturation knee — the system is
   past its concurrency sweet spot for the current pool/replica sizing.
4. **8-concurrency writes (≤ pool 10) meet the SLO comfortably** (p95 125 ms). The only scenario that exceeds is
   the one whose concurrency exceeds the pool. This is consistent with pool-acquisition queueing being the primary
   lever.

**Secondary contributors (real, but not the first lever):** each write does **3 inserts** (row + audit event +
transactional-outbox entry) through auth → RBAC → CSRF → service → audit → outbox → RLS, so per-write work is
higher than a bare insert; the box is a **single API replica + single PostgreSQL** with **no container CPU/memory
limits set** (`deploy/staging/docker-compose.yml`). These raise the per-connection service time but do not by
themselves explain a *median* that quadruples exactly when offered concurrency crosses the pool size.

**Explicitly NOT yet measured (must be captured on the re-run, not assumed):** DB-side `pg_stat_activity` during
the burst (active vs `idle in transaction` vs waiting connections), lock/`pg_locks` contention, and host CPU
saturation. The original burst captured **HTTP-side latency only**; no DB-side sample was taken. The remediation
below makes that measurement possible and cheap. If, after right-sizing the pool, the median stays elevated, the
next suspect is per-write CPU (audit/outbox serialization) or single-replica CPU saturation — to be decided from
the DB-side capture, not guessed.

## 3. Safe tuning applied (this change) — concurrency knobs only

All three edits are **concurrency/measurement knobs with unchanged defaults**. None touches a security or
correctness control.

- **`apps/api/src/platform.module.ts` — `DATABASE_POOL_MAX`.** The pool is now built with an optional
  env-tunable `max`. **Unset/blank/invalid keeps node-postgres' default of 10** (no behavioural change unless an
  operator opts in). Operators must keep it **≤ PostgreSQL `max_connections`** (postgres:16 default 100). This is
  a pool-size knob only — it changes no RBAC/CSRF/audit/outbox/RLS behaviour and the app still connects as the
  non-owner `finapp_app` (FORCE-RLS) role.
- **`deploy/staging/docker-compose.yml` / `env.staging.example` — `DATABASE_POOL_MAX` passthrough.** Blank by
  default; documented as "concurrency knob only; keep ≤ PG max_connections".
- **`deploy/staging/auth-load-harness.mjs` — focused re-measurement flags.** `AUTHLOAD_ONLY=<scenario>` runs a
  single scenario; `AUTHLOAD_BURST_CONC` / `AUTHLOAD_BURST_MS` resize the write burst so it runs long enough to
  sample `pg_stat_activity`. Defaults are unchanged (32 conc / 2000 ms) when the vars are unset. The harness still
  computes **no** SLO PASS/FAIL (acceptance is a human COO/Ops decision, OQ#13).

Why pool sizing is the right *first* lever and why it is safe: it directly targets the measured queueing, it is
reversible (unset the var), it adds no attack surface, and it cannot bypass RLS (connections still authenticate as
`finapp_app`). It is **not** a substitute for capacity planning — production sizing must still be validated against
the first pilot tenant's real write-concurrency profile (OQ#14).

## 4. Staging re-run procedure (to be executed on the Contabo host — NOT runnable from the dev box)

> This box has **no access to the Contabo staging host and Docker is not available locally**, so the re-run cannot
> be executed here. The procedure below is exact so an operator (or a future session with server access) can run it
> and paste the results into §5. Running it fabricates nothing; it measures.

For each candidate pool size `M` in a matrix such as **{10 (baseline), 24, 32, 48}** (all ≤ PG `max_connections`
100):

```bash
# On the Contabo staging host, in the deploy/staging compose project:
# 1. Set the pool size for this trial (10/24/32/48) and recreate ONLY the api container.
DATABASE_POOL_MAX=<M> docker compose up -d --force-recreate --no-deps api

# 2. Capture a DB-side sample WHILE a longer burst runs, so pg_stat_activity is observable.
#    Run the burst long enough (e.g. 8s) that the sampler catches steady-state.
docker compose exec -T -e LOGIN_PW \
  -e AUTHLOAD_ONLY=auth_write_burst -e AUTHLOAD_BURST_CONC=32 -e AUTHLOAD_BURST_MS=8000 \
  api node --input-type=module < deploy/staging/auth-load-harness.mjs &

# 3. During the burst, sample the DB (a few times):
docker compose exec -T db psql -U "$DATABASE_OWNER_ROLE" -d finapp_staging -c \
  "SELECT state, wait_event_type, count(*) FROM pg_stat_activity \
   WHERE datname='finapp_staging' GROUP BY 1,2 ORDER BY 3 DESC;"
docker compose exec -T db psql -U "$DATABASE_OWNER_ROLE" -d finapp_staging -c \
  "SELECT count(*) AS waiting_locks FROM pg_locks WHERE NOT granted;"
# (optional) host CPU during the burst:  docker stats --no-stream
```

Record for each `M`: the burst p50/p95/p99/max/rps + error count (harness output) **and** the DB-side counts
(active / idle-in-transaction / waiting; ungranted locks; host CPU). Then restore the baseline
(`DATABASE_POOL_MAX` unset → 10) unless an operator decides to keep a tuned value.

**Safety rails for the re-run:** synthetic non-PII data only; loopback only; keep `M ≤ max_connections`; the app
role stays `finapp_app` (NOBYPASSRLS); no security control is toggled. If raising `M` moves the bottleneck to CPU
or locks (median stays high, DB shows many `active` but few `waiting`), that is the evidence to escalate to
horizontal API scaling / DB tuning — a **capacity-planning** input for the COO/Ops acceptance, still not a GO.

## 5. Before / after — RESULT: retest executed; pool hypothesis NOT confirmed

> **UPDATE (2026-08-21, retest on Contabo staging against merged `main` `00909cb`).** The re-run in §4 was
> **executed**. Full data + DB instrumentation: **`STAGE_7_CAPACITY_RETEST_EVIDENCE.md`**. The pool-acquisition
> hypothesis of §2 is **superseded by measured evidence** and recorded honestly below.

The `DATABASE_POOL_MAX` matrix {10, 16, 20, 24} at 32-concurrency showed **no monotonic pool dependence** and
**run-to-run variance (≈4×) larger than any pool effect** (M=10 p95 ranged 508→1057→861→919→604 ms across sessions;
in one probe M=10 at p95 604 ms *beat* M=24 at p95 2113 ms). **Errors stayed 0 everywhere.** DB instrumentation
(`pg_stat_activity` + `pg_locks`) found the writers **blocked on a transaction advisory lock** —
`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)` in **`packages/m03-audit/src/repository.ts:112`**
(`nextChainLink`, the **tamper-evident audit hash-chain**) — not queued on the pool and not CPU-bound (api/db
≈ 1–1.5 of 12 cores).

**Corrected conclusion:** the 32-conc write-burst breach is dominated by **audit hash-chain advisory-lock
serialization** (a correctness control, **not** a defect, **not** weakened), **not** connection-pool sizing.
`DATABASE_POOL_MAX` is therefore **not** the remediation (kept as a safe, reversible knob; default unchanged; and
setting it to 32 is explicitly **not** justified). The real levers are capacity/audit-design decisions — audit
`scope_key` granularity review (ADR-track, m03 owner), DB tuning, horizontal scale, and **re-measurement on a quiet
dedicated production host** (VPS variance made these numbers non-acceptance-grade). See the retest doc §4–§5.

## 6. What this establishes / does not establish

- **Establishes:** a **safe, reversible, control-neutral** knob (`DATABASE_POOL_MAX`, default unchanged) **and** —
  via the executed retest — the **real, DB-instrumented root cause** (audit-chain advisory-lock contention), which
  **disproves** the earlier pool-queueing hypothesis.
- **Does NOT establish:** an accepted remediation (the fix is a capacity/audit-design decision, not a knob),
  acceptance-grade numbers (shared-VPS variance — re-measure on the dedicated prod host), the production
  write-concurrency profile (pilot-derived, OQ#14), or operational acceptance of the load/chaos workstream
  (COO/Ops, Tier-2). `load_and_chaos_at_scale` stays `requires_review`. No GO.
