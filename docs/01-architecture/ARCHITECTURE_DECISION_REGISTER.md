# Architecture Decision Register (ADR)

Consolidated ADRs for the decisions that shape every module. Each is approved and in force.

## ADR-001 — SaaS-first, multi-tenant from day one
**Decision:** Every business record is tenant-aware; isolation is enforced at the database (RLS FORCE +
`tenant_isolation` policies + composite keys), not only in application code.
**Rationale:** Defence in depth; a query that forgets a tenant filter still cannot leak across tenants.
**Consequence:** Global tables are a deliberate, enumerated exception (tenancy control plane, audit spine,
pre-auth, reference registries).

## ADR-002 — Modular monolith for MVP, service-extractable later
**Decision:** One deployable with strict module boundaries and a static boundary check; not microservices up
front. **Rationale:** Speed and simplicity for MVP without foreclosing extraction. **Consequence:** Modules
interact via contracts + events; no cross-module table access.

## ADR-003 — Tenant data isolation strategy = RLS FORCE + composite keys
**Decision:** RLS FORCE on all tenant tables; composite `(tenant_id, id)` uniqueness and composite FKs.
**Rationale:** Prevents cross-tenant joins and orphan references. **Consequence:** No `tenant_id NULL` rows;
global templates are provisioned per tenant.

## ADR-004 — Transactional Outbox for all domain events (owned by m06)
**Decision:** Events are published to a single outbox in the same transaction as the state change; consumers are
idempotent. **Rationale:** Exactly-once intent without distributed transactions. **Consequence:** No second
event-delivery path or outbox table anywhere.

## ADR-005 — Audit-first with a single registry and SCREAMING_SNAKE codes
**Decision:** Every controlled action writes to one append-only audit spine using registered codes; unregistered
codes fail CI. **Rationale:** Tamper-evident, complete audit. **Consequence:** Event names were converted from
PascalCase to `SCREAMING_SNAKE` registry codes.

## ADR-006 — AI is human-in-the-loop, never authoritative
**Decision:** AI recommends with confidence + citations and human review; it never approves, posts, files, or
concludes, and never sends restricted data to unapproved providers. **Rationale:** Accountability and safety.
**Consequence:** No "auto" AI action anywhere; all controlled decisions are human.

## ADR-007 — Finance controls are absolute
**Decision:** Decimal-safe money, balanced journals, maker-checker + SoD, no auto-post, no posting to closed
periods, no duplicate posting. **Rationale:** Financial integrity is non-negotiable. **Consequence:** Journals
are draft-only until a human approves and posts; AI/automation may only recommend.

## ADR-008 — API-first under `/api/v1/*`; approved gateways only
**Decision:** All external access via the API gateway; all integrations via the integration platform; versioned
paths. **Rationale:** One governed edge. **Consequence:** API paths standardised to `/api/v1/*`.

## ADR-009 — Deny-by-default security posture (Zero Trust over RBAC)
**Decision:** A posture engine denies by default and layers over RBAC; an allow never grants a permission the
caller lacks. Server-side DLP; no raw key storage; time-bound privileged access; immutable published policies.
**Rationale:** Bypass-resistant security. **Consequence:** Security is a control plane, not a replacement for the
authoritative controls.

## ADR-010 — Soft-delete via status + removed_at/removed_by
**Decision:** Use status columns plus `removed_at`/`removed_by` rather than `deleted_at`/`deleted_by`.
**Rationale:** Compatible with RLS FORCE and append-only/audit intent. **Consequence:** Records are never hard-
deleted in controlled domains; history is preserved.

## ADR-011 — Configurable-but-safe workflows and versioned rules
**Decision:** Workflows and rules are tenant-configurable and versioned, but cannot bypass module permissions,
financial/legal controls, tenant isolation, approvals, or DLP. **Rationale:** Flexibility without weakening
controls. **Consequence:** Configuration is validated against the control model.

## ADR-012 — Release is gated by a certification programme
**Decision:** A formal GO / CONDITIONAL GO / NO-GO is required; a GO needs all role sign-offs; no self-sign-off
of one's own assessed domain; issued decisions are immutable. **Rationale:** Controlled, evidence-based release.
**Consequence:** Production release is gated on an issued GO/CONDITIONAL-GO.

## ADR-013 — Reconciliation colour law
**Decision:** The five-colour reconciliation status law is extended with exactly three reserved tones (dark-green
exact, orange exception, purple escalated), mapped once. **Rationale:** Consistent, unambiguous recon status.

## ADR-014 — The tenant registry and org scope are RLS-protected (Stage 1A)
**Status:** Approved by the product owner during Stage 1A. Diverges from ADR-001, `SAAS_FOUNDATION.md` and
`STAGE_1_PROMPT.md`, which permit these tables to be global and non-FORCE.

**Decision — two parts:**

1. **`tenants` is RLS ENABLED + FORCED**, with a `tenant_isolation` policy admitting either the caller's own
   tenant row **or** an explicit system context:
   ```sql
   USING (    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on')
   ```
   `app.system_context` is set **only** by `Db.withSystem`, which requires a stated reason.
2. **`tenant_entities` (subsidiaries), `tenant_departments`, `tenant_branches`, `tenant_environments` and
   `tenant_status_history` are ordinary tenant-scoped tables** — RLS FORCE, `tenant_isolation` with **no**
   escape, composite `(tenant_id, id)` keys and composite FKs.

**Rationale:** "Global and unprotected" means any query made in tenant context can read, count and enumerate
every other tenant. The tenant list *is* the customer list, and a tenant's corporate structure is its own — so
leaving either readable across tenants is a commercial disclosure, not just an isolation gap. The prior model
left that to application-layer filtering, which is the class of mistake ADR-001 exists to make impossible.
`tenants` genuinely needs cross-tenant reads (a platform administrator must list and create), so it gets an
explicit, reason-bearing escape rather than no policy at all.

**Consequence:** The escape is asymmetric and deliberately so — `withSystem` sees the control plane but sees
**nothing** in tenant-scoped tables, so it cannot quietly become a way to read another tenant's business data.
Lifecycle writes therefore bind the *target* tenant's context even for platform administrators, because
`tenant_status_history` has no escape. `tenant_type_catalogue` remains a global reference registry with no RLS
(ADR-001, unchanged). Proven by `packages/m01-tenant/test/m01-tenant.db-spec.ts` through the non-owner
application role — the only role a leak could happen through.

## ADR-015 — Opaque, revocable, server-side sessions (Stage 1C)
**Status:** **ACCEPTED** — 2026-07-18 (product owner + security). Implementation branch
`feature/stage-1c-authentication-sessions`, parent baseline `e3e51a5` (certified Stage 1B).
See `docs/build/stages/STAGE_1C_AUTH_SESSIONS_READINESS.md` §10–§11.

**Decision:** authenticated sessions are **opaque server-side records**, not stateless JWTs. The
session token is a 256-bit random value returned once and stored only as a SHA-256 hash; each request looks it
up, checks status/idle/absolute expiry, and hands the account id to the unchanged `ActorResolver` (which still
gates account/identity/membership every request). Long-lived continuity is a **rotating refresh token** sharing
a `rotation_family`; presenting a superseded refresh token revokes the whole family (theft detection).

**Rationale:** an enterprise governance platform must revoke access instantly, force-logout on password change,
and audit every session as a row. Stateless JWTs buy request-time DB savings the platform does not need and
cost exactly the revocation and auditability it must have. The per-request `ActorResolver` lookup already
exists, so the session lookup is marginal.

**Transport (D3, RESOLVED):** browser sessions use **Secure, `HttpOnly`, `SameSite=Lax` cookies with CSRF
protection** on state-changing authenticated requests. Session and refresh cookies are separate; the refresh
cookie is scoped to the refresh path and never exposed to JavaScript. Strict credentialed CORS allow-list (no
wildcard). `Secure` is enforced in production; the API **refuses to boot** in production if cookie, origin, or
session-secret configuration is unsafe. `Authorization: Bearer` is deferred to a later, separately-approved
stage for machine/mobile/external clients; it is not the primary browser transport here. OAuth/OIDC/API-key
auth are out of scope.

**Consequence:** instant revocation, clean force-logout, full session audit; one indexed lookup per request; no
long-lived signing secret exists. Rejected alternatives: stateless JWT as the primary session; non-rotating
long-lived refresh tokens; Bearer tokens as the primary browser transport.

## ADR-016 — Password hashing = Argon2id (Stage 1C)
**Status:** **ACCEPTED** — 2026-07-18 (product owner + security). Implementation branch
`feature/stage-1c-authentication-sessions`. `@node-rs/argon2` is approved subject to normal dependency and
licence review; `node:crypto.scrypt` is the explicitly-documented fallback only where Argon2id cannot run in
an approved runtime.

**Decision:** store password credentials hashed with **Argon2id** (per-credential
memory/iterations/parallelism recorded for transparent upgrade; tuned to ~250 ms on target hardware), via a
vetted, pinned native binding (candidate `@node-rs/argon2`) — the **first third-party runtime dependency** in
the repo. If adding a native runtime dependency is declined, fall back to **`node:crypto.scrypt`**
(N=2^17,r=8,p=1), which is OWASP-acceptable and zero-dependency. Either way: constant-time verify, rehash-on-
login when parameters fall below policy, and **no plaintext or hash ever logged, emitted in events, or written
to audit detail** (ADR-009, no raw key storage).

**Rationale:** Argon2id is the current best-practice memory-hard KDF; the fallback exists so the credential-
storage decision is not blocked on a dependency-policy decision.

**Consequence:** a supply-chain review obligation for the native binding (mitigated by the scrypt fallback), and
a stored-parameters column so cost can rise over time without invalidating existing credentials.

## ADR-017 — RBAC authorization model (Stage 1D)
**Status:** **ACCEPTED** — 2026-07-19 (product owner + security). Implementation branch `feature/stage-1d-rbac-authorization`, certified parent baseline `004b2fd` (certified Stage 1C). Deferred: role inheritance, wildcard grants, explicit-deny records, client/session-carried permissions.
See `docs/build/stages/STAGE_1D_RBAC_AUTHORIZATION_READINESS.md`.

**Decision (proposed):** persistent RBAC. **Flat roles** (no inheritance) each holding a set of **concrete**
permission grants (`module.resource.action`; wildcards are namespace reservations, never grants — evaluation
is exact-match set membership). Actor→role assignments attach to the **tenant membership** for tenant roles
(tenant-scoped, RLS, no escape) and to the **identity** for platform roles (global, system escape). Decision
is **allow-list + default-deny**; `INDETERMINATE` fails closed to DENY. The `Authz` port keeps
`can/require(ctx, permission)` unchanged; `ActorContextFactory` **pre-resolves effective permissions once per
request** from the DB (keyed by identity+tenant, read in tenant context) into `ctx.permissions`, and
`RbacAuthz` set-checks it — fresh every request, no cache, minimal blast radius.

**Rationale:** flat roles avoid recursion/cycles/depth limits; concrete grants avoid wildcard-precedence
ambiguity; per-request resolution gives immediate revocation; the unchanged port means ~36 existing
`authz.require` call sites are untouched.

**Consequence:** composition is by assigning multiple roles; a richer `authorize(request)` method is added only
for scope/resource-instance decisions. Rejected: role inheritance; wildcard grants; client- or session-carried
permissions; a stateless permission cache in the first cut.

## ADR-018 — Authorization scope model (Stage 1D)
**Status:** **ACCEPTED** — 2026-07-19 (product owner + security). Branch `feature/stage-1d-rbac-authorization`, parent `004b2fd`. D1 resolved: organizational scope (legal entity/branch/department) is included ONLY where M01 authoritative identifiers + composite FKs already exist; no new hierarchy engine, no business-unit/product scope. Deferred: own-record, assigned-record, product, resource-instance, general ABAC.

**Decision (proposed):** MVP scopes are **global platform**, **tenant**, and optional **organizational**
(entity/branch/department) reusing m01's composite `(tenant_id, id)` FKs. An assignment may carry an
`assignment_scope`; a scope-sensitive endpoint requires the assignment scope to **contain** the resource
scope (unscoped = tenant-wide contains all). Default deny; tenant boundary by RLS, never application
filtering. **Deferred:** own-record, assigned-record, product, resource-instance, and any ABAC policy
language.

**Consequence:** most checks stay tenant-scoped (cover every current call site); org-scope is opt-in per
resource. Rejected: implementing the full scope hierarchy speculatively.

## ADR-019 — Segregation-of-Duties enforcement (Stage 1D)
**Status:** **ACCEPTED** — 2026-07-19 (product owner + security). Branch `feature/stage-1d-rbac-authorization`, parent `004b2fd`. Seed only essential baseline SoD rules; no explicit-deny records; any override/break-glass needs separate approval (D6 deferred). Security: invalid grants rejected at assignment time; invalid pre-existing state denies at runtime; no silent override.

**Decision (proposed):** `sod_rules` (global mandatory + tenant-specific) of incompatible role or permission
pairs. Enforced **at assignment time** (a grant that would create an incompatible pair is refused, 409) **and
at runtime** (a privileged action fails closed if the effective set is incompatible). Overrides need an
authorized actor + justification + audit; no silent override. **No explicit-deny records in MVP** — allow-list
+ default-deny is sufficient; explicit deny would arrive as its own ADR if a business rule requires it.

**Rationale:** SoD is the ADR-007 boundary the platform depends on; write-time prevention + runtime fail-safe
covers both "don't create the conflict" and "don't honour a conflict that slipped in".

**Consequence:** maker↔checker and finance approval separations are enforceable from Stage 1D. Rejected:
deny-precedence records; runtime-only or write-time-only enforcement.

## ADR-020 — Administrator bootstrap (Stage 1D)
**Status:** **ACCEPTED** — 2026-07-19 (product owner + security). Branch `feature/stage-1d-rbac-authorization`, parent `004b2fd`. FINAPP_BOOTSTRAP_ADMIN_ACCOUNT; no embedded password; no permanent bypass secret; idempotent; environment-gated; auditable; production fails closed on invalid config; repeated arbitrary admin creation forbidden; cannot bypass authentication or tenant isolation.

**Decision (proposed):** a migration seeds an **immutable `platform_admin` system role**; an
**environment-gated, idempotent, auditable** bootstrap grants it to a configured existing **account/identity
reference** (`FINAPP_BOOTSTRAP_ADMIN_ACCOUNT`), never a password or bypass secret. It **fails closed in
production** without explicit config, grants exactly once (idempotent), writes audit + a
`BootstrapAdminProvisioned` event, and cannot mint arbitrary repeated admins. This gives the first
platform/tenant administrator a role without `x-permissions`.

**Rationale:** retiring `x-permissions` removes the only way an unprivileged caller could act as admin, so the
first grant must come from a controlled, auditable, non-bypass channel.

**Consequence:** an operational runbook for first-admin provisioning; no standing bypass. Rejected: a permanent
admin bypass secret; embedding credentials; unrestricted repeated admin creation.

## ADR-021 — Enterprise workflow engine architecture (Stage 2.2)
**Status:** **ACCEPTED** — 2026-07-23 (product owner + security). Module `m06-workflow`, branch `feature/stage-2-2-m06-workflow`, parent `cd29b7b` (certified Stage 2.1).

**Context:** many business modules (Feedback, Legal Case, Finance approvals, Reconciliation exceptions, Document approvals, Risk/compliance, Executive escalations) need the same orchestration primitives. Re-implementing them per module would fragment control and audit.

**Decision:** m06 is a **generic, data-driven** workflow engine. Business processes are **published, versioned definitions (data)**, never hard-coded in the engine. m06 consumes `DB`/`AUDIT`/`AUTHZ` through kernel tokens and **owns the single transactional `OUTBOX`**. It provides orchestration, task routing, state machines, SLA tracking, escalation, and auditable transitions — and nothing business-specific.

**Rationale:** one authoritative engine gives one place to enforce permissions, tenant isolation, maker-checker, and audit; a data-driven model lets tenants configure processes without code changes.

**Consequence:** the engine core carries no module-specific branches. **Security:** every transition is permissioned (default deny) and audited; the engine cannot bypass module permissions, financial/legal controls, tenant isolation, approvals, or DLP (ADR-011). **Operational:** a definition catalogue and a runtime scheduler/dispatcher. **Deferred:** graphical designer, BPMN import/export, distributed choreography, process mining, AI-generated workflows, SUB_WORKFLOW/COMPENSATION execution (codes/enums reserved). Rejected: per-module bespoke workflow code; an engine that can post journals, send notifications, or store documents (owned by Finance/m08/m09).

## ADR-022 — Immutable workflow versioning (Stage 2.2)
**Status:** **ACCEPTED** — 2026-07-23 (product owner + security). Module `m06-workflow`, branch as ADR-021.

**Context:** a workflow definition changes over time, but instances already running under an older revision must remain deterministic and auditable.

**Decision:** publishing a definition **version freezes its content** (`spec` immutable; enforced by grants + status guard). A running **instance is pinned to the version it started under**, including that version's SLA configuration. Changes require a **new version**; moving live instances to a new version is an explicit, governed, audited **active-instance migration** (deferred).

**Rationale:** immutability makes execution reproducible and audit-explainable; silent edits to a live process would corrupt in-flight work and evidence.

**Consequence:** at most one ACTIVE version per definition governs new starts; older versions keep running their instances. **Security:** no one can alter the rules a running instance obeys. **Operational:** version catalogue + deployment records. **Deferred:** active-instance version migration tooling. Rejected: mutable published definitions; auto-upgrading running instances.

## ADR-023 — Transactional transition & outbox model (Stage 2.2)
**Status:** **ACCEPTED** — 2026-07-23 (product owner + security). Module `m06-workflow`, branch as ADR-021.

**Context:** a transition mutates workflow state, must be audited, and often must emit integration events — all consistently, and safely under concurrency and process failure.

**Decision:** workflow **state mutation, its audit append (`audit.write(tx, …)`), and any outbox `publish(tx, event)` occur in one transaction**. m06 owns the **single durable outbox table** and the one `Outbox<DomainEvent>` implementation bound to `OUTBOX`, replacing `RecordingOutbox`. **No external calls inside the core transaction.** Concurrency is controlled by optimistic `version` columns and status-guarded single-winner updates; parallel gateways use deterministic token accounting under a per-instance advisory lock. Delivery is **at-least-once with idempotent consumers**; dead-letter + replay.

