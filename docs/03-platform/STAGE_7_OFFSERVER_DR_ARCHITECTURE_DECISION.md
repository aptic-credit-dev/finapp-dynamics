# Stage 7 — Off-Server Backup / DR Architecture DECISION (Contabo primary)

> Converts the merged `STAGE_7_OFFSERVER_BACKUP_DR_DECISION_PACKAGE.md` **recommendation** into a **chosen**
> architecture for management ratification, per the direction: primary Contabo VPS → **warm standby on a second
> Contabo VPS in a different failure domain** → **immutable off-provider S3 object storage**. It targets the
> approved **RTO ≤ 15 min / RPO ≤ 5 min** (OQ#13). **It creates no account, bucket, credential, or region and
> fabricates nothing**; region confirmation under the Kenya DPA is a Legal/Risk/Technology decision. No GO.

---

## 1. Four terms kept distinct (a backup is NOT DR)

| Term | Question it answers | In this design |
| --- | --- | --- |
| **HA** (high availability) | survive a *node/process* failure with ~no downtime | 3-node quorum where used (OpenBao Raft); the app is stateless behind a proxy; **the single PG primary is not HA by itself** — the standby (below) provides failover, not instantaneous HA |
| **DR** (disaster recovery) | survive *loss of the whole primary host/site* | **promote the warm standby** (different failure domain) within RTO ≤ 15 min |
| **Backup** | restore from a point-in-time *copy* after corruption/ransomware/mistake | nightly `pg_dump -Fc` (kept) **+** immutable base backups in off-provider WORM storage |
| **PITR** (point-in-time recovery) | roll forward to *any* moment, bounding data loss | **continuous WAL archiving** (`archive_timeout ≤ 60 s`) → RPO ≤ 5 min |

**Consequence:** meeting RTO ≤ 15 / RPO ≤ 5 needs **replication/WAL (RPO), a warm standby (RTO), and an immutable
off-provider copy (durability)** — no single one suffices. A daily dump alone is RPO ≈ 24 h and is **not** DR.

## 2. Chosen architecture (three layers)

```
  Contabo Primary VPS (finapp prod DB, PG16)  ── failure domain A
   │  ├─ continuous WAL archiving (archive_timeout ≤ 60s)            ── PITR / RPO ≤ 5 min
   │  ├─ nightly pg_dump -Fc + SHA-256 + restore-verify (kept)      ── logical backup
   │
   ├──(streaming replication + WAL)──▶ Contabo Standby VPS ── failure domain B (different DC/region)
   │                                    • warm standby; promote on primary loss ── DR / RTO ≤ 15 min
   │
   └──(pgBackRest/wal-g, client-side encrypted)──▶ S3-compatible object store (off-provider)
                                                    • base + WAL, PITR to ≤ 5 min
                                                    • Object Lock (WORM) retention          ── ransomware/insider defence
                                                    • write-only/append-only key             ── least privilege
                                                    • region: Legal-approved (Kenya DPA)     ── residency
```

- **Layer 1 — PostgreSQL replication/WAL (RPO):** streaming replication to the standby **plus** continuous WAL
  archiving with `archive_timeout ≤ 60 s`. Base backups + WAL managed by **pgBackRest** (or `wal-g`), scheduled
  (e.g. weekly full + daily differential + continuous WAL).
- **Layer 2 — Warm standby (RTO):** a second Contabo VPS in a **different datacentre/failure domain** (see §4),
  kept current by replication; **promote** on primary loss. This is the DR failover target for the drill.
- **Layer 3 — Immutable off-provider copy (durability/tamper-resistance):** pgBackRest base+WAL pushed to an
  **S3-compatible object store on a different provider** (see §5), **client-side encrypted before upload**, under
  **Object Lock (WORM)**, with a **write-only** key. This survives a Contabo-account compromise or provider outage.

## 3. Requirement → mechanism map

| # | Requirement | Mechanism | Target |
| --- | --- | --- | --- |
| R1 | RPO ≤ 5 min | streaming replication + WAL archive (`archive_timeout ≤ 60 s`) | ≤ 5 min data loss |
| R2 | RTO ≤ 15 min | promote warm standby (rehearsed) | ≤ 15 min |
| R3 | Encryption | TLS in transit + **client-side backup encryption** at rest (pgBackRest cipher / age) | plaintext never leaves host |
| R4 | Immutability | Object Lock (compliance mode), retention ≥ backup retention | WORM |
| R5 | Separation | standby in different Contabo DC **and** copy on a different provider | 2 independent failure domains |
| R6 | Residency (Kenya DPA) | object-store + standby regions confirmed by Legal/Risk/Tech before real data | approved region |
| R7 | Restore testing | automated restore-verify + full promote-standby rehearsal (DR drill) | measured RTO/RPO |
| R8 | Least privilege | write-only/append-only backup key scoped to one bucket; no delete/read of others | can't tamper/exfiltrate |

## 4. Secondary location (recommendation — no region invented)

- **Requirement:** the standby VPS must sit in a **different Contabo datacentre / failure domain** from the primary
  so a single-site incident does not take both. The primary is the current Contabo VPS (`vmi3515072`,
  `169.58.194.151`); its **exact datacentre/region is a fact to read from the Contabo control panel** (a management
  input — **not** invented here).
- **Recommendation:** provision the standby in a **different Contabo region than the primary's** (e.g. if the
  primary is EU, place the standby in another Contabo region/DC), subject to the **Kenya DPA residency** ruling for
  production data (Legal/Risk/Technology). If DPA requires a specific jurisdiction, that constraint **overrides**
  raw geographic separation and must be satisfied first. **Required characteristics** (in priority order): (1) DPA-
  compliant residency; (2) different physical DC/failure domain than the primary; (3) low replication latency to the
  primary; (4) equal-or-greater sizing than the primary.
