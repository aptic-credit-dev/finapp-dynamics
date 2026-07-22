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
