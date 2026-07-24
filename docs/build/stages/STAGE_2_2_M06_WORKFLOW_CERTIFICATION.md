# Stage 2.2 — M06 Enterprise Workflow Engine — Post-Merge Certification

**Date:** 2026-07-24
**Module:** `m06-workflow` (the workflow / status / SLA / timeline / **outbox** spine).
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch `cert/stage-2-2-m06-workflow`; certification PR pending, not merged).

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#12** |
| Reviewed implementation head | `7ade813d5e41d393f6dad5c4fef83d5153aa09af` |
| Implementation merge SHA (squash) | `3823275d11e22a400b87fbdc42b58b6b9ee49a10` |
| Certified baseline SHA (main tested) | `3823275d11e22a400b87fbdc42b58b6b9ee49a10` |
| Certification branch | `cert/stage-2-2-m06-workflow` (cut from merged main) |
| Parent baseline (pre-merge main) | `cd29b7b5b1c0220fd801989e528d06911395b7a9` (certified Stage 2.1) |
| PR #12 | `state: closed`, `merged: true`, `merged_at: 2026-07-24T12:27:14Z` |

**Tree-equivalence:** PR #12 was **squash-merged** (`3823275` has a single parent `cd29b7b`), so the reviewed
head is not a literal ancestor — ancestry is not required. `git diff 7ade813 3823275` is **empty**: the merged
tree is **byte-identical** to the reviewed head across the entire repository. All intended files are present; no
unexpected files were introduced.

## 2. Scope certified (merge diff `cd29b7b..3823275`)

ADR-021…026; m06 architecture/readiness/implementation/completion docs; `packages/m06-workflow` (29 files —
domain, migrations, repositories, services, SLA/timer, incident/retry, outbox); `packages/contracts/src/
workflow-events.ts` + union; workflow permissions (24, registered **and seeded**); workflow audit codes (31);
event-registry `workflow.lifecycle` (GAP-1 closed); naming-map; m06 migrations; `/api/v1/workflow` API +
platform/app wiring (OUTBOX→WorkflowOutbox); m06 tests; build wiring; manifest Stage 2.2 block; the assertion-
count bump in `contracts`/`m02-identity` smoke.

**Exclusions (verified absent):** no m07/m08/m09/m12/m13/m22 implementation (all README-only, 0 impl files);
no graphical designer; no arbitrary scripting; no autonomous approvals; no accounting posting/disbursement; no
direct notification delivery; no document storage; **no duplicate audit table; no second outbox**; no
cross-tenant workflow orchestration; no false certification claims.

## 3. Local gate results (baseline `3823275`)

Environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**; npm **10.9.2**;
connected via `DATABASE_APP_ROLE=finapp_app` (non-superuser, RLS enforced — not a superuser session).

| Gate | Result |
| --- | --- |
| Format check | ✅ PASS |
| Lint | ✅ 0 errors (pre-existing non-blocking warnings only) |
| Build / typecheck | ✅ 0 type errors |
| PURE smoke | ✅ **12 suites, 1643 assertions, 0 failures** (m06-workflow 179, m06-expression 86) |
| Conformance (registries + manifest parse + `@Endpoint` + GAP-1) | ✅ **537 assertions** |
| Migration ordering + checksums | ✅ **12 migrations**, dependency order, checksums valid |
| Fresh PostgreSQL replay | ✅ 12 applied, 0 already-applied |
| DB integration + API specs | ✅ **13 specs, 408 assertions, 0 failures** (m06-workflow 21, m06-services 22, **api-workflow 9**) |

**Authoritative CI (PostgreSQL 16):** implementation PR #12, head `7ade813`, run **30085639355** — **Smoke lane +
DB lane both success**. Merged tree is byte-identical to that head.

The DB/API specs collectively exercise the Section-D matrix: RLS + cross-tenant isolation, default-deny +
permission-header-injection (a header cannot grant authority), single-winner + double-completion + optimistic
lock, idempotency, maker≠checker + self-approval prevention, revoked-permission-at-execution, append-only
history, immutable published versions, state machine / gateway / parallel split-join, timer dedupe, SLA
warn/breach fire-once, business-calendar math, incident create/retry, **outbox atomicity + RLS + scope**,
expression-sandbox abuse (86-assertion battery), stable error codes, tenant non-leakage (404), and the API
lifecycle/task/cancel/suspend/incident-retry surface end-to-end over HTTP.