**Rationale:** atomic state+audit+event gives exactly-once *intent* without distributed transactions (ADR-004/005); optimistic locking makes double-completion impossible.

**Consequence:** partial transitions are never externally visible; state is fully persisted so execution recovers after a crash. **Security:** audit cannot be suppressed (same tx); events are server-minted (no spoofing). **Operational:** one dispatcher, one dead-letter/replay path. **Deferred:** exactly-once delivery (consumers dedupe instead). Rejected: a second outbox/event path; external I/O in-transaction; last-writer-wins completion.

## ADR-024 — Safe workflow condition expressions (Stage 2.2)
**Status:** **ACCEPTED** — 2026-07-23 (product owner + security). Module `m06-workflow`, branch as ADR-021.

**Context:** gateways and rules need conditional logic authored by tenants, but arbitrary code in a definition is a remote-code-execution and injection surface.

**Decision:** conditions use a **restricted, interpreted, side-effect-free expression mini-language** over declared workflow variables and an allow-listed operator/function set (comparison, logical, arithmetic, `in`, date-compare). It is **parsed to an AST and interpreted** — **no `eval`, no `Function` constructor, no `vm`, no embedded JavaScript, no raw SQL, no shell, no HTTP, no filesystem, no dynamic module loading, no host-object access**. Only declared variables are addressable; unknown identifiers are validation errors. Definitions are JSON-Schema validated at `validate`/`publish` and **fail closed** on any violation.

**Rationale:** determinism and safety — a tenant must be able to express routing logic without being able to execute code or reach data.

**Consequence:** expressions are analyzable and bounded. **Security:** eliminates expression injection, SQL injection via conditions, and RCE. **Operational:** structured validation errors. **Deferred:** complex logic delegates to m07 rules/decision-tables. Rejected: JS via `vm`; JSONLogic without an allow-list; string-concatenated SQL.

## ADR-025 — SLA clock & timer model (Stage 2.2)
**Status:** **ACCEPTED** — 2026-07-23 (product owner + security). Module `m06-workflow`, branch as ADR-021.

**Context:** SLAs must measure **business** time (respecting calendars), fire warnings and breaches reliably exactly once, and survive pause/resume and process restarts.

**Decision:** SLA state is **persisted** (`workflow_sla_clock`: started/accumulated/paused, warn_at/breach_at, calendar_ref). Elapsed time is **business time** = intervals intersected with the tenant calendar (open hours minus weekends/holidays). Wake-ups are **persisted timers** (`workflow_timer`) with a UNIQUE `dedupe_key` so a timer fires **once**; warnings/breaches emit once (clock-state guarded) as `WORKFLOW_SLA_WARNING/BREACHED` audit + events. SUSPEND/delegation-gap/force-majeure pause the clock. Running instances retain their version's SLA config (ADR-022).

**Rationale:** persisted clocks + deduped timers give reliable, restart-safe SLA behavior; business-calendar math avoids false breaches over nights/weekends.

**Consequence:** deterministic, replay-safe SLA. **Security:** timers/clocks are server-owned; clients cannot manipulate fire times beyond bounded config. **Operational:** a scheduler polls due timers; a max timer horizon bounds scheduling. **Deferred:** full holiday-calendar admin UI. Rejected: wall-clock SLA; client-set timers; in-memory clocks.

## ADR-026 — Human approval & segregation-of-duties model (Stage 2.2)
**Status:** **ACCEPTED** — 2026-07-23 (product owner + security). Module `m06-workflow`, branch as ADR-021.

**Context:** controlled actions require human approval with separation of duties, but the workflow engine must never *make* the business decision itself.

**Decision:** m06's APPROVAL_TASK records and orchestrates decisions (approve/reject/return/request-info/abstain/delegate/escalate) under policies (single/sequential/parallel/unanimous/quorum/first-response-wins/amount-matrix/risk-routing). It enforces **maker ≠ checker** (no self-approval), consults m02 `SodService` for role/permission incompatibility, **re-evaluates completion authorization at execution time** (a revoked permission blocks completion), and prevents duplicate approval (idempotent + version guard). **m06 records/orchestrates; the business module owns the decision's meaning and effect.** Approval policy is configured by the workflow **version** locally; enterprise approval-policy administration (matrices, limits, delegations-of-authority) is **m22-approval**'s domain (not built here); m06 may consume m22 later but stays usable with local config.

**Rationale:** finance/legal controls require enforceable maker-checker/SoD (ADR-019); centralizing this in the engine keeps it consistent and auditable without letting automation approve.

**Consequence:** approvals are auditable and SoD-safe. **Security:** no self-approval; no approval after permission revocation; no autonomous/AI approval. **Operational:** approval decisions recorded on task completion with reason. **Deferred:** m22 enterprise approval policies. Rejected: engine-made business decisions; approvals bypassing SoD; automation approving controlled actions.

## ADR-029 — Enterprise audit event model & append-only spine (Stage 2.1)
**Status:** **ACCEPTED** — 2026-07-19 (product owner + security). Module `m03-audit`, branch `feature/stage-2-1-m03-audit`, **stacked on the UNMERGED Stage 1D branch** `feature/stage-1d-rbac-authorization` (`cb7e5d8`); Stage 1D is not yet merged or certified, so this baseline is explicitly provisional.

**Decision:** one authoritative `audit_events` table is the evidentiary record for every module. It is **mixed-scope** — tenant events (`tenant_id` set, written/read in tenant context) and PLATFORM events (`tenant_id NULL`, only under the system escape), so a tenant administrator can never read platform-wide evidence. It is **append-only**, enforced two ways: the application role is granted INSERT + SELECT only (never UPDATE/DELETE), and `BEFORE UPDATE/DELETE/TRUNCATE` triggers reject mutation for **every** role, superuser included. Actor, tenant scope, module, and correlation are taken from the **trusted context and the transaction session**, never from a client claim; timestamps are server-generated. Detail is redacted before storage.

**Rationale:** "audit is evidence, not an editable feed" must be a database fact, not an application convention; and the scope must match what RLS checks, so the audit row commits with the change it describes. Exceptional legally-compelled deletion is a separately-governed operator process, deliberately made impossible through ordinary paths.

**Consequence:** the in-memory `RecordingAudit` is retired from production (kept only as a test double); every audited action now writes a durable, isolated, immutable row in-transaction. Deferred (documented): monthly range partitioning; a DB-backed audit-code registry table (the YAML remains authoritative); finer platform-actor attribution via boundary-carried request metadata.

## ADR-030 — Audit tamper-evidence via per-scope hash chains (Stage 2.1)
**Status:** **ACCEPTED** — 2026-07-19 (product owner + security). Module `m03-audit`, branch as ADR-029.

