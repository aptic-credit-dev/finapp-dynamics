# Stage 7 — DR Infrastructure Provisioning Readiness (measured primary → precise standby spec)

> DR execution status and the **exact** external inputs still required, with a standby spec derived from the
> **measured** primary. No new external resource (standby VPS, Backblaze B2, OpenBao host, pentest provider, pilot
> source) has been supplied, so cross-host replication, the DR failover/failback drill, and the immutable-restore
> drill **cannot be executed** this increment — recorded honestly, nothing fabricated. The DR tooling
> (`deploy/dr/`) and its backup/restore/WAL/checksum mechanics were already validated live on the primary PG16
> (`STAGE_7_LIVE_READINESS_VALIDATION.md`). No workstream transitions; CONDITIONAL_GO unchanged; Stage 8 deferred.
> Baseline: merged `main` `cd40e43`.

---

## 1. Measured primary (the current Contabo host = future production host)

| Attribute | Measured value |
| --- | --- |
| vCPU | **12** |
| RAM | **48 GB** (48,174 MB) |
| Disk (root / docker) | **387 GB total, ~5 GB used, ~382 GB free** |
| PostgreSQL | **16.15**; `finapp_staging` **45 MB**; cluster **67 MB**; `pg_wal` **~49 MB** |
| `max_connections` | 100 |

The application database is tiny (synthetic staging). The standby's **disk** requirement is therefore driven by
**WAL-retention headroom + production growth**, not current data volume; **CPU/RAM** is driven by the approved
requirement that the standby carry **full production load on promotion** (RTO ≤ 15 min + post-failover SLO).

## 2. Precise standby purchase spec (recommended minimum)

| Attribute | Recommendation | Basis |
| --- | --- | --- |
| vCPU | **12** (match primary) | must carry full load on promotion |
| RAM | **48 GB** (match primary) | same |
| Disk | **≥ the primary's provisioned disk (~387 GB)**; hard floor **≥ 200 GB SSD** | WAL retention during standby lag + growth; matching the primary is simplest and safe |
| OS | Ubuntu 24.04 LTS | parity |
| PostgreSQL | 16.x (match the primary minor 16.15 where possible) | streaming replication compatibility |
| Location | **different Contabo DC / failure domain** than the primary | DR separation (R5) |
| Network | private path to primary; key-only SSH; deny-by-default firewall | hardening |

> A smaller standby (e.g. fewer vCPU) is acceptable **only** if the COO explicitly risk-accepts degraded
> post-failover performance for the pilot. Default: **match the primary.** The exact primary Contabo DC/region is a
> control-panel fact for management to read; the standby must be in a **different** one (not asserted here).

## 3. Backblaze B2 spec (unchanged; restated for the buy)
Dedicated bucket with **Object Lock (WORM)** + versioning; DPA-approved region; client-side AES-256 encryption
before upload; **write-only / append-only** application key scoped to the one bucket (no delete, no cross-bucket
list); a separate read-capable key used only during restore. Retention: **weekly full + daily differential +
continuous WAL; 30-day operational PITR; Object-Lock 30 days** (regulatory/archival retention is a Legal decision).

## 4. Execution status (this increment)

| Item | Supplied? | Result |
| --- | --- | --- |
| DR standby VPS | **No** | replication + failover/failback drill **not executable** — return spec (§2) |
| Backblaze B2 | **No** | immutable off-server backup + restore drill **not executable** — return spec (§3) |
| OpenBao dedicated host | **No** | **OpenBao permanent activation remains blocked on dedicated host purchase** (assets ready: `deploy/openbao/provision.sh`) |
| External pentest provider | **No** | provider brief ready (`STAGE_7_PENTEST_PROVIDER_BRIEF.md`); nothing to intake yet |
| Pilot migration source (OQ#14) | **No** | migration rehearsal **not startable** — entry gate unmet |

**Already proven (host-independent, prior increments):** DR tooling `bash -n` clean + fail-closed guards; on the
primary PG16 — `pg_basebackup` + SHA-256 `backup_manifest`, `pg_verifybackup` "backup successfully verified",
restore-recovery (queryable), WAL archiving (segments archived). Cross-host pieces (streaming standby, real
failover, off-provider push) need the standby + B2.

## 5. Workstream transition eligibility (re-evaluated)

| Workstream | Status | Evidence present | Exact next missing criterion | Transition permitted? |
| --- | --- | --- | --- | --- |
| `penetration_test` | `requires_review` | staging env exists; internal pre-assessment; provider brief | **independent external pentest report** (+ retest + Auditor) | **No** |
| `dr_failover_failback_drill` | `requires_review` | DR tooling validated; single-host backup/restore/WAL proven | **2nd VPS + B2** → cross-host drill within RTO≤15/RPO≤5 + **COO** acceptance | **No** |
| `load_and_chaos_at_scale` | `requires_review` | authenticated load + capacity retest (audit-lock root cause) | **dedicated prod host** reproducible per-tenant SLO re-measure + **COO** acceptance | **No** |
| `real_data_migration_execution` | `requires_review` | synthetic rehearsal framework | **pilot tenant + source named (OQ#14)** — entry gate | **No** (fails entry) |

None satisfies its exit (or, for migration, even its entry) criteria. **No transition.**

## 6. Exact management inputs still required
1. **Second Contabo standby VPS** — spec §2 (different DC; host/IP + SSH key access).
2. **Backblaze B2** — account + bucket (Object Lock) + **write-only** key + DPA region + encryption passphrase
   custody (spec §3).
3. **Dedicated OpenBao VPS** — spec in `STAGE_7_INFRA_PROVISIONING_SPEC.md` §A.
4. **Independent pentest provider** — appointment + window (brief ready).
5. **Pilot tenant + source (OQ#14)** — names + access route + CFO/Legal/business signers.

**Strongest unlock order:** standby VPS **+** B2 together (they enable the first genuine cross-host DR drill against
RTO ≤ 15 / RPO ≤ 5) — then pentest appointment and pilot-source naming in parallel.

## 7. What this establishes / does not establish
- **Establishes:** a measured, precise standby purchase spec; a restated B2 spec; an honest execution status; and a
  re-evaluated workstream table.
- **Does NOT establish:** any provisioned standby/B2/OpenBao host, any cross-host replication or DR drill, any RTO/RPO
  measurement, or any Tier-2 acceptance. No GO. Stage 8 deferred.
