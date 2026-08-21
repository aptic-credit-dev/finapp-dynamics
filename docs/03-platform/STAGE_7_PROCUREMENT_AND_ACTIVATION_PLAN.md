# Stage 7 — Procurement & Activation Plan (buy-this, in-this-order, then engineering runs this)

> The single actionable handoff: exactly what management must **buy/appoint**, in what **order**, the **resolved
> infrastructure decisions** (OpenBao topology, standby sizing, B2 retention), and the **execution-ready engineering
> sequence** that runs the moment each item is delivered. Builds on the merged specs
> (`STAGE_7_INFRA_PROVISIONING_SPEC.md`) and live-readiness evidence (`STAGE_7_LIVE_READINESS_VALIDATION.md`).
> **No secrets, tokens, keys, accounts, or regions are created here.** Nothing transitions a workstream or issues a
> GO. Recommendations are for management approval; Claude/engineering signs nothing and issues no GO. Baseline:
> merged `main` `ea36cbf`.

---

## 1. Final procurement sheet (only external items still required)

| # | Item | Minimum spec | Buy now / defer | Out-of-band inputs to engineering | Blocks GO? |
| --- | --- | --- | --- | --- | --- |
| A | **OpenBao host** | 1 dedicated VPS, **2 vCPU / 4 GB / 40 GB SSD**, Ubuntu 24.04, **private network only**, internal TLS + DNS name | **Buy now** (single node); 3-node Raft = pre-GA (deferred, §4) | host SSH; `https://` URL; TLS CA PEM; AppRole RoleID + wrapped SecretID | Yes |
| B | **DR standby VPS** | **Match primary** (12 vCPU / 48 GB / disk ≥ primary + WAL headroom), Ubuntu 24.04, **different Contabo DC**, PG16 | Buy now (parallel) | host SSH; replicator role cred; private path to primary | Yes |
| C | **Backblaze B2** | dedicated bucket, **Object Lock (WORM) on**, versioning on, **30-day** operational retention, DPA-approved region | Buy now (parallel) | endpoint+region+bucket; **write-only** key id/secret; encryption passphrase | Yes |
| D | **External pentest** | independent firm, NDA + CoI, CVSS v3.1, retest included | **Appoint now** (long lead) | signed engagement + RoE; scheduled window | Yes |
| E | **Pilot migration source (OQ#14)** | named pilot tenant + named source system + read-only extract/API route + data volumes; CFO/Legal/business signers | **Name now** (business decision) | source access/extract + field mapping | Yes |

## 2. Resolved decisions (recommendations for management approval)

### 4 — Production OpenBao topology
**Recommended baseline: start with ONE dedicated OpenBao VPS for the internal pilot; require 3-node Raft before
GA/scale.** Rationale, from the actual posture: the pilot is **internal-first, low-volume** (OQ#4; MVP is recon +
draft-only journals + cases — limited secret traffic), and the app **fails closed** on any provider unavailability
(it degrades secret-dependent features, it does not corrupt data). A single node with **auto-unseal + tested Raft
snapshot/restore to the immutable off-server store** gives a fast, rehearsed recovery well inside RTO ≤ 15 min for a
pilot. **99.9% availability at production scale, however, needs quorum HA**, so **3-node Raft is the pre-GA
baseline** — purchased after the pilot proves out, not before the pilot GO. (Management may elect 3-node from day
one if budget allows; the adapter/topology are identical.)

### 5 — DR standby sizing
**Recommended: MATCH the primary's CPU/RAM (12 vCPU / 48 GB), disk ≥ primary data + WAL headroom.** A failover
target must carry **full production load immediately on promotion** to honour RTO ≤ 15 min *and* the post-failover
SLO; a smaller "vertically-scalable-later" box meets the promotion time but breaches the performance SLO exactly
when it matters (during an incident). A smaller standby is acceptable **only** if the COO explicitly risk-accepts
degraded post-failover performance for the pilot — otherwise match the primary.

### 6 — Backblaze B2 retention
**Recommended operational policy: weekly full + daily differential + continuous WAL archiving; 30-day operational
PITR window; Object Lock (compliance mode) retention = 30 days** (so ransomware/insider cannot shorten it).
**Distinguish:** this **30-day operational-recovery** window is an engineering/ops recommendation. A **regulatory /
archival** retention (longer, e.g. for financial records) is a **Legal decision under the Kenya DPA / sector rules —
NOT invented here**; when Legal sets it, extend the Object-Lock window and lifecycle accordingly. OpenBao Raft
snapshots use the same bucket + WORM window.

## 3. Recommended purchase order (parallel tracks; ranked by unlock speed × lead time)

| Priority | Track | Management action | Engineering action immediately after | Stage-7 evidence unlocked |
| --- | --- | --- | --- | --- |
| **1 (start today)** | **Pentest appointment** (D) | Appoint firm, sign NDA/CoI, schedule window — **longest lead time** | Send the standalone brief (`STAGE_7_PENTEST_PROVIDER_BRIEF.md`); stand up the test window | toward `penetration_test` exit |
| **1 (start today)** | **OpenBao host** (A) | Buy 1 small VPS + issue TLS — **cheapest, fastest, biggest technical unlock** | Deploy (`deploy/openbao/`) → bind M41 adapter in staging → prove fail-closed→available + snapshot/restore | secrets binding evidence (M41 live) |
| **2** | **Standby + B2** (B, C) | Buy 2nd VPS (different DC) + create B2 (WORM, write-only key) + DPA region ruling | Harden → replication → WAL → pgBackRest→B2 → **cross-host DR drill** (RTO/RPO measured) | toward `dr_failover_failback_drill` exit |
| **2 (parallel)** | **Pilot source** (E) | Name pilot tenant + source; appoint CFO/Legal/business signers | Build the real field mapping; rehearse migration + reconciliation | toward `real_data_migration_execution` entry+exit |

Start **Track 1 (pentest appointment)** and **Track 1 (OpenBao)** immediately — pentest for its lead time, OpenBao
for the quick, high-value unlock. Tracks 2 run in parallel as soon as the VPS/B2/pilot decisions land.

## 4. Engineering activation sequences (execution-ready; run when the input arrives; no secrets here)

**OpenBao host supplied →**
1. `cp deploy/openbao/env.openbao.example .env.openbao`; place TLS material in `OPENBAO_TLS_DIR`.
2. `docker compose --env-file .env.openbao up -d` → `bao operator init` (**operator records unseal keys off-host**;
   custody per `deploy/openbao/README.md`).
3. `./setup.sh` (transit + `finapp-app` policy + AppRole + audit); issue **wrapped SecretID**; **revoke root token**.
4. Set `FINAPP_OPENBAO_ADDR/_ROLE_ID/_SECRET_ID/_CA_CERT_PEM` on the API → adapter binds (fail-closed until then).
5. Prove `UnavailableSecretProvider → available` transition + provision/resolve/rotate/destroy + zero-secret-value
   invariant; `./snapshot.sh save` + restore-verify. Record evidence.

**Standby + B2 supplied →**
1. Harden the standby (SSH keys/IP, ufw deny-default, PG16).
2. On the primary: merge `deploy/dr/postgresql.replication.conf.example`; create `replicator` + replication slot;
   place `pgbackrest.conf` (from example + env); `./backup.sh full`.
3. On the standby: `./standby-bootstrap.sh` → start PG → `./dr-healthcheck.sh` (confirm streaming, low lag).
4. Enable WAL archive + base backups → B2 (WORM); restore-verify from B2 into a throwaway target.
5. **DR drill:** `./restore-pitr.sh "<time>"` reconcile; then `./failover.sh promote` + reconcile + failback;
   **measure RTO/RPO** → evidence for COO/Ops Tier-2.

**Pilot source named →**
1. Build/extend the field mapping (extends the synthetic migration framework).
2. Rehearse migration into a non-production copy; **control totals reconcile**; rollback rehearsed.
3. Present reconciliation to **CFO + Legal + business owner** for sign-off (forms in
   `STAGE_7_TIER2_ACCEPTANCE_FORMS.md`).

## 5. Workstream next-gate table (the single external event that permits each transition)

| Workstream | Current status | Exact next gate (single external event) | Who supplies it | Transition enabled? |
| --- | --- | --- | --- | --- |
| `penetration_test` | `requires_review` | Independent external pentest **executed + report delivered** (then retest + Auditor) | Appointed external firm | Not yet — no report exists |
| `dr_failover_failback_drill` | `requires_review` | **2nd VPS + B2 provisioned** → cross-host DR drill run + COO acceptance | Management (VPS/B2) → eng runs → COO | Not yet — no standby/B2 |
| `load_and_chaos_at_scale` | `requires_review` | **Dedicated prod host** for a reproducible per-tenant SLO re-measure + COO acceptance | Management (host) → eng → COO | Not yet — shared-VPS numbers not acceptance-grade |
| `real_data_migration_execution` | `requires_review` | **Pilot tenant + source named (OQ#14)** — the ENTRY gate itself | Management/business | Not yet — source TBD (fails entry) |

No workstream may transition until its external event has actually occurred (repository criteria). CONDITIONAL_GO
unchanged; Stage 8 deferred.

## 6. Exact shortest path to M42 GO
Appoint pentest + buy OpenBao (today, parallel) → bind adapter in staging (proven) → buy standby + B2 + name pilot
source (parallel) → cross-host DR drill (COO) + per-tenant SLO re-measure (COO) → pentest report + retest (Auditor)
→ migration rehearsal + CFO/Legal/business sign → clean commissioning → pilot window → **human** M42 governed GO
(DERIVED). No AI/self-cert at any step.
