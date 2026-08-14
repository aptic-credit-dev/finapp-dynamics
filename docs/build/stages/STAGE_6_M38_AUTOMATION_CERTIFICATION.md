# Stage 6E — M38 Scheduler / Automation / Extensions — Certification

**Module:** `m38-automation` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-14. **Ninth Stage-6 module certified; first Stage-6E module.**
**ADR:** ADR-125 (M06 owns THE durable one-shot timer + SLA + workflow runtime + THE outbox; M38 owns recurring-schedule + automation DEFINITIONS and execution EVIDENCE and COMPOSES an M06 timer per occurrence through a fail-closed `TimerSchedulerPort`; a GOVERNED restricted recurrence parser — no OS cron/shell; steps/points reference REGISTERED capabilities only via a fail-closed `CapabilityInvokerPort` — no arbitrary/executable code; automation ORCHESTRATES while owning modules ENFORCE; activation + extension publish are human maker-checker/SoD controlled actions; not a secrets manager — opaque `secretref:` only; `automation.*`/`extensions.*` — no GAP-4; `automation_*`/`extension_*` prefixes).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #97 — merged → `main` `b3375ed` (m38 `approved_for_build`) |
| Implementation PR | #98 — closed, merged, merged_at `2026-08-14T09:22:43Z` |
| Reviewed implementation head | `f525cc3` |
| Implementation merge SHA | `925171044a63d499984f92c9b804ee793c376c87` (single parent `b3375ed` = squash) |
| Tree equivalence | `git diff f525cc3 9251710` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `925171044a63d499984f92c9b804ee793c376c87` |
| Certification branch | `cert/stage-6-m38-automation` (from `9251710`) |
| Implementation CI (reviewed head `f525cc3`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m38-automation` · Stage 6E · **Scheduler / Automation / Extension Framework** (recurring-schedule + automation
DEFINITIONS, execution EVIDENCE, and registered extension points over the platform) · **mvp:false** · **M06 owns THE durable
one-shot timer + SLA timers + the workflow runtime + THE outbox; M38 owns none of those** — it composes an M06 timer per
occurrence through a fail-closed `TimerSchedulerPort` and computes `next_run_at` with a GOVERNED restricted recurrence parser ·
**execution is FRAMEWORK-ONLY** through a fail-closed `CapabilityInvokerPort` (default Unavailable ⇒ a durable BLOCKED run) ·
**no arbitrary/executable code, no second timer/scheduler/workflow/outbox engine, no secrets manager** · **`/api/v1/automation`**
+ **`/api/v1/extensions`** · `automation.*` + `extensions.*` permissions · audit prefixes **`AUTOMATION_`** + **`EXTENSION_`** ·
event families `automation.lifecycle` + `extension.lifecycle` · one m06 outbox · consumes M06/M33/M30 by contract · uses the
**`automation_*`/`extension_*`** table prefixes (no collision with M06 `workflow_`, M33 `connector_`, M34 `marketplace_`, M35
`devportal_`, M36 `webhook_/eventstream_/events_`, M37 `govrelease_`) · M41 real secrets deferred behind a fail-closed port.

## C. Local certification gates (clean checkout on baseline `9251710`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| format:check | pass (all matched files use Prettier code style) |
| lint | **0 errors** (68 pre-existing baseline warnings; m38 adds none) |
| build (`tsc --build`) | pass |
| smoke lane | 43 suites, **7191** assertions, 0 failures (m38-automation **100** · conformance **3658**) |
| fresh migration replay | **74** migrations applied (m38 = 2; no historical migration edited) |
| — m38 checksums | `0001_automation.sql` `b402ddbe2cb3` · `0002_grant_application_role.sql` `60c9329e62cd` |
| DB/API lane (fresh DB) | **89** specs, **2715** assertions, 0 failures |
| — `m38-automation` DB spec | 37 |
| — `m38-services` DB spec | 23 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 DB lane on the reviewed head `f525cc3`, and this cert PR's lanes, are the authoritative PG16 evidence. A DB lane
re-run against a **non-fresh** DB trips 5 identity/auth specs (login-attempt/session uniqueness) — a known re-run-pollution
artifact, not an M38 defect; the fresh-DB run is 89/2715/0-fail.

## D. Database — live catalogue evidence (m38-owned 10 automation_*/extension_* tables, non-owner application role)

10 tables · **10/10 RLS ENABLE · 10/10 FORCE · 10/10 `tenant_isolation`** · **5 composite tenant-safe FKs · 0 unsafe
single-column tenant FKs** · **0 DELETE grants** · 6 append-only ledgers (INSERT+SELECT: `automation_step`, `automation_run`,
`automation_review`, `automation_history`, `automation_idempotency`, `extension_point`) · 4 mutable aggregates
(INSERT+SELECT+UPDATE: `automation_definition`, `automation_schedule`, `extension_definition`, `extension_installation`) · **31
governance CHECK constraints** · 4 version columns · **0 float** · **0 secret-value columns** (`automation_step.config_secret_ref`
is a `text` opaque pointer with a `secretref:` shape CHECK) · **2 immutability triggers** (`automation_definition_immutable_trg`
on an active definition, `extension_definition_immutable_trg` on a published extension) · **1 outbox (m06 `workflow_event_outbox`
— m38 owns none; 0 automation_/extension_ outbox/event tables)** · 9 permissions (3 privileged) · 20 audit codes · 2 event
families (8 types) · **74 total migrations**. reference_tables reconciled **44 → 10** (documented in module-registry +
implementation-manifest — the 44 was the full reference-implementation baseline, the largest 6-series; this Stage-6E core is the
governed scheduler/automation/extension framework).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **M06 timer/scheduler boundary (load-bearing)** — M06 owns THE durable one-shot timer (`workflow_timer`, present, m06-owned), SLA timers, the workflow runtime and THE outbox; M38 owns recurring-schedule + automation DEFINITIONS and execution EVIDENCE and composes an M06 timer per occurrence through `TimerSchedulerPort` (`EmptyTimerScheduler` fail-closed default). **0 M38 generic durable-timer/dispatcher/outbox table**, no second workflow runtime, no second outbox — every occurrence is scheduled through the canonical seam; an unavailable timer adapter fails closed | **PASS** |
| **Governed recurrence (no cron/shell)** — recurrence is a bounded expression (`hourly`/`daily`/`weekly`/`every:<seconds>`; `RECURRENCE_ALIASES` + `/^every:(\d{1,7})$/`); a 60-second frequency floor (`recurrence_frequency_too_high`) prevents a job storm; unsupported/malformed input yields `null` (no next run); `computeNextRun` is deterministic (`fromEpoch + interval`); **no OS cron, no shell, no `node-cron`/`crontab`** in source (proven in the smoke suite: cron `* * * * *` and `rm -rf /` both rejected) | **PASS** |
| **No arbitrary code (critical gate)** — a step/point references a REGISTERED capability by an OPAQUE ref + a required **3-segment M02 permission** (`screenSteps` + `automation_step_perm_ck`); execution is framework-only through `CapabilityInvokerPort` whose default `UnavailableCapabilityInvoker` yields a durable **BLOCKED** result; semantic scan finds **zero** `eval`/`Function`/`vm`/`child_process`/shell/arbitrary-SQL/dynamic-import/plugin-load; no network egress in m38 source | **PASS** |
| **Registered-capability boundary** — automation does not manufacture capabilities; a step carries an opaque capability ref + bounded input/reference metadata; M33/public catalogue integration is through a port/contract (no direct read of M33 private tables, no duplicate connector registry/runtime) | **PASS** |
| **Downstream-control preservation** — automation ORCHESTRATES only; owning modules ENFORCE. M38 source imports/executes no M21/M22 posting/approval, no M37 release, no consent service — it cannot auto-post, auto-release, auto-consent, or fabricate an approval/consent/release decision; where a downstream action requires prior approval it consumes the opaque approved reference; owning module stays authoritative | **PASS** |
| **Maker-checker / SoD; AI/system/automation cannot self-approve** — activation of an automation and publication of an extension require a HUMAN approver ≠ the requester (`evaluateActivationGate`/`evaluateSodGate` + DB SoD CHECKs); `isHumanActor` rejects null/blank/`system`/`ai`/`automation`; a validation/evidence requirement is enforced; stale-version writes rejected (optimistic CAS) — proven in the services DB spec (self / ai / default-deny refusals) | **PASS** |
| **Extensions framework boundary** — an extension is governed metadata + registered extension points with trust tiers (untrusted/verified/certified) + isolation levels (none/sandboxed/isolated); publication is maker-checker; a published extension is immutable (trigger); **no uploaded executable package, no dynamic code loading, no production plugin runtime** | **PASS** |
| **Not a secrets manager (M30 seam / M41 boundary)** — a step's secret-bearing config is an opaque `secretref:` pointer (`automation_step_secret_ref_ck`; `SECRET_REFERENCE_PATTERN`/`isSecretReference` reused from the m30 seam); **0 secret-value columns**; the unavailable secret resolver fails closed; real resolution deferred to M41; no second secrets manager | **PASS** |
| **Execution evidence / idempotency** — runs are append-only (`automation_run`, INSERT+SELECT); a deterministic run key + `automation_idempotency` unique key prevent duplicate logical execution; a repeated run key that already succeeded is idempotently refused (proven in the services DB spec); bounded retry (`max_retries` 0–8) + timeout; evidence carries a status + bounded reason code + opaque reference (no unrestricted downstream payload) | **PASS** |
| **Concurrency policy** — `automation_schedule.concurrency_policy` ∈ (allow, forbid, replace) with a CHECK; `missed_run_policy` ∈ (skip, run_once); version CAS resolves activation/update races to one valid winner | **PASS** |
| **Events / outbox** — `automation.lifecycle` (4 types) + `extension.lifecycle` (4 types) registered once (m38-owned, newest tail), privacy-safe payloads (ids/keys/versions/statuses/trust tiers/reason codes only — never a secret, executable content, a full downstream payload or personal data); one m06 outbox (m38 owns none); no fake downstream domain events | **PASS** |
| **Permissions** — `automation.*` (5) + `extensions.*` (4) = 9, all 3-segment, 3 privileged (`automation.job.activate`, `extensions.registry.publish`, `automation.control.administer`); no `automation.admin`/`extensions.admin`/wildcard; default deny; platform scope requires `automation.control.administer` (a request header/param grants no platform authority); API `@Endpoint` guards + in-service authorization both enforce | **PASS** |
| **Audit** — `AUTOMATION_` (12) + `EXTENSION_` (8) = 20 codes; source↔registry parity **20/20**; `registered_code_count` **901** = len(codes); no code carries another module's prefix; audit payloads carry no secret/execution-input/downstream-payload/credential | **PASS** |
| **Tenancy / privacy** — 10/10 FORCE RLS; tenant A cannot read tenant B automation/schedules/extensions; cross-tenant capability binding rejected; a tenant user cannot create platform automation without the control-plane permission; execution evidence respects RLS; no secret/payload leakage through API/errors/audit/events | **PASS** |
| **No REST bypass** — every mutating `/api/v1/automation` + `/api/v1/extensions` route authorizes a permission + carries an auditCode via `@Endpoint` (**14 guarded routes** across 2 controllers: 8 + 6); no route accepts executable-code submission; reads default-deny in-service | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 74) · tables 10 · FORCE RLS 10 · policies 10 · composite FKs 5 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 6 · mutable aggregates 4 · governance CHECKs 31 · version columns 4 · float 0 · secret-value columns 0 ·
secretref pointer columns 1 · immutability triggers 2 · permissions 9 (privileged 3) · audit codes 20 (registry 901) · event
families 2 (`automation.lifecycle` + `extension.lifecycle`, 8 types) · outboxes 1 (m06) · routes `/api/v1/automation` +
`/api/v1/extensions` (14 guarded) · smoke 7191/43 · conformance 3658 · DB/API 2715/89 (m38-automation 37 · m38-services 23).

## Contamination — CLEAN

Only `packages/m38-automation/*` + the `automation.lifecycle`/`extension.lifecycle` contracts families + `apps/api/src/automation/*`
+ the contracts event wiring (`events.ts`/`index.ts`/`contracts.smoke.ts`) + the `m02-identity` family-count smoke assertion +
registries/manifests/docs + root/api `tsconfig.json` + `package-lock.json` were added on the implementation branch.
**m01–m37 source untouched** (M06 timer + outbox and M33 catalogue consumed by contract, not read/modified — M38 owns no
timer/outbox/connector engine; no `workflow_*`/`connector_*`/`marketplace_*`/`devportal_*`/`webhook_*`/`eventstream_*`/`events_*`/
`govrelease_*` prefix collision — M38 uses `automation_*`/`extension_*`); no m39+/m41 implementation; no second
timer/scheduler/workflow/outbox/notification/webhook/connector/RBAC/audit/secrets engine; no arbitrary-code runner; no
production network/provider dependency; no historical migration edited; no permission/RLS bypass.

## Documented limitations

- `mvp:false`. reference_tables reconciled **44 → 10** — the governed scheduler/automation/extension core (largest 6-series
  baseline reconciliation).
- Execution is **FRAMEWORK-ONLY**: the `CapabilityInvokerPort` default `UnavailableCapabilityInvoker` yields a durable
  **BLOCKED** run, and the `TimerSchedulerPort` default `EmptyTimerScheduler` schedules no wake-up — the real capability
  invokers (dispatched through owning-module contracts) and the real M06 scheduler drop in behind the ports unchanged;
  documented honestly (no production capability execution or timer dispatch is claimed here).
- The M30 real secret backend (M41) is deferred behind a fail-closed port; a step config is an opaque `secretref:` pointer only.
- Commercial SaaS (m39), resilience (m40) and security/secrets (m41) are deferred (not this module). M39+ remain deferred.

## Report path

`docs/build/stages/STAGE_6_M38_AUTOMATION_CERTIFICATION.md` (this file); implementation evidence lives in PR #98.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
