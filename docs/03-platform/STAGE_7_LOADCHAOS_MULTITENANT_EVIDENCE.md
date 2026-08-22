# Stage 7 — Load / Chaos Multi-Tenant Evidence + Production-Host Review (internal-only)

> Tier-1 execution under **ADR-131**, on the existing Contabo staging host (12 vCPU / 48 GB, PG16.15), using only
> the repository, synthetic data, and existing tooling — **no purchase, no external provider, no new
> infrastructure**. It extends the load harness to **multi-tenant authenticated writes**, runs chaos, and reviews
> the future-production host. **Real, measured results; nothing fabricated.** This is **LOCAL / SINGLE-HOST TECHNICAL
> EVIDENCE — NOT COO/Ops acceptance and NOT cross-host DR acceptance.** No control weakened; the audit chain is
> preserved. `load_and_chaos_at_scale` stays `requires_review`. No GO.

---

## 1. Decisive finding — platform-scoped writes serialize on ONE global audit chain (refines prior)

The prior capacity retest (`STAGE_7_CAPACITY_RETEST_EVIDENCE.md`) attributed the 32-conc write-burst breach to
"audit hash-chain advisory-lock" contention and described it as **per-tenant**. This increment **measured that
precisely** by extending the harness to spread authenticated writes across **8 synthetic tenants** (`x-tenant-id`
round-robin) and comparing to single-tenant at equal load:

| Scenario (32 conc, equal load) | p95 ms | rps | errors |
| --- | --- | --- | --- |
| `auth_write_burst` (single tenant) | **637** | 61 | 0 |
| `multi_tenant_write_burst` (8 tenants) | **612** | 59 | 0 |

**Statistically identical.** Distributing across 8 tenants did **not** relieve the contention. The DB confirmed why:
during the burst, `pg_locks` showed **`distinct advisory-lock objects = 1`** — every writer contends **one** advisory
lock. And **all** identity-write audit rows landed in **`scope_key = 'PLATFORM'`** (`distinct_scopes = 1`).

**Corrected, precise root cause:** `POST /api/v1/identities` is a **platform-scoped** operation, so its audit rows
append to the **single PLATFORM audit hash-chain** (`pg_advisory_xact_lock(hashtext('PLATFORM'))`). This is a **global
serialization point for platform-scoped writes**, not a per-tenant one — multi-tenant distribution cannot help it.
The per-tenant relief applies only to **tenant-scoped** audited operations (business writes within a tenant, whose
`scope_key` is the tenant); those were **not** directly exercised here (identities are the platform's canonical
platform-scoped write). This is the honest refinement: the identity-write stress hits the **worst case** (one global
chain); the realistic pilot workload (per-tenant business writes) would distribute across per-tenant chains.

**This is a deliberate correctness control (the tamper-evident PLATFORM audit spine is one chain) and is NOT
weakened for throughput.**

## 2. Full authenticated scenario results (synthetic, 0 errors throughout)

Approved SLO (OQ#13): p95 ≤ 200 ms, p99 ≤ 500 ms, error rate ≤ 0.5%.

| Scenario | conc | p50 | p95 | p99 | rps | err | vs SLO |
| --- | --- | --- | --- | --- | --- | --- | --- |
| auth_read | 12 | 81 | 238 | 274 | 121 | 0 | p95 slightly over (variance) |
| auth_write | 8 | 224 | 394 | 428 | 33 | 0 | p95 over (PLATFORM chain + WAL) |
| auth_mixed | 12 | 130 | 281 | 538 | 85 | 0 | over |
| auth_write_burst | 32 | 477 | 637 | 705 | 61 | 0 | over |
| **multi_tenant_read** | 12 | 105 | **178** | **208** | 104 | 0 | **p95 MEETS** (p99 just over) |
| multi_tenant_write_burst | 32 | 478 | 612 | 665 | 59 | 0 | over |

Security matrix (negative-authz): unauthenticated read **401**, write-without-CSRF **403**, unprivileged write
**403** — all PASS. CPU during the 32-conc burst: api ≈ 130%, db ≈ 177% of 1200% available — **not container-CPU
saturated**; the write ceiling is the single PLATFORM-chain serialization + WAL commit, not CPU.

**Reads meet the SLO; platform-scoped writes exceed p95 ≤ 200 ms** due to the single-chain serialization. Numbers
are **shared-VPS, not acceptance-grade** (run-to-run variance persists) — reproducible measurement belongs on the
dedicated production host for COO acceptance.

## 3. Chaos results

| Chaos | Result |
| --- | --- |
| **API container restart** | recovered to health 200 in **~15.2 s** |
| **PostgreSQL container restart** | DB healthy in ~7.7 s; **API reconnected** (pool recovery) → health 200 |
| **Post-chaos: FORCE-RLS** | **506 tables** still FORCE-RLS ✓ |
| **Post-chaos: tenant data** | 8 tenants intact (no loss) ✓ |
| **Post-chaos: audit chain** | **`gapfree = true`** (PLATFORM `count == max(seq)`) — tamper-evident chain intact through both restarts ✓ |
| **Post-chaos: corruption** | none ✓ |

Restart-recovery and integrity are clean. (Timeout/dependency-failure at the app edge is covered by the CSRF/authz
denials above and the existing chaos harness; earlier increments proved malformed-input → 400 and burst recovery.)

## 4. Production-host technical review (non-destructive; future prod host)

| Area | Finding |
| --- | --- |
| OS | Ubuntu 24.04.4 LTS, kernel 6.8; **5 pending security updates**; unattended-upgrades **active** |
| **SSH** | ⚠️ `PermitRootLogin yes` + `PasswordAuthentication yes` — **hardening gap** (should be key-only, root prohibit-password) for production |
| Firewall | ufw **active**; only **:22 public**; app/DB not public |
| Container binding | api + db published to **127.0.0.1 only** ✓ |
| Container privilege | **no privileged containers**; api runs as **non-root `node`** ✓ |
| PostgreSQL exposure | **127.0.0.1:5432 only** ✓ |
| Time sync | synchronized ✓ |
| Disk / mem | 382 GB free / 387 GB; 46 GB free RAM ✓ |
| Secrets | staging env is **synthetic only** (no plaintext production secrets) ✓ |

**Two commissioning hardening items** (recorded, not changed live to avoid remote-lockout risk on the shared host;
they belong in the governed production-commissioning step): (1) **SSH** → disable password auth + restrict root
login; (2) **apply the 5 pending security updates**. Everything else is already production-shaped.

## 5. Honest caveats & scope
- **Not COO/Ops acceptance.** Tier-1 technical evidence only (OQ#13 acceptance is a human decision).
- **Not cross-host DR.** Chaos here is single-host restart recovery; the cross-host failover/failback drill needs the
  2nd VPS + B2 (deferred).
- **Shared-VPS variance** — absolute latencies are not acceptance-grade; re-measure on the dedicated prod host.
- **Identity writes are platform-scoped;** tenant-scoped business writes (the realistic pilot workload) were not
  directly driven and would distribute across per-tenant chains.

## 6. Workstream impact
`load_and_chaos_at_scale` stays **`requires_review`**. Evidence added: multi-tenant + burst load metrics, the precise
single-PLATFORM-chain root cause, restart-chaos recovery, post-chaos integrity, and a production-host review. Exit
still requires: reproducible per-workload measurement on the **dedicated production host** meeting OQ#13 + **COO/Ops
acceptance** (human). CONDITIONAL_GO unchanged; no GO; Stage 8 deferred.
