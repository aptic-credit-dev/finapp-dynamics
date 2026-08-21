# Stage 7 — Infrastructure Provisioning Spec (executable buy/provision sheet)

> Exact minimum specifications for the external resources management must procure so engineering can complete
> Stage-7 commissioning. Complements `STAGE_7_MANAGEMENT_PURCHASE_SHEET.md` (the one-line index) with per-item
> detail. **No passwords, tokens, keys, or secret values appear here.** All credentials are delivered out-of-band.
> Nothing here is a Tier-2 acceptance or a production GO.

---

## A. OpenBao host (secrets backend — ADR-132)

| Attribute | Minimum spec |
| --- | --- |
| Purpose | Self-hosted OpenBao behind M41 `SecretProviderPort` (adapter proven; see live-readiness evidence) |
| Sizing (staging) | 2 vCPU / 4 GB RAM / 20 GB SSD |
| Sizing (production) | **3 nodes** (Raft quorum HA), each 2–4 vCPU / 8 GB RAM / 40 GB SSD |
| OS | Ubuntu 24.04 LTS |
| Network exposure | **Private network only**; no public listener; reachable by the API host + named operators only; deny-by-default firewall |
| Dedicated VPS? | **Yes** — separate host/VM from the application DB (blast-radius isolation) |
| TLS / domain | Server TLS cert + key + CA (internal PKI or issued); internal DNS name (no public domain required) |
| Delivered to engineering (out-of-band) | Host SSH; reachable `https://` URL; TLS CA PEM; AppRole `RoleID` + wrapped `SecretID` (from `deploy/openbao/setup.sh`) |
| Blocks Stage-7? | Yes (staging binding) · Blocks GO? Yes |

## B. DR standby VPS (warm standby — RTO ≤ 15 min)

| Attribute | Minimum spec |
| --- | --- |
| Purpose | PostgreSQL 16 warm standby (streaming replication) for failover |
| Sizing | **≥ the primary** (match vCPU/RAM; disk ≥ primary data size + WAL headroom) |
| Location | **Different Contabo datacentre / failure domain** than the primary (`vmi3515072`); DPA-approved region |
| PostgreSQL | 16.x (match the primary minor where possible) |
| Replication role | Async streaming standby + WAL replay; promotable on failover |
| Delivered to engineering (out-of-band) | Host SSH; a `replicator` replication role credential; private network path to the primary |
| Blocks Stage-7? | No (staging works single-node) · Blocks GO? Yes |

## C. Backblaze B2 (immutable off-provider backup)

| Attribute | Minimum spec |
| --- | --- |
| Purpose | Immutable off-provider PITR store (pgBackRest + OpenBao snapshots) |
| Bucket | Dedicated backup bucket; **Object Lock (WORM) enabled** (compliance/governance mode) |
| Retention | ≥ backup retention window (e.g. 4 full + WAL); lock window ≥ retention |
| Region | S3-compatible endpoint in a **Legal/Kenya-DPA-approved** region |
| Encryption | Client-side (pgBackRest `aes-256-cbc`) **before** upload — store never holds plaintext |
| Access key | **Write-only / append-only** application key scoped to the one bucket — `PutObject`(+multipart) only, **no** delete / no cross-bucket list |
| Restore access | A **separate** read-capable key (or time-boxed elevation) used only during a restore/DR drill — never the backup writer |
| Delivered to engineering (out-of-band) | Endpoint + region + bucket name; write-only key id + secret; the backup-encryption passphrase (custody tied to OpenBao) |
| Blocks Stage-7? | No · Blocks GO? Yes |

## D. External penetration test

| Attribute | Requirement |
| --- | --- |
| Provider | Independent external firm under NDA + Conflict-of-Interest declaration (not engineering/AI) |
| Scope | The staging stack (Contabo, PG16, ≥2 synthetic tenants): auth/session/CSRF, RBAC, tenant isolation (RLS), maker-checker/SoD, the API surface, secrets boundary, infra hardening (SSH/firewall/TLS) |
| Target | Staging endpoint/IP provided at engagement (synthetic data only) |
| Exclusions | No destructive/DoS tests against shared infra; no social engineering unless separately scoped; no production |
| Severity rubric | CVSS-scored; mapped to M42 severities |
| Release-blocking threshold | No open Critical/High (or agreed BLOCKER) at GO; all such findings remediated + **retested** |
| Evidence | Independent report (findings, CVSS, repro, remediation status) + retest attestation |
| Blocks Stage-7? | Yes (`penetration_test` exit) · Blocks GO? Yes |

## E. Pilot migration source (OQ#14)

| Attribute | Requirement |
| --- | --- |
| Pilot tenant | The named first production tenant |
| Source system | The named system of record + access method (read-only extract/API/DB) |
| Data scope | Entities in scope for the pilot migration + expected control totals (counts/sums) for reconciliation |
| Legal basis | Kenya-DPA basis + residency confirmation for the pilot data (Legal) |
| Sign-off authorities | Appointed **CFO** (reconciliation) + **Legal** (basis/residency) + **business owner** (data) |
| Delivered to engineering (out-of-band) | Source access/extract + field mapping inputs (no secrets in Git) |
| Blocks Stage-7? | **Yes** (migration entry gate) · Blocks GO? Yes |

## Boundary
Engineering can implement/stage-test each item the moment its access exists (the OpenBao adapter and DR mechanics
are already proven in staging). **Claude/engineering signs no acceptance and issues no GO.** Every Tier-2 acceptance
and the M42 GO are human/external.
