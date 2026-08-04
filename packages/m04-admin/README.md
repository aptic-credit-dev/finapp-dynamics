# m04-admin — Admin Console (Orchestration Only)

A tenant + platform **administration surface** over the existing platform services (m01 tenancy, m02 identity/auth/RBAC,
m03 audit, m06 workflow, m07 rules, m08 notifications). It **owns no business data** — it calls those modules' **public
services** through their contracts (never their private tables) and records only its own admin state. **No event family,
no second outbox, no duplicate engine, no vague admin bypass.**

|                  |                                                          |
| ---------------- | -------------------------------------------------------- |
| Module code      | `m04-admin`                                              |
| Build stage      | 1 (SaaS foundation) — last module                        |
| MVP              | true                                                     |
| API prefix       | `/api/v1/admin`                                          |
| Permissions      | `admin.*` (30; 17 privileged; 2 platform)               |
| Audit prefix     | `ADMIN_` (29 codes)                                     |
| Event family     | **none** (reuses the owning modules' events)            |
| Tables           | 4 FORCE-RLS (1 append-only); no mirror tables; no DELETE |
| ADRs             | ADR-103, ADR-104                                        |

## What it owns (4 tables — no mirrors)

- `admin_saved_view` — a per-admin saved filter for a console area.
- `admin_preference` — a per-admin key/value UI preference.
- `admin_operation_request` — a governed admin-operation aggregate (its EFFECT is delegated to another module; opaque
  target ref; idempotency-keyed; lifecycle `requested → executing → completed | failed`, or `→ cancelled`).
- `admin_operation_history` — append-only operation lifecycle evidence.

It mirrors **no** core table — tenants/identities/accounts/roles/assignments/SoD/audit-events/workflow/rules/
notifications exist once, owned by their modules.

## Delegated authority (no bypass)

An admin identity must hold **both** the `admin.*` permission **and** the delegated module permission. Each M04
orchestration service requires its `admin.*` permission, then calls the owning module's public service — which enforces
**its own** permission, transaction and audit. Immutable-system-role refusal, platform-role refusal, SoD, anti-escalation
(bounded by the caller's own resolved permissions) and optimistic concurrency all live in the owning module and are
honoured unchanged.

## Platform vs tenant (the boundary it certifies)

The `admin.*` catalogue is split: **tenant-scoped** admin, **platform** admin (`admin.platform_audit.read`,
`admin.platform.administer` — always privileged), and a **privileged** subset. A tenant admin can never hold a platform
permission by default, cross tenants (RLS + m01 gate), assign platform roles, grant beyond delegated authority, modify
immutable system roles, or query platform audit. `SystemContext` is not a universal allow; headers cannot self-grant;
default deny everywhere.

## Privacy

Audit/event/dashboard payloads carry safe identifiers, states, reason codes and timestamps only — never passwords,
tokens, secret references, contacts, confidential narratives, full audit-payload copies or document content. Sensitive
reads (audit search, platform audit access, export, integrity verify) require dedicated privileged permissions and are
audited. Dashboards return bounded aggregates confined by RLS to the caller's tenant.

## Services

`AdminOperationService` (owns the console tables) + seven thin, authorized orchestration delegators: `TenantAdminService`,
`IdentityAdminService`, `AccessAdminService` (RBAC + SoD), `AuditAdminService`, `WorkflowAdminService`,
`RulesAdminService`, `NotificationAdminService`.

## Tests

`test/m04-admin.smoke.ts` (PURE: permission classification, platform-vs-tenant scope, operation lifecycle, bounded
pagination, reason/audit codes, no-event-family); `test/m04-admin.db-spec.ts` (governance: RLS, no-DELETE, append-only,
admin.* catalogue, lifecycle/idempotency CHECKs, **no mirror tables**, composite FKs, single outbox);
`test/m04-services.db-spec.ts` (owned service end-to-end + the orchestration delegated-authority gate + default deny +
data minimisation + cross-tenant RLS).
