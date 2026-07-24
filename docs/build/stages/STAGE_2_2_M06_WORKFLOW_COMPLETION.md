# Stage 2.2 — M06 Enterprise Workflow Engine — Completion Report

**Status:** IMPLEMENTED ON A FEATURE BRANCH — smoke + DB green locally — NOT CI-certified, NOT merged (2026-07-24).
**Module:** `m06-workflow` (Foundation — the workflow / status / SLA / timeline / **outbox** spine).

## 1. Baseline

| Fact | Value |
| --- | --- |
| Certified build baseline | `main` @ `cd29b7b5b1c0220fd801989e528d06911395b7a9` (Stage 2.1 m03-audit merged PR #9 → `587a3ce`, certified PR #11 → `cd29b7b`) |
| Certification PR #11 merge SHA | `cd29b7b5b1c0220fd801989e528d06911395b7a9` |
| Implementation branch | `feature/stage-2-2-m06-workflow` |
| Planning package | ADR-021…026 + `STAGE_2_2_M06_WORKFLOW_{ARCHITECTURE,READINESS,IMPLEMENTATION_PLAN}.md` |

## 2. Commit sequence (10 focused, gated commits)

1. `82b0e8c` docs(stage-2-2): integrate planning package + finalize m03 certification
2. `ccc5d95` accept ADRs; register 24 permissions, 31 audit codes, `workflow.lifecycle` event family (closes GAP-1)
3. `820dba7` package skeleton + PURE domain (node types, lifecycles, tokens, **safe expression interpreter**, definition validator)
4. `9a2d8b5` deterministic runtime engine (routing / gateway / split-join / task-park)
5. `761fc8d` migrations, RLS/FORCE, grants, repositories (optimistic concurrency)
6. `057792f` services — authoring, execution drive, tasks, maker-checker, SoD
7. `151f898` SLA + timer engine (business-calendar deadlines)
8. `429c510` **durable outbox + platform OUTBOX binding** (retires RecordingOutbox)
9. `a9925d0` incidents + retry
10. `9e6dc24` API + platform wiring under `/api/v1/workflow` + permission seed

## 3. Scope implemented (MVP)

Versioned, immutable-after-publish definitions (validated JSON `spec`); START/END, HUMAN_TASK, APPROVAL_TASK,
SYSTEM_TASK (allow-listed handler), EXCLUSIVE_GATEWAY, PARALLEL_SPLIT/JOIN, TIMER_WAIT, EVENT_WAIT (park),
ESCALATION, CANCEL; instances + persistent tokens + deterministic drive under a per-instance advisory lock;
task queues; assignment by user/role/department/branch/entity; claim (lease) / assign / reassign / delegate;
complete / reject with **maker≠checker** and **authz re-evaluated at execution**; suspend / resume / cancel;
SLA warning + breach on business calendars (fire-once); escalation; append-only history; audit integration;
**the single durable transactional outbox**; idempotency (business_key, timer/outbox dedupe); optimistic
concurrency (single-winner completion); RLS tenant isolation; incidents + retry; `/api/v1/workflow` REST API.

### Deferred (reserved, documented)
SUB_WORKFLOW & COMPENSATION execution (codes/enums reserved); BPMN import/export; graphical designer;
distributed choreography; process mining; AI-generated workflows; team/round-robin/least-loaded routing;
active-instance version migration; hierarchical org-manager routing; full holiday-calendar admin UI; a
generic per-entity status engine for other modules. **Never:** autonomous approvals, cross-tenant workflows,
arbitrary code/scripting.

## 4. Deliverables

- **Database (11 tables):** workflow_definition, _definition_version (immutable `spec` jsonb, one ACTIVE per
  definition), _instance, _token, _task, _timer (dedupe_key UNIQUE), _sla_clock, _incident, _event_outbox
  (mixed-scope, THE outbox), + _instance_history / _task_history (append-only via GRANT). Composite
  `(tenant_id, id)` PKs + composite FKs; RLS ENABLE+FORCE + `tenant_isolation` on every table; optimistic
  `version` columns; NO DELETE grants. **Design note:** a definition's graph lives as one validated, immutable
  `spec` JSON on the version row (ADR-022) rather than shredded into per-node tables — deliberate.
- **Permissions:** 24 `workflow.*` (3-segment; `workflow.engine.administer`), registered AND seeded into the
  global `permissions` catalogue so roles can be granted them.
- **Audit codes:** 31 `WORKFLOW_*` (registered; count 71→102).
- **Events:** `workflow.lifecycle` family, 14 types, payload v1, in the contracts union — **closes GAP-1**.
- **API:** `/api/v1/workflow/{definitions,instances,tasks,incidents}` — ~30 routes, each mutating route
  `@Endpoint`-declared (permission + audit) and service-enforced.
- **Transaction & outbox:** state mutation + audit + event commit atomically; **m06 owns the one durable
  outbox**, now bound to `OUTBOX` in `platform.module` (RecordingOutbox retired to a test double). The outbox
  row's scope is derived from the session GUC (like m03 audit_events), so any module's event enqueues RLS-safe.
- **SLA:** persisted clocks + warn/breach timers on business-calendar deadlines; each fires exactly once.
- **ADRs:** ADR-021…026 accepted.

## 5. Security controls

Tenant isolation (RLS FORCE, proven cross-tenant through the app role); default-deny authorization resolved
server-side (never a header — proven over HTTP); maker≠checker / no self-approval; authz re-evaluated at task
completion; optimistic `version` + status-guarded single-winner completion (double completion impossible);
**sandboxed condition expressions** — no eval/Function/vm/SQL/shell/network/host-access, allow-listed
functions, fail-closed, DoS-bounded (heavily abuse-tested); server-minted outbox events; same-tx append-only
audit; deduplicated timers; hard definition limits (nodes/transitions/variables/parallel-branches/loop/retries/
timer-horizon/payload).

## 6. Test results (local; PostgreSQL 15.2 throwaway, `DATABASE_APP_ROLE=finapp_app`)

| Gate | Result |
| --- | --- |
| Format / Lint / Build | ✅ clean (0 errors; pre-existing non-blocking warnings) |
| PURE smoke | ✅ **12 suites / 1643 assertions** — incl. m06-workflow (179), m06-expression (86) |
| Conformance | ✅ 537 assertions (registries, naming-map GAP-1 closed, every `@Endpoint` validated) |
| Migrations | ✅ **12** in dependency order, checksums valid; fresh apply clean |
| DB integration | ✅ **13 specs / 408 assertions** — incl. m06-workflow (21), m06-services (22), api-workflow (9) |
| RLS / append-only / concurrency / outbox-atomicity / SLA / incident / security-negative | ✅ (see specs) |

**Key proofs:** cross-tenant isolation; append-only history (app role cannot UPDATE/DELETE); single-winner
completion (no double completion); timer/outbox dedupe; outbox atomic-with-state (enqueued iff commit);
maker≠checker; default-deny + no-header-authority end-to-end over HTTP; expression sandbox (86-assertion abuse
battery); SLA warn/breach fire-once; incident raise + resolve; business-calendar math.

## 7. Contamination check

The diff against `main` contains only Stage 2.2 work: `packages/m06-workflow`, `apps/api/src/workflow` + app/
platform wiring, `packages/contracts/src/workflow-events.ts`, the four registries + naming-map + ADR register,
the m06 completion/planning docs, and build wiring. **No** m07/m08/m09/m12/m13/m22 implementation; no duplicate
earlier-stage source. `RecordingOutbox` is retired from production but retained as a test double (no second
outbox).

## 8. Known limitations (honest)

1. SUB_WORKFLOW / COMPENSATION are reserved but **not executable** (validator rejects them as non-MVP).
2. SYSTEM_TASK supports only an allow-listed built-in handler set (MVP: `noop`); unknown handlers raise an
   incident. A pluggable registered-handler registry is a follow-on.
3. EVENT_WAIT parks on an inbound correlation; there is no external event-sourcing in MVP.
4. The parallel-join counts consumed tokens at the join node — MVP assumes a parallel region is entered once
   (no looping back through a join).
5. The timer dispatcher / SLA scheduler is a service method (`SlaService.fire`, `InstanceService.retry`)
   invoked by tests here; a standing background worker is an operational follow-on.
6. Local certification is on PostgreSQL 15.2; **PostgreSQL 16 CI is the authoritative gate** (pending PR).
7. Assignment strategies beyond user/role/department/branch/entity (team/round-robin/least-loaded) are deferred.

## 9. Implementation verdict

**IMPLEMENTED and locally green.** The engine is functionally complete for the MVP, governance-correct
(RLS, default-deny, maker-checker, atomic audit+outbox, single-winner, sandboxed expressions), and proven
end-to-end over HTTP. It is **NOT** CI-certified and **NOT** merged — that awaits the implementation PR's
Smoke + PostgreSQL 16 DB lanes going green, review, merge, and a post-merge certification.
