# Stage 2.2 — M06 Enterprise Workflow Engine — Implementation Plan

**Status:** DESIGN / PLANNING ONLY. **Date:** 2026-07-22. **Build baseline:** `main` @ `cd29b7b` (Stage 2.1 m03 merged PR #9 + certified PR #11).
**Companion docs:** `STAGE_2_2_M06_WORKFLOW_ARCHITECTURE.md`, `STAGE_2_2_M06_WORKFLOW_READINESS.md`.

> Execute this plan only after the readiness gate C1 (m03-audit merged + certified) clears and Stage 2.2 is
> `approved_for_build`. Build off certified `main`, never off the unmerged m03 branch.

---

## 1. Package skeleton (target layout)

Mirror `packages/m02-rbac` exactly (verified conventions):

```
packages/m06-workflow/
  package.json          # "type":"module"; exports["."]: source->types->default; files:[dist,migrations];
                        # deps: @finapp/{contracts,kernel,m01-tenant,m02-identity,m02-rbac}; dev: @finapp/test-runner, yaml
  tsconfig.json         # extends ../../tsconfig.base.json; include src+test; references: kernel, contracts,
                        # m01-tenant, m02-identity, m02-rbac, tools/test-runner
  README.md             # replace placeholder
  migrations/
    0001_workflow.sql
    0002_grant_application_role.sql   # app role: SELECT/INSERT/UPDATE on mutable; SELECT/INSERT on history+outbox; NO DELETE
  src/
    index.ts            # exports services, domain helpers, M06_PERMISSIONS, M06_AUDIT_CODES
    permissions.ts      # M06_PERMISSIONS map (24 codes)
    audit-codes.ts      # M06_AUDIT_CODES map (31 codes)
    domain/             # PURE: node types, lifecycles, token accounting, sla math, expression interpreter, scope
    repository.ts       # all SQL; parameterized; version-guarded updates
    emit.ts             # M06Emitter over kernel AUDIT + OUTBOX (mirror RbacEmitter)
    outbox.ts           # WorkflowOutbox implements Outbox<DomainEvent> (bound to kernel OUTBOX)
    definition.service.ts / instance.service.ts / task.service.ts / sla.service.ts / incident.service.ts
    validator.ts        # definition JSON-Schema + graph validation
  test/
    m06-workflow.smoke.ts     # PURE
    m06-workflow.db-spec.ts   # DB
apps/api/src/workflow/
  workflow.module.ts    # useFactory/inject over PlatformModule tokens; @Controller('workflow')
  definitions.controller.ts / instances.controller.ts / tasks.controller.ts / incidents.controller.ts
  views.ts              # row -> DTO
packages/contracts/src/workflow-events.ts   # family const/version, type union, payloads
```

Also touched (build wiring): root `tsconfig.json` (+ reference to m06), `apps/api/tsconfig.json` (+ reference), `apps/api/src/platform.module.ts` (bind `OUTBOX` → `WorkflowOutbox`, replacing `RecordingOutbox`), `apps/api/src/app.module.ts` (import `WorkflowModule`), `package-lock.json`, and the four registries + manifest + naming-map + ADR register + contracts `events.ts`.

---

## 2. Commit-by-commit sequence (after m03 cert)

Each commit is small, reviewable, Conventional Commits, and leaves the tree green (build+lint+format+smoke; DB where applicable). **Forbidden scope** is called out per commit.

| # | Commit | Scope | Files (likely) | Tests | Forbidden |
| --- | --- | --- | --- | --- | --- |
| 1 | `docs(stage-2.2): accept m06 workflow ADRs 021-026` | ADRs + planning manifest metadata | `ARCHITECTURE_DECISION_REGISTER.md`, manifest planning block | none (docs) | any code/migration |
| 2 | `feat(workflow): register m06 permissions, audit codes and event family` | registries + contracts union + naming-map GAP-1 | `permission-registry.yaml`, `audit-code-registry.yaml` (bump count), `event-registry.yaml`, `naming-map.yaml` (`event_family_registered: true`), `contracts/src/workflow-events.ts` + `events.ts` tail, `m06-workflow/src/{permissions,audit-codes}.ts` | conformance (smoke) parses; contracts smoke | any table/API |
| 3 | `feat(workflow): m06 package skeleton and domain contracts` | package.json/tsconfig, `src/index.ts`, `src/domain/*` (node types, lifecycle state machines, token accounting, scope) | package skeleton + domain | PURE smoke: lifecycle + node config + token math | migrations, API, outbox |
| 4 | `feat(workflow): definition model and safe validator` | `validator.ts`, expression interpreter, definition schema | domain + validator | PURE: definition validation, expression sandbox, loop/limit checks | runtime persistence |
| 5 | `feat(workflow): runtime state machine (instances, tasks, tokens)` | `instance`/`task` domain transitions (pure) | domain | PURE: instance/task state machine, gateway eval, parallel split/join | DB, API |
| 6 | `feat(workflow): migrations and repositories` | `migrations/0001_workflow.sql`, `0002_grant...`, `repository.ts` | migrations + repo | DB: migrations apply, RLS, composite FK, append-only history, optimistic lock | API wiring |
| 7 | `feat(workflow): assignment, routing and approval controls` | `task.service.ts`, assignment strategies, maker≠checker, SoD consult | services | DB: assignment conflict, SoD, self-approval block | timer/outbox |
| 8 | `feat(workflow): timer and SLA engine` | `sla.service.ts`, `workflow_timer`/`workflow_sla_clock`, business-calendar math | services | PURE: SLA business-time math; DB: timer dedupe, warn/breach once | outbox |
| 9 | `feat(workflow): the transactional outbox and integration events` | `outbox.ts` (`WorkflowOutbox`), `workflow_event_outbox`, `emit.ts` | outbox | DB: outbox atomicity, dedupe, dead-letter/replay | binding swap (next) |
| 10 | `refactor(platform): bind OUTBOX to WorkflowOutbox and add /api/v1/workflow` | `platform.module.ts` (OUTBOX→WorkflowOutbox), `apps/api/src/workflow/*`, `app.module.ts`, api tsconfig | API + wiring | API: permissions, transitions, idempotency, error mapping | none new |
| 11 | `feat(workflow): incident and retry model` | `incident.service.ts`, incidents controller | services + API | DB: incident recovery; API: incident retry | — |
| 12 | `test(workflow): prove concurrency, isolation and security-negative paths on a real DB` | DB + security-negative specs | test/*.db-spec.ts | DB + security-negative (full matrix) | source logic changes |
| 13 | `docs(stage-2.2): m06 completion report and manifest status` | completion report + manifest `certification_2_2` | docs + manifest | conformance | code |
| 14 | `chore(stage-2.2): format and final gate pass` | prettier over new files | formatting only | full baseline | logic |

> Commits 2 and 10 are the two that touch shared/global files (registries, `platform.module.ts`, contracts union). They must keep every existing suite green and the `@Endpoint` boot check passing. Commit 10 is the **only** commit that changes runtime wiring / the OUTBOX binding.

---

## 3. Test strategy

**Honesty note:** exact assertion totals are **set during implementation**, not invented here. For calibration, current per-suite baselines (runner-reported) are: m02-rbac smoke ≈100 / db 12; m03-audit smoke ≈58 / db ≈24. m06 is larger in surface, so its suites should **meet or exceed** that density; the counts below are **required case coverage**, and the new module must not reduce the overall baseline (the runner sums passing assertions).

### 3.1 PURE tests (`m06-workflow.smoke.ts`, no DB)
Definition validation; definition→node/transition graph checks (unreachable/dangling/missing START-END); lifecycle transitions (definition/instance/task legal + illegal); task state machine; EXCLUSIVE_GATEWAY evaluation; PARALLEL_SPLIT/JOIN token accounting (balanced + underflow/overflow rejection); TIMER rules; SLA business-time calculations (weekends/holidays/pause-resume); assignment rule resolution; approval matrix (single/sequential/parallel/unanimous/quorum/first-wins); idempotency key behavior; retry/backoff logic; compensation record rules (reserved); expression interpreter (valid + rejects side effects/host access/unknown vars); loop-protection limits; every permission is 3-segment; every audit code is registered SCREAMING_SNAKE with `WORKFLOW_` prefix.

### 3.2 DB tests (`m06-workflow.db-spec.ts`)
Migrations apply (ordering+checksum via runner); RLS present (relrowsecurity/relforcerowsecurity + `tenant_isolation` policy) on every tenant table; cross-tenant isolation (an instance/task in tenant A invisible in tenant B, through `asTenant`/appRole); append-only history (app role cannot UPDATE/DELETE history — `rejectsIn`, one tx each); concurrency / double-completion (two completers, one 409); unique constraints (business_key, timer dedupe_key, outbox dedupe); timer deduplication; outbox atomicity (event enqueued iff state committed; rollback leaves no row); optimistic locking (stale version 409); assignment conflict; SoD enforcement (maker≠checker); immutable published versions (edit refused); transaction rollback (partial transition invisible); incident recovery (recovery pass re-derives runnable work).

### 3.3 API tests (`apps/api/test/api-workflow.db-spec.ts`)
Permission enforcement per route (default deny → 403); tenant boundaries (other tenant's task → 404, not 403); invalid transitions (409); stale requests (409); idempotency (repeat start/complete returns prior result); error mapping (each row of ARCHITECTURE §13.1); definition deploy (validate→publish→activate); task completion; cancellation; suspension; incident retry.

### 3.4 Security-negative tests
Header permission injection (a `permissions`/`x-permissions`-style header cannot grant authority); cross-tenant task access; self-approval (maker == checker blocked); revoked-permission completion (blocked); duplicate approval (idempotent, single effect); forged actor context (rejected at boundary); arbitrary expression execution (interpreter refuses code/host access); SQL fragments in conditions (rejected by validator, never concatenated into SQL); oversized definitions (limit exceeded → rejected); infinite loops (loop cap enforced); unauthorized workflow activation (403); system-context misuse (SystemContext is not a universal allow — cannot complete a human task).

---

## 4. Observability deliverables

- **Metrics** (§17 architecture): active/completed/failed/suspended instances; open/overdue tasks; SLA warnings/breaches; transition latency; task completion time; timer + outbox backlog; incident/retry counts; concurrency conflicts. Exposed as counters/gauges the platform metrics layer can scrape (mechanism per OD-5 ops model).
- **Structured logs**: tenantId, definition id/version, instance id, task id, transition id, actor id/type, correlationId, causationId, requestId, outcome, error code — **no payload values by default**.
- **Health**: dispatcher liveness, timer-scheduler lag, outbox backlog threshold, incident backlog.

---

## 5. Acceptance criteria (Stage 2.2 complete only when ALL hold)

1. All architecture decisions resolved (ADR-021…026 accepted; OD-1…OD-7 settled).
2. Definitions versioned and **immutable after publication** (edit refused; DB-proven).
3. Runtime transitions **deterministic** (no wall-clock/random in evaluation; PURE-proven).
4. **Tenant isolation** enforced (RLS FORCE + cross-tenant DB tests green).
5. Permissions **resolved server-side** (never headers); default deny.
6. Task completion **concurrency-safe**; **double completion impossible** (single-winner + version, DB-proven).
7. Workflow history **append-only** (grant-based; app role cannot rewrite).
8. Audit events **emitted correctly** in the same tx; codes registered.
9. **Outbox transactionally consistent** (event iff state committed; dedupe; dead-letter/replay).
10. SLA warnings/breaches **reliable and deduplicated** (one per threshold).
11. Instances **recover from process failure** (state fully persisted; recovery pass).
12. **Invalid definitions rejected** at validate/publish.
13. **Arbitrary code execution impossible** (sandboxed interpreter; no eval/vm/SQL/shell).
14. All required **PURE, DB, API, and security-negative tests pass**.
15. **CI Smoke and DB lanes pass** (PostgreSQL 16 authoritative).
16. Implementation **PR merged**.
17. **Post-merge certification passes** (local gates on merged main + CI evidence).
18. **Certification PR merged**.

---

## 6. Governance guardrails during build

- Build off certified `main`; do **not** stack on any unmerged branch.
- Exactly **one** outbox table + one `Outbox` implementation (m06 owns it; replace `RecordingOutbox`).
- No second audit path; consume `AUDIT` port; codes registered (unregistered fails CI).
- No `m07/m08/m09/m12/m13` source in this stage; m06 emits events, calls no downstream module.
- No auto-approval/auto-post; maker≠checker enforced; humans decide.
- Update docs + manifest + registries in the **same** change as the code (CLAUDE.md).
- Keep `naming-map.yaml` axes exact; close GAP-1 (register `workflow.lifecycle`).
- Every mutating route: `@Endpoint` (3-segment permission + registered `WORKFLOW_` audit) + service-level enforcement.

---

## 7. Post-implementation: certification path (mirrors 1D / 2.1)

1. Implementation PR (base `main`) → CI Smoke + DB (PostgreSQL 16) green → review → merge.
2. Cut `cert/stage-2-2-m06-workflow` from merged main; run full local gates (format/lint/build/smoke/conformance/migrate/db with `DATABASE_APP_ROLE=finapp_app`); write `STAGE_2_2_M06_WORKFLOW_CERTIFICATION.md`; update manifest `certification_2_2` (honest: `certified_on_branch`).
3. Certification PR (docs-only) → CI green → merge. Only then is Stage 2.2 certified and the next stage may begin.