## 4. Domain model verification (§E)

Definitions DRAFT→VALIDATED→PUBLISHED→ACTIVE→RETIRED (immutable after publish; running instances pinned to
their version — ADR-022). Node model START/END/HUMAN_TASK/APPROVAL_TASK/SYSTEM_TASK(allow-listed handler)/
EXCLUSIVE_GATEWAY/PARALLEL_SPLIT/PARALLEL_JOIN/TIMER_WAIT/EVENT_WAIT/ESCALATION/CANCEL implemented; **SUB_WORKFLOW
and COMPENSATION reserved-but-deferred** (validator rejects as non-MVP). Instances: deterministic transitions,
persistent tokens, lifecycle state, suspend/resume/cancel, terminal states, retry after incident, no partial-
transition visibility (single tx + advisory lock). Tasks: assign/claim/reassign/delegate/complete/reject, lease
reservation, single-winner completion, execution-time authz re-evaluation, maker-checker, SoD.

## 5. Database & RLS verification (§F)

All **11** m06 tables: composite `(tenant_id, id)` PKs, composite tenant-safe FKs, ENABLE + **FORCE** RLS (live
check: 11/11 `relforcerowsecurity=t`), `tenant_isolation` policies, optimistic `version` columns, deterministic
unique constraints (business_key / timer dedupe_key / outbox dedupe_key), queue/partial indexes. App-role grants:
SELECT/INSERT/UPDATE on mutable, SELECT/INSERT on history + outbox-insert path; **0 DELETE grants** on any
`workflow_*` table (live check). Governed history append-only via GRANT; published versions immutable. No hidden
superuser dependency — the DB lane runs as `finapp_app` (proven by RLS-enforced cross-tenant specs passing).

## 6. Authorization verification (§G)

24 `workflow.*` permissions: registered, **seeded into the `permissions` catalogue** (role_permissions FKs to
it — without the seed the API would be unusable), three-segment compliant, enforced server-side in the services
(default deny). Verified: headers cannot grant authority (HTTP 403 even with an `x-permissions` header);
assignment does not grant permission; completion authz re-evaluated at execution; tenant mismatch → 404 (no
disclosure); self-approval blocked (maker≠checker); SoD supported; SystemContext is not universal allow;
platform/tenant scopes distinct. Uses **`workflow.engine.administer`** (no 2-segment `workflow.admin`). **No
m22 approval-policy engine implemented.**

## 7. Audit verification (§H)

m06 writes through the kernel `AUDIT` port (m03 `AuditService`) via `M06Emitter.recordAudit → audit.write(tx,…)`
— **no duplicate audit table** in m06. Every governed mutation maps to a registered `WORKFLOW_*` code; audit
captures tenant (session scope), actor, definition/version, instance, task (where applicable), transition,
reason (where required), outcome, correlation and causation. `write(tx,…)` runs in the same transaction as the
mutation (fails the action if audit fails); failure/denial evidence uses m03's independent-transaction methods.
Sensitive workflow values are not placed in audit detail (payloads carry ids/keys only).

## 8. Outbox verification (§I)

**m06 owns the single durable platform outbox.** `OUTBOX` bound to `WorkflowOutbox`; `RecordingOutbox` retired
from production (a comment records this) and retained only as a test double (still exported from m01). No direct
m08 invocation. `publish(tx, event)` inserts into `workflow_event_outbox` in the caller's transaction (proven
atomic: enqueued iff the tx commits; a rolled-back tx leaves no row). Row carries `family/type/aggregate_id/
envelope/dedupe_key/status/attempts/available_at/dispatched_at/last_error`; envelope carries `eventId/
correlationId/causationId?/version`. Delivery is at-least-once with idempotent consumers (dedupe_key UNIQUE →
replay-safe). **The account-plane/PLATFORM_TENANT RLS issue is fixed and tested:** the row's `tenant_id`/
`scope_key` are derived from the **session GUC** (like m03 audit_events), so an event emitted in any module's
transaction enqueues RLS-safe; the platform dispatcher reads across tenants under the system escape. The
`workflow.lifecycle` family (14 types) is registered in event-registry + the contracts union.

## 9. SLA & timer verification (§J)