- **This is a purchase decision.** No standby is created here; the characteristics above are the buy spec.

## 5. Object-storage provider (selection)

| Option | S3 API | Object Lock (WORM) | Versioning | Separation from Contabo | Cost / egress | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Backblaze B2** | ✅ S3-compatible | ✅ Object Lock | ✅ | ✅ different provider | ✅ low, cheap/free egress within limits | **Preferred** |
| Wasabi | ✅ | ✅ | ✅ | ✅ different provider | ✅ flat, no egress fee (min-retention terms) | Strong alternative |
| Contabo Object Storage | ✅ | ⚠️ limited/varies | ~ | ❌ **same provider** (correlated) | ✅ cheap | Rejected for the immutable copy (shares Contabo failure domain) |
| Self-hosted MinIO | ✅ | ✅ (MinIO WORM) | ✅ | only if truly separate infra | you run it (ops burden) | Fallback if a managed store is disallowed |

- **Selected: Backblaze B2** for the immutable off-provider copy — S3-compatible (pgBackRest/wal-g work
  unchanged), native **Object Lock** for WORM retention, versioning, low cost, and a **different provider/failure
  domain** than Contabo (the point of Layer 3). **Wasabi** is an equally acceptable substitute if procurement
  prefers it. **Region must be Legal-approved under the Kenya DPA** before any production data.
- Credential posture: a **write-only / append-only application key scoped to the single backup bucket** —
  `PutObject`(+multipart) only, **no** `DeleteObject`, **no** cross-bucket `ListBucket`, **no** read of other data.
  Retention is enforced by **lifecycle + Object Lock**, not by a delete permission. **No account/key is created
  here.**

## 6. Failover / failback / switching

- **Failover (DR):** promote the standby (`pg_ctl promote` / patroni-style), repoint the app's `DATABASE_URL`
  (DNS/service switch), verify `/api/v1/health` + a canary write; measure RTO/RPO.
- **Failback:** rebuild the old primary as a standby from the promoted node (or from base+WAL), resync, then plan a
  controlled switchover back. Reconciliation (row counts / checksums) before declaring clean.
- **DNS/app switching:** low-TTL DNS or a reverse-proxy upstream flip; documented in the commissioning runbook.

## 7. Monitoring / alerting / credential isolation

- Alerts on: **replication lag** (RPO risk), **WAL archive failure**, **backup job failure**, **Object Lock/retention
  anomalies**, standby health, restore-verify failures.
- Backup, replication, and operator credentials are **separate identities** (SoD); the off-provider key is
  **write-only**; the OpenBao snapshot key is distinct again. No shared "admin" credential.

## 8. Credentials / inputs required AFTER approval (out-of-band; never committed)

1. Standby **Contabo VPS** (region per §4) + SSH/replication credentials.
2. **Backblaze B2** (or Wasabi) account + **write-only** key scoped to one bucket; **region confirmed under Kenya
   DPA**; Object-Lock retention window.
3. **Backup encryption key** custody (tied to OpenBao once approved).
4. COO/Ops owner for the **RTO/RPO rehearsal acceptance** (Tier-2).

## 9. What this establishes / does not establish

- **Establishes:** a chosen, HA/DR/backup/PITR-distinct architecture; a secondary-location buy spec; a selected
  object-storage provider (Backblaze B2) with least-privilege posture — enough for management to purchase.
- **Does NOT establish:** any account, bucket, credential, region approval, deployed backup, replication, or DR
  acceptance. Off-server DR stays **BLOCKED** pending management purchase + Legal residency ruling.
  `dr_failover_failback_drill` stays `requires_review`. No GO.
