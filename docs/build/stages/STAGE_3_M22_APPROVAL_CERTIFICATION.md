# Stage 3 — M22 Approval Workflow — Certification (CERTIFIED ON BRANCH)

**Module:** `m22-approval` · **Capability:** Finance Approval Workflow — maker-checker + Segregation of Duties
**Implementation PR:** #47 · **Reviewed head:** `dba234a` · **Merge SHA (squash):** `ec931e7` · **Date:** 2026-08-04
**Certification branch:** `cert/stage-3-m22-approval` (cut from merged `main` `ec931e7`)

## 1. Merge verification (authoritative)

- PR #47 — `state=closed`, `merged=true`, `merged_at=2026-08-04T09:50:19Z`.
- Squash merge commit **`ec931e7`** (1 parent `1b4ced1`); `origin/main` = `ec931e7` (contains the merge).
- **Tree equivalence:** `git diff dba234a ec931e7` is **empty** — the merged tree is byte-identical to the reviewed head.
- **Implementation CI** (run `30895571158`, head `dba234a`): **Smoke lane SUCCESS**, **PostgreSQL 16 DB lane SUCCESS**.
- **Post-merge main-push CI** (head `ec931e7`): **Smoke lane SUCCESS**, **DB lane SUCCESS**.

## 2. Local re-verification (all gates re-run on `ec931e7`, wiped `dist`; nothing trusted from prior reports)

- **format:check** — clean (all files use Prettier code style).
- **lint** — **0 errors** (67 warnings are pre-existing baseline warnings in other modules; M22 adds none).
- **build** — clean (`tsc --build` from wiped `dist`).
- **smoke** — **26 suites, 4995 assertions, 0 failures** (m22-approval smoke 72, contracts 138, m02-identity 232, conformance 2757).
- **migrate** — 40 migrations applied fresh, in order.
- **DB lane (PostgreSQL 15.2 throwaway, `finapp_app` non-owner role, fresh DB)** — **54 specs, 1756 assertions, 0 failures**, including **`m22-approval` db-spec (50)** and **`m22-services` db-spec (33)**. (All `api-*` HTTP specs also pass on a fresh DB; earlier local api-* failures were cross-run DB pollution + a superuser-connection artifact, not an M22 defect — CI confirms green on PostgreSQL 16.)

### Live DB governance evidence (queried on the certified schema)

| Property | Evidence |
| --- | --- |
| All 24 approval tables RLS ENABLE + FORCE | 24 / 24 |
| `tenant_isolation` policy on every table | 24 / 24 |
| DELETE grants to the application role | **0** |
| UPDATE grants on the 18 append-only ledgers | **0** (INSERT+SELECT only) |
| Binary-float columns | **0** |
| `*_minor` money columns are `bigint` | 2 (`amount_minor`, `threshold_minor`) |
| Permissions seeded / privileged | 25 / 12 |
| Outboxes in schema (m22 owns none) | 1 (`workflow_event_outbox`, m06) |
| SoD / quorum / enforce / release / depth CHECK constraints | 8 / 8 present |
| Single-fire escalation unique constraint | present (`UNIQUE NULLS NOT DISTINCT`) |

## 3. Verdicts

- **Maker-checker + SoD verdict — PASS.** Enforced in three layers (pure engine → service → DB CHECK): `final_approver <> requested_by`; an `approve`/`override_approve` decision actor `<> maker`; a blocked attempt is audited (`APPROVAL_SOD_BLOCKED`) and refused (403 + reason code), never silent. Proven by `m22-services` (maker cannot approve own request; preparer cannot be the required checker) + the governance DB CHECKs.
- **Delegation verdict — PASS.** `delegate <> delegator` (DB CHECK); a delegate acting *for the maker* is blocked (`delegate_is_maker`); a delegate acting for a non-maker delegator may approve. Delegation cannot launder SoD.
- **Escalation verdict — PASS.** Deterministic (injected `Clock`); **single-fire** per `(request, step, to_level)` via `UNIQUE NULLS NOT DISTINCT` (request-level `step_id IS NULL` still collides); **depth-bounded** CHECK; notify-only vs reassignment; reuses m06 SLA/timers + m08 notifications by opaque reference (no second engine). A duplicate escalation is a safe no-op.
- **M21 intake verdict — PASS.** m22 approves a controlled action identified by `(subject_type, subject_ref)` where `subject_ref` is an **opaque** id (e.g. an m21 posting-request id); m22 reads no m21 tables. On approval it releases an `approval_outcome` whose id is the approval reference m21/m23 gate posting on. m22 never posts.
- **M23 boundary verdict — PASS.** m23 (finance integration) is **downstream** — it consumes m22’s released approval reference; it is not a build prerequisite. m22 pushes to no ledger/ERP/core system.
- **Tenancy / RLS verdict — PASS.** 24/24 tables RLS ENABLE+FORCE + `tenant_isolation`; composite `(tenant_id, id)` keys + composite FKs; cross-tenant reads return not-found (proven in both DB specs through the non-owner role).
- **Privacy verdict — PASS.** Event/audit payloads carry ids, states, levels, decisions, reason codes and opaque references only; `m22-services` asserts no request title (a secret marker) appears in any event or audit entry (data minimisation).
- **Idempotency / concurrency verdict — PASS.** `approval_idempotency` unique per key + idempotency-keyed requests (no duplicate action); every mutable aggregate is version-CAS guarded (stale `expectedVersion` rejected); terminal-state protection on approved/rejected/cancelled.
- **Contamination verdict — CLEAN.** Merge scope is M22-only (byte-identical to reviewed head); m22 owns only its 24 tables, uses opaque references, publishes `approval.lifecycle` through the one m06 outbox, and stands up no second workflow/timer/notification engine. No m19/m21/m23 internals touched.

## 4. Known limitations (documented, non-blocking)

- No posting is performed here (posting is draft-first / deferred, ADR-096); m22 releases the approval reference m21/m23 gate on.
- Escalation is signal-driven — m22 records the m06 SLA-timer reference and fires one escalation via the injected `Clock`; it schedules no wall-clock timers itself.
- Local HTTP RLS is exercised via `SET ROLE` to the non-owner role; PostgreSQL 16 CI is the authoritative RLS evidence for the app path.

## Final verdict

**CERTIFIED ON BRANCH.**

## Remaining manual action

Merge the M22 certification PR, then begin governance verification for M23 Finance Integration.
