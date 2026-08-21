# Stage 7 — Off-Server Backup / DR Architecture Decision Package

> **A management decision package, not an implementation.** It designs the minimum production-compliant
> off-server backup/DR architecture for the current Contabo primary, compares suitable destinations, and
> recommends one **for human approval**. Per `STAGE_7_HARDENING_INCREMENT_2026_08_18.md` §C the off-server copy is
> **BLOCKED** on an approved destination + credentials; this document **creates no accounts, buckets, or
> credentials** and invents no region. Kenya-DPA region confirmation is a **Legal/Risk/Technology** decision.
> No GO.

---

## 1. Current posture vs the requirement (repository truth)

- **Exists today (on-host only):** `backups/backup.sh` — `pg_dump -Fc` + SHA-256 verify + restore-verify into a
  throwaway DB (2 tenants) + daily cron 02:30, retention 7 (evidenced in `STAGE_7_CONTABO_FULLSTACK_EVIDENCE.md`).
- **Missing:** any copy **logically/geographically separated** from the primary host. Off-server copy is a
  **pre-production commissioning requirement**, not yet configured.
- **Approved targets (OQ#13, 2026-08-17):** **RPO ≤ 5 min**, **RTO ≤ 15 min**, availability ≥ 99.9%.

**Gap that decides the design:** a **daily `pg_dump` alone gives RPO ≈ 24 h** — it cannot meet RPO ≤ 5 min. The
production architecture therefore **must add continuous WAL archiving (PITR) and/or a streaming standby**, not just
a periodic dump. That is the core of this package.

## 2. Requirements the chosen architecture must meet

| # | Requirement | Target |
| --- | --- | --- |
| R1 | Recovery point (data loss) | **RPO ≤ 5 min** → continuous WAL archiving (`archive_timeout` ≤ 60 s) and/or streaming replication |
| R2 | Recovery time (failover) | **RTO ≤ 15 min** → warm standby or fast restore path, rehearsed |
| R3 | Encryption | in transit (TLS) **and** at rest (client-side/backup encryption before upload) |
| R4 | Immutability / tamper-resistance | object-lock / versioned WORM retention where supported (ransomware + insider defence) |
| R5 | Geographic / logical separation | different datacentre/region **and ideally different failure domain than the primary provider** |
| R6 | Kenya DPA / residency | production data region confirmed acceptable by Legal/Risk/Technology before real data |
| R7 | Restore testing | scheduled restore-verify + periodic full DR rehearsal (feeds `dr_failover_failback_drill`) |
| R8 | Least-privilege creds | **write-only / append-only** backup identity, scoped to one destination; cannot delete or read other data |

## 3. Candidate destinations

| Option | R1/R2 fit | R4 immutability | R5 separation | Cost | Notes |
| --- | --- | --- | --- | --- | --- |
| **A. Second Contabo VPS** (different DC/region) — streaming physical standby + WAL archive | ✅ warm standby → best RTO; sync/async → RPO≤5min | ⚠️ filesystem snapshots only (no native object-lock) | ⚠️ **same provider** (correlated account/provider risk) | low | fastest failover; but a provider-account compromise hits primary + standby |
| **B. S3-compatible object store — Backblaze B2 / Wasabi** (pgBackRest/wal-g base+WAL) | ✅ PITR to ≤5 min; RTO = restore time (fine while DB small) | ✅ **Object Lock (WORM)** on B2/Wasabi | ✅ **different provider + region** | low (B2/Wasabi cheap, no/low egress) | tamper-proof off-provider copy; slower failover than a warm standby |
| C. Contabo Object Storage (S3-compatible) | ✅ PITR | ⚠️ object-lock support limited/varies | ⚠️ same provider | low | cheap but correlated with primary |
| D. Self-hosted MinIO on another host | ✅ PITR | ✅ object-lock (MinIO WORM) | depends where hosted | med (you run it) | only "off-server" if genuinely separate infra; adds ops burden |

## 4. Recommendation (for management approval — not binding)

**Two complementary layers, because no single destination satisfies all of R1–R8:**

1. **Primary DR: streaming physical standby on a second Contabo VPS in a *different datacentre/region*** (Option
   A). Async streaming replication (or `pgBackRest` + WAL) gives the **fastest RTO** (promote standby ≤ 15 min)
   and **RPO ≤ 5 min** (with `archive_timeout ≤ 60 s`). This is the failover target for the DR drill.
2. **Immutable off-provider copy: `pgBackRest` (or `wal-g`) base backups + WAL archive to an S3-compatible object
   store with Object Lock** — **Backblaze B2 or Wasabi** (Option B), in a Legal-approved region. This defends
   against the correlated risk of Option A (a Contabo-account compromise or provider outage) and against
   ransomware/insider deletion via **WORM immutability**, with **write-only** credentials.

Rationale: Option A alone shares provider/account failure domain with the primary (violates the spirit of R5);
Option B alone can exceed RTO for a fast failover. Together they meet **RTO≤15/RPO≤5** *and* provide a
tamper-proof, geographically + provider-separated copy. If management wants a single-layer minimum first,
**start with Option B (immutable off-provider PITR)** as the non-negotiable off-server copy, and add the warm
standby (Option A) for RTO.

> Recommendation only. Management chooses the destination(s) and buys them. No accounts or credentials are created
> here.

## 5. Target architecture (post-approval; describes, does not deploy)

```
  Contabo Primary (finapp production DB, PG16)
   │  ├─ continuous WAL archiving (archive_timeout ≤ 60s)   ── R1
   │  ├─ nightly pg_dump -Fc + SHA-256 + restore-verify (kept: backups/backup.sh)
   │
   ├──(async streaming replication)──▶  Contabo Standby VPS (different DC/region)   ── R2/R5
   │                                     • warm standby; promote on failover (RTO ≤ 15m)
   │
   └──(pgBackRest/wal-g, client-side encrypted)──▶  S3-compatible store (B2/Wasabi)  ── R3/R4/R5
                                                     • base + WAL; PITR to ≤5 min
                                                     • Object Lock (WORM) retention   ── R4
                                                     • write-only/append-only key      ── R8
                                                     • region: Legal-approved (DPA)    ── R6
```

- **Encryption (R3):** TLS for all transfer; **client-side encryption of backups before upload** (e.g. pgBackRest
  cipher / age/gpg) so the object store never holds plaintext; keys held by the platform (custody documented, tied
  to the secrets provider once approved).
- **Immutability (R4):** enable **Object Lock in compliance/governance mode** with a retention window ≥ the
  backup retention; the write-only key cannot shorten or bypass the lock.
- **Least privilege (R8):** a dedicated **application key scoped to the single backup bucket**, `PutObject` (+
  multipart) only — **no `DeleteObject`, no `ListBucket` of other buckets, no read of other data**. Lifecycle
  expiry (not manual delete) handles retention; deletes are blocked by Object Lock during the window.
- **Restore testing (R7):** automated periodic restore-verify from the object store into a throwaway DB (extends
  the existing restore-verify), plus a full promote-standby + reconcile rehearsal that produces the
  `dr_failover_failback_drill` evidence. RTO/RPO are **measured**, then presented for COO/Ops Tier-2 acceptance.

## 6. Credentials / inputs required AFTER approval (out-of-band; never committed)

1. Approved **destination(s)** (standby VPS spec and/or object-store provider + **region confirmed under Kenya DPA**
   for production data; staging is synthetic and unconstrained).
2. **Write-only/append-only** object-store access key + secret (scoped to one bucket) — delivered out-of-band.
3. **Object-lock retention** window + **backup encryption key** custody decision.
4. Standby VPS SSH/replication credentials (out-of-band).
5. Confirmed **RPO/RTO acceptance** owner (COO/Ops) for the rehearsal sign-off.

On delivery, engineering (ADR-131, ADR-127 fail-closed executor) wires WAL archiving + the standby/off-server push
of the **already-verified, checksummed** backup — a fail-closed addition with no new inbound surface — and runs the
DR rehearsal on the real PG16 stack. **Production DR acceptance and GO remain human/external.**

## 7. What this establishes / does not establish

- **Establishes:** the minimum production-compliant off-server/DR design, a destination comparison, a recommended
  two-layer architecture, and the exact post-approval inputs.
- **Does NOT establish:** any account, bucket, credential, region approval, deployed backup, or DR acceptance.
  Off-server backup stays **BLOCKED** pending management. `dr_failover_failback_drill` stays `requires_review`.
  No GO.
