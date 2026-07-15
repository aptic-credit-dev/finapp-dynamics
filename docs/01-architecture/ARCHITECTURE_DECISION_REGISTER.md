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
