# DR Tooling (Aptic Dynamics — Stage-7)

Executable assets for the approved DR architecture: **Contabo primary → warm standby (2nd Contabo VPS, different
DC) → immutable Backblaze B2 (Object Lock/WORM) PITR** (RPO ≤ 5 min / RTO ≤ 15 min). See
`docs/03-platform/STAGE_7_OFFSERVER_DR_ARCHITECTURE_DECISION.md`. **No endpoint, bucket, account id, application
key, passphrase, or retention value is committed** — all come from the host env (`env.dr.example` → `.env.dr`) or a
root-only file. Nothing here transitions `dr_failover_failback_drill` or issues a GO.

## HA vs DR vs Backup vs PITR (kept distinct)
- **PITR** (`postgresql.replication.conf.example` archiving + `restore-pitr.sh`) → bounds **RPO**.
- **Warm standby** (`standby-bootstrap.sh` + streaming) → bounds **RTO** on primary loss.
- **Immutable off-provider backup** (`pgbackrest.conf.example` + `backup.sh` → B2 WORM) → durability/ransomware defence.
- A daily dump alone is **not** DR (RPO ≈ 24h).

## Files
| File | Purpose |
| --- | --- |
| `postgresql.replication.conf.example` | Primary WAL/archiving/replication settings (RPO ≤ 5 min) |
| `pgbackrest.conf.example` | pgBackRest → B2 (encrypted, WORM retention); opaque env creds |
| `backup.sh` | stanza-create + check + full/diff/incr backup (fail-closed on missing creds) |
| `standby-bootstrap.sh` | Restore + configure the warm standby, streaming from the primary via a slot |
| `restore-pitr.sh` | Point-in-time / latest restore for rehearsal and real recovery |
| `failover.sh` | Guided failover (promote) + failback (rebuild/switchover) runbook commands |
| `dr-healthcheck.sh` | Replication lag, WAL archive, backup-age checks (alerting) |
| `env.dr.example` | Placeholder env (copy to `.env.dr`; never commit real values) |

## Order of operations (once the standby + B2 exist)
1. On the **primary**: merge `postgresql.replication.conf.example`; create the replication user + slot; place
   `pgbackrest.conf` (from the example + env); `./backup.sh full`.
2. On the **standby**: `./standby-bootstrap.sh` → start PostgreSQL → confirm streaming with `./dr-healthcheck.sh`.
3. **Rehearse** DR: `./restore-pitr.sh "<time>"` into a throwaway target; reconcile; then a full
   `failover.sh promote` + `reconcile` + failback — produces the `dr_failover_failback_drill` **evidence** (Tier-1).
4. **Tier-2**: independent DR assurance + **COO/Ops acceptance** of the measured RTO/RPO. Not satisfiable here.

## Blocked on (out-of-band; not creatable here)
2nd Contabo VPS (different DC), Backblaze B2 account + **write-only** key + **Object-Lock** bucket, DPA region
ruling, backup-encryption passphrase custody. See `STAGE_7_MANAGEMENT_PURCHASE_SHEET.md`.
