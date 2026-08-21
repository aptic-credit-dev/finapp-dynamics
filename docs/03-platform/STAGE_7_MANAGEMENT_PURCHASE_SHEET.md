# Stage 7 — Management Purchase / Access Sheet

> The exact external resources management must now procure/provide so engineering can execute the remaining
> Stage-7 technical commissioning. **No passwords or secret values appear here.** Every credential is delivered
> **out-of-band** (never in Git, logs, or evidence). Nothing on this sheet is a Tier-2 acceptance or a production GO.

---

| # | Item | Minimum spec | Purpose | Access engineering needs (out-of-band) | Blocks Stage-7? | Blocks prod GO? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **OpenBao host** | 1 small VPS staging (2 vCPU/4 GB); **3 nodes** for prod HA; separate from the DB host; private network | Secrets backend behind M41 `SecretProviderPort` (ADR-132) | Host SSH; reachable URL; **TLS cert/key + CA** | Yes (secrets binding) | Yes |
| 2 | **OpenBao AppRole creds** | `RoleID` + **response-wrapped `SecretID`** from `deploy/openbao/setup.sh`; scoped `finapp-app` policy | Machine auth for the adapter | RoleID + wrapping token (unwrap once) | Yes | Yes |
| 3 | **2nd Contabo VPS (standby)** | ≥ primary sizing; **different Contabo DC/failure domain**; DPA-compliant region | Warm standby for DR (RTO ≤ 15 min) | Host SSH + replication user creds | No (staging works single-node) | Yes |
| 4 | **Backblaze B2 account + bucket** | S3-compatible; **Object Lock (WORM)** enabled; DPA-approved region | Immutable off-provider PITR backups | **Write-only** key id + app key; endpoint/region/bucket | No | Yes |
| 5 | **Backup encryption passphrase** | strong passphrase; custody tied to OpenBao | Client-side backup encryption (store never holds plaintext) | passphrase via root-only file (never committed) | No | Yes |
| 6 | **Approved region / data residency** | Legal/Risk/Technology ruling under **Kenya DPA** for #1/#3/#4 | Lawful production data location | written ruling (which regions are acceptable) | No | **Yes** (before any real data) |
| 7 | **Production domain + TLS** | prod DNS name + certificate | Production endpoint (443, prod guards) | DNS control + cert issuance | No | Yes |
| 8 | **External pentest provider** | independent firm; NDA + CoI; CVSS scoring | Independent security assurance (Tier-2) | engagement + RoE sign-off (`STAGE_7_PENTEST_HANDOFF.md`) | No | Yes |
| 9 | **Pilot tenant + migration source** | named pilot tenant + named source system (OQ#14) | Real-data migration (entry gate) | source access/extract + field mapping inputs | **Yes** (migration entry gate unmet) | Yes |

## Notes
- **Parallelizable purchases:** #1/#2 (secrets), #3/#4/#5 (DR), #8 (pentest), #9 (migration source) are independent.
- **Region ruling (#6) gates real production data** for the OpenBao, standby, and backup locations — resolve before
  any production commissioning.
- Engineering can implement/stage-test everything the moment each item's access exists; see
  `STAGE_7_PRODUCTION_COMMISSIONING_DEPENDENCY_MATRIX.md` for the critical path.
- **Claude/engineering signs no acceptance and issues no GO.** Every Tier-2 acceptance and the M42 GO are
  human/external.