**Decision:** each event is hash-chained to the previous event in its scope (a tenant's chain, or the PLATFORM chain): `event_hash = sha256(integrity_version ‖ previous_hash ‖ canonical(fields))`, with a gap-free per-scope `seq` appended under a per-scope advisory transaction lock. A verification pass recomputes the chain and reports the first break (edit, deletion, or reorder).

**Rationale:** detect unauthorised modification of stored evidence without a heavyweight external dependency. This is **tamper-EVIDENCE, not cryptographic non-repudiation** — a party able to rewrite the whole chain could forge a consistent history; defeating that requires periodic external anchoring of chain heads, which is a documented follow-on (`chain_anchors`). The claim made is exactly the one implemented, no more.

**Consequence:** `audit.integrity.verify` verifies a scope; the verification outcome is itself audited. Rejected: claiming non-repudiation; a single global chain (would serialise all tenants).

## ADR-031 — Audit transaction semantics, failure handling & redaction (Stage 2.1)
**Status:** **ACCEPTED** — 2026-07-19 (product owner + security). Module `m03-audit`, branch as ADR-029.

**Decision:** three recording modes. (1) **Transactional** `write(tx, ctx, entry)` — a successful controlled action's audit commits in the same transaction as the change; if the audit insert fails, the business transaction fails with it. (2) **Independent** `recordFailure` / `recordAuthorizationDecision` / `recordSuccess(ctx, …)` — for FAILED, DENIED, or out-of-band actions, written in their own transaction so the evidence survives a rolled-back business transaction; security-significant denials are always recorded. Persistence failures are never silently swallowed. **Redaction** runs before any detail is stored: secret-named fields masked recursively, long strings truncated, oversized payloads summarised, binary rejected — nothing sensitive enters the append-only store.

**Rationale:** "no security event disappears silently, even when the business transaction fails" (CLAUDE.md); and an append-only store must never receive a secret because it is kept forever.

**Consequence:** callers keep the unchanged `AUDIT` port for the common success path and gain explicit failure/denial recording. Deferred (documented): the retention-enforcement worker (the policy model + legal-hold tables ship now); operational metrics endpoints.

## ADR-032 — M07 rule-set specification & immutable version storage (Stage 2.3)
**Status:** **ACCEPTED** — 2026-07-24 (product owner + security). Module `m07-rules`, branch `feature/stage-2-3-m07-rules`, parent `130c284` (certified Stage 2.2).

**Context:** a decision-rules engine must be versioned, immutable after publication, deterministically checksummable, simple to replay, and auditable.

**Decision:** a rule-set **version** stores its entire validated rule specification as one **immutable `spec` JSON** on `rule_set_version` (decision tables, structured conditions, input/output/context schemas, derived fields), frozen at publish (grants + status guard), with a SHA-256 `content_hash`. Decision-table rows are embedded in `spec`, not shredded into child tables. Mirrors the m06 definition model (ADR-022).

**Rationale:** one immutable document gives deterministic checksums, trivial replay (re-run the exact `spec`), strong up-front validation, and manageable queries — without a shredded schema drifting from the validated artefact.

**Consequence:** at most one ACTIVE version per rule-set governs new evaluations; older versions keep serving replay. Security: no one can alter a published rule set. Operational: a version catalogue. Rejected: normalized per-row tables (drift risk, weaker immutability guarantees).

## ADR-033 — Deterministic safe rule execution via structured typed conditions (Stage 2.3)
**Status:** **ACCEPTED** — 2026-07-24 (product owner + security). Module `m07-rules`, branch as ADR-032.

**Context:** rules must be explainable, deterministic, decimal-safe, and impossible to weaponize for code execution or injection.

**Decision:** conditions are **structured typed JSON** (a discriminated-union AST: field/op/value composed with AND/OR/NOT, plus range/in/present/string/date nodes) — NOT free-text expression strings. There is therefore no host-code interpreter to attack: no eval, no Function, no vm, no require/dynamic import, no SQL/shell/filesystem/network, no reflection/prototype/constructor access — by construction, because conditions are pure data validated against an allow-listed operator set. Numeric comparisons on money/precision fields are decimal-safe (BigInt-scaled, never binary float). Evaluation is deterministic: no wall-clock/random/env/fs; any "now" arrives through context.evaluatedAt; object-key iteration is normalized. Identical (spec, normalized input, context, engine version) yields identical outcome/matches/reason-codes/outputs/trace order.

**Rationale:** structured conditions are more explainable (each node maps to a structured reason/trace) and eliminate the injection surface entirely, which a free-text language can only bound. This differs from m06's workflow gateway interpreter (free-text over float numbers, ADR-024) because rules require decimal safety and auditable structure; m07 does not depend on m06's interpreter.

**Consequence:** analyzable, replay-safe, decimal-safe rules. Security: RCE/injection impossible by construction; hard limits (depth/nodes/counts/sizes/budget) bound DoS, fail closed. Rejected: a shared free-text expression engine; binary-float money comparisons.

## ADR-034 — Decision-table hit policies (Stage 2.3)
**Status:** **ACCEPTED** — 2026-07-24 (product owner + security). Module `m07-rules`, branch as ADR-032.

**Decision:** decision tables support **FIRST** (first matching row in declared order), **UNIQUE** (exactly one match; more than one is a UNIQUE_MATCH_VIOLATION; zero is a no-match), **COLLECT** (all matches; optional decimal-safe deterministic aggregation — sum/min/max/count — over a declared output field, rejecting incompatible/mixed types), and **PRIORITY** (highest-priority match, stable tie-break by declared order). Rows carry an id, optional priority, an enabled flag, optional effective dates (evaluated against context.evaluatedAt), a reason code, and structured outputs. Row order and priority sorting are stable and deterministic.

**Consequence:** deterministic, explainable table decisions. Validation rejects duplicate row ids, invalid column refs, malformed ranges, conflicting UNIQUE rows (where determinable), and incompatible aggregation types. Rejected: nondeterministic ordering; float aggregation.

## ADR-035 — Evaluation evidence & sensitive-data minimization (Stage 2.3)
**Status:** **ACCEPTED** — 2026-07-24 (product owner + security). Module `m07-rules`, branch as ADR-032.

**Context:** evaluation evidence must support audit, dispute resolution, replay, and regulatory explanation, but evaluations may concern regulated/personal data (Kenya DPA) that must not accumulate in an append-only store.

**Decision:** `rule_evaluation` persists a **structured explanation** (outcome, outputs, matched rule/row ids, machine-readable reason codes, trace summary, correlation/causation, subject reference, duration, status, error code) plus the **input HASH** (SHA-256 of the canonicalized input) and a context hash — NOT raw sensitive inputs by default. Evaluation history is append-only (grant-based). Reason codes are mandatory and machine-readable; human-readable text is generated from structured evidence, never a substitute for it. Events and audit carry hashes/ids only.

**Consequence:** replayable, auditable evidence without hoarding secrets. Full-input capture, where a rule set justifies it, uses a classified/redacted pattern (deferred). Rejected: default raw-input persistence; free-text-only explanations.

## ADR-036 — Workflow-to-rules integration & transaction semantics (Stage 2.3)
**Status:** **ACCEPTED** — 2026-07-24 (product owner + security). Module `m07-rules`, branch as ADR-032.

**Decision:** m06 workflows consume rules through a **stable contract** (an interface/token plus the pure engine's public API), never by importing m07 (nor m06 importing the other's internals) — no circular dependency. A workflow that branches on a rule outcome either (a) precomputes the evaluation and passes the evaluationId/outcome into the instance, or (b) evaluates in the same transaction as the transition where atomic audit+outbox evidence is required. Rule evaluation performs no external calls and fails closed; on engine error the workflow raises an incident. Idempotency keys prevent duplicate evaluation; no partial workflow transition is externally visible.

**Consequence:** clean dependency direction, atomic evidence, fail-closed integration. m06 is not expanded beyond the minimum integration contract in this stage (the m06/m07 wiring lands when a business module needs it). Rejected: m07 importing m06 internals; external calls inside a transition.

## ADR-037 — Platform-global vs tenant rule scope (Stage 2.3)
**Status:** **ACCEPTED** — 2026-07-24 (product owner + security). Module `m07-rules`, branch as ADR-032.

**Decision:** rule sets are **tenant-scoped by default** (composite `(tenant_id, id)`, RLS FORCE, no escape). Platform-global rule sets are modelled explicitly with a mixed-scope pattern (nullable `tenant_id` plus a system escape, like m03 audit / m02 roles) and administered only under `rules.platform.administer` (platform authority); a tenant cannot mutate a global rule set. For the Stage 2.3 MVP, evaluation resolves a rule set within the caller's tenant (global-rule override/fallback semantics are defined but the global-administration surface is minimal); there is no ambiguous fallback — resolution is explicit.

**Consequence:** no faked global scope via an arbitrary tenant; a clear administration boundary. Full global-rule override semantics and the admin surface are a documented follow-on. Rejected: representing a global rule as a special tenant row; implicit tenant-to-global fallback.

## ADR-038 — M08 channel-neutral notifications via ports/adapters (Stage 2.4)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security). Module `m08-notify`, branch `feature/stage-2-4-m08-notifications`, parent `f5b06d7` (certified Stage 2.3).

**Context:** the platform needs one generic notification + escalation service that Feedback, Cases, Finance, Workflow and others consume — not a marketing engine, and not a place where a real provider SDK or its secrets live in the core.

**Decision:** m08 is **channel-neutral** (email / sms / in_app / webhook modelled as an allow-listed enum). Delivery is performed by a `NotificationProvider` **adapter** selected per channel through a `ProviderRegistry` (ports/adapters). The core ships **deterministic test doubles only** — NO real third-party integration, NO committed secrets, NO arbitrary-URL fetcher. An unconfigured channel fails safe as a retryable provider error (Framework Only). Webhook destinations pass an SSRF guard (https only, no credentials, no private/loopback/link-local/metadata hosts); m08 never fetches arbitrary URLs. m08 consumes DB/AUDIT/AUTHZ via kernel tokens and publishes `notification.lifecycle` through the **one** m06 outbox — it owns no outbox.

**Consequence:** the whole module is testable with no network; a real provider is a later adapter behind a stable port. Rejected: hardcoding a vendor SDK; a generic URL fetcher; a second outbox.

## ADR-039 — Versioned immutable notification templates & escalation policies (Stage 2.4)
**Status:** **ACCEPTED** — 2026-07-26. Module `m08-notify`, branch as ADR-038.

**Decision:** a notification **template version** stores its entire validated template (channel, subject/body templates, typed variable schema, locale) as one **immutable `spec` JSON**, walked DRAFT→VALIDATED→PUBLISHED→ACTIVE→RETIRED→ARCHIVED and **frozen at publish** with a SHA-256 `content_hash`; at most one ACTIVE version per template governs sending (partial unique index). Escalation policies follow the same immutable-spec, one-ACTIVE-per-key model in a single versioned table. A material change is a NEW version — a published spec is never edited. Mirrors m07 ADR-032 / m06 ADR-022.

**Consequence:** deterministic, replayable, auditable templates; a request binds to a frozen revision. Rejected: mutable published templates; shredding the template into per-row tables.

## ADR-040 — Safe deterministic template rendering (Stage 2.4)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security). Module `m08-notify`, branch as ADR-038.

**Decision:** rendering is **explicit `{{ variable }}` substitution** over declared, typed variables — NOT an expression language. There is **no eval, no Function constructor, no vm, no dynamic require/import, no property access, no logic/conditionals, and no access to process/env/fs/network/Date.now/random/globals** — injection is impossible by construction. Rendering is a **pure function** of (template, values): identical inputs yield identical output. Output is HTML-escaped for email/in-app; every bound (template size, variable count, value size, placeholder count, rendered size) is enforced fail-closed; a malformed placeholder (`{{ 2+2 }}`, `{{ a.b }}`) is rejected at validation. Errors are structured and never echo a secret or raw value. This mirrors m07's structured-condition posture (ADR-033), adapted to text templating.

**Consequence:** RCE/injection impossible by construction; DoS bounded and fail-closed; deterministic + replayable. Rejected: a Handlebars/Mustache-style logic engine; unbounded rendering.

## ADR-041 — Notification evidence & sensitive-data minimization (Stage 2.4)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security). Module `m08-notify`, branch as ADR-038.

**Decision:** the notification **request** carries the variable VALUES it must render at dispatch (operational data held under RLS + classification, since deferred delivery inherently needs the payload) plus a `variables_hash` for idempotency-conflict detection. But the **audit spine, the `notification.lifecycle` events, and delivery-attempt evidence carry IDENTIFIERS / CHANNEL / STATUS / REASON-CODES ONLY** — never raw destinations, rendered message bodies, provider credentials, or variable values. Delivery attempts are **append-only** (INSERT+SELECT grant); no provider secret is ever stored. API views redact variable values (hash only), the worker lease, and provider secrets.

**Consequence:** the operational store holds only what deferred delivery requires; the durable audit/event trail is minimized and safe for logs. Rejected: writing rendered bodies or destinations into audit/events; storing provider secrets in evidence.

## ADR-042 — Communication categories, preferences & suppression (Stage 2.4)
**Status:** **ACCEPTED** — 2026-07-26. Module `m08-notify`, branch as ADR-038.

**Decision:** every notification declares a **category** — `optional`, `operational`, `security`, or `legal`. Preferences (opt-out, quiet hours) and destination suppression apply to `optional` fully and may DEFER (never drop) `operational` during quiet hours; **`security` and `legal` are mandatory and bypass all preferences, suppression, and quiet hours** — a general opt-out can never silence a security or legally-required notice. Templates/policies are tenant-scoped by default with an explicit platform scope under `notifications.platform.administer`; there is no vague `notifications.admin`. This is a generic preference core, NOT a consent-management platform.

**Consequence:** users control noise without being able to suppress what must reach them; a clear platform-vs-tenant boundary. Rejected: a single global mute; a full consent platform.

## ADR-043 — Escalation policy model & lease-based worker concurrency (Stage 2.4)
**Status:** **ACCEPTED** — 2026-07-26. Module `m08-notify`, branch as ADR-038.

**Decision:** an escalation policy is a bounded, ordered ladder of levels (delay, channel, recipients, optional template) stored as one immutable versioned `spec` in a **single** `escalation_policy` table (definition+version collapsed, one ACTIVE per key). Escalation instances and notification requests are advanced by workers under a **compare-and-set LEASE** (`locked_by`/`locked_until`): a due row is claimed by exactly one worker (single-winner under contention proven by the DB spec), advanced/dispatched, and released; stale leases are reclaimable. Advancement is bounded (no infinite escalation) and idempotent; creation is idempotent per originating event (unique idempotency key). Dispatch/advance are worker paths and are NOT exposed over HTTP (no worker internals in the public API).

**Consequence:** safe concurrent processing without a second scheduler in the request path; bounded, idempotent, replay-safe escalation. Deferred (documented): a standing timer-dispatcher worker (the fire path is a service method invoked by tests/callers, like m06's SLA path); real recipient-resolver adapters; downstream notification fan-out on escalation advance. Rejected: unbounded escalation; advancing without a lease.

## ADR-044 — M09 document storage via ports; bytes never in PostgreSQL (Stage 2.5)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security). Module `m09-docs`, branch `feature/stage-2-5-m09-documents`, parent `30b69c2` (certified Stage 2.4).

**Context:** an enterprise document module must store large binary content, but PostgreSQL is the wrong place for multi-GB blobs, and hardcoding a cloud provider couples the platform to a vendor and its secrets.

**Decision:** document content lives in an **object store behind a `DocumentStorage` port** (put/head/read/purge). PostgreSQL holds only an **opaque storage reference** plus metadata (filename, media type, byte size, content hash). m09 ships a **deterministic in-memory adapter** as a Framework-Only default and commits NO cloud credentials; a real S3/Azure/GCS adapter is a future responsibility behind the port. Downloads are server-mediated (or short-lived signed access from a real adapter); the raw storage reference is never exposed in an API response.

**Consequence:** the module is fully testable without network or secrets; storage is swappable. Rejected: bytea/large-object columns; a hardcoded vendor SDK.

## ADR-045 — Immutable versions & versioned type/retention specs (Stage 2.5)
**Status:** **ACCEPTED** — 2026-07-26. Module `m09-docs`, branch as ADR-044.

**Decision:** a document is a stable logical record (identified by a code, never a filename) with **immutable versions**: a version's content columns (storage ref, hash, size, filename, media type) are frozen once it commits, and exactly **one ACTIVE version** governs a document (partial unique index). A committed version requires a content hash + byte size (CHECK). Document **types** and **retention policies** are versioned, immutable-after-publish `spec` JSON with one ACTIVE per code and a frozen content_hash (mirrors m07 ADR-032 / m08 ADR-039). Metadata is a constrained, typed map validated against the type's schema — never unbounded arbitrary JSON.

**Consequence:** tamper-evident, auditable version history; deterministic type/retention resolution. Rejected: mutable published content; filename-as-identity; free-form metadata blobs.

## ADR-046 — Document evidence & sensitive-data minimization (Stage 2.5)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security). Module `m09-docs`, branch as ADR-044.

**Decision:** the audit spine, `document.lifecycle` events, and scan/disposition evidence carry **identifiers, states, and content HASHES only** — never raw document content, extracted text, signed URLs, storage credentials, encryption keys, or antivirus payloads. Scan evidence records a status + scanner code + a safe signature label; a malicious payload is never stored. API views redact the internal storage reference. Scan evidence is append-only (INSERT+SELECT grant); no table grants DELETE.

**Consequence:** the durable trail is safe for logs and minimized; a leak of the event stream or audit log discloses no content. Rejected: embedding content/URLs/keys in audit or events.

## ADR-047 — Content safety, hard limits & no arbitrary paths/URLs (Stage 2.5)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security). Module `m09-docs`, branch as ADR-044.

**Decision:** filenames are normalized to a **safe leaf label** with a strict guard — path separators, `.`/`..`/traversal sequences, control characters, and reserved shell/Windows characters are rejected; the module NEVER builds a filesystem path or a remote URL from a filename (the real location is the adapter's opaque reference). Media types are validated against a strict grammar + the type's allow-list. Every bound (title/code/filename/media-type/byte-size/metadata key+value/tags/relationships) is enforced fail-closed. Permissions are three-segment `documents.<entity>.<action>`; there is no vague `documents.admin`.

**Consequence:** path-traversal, SSRF-via-filename, MIME abuse, and oversized-payload DoS are impossible by construction. Rejected: arbitrary filesystem paths or remote URLs derived from user input.

## ADR-048 — Document ACLs supplement RBAC (Stage 2.5)
**Status:** **ACCEPTED** — 2026-07-26. Module `m09-docs`, branch as ADR-044.

**Decision:** a `document_access_grant` narrows access to a specific document for a declarative grantee (user/role/permission/participant/custodian) at a bounded access level. It **supplements** the M02 RBAC permission check — every document endpoint still enforces its `documents.*` permission first; a grant never replaces RBAC and there is no second authorization engine. Grants are explicit, tenant-scoped, auditable, and revocable (by status; no DELETE).

**Consequence:** fine-grained per-document sharing without a parallel RBAC system. Rejected: a document-owned permission engine that bypasses M02.

## ADR-049 — Classification model & controlled downgrade (Stage 2.5)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security). Module `m09-docs`, branch as ADR-044.

**Decision:** documents carry an ordered classification (`public < internal < confidential < restricted`, the contracts vocab) defaulted from the document type. Classification is enforced through authorization and access policy, not UI labels. A **downgrade** (to a less sensitive level) requires **platform authority** (`documents.platform.administer`) and is audited; an upgrade is a normal update.

**Consequence:** sensitivity cannot be quietly lowered to widen access. Rejected: label-only classification; unprivileged downgrades.

## ADR-050 — Retention, legal hold & controlled disposition (Stage 2.5)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security). Module `m09-docs`, branch as ADR-044.

**Decision:** retention computes an earliest-disposition date from the active policy at activation. Disposal is **never automatic**: it requires a request → explicit **privileged approval by a different actor** (maker≠checker) → execution, which purges object bytes but leaves a **tombstone** (the document row is set `disposed` and the append-only disposition + version rows remain as evidence). An active **legal hold ALWAYS blocks** disposal and retention expiry can never override it (a hard guard, fail closed). Legal-hold and disposition history are append-only (no DELETE).

**Consequence:** defensible records management; no destruction of held or evidence records. Rejected: auto-destroy on expiry; single-actor disposal; hard-deletion without a tombstone.

## ADR-051 — Scan / extraction / signature ports; Framework Only (Stage 2.5)
**Status:** **ACCEPTED** — 2026-07-26. Module `m09-docs`, branch as ADR-044.

**Decision:** content scanning is a `ContentScanner` port with a deterministic test double; a version is not downloadable/activatable until required scanning is satisfied (`clean`/`bypassed`). m09 ships NO real antivirus, NO production OCR/extraction, and NO production e-signature — extraction and signature are modelled as deferred framework hooks (signature/approval flags on the type; approval orchestration delegated to m06 workflow). No provider credentials are committed and no real delivery/scan is claimed.

**Consequence:** the scan gate and signature/approval metadata exist and are enforced, with real providers deferred behind ports. Rejected: embedding a real AV/OCR/e-sign SDK; claiming production scanning.

## ADR-052 — Granular feedback permissions; no vague `feedback.admin` (Stage 3.1)
**Status:** **ACCEPTED** — 2026-07-26. Module `m12-feedback`, branch `feature/stage-3-1-m12-feedback`.

**Decision:** m12 exposes **37 granular `feedback.*` permissions** (three-segment `feedback.<entity>.<action>`), enforced server-side inside the services (default deny, the single choke point) and declared on every mutating route's `@Endpoint`. Access to the two most sensitive capabilities is gated by **dedicated privileged permissions** — `feedback.customer_contact.read` (see the un-redacted customer contact) and `feedback.platform.administer` (platform-scoped specs) — rather than a catch-all `feedback.admin`. Reading un-redacted contact is itself audited (`FEEDBACK_CONTACT_ACCESSED`).

**Consequence:** least-privilege is expressible (a contact-centre agent can work feedback without seeing raw contact details; a reviewer can read without mutating). Rejected: a single coarse admin permission; header-carried permissions (an `x-permissions` header can never grant — proven by the API spec's 403).

## ADR-053 — Questionnaires, categories & closure criteria are declarative data; decisioning delegated to m07 (Stage 3.1)
**Status:** **ACCEPTED** — 2026-07-26. Module `m12-feedback`, branch as ADR-052.

**Decision:** questionnaires (with deterministic CSAT/NPS/effort normalization), categories, severities and closure criteria are **declarative data** — versioned, immutable-after-publish specs (mirroring the m09 doctype pattern, one ACTIVE per code, content-hash frozen at publish) and simple criteria maps. There is **NO executable expression inside a questionnaire**; complex, explainable decisioning (severity/routing/eligibility rules) is delegated to the **m07 rules engine** via a recorded `ruleEvaluationId`, never re-implemented in m12.

**Consequence:** feedback content and scoring are testable and replayable; the one rules engine stays authoritative. Rejected: an embedded expression/rules mini-language in m12; mutable-after-publish specs.

## ADR-054 — Deterministic clock-driven SLA math via a Clock port; timers delegated to m06/m08 (Stage 3.1)
**Status:** **ACCEPTED** — 2026-07-26. Module `m12-feedback`, branch as ADR-052.

**Decision:** SLA due dates and warn/breach state are **PURE functions** of a policy spec, a supplied clock (epoch ms) and accumulated paused duration — injected through a `Clock` port, so there is **no ambient `Date.now`** and SLA behaviour is fully deterministic, testable and replayable. m12 builds **no timer engine**: timer dispatch and escalation are delegated to m06/m08; m12 records the breach and publishes an event.

**Consequence:** SLA behaviour is proven with a `FixedClock` in the DB spec (breach/pause/resume) with zero flakiness; no second scheduler. Rejected: ambient wall-clock reads; a bespoke m12 timer/cron.

## ADR-055 — Customer contact & narrative sensitivity: redaction + never in events/audit (Stage 3.1)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security). Module `m12-feedback`, branch as ADR-052.

**Decision:** customer contact details and free-text narratives (and confidential internal responses) are treated as **sensitive**: stored under RLS, **REDACTED on read** unless the caller holds `feedback.customer_contact.read` (respectively the response-submit permission for the confidential response), and **NEVER placed in domain events or audit payloads**. `feedback.lifecycle` event payloads and audit `detail` carry identifiers, statuses, reason codes and safe analytics dimensions ONLY.

**Consequence:** PII minimization holds across the event/audit spine and every API view; a privacy breach cannot leak through telemetry. Rejected: putting narratives/contacts in events for downstream convenience; returning raw contact to any authenticated caller.

## ADR-056 — Hard limits fail-closed; controlled M13 case handoff via port + pending record + event (Stage 3.1)
**Status:** **ACCEPTED** — 2026-07-26. Module `m12-feedback`, branch as ADR-052.

**Decision:** every bound (narrative/answer length, answer/question/batch counts, search limit) is enforced **fail-closed**. Handoff to **M13 case management (which does not exist yet)** is a **controlled seam only**: m12 stores a **pending `feedback_case_handoff` record** (idempotent), publishes a **versioned `CaseHandoffRequested` event**, and exposes a **port** — it creates **NO case table**, owns no case data, and builds **no second escalation engine** (escalation reuses m08 via an event). Completion (when M13 later creates the case) transitions the feedback to `converted_to_case`.

**Consequence:** M12 can be built and certified before M13 exists, with the integration boundary explicit and idempotent. Rejected: a fake/placeholder case table owned by m12; a second escalation engine; a synchronous call into a non-existent M13.

## ADR-057 — Declarative versioned case types + granular permissions; decisioning delegated to m07 (Stage 3.2)
**Status:** **ACCEPTED** — 2026-07-26. Module `m13-case`, branch `feature/stage-3-2-m13-case-management`.

**Decision:** case types and SLA policies are **declarative, versioned, immutable-after-publish specs** (one ACTIVE per code+scope, content-hash frozen at publish, mirroring m09 doctype / m12). Legal and non-legal case types, jurisdictions, party roles and references are **configured as data per tenant** — never hardcoded in service logic (no Aptic-/Kenya-specific procedure in the generic core). There is **NO executable expression** inside a case type; complex, explainable decisioning (severity / assignment / SLA selection / closure eligibility) is delegated to the **m07 rules engine** via a recorded `ruleEvaluationId`, and rules never mutate a case directly. Authorization is **56 granular `cases.*` permissions** (three-segment, enforced server-side, default deny) — no vague `cases.admin`; sensitive reads + approvals + configuration are individually privileged.

**Consequence:** the platform is generic and configurable, decisioning stays in the one rules engine, and least-privilege is expressible. Rejected: hardcoded legal case types; an embedded rules mini-language in m13; a coarse admin permission; header-carried permissions (a header can never grant — proven by the 403).

## ADR-058 — Deterministic clock-driven SLA + deadline math via ports; timers delegated; fail-closed limits (Stage 3.2)
**Status:** **ACCEPTED** — 2026-07-26. Module `m13-case`, branch as ADR-057.

**Decision:** SLA due dates + warn/breach state and deadline due instants are **PURE functions** of a spec/rule, a supplied `Clock` (epoch ms) and accumulated paused duration — injected through a port, so there is **no ambient `Date.now`** and behaviour is deterministic, testable and replayable. m13 builds **no timer engine**: timer dispatch + escalation are delegated to m06/m08; m13 records the breach and publishes an event. SLA "start" materializes **stage deadlines** rather than a bespoke SLA-instance table. Every bound (title/summary/description/note/allegation length, party/issue/batch counts, search limit) is enforced **fail-closed**. Business-calendar expansion is consumed from m06, not reimplemented.

**Consequence:** deadline/SLA behaviour is proven with a `FixedClock` (breach) with zero flakiness; no second scheduler; no runaway payload. Rejected: ambient wall-clock reads; a bespoke m13 timer/cron; unbounded free-text.

## ADR-059 — Recovery + settlement store finance references only; no finance implementation (Stage 3.2)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + finance). Module `m13-case`, branch as ADR-057.

**Decision:** recovery/enforcement tracking and settlements capture **references and states only** — amounts are decimal-safe integer **minor units** used purely as reference data (debt reference, amount claimed/recovered, currency, payment reference, finance reference). m13 implements **NO general ledger, NO journal posting, NO payment allocation, NO collections accounting, NO reconciliation** — those remain later modules (m19/m15/m20/m21). Settlement approval is **maker-checker** (proposer ≠ approver, enforced in the service AND a DB CHECK); confidential settlement terms are sensitive (redacted; never in events/audit).

**Consequence:** m13 tracks the case dimension of recovery/settlement without touching money movement, keeping Finance's controls (no auto-post, balanced journals, SoD) the sole responsibility of the Finance modules. Rejected: posting or allocating payments from m13; a collections ledger in m13; floating-point money.

## ADR-060 — Case confidentiality/privilege model + the M12/M14 boundaries (Stage 3.2)
**Status:** **ACCEPTED** — 2026-07-26 (product owner + security + legal). Module `m13-case`, branch as ADR-057.

**Decision:** a case carries a **confidentiality level** (`standard`/`confidential`/`restricted`/`privileged`); party contacts, privileged/confidential/legal-advice **notes**, correspondence bodies and confidential settlement terms are **sensitive**: stored under RLS, **redacted on read** behind dedicated privileged permissions (`cases.confidential.read`, `cases.privileged_notes.read`, `cases.party_contact.read`), and **NEVER placed in domain events or audit payloads** (which carry ids, states, dates and safe reason codes only). Reading un-redacted confidential/privileged data is itself audited. The **M12→M13 handoff** is idempotent (exactly one case per handoff, guarded by a `case_handoff_intake` unique ledger), consumes m12's handoff through a **port** (m13 never reads m12's tables), preserves the originating feedback id + correlation, and completes the handoff on the m12 side only on first creation. The **M13→M14 boundary** is the versioned `case.converted_to_matter` event — m13 owns no legal-matter tables; full legal matters are m14.

**Consequence:** PII/privilege minimization holds across every API view, event and audit entry; M13 integrates with M12 and M14 through explicit, idempotent, event/port boundaries. Rejected: putting notes/contacts/settlement terms in events for convenience; returning confidential detail to any authenticated caller; reading m12's tables directly; a second case creation on a duplicate handoff; owning legal-matter data in m13.

## ADR-061 — Configurable versioned matter types + jurisdictions/forums; nothing Aptic-/Kenya-specific in core (Stage 4.1)
**Status:** **ACCEPTED** — 2026-07-27. Module `m14-legal`, branch `feature/stage-4-1-m14-legal-matters`.

**Decision:** matter types and legal SLA policies are **declarative, versioned, immutable-after-publish specs** (one ACTIVE per code+scope, content-hash frozen at publish, mirroring m09 doctype / m12 / m13). Matter types, **jurisdictions**, **forums/courts**, statutes, party roles, external firms and advocates are **configured as data per tenant** — never hardcoded in service logic (no Aptic-/Kenya-specific procedure, court, statute or advocate baked into the generic core). There is **NO executable expression** inside a matter type; complex, explainable decisioning (risk / assignment / SLA selection / closure eligibility) is delegated to the **m07 rules engine** via a recorded `ruleEvaluationId`, and rules never mutate a matter directly. Authorization is **70 granular `legal.*` permissions** (three-segment, enforced server-side, default deny) — no vague `legal.admin`; **23** are privileged, gating sensitive reads, approvals and configuration individually.

**Consequence:** the legal platform is generic and configurable across jurisdictions and forums, decisioning stays in the one rules engine, and least-privilege is expressible. Rejected: hardcoded matter types / Kenyan courts / statutes; an embedded rules mini-language in m14; a coarse admin permission; header-carried permissions (a header can never grant — proven by the 403).

## ADR-062 — Deterministic clock-driven SLA + deadline + limitation math via a Clock port; fail-closed limits; matter as a first-class object (Stage 4.1)
**Status:** **ACCEPTED** — 2026-07-27. Module `m14-legal`, branch as ADR-061.

**Decision:** SLA due dates + warn/breach state, deadline due instants and **limitation** deadlines are **PURE functions** of a spec/rule, a supplied `Clock` (epoch ms) and accumulated paused duration — injected through a port (`SystemClock`/`FixedClock`), so there is **no ambient `Date.now`** and behaviour is deterministic, testable and replayable. `limitation` deadlines are treated as **high-risk** and are **clearly distinguishable** (`isLimitation` / `isLimitationSafe`) from ordinary procedural deadlines, because a missed limitation is irreversible. m14 builds **no timer engine**: timer dispatch + escalation are delegated to m06/m08; m14 records the breach and publishes an event. Every bound (title/summary/description/note length, party/issue/batch counts, search limit) is enforced **fail-closed**. The module lands at **25 owned tables** — an enterprise expansion over the 23-table reference baseline that makes the **matter a first-class object** (its own type/SLA specs, status + assignment ledgers, instructions, positions, opinions, research, pleadings, court events, deadlines, external counsel + reports, costs, settlement, outcome and notes).

**Consequence:** deadline/SLA/limitation behaviour is proven with a `FixedClock` with zero flakiness; no second scheduler; no runaway payload; the divergence (25 vs 23 tables) is documented. Rejected: ambient wall-clock reads; a bespoke m14 timer/cron; unbounded free-text; treating a limitation deadline like any other deadline.

## ADR-063 — Costs, exposure & enforcement store finance + court references only; no finance implementation (Stage 4.1)
**Status:** **ACCEPTED** — 2026-07-27 (product owner + finance). Module `m14-legal`, branch as ADR-061.

**Decision:** cost tracking, exposure and enforcement capture **finance and court references and states only** — amounts are decimal-safe integer **minor units** used purely as reference data (cost reference, amount claimed/awarded/recovered, currency, court/case references). m14 implements **NO general ledger, NO accounts payable, NO journal posting, NO payment execution, NO tax, NO reconciliation, NO collections accounting** — the finance foundation is a later stage. Settlement approval is **maker-checker** (proposer ≠ approver, enforced in `MatterLegalService` AND the DB CHECK `legal_settlement_sod_ck`); confidential settlement terms are sensitive (redacted; never in events/audit).

**Consequence:** m14 tracks the legal dimension of costs, exposure and enforcement without touching money movement, keeping Finance's controls (no auto-post, balanced journals, SoD) the sole responsibility of the later Finance modules. Rejected: posting or paying costs from m14; an accounts-payable or collections ledger in m14; floating-point money.

## ADR-064 — Legal privilege/confidentiality model: positions, opinions, privileged notes redacted, never in events/audit (Stage 4.1)
**Status:** **ACCEPTED** — 2026-07-27 (product owner + security + legal). Module `m14-legal`, branch as ADR-061.

**Decision:** a matter carries a **confidentiality level**; legal **positions/strategy**, **opinions**, **privileged notes**, **party contacts** and **confidential settlement terms** are **sensitive**: stored under RLS, **redacted on read** behind dedicated privileged `legal.*` permissions, and **NEVER placed in domain events or audit payloads** (which carry ids, states, dates and safe reason codes only). Reading un-redacted privileged/confidential data is itself audited. The **M13→M14 conversion** is **fire-and-forget** and idempotent — it consumes `case.converted_to_matter`, creates **exactly one matter per source case** guarded by the `legal_case_conversion` unique ledger keyed on `source_case_id`, and **m14 never reads m13-owned tables** (m13 emits, m14 consumes). The single `legal.lifecycle` event family (36 event types) flows through the ONE m06 outbox.

**Consequence:** legal privilege / PII minimization holds across every API view, event and audit entry; M14 integrates with M13 through an explicit, idempotent, event-only boundary; a duplicate conversion event creates no second matter. Rejected: putting positions/opinions/notes/settlement terms in events for convenience; returning privileged detail to any authenticated caller; reading m13's tables directly; a second matter on a duplicate conversion; a second outbox in m14.

## ADR-065 — Configurable versioned proceeding types + jurisdictions/forums; nothing Kenya-specific in core; the governed M14→M16 inbound contract (Stage 4.2)
**Status:** **ACCEPTED** — 2026-07-28. Module `m16-litigation`, branch `feature/stage-4-2-m16-litigation-management`.

**Decision:** proceeding types and litigation SLA policies are **declarative, versioned, immutable-after-publish specs** (one ACTIVE per code+scope, content-hash frozen at publish, mirroring m09 doctype / m12 / m13 / m14). Proceeding types, **jurisdictions**, **forums**, courts, tribunals, statutes and procedural rules are **configured as data per tenant** — never hardcoded in service logic (no Kenya-specific proceeding, forum, court, statute, tribunal or procedural rule baked into the generic core). There is **NO executable expression** inside a proceeding type; complex, explainable decisioning (risk / assignment / SLA selection / closure eligibility) is delegated to the **m07 rules engine** via a recorded `ruleEvaluationId`, and rules never mutate a proceeding directly. The **M14→M16 boundary** is a **governed inbound contract**: m16 consumes an M14 matter referral through a `MatterReferral` **port** and `POST /litigation/from-matter`, **fire-and-forget** and **idempotent on a referral key** (one proceeding per referral key via the `litigation_referral` ledger; a single matter may be referred several times, yielding several proceedings), preserving the source matter id + correlation/causation and emitting `ProceedingReferredFromMatter`. **m16 NEVER reads M14-owned tables.**

**Consequence:** the litigation platform is generic and configurable across jurisdictions and forums, decisioning stays in the one rules engine, and M16 integrates with M14 through an explicit, idempotent, contract-only boundary. Rejected: hardcoded proceeding types / Kenyan courts / tribunals / statutes / procedural rules; an embedded rules mini-language in m16; reading m14's tables directly; a single-proceeding-per-matter assumption; a second proceeding on a duplicate referral.

## ADR-066 — Deterministic clock-driven SLA + deadline + limitation math via a Clock port; fail-closed limits; the proceeding as a first-class object (Stage 4.2)
**Status:** **ACCEPTED** — 2026-07-28. Module `m16-litigation`, branch as ADR-065.

**Decision:** SLA due dates + warn/breach state, deadline due instants and **limitation** deadlines are **PURE functions** of a spec/rule, a supplied `Clock` (epoch ms) and accumulated paused duration — injected through a port (`SystemClock`/`FixedClock`), so there is **no ambient `Date.now`** and behaviour is deterministic, testable and replayable. `limitation` deadlines are treated as **high-risk** and are **clearly distinguishable** (`isLimitation` / `isLimitationSafe`) from ordinary procedural deadlines, because a missed limitation is irreversible. m16 builds **no timer engine**: timer dispatch + escalation are delegated to m06/m08; m16 records the breach and publishes an event. Every bound (title/summary/description/note length, party/claim/batch counts, search limit) is enforced **fail-closed**. The module lands at **25 owned tables** making the **proceeding a first-class object** — distinct from an M14 matter's court-event/deadline fields — with its own type/SLA specs, the referral ledger, status + assignment ledgers, parties, claims, filings, service, appearances, the proceeding record, witnesses, experts, exhibits, bundles, orders, compliance obligations, outcomes, appeals, deadlines, cost references, notes and relationships.

**Consequence:** deadline/SLA/limitation behaviour is proven with a `FixedClock` with zero flakiness; no second scheduler; no runaway payload; the proceeding is modelled once, in full, rather than smeared across an M14 matter. Rejected: ambient wall-clock reads; a bespoke m16 timer/cron; unbounded free-text; treating a limitation deadline like any other deadline; modelling a proceeding as a few fields on an M14 matter.

## ADR-067 — Litigation costs store court + finance references only; no finance implementation (Stage 4.2)
**Status:** **ACCEPTED** — 2026-07-28 (product owner + finance). Module `m16-litigation`, branch as ADR-065.

**Decision:** litigation cost tracking captures **court and finance references and states only** — amounts are decimal-safe integer **minor units** used purely as reference data (cost reference, amount claimed/awarded/taxed/recovered, currency, court/case references). m16 implements **NO accounts payable, NO general ledger, NO journal posting, NO payment execution, NO tax, NO reconciliation, NO collections accounting** — recovery/enforcement accounting is **M17** and the finance foundation is a later stage. Maker-checker (proposer ≠ approver, DB CHECK) governs filing and bundle approval, not money movement.

**Consequence:** m16 tracks the litigation dimension of costs without touching money movement, keeping Finance's controls (no auto-post, balanced journals, SoD) the sole responsibility of M17 and the later Finance modules. Rejected: posting, paying, allocating or reconciling costs from m16; an accounts-payable, debtor-ledger or collections ledger in m16; floating-point money.

## ADR-068 — Litigation privilege/confidentiality model: strategy, pleadings, witness statements, submissions redacted, never in events/audit; maker-checker + single-winner CAS; safe downstream boundaries (Stage 4.2)
**Status:** **ACCEPTED** — 2026-07-28 (product owner + security + legal). Module `m16-litigation`, branch as ADR-065.

**Decision:** a proceeding carries a **confidentiality level**; **legal strategy**, **full pleadings**, **witness statements**, **full submissions**, **private witness/party contacts** and **confidential order/outcome terms** are **sensitive**: stored under RLS, **redacted on read** behind dedicated privileged `litigation.*` permissions (20 of 56), and **NEVER placed in domain events or audit payloads** (which carry ids, states, dates and safe reason codes only). Reading un-redacted privileged/confidential data is itself audited. Controlled actions are governed: **maker-checker** on **filing** and **bundle** approval (approver ≠ preparer, enforced in the service AND the DB CHECKs `litigation_filing_sod_ck` / `litigation_bundle_sod_ck`); **single-winner CAS** on **service verification** (`verification_status`) and **exhibit admission** (`admitted_status`). Downstream **M17 enforcement** and **M18 knowledge** are reached **only by safe boundary events** — `EnforcementReferralReady` and `KnowledgeCandidateCreated` — carrying no M17/M18 internals and no sensitive payload. The single `litigation.lifecycle` event family (36 event types) flows through the ONE m06 outbox.

**Consequence:** litigation privilege / PII minimization holds across every API view, event and audit entry; controlled filings, bundles, service and exhibit admissions cannot be self-approved or double-won; M16 signals M17 and M18 through explicit, safe, event-only boundaries. Rejected: putting strategy/pleadings/witness statements/submissions/contacts/confidential terms in events for convenience; returning privileged detail to any authenticated caller; letting one identity both prepare and approve a filing or bundle; two winners on service verification or exhibit admission; leaking M17/M18 internals across the boundary; a second outbox in m16.

## ADR-069 — Configurable versioned recovery types + enforceable-instrument/strategy vocabularies; nothing Kenya-specific in core; the governed M16→M17 inbound contract (Stage 4.3)
**Status:** **ACCEPTED** — 2026-07-28. Module `m17-recovery`, branch `feature/stage-4-3-m17-recovery-enforcement`. (M17 was previously `deferred`; governance PR #28 approved it for build once the dependency order was satisfied — m14 + m16 certified.)

**Decision:** recovery types and recovery SLA policies are **declarative, versioned, immutable-after-publish specs** (one ACTIVE per code+scope, content-hash frozen at publish, mirroring m09 doctype / m12 / m13 / m14 / m16), and the enforceable-instrument, recovery-strategy, enforcement-method and party-role vocabularies are **configured as data per tenant**. Recovery procedures, courts, auctioneers, statutes, notices and enforcement methods are **never hardcoded in service logic** — nothing Kenya-specific is baked into the generic core. There is **NO executable expression** inside a recovery type; complex, explainable decisioning (risk / assignment / SLA selection / closure eligibility) is delegated to the **m07 rules engine** via a recorded `ruleEvaluationId`, and rules never mutate a recovery directly. The **M16→M17 boundary** is a **governed inbound contract**: m17 consumes an M16 enforcement referral through an `EnforcementReferral` **port** and `POST /recovery/from-proceeding`, **fire-and-forget** and **idempotent on a referral key** (one recovery per referral key via the `recovery_referral` ledger; a single proceeding may produce several referrals, yielding several recoveries), preserving the source proceeding id + optional matter id + correlation/causation and emitting `RecoveryReferredFromProceeding`. The proceeding/matter ids are **opaque references** — **m17 NEVER reads M16- or M14-owned tables.**

**Consequence:** the recovery platform is generic and configurable across jurisdictions, instruments and enforcement methods, decisioning stays in the one rules engine, and M17 integrates with M16 through an explicit, idempotent, contract-only boundary. Rejected: hardcoded recovery procedures / Kenyan courts / auctioneers / statutes / notices / enforcement methods; an embedded rules mini-language in m17; reading m16's or m14's tables directly; a single-recovery-per-proceeding assumption; a second recovery on a duplicate referral.

## ADR-070 — Deterministic clock-driven SLA + deadline + limitation math via a Clock port; fail-closed limits; the recovery as a first-class object (Stage 4.3)
**Status:** **ACCEPTED** — 2026-07-28. Module `m17-recovery`, branch as ADR-069.

**Decision:** SLA due dates + warn/breach state, deadline due instants and **limitation** deadlines are **PURE functions** of a spec/rule, a supplied `Clock` (epoch ms) and accumulated paused duration — injected through a port (`SystemClock`/`FixedClock`), so there is **no ambient `Date.now`** and behaviour is deterministic, testable and replayable. `limitation` deadlines are treated as **high-risk** and are **clearly distinguishable** (`isLimitation` / `isLimitationSafe`) from ordinary procedural deadlines, because a missed limitation is irreversible. m17 builds **no timer engine**: timer dispatch + escalation are delegated to m06/m08; m17 records the breach and publishes an event. Every bound (title/summary/description/note length, party/instrument/batch counts, search limit) is enforced **fail-closed**. The module lands at **25 owned tables** making the **recovery a first-class object** — distinct from an M16 proceeding's enforcement fields — with its own type/SLA specs, the referral ledger, status + assignment ledgers, parties, enforceable instruments, strategies, demands, negotiations, arrangements + installments, enforcement actions, security, agents + reports, receipts, waivers, write-off recommendations, outcomes, deadlines, cost references, notes and relationships.

**Consequence:** deadline/SLA/limitation behaviour is proven with a `FixedClock` with zero flakiness; no second scheduler; no runaway payload; the recovery is modelled once, in full, rather than smeared across an M16 proceeding. Rejected: ambient wall-clock reads; a bespoke m17 timer/cron; unbounded free-text; treating a limitation deadline like any other deadline; modelling a recovery as a few enforcement fields on an M16 proceeding.

## ADR-071 — The finance boundary: M17 stores amounts as references only; no cash application, ledger, AR, payment, reconciliation or accounting write-off (Stage 4.3)
**Status:** **ACCEPTED** — 2026-07-28 (product owner + finance). Module `m17-recovery`, branch as ADR-069.

**Decision:** M17 stores **ALL amounts as REFERENCES only** — decimal-safe integer **minor units** used purely as reference data (debt reference, principal/recovered/outstanding tallies, receipt amount, currency, external/finance references). m17 performs **NO cash application, NO general ledger, NO accounts receivable, NO payment execution, NO reconciliation, and NO accounting write-off**. Repayment **arrangements are OPERATIONAL schedule metadata** — installments carry **met/missed markers, not payments**; a human/finance system executes any money movement elsewhere. Recovery **receipts** carry an external/finance reference and are **reference records** only; the recovered/outstanding tallies on the recovery are **reference figures**. **Write-off is a RECOMMENDATION with maker-checker approval** (approver ≠ recommender, enforced in the service AND the DB CHECK `recovery_writeoff_recommendation_sod_ck`) — a human/finance system executes any accounting write-off. **Arrangement approval is also maker-checker** (approver ≠ proposer, enforced in the service AND the DB CHECK `recovery_arrangement_sod_ck`).

**Consequence:** m17 tracks the operational dimension of recovery and enforcement without touching money movement, keeping Finance's controls (no auto-post, balanced journals, SoD) the sole responsibility of the later Finance modules; a write-off is proposed and approved by two distinct identities but posted by nobody in m17. Rejected: applying cash, posting a ledger, running AR, executing payments, reconciling or writing off accounting balances from m17; installments that move money; a receipt that is anything but a reference; a self-approved arrangement or write-off; floating-point money.

## ADR-072 — Recovery privilege/confidentiality model: debtor contacts, negotiation strategy, settlement terms, bank/payment details, security valuations redacted, never in events/audit; safe downstream M18 boundary (Stage 4.3)
**Status:** **ACCEPTED** — 2026-07-28 (product owner + security + legal). Module `m17-recovery`, branch as ADR-069.

**Decision:** a recovery carries a **confidentiality level**; **debtor/party contacts**, **negotiation strategy**, **settlement terms**, **bank/payment details** and **security valuations** are **sensitive**: stored under RLS, **redacted on read** behind dedicated privileged `recovery.*` permissions (20 of 58), and **NEVER placed in domain events or audit payloads** (which carry ids, states, dates and safe reason codes only). Reading un-redacted privileged/confidential data is itself audited. Controlled actions are governed: **maker-checker** on **arrangement** approval (approver ≠ proposer) and **write-off** approval (approver ≠ recommender), enforced in the service AND the DB CHECKs `recovery_arrangement_sod_ck` / `recovery_writeoff_recommendation_sod_ck`. Downstream **M18 legal-knowledge** is reached **only by safe boundary signals** — carrying no M18 internals (precedent repository / knowledge graph / AI) and no sensitive payload; **M17 emits no M18 internals**. The single `recovery.lifecycle` event family (36 event types) flows through the ONE m06 outbox.

**Consequence:** recovery privilege / PII minimization holds across every API view, event and audit entry; controlled arrangements and write-offs cannot be self-approved; M17 signals M18 through an explicit, safe, event-only boundary. Rejected: putting debtor contacts / negotiation strategy / settlement terms / bank details / security valuations in events for convenience; returning privileged detail to any authenticated caller; letting one identity both propose and approve an arrangement or both recommend and approve a write-off; leaking M18 internals across the boundary; a second outbox in m17.

## ADR-073 — Configurable per-tenant legal taxonomy + governed knowledge/authority/clause vocabularies; nothing jurisdiction-specific in core; keyword search only (no AI/vector/semantic search) (Stage 4.4)
**Status:** **ACCEPTED** — 2026-07-29. Module `m18-legaldocs`, branch `feature/stage-4-4-m18-legal-knowledge-management`. (M18 was previously `documented`; it was approved for build via governance PR #31 once the dependency order was satisfied — m14 + m16 + m17 certified.)

**Decision:** the legal **taxonomy** — practice area, jurisdiction, legal topic, document type and tag — is **configured as data per tenant** in `legaldoc_taxonomy` (one ACTIVE per kind+code, non-destructively retired via `active`), and the knowledge, authority-type + treatment, and clause-kind vocabularies are **governed control lists** the platform reasons about. Practice areas, jurisdictions, statutes, courts, document types and legal topics are **never hardcoded in service logic** — **nothing Kenya-specific is baked into the generic core**. Retrieval is **deterministic keyword + configurable-taxonomy filtering ONLY**: there is **NO AI, NO vector/embedding index, NO semantic search, NO relevance model and NO production legal-research vendor ingestion** — an external knowledge-intake adapter normalizes to safe fields + a payload hash behind a `KnowledgeIntakeAdapter` port (deterministic double only, no secrets). Complex, explainable classification/routing is delegated to the **m07 rules engine** via a recorded `ruleEvaluationId` (rules never mutate a knowledge record), never an embedded expression or model in m18.

**Consequence:** the legal-knowledge platform is generic and configurable across jurisdictions, practice areas and document types, search is deterministic and auditable, and no untested/opaque AI or vendor pipeline enters the trust boundary. Rejected: hardcoded practice areas / jurisdictions / statutes / courts / document types; a vector store, embedding index or semantic-search model in m18; an LLM/AI summarizer or classifier inside the module; ingesting an unrestricted legal-research vendor payload; an embedded rules mini-language in m18.

## ADR-074 — Immutable-after-publish versioning for knowledge/templates/clauses (content_hash frozen at publish, one-published per code, change = new version via supersession) + deterministic clock-driven review/expiry deadline math (Stage 4.4)
**Status:** **ACCEPTED** — 2026-07-29. Module `m18-legaldocs`, branch as ADR-073.

**Decision:** knowledge records, document templates and clauses are **PUBLISHABLE, versioned objects** on one shared 9-state lifecycle (`draft` → `under_review` → (`changes_requested` / `approved` → `published`) → `superseded` / `withdrawn` → `archived`, with `reopened`) through the single choke point `checkPublishableTransition`. Publishing **freezes the content** (`content_hash` frozen at publish), there is **exactly ONE published version per code** (a partial unique index on `status = 'published'`), and a change is a **NEW version created via supersession** (`version_number` + `supersedes_id`/`superseded_by_id`), **never an in-place edit** of published content. Review, expiry, renewal and authority-review deadlines are **PURE functions** of a rule (`offset_days` or an `explicit` due instant), a supplied `Clock` (epoch ms) and a start instant — injected through a port (`SystemClock`/`FixedClock`), so there is **no ambient `Date.now`** and overdue behaviour is deterministic, testable and replayable. `expiry` is the **highest-risk** review deadline and **clearly distinguishable** (`isExpiry` / `isExpirySafe`) — an authority/knowledge expiry must not already be in the past. m18 builds **no timer engine**: business-calendar expansion + overdue/review dispatch + escalation delegate to m06/m08; every bound (title/summary/abstract/note length, batch/search counts) is enforced **fail-closed**. The module lands at **20 owned tables**.

**Consequence:** a published legal position is an immutable, hash-anchored record with exactly one live version per code, superseded (never overwritten) when it changes, and review/expiry behaviour is proven with a `FixedClock` with zero flakiness. Rejected: editing published knowledge/template/clause content in place; two published versions of one code; a change that mutates rather than supersedes; ambient wall-clock reads; a bespoke m18 timer/cron; treating an expiry like any other deadline; unbounded free-text.

## ADR-075 — Opaque cross-module references (m09 documents / m14 matters / m16 litigation / m17 recoveries by id only); m18 reads no other module's tables and performs no cross-module mutation; it owns no document storage (Stage 4.4)
**Status:** **ACCEPTED** — 2026-07-29. Module `m18-legaldocs`, branch as ADR-073.

**Decision:** a knowledge record links to other modules' objects — **m09 documents, m14 matters, m16 litigation proceedings and m17 recoveries** — through **OPAQUE ids** on `legaldoc_reference`: `ref_type` (`document` / `matter` / `litigation` / `recovery` / `authority` / `precedent` / `external`) records which module the `target_id` belongs to, and the tenant guarantees isolation via RLS. **m18 NEVER reads those modules' owned tables**, imports none of their internals, imposes **no lifecycle coupling** and performs **NO cross-module mutation** — the reference is a safe, one-directional citation. m18 **owns NO document storage**: document bytes live in **m09**; templates, clauses, opinions, research and knowledge attach content **by reference only** (`content_ref` / `document_ref` — no bytes, and no storage reference leaks in API responses). Shared engines (workflow m06, rules m07, escalation/notifications m08, documents m09) are reached **through events/contracts and ports**, never by importing their internals.

**Consequence:** m18 can cite the source matter/proceeding/recovery/document a piece of legal knowledge came from without reaching into another module's private schema or duplicating document storage, keeping the boundary explicit, one-directional and safe. Rejected: reading m09/m14/m16/m17 tables directly; a foreign key into another module's schema; storing document bytes in m18; a second document-storage engine; mutating another module's state from m18; lifecycle coupling to a referenced object.

## ADR-076 — Legal privilege/confidentiality model: privileged advice, confidential clause/opinion/analysis text, drafting strategy and restricted notes redacted, gated by dedicated privileged permissions, never in events/audit/logs/analytics/search snippets; ethical walls via RLS FORCE (Stage 4.4)
**Status:** **ACCEPTED** — 2026-07-29 (product owner + security + legal). Module `m18-legaldocs`, branch as ADR-073.

**Decision:** every knowledge record, authority, precedent, opinion, research note, template, clause and note carries a **confidentiality level** (`standard` / `confidential` / `restricted` / `privileged`) and, where legal advice is involved, a **privilege level** (`none` / `work_product` / `attorney_client` / `litigation_privilege`). **Privileged legal advice**, **confidential clause/opinion/analysis text** (`abstract`, opinion `conclusion`/`recommendation`, precedent `holding`, research `findings`, clause/template content), **drafting strategy** and **restricted notes** (`confidential` / `privileged` / `strategy`) are **sensitive**: stored under RLS, **redacted on read** behind dedicated privileged `legaldocs.*` permissions (19 of 46), and **NEVER placed in domain events, audit payloads, logs, analytics or search snippets** (which carry ids, states, dates, reason codes and safe analytics dimensions only). Reading un-redacted privileged/confidential data is itself audited. **Ethical walls** are enforced by **RLS FORCE + the dedicated privileged permissions** — there is **no vague `legaldocs.admin`**. Controlled actions are governed by **maker-checker**: knowledge, template, clause and opinion approval require **approver ≠ submitter/author**, enforced in the service AND the DB CHECKs `legaldoc_knowledge_sod_ck` / `legaldoc_template_sod_ck` / `legaldoc_clause_sod_ck` / `legaldoc_opinion_sod_ck`. The single `legaldocs.lifecycle` event family (36 event types) flows through the ONE m06 outbox.

**Consequence:** legal privilege / confidentiality minimization holds across every API view, event, audit entry, log line, analytics dimension and search snippet; ethical walls are structural (RLS FORCE) rather than advisory; and no controlled legal-knowledge object can be self-approved. Rejected: putting privileged advice / confidential analysis / drafting strategy / restricted notes in events, audit, logs, analytics or search results for convenience; returning privileged detail to any authenticated caller; a broad `legaldocs.admin` that bypasses the ethical wall; letting one identity both author and approve an opinion or both submit and approve a knowledge record/template/clause; a second outbox in m18.

## ADR-077 — The finance-foundation composition: 18 FORCE-RLS reference/foundation tables as the root of the finance domain; the exact set fixed here (Stage 3.1)
**Status:** **ACCEPTED** — 2026-07-29. Module `m19-finance`, branch `feature/stage-3-1-m19-finance-operations`. (M19 was previously `documented` — the first module of Stage 3 Finance; the module registry / repository specified only the table **count** (18) and no `docs/04-modules/` spec, so the exact composition is decided in this ADR.)

**Decision:** the **root of the finance domain** is a finance reference / foundation data layer of **exactly 18 tenant-scoped tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite `(tenant_id, id)` keys + composite FKs and a `version` column for optimistic concurrency: `finance_entity` (the accounting entity / book, distinct from the m01 tenant org unit; tree), `finance_account_type` (the five account classes asset/liability/equity/income/expense + normal balance side), `finance_currency` + `finance_exchange_rate` (exact-decimal FX, one rate per base/quote/type/date) + `finance_entity_currency` (functional/presentation/transaction role), `finance_account` (the **chart of accounts** / ledger account; tree; `postable`; draft→active↔inactive→archived) + append-only `finance_account_history`, `finance_fiscal_year` + `finance_fiscal_period` (the **fiscal calendar**; period open/closed/locked) + append-only `finance_period_history`, `finance_cost_center` (tree), `finance_dimension` + `finance_dimension_value` (tree), `finance_tax_code` + `finance_tax_rate` (exact-decimal, effective-dated), `finance_payment_term`, and `finance_config` (versioned, immutable-after-publish, one active version per entity+scope, idempotency-keyed) + append-only `finance_config_history`. Three of the 18 are **append-only history ledgers** (account / period / config), INSERT+SELECT only; **no table grants DELETE** (archive-by-status / deactivate / supersede instead, ADR-010). Chart codes, cost centres, dimensions, tax codes, currencies and payment terms are **configurable per-tenant data**; only the governed control vocabularies (account classes + normal side, lifecycle states, rate/tax types) are enumerated in code — **nothing Kenya-/Aptic-specific is baked into the generic core**. Four services (Catalog / Chart / Calendar / Config) map onto these tables; the API is `/api/v1/finance`.

**Consequence:** the finance domain has a single, explicit, generic foundation that reconciliation (m15), GL reconciliation (m20) and the journal engine (m21) build on, with the exact table set pinned rather than left implicit behind a count. Rejected: leaving the composition undefined behind the number 18; folding journals / journal lines / postings / balances into the foundation; hardcoded chart codes / tax codes / currencies in service logic; a global (non-tenant-scoped) currency or account registry; a DELETE path or a mutable history ledger.

## ADR-078 — Decimal-safe finance foundation: no monetary amounts/balances; exact-NUMERIC FX + tax rates (never float); the period open/closed/locked state as the cross-module "no posting into a closed period" gate (Stage 3.1)
**Status:** **ACCEPTED** — 2026-07-29. Module `m19-finance`, branch as ADR-077.

**Decision:** the finance foundation carries **NO monetary amounts and NO balances** — journals, journal lines, postings and ledger balances live with the posting engine (m21), never in m19. The **only** money-adjacent values are **exact-decimal rates**: FX exchange rates (`finance_exchange_rate.rate`, **NUMERIC(30,12)**, strictly positive, one per base/quote/type/date) and tax rates (`finance_tax_rate.rate_percent`, **NUMERIC(9,6)**, non-negative, effective-dated), validated in `money.ts` as canonical decimal **strings** (`isValidRate` / `isValidPercentage`) and stored as exact NUMERIC — **never** parsed into a binary float (CLAUDE.md money rule, ADR-007). No domain event or audit payload carries an amount, a balance or a float — ids, codes, states, dates and safe reference dimensions only. Accounting periods (`finance_fiscal_period`) carry an **open / closed / locked** state through the single choke point `checkPeriodTransition` (`open` ↔ `closed` → `locked`; `locked` terminal/sealed); `isPeriodPostable` fails closed — **only an `open` period is postable**. This period state is the **cross-module "no posting into a closed period" gate** the journal engine (m21) reads: m19 **emits** period open/close/lock/reopen on `finance.lifecycle` but **never posts a ledger entry itself**. Effective-dating (period boundaries, FX rate dates, tax effective dates, config publication) is deterministic via an injected `Clock` port — no ambient `Date.now`.

**Consequence:** the finance foundation is decimal-safe end-to-end (no float can enter a rate, an amount or a balance because there are no amounts/balances at all), and the period-close gate is a single, auditable, cross-module signal downstream posting honours without m19 ever posting. Rejected: storing monetary amounts or balances in the foundation; a floating-point FX or tax rate; putting an amount/balance/float in an event or audit payload; m19 posting a ledger entry or enforcing balancing (that is m21); posting into a `closed`/`locked` period; an ambient wall-clock read for effective-dating.

## ADR-079 — Closing the m19 naming GAPs: introduce the `finance.lifecycle` event family, register `/api/v1/finance` (GAP-2) and the `finance.*` permission namespace (GAP-4); the `FIN_` audit prefix is shared with m23 (Stage 3.1)
**Status:** **ACCEPTED** — 2026-07-29. Module `m19-finance`, branch as ADR-077.

**Decision:** m19 closes the finance-foundation naming GAPs recorded in `manifests/naming-map.yaml`. (1) **Event family** — introduce **`finance.lifecycle`** (the naming-map previously had `event_families: []`): one family, **33 event types**, version 1, classification `internal`, delivered through the **single m06 outbox** (m19 owns no outbox); payloads carry ids, codes, states, dates + safe reference dimensions only (ADR-078). (2) **API prefix (GAP-2)** — register **`/api/v1/finance`** as m19's audited finance-foundation API. (3) **Permission namespace (GAP-4)** — register the **`finance.*`** namespace: **45** three-segment `finance.<entity>.<action>` permissions, **seeded into the identity `permissions` catalogue** and listed in `manifests/permission-registry.yaml`, **16 privileged** (entity-manage / account-type-manage / account-archive / fiscal-year-close / fiscal-year-reopen / period-close / period-lock / period-reopen / currency-manage / exchange-rate-manage / tax-code-manage / tax-rate-manage / config-manage / config-publish / analytics-export / platform-administer) — **no wildcard and no vague `finance.admin`**. (4) **Audit prefix** — **34** `FIN_` codes in `manifests/audit-code-registry.yaml`; the **`FIN_` prefix is shared with m23-finance-integration**, so the two modules' code sets must **not collide** (unregistered codes fail CI, ADR-005). The four axes (API prefix, permission namespace, event family, audit prefix) are named independently — none is derived from another.

**Consequence:** every controlled finance-foundation route has a registered permission, a registered audit code and (where it transitions state) a registered `finance.lifecycle` event, so CI's registry conformance passes and the finance domain has a clean, collision-free naming baseline for the modules that follow. Rejected: emitting finance events with no registered family; an unregistered `finance.*` permission or a wildcard/`finance.admin`; a `FIN_` code that collides with m23; deriving the API prefix, permission namespace, event family or audit prefix from one another.

## ADR-080 — Strict finance-foundation boundary: M19 owns reference/foundation data only — no journals, postings, reconciliation, approvals, AI or cash/AR/AP/payments; it reads no other module's tables (Stage 3.1)
**Status:** **ACCEPTED** — 2026-07-29. Module `m19-finance`, branch as ADR-077.

**Decision:** M19 is the **root of the finance domain and owns reference/foundation data ONLY**. It holds **no journals, no journal lines, no postings, no ledger balances** (those are the journal / posting engine **m21**), **no reconciliation** (**m15/m15a**), **no GL reconciliation** (**m20**), **no approval workflow** (**m22**), **no finance integration / external accounting connector** (**m23**), **no AI** (**m27**) and **no cash application / accounts receivable / accounts payable / payment / bank-feed** surface. Those modules are **downstream consumers**: they read m19's reference data (entities, chart of accounts, currencies + FX, tax, dimensions, cost centres, config) and honour the accounting-period **open/closed/locked gate** through the `finance.lifecycle` events + the finance API under **their own** permissions. **m19 NEVER reads those modules' owned tables**, imports none of their internals and performs **no cross-module mutation** — the dependency is strictly one-directional (downstream → m19), so the foundation can be built and certified first. Shared engines (authorization m02, audit m03, workflow + the single outbox m06) are reached **through kernel DI tokens, events/contracts and ports**, never by importing internals.

**Consequence:** the finance foundation is a small, generic, independently-certifiable root with an explicit one-directional boundary — downstream finance modules consume it without m19 reaching into their schemas or duplicating their engines, and no posting/reconciliation/approval/AI logic leaks into the reference layer. Rejected: a journal / posting / balance / ledger in m19; reconciliation, GL reconciliation, approval workflow, finance integration, finance AI or any cash/AR/AP/payment logic in m19; m19 reading m15/m20/m21/m22/m23/m27 tables; a foreign key into another finance module's schema; m19 mutating another module's state; a second outbox / audit / authorization engine.

## ADR-081 — The 18-table bank-reconciliation composition + the matching engine as a SEPARATE PURE package (m15a-matching, zero tables) consumed by m15-recon; the exact table set fixed here (Stage 3)
**Status:** **ACCEPTED** — 2026-07-30. Module `m15-recon + m15a-matching`, branch `feature/stage-3-m15-reconciliation-matching`. (Both modules were previously `documented`; the module spec `docs/04-modules/BANK_RECONCILIATION.md` gave only the capability list + the table **count** (18), so the exact composition and the engine/data split are decided in this ADR.)

**Decision:** bank reconciliation is split into two packages. **`m15-recon` owns exactly 18 tenant-scoped tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite `(tenant_id, id)` keys + composite FKs and a `version` column on mutable aggregates: `recon_bank_account` (multi-bank; `entity_ref` / `currency_ref` are **opaque m19 ids, no FK**), `recon_matching_ruleset` (versioned, immutable-after-publish, one active per code) + `recon_matching_rule` (kind + integer weight) + append-only `recon_ruleset_history`, `recon_statement_import` (per-account file-hash duplicate-protected, idempotency-keyed) + `recon_statement_line` (minor units), `recon_ledger_import` + `recon_ledger_entry` (minor units), `recon_run` (balances **referenced** only) + append-only `recon_status_history`, `recon_match` (1:1 / 1:many / many:1 / many:many / split / grouped; idempotency-keyed) + append-only `recon_match_line` (members) + append-only `recon_match_candidate` (**explainable engine evidence**), `recon_exception` (type + aging + required flag) + append-only `recon_manual_decision`, and append-only `recon_run_summary`, `recon_note` and `recon_import_error`. **Eight of the 18 are append-only ledgers** (ruleset / status history, match line, match candidate, manual decision, run summary, note, import error), INSERT+SELECT only; **no table grants DELETE** (archive / status transition / supersede instead, ADR-010). The matching **logic** is a **SEPARATE PURE package, `m15a-matching`, which owns ZERO tables** and performs no I/O: it scores a statement line against a candidate ledger entry under a versioned ruleset and is consumed by `m15-recon` as a library. The API is `/api/v1/reconciliation`; the one event family is `reconciliation.lifecycle` (24 types, version 1) on the single m06 outbox.

**Consequence:** reconciliation has a single, explicit, generic 18-table foundation with the exact set pinned rather than left implicit behind a count, and the matching logic is cleanly separated as a pure, independently-testable, reproducible engine that owns no state. Rejected: leaving the composition undefined behind the number 18; giving the matching engine its own tables or I/O; folding chart-of-accounts / GL / journals into reconciliation; a DELETE path or a mutable evidence ledger; a foreign key into another finance module's schema.

## ADR-082 — Deterministic, explainable, reproducible matching: rule kinds + confidence bands + colour status, integer-minor-unit money (never float); AI suggestions (m27) are an optional, separable layer never required (Stage 3)
**Status:** **ACCEPTED** — 2026-07-30. Module `m15-recon + m15a-matching`, branch as ADR-081.

**Decision:** matching is **deterministic, explainable and reproducible**. The engine scores a candidate from configurable **rule kinds** — `exact_reference`, `exact_amount`, `date_window` (decays across the window), `similarity` (a Jaccard token ratio) and `composite` (the weighted integer sum) — into an integer **score** 0..100, then a **confidence band** (`exact` / `strong` / `partial` / `review` / `unmatched`) mapped to a **colour status** (`dark_green` / `light_green` / `amber` / `orange` / `red`, with `escalated` **reserved** for the workflow, not the engine). The `exact` band is gated on a **zero amount-variance AND an exact reference AND a compatible direction** — a high fuzzy score alone never certifies an exact match. Every score carries the exact amount variance (minor units), the whole-day date variance, the reference match, a description ratio, direction compatibility and machine-readable reason + rule codes, persisted as append-only `recon_match_candidate` evidence tagged with the ruleset id + version, so **the same inputs + the same ruleset version always produce the same result** — no ambient clock, no randomness. Money is **INTEGER MINOR UNITS (`bigint`)** end to end — amounts, variances, tolerances, referenced balances and split/grouped sums; `assertMinorUnits` rejects any non-integer / float fail-closed, and text-similarity ratios in [0,1] are kept explicitly distinct from money (CLAUDE.md money rule, ADR-007). **AI suggestions (m27) are an OPTIONAL, SEPARABLE layer**: they may add suggestions with confidence, but reconciliation is fully functional and certified on the deterministic engine alone, and AI never approves, posts or auto-confirms a match.

**Consequence:** every proposed match is explainable and human-confirmable, a run is reproducible and auditable from its recorded evidence, and no float can enter a monetary value. The system works end to end with zero AI, so m27 is a strict enhancement rather than a dependency. Rejected: a floating-point amount, variance or tolerance; a non-reproducible or clock/randomness-dependent score; certifying an `exact` match on a fuzzy score without a zero variance + exact reference; making AI suggestion a required step; letting AI approve, post or auto-confirm a match.

## ADR-083 — Split/grouped/1:many/many:1 matching + manual override as APPEND-ONLY evidence that never overwrites the engine's candidate evidence; a run cannot auto-complete with unresolved required exceptions (Stage 3)
**Status:** **ACCEPTED** — 2026-07-30. Module `m15-recon + m15a-matching`, branch as ADR-081.

**Decision:** a match may span multiple lines — **`one_to_one` / `one_to_many` / `many_to_one` / `many_to_many` / `split` / `grouped`** — with its members recorded in append-only `recon_match_line`; a **split/grouped match is certified balanced only when the two sides' minor-unit sums are EXACTLY equal** (`balances` / `sumMinor`, integer arithmetic, no float). **Manual review/override** — manual match, unmatch, tick, group, split, waive, reopen — is recorded as **append-only `recon_manual_decision` evidence that NEVER overwrites** the engine's `recon_match_candidate` evidence: both the machine's proposal and the human's decision are preserved, so the audit trail shows what the engine proposed and what the human decided. Manual override, unmatch, ruleset publish/manage, run reopen, exception waive, manual match/group and analytics export are **privileged**. **A reconciliation run cannot auto-complete with unresolved REQUIRED exceptions**: the completion service checks the exception state through `checkExceptionTransition` + the `required` flag and **fails closed** until every required exception is `resolved` or explicitly `waived` — mirroring the "no auto-close with unresolved required exceptions" rule in the module spec.

**Consequence:** high-volume reconciliation supports the real cardinalities (splits, groupings, one-to-many) with exact integer balancing, the human decision layer is fully auditable without ever destroying machine evidence, and no run can be silently completed while required exceptions remain open. Rejected: overwriting or deleting the engine's candidate evidence on a manual override; a split/grouped match that balances only approximately or in float; auto-completing a run with unresolved required exceptions; letting a non-privileged identity perform override / unmatch / waive / reopen.

## ADR-084 — Reconciliation boundary: bank reconciliation + matching only — no chart of accounts (m19), GL reconciliation (m20), journals/postings (m21), approvals (m22) or integration (m23); m19/m09 referenced by opaque id; per-account file-hash duplicate-import protection (Stage 3)
**Status:** **ACCEPTED** — 2026-07-30. Module `m15-recon + m15a-matching`, branch as ADR-081.

**Decision:** M15 owns **bank reconciliation + the matching engine ONLY**. It holds **no chart of accounts** (that is the finance foundation **m19**), **no GL reconciliation** (**m20**), **no journals / journal lines / postings / ledger balances** (**m21**), **no approval workflow** (**m22**), **no finance integration / external accounting connector / bank feed** (**m23**) and **no AI models** (**m27** — optional, separate). The m19 finance foundation (accounting entity, currency) and m09 documents (a PDF statement import) are referenced by **opaque id only** — **no foreign key** into m19 or m09, and m15 **reads none of their tables**. Any journal recommendation flows **downstream to draft-only journals** (m21); m15 never posts. Statement + ledger imports are **duplicate-protected by a per-account file-hash unique index** (`(tenant_id, bank_account_id, file_hash)`) and idempotency-keyed, so re-importing the same file for an account is rejected rather than duplicated. Shared engines (authorization m02, audit m03, workflow + the single outbox m06, rules m07, documents m09) are reached **through kernel DI tokens, events/contracts and ports**, never by importing internals; m15 publishes `reconciliation.lifecycle` onto the one m06 outbox and creates no second outbox.

**Consequence:** reconciliation is a focused, independently-certifiable module with an explicit boundary — it consumes the finance foundation and documents without reaching into their schemas or duplicating any engine, it never posts a journal, and a bank statement cannot be double-imported for the same account. Rejected: a chart of accounts, GL reconciliation, journal/posting, approval or integration surface inside m15; a foreign key into m19 or m09; m15 reading another module's tables; auto-posting a journal from a match; re-importing the same statement file for an account; a second outbox / audit / authorization engine.

## ADR-085 — The 24-table GL-reconciliation composition; the exact table set fixed here (Stage 3)
**Status:** **ACCEPTED** — 2026-07-31. Module `m20-glrecon`, branch `feature/stage-3-m20-gl-reconciliation`. (Previously `documented`; the module spec `docs/04-modules/GL_RECONCILIATION.md` and `manifests/module-registry.yaml` gave only the capability list + the table **count** (24), so the exact composition is decided in this ADR.)

**Decision:** GL reconciliation owns **exactly 24 tenant-scoped tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite `(tenant_id, id)` keys + composite FKs and a `version` column on mutable aggregates: `gl_recon_account` (`gl_account_ref` / `currency_ref` are **opaque m19 ids, no FK**), `gl_ruleset` (versioned, immutable-after-publish, one active per code) + `gl_rule` + append-only `gl_ruleset_history`, `gl_import` (per-account file-hash duplicate-protected, idempotency-keyed) + append-only `gl_import_error`, `gl_balance` (opening/debits/credits/closing, **invariant-checked**), `gl_line` (minor units), `gl_source_import` + `gl_source_line` (minor units), `gl_recon_run` + append-only `gl_run_status_history` + append-only `gl_run_balance` (**invariant evidence**), `gl_match` (idempotency-keyed) + append-only `gl_match_line` + append-only `gl_match_candidate` (**explainable engine evidence**), `gl_reconciling_item` (type + aging), `gl_exception` (open -> under_review -> resolved/waived; aging + required flag) + append-only `gl_manual_decision`, `gl_certification` + append-only `gl_certification_history`, `gl_journal_recommendation` (**draft-only**), and append-only `gl_run_summary` + `gl_note`. **Ten of the 24 are append-only ledgers** (INSERT+SELECT only); **no table grants DELETE** (archive / status transition / supersede instead, ADR-010). The API is `/api/v1/gl-reconciliation`; the one event family is `glrecon.lifecycle` (33 types, version 1) on the single m06 outbox.

**Consequence:** GL reconciliation has a single, explicit, generic 24-table foundation with the exact set pinned rather than left implicit behind a count. Rejected: leaving the composition undefined behind the number 24; a DELETE path or a mutable evidence ledger; a foreign key into another finance module's schema; folding chart-of-accounts / journals / postings into GL reconciliation.

## ADR-086 — Closing the m20 naming divergence: introduce the `glrecon.lifecycle` event family, register `/api/v1/gl-reconciliation` and the `gl_reconciliation.*` permission namespace; the `GLRECON_` audit prefix (Stage 3)
**Status:** **ACCEPTED** — 2026-07-31. Module `m20-glrecon`, branch as ADR-085.

**Decision:** m20 resolves the "canonical three-way divergence" recorded in `manifests/naming-map.yaml` (gl-reconciliation / gl_reconciliation / glrecon). (1) **Event family** — introduce **`glrecon.lifecycle`** (33 event types, version 1, classification `confidential`), delivered through the **single m06 outbox** (m20 owns no outbox); payloads carry ids, states, match types, confidence bands, scores, variances (minor units) and reason codes only — never GL account numbers, raw source content or float (ADR-007). (2) **API prefix** — register **`/api/v1/gl-reconciliation`**. (3) **Permission namespace** — register **`gl_reconciliation.*`**: **35** three-segment `gl_reconciliation.<entity>.<action>` permissions, **seeded** into the identity catalogue + listed in `manifests/permission-registry.yaml`, **11 privileged** (account manage/deactivate, ruleset manage/publish, run reopen, manual match, unmatch, exception waive, certification override, analytics export, platform administer) — **no wildcard, no vague `gl_reconciliation.admin`**. (4) **Audit prefix** — **37** `GLRECON_` codes. The four axes are named independently — none is derived from another. The event family was pulled out of the placeholder `finance` group into its own **implemented** `gl_reconciliation` group owned by m20.

**Consequence:** every controlled GL-reconciliation route has a registered permission, a registered audit code and (where it transitions state) a registered `glrecon.lifecycle` event, so CI's registry conformance passes. Rejected: emitting glrecon events with no registered family; an unregistered `gl_reconciliation.*` permission or a wildcard/`gl_reconciliation.admin`; a `GLRECON_` code that collides with another prefix; deriving one naming axis from another.

## ADR-087 — Reuse the m15a matching engine for GL line matching; add only the GL-specific balance engine — never duplicate the matching algorithm (Stage 3)
**Status:** **ACCEPTED** — 2026-07-31. Module `m20-glrecon`, branch as ADR-085.

**Decision:** GL line matching **REUSES the PURE `m15a-matching` engine** (score / confidence band / colour status / variances (minor units) / reason codes / `bestCandidate` / `classifyMatchType` / `balances`) as a library — there is **exactly one matching implementation** in the platform and m20 does **not** re-implement scoring, banding or split-balancing. m20 adds ONLY the genuinely-new **GL balance engine** (`aggregateByDirection`, `calculatedClosingMinor`, `reconcileBalance`) — the general-ledger balance invariant and its explainable reconciliation — which m15a does not cover. Both engines are pure, deterministic and reproducible (no ambient clock, no randomness, no float): the same inputs + the same ruleset version always produce the same output, recorded as append-only `gl_match_candidate` (line) and `gl_run_balance` (balance) evidence.

**Consequence:** GL reconciliation gets the full, certified matching behaviour without a second copy of the algorithm to drift, plus the one piece it genuinely needs (the balance invariant). Rejected: copying or forking the m15a scoring/banding/balancing logic into m20; a floating-point score, variance or balance; a non-reproducible, clock/randomness-dependent result.

## ADR-088 — The GL balance invariant is deterministic and DB-enforced: calculated closing = opening + debits - credits, in integer minor units (Stage 3)
**Status:** **ACCEPTED** — 2026-07-31. Module `m20-glrecon`, branch as ADR-085.

**Decision:** the single GL sign convention is **calculated closing = opening + debits - credits**, computed in **INTEGER MINOR UNITS** (`bigint`) with no float anywhere. It is enforced in THREE places that must agree: (1) the pure engine (`calculatedClosingMinor` / `reconcileBalance`, `assertMinorUnits` rejecting any non-integer fail-closed); (2) a **DB CHECK** on `gl_balance` (`closing_balance_minor = opening_balance_minor + debits_minor - credits_minor`); and (3) a **DB CHECK** on the append-only `gl_run_balance` evidence (`calculated_closing_minor = opening_minor + debits_minor - credits_minor`). A GL import whose stated closing breaks the invariant is rejected on import; a run computes the calculated closing, compares it to the expected/source closing, records the **exact integer variance** + a stable reason code (`balance_exact` / `balance_within_tolerance` / `source_exceeds_gl` / `gl_exceeds_source`), and raises a required `closing_balance_mismatch` exception when the variance exceeds the ruleset tolerance.

**Consequence:** the balance invariant is explicit, deterministic, tested and impossible to violate at the database — a wrong closing balance cannot be persisted. Rejected: a float opening/debit/credit/closing/variance; an implicit or code-only invariant that the database does not enforce; silently accepting an out-of-balance closing.

## ADR-089 — Balance certification fails closed over open blockers: certifying with unresolved exceptions/items requires a PRIVILEGED override carrying a reason (Stage 3)
**Status:** **ACCEPTED** — 2026-07-31. Module `m20-glrecon`, branch as ADR-085.

**Decision:** a GL balance is certified through `gl_certification` (draft -> certified/rejected). A certification snapshots the calculated vs source balance, the exact variance (minor units) and the counts of **unresolved required exceptions + open reconciling items**. A balance with open blockers **cannot be certified** unless an explicit **override** is supplied, and the override is fail-closed on THREE conditions: it requires the **privileged `gl_reconciliation.certification.override` permission** (default deny), a **non-empty reason**, and is enforced at the database (`gl_certification` CHECK: `is_override = false OR override_reason IS NOT NULL`). An override records the critical `GLRECON_CERTIFICATION_OVERRIDDEN` audit code (reason-required) + a `CertificationOverridden` event, so certifying over open items is always a visible, attributed, reason-bearing act. A run likewise **cannot complete** while a required exception is open (mirrors ADR-083's fail-closed completion gate).

**Consequence:** a balance is never silently certified over open reconciliation issues; every such certification is a privileged, reasoned, audited exception. Rejected: certifying over open blockers without an override; an override without a privileged permission, without a reason, or not enforced by the database; completing a run with an open required exception.

## ADR-090 — Draft-only journal recommendations: m20 recommends and hands off; it NEVER posts a journal, writes to the general ledger, or approves anything (Stage 3)
**Status:** **ACCEPTED** — 2026-07-31. Module `m20-glrecon`, branch as ADR-085.

**Decision:** m20 produces **DRAFT journal recommendations ONLY** (`gl_journal_recommendation`, proposed -> withdrawn/handed_off) — a suggested debit/credit correction (accounts are **opaque m19 refs, no FK**), amount in minor units, reason and evidence. It is **draft by construction**: `is_draft` defaults true and a **DB CHECK** pins it (`is_draft = true`), so a non-draft recommendation cannot be persisted. m20 **never** posts a journal, alters a ledger balance, invokes an external finance system, or approves a recommendation — the handoff is the contract for the journal engine (**m21**) to pick up under **its own** controls + approval (**m22**). This honours the CLAUDE.md hard prohibitions ("never auto-post Finance journals"; "never allow AI/automation to approve or execute controlled actions"): AI/automation may recommend, a human posts through m21/m22.

**Consequence:** GL reconciliation feeds correcting-journal proposals downstream without ever posting or approving, and the draft-only guarantee is enforced at the database rather than merely in code. Rejected: a non-draft or posted recommendation in m20; m20 writing to the general ledger, posting a journal, or approving a recommendation; a foreign key into m21/m22; a recommendation that could be marked posted/approved inside m20.

## ADR-091 — The 18-table journal-engine composition; the exact table set fixed here (Stage 3)
**Status:** **ACCEPTED** — 2026-08-03. Module `m21-journal`, branch `feature/stage-3-m21-journal`. (Previously `documented`; the module spec `docs/04-modules/JOURNAL_ENGINE.md` and `manifests/module-registry.yaml` gave only the capability list + the table **count** (18) and `implementation-manifest.yaml` named only the 5 core tables, so the exact composition is decided in this ADR.)

**Decision:** the journal engine owns **exactly 18 tenant-scoped tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite `(tenant_id, id)` keys + composite FKs and a `version` column on mutable aggregates: `journal_type` (versioned, one active per code) and `journal_config` (versioned, immutable-after-publish, one active per scope, idempotency-keyed) and `journal_reason_code` (configurable reason-code registry); `journal_recommendation` (m20-handoff intake; **opaque** entity/currency/source/handoff refs, no FK) + append-only `journal_recommendation_line` + append-only `journal_recommendation_history`; `journal_draft` (**balanced-before-advance**, minor-unit totals) + `journal_line` (minor units; active/removed, no DELETE) + append-only `journal_status_history` + append-only `journal_draft_balance` (**balance evidence**) + append-only `journal_note`; append-only `journal_validation` + append-only `journal_validation_finding` (**machine-readable reason codes**); `posting_request` (approval-gated) + append-only `posting_request_history` + `posting_result` (evidence) + append-only `posting_result_history` + append-only `posting_idempotency` (**no-duplicate-post ledger**). **Ten of the 18 are append-only ledgers** (INSERT+SELECT only); **no table grants DELETE** (status transition / supersede / mark-removed instead, ADR-010). The API is `/api/v1/journals`; the event families are `journal.lifecycle` (16 types) + `posting_request.lifecycle` (6 types, posting deferred) on the single m06 outbox.

**Consequence:** the journal engine has a single, explicit, generic 18-table foundation with the exact set pinned rather than left implicit behind a count. Rejected: leaving the composition undefined behind the number 18; a DELETE path or a mutable evidence ledger; a foreign key into m19/m20/m22's schema; folding chart-of-accounts / GL reconciliation / approval workflow into the journal engine.

## ADR-092 — The draft journal lifecycle and the balanced-before-advance invariant: debits == credits, in integer minor units, DB-enforced (Stage 3)
**Status:** **ACCEPTED** — 2026-08-03. Module `m21-journal`, branch as ADR-091.

**Decision:** a draft journal moves `draft -> validated -> submitted -> posted`, or `-> withdrawn` (editing a `validated` draft reverts it to `draft`). Money is **INTEGER MINOR UNITS** (`bigint`) with no float anywhere; the double-entry balance (total debits == total credits) is enforced in THREE places that must agree: (1) the pure engine (`computeBalance` / `validateDraft`, `assertMinorUnits` rejecting any non-integer fail-closed); (2) a **DB CHECK** on `journal_draft` (`status = 'draft' OR total_debits_minor = total_credits_minor`) so a draft can only leave `draft` when balanced, plus a consistency CHECK (`is_balanced = (total_debits_minor = total_credits_minor)`); and (3) a **DB CHECK** on the append-only `journal_draft_balance` evidence (`balanced = (debits_minor = credits_minor)`). Validation is deterministic + reproducible (same input => identical output; no clock, no randomness) and produces one machine-readable reason code per finding (`balanced` / `unbalanced` / `single_sided` / `no_lines` / `non_positive_amount` / `float_amount` / `currency_mismatch` / `unknown_account` / `missing_entity` / `closed_period` / `locked_period` / `duplicate_posting`). A draft may only be submitted for approval once it is valid, balanced and in an open period.

**Consequence:** an unbalanced or non-decimal-safe journal can never advance past draft, and the balance invariant is impossible to violate at the database. Rejected: a float debit/credit/total; an implicit or code-only balance rule the database does not enforce; advancing an unbalanced draft; a non-reproducible, clock/randomness-dependent validation.

## ADR-093 — The m21 naming axes: `journal.lifecycle` + register-but-defer `posting_request.lifecycle`; `/api/v1/journals`; `journals.*`; the `JOURNAL_` audit prefix (Stage 3)
**Status:** **ACCEPTED** — 2026-08-03. Module `m21-journal`, branch as ADR-091.

**Decision:** (1) **Event families** — introduce **`journal.lifecycle`** (16 event types, version 1, classification `confidential`) AND **`posting_request.lifecycle`** (6 event types, version 1) — both delivered through the **single m06 outbox** (m21 owns no outbox); posting is DEFERRED (draft-first MVP), so `posting_request.lifecycle` is registered but posting is not performed. Payloads carry ids, states, totals (minor units) and reason codes only — never account numbers, line narratives, external credentials or float (ADR-007). Both families were pulled out of the placeholder `finance` group into their own **implemented** `journal` group owned by m21 (leaving `approval.lifecycle` for m22). (2) **API prefix** — register **`/api/v1/journals`**. (3) **Permission namespace** — register **`journals.*`**: **27** three-segment `journals.<entity>.<action>` permissions, **seeded** into the identity catalogue + listed in `manifests/permission-registry.yaml`, **9 privileged** (type manage, config manage/publish, posting-request create/authorize/cancel, posting-result record, reason-code manage, platform administer) — **no wildcard, no vague `journals.admin`, and no `journals.*.approve` / `journals.*.post`** (m21 never approves or posts). (4) **Audit prefix** — **23** `JOURNAL_` codes. The four axes are named independently — none is derived from another.

**Consequence:** every controlled journal route has a registered permission, a registered audit code and (where it transitions state) a registered event, so CI's registry conformance passes; posting stays declared-but-inert until the certification + confirmed posting contracts land. Rejected: emitting journal events with no registered family; an unregistered `journals.*` permission or a wildcard/`journals.admin`; an approve/post permission or route inside m21; a `JOURNAL_` code colliding with another prefix; performing posting under the registered-but-deferred family.

## ADR-094 — The m20 -> m21 recommendation handoff: consume the draft recommendation, copy under m21's own controls, never read m20's tables; idempotent per handoff (Stage 3)
**Status:** **ACCEPTED** — 2026-08-03. Module `m21-journal`, branch as ADR-091.

**Decision:** m21 ingests m20's DRAFT journal recommendations (the `RecommendationHandedOff` contract) into its **own** `journal_recommendation` + `journal_recommendation_line` under its own permissions, audit and events — it **never reads an m20 (or m19) table**; the source run, handoff, entity, currency and account references are carried as **opaque ids with no foreign key**. Intake is **idempotent per `handoff_ref`** (a unique partial index), so a re-delivered handoff returns the existing record rather than duplicating it. A recommendation moves `proposed -> accepted -> converted` (or `-> dismissed`); conversion mints a draft journal by copying the recommendation's legs as journal lines and recomputing the balance. Amounts are INTEGER MINOR UNITS, never float.

**Consequence:** the finance domain boundary holds (m21 depends on m20 only through an event + opaque references, exactly as m20 depends on m19), and a duplicated handoff cannot create a duplicate draft. Rejected: m21 reading m20's `gl_*` tables or taking a foreign key into them; a non-idempotent intake; converting a recommendation that was never accepted; a float recommendation amount.

## ADR-095 — The absolute posting controls, made concrete at the database: no autopost, no closed-period posting, no duplicate posting, maker != checker (Stage 3)
**Status:** **ACCEPTED** — 2026-08-03. Module `m21-journal`, branch as ADR-091.

**Decision:** the CLAUDE.md / ADR-007 posting prohibitions are enforced on `posting_request` at the **database**, not merely in code: (1) **no posting without approval** — a request cannot leave `prepared` (except to `cancelled`) without an **opaque m22 `approval_ref`** (CHECK: `status IN ('prepared','cancelled') OR approval_ref IS NOT NULL`); m21 **records** m22's decision, it never approves. (2) **No posting into a closed/locked period** — a request cannot become postable while the m19 period it reads is not open (CHECK: `status NOT IN ('ready','submitted','succeeded') OR period_status = 'open'`; ADR-078). (3) **Maker != checker (SoD)** — the recorded approver is never the requester (CHECK: `approved_by IS NULL OR approved_by <> requested_by`), enforced in the service too (fail closed). (4) **No duplicate posting** — a per-tenant unique `posting_idempotency` ledger + a terminal `succeeded` state make a retried posting command a safe no-op, and validation raises `duplicate_posting` for an already-posted draft. (5) **No autopost** — there is no route, permission or code path by which AI or automation can approve or post; posting-related permissions are privileged and the whole posting push is deferred to m23/m33.

**Consequence:** the five posting controls are impossible to bypass at the database, so no unapproved, closed-period, duplicate, self-approved or automated posting can ever be persisted. Rejected: enforcing any of these controls only in application code; a request that could become postable without an approval reference, in a shut period, or with the approver equal to the requester; a second successful posting for one draft; an AI/automation posting path.

## ADR-096 — Posting requests and results are prepared and recorded but never pushed: posting to core systems is POST-MVP, deferred behind m23/m33 (Stage 3)
**Status:** **ACCEPTED** — 2026-08-03. Module `m21-journal`, branch as ADR-091.

**Decision:** the MVP is **draft-first**: m21 **prepares** an approval-gated `posting_request` and **records** `posting_result` evidence, but it **never pushes** an entry to a core banking / accounting / ERP system — that integration is **m23/m33 and POST-MVP**. The posting request/result tables, their state machines and the `posting_request.lifecycle` family exist so the downstream contract is expressible and the controls (ADR-095) are testable, but no external connector is invoked. Honouring the "never claim untested integrations are production-ready" prohibition, the external-posting capability ships as **Framework Only** until proven against real systems with confirmed posting contracts; a `posting_result` in the MVP is human/operator-recorded evidence, not the output of a live push.

**Consequence:** the journal engine is complete and useful (recommend -> balanced draft -> validate -> submit for approval) without any unproven external integration masquerading as production-ready; posting can be switched on later behind m23/m33 without reshaping m21. Rejected: pushing to an external system in the MVP; marking the posting connector production-ready before it is proven; recording a posting success with no governed result evidence; deleting the posting tables until posting lands (the controls + contract are needed now).

## ADR-097 — M22 is the single approval choke point; maker-checker + SoD is enforced in three layers (Stage 3)
**Status:** **ACCEPTED** — 2026-08-04. Module `m22-approval`, branch `governance/approve-m22-approval`.

**Decision:** every controlled finance action (e.g. posting an m21 journal) passes through **one** aggregate,
`approval_request`, with an explicit state machine (`draft → pending → approved | rejected | returned`, plus
`escalated` and terminal `cancelled`). There is **no direct status mutation**: every transition goes through a service
that consults the lifecycle machine, appends history, and CAS-guards the write (optimistic concurrency / stale-version
rejection). **Maker-checker + Segregation of Duties** is enforced in **three** layers — (1) a PURE engine (`engine.ts`)
that fails **closed**, (2) `DecisionService`, which records an `approval_sod_check` and audits `APPROVAL_SOD_BLOCKED`
on a block (never silent), and (3) DB CHECKs (`final_approver <> requested_by`; an `approve`/`override_approve` actor
`<> maker`; `delegate <> delegator`). A request becomes `approved` only when the distinct-approver quorum is met **and**
a final approver — provably not the maker — is named.

**Consequence:** one identity can never both make and check a controlled action, and a refused controlled action is
always auditable. Rejected: enforcing SoD only in application code; letting a request reach `approved` below quorum or
with a self-approval; a second mutation path that bypasses the choke point.

## ADR-098 — M22 reuses m06 (workflow + SLA + timers) and m08 (notifications) by opaque reference; escalation is single-fire and depth-bounded (Stage 3)
**Status:** **ACCEPTED** — 2026-08-04. Module `m22-approval`, branch as ADR-097.

**Decision:** m22 builds **no** second workflow, timer or notification engine. It records an m06 workflow instance
(`approval_workflow_link`), registers m06 SLA timers (`approval_timer`) and dispatches m08 notifications
(`approval_notification`) as **opaque references** only, and publishes `approval.lifecycle` through the **one** m06
outbox (it owns none). Escalation is **deterministic** (a `Clock` port, no ambient `Date.now`), **single-fire** per
`(request, step, to_level)` — enforced by `UNIQUE NULLS NOT DISTINCT`, load-bearing because a request-level escalation
has `step_id IS NULL` and a plain UNIQUE lets NULLs through — and **depth-bounded** by a CHECK, in either notify-only or
reassignment mode.

**Consequence:** the platform keeps exactly one authoritative implementation of each shared service; escalation cannot
double-fire or run away. Rejected: a per-module outbox/timer/notification engine; a standard UNIQUE for single-fire
(NULL step ids would silently permit duplicates); unbounded escalation.

## ADR-099 — The 24-table design: append-only decision/SoD/participant ledgers, and an outcome that releases the approval reference (Stage 3)
**Status:** **ACCEPTED** — 2026-08-04. Module `m22-approval`, branch as ADR-097.

**Decision:** m22 owns 24 FORCE-RLS tables — 6 mutable aggregates (policy, config, reason-code, request, request-step,
delegation) and 18 append-only ledgers (all `*_history`, `approval_decision`, `approval_sod_check`,
`approval_participant`, `approval_assignment`, `approval_escalation`, `approval_timer`, `approval_notification`,
`approval_workflow_link`, `approval_idempotency`, `approval_note`, `approval_evidence`, `approval_outcome`,
`approval_override`). The application role has **no DELETE** anywhere; ledgers are INSERT+SELECT only. `approval_outcome`
records the terminal result and, for an approval, the **released approval reference** downstream modules (m21/m23) gate
posting on — one outcome per request, and a released outcome must be an approval naming its final approver.

**Consequence:** the decision trail, SoD evaluations and participant roles are immutable evidence; the downstream
posting contract is expressible without m22 posting anything. Rejected: mutable decision rows; deriving the approval
reference implicitly; releasing an outcome without a named approver.

## ADR-100 — M22 never approves on behalf of a human and never posts; m23 is downstream, not a prerequisite (Stage 3)
**Status:** **ACCEPTED** — 2026-08-04. Module `m22-approval`, branch as ADR-097.

**Decision:** m22 assists, records and **enforces**; a **human** decides. It never approves, posts, files or reaches a
conclusion on behalf of a person, and never pushes to a ledger/ERP/core system — m21/m23 post, gated on the approval
reference m22 releases. The `subject_ref` is an **opaque** id owned by another module; m22 never reads that module's
tables. m23 (finance integration) **consumes** m22 and is therefore **downstream**, not a build prerequisite.

**Consequence:** the maker-checker guarantee holds end to end, and m22 can ship and be certified before m23 exists.
Rejected: an AI/automation approval or posting path; treating m23 as a dependency of m22; m22 reading m21/m19 tables
instead of using opaque references.

## ADR-101 — M23 is a FRAMEWORK-ONLY / POST-MVP finance-integration foundation: dispatch never calls out; no API/permission/event surface; no second engine (Stage 3)
**Status:** **ACCEPTED** — 2026-08-04. Module `m23-finance-integration`, branch `feature/stage-3-m23-finance-integration`.

**Decision:** M23 records the **governed integration execution** of already-approved posting intents (opaque m21 posting-request + m22 approval references) against a configured external **destination**, with a Framework-Only lifecycle (`prepared → ready → dispatched → acknowledged | failed → retryable → exhausted | cancelled`), **bounded** retry, append-only attempt/history evidence, external-reference mappings and an idempotency ledger. Because **no production connector exists**, **dispatch NEVER calls out** — the only shipped `DispatchPort` adapter, `FrameworkOnlyDispatch`, records intent and returns a Framework-Only marker (honouring ADR-096 and "never claim untested integrations are production-ready"). Repository truth (naming-map) is authoritative and **preserved**: M23 has **NO API prefix, NO permission namespace and NO event family**, it publishes **no events**, and it owns **NO second outbox / workflow / timer / notification engine** (it reaches m19–m22/m33 by opaque reference only, reads none of their tables). Audit uses the **`FIN_` prefix** (`FIN_INTEGRATION_` codes; shared with m19 per ADR-079, non-colliding). The module-registry `reference_tables` was a **3-table placeholder** (M23 was never spec'd); the actual Framework-Only foundation is **8 tables** — recorded here and synchronised in module-registry/manifest. The dependency **m33** (Integration Foundation, phase 6) is unbuilt; a real connector, the RBAC-gated `/api/v1/…` surface and any event family are **deferred** behind the `DispatchPort` (and would be introduced later via an ADR closing the naming GAP, as m19 did with ADR-079) until proven against a real system.

**Consequence:** the finance-integration contract and its governance controls are expressible, testable and certifiable now, without any unproven connector, exposed surface, or duplicated platform engine. Rejected: an external call in the MVP; a `/api/v1/finance-integrations` + `finance_integration.*` + `FININT_` surface the repository never reserved; a second outbox/workflow engine; treating the unbuilt m33 as a hard blocker to the Framework-Only foundation; marking any connector production-ready.

## ADR-102 — M23 stores secret REFERENCES only (zero credential columns) and performs no monetary transformation (Stage 3)
**Status:** **ACCEPTED** — 2026-08-04. Module `m23-finance-integration`, branch as ADR-101.

**Decision:** a destination holds a **secret reference** — an opaque `secretref:` pointer into the platform secret store — and **never** a credential/secret value. This is enforced three ways: the pure engine (`assertSecretReference`), a DB **format CHECK** (`secret_reference ~ '^secretref:…'`), and a governance test asserting there is **ZERO** column named `secret`/`credential`/`token`/`password`/`passphrase`/`api_key` (only the `secret_reference` pointer). Money is carried as **opaque `bigint` minor-unit evidence** and is **never transformed** — M23 performs no arithmetic on amounts and has no float column (ADR-007). There is no endpoint/URL column and no network surface, so there is no SSRF vector in the MVP.

**Consequence:** a credential can never be persisted in M23, a secret can never leak through a value column, an amount can never be silently altered in transit, and the module has no request-forgery surface. Rejected: an inline secret/credential column; storing a raw endpoint to call; any monetary computation or float amount; a bytea/oid secret blob.

## ADR-103 — M04 admin console is ORCHESTRATION ONLY: no mirror tables, delegated authority, no event family (Stage 1)
**Status:** **ACCEPTED** — 2026-08-04. Module `m04-admin`, branch `feature/stage-1-m04-admin-console`.

**Decision:** M04 is a tenant + platform administration surface OVER the existing platform services (m01 tenancy, m02 identity/auth/RBAC, m03 audit, m06 workflow, m07 rules, m08 notifications). It **owns only its own admin state** — four FORCE-RLS tables: `admin_saved_view` (a per-admin filter), `admin_preference` (per-admin key/value), `admin_operation_request` (a governed admin-operation aggregate; idempotency-keyed; opaque target refs) and append-only `admin_operation_history`. It **mirrors NO core table** (tenants/identities/accounts/roles/assignments/SoD/audit-events/workflow/rules/notifications exist once, owned by their modules) and reads/writes NO other module's tables — it **calls those modules' PUBLIC services** through their contracts. **Delegated authority:** an admin identity must hold BOTH the `admin.*` permission AND the delegated module permission; each orchestrated service enforces its OWN permission, transaction and audit, so there is **no universal admin bypass** and no authorization/validation/workflow/audit is skipped. M04 records an admin-facing operation trail and audits its own sensitive reads; the authoritative state change + audit remain the owning module's. Repository truth (naming-map) is preserved: **NO event family** (`event_families: []`), M04 publishes no events and owns no outbox; delegated operations reuse the owning modules' existing events. `module-registry.reference_tables` was a 0 placeholder — the actual owned set is 4 tables (synchronised).

**Consequence:** the admin console gives tenant + platform operators a governed surface without duplicating a single engine or table, without a second event/outbox path, and without a bypass — every controlled admin action remains authorized + audited by the module that owns the state. Rejected: mirroring tenants/roles/audit into admin tables; a vague `admin.admin` bypass; a new `admin.lifecycle` event family / second outbox; M04 writing another module's tables or skipping their authorization/audit.

## ADR-104 — M04 platform-vs-tenant boundary + privacy: three-way permission split, no self-grant, redaction (Stage 1)
**Status:** **ACCEPTED** — 2026-08-04. Module `m04-admin`, branch as ADR-103.

**Decision:** the `admin.*` catalogue is **three-segment** and split three ways — TENANT-scoped admin (acts within the caller's own tenant), PLATFORM admin (`admin.platform_audit.read`, `admin.platform.administer` — cross-tenant/control-plane, always privileged), and a PRIVILEGED subset (controlled mutations + sensitive reads). A **tenant admin can never** hold a platform permission by default, become/act-as a platform admin, access another tenant (RLS + the m01 gate), assign a platform role, grant a permission outside their delegated authority (anti-escalation is bounded by the caller's OWN resolved permissions, never client input), modify an immutable system role, change mandatory global SoD, or query the platform audit — each of these is enforced by the OWNING module and honoured unchanged. `SystemContext` is not a universal allow; **headers cannot self-grant** (permissions come from persistent RBAC); **default deny** everywhere. **Privacy:** audit/event/dashboard payloads carry safe identifiers, states, reason codes and timestamps ONLY — never passwords, tokens, secret references, raw contact data, confidential narratives, full audit-payload copies or document content; sensitive reads (audit search, platform audit access, export, integrity) require dedicated privileged permissions and are audited; dashboards return bounded aggregates confined by RLS to the caller's tenant (no cross-tenant inference).

**Consequence:** the platform-vs-tenant boundary is explicit and testable, privilege can only flow downward within delegated authority, and no sensitive datum leaks through the admin surface. Rejected: a tenant admin escalating to platform scope; a client granting itself permissions via a header; a permission grant beyond the grantor's own; an unbounded dashboard; a raw secret/contact/narrative in an admin payload or audit entry.

## ADR-105 — M24 provider abstraction ships DETERMINISTIC test doubles only; production adapters, real DLP and network are prohibited-until-approved behind ports (Stage 5)
**Status:** **ACCEPTED** — 2026-08-05. Module `m24-ai-foundation`, branch `feature/stage-5-m24-ai-foundation`.

**Decision:** every AI capability is reached through a **port** — `AiProvider`, `PromptRenderer`, `DlpPolicyEvaluator`, `OutputValidator`, `CitationResolver`, `HumanReviewGateway`, `UsageMeter`, `CostCalculator`, `ProviderHealthPort` (model registry is the `ai_model` table). The MVP ships **only deterministic, offline doubles** (`DeterministicProvider`, `SafePromptRenderer`, `DeterministicDlp`, `DeterministicValidator`, `NoopCitationResolver`, `DefaultHumanReviewGateway`, `DefaultUsageMeter`, `DefaultCostCalculator`, `DeterministicProviderHealth`). A **production provider adapter is PROHIBITED** until repository governance explicitly approves it (approved-provider list + data-residency + quotas, per the Stage 5 `requires_review`): there are **no provider secrets** (a provider holds a `secretref:` pointer only — zero credential columns, DB CHECK enforced), **no direct network/HTTP/socket call**, and **no vendor lock-in** (nothing depends on a concrete provider). Real DLP is the shared security service **m41** (Stage 6, unbuilt); M24 integrates it later **behind `DlpPolicyEvaluator`** exactly as M23 deferred m33 behind its dispatch port — the deterministic DLP double blocks secret-looking restricted text in the meantime and the `ai_dlp_policy` CHECK keeps `block_restricted` permanently on.

**Consequence:** the governance pipeline (DLP → approved-provider routing → generate → validate → cite → human review) is exercised end-to-end on real PostgreSQL with **no network, no secret and no lock-in**, and a real model or a real DLP engine drops in behind a port without touching a call site. Rejected: shipping a live vendor adapter in the MVP; a credential/endpoint column; a direct outbound call; coupling the engine to one provider; blocking Stage 5 on the unbuilt m41.

## ADR-106 — M24 governed AI lifecycle: no-autonomous-action in three layers, DLP-before-routing, and DURABLE governance refusals; RAG/vector deferred (Stage 5)
**Status:** **ACCEPTED** — 2026-08-05. Module `m24-ai-foundation`, branch as ADR-105.

**Decision:** an AI output is a **RECOMMENDATION**, never a controlled action. **No autonomous action** is enforced in **three independent layers**: the pure engine (`evaluateApprovalGate` — a human reviewer + required citations, fails closed), the service (`ReviewService` requires a non-null human actor), and the **DB** (`ai_output_human_ck`: `status <> 'approved' OR reviewed_by IS NOT NULL`, plus `ai_output_cite_ck` for required citations). A request cannot route or generate before **DLP clears** (`ai_request_dlp_ck`), and **restricted/confidential** data can only proceed once bound to an **approved provider** for that classification (`ai_request_approved_ck` + `evaluateRouting`, fail closed). **Governance refusals are DURABLE:** a DLP block or an unapproved-provider routing refusal **commits** the request's `rejected` status + its DLP finding / audit / governance event **before** the `403` is raised — so the DLP gate and the routing/generation stage run as **separate transactions** and a blocked request is never silently rolled back (a security event never disappears; CLAUDE.md fail-closed). Confidence is an **integer basis-points** score (0..10000, never a float); cost is `bigint` minor units (ADR-007); large inputs/outputs/evidence are **m09 document references** (opaque ids, never inline), and audit/event payloads carry ids/states/reason codes/confidence/opaque refs only — never prompt/output content or secrets. M24 publishes `ai.request_lifecycle` / `ai.output_lifecycle` / `ai.governance_lifecycle` through the **one m06 outbox** and owns no second outbox. **RAG/vector retrieval is deferred** from the MVP (the capability line names it; the spec MVP is gateway + registries + governed summaries/classifications) — it lands in a later increment behind the same ports; the HTTP `/api/v1/ai` surface is likewise an incremental follow-up (as M04 deferred its controllers), the governed service + DB layer being authoritative now.

**Consequence:** AI assists and a human decides — provably, in the engine, the service and the database — and every governance refusal is auditable and durable. Rejected: an AI-approved or AI-posted output; a binary/float confidence; a route of restricted data to an unapproved provider; a DLP block that rolls back its own evidence; inline prompt/output content in a column, audit entry or event; a second outbox; blocking the MVP on RAG/vector or the HTTP surface.

## ADR-107 — M26 Legal AI is LEGAL-ADVISORY ONLY, behind privilege + ethical walls; it never files, concludes, settles or enforces (Stage 5)
**Status:** **ACCEPTED** — 2026-08-06. Module `m26-legal-ai`, branch `feature/stage-5-m26-legal-ai`.

**Decision:** M26 produces **human-reviewed, citation-backed SUGGESTIONS** for the legal domain (matters/cases from M14) — summaries, chronology, issue/obligation/deadline extraction, clause analysis, evidence-gap detection, drafting assistance. It is **advisory only**: it **never** files, reaches a legal conclusion, settles, enforces, creates a hearing/deadline/decision, or mutates a matter — **M14 remains the legal source of truth** and a human acts through M14's own controlled endpoints. **No autonomous action** is enforced in **three layers**: the pure `evaluateReviewGate` (a human reviewer + required citations, fails closed), the services (non-null human actor), and the DB (`legal_ai_analysis_human_ck`, `legal_ai_suggestion_human_ck`); an accepted citations-required analysis must carry a citation (`legal_ai_analysis_cite_ck`); config `require_human_review` can never be turned off and `auto_apply` never enabled. **Privilege + ethical walls:** every legal subject carries a `privilege_classification`; **privileged / work-product** material is reachable only by a caller holding **`ai.privileged.read`** (the pure `evaluateEthicalWall`, fail closed), and every privileged access is audited (`AI_LEGAL_PRIVILEGED_READ`). **Fact vs inference:** a finding is `extracted` or `inferred` **only** — an AI inference is **never** labelled a verified legal fact (`legal_ai_finding_factstatus_ck`); a human verifies via review. Analysis kinds and suggestion types are **explicit controlled vocabularies** (no free-form executable legal operation; no filing/settlement/enforcement type exists).

**Consequence:** AI assists a lawyer and a lawyer decides — provably, in the engine, the services and the database — inside privilege and ethical-wall boundaries, and no AI output is ever mistaken for a filed action, a settled matter or a verified fact. Rejected: an AI-filed/served/settled/enforced action; an AI-reached legal conclusion; a "verified" AI fact; privileged material reachable without the entitlement; a config that disables human review or enables auto-apply; a free-form executable legal operation type.

## ADR-108 — M26 consumes M24 (gateway), M14 (matter) and M09 (documents) BY CONTRACT via opaque references; citations are document pointers, never content (Stage 5)
**Status:** **ACCEPTED** — 2026-08-06. Module `m26-legal-ai`, branch as ADR-107.

**Decision:** M26 owns **11 tables** (`legal_ai_config/subject/analysis/analysis_history/finding/citation/suggestion/suggestion_history/review/evidence/idempotency`) and **no** AI capability of its own. It consumes the **M24** governed AI pipeline through an **`AiGatewayPort`** (`M24AiGateway` wraps M24's `RequestService`/`ReviewService`), so provider selection, DLP, approved-provider routing, confidence, citations, usage/cost and the M24 human-review CHECK all live in **M24** — M26 never selects providers, never touches provider credentials, never bypasses DLP and never writes M24's private tables; it holds only **opaque** M24 request/output ids, a duplicate handoff is prevented by an idempotency ledger, and a blocked/rejected M24 request leaves the analysis durably `failed`. It references **M14** matters and **M09** documents by **opaque uuid** only (reads no m14/m09 table); a **citation** preserves an M09 document **reference** + version/hash + bounded location (page/section/paragraph) + evidence classification + confidence + retrieved timestamp — **never document content** ("no duplicate document content"; M09 stays the document source of truth). It shares the **`ai.*`** permission namespace (6 new `ai.legal.*` / `ai.privileged.*` codes, 4 privileged) and the **`AI_`** audit prefix (14 `AI_LEGAL_*` codes); it publishes **no** domain events and owns **no** second outbox (naming-map `event_families: []`, `api_prefixes: []` — an internal governed library, no HTTP surface) — the AI request/output lifecycle is emitted by M24 through the one m06 outbox. Audit payloads carry safe ids, subject type, status, classification, confidence, reason codes, timestamps and opaque references **only** — never legal text, privileged narrative, raw prompt/output, document content, contacts, secrets or credentials.

**Consequence:** the legal-AI layer adds a governed matter-analysis + citation + human-review workflow on top of the existing platform without duplicating a single engine, table or outbox, without a second AI/provider/DLP path, and without persisting privileged content — a real model or real DLP drops in behind the M24 gateway unchanged. Rejected: a second AI/provider/DLP engine; a direct provider call or network egress; reading or writing m14/m09/m24 tables; a citation holding document content; a new event family or a second outbox; an HTTP surface not assigned by the naming-map; legal text or privileged narrative in an audit entry or event.

## ADR-109 — M27 Finance AI NEVER auto-posts, auto-matches or approves; every suggestion is human-decided and explainable (Stage 5)
**Status:** **ACCEPTED** — 2026-08-06. Module `m27-finance-ai`, branch `feature/stage-5-m27-finance-ai`.

**Decision:** M27 produces **human-reviewed, EXPLAINABLE SUGGESTIONS** for reconciliation and finance (bank recon from M15/M15a, GL recon from M20): match suggestions, exception classification, anomaly detection, risk flagging and journal-recommendation drafting. It is **advisory only** and honours the CLAUDE.md **no-autopost** hard rule: it **never** auto-posts, auto-matches, auto-reconciles, closes an exception, creates/approves a journal, mutates a GL balance or performs a payment — a human decides and the **owning finance module (M15/M21)** executes; suggestions feed **draft journals + human approval only**. **No autonomous action** is enforced in **three layers**: the pure `evaluateReviewGate` (a human reviewer, fails closed), the services (non-null human actor), and the DB (`finance_ai_analysis_human_ck`, `finance_ai_suggestion_human_ck`). Config `require_human_review` can never be turned off and — the load-bearing guard — `auto_post` and `auto_match` can **never** be enabled (`finance_ai_config_autopost_ck`, `finance_ai_config_automatch_ck`). **Explainable matches:** an accepted, explainability-required suggestion must carry at least one matched **feature** (`finance_ai_suggestion_explain_ck`) — an unexplained match can never be accepted; every suggestion preserves type, reason codes, matched features, confidence (basis points), evidence, matching-method reference and human-review state. A suggestion/classification is **never** a confirmed accounting fact (analysis kinds and suggestion types are explicit controlled vocabularies; there is no filing/posting/approval type). An ACCEPT is refused unless M24 approved the underlying AI output.

**Consequence:** finance AI proposes and a human disposes — provably, in the engine, the services and the database — and no AI output can post a journal, close a reconciliation, alter a balance or be accepted as an unexplained match. Rejected: an AI-posted/approved journal; an AI auto-match or auto-reconcile; a config enabling auto-post/auto-match; accepting an unexplained match; a "confirmed" AI accounting fact; a controlled finance operation type in the suggestion/analysis vocabulary.

## ADR-110 — M27 consumes M24 (gateway), M15/M15a and M20 BY CONTRACT via opaque references; money is bigint minor units; M15/M20 stay the source of truth (Stage 5)
**Status:** **ACCEPTED** — 2026-08-06. Module `m27-finance-ai`, branch as ADR-109.

**Decision:** M27 owns **12 tables** (`finance_ai_config/subject/analysis/analysis_history/model_result/exception_classification/suggestion/suggestion_history/feature/evidence/review/idempotency`) and **no** AI capability of its own. It consumes the **M24** governed AI pipeline through an **`AiGatewayPort`** (`M24AiGateway` wraps M24's `RequestService`/`ReviewService`), so provider selection, DLP, approved-provider routing, confidence and usage/cost all live in **M24** — M27 never selects providers, never touches provider credentials, never bypasses DLP and never writes M24's private tables; it holds only **opaque** M24 request/output ids, a duplicate handoff is prevented by an idempotency ledger, and a blocked/rejected M24 request leaves the analysis durably `failed`. It references **M15/M15a** reconciliation runs/lines/exceptions and **M20** GL runs/lines by **opaque uuid** only (reads no m15/m20 table): **matching stays owned by M15a and GL reconciliation by M20** — M27 may suggest candidates and explain them but cannot create a final match, close an exception, certify a balance or create a final journal; **M15/M20 remain the source of truth**. **Money is bigint MINOR UNITS** (`amount_minor`, projected `::text`, never a float — ADR-007); no monetary value is transformed and no balance is mutated; there is no `real`/`double precision` column. It shares the **`ai.*`** permission namespace (5 new `ai.finance.*` codes, 3 privileged) and the **`AI_`** audit prefix (13 `AI_FINANCE_*` codes); it publishes **no** domain events and owns **no** second outbox (naming-map `event_families: []`, `api_prefixes: []` — an internal governed library, no HTTP surface) — the AI request/output lifecycle is emitted by M24 through the one m06 outbox. Audit payloads carry safe ids, subject type, status, suggestion type, reason codes, confidence, timestamps and opaque references **only** — never bank-statement text, raw ledger content, prompt/output, document content, secrets or credentials.

**Consequence:** the finance-AI layer adds a governed recon-suggestion + explainable-matching + human-review workflow on top of the existing reconciliation stack without duplicating a single engine, table or outbox, without a second AI/provider/DLP path, without owning matching or GL reconciliation, and without ever mutating money — a real model or real DLP drops in behind the M24 gateway unchanged. Rejected: a second AI/provider/DLP or matching/GL-recon engine; a direct provider call or network egress; reading or writing m15/m20/m24 tables; a float money column or any balance mutation; a new event family or a second outbox; an HTTP surface not assigned by the naming-map; bank/ledger content in an audit entry or event.