Response/task/resolution SLA types; warn + breach thresholds; pause/resume; **business calendar** (weekends +
configured holidays + business hours, PURE-tested); persisted clock state; timer `dedupe_key` UNIQUE; **warn
fires once, breach fires once** (single-winner `fireTimer` + `markSlaFlag` — DB-tested). Running instances retain
their published version's SLA configuration (ADR-022). **Standing dispatcher worker: deferred** (the fire path
is a service method invoked by tests/callers).

## 10. API verification (§K)

Prefix **`/api/v1/workflow`** (singular; no `/workflows`). Route groups present for definitions/versions/
validate/publish/activate/retire, instances/suspend/resume/cancel/retry, tasks/claim/assign/reassign/delegate/
complete/reject/escalate, incidents/resolve/retry. Every mutating route declares `@Endpoint({permission,
auditCode})` (conformance-validated) and is service-enforced. Stable error mapping: invalid transition/stale
version/already-completed/not-active/assignment-conflict/SoD/suspended/terminal/unresolved-incident → 409;
forbidden → 403; tenant mismatch → 404 (non-leaking); invalid definition → 400; timer-already-fired / duplicate
idempotency → no-op/409.

## 11. Expression-security verification (§L)

The condition engine is a hand-written tokenizer → recursive-descent parser → AST interpreter over declared
variables — **interpreted, never executed as host code**. Verified: **no `eval`, no `Function` constructor, no
`vm`, no `require`/dynamic `import`, no `process`/`child_process`** in executable code (only the doc comment names
them). Allow-listed function set; schema-validated definitions; fails closed on any lexical/syntactic/type/limit
error; size, node-count, identifier-length and recursion-depth limits; no property access/indexing/host-object
reach; no SQL/shell/filesystem/network. Definition-level limits: max nodes/transitions/variables/parallel-
branches/loop-iterations/retries/timer-horizon/payload. **Abuse-test assertion count: 86** (m06-expression PURE
suite), plus definition-validator rejection tests in the m06-workflow suite.

## 12. Transaction & concurrency verification

State mutation + audit + outbox commit in one transaction. Optimistic `version` + status-guarded `applyTaskStatus`
makes double completion impossible (DB-proven: first completion wins, a stale/duplicate changes zero rows → 409).
Parallel token accounting under a per-instance `pg_advisory_xact_lock`. Idempotent start (business_key), timer
and outbox dedupe. Instances are crash-recoverable (state fully persisted; `retry` re-drives active tokens; the
drive is idempotent for parked task nodes).

## 13. Known limitations (honest — approved deferrals, not defects)

1. SUB_WORKFLOW / COMPENSATION reserved but **not executable** (validator rejects as non-MVP).
2. SYSTEM_TASK handler catalogue limited to an allow-listed built-in set (MVP `noop`); unknown handlers raise an
   incident.
3. EVENT_WAIT is inbound-correlation only (no external event sourcing).
4. Parallel join assumes a region is entered once (no looping back through a join).
5. The SLA/timer **dispatcher worker is deferred** (fire path is a service method).
6. Team / round-robin / least-loaded assignment routing deferred.
7. No enterprise `entity_type_registry` (OD-4 — m06 references m01 node ids + its own subject-type strings).
8. m22 approval-policy administration deferred; m06 provides the generic APPROVAL_TASK with local (version)
   approval config.
9. Local certification on PostgreSQL 15.2; **PostgreSQL 16 CI is the authoritative gate** (PR #12 run 30085639355).

## 14. Contamination check

The certified baseline contains only Stage 2.2 m06 work (§2). No m07/m08/m09/m12/m13/m22 implementation; no
duplicate earlier-stage source; no second outbox; no duplicate audit table. `RecordingOutbox` is retired from
production but retained as a test double.

## 15. Certification verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** Every implemented control passes on the certified baseline `3823275`
(format, lint, build, smoke 1643, conformance 537, 12 migrations, DB/API 408 assertions — all under the
non-superuser app role), the authoritative CI (PR #12, PostgreSQL 16) is green on the byte-identical head, and
the architecture, database, RLS, authorization, audit, outbox, SLA, API, expression-security and concurrency
verifications hold. The only outstanding items are the intentional, ADR/plan-recorded deferrals in §13 — no
mandatory control fails, no defect was found.

**Scope of this certification:** documentation only. The certification PR must **not** be merged, and no
later-stage work is authorized by this document.
