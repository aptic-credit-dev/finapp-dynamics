# Production Cross-Host Disaster-Recovery Plan (G2)

> **PREPARED — NOT EXECUTED / NOT A PRODUCTION GO.**
>
> Final execution pack for the cross-host DR drill that discharges production-exit gate **G2**. It finalizes — it
> does not duplicate — the chosen architecture in `STAGE_7_OFFSERVER_DR_ARCHITECTURE_DECISION.md`, the decision
> package `STAGE_7_OFFSERVER_BACKUP_DR_DECISION_PACKAGE.md`, and the Tier-1 single-host evidence
> `STAGE_7_TIER1_DR_EVIDENCE.md`. Frozen candidate SHA: `b26d4675fafc9b55b616f41319f191e9f6fb6269`.

---

## 1. Why G2 is not yet satisfiable

Tier-1 proved the DR **procedure** (backup → clean target → migrate → restore → reconcile → failover/failback →
RTO/RPO) end-to-end against a real PostgreSQL, at RTO 309 ms / RPO 0 s — but **on a single host**. G2 requires a
genuinely **separate second host** in a different failure domain plus an **off-server immutable encrypted
backup**. Neither is provisioned. **A same-host restore does NOT satisfy G2** and must never be represented as
cross-host DR assurance.

## 2. Required topology (per the ratified architecture)

- **Primary:** Contabo production VPS (fresh PG16), failure domain A.
- **Warm standby:** a **second Contabo VPS in a different datacentre / failure domain** (B), kept current by
  streaming replication — the DR failover target that delivers RTO.
- **Off-server immutable copy:** pgBackRest (or `wal-g`) base + WAL pushed to **Backblaze B2**, **client-side
  encrypted before upload**, under **Object Lock (WORM)**, using a **write-only / append-only** key scoped to one
  bucket — surviving a Contabo-account compromise or provider outage.
- Continuous WAL archiving (`archive_timeout ≤ 60 s`) delivers RPO; the standby delivers RTO; the immutable copy
  delivers durability/tamper-resistance. No single layer suffices.

## 3. Drill procedure (to execute once the topology exists)

1. Confirm replication healthy (standby caught up; lag within RPO); confirm WAL archiving to B2 and Object-Lock
   retention active.
2. Take a fresh base backup; push to B2; verify with `pg_verifybackup`; record snapshot id + checksum.
3. **Clean-host restore:** provision a clean host with no prior data; restore base + WAL **from the B2 immutable
   copy only** (not from the primary); apply migrations in-process; confirm migration count and FORCE-RLS table
   count match the source.
4. **Primary-host-loss scenario:** simulate total loss of the primary; **promote the warm standby**; repoint the
   app `DATABASE_URL` (DNS / reverse-proxy upstream flip); verify `/api/v1/health` + a canary write.
5. **Measure RTO and RPO** against the approved targets (§4).
6. **Failback:** rebuild the old primary as a standby from the promoted node; resync; controlled switchover back;
   reconcile before declaring clean.

## 4. RPO / RTO measurement vs OQ#13

| Metric | Approved target (OQ#13) | Source of truth |
| --- | --- | --- |
| RTO (promote standby, repoint, healthy write) | **≤ 15 min** | measured in step 4 |
| RPO (data loss at primary-loss instant) | **≤ 5 min** | replication lag + WAL archive interval |

Acceptance is a **human COO/Ops decision** against these targets — never an automated pass.

## 5. Application-consistency + tenant/audit-integrity checks

- Reconcile control totals (tenants, identities, grants, migration count, FORCE-RLS table count) source ↔
  restored/promoted.
- Confirm **tenant isolation** intact on the recovered node (RLS FORCE on every tenant-scoped table; no
  cross-tenant leakage on a spot check).
- Confirm the **audit hash-chain is gap-free** on the recovered node (`count == max(seq)` per scope) — the
  tamper-evident spine must survive failover intact.
- Confirm application starts as the non-owner `finapp_app` role and a canary maker action produces its audit +
  outbox entries.

## 6. Current status

**BLOCKED.** No second host and no Backblaze B2 bucket/key are provisioned; region residency under the Kenya DPA
is an outstanding Legal/Risk/Technology ruling. Inputs required **after** management purchase (out-of-band, never
committed): standby Contabo VPS + replication credentials; B2 account + write-only key + Legal-approved region +
Object-Lock retention window; backup encryption key custody (tied to OpenBao once approved); a named COO/Ops
owner for RTO/RPO acceptance. `dr_failover_failback_drill` stays `requires_review`. G2 is a non-waivable
release-blocking gate (ADR-133).

## 7. COO acceptance

The COO (with Ops) accepts the cross-host DR drill against OQ#13 targets **only after** a genuinely separate
standby + off-server immutable copy exist and the drill above passes with independent DR assurance. This section
is completed by the COO **only after** that evidence exists — not from Tier-1 single-host evidence.

- COO (name): ______________________  Signature: ______________________  Date: __________
- CTO / execution owner (name): ______________________  Signature: ______________________  Date: __________
- Auditor / Risk assurance (name): ______________________  Signature: ______________________  Date: __________

---

**Governance: M42 NO_GO; Stage-7 unchanged; no production action.**
