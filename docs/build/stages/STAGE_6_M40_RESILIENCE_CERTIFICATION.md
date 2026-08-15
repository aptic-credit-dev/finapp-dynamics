# Stage 6G — M40 Resilience — Certification

**Module:** `m40-resilience` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-15. **Eleventh Stage-6 module certified; first Stage-6G module.**
**ADR:** ADR-127 (an offline client can never finalize a controlled action offline — online re-validation required, DB-enforced; observability is OPERATIONAL only, not a second M32 analytics engine nor the M03 audit spine; backup/restore/failover EXECUTION is framework-only behind a fail-closed port and restore/failover is human maker-checker + terminal-immutable; backup/DR schedules compose M06/M38, no second scheduler; RTO/RPO are integer seconds — no float; not a secrets manager — opaque `secretref:` only; `resilience.*` closes GAP-4 and `/api/v1/resilience` closes GAP-2; `resilience_*` prefix).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #103 — merged → `main` `251a934` (m40 `approved_for_build`) |
| Implementation PR | #104 — closed, merged, merged_at `2026-08-15T10:14:45Z` |
| Reviewed implementation head | `1a462bf` |
| Implementation merge SHA | `57943b0dad288e9c6e5ea5b96e00340ed7026e10` (single parent `251a934` = squash) |
| Tree equivalence | `git diff 1a462bf 57943b0` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `57943b0dad288e9c6e5ea5b96e00340ed7026e10` |
| Certification branch | `cert/stage-6-m40-resilience` (from `57943b0`) |
| Implementation CI (reviewed head `1a462bf`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m40-resilience` · Stage 6G · **Mobile / Offline / Observability / Backup / Business Continuity** · **mvp:false** ·
**`/api/v1/resilience`** · `resilience.*` permissions · audit prefix **`RESILIENCE_`** · event families **`mobile.lifecycle` +
`backup.lifecycle` + `dr.lifecycle`** · one m06 outbox · M40 owns mobile-device registrations, the offline queue + sync
evidence, operational observability, backup policies + evidence, restore/failover requests + evidence, and DR/BC plans + drill
evidence · **M40 owns NO scheduler (composes m06/m38 by opaque ref), NO analytics engine (m32 authoritative), NO audit spine
(m03 authoritative), NO secrets manager (m30 secretref seam; m41 deferred) and NO finance/accounting** · uses the **`resilience_`**
table prefix (no collision with any prior module) · `reference_tables` **20 → 13** governed core.

## C. Local certification gates (clean checkout on baseline `57943b0`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| format:check | pass (all matched files use Prettier code style) |
| lint | **0 errors** (68 pre-existing baseline warnings; m40 adds none) |
| build (`tsc --build`) | pass |
| smoke lane | 45 suites, **7553** assertions, 0 failures (m40-resilience **102** · conformance **3796**) |
| fresh migration replay | **78** migrations applied (m40 = 2; no historical migration edited) |
| — m40 checksums | `0001_resilience.sql` `63bcbc8251cb` · `0002_grant_application_role.sql` `8e3321a0b221` |
| DB/API lane (fresh DB) | **93** specs, **2824** assertions, 0 failures |
| — `m40-resilience` DB spec | 32 |
| — `m40-services` DB spec | 17 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 lanes on the reviewed head `1a462bf` and this cert PR's lanes are the authoritative PG16 evidence. A DB re-run against
a **non-fresh** DB trips the known identity/auth pollution specs (login/session uniqueness) — not an M40 defect; the fresh-DB
run is 93/2824/0-fail.

## D. Database — live catalogue evidence (m40-owned 13 resilience_ tables, non-owner application role)

13 tables · **13/13 RLS ENABLE + FORCE · 13/13 `tenant_isolation`** · **4 composite tenant-safe FKs · 0 unsafe single-column
tenant FKs** · **0 DELETE grants** · 7 append-only ledgers (INSERT+SELECT, **0 UPDATE**: `resilience_offline_evidence`,
`resilience_health_signal`, `resilience_backup_run`, `resilience_dr_test`, `resilience_review`, `resilience_history`,
`resilience_idempotency`) · 6 mutable aggregates (INSERT+SELECT+UPDATE: `resilience_device`, `resilience_offline_request`,
`resilience_check`, `resilience_backup_policy`, `resilience_restore_request`, `resilience_dr_plan`) · **43 governance CHECK
constraints** · 6 version columns · **0 float** (RTO/RPO/retention/latency/size are integer/bigint) · **0 secret-value/token
columns** (2 opaque `config_secret_ref` pointers with a `secretref:` shape CHECK) · **1 immutability trigger**
(`resilience_restore_immutable_trg`) · **1 outbox (m06 `workflow_event_outbox` — m40 owns none)** · 12 `resilience.*` permissions
(**2 privileged**, all 3-segment, no wildcard) · 20 `RESILIENCE_` audit codes · `mobile/backup/dr.lifecycle` (8 event types) ·
**78 total migrations**. reference_tables reconciled **20 → 13** (documented).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **Offline controlled-action safety (load-bearing)** — a CONTROLLED `resilience_offline_request` reaches `sync_state='applied'` **only when `validated_online`** (the `resilience_offline_request_finalize_ck` DB CHECK — proven live: a direct `UPDATE ... applied, validated_online=false` is rejected); the service additionally requires the **current online actor to hold the required permission** (a fresh RBAC re-validation, never a cached result), an **authoritative downstream reference** the owning module produced (M40 never manufactures it), and **no expiry**. Proven in the services spec: no-revalidation ⇒ rejected (`offline_finalization_blocked`); missing permission ⇒ rejected (`offline_rbac_revalidation_failed`); re-validated + permission held ⇒ applied; a non-controlled request applies. Reconnect never auto-finalizes; a stale/cached authorization is insufficient; cross-tenant requests are invisible (RLS) | **PASS** |
| **Offline sync idempotency / concurrency** — `resilience_offline_request.request_key` is UNIQUE per tenant (a logical operation is queued once); version CAS guards each finalize (a stale local version is rejected); a controlled finalize records exactly one authoritative `downstream_ref`; evidence is append-only | **PASS** |
| **Mobile/device governance** — `resilience_device` holds bounded metadata (device_key/platform/app_version/trust_state/last_sync) — **no biometric templates, tokens, refresh tokens, credentials or device secrets** (0 token columns); register/revoke are audited (RESILIENCE_DEVICE_REGISTERED/REVOKED); a cross-tenant device is invisible (RLS) | **PASS** |
| **Observability / M32 boundary** — M40 persists only bounded OPERATIONAL signals (`resilience_health_signal`: component/state/integer-latency/result-code/OPAQUE evidence ref) + check definitions; it is **not** a business-analytics/KPI/query engine (m32 authoritative) and **not** the audit/log store (m03 authoritative); no raw log body/payload/PII/secret; M40 source imports no m32 | **PASS** |
| **Backup/DR execution framework-only** — execution is behind a fail-closed `BackupExecutorPort`; the default `UnavailableBackupExecutor` yields a durable **BLOCKED** result (proven live for both a backup run and a failover execute); the semantic scan finds **zero** `eval`/`child_process`/shell/`pg_dump`/`pg_restore`/arbitrary-SQL/filesystem/network execution (the only `shell`/`pg_dump` occurrences are documentation prose describing what M40 refuses); no production executor/provider | **PASS** |
| **Restore/failover maker-checker** — a restore/failover is privileged (`resilience.restore.approve`) + maker-checker/SoD: `resilience_restore_request` `approved_by <> requested_by` CHECK + `isHumanActor` (null/blank/`system`/`ai`/`automation` refused); proven live: self-approval + AI refused, an independent human approves; a pre-check (approved state) is required before execute; version CAS rejects stale writes; a **terminal (executed/rejected) decision is IMMUTABLE** (`resilience_restore_immutable_trg`, proven live); the unavailable executor fails closed to `blocked` | **PASS** |
| **M06/M38 scheduler boundary** — M40 stores only OPAQUE `schedule_ref` metadata; there is **no** cron/scheduler/timer engine, no timer dispatcher, no generic scheduler table — backup/DR schedules compose M06 timers / M38 automation by contract; M40 owns no outbox | **PASS** |
| **Secret boundary** — the 2 `config_secret_ref` columns are opaque `secretref:` pointers (shape CHECK); **0 secret-value/token columns**; no password/API-key/refresh-token/private-key column; no secret in audit/events; m41 deferred; no second secrets manager | **PASS** |
| **Permissions** — `resilience.*`, 12 codes all 3-segment, 2 privileged (`restore.approve`, `control.administer`); no `resilience.admin`/wildcard; default deny; platform-scope backup/DR policies require `resilience.control.administer`; API `@Endpoint` + in-service authorization both enforce | **PASS** |
| **Audit** — `RESILIENCE_`, 20 codes; source↔registry parity **20/20**; `registered_code_count` **943** = len(codes); no code carries another module's prefix; payloads carry ids/states/reason codes + bounded durations only — no secret/token/raw offline payload/backup content/log | **PASS** |
| **Events / outbox** — `mobile.lifecycle` (4) + `backup.lifecycle` (2) + `dr.lifecycle` (2) = 8 types, registered once (m40-owned, newest tail), privacy-safe payloads; one m06 outbox (m40 owns none); no fake business-domain events | **PASS** |
| **RTO/RPO / numeric safety** — RTO/RPO/retention/latency/recovery-seconds/size are integer/bigint with `>= 0` CHECKs; **0 float**; no money/finance structure | **PASS** |
| **Backup/DR evidence** — `resilience_backup_run` + `resilience_dr_test` are append-only bounded metadata (policy/run/target refs, timestamps, result, size, checksum ref, reason code, measured recovery seconds); no raw backup data, no unbounded log/stack trace | **PASS** |
| **Tenancy / privacy** — 13/13 FORCE RLS; tenant A cannot read tenant B device/offline-queue/observability/backup evidence (proven); a tenant cannot alter platform-scope backup/DR control without the control-plane permission; cross-tenant refs fail closed | **PASS** |
| **No REST bypass** — every mutating `/api/v1/resilience` route authorizes a `resilience.*` permission + carries an auditCode via `@Endpoint` (**14 guarded routes** across 2 controllers); no route accepts a shell/script/SQL/backup command; the restore/failover route records + governs intent (the controlled executor path stays behind the fail-closed port + approval) | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 78) · tables 13 · FORCE RLS 13 · policies 13 · composite FKs 4 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 7 (0 UPDATE) · mutable aggregates 6 · governance CHECKs 43 · version columns 6 · float 0 · secret-value/
token columns 0 · opaque secretref pointers 2 · immutability triggers 1 · permissions 12 (privileged 2) · audit codes 20
(registry 943) · event families 3 (`mobile/backup/dr.lifecycle`, 8 types) · outboxes 1 (m06) · routes `/api/v1/resilience` (14
guarded) · smoke 7553/45 · conformance 3796 · DB/API 2824/93 (m40-resilience 32 · m40-services 17).

## Contamination — CLEAN

Only `packages/m40-resilience/*` + the `mobile/backup/dr.lifecycle` contracts families + `apps/api/src/resilience/*` + the
contracts event wiring + the `m02-identity` family-count smoke assertion + registries/manifests/docs + root/api `tsconfig.json`
+ `package-lock.json` were added on the implementation branch. **m01–m39 source untouched** (m06 outbox + m30 secretref seam +
m38 automation consumed by contract, not read/modified; m40 owns no outbox; no `workflow_*`/`connector_*`/`marketplace_*`/
`devportal_*`/`webhook_*`/`govrelease_*`/`automation_*`/`saas_*` prefix collision — m40 uses `resilience_*`); no m41+
implementation; no second RBAC/audit/workflow/timer/scheduler/outbox/notification/analytics engine; no secrets manager; no
finance/accounting; no arbitrary-execution engine; no production infrastructure/network executor; no historical migration
edited; no permission/RLS bypass.

## Documented limitations

- `mvp:false`. reference_tables reconciled **20 → 13** — the governed resilience core.
- Backup/restore/failover EXECUTION is a fail-closed port (`UnavailableBackupExecutor` ⇒ durable BLOCKED); the real executors
  (behind the port and, for restore/failover, human maker-checker approval) drop in unchanged. The M30 real secret backend
  (M41) is deferred behind the `secretref:` seam.
- Device trust is registered on enrolment (a richer device-attestation/trust workflow can drop in later behind the same state
  machine).
- Security/secrets (m41) and certification (m42) are deferred (not this module).

## Report path

`docs/build/stages/STAGE_6_M40_RESILIENCE_CERTIFICATION.md` (this file); implementation evidence lives in PR #104.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
