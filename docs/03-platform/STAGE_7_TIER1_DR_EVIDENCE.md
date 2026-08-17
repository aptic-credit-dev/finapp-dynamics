# Stage 7 — Tier-1 Automated DR Drill Evidence

> **`TIER-1 AUTOMATED DR DRILL — NON-PRODUCTION — NOT INDEPENDENT DR ASSURANCE.`**
> Under ADR-131 (ACCEPTED), ADR-127 carve-out. This is Tier-1 automated execution + evidence. It is **not**
> independent DR assurance, **not** COO/Operations acceptance, **not** production DR certification, **not**
> production GO. `dr_failover_failback_drill` remains `requires_review`; production readiness remains `CONDITIONAL_GO`.

## Executor (staging-only, ADR-safe)

`deploy/staging/backup-executor.mjs` — `StagingBackupExecutor`, mirroring the canonical M40 `BackupExecutorPort`
(`ExecutionOutcome {executed, reasonCode, evidenceRef?, sizeBytes?}`):

- **Fail-closed:** disabled unless `STAGING_DR_EXECUTOR_ENABLED=1` **and** `NODE_ENV != production`; the default
  outcome is `executor_unavailable` (BLOCKED).
- **Refuses production** (`NODE_ENV=production` ⇒ blocked).
- **pg-library ONLY:** no shell, no `pg_dump`/`pg_restore`, no `child_process`, no OS command, **no filesystem raw
  dump** (manifest is in-memory), no network beyond the pg connection.
- **No injection:** table names from a **fixed whitelist** re-validated `^[a-z_][a-z0-9_]*$`; column names
  validated; all values **parameterized** (`$1..$n`); target DB identifier validated.
- The outcome carries only opaque refs + size — **never raw data, never a secret**.

### Safety self-test (`dr-selftest.mjs`) — 14/14 PASS
production refusal (flag + runBackup + runRestore blocked) · disabled-by-default blocks · rejects 10 unsafe
identifiers / accepts safe ones / whitelist all safe · checksum deterministic + verify + **tamper detected** ·
typed blocked reasons for missing source / missing target+manifest · fail-closed default always blocks.

## DR drill (`dr-drill.mjs`) — executed against a real PostgreSQL

The 14-step drill ran end-to-end (`critical_failures=0`, exit 0):

| Step | Result |
| --- | --- |
| executor enabled | PASS |
| readiness (source) | PASS — 82 migrations |
| baseline control totals | `{tenants:2, identities:2, grants:1, migrations:82, force_rls:506}` |
| backup executed | PASS — `staging-backup:28d25b821e7b8c51`, size 12561 B, **83 ms** |
| checksum verified | PASS — `28d25b821e7b8c51` |
| recovery target clean | PASS — `finapp_dr_target` created |
| target schema migrated (in-process) | PASS — applied 82 |
| restore executed | PASS — 5 rows (`restored_staging`), **226 ms** |
| target migrations match | PASS — 82 vs 82 |
| target FORCE-RLS match | PASS — 506 vs 506 |
| reconcile control totals | PASS — tenants 2/2, identities 2/2, grants 1/1 |
| failover to recovered | PASS — active=target, force_rls=506 |
| failover HTTP health/auth/isolation | **SKIPPED** — no running server (app-level covered by the DB/API integration lane) |
| failback reconcile | PASS — source unchanged |
| RTO/RPO measured | **RTO=309 ms** (backup 83 + restore 226); **RPO=0 s** |

## RTO/RPO treatment

- Measured **RTO = 309 ms**; observed **RPO = 0 s** (the logical restore of deterministic synthetic data is exact).
- Acceptance vs an approved target is **`PENDING OQ#13 / HUMAN-APPROVED RTO-RPO TARGET`** — the repository holds no
  approved RTO/RPO thresholds; none were invented.

## Reconciliation

Deterministic synthetic control totals reconciled source↔restored: tenants (2), identities (2),
platform_role_assignments (1); migration count (82) and FORCE-RLS table count (506) matched. No business
reconciliations beyond the synthetic staging data were fabricated.

## Evidence metadata

- Assessed commit: `a4275521` (merged main; branch adds only `deploy/staging/*` + this evidence).
- Environment: local throwaway **PostgreSQL 15.2** (source `finapp_dr_source` + recovery `finapp_dr_target`).
- Executor config: `StagingBackupExecutor`, `STAGING_DR_EXECUTOR_ENABLED=1`, `NODE_ENV=staging`, pg-library only.
- Backup ref `staging-backup:28d25b821e7b8c51`; checksum `28d25b821e7b8c51…`; backup 83 ms; restore 226 ms;
  RTO 309 ms; RPO 0 s.
- No raw credentials or backup contents committed (manifest in-memory; evidence holds refs/counts only).
- For M42, recorded as an **opaque reference** to a Tier-1 DR drill — never independent DR assurance.

## Known limitations (honest — strict per the DR increment guidance)

- **The full staging stack (Docker `postgres:16` + the running API) was NOT booted** — Docker daemon is down on
  this box. The DR **procedure** (backup → clean target → in-process migrate → restore → reconcile →
  failover/failback → RTO/RPO) **did execute and pass against a real local PostgreSQL**, but **not** against the
  containerised PG16 staging environment.
- **App-level failover health / auth / tenant-isolation checks were SKIPPED** (no running server); they are covered
  by the in-process DB/API integration lane (`api-auth`/`api-identity`/`api-rbac`).
- Local box is **PG15.2**; the staging/CI target is **PG16**.
- This is Tier-1 only. **Tier-2 independent DR assurance + COO/Operations acceptance are not claimed.**

## Remaining Tier-2 gates (unchanged)
Independent DR assurance + COO/Operations acceptance · approved RTO/RPO targets (OQ#13) · the full staging-stack
drill on a Docker-enabled PG16 target · governed production DR certification and GO (M42).
