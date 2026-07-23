# Stage 2.2 — M06 Enterprise Workflow Engine — Architecture Specification

**Status:** DESIGN / PLANNING ONLY — no runtime code, migrations, or wiring in this document's change.
**Date:** 2026-07-22
**Module:** `m06-workflow` (Foundation domain — the workflow/status/SLA/timeline/outbox spine)
**Build baseline:** `main` @ `cd29b7b5b1c0220fd801989e528d06911395b7a9` — Stage 2.1 m03-audit **merged** (PR #9 → `587a3ce`) and **certified** (PR #11 → `cd29b7b`). (Planning-time baseline was `56b7d3e` with m03 in open PR #9; the build proceeds on the certified `cd29b7b`.)

> Governance position: implementation of m06 must **not** begin until m03-audit is merged and certified,
> because m06 binds the kernel `AUDIT` port's persistent implementation for every audited transition. This
> document prepares the complete engineering package so build can start immediately after that gate.

---

## 1. Current baseline & dependency map

### 1.1 What exists on `main` (certified)
- **kernel** — DI tokens `DB`, `AUDIT`, `AUTHZ`, `OUTBOX` (`packages/kernel/src/tokens.ts`); `Db.withTenant/withSystem` + `Tx` (`db.ts`); `Authz.can/require` (`authz.ts`); `Audit.write(tx, ctx, entry)` (`audit.ts`); `Outbox.publish(tx, event)` (`outbox.ts`); `RequestContext`/`SystemContext` (`request-context.ts`); `ProblemError` RFC 9457 (`problem-error.ts`); `@Endpoint({permission, auditCode})` (`endpoint.ts`).
- **m01-tenant** — tenancy control plane + org hierarchy (`tenant_entities` / `tenant_departments` / `tenant_branches`, composite `(tenant_id, id)` keys, RLS FORCE + `tenant_isolation`).
- **m02-identity / m02-auth** — identity, accounts, memberships, sessions, `ActorContextFactory.forRequest(headers, reason)`.
- **m02-rbac** — `RbacAuthz` (bound to `AUTHZ`), `PermissionResolver` (fills `RequestContext.permissions` server-side per request, no cache), scope model (`platform|tenant|entity|branch|department`, ADR-018), `SodService` (ADR-019).
- **OUTBOX / AUDIT stand-ins** — `RecordingOutbox` and `RecordingAudit` (in `m01-tenant/src/adapters.ts`), in-memory, ignore `tx`. **m06 replaces `RecordingOutbox` with the one authoritative durable outbox.**

### 1.2 Dependency map for m06
| m06 depends on | Consumed via | Never do |
| --- | --- | --- |
| Transactions & RLS | `DB` token → `db.withTenant(ctx, fn)` / `db.withSystem(ctx, fn)`; use the supplied `Tx` | Open its own pg connection/pool |
| Authorization | `AUTHZ` token → `authz.require(ctx, 'workflow.x.y')` | Read headers for permissions; trust client authority |
| Audit | `AUDIT` token → `audit.write(tx, ctx, {code, entityType, entityId, reason?, detail?})` | Duplicate the audit service; write audit outside the business `tx` |
| Event delivery | m06 **owns** `OUTBOX` — implements `Outbox<DomainEvent>` + the single `workflow_event_outbox` table | Add a second outbox / a second event path (ADR-004) |
| Actor / context | `ActorContextFactory.forRequest(headers, reason)` → `RequestContext` | Mint contexts manually |
| Org scoping | Reference m01 node ids (`(tenant_id, id)`); verify in-tenant existence (mirror `orgNodeExists`) | Read m01 tables directly |
| SoD / maker-checker | `SodService` (role/permission incompatibility) + m06's own maker≠checker rule | Re-implement SoD conflict detection |

### 1.3 Downstream (future) consumers of m06
m08 Notifications, m09 Documents, m12 Feedback, m13 Case, Finance/Journal approvals, Reconciliation exceptions, Executive escalation/reporting — all consume m06 **events through the outbox**; m06 calls none of them directly.

---

## 2. Established contracts m06 reuses (not duplicates)

Exact signatures m06 builds against (verbatim from the certified baseline / m03 PR):

```ts
// kernel
interface Tx    { query<TRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<TRow>>; }
interface Db    { withTenant<T>(ctx: RequestContext, fn: (tx: Tx)=>Promise<T>): Promise<T>;
                  withSystem<T>(ctx: SystemContext,  fn: (tx: Tx)=>Promise<T>): Promise<T>; }
interface Authz { can(ctx, permission): Promise<boolean>; require(ctx, permission): Promise<void>; }
interface Audit { write(tx: Tx, ctx, entry: AuditEntry): Promise<void>; }   // same tx as the mutation
interface Outbox<TEvent> { publish(tx: Tx, event: TEvent): Promise<void>; } // m06 IMPLEMENTS this
interface RequestContext { tenantId; userId?; correlationId; permissions: readonly string[]; }
interface SystemContext  { reason: string; correlationId: string; }        // no tenantId/permissions
```

- **Audit scope is derived from the session GUC** `app.tenant_id` (m03 `sessionScope`), not from the passed ctx — so m06 just passes the same `tx` it got from `withTenant`, and the audit row's tenant scope, RLS, and hash chain are automatically correct.
- **`ProblemError`** has static `unauthorized(401)/forbidden(403)/notFound(404)/conflict(409)/internal(500)`. **There is no static `badRequest`** — 400s use the inline validation type `https://finapp.dynamics/problems/validation` (mirror `apps/api/src/identity/http.ts`).
- **`@Endpoint` validators (fail-closed at class-definition / boot):** permission `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$` (exactly 3 segments); auditCode `^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`. Route prefix, permission namespace, event family, and audit prefix are cross-checked against `naming-map.yaml`.

### 2.1 m06 naming axes (authoritative, from `naming-map.yaml`)
| Axis | Reserved value |
| --- | --- |
| API prefix | `/api/v1/workflow` (**singular** — see Open Decision OD-1) |
| Permission namespace | `workflow.*` (three-segment codes) |
| Event family | `workflow.lifecycle` (currently **GAP-1**: not registered in `event-registry.yaml`) |
| Audit prefix | `WORKFLOW_` |

---

## 3. Purpose & non-goals of m06

**Purpose.** A tenant-configurable, versioned, **generic** workflow orchestration engine providing: process orchestration, task routing/assignment, state management (per-entity status machines), SLA tracking, escalation, and fully-auditable transitions — reusable by Feedback (m12), Legal Case (m13), Finance approvals, Reconciliation exceptions, Document approvals, Risk/compliance, Executive escalations, and future modules.

**m06 MUST provide:** orchestration, task routing, state management, SLA tracking, escalation, auditable transitions, and the single transactional outbox.

**m06 MUST NOT (hard non-goals):**
| Non-goal | Why / who owns it |
| --- | --- |
| Make autonomous business approvals | Humans decide; m06 records/orchestrates decisions (ADR-011, CLAUDE.md) |
| Bypass RBAC / human approval controls | All transitions gated by `AUTHZ`; maker≠checker enforced |
| Post accounting entries / disburse funds | Journal engine (draft-only, maker-checker); never auto-post |
| Send notifications directly | m08-notify (m06 emits events; m08 consumes) |
| Own document storage | m09-docs |
| Duplicate the audit service | m03-audit via `AUDIT` port |
| Hard-code Feedback/Legal/Finance workflows into the core | Engine is generic; business processes are **data** (published definitions) |

---

## 4. Domain model

**Conventions applied to every table** (unless noted global): composite PK `(tenant_id, id)`; RLS `ENABLE` + `FORCE` with the `tenant_isolation` policy (`tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`); composite FKs referencing `(tenant_id, …)`; `version integer NOT NULL DEFAULT 1` for optimistic concurrency on mutable aggregates; `created_at/created_by`, `updated_at/updated_by` where mutable; **no physical DELETE** (grants withhold DELETE; retirement via status + `retired_at/retired_by`); history tables are **append-only via GRANT** — the app role gets `SELECT, INSERT` only (the repo convention proven by `tenant_status_history` / `role_status_history`, ADR-005/010; **not** triggers), written in the same tx as the change so they cannot disagree; the outbox may add m03-style `no_update/no_delete/no_truncate` trigger hardening as defense-in-depth. Retention: operational tables live-then-archive; history/audit retained per policy.

### A. Definition (authoring) aggregates

| Table | Purpose | Tenant | PK / business key | Version | Lifecycle | Immutable after | Notable constraints / indexes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `workflow_definition` | Logical workflow (a named process) | tenant | `(tenant_id, id)` / `(tenant_id, code)` unique | `version` | DRAFT→…→RETIRED | code immutable | UNIQUE `(tenant_id, code)`; idx `(tenant_id, status)` |
| `workflow_definition_version` | An immutable published revision of a definition | tenant | `(tenant_id, id)` / `(tenant_id, definition_id, version_number)` | n/a (immutable) | DRAFT→VALIDATED→PUBLISHED→ACTIVE→RETIRED→ARCHIVED | **PUBLISHED** (content frozen) | UNIQUE `(tenant_id, definition_id, version_number)`; `spec jsonb NOT NULL` (the validated definition doc, §15); `content_hash text` |
| `workflow_node` | A node within a version (denormalized from spec for querying/FK integrity) | tenant | `(tenant_id, id)` / `(tenant_id, version_id, node_key)` | n/a | — | with version | `node_type` enum (§5); `config jsonb`; UNIQUE `(tenant_id, version_id, node_key)` |
| `workflow_transition_definition` | An edge between nodes | tenant | `(tenant_id, id)` / `(tenant_id, version_id, transition_key)` | n/a | — | with version | FKs to `workflow_node` (from/to); `condition jsonb` (safe expr, §15) |
| `workflow_variable_definition` | Declared process variables + types | tenant | `(tenant_id, id)` / `(tenant_id, version_id, name)` | n/a | — | with version | `data_type` enum (string/number/bool/date/enum/ref); `required bool`; UNIQUE `(tenant_id, version_id, name)` |
| `workflow_sla_definition` | SLA targets attached to version/node | tenant | `(tenant_id, id)` | n/a | — | with version | `sla_type` (response/completion/resolution); `target_seconds`; `warn_pct`; `calendar_ref` |
| `workflow_assignment_rule` | Declarative routing for a node | tenant | `(tenant_id, id)` | n/a | — | with version | `strategy` enum (§11); `params jsonb` |
| `workflow_escalation_rule` | Escalation ladder for SLA/inactivity | tenant | `(tenant_id, id)` | n/a | — | with version | `trigger` (warn/breach/inactivity); `ladder jsonb` (ordered steps) |
| `workflow_deployment` | Records activation of a version (which version is live for a definition) | tenant | `(tenant_id, id)` | n/a | append-only | yes | idx `(tenant_id, definition_id, activated_at)`; at most one ACTIVE version per definition |

### B. Runtime aggregates

| Table | Purpose | Tenant | PK / key | Version | Lifecycle | Notable |
| --- | --- | --- | --- | --- | --- | --- |
| `workflow_instance` | A running process (bound to one version) | tenant | `(tenant_id, id)` | `version` (optimistic) | CREATED→RUNNING→WAITING→SUSPENDED→(COMPLETED/CANCELLED/FAILED/COMPENSATING) | `definition_version_id` FK (frozen); `business_key` (idempotent start); `subject_type/subject_id` (the record it governs); `variables_snapshot jsonb`; UNIQUE `(tenant_id, definition_id, business_key)` where business_key not null |
| `workflow_token` | Execution marker(s) at nodes (token accounting for gateways) | tenant | `(tenant_id, id)` | `version` | active/consumed | `instance_id`, `node_key`, `status`; parallel branches = multiple tokens; deterministic join accounting |
| `workflow_task` | A unit of human/system work | tenant | `(tenant_id, id)` | `version` | CREATED→AVAILABLE→CLAIMED→IN_PROGRESS→(COMPLETED/REJECTED/DELEGATED/ESCALATED/CANCELLED/EXPIRED/FAILED) | `instance_id`, `node_key`, `task_type`, `assignee_*`, `due_at`; idx `(tenant_id, status, due_at)` |
| `workflow_task_assignment` | Current + historical assignment of a task | tenant | `(tenant_id, id)` | n/a (append rows) | active/released | `assignee_kind` (user/role/team/queue), `assignee_ref`, `lease_expires_at` (reservation), `assigned_by` |
| `workflow_transition` | An executed transition (runtime edge fired) | tenant | `(tenant_id, id)` | append-only | — | `instance_id`, `from_node`, `to_node`, `fired_by`, `fired_at`, `correlation_id` |
| `workflow_variable` | Live variable values for an instance | tenant | `(tenant_id, id)` / `(tenant_id, instance_id, name)` | `version` | — | typed value columns / `value jsonb`; UNIQUE `(tenant_id, instance_id, name)` |
| `workflow_timer` | Scheduled wake-ups (TIMER_WAIT, SLA warn/breach, escalation) | tenant | `(tenant_id, id)` | `version` | scheduled→fired/cancelled | `fire_at`, `kind`, `dedupe_key` UNIQUE (prevents double firing), `instance_id`, `node_key`; idx `(fire_at) WHERE status='scheduled'` |
| `workflow_sla_clock` | Elapsed-business-time accounting per SLA target | tenant | `(tenant_id, id)` | `version` | running/paused/stopped | `sla_definition_id`, `started_at`, `accumulated_seconds`, `paused_at`, `calendar_ref`, `warn_at`, `breach_at` |
| `workflow_escalation` | An escalation raised for a task/instance | tenant | `(tenant_id, id)` | `version` | open→acknowledged→resolved | `level`, `reason`, `target_ref` |
| `workflow_event_outbox` | **The single transactional outbox** (all domain events) | mixed (tenant + platform) | `(id)` global row, `tenant_id` nullable | n/a | pending→dispatched→dead_letter | `envelope jsonb`, `family`, `type`, `dedupe_key`, `available_at`, `attempts`, `dispatched_at`; idx `(status, available_at)`. Append-only insert in business tx; dispatcher updates status only |
| `workflow_incident` | A recoverable failure (system-task error, stuck timer, poison event) | tenant | `(tenant_id, id)` | `version` | open→investigating→resolved/won't_fix | `instance_id?`, `task_id?`, `error_code`, `error_detail jsonb` (no secrets), `retry_count` |

### C. History & governance (append-only)

| Table | Purpose | Tenant | Notes |
| --- | --- | --- | --- |
| `workflow_instance_history` | Every instance state change | tenant | `(from_status,to_status,action,reason,correlation_id,changed_by,at)`; insert+select only |
| `workflow_task_history` | Every task state change | tenant | as above, per task |
| `workflow_definition_change_log` | Authoring changes (draft edits, validate, publish, activate, retire) | tenant | who/what/when; publish freezes content |
| `workflow_cancellation` | Cancellation records (instance/task) with reason + actor | tenant | append-only; reason_required |
| `workflow_compensation_record` | Compensation actions taken during COMPENSATING | tenant | `compensated_node`, `outcome`, `correlation_id`; append-only |

**Audit expectations:** every controlled mutation on A/B tables writes a `WORKFLOW_*` audit entry in the same `tx` (§8). History tables are the *operational* record; the audit spine (m03) is the *evidential* record — both are written, neither replaces the other.

**RLS expectations:** all tables above are tenant-scoped FORCE **except** `workflow_event_outbox`, which is mixed-scope (a platform dispatcher must read across tenants) and follows the m03 `audit_events` pattern: `scope_key` + nullable `tenant_id`, tenant rows visible under RLS, platform rows only under `app.system_context='on'`.

**Concurrency:** mutable aggregates (`workflow_instance`, `workflow_task`, `workflow_token`, `workflow_variable`, `workflow_timer`, `workflow_sla_clock`) carry `version`; every state-changing UPDATE is `… WHERE id=$1 AND version=$expected` and a 0-row result is a stale-command `409`.

---

## 5. Node types (MVP vs deferred)

Execution semantics are deterministic (no wall-clock/random in evaluation). "Authorization" = the permission the transition/task requires; enforced server-side at execution time (not just at task creation).

| Node type | MVP? | Required config | In / out | Semantics | Retry | Timeout | Auth | Audit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| START | MVP | none | 0 in / 1 out | Instance entry; mints first token | n/a | n/a | `workflow.instance.start` | `WORKFLOW_INSTANCE_STARTED` |
| END | MVP | none | ≥1 in / 0 out | Consumes token; when no tokens remain → instance COMPLETED | n/a | n/a | none (system) | `WORKFLOW_INSTANCE_COMPLETED` |
| HUMAN_TASK | MVP | assignment rule, form/config, optional SLA | 1 / ≥1 | Creates a `workflow_task`; waits for completion | n/a | via SLA/timer | `workflow.task.complete` (re-eval at completion) | `WORKFLOW_TASK_*` |
| APPROVAL_TASK | MVP | approval policy (§12), assignment | 1 / ≥2 (approve/reject paths) | Human approve/reject/return; maker≠checker enforced | n/a | via SLA | `workflow.task.complete` + policy | `WORKFLOW_TASK_COMPLETED` |
| SYSTEM_TASK | MVP | handler key (allow-listed), input mapping | 1 / ≥1 | Invokes a **registered, allow-listed** internal handler (no arbitrary code); on error → incident | bounded retries (idempotent) | yes | `workflow.instance.retry` (for retry) | `WORKFLOW_TASK_*`, `WORKFLOW_INCIDENT_CREATED` |
| EXCLUSIVE_GATEWAY | MVP | ordered conditions + default | 1 / ≥2 | Evaluates safe conditions (§15); routes to first true / default | n/a | n/a | none | `WORKFLOW_TRANSITION_EXECUTED` |
| PARALLEL_SPLIT | MVP (basic) | branch list | 1 / ≥2 | Mints one token per outgoing branch | n/a | n/a | none | `WORKFLOW_TRANSITION_EXECUTED` |
| PARALLEL_JOIN | MVP (basic) | expected branch count | ≥2 / 1 | Deterministic token accounting; fires when all expected tokens arrived | n/a | n/a | none | `WORKFLOW_TRANSITION_EXECUTED` |
| TIMER_WAIT | MVP | duration/at (bounded ≤ max horizon) | 1 / 1 | Schedules a `workflow_timer`; resumes on fire | n/a | horizon cap | none | `WORKFLOW_TIMER_SCHEDULED/FIRED` |
| EVENT_WAIT | MVP (inbound correlation only) | event correlation key | 1 / 1 | Waits for a correlated inbound signal (via outbox-consumer callback into the engine); no external polling | n/a | via SLA | none | `WORKFLOW_TRANSITION_EXECUTED` |
| ESCALATION | MVP | ladder ref | 1 / ≥1 | Raises `workflow_escalation`; emits event | n/a | n/a | none (system) | `WORKFLOW_TASK_ESCALATED` |
| CANCEL | MVP | scope (instance/branch) | 1 / 0..1 | Cancels tokens/tasks in scope | n/a | n/a | `workflow.instance.cancel` | `WORKFLOW_INSTANCE_CANCELLED` |
| SUB_WORKFLOW | **Deferred** (depth-capped stub in MVP) | child definition ref | 1 / 1 | Starts a child instance; parent waits | n/a | via SLA | `workflow.instance.start` | events |
| COMPENSATION | **Deferred** (record-only in MVP) | compensating handler | 1 / 1 | Runs compensating action during COMPENSATING | bounded | yes | system | `WORKFLOW_COMPENSATION_*` |

**Invalid configurations (rejected at validate/publish):** unreachable nodes; missing START/END; EXCLUSIVE_GATEWAY without default and non-exhaustive conditions; PARALLEL_JOIN whose expected count can't be satisfied by upstream splits; dangling transitions; SYSTEM_TASK referencing an unregistered handler; node counts exceeding limits (§16); cyclic references beyond declared loop bounds.

---

## 6. Lifecycles (state machines)

### 6.1 Workflow Definition (version)
`DRAFT → VALIDATED → PUBLISHED → ACTIVE → RETIRED → ARCHIVED`
- Allowed: DRAFT→VALIDATED (validation passes); VALIDATED→PUBLISHED (freeze content, immutable); PUBLISHED→ACTIVE (deploy; becomes the live version, prior ACTIVE→RETIRED); ACTIVE→RETIRED (stop new instances; running instances continue on their frozen version); RETIRED→ARCHIVED (cold storage).
- Prohibited: any edit of PUBLISHED+ content; DRAFT→PUBLISHED (must validate first); reactivating ARCHIVED; two ACTIVE versions of one definition.
- Terminal: ARCHIVED. Idempotent: re-publish/activate of the same version is a no-op returning the current state.

### 6.2 Workflow Instance
`CREATED → RUNNING → WAITING → SUSPENDED → {COMPLETED | CANCELLED | FAILED | COMPENSATING}`
- Allowed: CREATED→RUNNING (start); RUNNING↔WAITING (blocks on task/timer/event); RUNNING/WAITING→SUSPENDED (admin) and back (resume); RUNNING→COMPLETED (all tokens ended); any non-terminal→CANCELLED; RUNNING→FAILED (unrecoverable) ; FAILED→COMPENSATING→(CANCELLED/FAILED) (deferred compensation).
- Prohibited: mutating a terminal instance; resuming a CANCELLED/COMPLETED/FAILED instance; transitions on a SUSPENDED instance (must resume first).
- Terminal: COMPLETED, CANCELLED, FAILED. Idempotent: start with the same `business_key` returns the existing instance.

### 6.3 Workflow Task
`CREATED → AVAILABLE → CLAIMED → IN_PROGRESS → {COMPLETED | REJECTED | DELEGATED | ESCALATED | CANCELLED | EXPIRED | FAILED}`
- Allowed: CREATED→AVAILABLE (published to queue/assignee); AVAILABLE→CLAIMED (claim, sets lease); CLAIMED→IN_PROGRESS; IN_PROGRESS→COMPLETED/REJECTED; AVAILABLE/CLAIMED→DELEGATED/ESCALATED/CANCELLED/EXPIRED; any active→FAILED (system).
- Prohibited: completing an unclaimed task; completing by a non-assignee; re-completing a terminal task (duplicate-completion → `409`); claiming a claimed task (unless lease expired).
- Terminal: COMPLETED, REJECTED, CANCELLED, EXPIRED, FAILED (DELEGATED/ESCALATED produce a new/rerouted task).

### 6.4 Concurrency & command semantics (all lifecycles)
- **Optimistic concurrency:** every mutation carries `expectedVersion`; 0-row update ⇒ `409 stale version`.
- **Only one valid completion wins:** task completion is `UPDATE … WHERE id=$1 AND status IN (claimed,in_progress) AND version=$v`; the loser gets `409 task already completed`.
- **Idempotent operations:** start (business_key), claim (same actor re-claim = no-op), timer fire (dedupe_key), event ingestion (dedupe_key) — safe to retry, return prior result where safe.
- **Stale command:** rejected with `409`, no state change. **Duplicate command:** returns the prior result (idempotency key) rather than double-applying.
- **Failure recovery:** engine state is fully persisted; after a process crash, a recovery pass re-derives runnable work from `workflow_timer` (due), `workflow_task` (available), `workflow_event_outbox` (pending), and open `workflow_incident`s — no in-memory-only state.

---

## 7. Authorization model

**Rules (non-negotiable):** default deny; permissions resolved **server-side** by `PermissionResolver` (never from headers); no self-assignment escalation; no cross-tenant assignment (RLS + tenant-context); SystemContext is not a universal allow; platform and tenant permissions separate; maker-checker/SoD supported; **completion authorization re-evaluated at execution time** (a permission revoked after task creation blocks completion); task assignment does not itself grant unrelated workflow permissions.

**Scope rules** reuse ADR-018 levels (`platform|tenant|entity|branch|department`, exact-node containment) plus workflow-specific subjects: assigned user, assigned role, workflow owner (definition creator/owner), platform administrator. A task action requires *both* the permission *and* (for claim/complete) that the actor is a legitimate assignee (or holds `workflow.task.reassign`/`workflow.engine.administer`).

### 7.1 Proposed `permission-registry.yaml` additions (NOT applied yet)
Mirror the `rbac.*` row shape; **all codes are exactly three segments** (`workflow.<entity>.<action>`). Note the task's `workflow.admin` is 2 segments and **invalid** under the `@Endpoint` validator → renamed `workflow.engine.administer`.

```yaml
  - {namespace: "workflow.*", module: m06-workflow, mvp: true, status: implemented, substage: "2.2",
     codes: ["workflow.definition.create", "workflow.definition.view", "workflow.definition.edit",
             "workflow.definition.validate", "workflow.definition.publish", "workflow.definition.activate",
             "workflow.definition.retire",
             "workflow.instance.start", "workflow.instance.view", "workflow.instance.suspend",
             "workflow.instance.resume", "workflow.instance.cancel", "workflow.instance.retry",
             "workflow.task.view", "workflow.task.claim", "workflow.task.assign", "workflow.task.reassign",
             "workflow.task.complete", "workflow.task.reject", "workflow.task.delegate", "workflow.task.escalate",
             "workflow.incident.view", "workflow.incident.resolve",
             "workflow.engine.administer"]}     # replaces the invalid 2-segment "workflow.admin"
```

24 permissions. `workflow.engine.administer` is the break-glass/admin capability (platform + tenant-admin scoped).

---

## 8. Audit model

Every controlled mutation writes a `WORKFLOW_*` code via `audit.write(tx, ctx, entry)` **in the same transaction** as the state change (so audit and state commit/rollback together). Codes are SCREAMING_SNAKE `WORKFLOW_<ENTITY>_<ACTION>` (≥3 segments). Failure to audit **fails the business action** (the audit insert is in the same tx). Denials/indeterminate use m03's independent-transaction `recordAuthorizationDecision` so evidence survives a rolled-back business tx.

### 8.1 Proposed `audit-code-registry.yaml` additions (NOT applied yet)
`{code, module: m06-workflow, severity, reason_required}`; bump `registered_code_count` by the number added. `severity ∈ {normal, elevated, critical}`; terminal/adverse outcomes set `reason_required: true`.

| Code | severity | reason_required | Same-tx | Notes |
| --- | --- | --- | --- | --- |
| `WORKFLOW_DEFINITION_CREATED` | normal | false | yes | subject: definition |
| `WORKFLOW_DEFINITION_UPDATED` | normal | false | yes | draft edit |
| `WORKFLOW_DEFINITION_VALIDATED` | normal | false | yes | |
| `WORKFLOW_DEFINITION_PUBLISHED` | elevated | false | yes | content freeze |
| `WORKFLOW_DEFINITION_ACTIVATED` | elevated | false | yes | governs live routing |
| `WORKFLOW_DEFINITION_RETIRED` | elevated | true | yes | reason required |
| `WORKFLOW_INSTANCE_STARTED` | normal | false | yes | |
| `WORKFLOW_INSTANCE_SUSPENDED` | elevated | true | yes | |
| `WORKFLOW_INSTANCE_RESUMED` | normal | false | yes | |
| `WORKFLOW_INSTANCE_COMPLETED` | normal | false | yes | |
| `WORKFLOW_INSTANCE_CANCELLED` | elevated | true | yes | |
| `WORKFLOW_INSTANCE_FAILED` | critical | true | yes | critical → reason required |
| `WORKFLOW_TASK_CREATED` | normal | false | yes | |
| `WORKFLOW_TASK_ASSIGNED` | normal | false | yes | |
| `WORKFLOW_TASK_CLAIMED` | normal | false | yes | |
| `WORKFLOW_TASK_REASSIGNED` | elevated | true | yes | who→whom |
| `WORKFLOW_TASK_COMPLETED` | normal | false | yes | approval decision recorded here |
| `WORKFLOW_TASK_REJECTED` | elevated | true | yes | |
| `WORKFLOW_TASK_DELEGATED` | elevated | true | yes | |
| `WORKFLOW_TASK_ESCALATED` | elevated | true | yes | |
| `WORKFLOW_TASK_EXPIRED` | elevated | false | yes | SLA-driven |
| `WORKFLOW_TRANSITION_EXECUTED` | normal | false | yes | high-volume; consider summarised |
| `WORKFLOW_TIMER_SCHEDULED` | normal | false | yes | |
| `WORKFLOW_TIMER_FIRED` | normal | false | yes | |
| `WORKFLOW_SLA_WARNING` | elevated | false | yes | |
| `WORKFLOW_SLA_BREACHED` | critical | true | yes | critical |
| `WORKFLOW_INCIDENT_CREATED` | critical | true | yes | |
| `WORKFLOW_INCIDENT_RESOLVED` | elevated | true | yes | |
| `WORKFLOW_COMPENSATION_STARTED` | elevated | true | yes | deferred node, code reserved |
| `WORKFLOW_COMPENSATION_COMPLETED` | elevated | false | yes | reserved |
| `WORKFLOW_COMPENSATION_FAILED` | critical | true | yes | reserved |

31 codes (some reserved for deferred compensation). Actor requirements: human actions carry `ctx.userId`; system-driven (timer/SLA/incident) record `system_process` per m03. Tenant scope auto-derived from session GUC.

---

## 9. Transaction & consistency model

**Authoritative rules:**
1. Workflow state mutation **and** its audit append occur atomically (same `tx`).
2. Task completion **and** the resulting transition(s)/token accounting occur in one `tx`.
3. Only one valid completion wins (optimistic `version` + status guard).
4. Optimistic locking prevents double completion (0-row update ⇒ 409).
5. Parallel gateways use **deterministic token accounting** (row-level `workflow_token` inserts/consumes under the instance's advisory lock, mirroring m03's `pg_advisory_xact_lock` per-scope serialization).
6. Timer scheduling and workflow state mutation are atomic (both in the completing `tx`).
7. Outbound integration events go through the **outbox** (`workflow_event_outbox`), published in the same `tx` via `Outbox.publish(tx, event)`.
8. **No direct external calls inside the core transaction** (no HTTP/notification/document calls in-tx; only DB work + outbox enqueue).
9. Retries must be idempotent (idempotency keys on start/complete/system-task handlers).
10. Duplicate requests return the prior result where safe (idempotency-key table).
11. Partial transitions never externally visible (all-or-nothing tx; dispatcher only sees committed outbox rows).
12. Execution recoverable after process failure (state fully in DB; recovery pass re-derives work).

### 9.1 Outbox ownership recommendation (explicit)
**Recommendation: m06 OWNS a single durable outbox — the `workflow_event_outbox` table — and provides the one `Outbox<DomainEvent>` implementation bound to the kernel `OUTBOX` token, replacing `RecordingOutbox`.**

Justification: (a) `naming-map.yaml` and ADR-004 already assign the sole outbox to m06 ("Owns OUTBOX — the only event-delivery path… All other modules publish through it"); (b) the kernel `Outbox.publish(tx, event)` contract already threads the caller's `tx`, so swapping the stand-in for the durable table changes **no call site** (m01/m02 already call `publish(tx, …)`); (c) a single outbox table gives one dispatcher, one dead-letter/replay path, one ordering key, and one place to reason about exactly-once *intent*. A shared abstraction with per-module tables would reintroduce the multiple-event-path failure mode CLAUDE.md forbids. The dispatcher (poll `status='pending' AND available_at<=now()`, mark dispatched/dead_letter) is an operational concern that can ship minimally in MVP (at-least-once with idempotent consumers) and harden later.

---

## 10. SLA engine

**Supported:** response SLA, task-completion SLA, workflow-resolution SLA; warning + breach thresholds; escalation ladder; pause/resume; business hours, weekends, public holidays, tenant calendars; severity-based and product-specific SLA; reassignment/delegation/suspension effects; force-majeure/manual pause; breach history.

**Design:**
- **Clocks stored** in `workflow_sla_clock` (`started_at`, `accumulated_seconds`, `paused_at`, `warn_at`, `breach_at`, `calendar_ref`). Elapsed **business time** = sum of intervals intersected with the tenant business calendar (open hours minus weekends/holidays), not wall-clock.
- **Timers scheduled** via `workflow_timer` rows (`fire_at` computed from the calendar; `dedupe_key` UNIQUE prevents double firing). A single scheduler wakes due timers and re-enters the engine.
- **Warnings/breaches emitted** as `WORKFLOW_SLA_WARNING` / `WORKFLOW_SLA_BREACHED` audit codes + `workflow.sla.warning` / `workflow.sla.breached` events (outbox → m08 consumes). Deduped by the timer `dedupe_key` and clock state (a breach fires once).
- **Pause/resume:** SUSPEND, delegation gaps, and force-majeure pause the clock (`paused_at`); resume adds elapsed to `accumulated_seconds` and reschedules.
- **In-flight instances:** **Published versions are immutable; a running instance retains the version + SLA configuration it started under.** SLA changes apply only to new instances unless an explicit, governed **active-instance migration** (deferred, audited) is performed.

---

## 11. Assignment & routing

| Strategy | MVP? | Notes |
| --- | --- | --- |
| Named user | MVP | direct assignee |
| Role | MVP | any holder of a role (via m02) → queue |
| Department | MVP | org-node-scoped queue (m01 node id) |
| Team | Deferred | needs a team model (not in m01/m02 yet) |
| Branch / Business unit | MVP (branch/entity via m01 nodes) | org-scoped |
| Round-robin / Least-loaded | Deferred | needs load metrics |
| Rule-based | Deferred (basic condition MVP) | via m07 rules when available |
| Relationship/Case owner, Manager-of | Deferred | needs relationship/org-manager model |
| Escalation chain | MVP | via escalation rule ladder |
| Unassigned queue | MVP | AVAILABLE tasks with no direct assignee |

**Claim model:** a task is AVAILABLE to eligible actors; **claim** takes a **lease** (`lease_expires_at`) — a reservation so two agents don't work the same task; an expired lease returns the task to AVAILABLE. **Reassign** (needs `workflow.task.reassign`), **delegate** (assignee → another, audited), **substitution/absence** (deferred; manual reassign in MVP). **Conflict-of-interest / maker-checker:** the engine blocks assigning/completing a task to the same identity that performed the maker action on the subject (§12); consults `SodService` for role/permission incompatibility. **Assignment expiry** via SLA/timer. All assignment changes audited (`WORKFLOW_TASK_ASSIGNED/REASSIGNED/DELEGATED`).

---

## 12. Human approval controls

**Decisions:** approve, reject, return-for-correction, request-more-information, abstain, delegate, escalate — recorded on task completion (`WORKFLOW_TASK_COMPLETED` with decision in `detail`/history).

**Policies:** single approver; sequential; parallel; unanimous; quorum (N-of-M); first-response-wins; amount-based approval matrix; risk-based routing; override-with-reason. **Controls:** **no self-approval** (approver ≠ the maker/requester of the subject action); **no approval after permission revocation** (re-evaluated at completion time); **duplicate approval prevention** (idempotent completion + version guard).

**Boundary statement (explicit):** *m06 records and orchestrates approval decisions but does not independently make the underlying business decision.* The business module (Finance journal, Legal action, Feedback resolution) owns the decision's meaning and effect; m06 routes the human decision and enforces separation-of-duties/quorum. **Open Decision OD-2:** boundary vs `m22-approval` (dedicated approval module) — recommend m06 provides the generic APPROVAL_TASK node and m22 (if built) provides higher-order approval-matrix policy consumed by m06.

---

## 13. API catalogue

Base prefix `/api/v1/workflow` (see OD-1 re: singular/plural). Every mutating route: NestJS `@Controller('workflow')` + kernel `@Endpoint({permission, auditCode})`; actor via `ActorContextFactory.forRequest`; permission enforced **inside the service**; idempotency via `Idempotency-Key` header on start/complete/mutations. All errors are `application/problem+json`.

**Definitions**
| Method + path | Permission | Idempotent |
| --- | --- | --- |
| POST `/definitions` | `workflow.definition.create` | key |
| GET `/definitions` / `/definitions/:id` | `workflow.definition.view` | n/a |
| POST `/definitions/:id/versions` | `workflow.definition.edit` | key |
| POST `/definitions/:id/validate` | `workflow.definition.validate` | idempotent |
| POST `/definitions/:id/publish` | `workflow.definition.publish` | idempotent (no-op if published) |
| POST `/definitions/:id/activate` | `workflow.definition.activate` | idempotent |
| POST `/definitions/:id/retire` | `workflow.definition.retire` | idempotent |

**Instances**
| Method + path | Permission |
| --- | --- |
| POST `/instances` (start; `business_key` idempotent) | `workflow.instance.start` |
| GET `/instances` / `/instances/:id` | `workflow.instance.view` |
| POST `/instances/:id/suspend` \| `/resume` \| `/cancel` \| `/retry` | `workflow.instance.{suspend,resume,cancel,retry}` |

**Tasks**
| Method + path | Permission |
| --- | --- |
| GET `/tasks` / `/tasks/:id` | `workflow.task.view` |
| POST `/tasks/:id/claim` \| `/assign` \| `/reassign` | `workflow.task.{claim,assign,reassign}` |
| POST `/tasks/:id/complete` \| `/reject` \| `/delegate` \| `/escalate` | `workflow.task.{complete,reject,delegate,escalate}` |

**Incidents**
| Method + path | Permission |
| --- | --- |
| GET `/incidents` | `workflow.incident.view` |
| POST `/incidents/:id/resolve` | `workflow.incident.resolve` |
| POST `/incidents/:id/retry` | `workflow.instance.retry` |

### 13.1 Standard error mapping
| Condition | HTTP | ProblemError |
| --- | --- | --- |
| Invalid transition | 409 | `conflict` |
| Stale version | 409 | `conflict` ("stale version") |
| Task already completed | 409 | `conflict` |
| Workflow not active | 409 | `conflict` |
| Assignment conflict | 409 | `conflict` |
| SoD conflict | 409 | `conflict` (generic, detail internal) |
| Forbidden action | 403 | `forbidden` |
| Tenant mismatch | 404 | `notFound` (invisible, not 403 — no enumeration oracle) |
| Invalid definition | 400 | inline validation type |
| Timer already fired | 409 | `conflict` (idempotent no-op) |
| Duplicate idempotency key | 409 or replay prior result | `conflict` / prior 2xx |
| Suspended workflow | 409 | `conflict` |
| Terminal workflow | 409 | `conflict` |
| Unresolved incident | 409 | `conflict` |

---

## 14. Events & integration contracts

m06 emits `workflow.lifecycle`-family events **through the outbox** (never calls m08 directly). Registering the family closes **GAP-1**. Envelope fields (from `DomainEventEnvelope`): `eventId, family, type, version, occurredAt, tenantId, correlationId, causationId?, actor?, classification, payload`.

### 14.1 Proposed `event-registry.yaml` addition (NOT applied yet)
```yaml
  - {group: workflow, families: [workflow.lifecycle], mvp: true, status: implemented, owner: m06-workflow,
     classification: confidential,
     note: "Stage 2.2. Definition/instance/task/SLA/incident lifecycle; payload v1. Delivered via the single
            transactional outbox (ADR-004). Closes GAP-1 (naming-map event_family_registered -> true)."}
```
Plus `packages/contracts/src/workflow-events.ts` (family const, version, type union, per-aggregate payloads) appended to the `DomainEvent` union and `DOMAIN_EVENT_FAMILIES` tail in `events.ts`.

### 14.2 Event types (within `workflow.lifecycle`, v1)
| Event `type` | Aggregate | Tenant | Ordering key | Delivery |
| --- | --- | --- | --- | --- |
| `workflow.definition.published` | definition_version | required | definition_id | at-least-once |
| `workflow.instance.started` / `.completed` / `.cancelled` / `.failed` | instance | required | instance_id | at-least-once |
| `workflow.task.created` / `.assigned` / `.completed` / `.rejected` / `.escalated` | task | required | task_id | at-least-once |
| `workflow.sla.warning` / `.breached` | sla_clock | required | instance_id | at-least-once |
| `workflow.incident.created` / `.resolved` | incident | required | incident_id | at-least-once |

Each event: schema version `1`; `correlationId` propagated from the triggering request; `causationId` = the command/event that caused it; **idempotency/dedupe key** = `(type, aggregate_id, version)` for consumer dedup; **ordering key** = aggregate id (per-aggregate order); **replay** supported from the outbox (idempotent consumers); **classification** `confidential` by default (payloads carry ids/keys, **not** business-sensitive values). **Future consumers:** m08 (notifications on task/SLA), m09 (document approvals), m12 (feedback), m13 (case), Finance (approval routing), Reconciliation (exception handling), Executive reporting (metrics).

---

## 15. Workflow definition format

**Recommendation: a versioned, declarative JSON document** (`spec jsonb` on `workflow_definition_version`), JSON-Schema-validated at `validate`/`publish`, immutable after publish, deterministic, and **incapable of arbitrary code / SQL / shell / network**.

**Structure:** `{ schemaVersion, code, name, variables[], nodes[], transitions[], sla[], assignment[], escalation[], metadata }`. Node IDs (`node_key`) and transition IDs (`transition_key`) are stable string keys unique within the version. Conditions and computed values use a **safe, sandboxed expression model** — *not* JavaScript/`eval`.

**Safe condition-expression model (recommendation):** a small, side-effect-free boolean/arithmetic mini-language over declared workflow variables and a fixed, allow-listed function set (comparison, logical, arithmetic, `in`, date-compare). Parsed to an AST and **interpreted** (no host `eval`, no dynamic code, no property access into host objects, no I/O). Only declared variables are addressable; unknown identifiers are a validation error. Alternatives considered: (a) full JS via `vm` — rejected (sandbox-escape risk, non-determinism); (b) JSONLogic — acceptable fallback but still needs an allow-list; (c) a decision-table reference to m07 rules — the long-term home for complex logic (deferred). **Validation errors** are structured (`{path, code, message}`) and returned on `validate`.

**Prohibited in a definition:** raw SQL, shell, arbitrary URLs/network calls, references to unregistered system-task handlers, expressions with side effects or host access.

---

## 16. Security controls

| Threat | Control |
| --- | --- |
| Tenant isolation / RLS | Every table RLS FORCE + `tenant_isolation`; all work inside `withTenant`; outbox mixed-scope like m03 |
| Authorization / privilege escalation | `authz.require` default-deny; server-side resolved permissions; no header authority |
| Self-approval | maker ≠ checker enforced at completion; SoD consulted |
| Cross-tenant assignment | RLS + tenant context; assignee refs validated in-tenant |
| Replay / duplicate completion | idempotency keys; optimistic `version` guards; single-winner completion |
| Payload tampering / mass assignment | strict DTO allow-lists; server owns state transitions; clients cannot set status/version |
| Expression / SQL injection / arbitrary code | sandboxed interpreted expressions; parameterized SQL only; no `eval`/`vm`; no raw SQL in definitions |
| Event spoofing | events minted server-side into the outbox; clients cannot publish |
| Audit suppression | audit in same tx (fails business action if it fails); append-only; m03 hash chain |
| Timer / SLA manipulation | timers/clocks server-owned; `dedupe_key`; no client-set fire times beyond bounded config |
| Unauthorized definition publication | `workflow.definition.publish/activate` gated; publish freezes content |
| Stale workflow versions | running instances pinned to frozen version; governed migration only |
| Malicious variables / sensitive leakage | typed/size-bounded variables; classification `confidential`; no payload values in logs by default |
| DoS via loops | bounded loop count; max nodes/transitions/parallel branches/sub-workflow depth/timer horizon |

**Hard limits (validated at publish; configurable ceilings):**
| Limit | Default ceiling |
| --- | --- |
| Max nodes / version | 200 |
| Max transitions / version | 400 |
| Max variables / version | 100 |
| Max instance payload size | 256 KB |
| Max parallel branches / split | 32 |
| Max sub-workflow depth | 5 (SUB_WORKFLOW deferred) |
| Max loop iterations / instance | 1000 |
| Max retries / system task | 10 |
| Max timer horizon | 400 days |

---

## 17. Observability

**Metrics:** active/completed/failed/suspended instances; open/overdue tasks; SLA warnings/breaches; transition latency; task completion time; timer backlog; outbox backlog; incident count; retry count; concurrency conflicts.

**Structured log fields (every workflow log line):** tenantId, workflow definition id/version, instance id, task id, transition id, actor id/type, correlationId, causationId, requestId, outcome, error code. **Do not log sensitive workflow payload values by default** (log ids/keys, not values). Health signals: dispatcher liveness, timer-scheduler lag, outbox backlog threshold, incident backlog.

---

## 18. Draft ADRs (proposed — NOT added to the register yet)

Next free numbers after ADR-020 → **ADR-021 … ADR-026**. Recent full style (`**Status:** PROPOSED …` + Decision/Rationale/Consequence, alternatives folded into Consequence). These are **planning drafts**; per repository governance, ADRs are added to the register in the *implementation* change (the readiness doc records this).

- **ADR-021 — Enterprise Workflow Engine Architecture.** Generic, data-driven engine; business processes are published definitions, never hard-coded; consumes DB/AUDIT/AUTHZ via kernel tokens; owns OUTBOX. Security: no bypass of permissions/controls/isolation/approvals (ADR-011). Deferred: BPMN, designer UI, sub-workflow/compensation depth.
- **ADR-022 — Immutable Workflow Versioning.** Publish freezes a version; running instances pinned to their version+SLA; changes need a new version; active-instance migration is an explicit governed (deferred) operation.
- **ADR-023 — Transactional Transition & Outbox Model.** State change + audit + event commit atomically in one `tx`; m06 owns the single durable outbox; no external calls in-tx; at-least-once delivery with idempotent consumers; dead-letter + replay.
- **ADR-024 — Safe Workflow Condition Expressions.** Sandboxed interpreted mini-language over declared variables; no `eval`/`vm`/SQL/shell/network; validated at publish. Security: eliminates injection/RCE via definitions.
- **ADR-025 — SLA Clock & Timer Model.** Business-calendar elapsed time; persisted clocks; deduplicated timers; warn/breach emitted once; pause/resume semantics.
- **ADR-026 — Human Approval & Segregation-of-Duties Model.** maker≠checker, quorum/sequential/parallel/amount-matrix; re-evaluate authorization at completion; consult m02 SoD; m06 orchestrates, business module decides.

Each ADR carries: status, context, decision, alternatives, consequences, **security implications**, **operational implications**, deferred items (drafted in full in the implementation plan appendix during build).

---

## 19. MVP vs deferred scope

**MVP (confirmed):** versioned definitions; START/END; HUMAN_TASK; APPROVAL_TASK; EXCLUSIVE_GATEWAY; basic PARALLEL_SPLIT/JOIN; TIMER_WAIT; EVENT_WAIT (inbound correlation); task queues; assignment by user/role/department(/branch/entity org node); claim/reassign/delegate; complete/reject; suspend/resume/cancel; SLA warning + breach; escalation event; persistent history; audit integration; **outbox events (m06 owns the outbox)**; idempotency; concurrency control; incidents + retry.

**Deferred (confirmed):** BPMN import/export; graphical designer; arbitrary scripting; complex compensation (record-only in MVP); distributed choreography; simulation; process mining; AI-generated workflows; autonomous approvals (**never**); hierarchical org-manager routing; full holiday-calendar admin UI; cross-tenant workflows (**never** by default); dynamic code plugins; team/round-robin/least-loaded assignment; SUB_WORKFLOW execution (depth-capped stub only).

**Refinement to the proposed split:** EVENT_WAIT is MVP but **inbound-correlation only** (no external event sourcing); PARALLEL_SPLIT/JOIN is MVP but **structured/balanced only** (no arbitrary token soup); COMPENSATION and SUB_WORKFLOW are **reserved** (codes/enums exist) but execution deferred.

---

*Cross-references: STAGE_2_2_M06_WORKFLOW_READINESS.md (dependency map, risks, open decisions, verdict) and STAGE_2_2_M06_WORKFLOW_IMPLEMENTATION_PLAN.md (commit sequence, test strategy, acceptance criteria).*
