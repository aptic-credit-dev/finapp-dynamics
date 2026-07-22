# Stage 2.2 — M06 Enterprise Workflow Engine — Readiness Assessment

**Status:** DESIGN / PLANNING ONLY. **Date:** 2026-07-22.
**Baseline:** `main` @ `56b7d3ea9cba42a81685fb6aefa1735fe8d314b3` (Stage 1D certified).
**Companion docs:** `STAGE_2_2_M06_WORKFLOW_ARCHITECTURE.md`, `STAGE_2_2_M06_WORKFLOW_IMPLEMENTATION_PLAN.md`.

---

## 1. Current baseline

| Fact | Value |
| --- | --- |
| Certified main | `56b7d3e` (Stage 1D RBAC merged PR #7 → `beea0d9`, certified PR #8 → `56b7d3e`) |
| m03-audit | **open PR #9** (`f6dd8e9`), CI green (Smoke + DB PostgreSQL 16), **NOT merged, NOT certified** |
| m06-workflow | placeholder README only (18 reference tables baseline); manifest `status: documented` |
| m08 / m09 / m12 / m13 | placeholder READMEs only — no implementation |
| Reserved m06 axes | API `/api/v1/workflow`, perms `workflow.*`, event family `workflow.lifecycle` (GAP-1: unregistered), audit `WORKFLOW_` |

This readiness explicitly does **not** authorize any runtime code. It exists so that m06 build can start the moment m03 is merged and certified.

---

## 2. Dependency map

```
                 kernel (DB, AUDIT, AUTHZ, OUTBOX, RequestContext, ProblemError, @Endpoint)
                    |            |         |          |
   m01-tenant ------+     m03-audit   m02-rbac    m06 OWNS OUTBOX (replaces RecordingOutbox)
   (org nodes,            (AUDIT       (AUTHZ /         |
    withTenant/RLS)        port)        RbacAuthz)      v
        \                    \            /        m06-workflow  --emits events-->  outbox
         \                    \          /              |
          `------ actor context (m02-identity) ---------'
                                                        v (future consumers, via outbox only)
                             m08-notify  m09-docs  m12-feedback  m13-case  Finance  Reconciliation  Reporting
```

**Hard dependencies (must be merged+certified before m06 build):**
1. **m03-audit** — m06 binds the persistent `AUDIT` implementation for every audited transition. m06 must not stack on the unmerged m03 branch (governance). **This is the gating dependency.**

**Soft dependencies (present on main, already usable):** kernel, m01-tenant, m02-identity/auth, m02-rbac.

**Reverse dependency (m06 provides):** the single transactional **OUTBOX** — every module's events flow through it. Until m06 lands, `RecordingOutbox` is the stand-in; the swap changes no call site (all callers already use `publish(tx, event)`).

---

## 3. Architecture summary (one paragraph)

m06 is a generic, data-driven workflow engine: tenant-authored, versioned, immutable-after-publish workflow **definitions** (declarative JSON with a sandboxed condition language — no code/SQL/shell/network) drive **instances** whose **tokens** move through nodes (START/END/HUMAN_TASK/APPROVAL_TASK/SYSTEM_TASK/EXCLUSIVE_GATEWAY/PARALLEL_SPLIT+JOIN/TIMER_WAIT/EVENT_WAIT/ESCALATION/CANCEL) producing **tasks** routed by assignment rules and governed by SLA clocks on business calendars. Every controlled mutation runs inside `db.withTenant(ctx, tx => …)`, is gated by `authz.require`, writes a `WORKFLOW_*` audit entry via the kernel `AUDIT` port in the same `tx`, and publishes `workflow.lifecycle` events through the **single outbox m06 owns** — all committing atomically. Optimistic `version` columns make double completion impossible; state is fully persisted so execution recovers after a crash. m06 orchestrates and records human approval decisions with maker≠checker and SoD enforcement, but never makes the underlying business decision, posts journals, sends notifications, or stores documents.

---

## 4. Proposed deliverables (summary; full detail in ARCHITECTURE)

| Area | Count / shape |
| --- | --- |
| Domain tables | ~30 (9 definition, ~11 runtime incl. the outbox, ~5 history/governance) — exceeds the README's 18-table baseline because SLA/timer/token/incident are modeled explicitly |
| Node types (MVP) | 13 MVP + SUB_WORKFLOW/COMPENSATION reserved |
| Permissions | 24 under `workflow.*` (3-segment; `workflow.engine.administer` replaces invalid `workflow.admin`) |
| Audit codes | 31 under `WORKFLOW_` |
| Events | `workflow.lifecycle` family, ~16 types, payload v1 (closes GAP-1) |
| API routes | ~30 across definitions/instances/tasks/incidents |
| ADRs | ADR-021 … ADR-026 (6 drafts) |
| Tests | PURE + DB + API + security-negative suites (counts set at build time, see plan) |

---

## 5. Risks

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R1 | Scope is very large for one stage | High | MVP discipline (§19 architecture); SUB_WORKFLOW/COMPENSATION/team routing deferred; ship a thin vertical slice first |
| R2 | m03 not yet merged — m06 blocked on AUDIT | High | Governance gate: build starts only post-m03-cert; no stacking |
| R3 | Outbox is a shared-platform service — getting it wrong affects every module | High | Single table, single impl bound to `OUTBOX`; kernel contract already threads `tx`; at-least-once + idempotent consumers; dead-letter/replay |
| R4 | Expression language = RCE/injection surface | High | Sandboxed interpreted mini-language; no `eval`/`vm`/SQL/shell; allow-list; validated at publish (ADR-024) |
| R5 | Concurrency bugs → double completion / lost tokens | High | Optimistic `version` + status-guarded single-winner updates; per-instance advisory lock for token accounting; DB-spec concurrency tests |
| R6 | Timer/SLA duplication → duplicate escalations/notifications | Med | `dedupe_key` UNIQUE on timers; clock state gates single warn/breach |
| R7 | Naming drift breaks CI (conformance/@Endpoint boot check) | Med | Use reserved axes exactly; close GAP-1 (register family + contracts union); 3-segment perms |
| R8 | Definition/engine complexity leaks business logic into the core | Med | Engine generic; processes are data; no module-specific branches in engine |
| R9 | m06 vs m22-approval boundary unclear | Med | OD-2: m06 provides APPROVAL_TASK; m22 (later) provides higher-order approval policy consumed via m06 |
| R10 | Local DB certification only on PG 15.2 | Low | CI PostgreSQL 16 is authoritative (as for 1D/2.1) |
| R11 | EVENT_WAIT external event sourcing could invite external calls in-tx | Med | MVP = inbound correlation only; no external polling; no external calls in the core tx |

---

## 6. Open decisions (must be resolved before / during build)

| ID | Decision | Recommendation |
| --- | --- | --- |
| **OD-1** | API prefix **singular vs plural**: `naming-map.yaml` reserves `/api/v1/workflow` (singular) but the convention says "plural" and the task used `/api/v1/workflows/...`. | Keep the reserved singular `/api/v1/workflow` and use plural resource segments (`/workflow/definitions`, `/workflow/instances`, `/workflow/tasks`) OR update `naming-map.yaml` to `/api/v1/workflows` in the implementation change. **Recommend: confirm with owner; default to the reserved value to avoid a conformance break.** |
| **OD-2** | m06-workflow vs **m22-approval** boundary. | m06 owns the generic APPROVAL_TASK node + maker-checker/quorum orchestration; m22 (if/when built) owns higher-order approval-matrix policy, consumed through m06. Confirm before modeling an approval-matrix table in m06. |
| **OD-3** | Does m06 own the **status engine** for other modules' entities, or only its own instances? (SHARED_OPERATIONAL_SERVICES lists "Status engine (m06)".) | MVP: m06 owns workflow instance/task status machines; a generic per-entity status engine for other modules is a **follow-on** (declare intent, defer implementation). |
| **OD-4** | **entity_type_registry** ownership — `naming-map.yaml` GAP notes "DATABASE_SCHEMA_CATALOGUE.md attributes entity_type_registry to m06; ownership unresolved." | Resolve ownership (m06 vs m03) via a short ADR before creating the table; **do not** create it speculatively. |
| **OD-5** | **Timer/dispatcher execution model** — in-process scheduler vs external cron/worker. | MVP: a DB-backed scheduler (poll due timers / pending outbox) invoked by an internal worker; keep the transactional core independent of the scheduler so it can be swapped. Confirm ops model. |
| **OD-6** | Business-calendar source — new m06 calendar tables vs a shared calendar service. | MVP: minimal per-tenant calendar (weekends + holiday list) owned by m06; full holiday-admin UI deferred. Confirm no existing calendar owner. |
| **OD-7** | Event `type` naming — dotted types (`workflow.instance.started`) within family `workflow.lifecycle` vs a flatter scheme. | Follow the identity.lifecycle precedent (dotted types in one family); confirm against `EVENT_FAMILY_PATTERN`/type conventions during build. |

None of OD-1…OD-7 is an architectural blocker; each has a safe default. They are decisions to confirm, not gaps that prevent planning.

---

## 7. Alignment notes (conventions verified against the codebase)

- **RLS**: every tenant table uses the exact `tenant_isolation` policy with `NULLIF(current_setting('app.tenant_id', true), '')::uuid`, ENABLE+FORCE, composite `(tenant_id, id)` PK + composite FKs (verified against `m01`/`m02-rbac` migrations and the `rls_convention_sample.sql`). The outbox is mixed-scope (m03 `audit_events` pattern).
- **Append-only via GRANT** (SELECT+INSERT), not triggers, for history — matches the repo convention (corrected from an earlier draft).
- **Optimistic concurrency** via `version integer` + `WHERE version = $expected` + 409 — matches `roles`/`role_assignments`.
- **Audit in same tx** via `audit.write(tx, ctx, entry)`; scope auto-derived from session GUC (m03) — verified.
- **Outbox** `publish(tx, event)` already threads tx; swapping the stand-in changes no call site — verified.
- **@Endpoint** 3-segment permission + SCREAMING_SNAKE audit validated at class-definition/boot; caught the invalid `workflow.admin`.
- **Package/module layout** mirrors `m02-rbac` (exports `source→types→default`, tsconfig `references`, `@Controller` + `useFactory`/`inject`, value-imports, no parameter-properties) — verified.

---

## 8. MVP vs deferred (confirmed)

**MVP:** versioned immutable definitions; START/END/HUMAN_TASK/APPROVAL_TASK/SYSTEM_TASK/EXCLUSIVE_GATEWAY/basic PARALLEL_SPLIT+JOIN/TIMER_WAIT/EVENT_WAIT(inbound)/ESCALATION/CANCEL; task queues; assignment by user/role/department/branch/entity org node; claim(lease)/reassign/delegate; complete/reject; suspend/resume/cancel; SLA warning+breach on business calendars; escalation events; persistent history; audit integration; **the transactional outbox**; idempotency; concurrency control; incidents+retry.

**Deferred (with codes/enums reserved where noted):** SUB_WORKFLOW execution, COMPENSATION execution, complex compensation, BPMN import/export, graphical designer, arbitrary scripting, distributed choreography, simulation, process mining, AI-generated workflows, hierarchical org-manager routing, team/round-robin/least-loaded assignment, full holiday-calendar admin UI, active-instance version migration, generic per-entity status engine for other modules.

**Never:** autonomous business approvals; cross-tenant workflows (by default); dynamic code plugins / arbitrary code execution; auto-posting journals; direct notification/document I/O.

---

## 9. Acceptance criteria (see IMPLEMENTATION_PLAN §Acceptance for the full checklist)

Stage 2.2 is complete only when: definitions versioned+immutable-after-publish; deterministic transitions; tenant isolation enforced; permissions resolved server-side; concurrency-safe task completion; double completion impossible; append-only history; correct audit emission; transactionally-consistent outbox; reliable deduplicated SLA warnings/breaches; crash-recoverable instances; invalid definitions rejected; arbitrary code execution impossible; all PURE/DB/API/security-negative tests pass; CI Smoke + DB lanes green; implementation PR merged; post-merge certification passes; certification PR merged.

---

## 10. Readiness verdict

### **CONDITIONAL GO**

Architecture, domain model, lifecycle, permissions, audit codes, APIs, events, transaction/outbox model, SLA model, assignment/approval model, security controls, test strategy, observability, MVP/deferred split, ADR drafts, and a commit-by-commit implementation sequence are **complete and grounded in the actual repository contracts**. There is no material architectural blocker.

Implementation may begin **immediately after the following conditions are met**:

1. **C1 (gating): m03-audit is merged into `main` and certified** (its `AUDIT` implementation is the binding m06 depends on). m06 must not stack on the unmerged m03 branch.
2. **C2:** Open decisions **OD-1** (API prefix singular/plural) and **OD-4** (`entity_type_registry` ownership) are confirmed — both have safe defaults but touch conformance/ownership and should be settled to avoid churn. OD-2/OD-3/OD-5/OD-6/OD-7 have safe MVP defaults and can be confirmed during build.
3. **C3:** Stage 2.2 is `approved_for_build` in the manifest by the owner (currently `documented`).

This is **not** a GO purely because documents exist: the verdict is CONDITIONAL specifically on the m03 merge/cert gate (C1) and the two conformance/ownership confirmations (C2). Once C1–C3 clear, the plan in the implementation document can be executed as written.
