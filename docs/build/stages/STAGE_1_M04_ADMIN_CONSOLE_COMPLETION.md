# Stage 1 — M04 Admin Console — Completion (Orchestration Only)

**Module:** `m04-admin` · **Branch:** `feature/stage-1-m04-admin-console` · **Date:** 2026-08-04
**Capability:** Admin console — tenant + platform administration over the platform services

## What shipped

An **orchestration-only** admin console. It owns only its console state and calls the public services of m01/m02/m03/
m06/m07/m08 through their contracts — no mirror tables, no event family, no second outbox, no duplicate engine, no
admin bypass.

- **4 FORCE-RLS owned tables** (`admin_saved_view`, `admin_preference`, `admin_operation_request`,
  append-only `admin_operation_history`); composite keys/FKs; no DELETE grant. Migrations `0001_admin.sql`,
  `0002_grant_application_role.sql`.
- **30 `admin.*` permissions** (17 privileged, 2 platform), seeded + registered (three-segment; tenant vs platform vs
  privileged; no vague bypass).
- **29 `ADMIN_` audit codes**, registered (`registered_code_count` 643 → 672).
- **NO event family / NO outbox** (naming-map authoritative).
- **`AdminOperationService`** (owns console state) + **7 orchestration services** (`TenantAdminService`,
  `IdentityAdminService`, `AccessAdminService`, `AuditAdminService`, `WorkflowAdminService`, `RulesAdminService`,
  `NotificationAdminService`) — thin, authorized delegators to the owning modules' public services (delegated authority;
  no bypass).
- **HTTP API** under `/api/v1/admin`: the owned console (operations / saved-views / preferences / dashboard) +
  tenant administration (list / get / status-history / suspend / reactivate), wired via `AdminModule`.
- **ADR-103, ADR-104**; README.

## Repository-truth divergences (recorded)

- `module-registry.reference_tables` **0 → 4** (a placeholder; the actual owned set is 4 console tables; ADR-103).
- The naming-map's **empty event family** is preserved (M04 publishes no events).

## Behaviour proven

- **Tenant administration** — list/get/status-history + suspend/reactivate delegate to m01 `TenantService`, recorded in
  the M04 operation ledger.
- **Delegated authority / no bypass** — orchestration services require the `admin.*` permission BEFORE delegating; a
  caller lacking it is refused at M04 (proven in the services db-spec).
- **Idempotency / concurrency** — operation recording is idempotent per key; optimistic-concurrency (stale version)
  rejected.
- **Privacy / redaction** — no operation summary/narrative appears in any audit entry; dashboards return bounded
  aggregates; sensitive audit reads are M04-audited.
- **Platform vs tenant / default deny / no mirror tables** — governance db-spec proves the admin.* split, no mirror of
  any core table (tenants/roles/audit_events exist once), RLS FORCE + isolation, and a single outbox (m06).

## Verification

- Build clean · lint 0 errors · format clean · **smoke 28 suites / 5227 assertions / 0 failures** (m04 smoke 37,
  conformance 2901).
- **DB lane (PostgreSQL 15.2 throwaway, fresh DB):** **58 specs / 1853 assertions / 0 failures**, incl.
  **`m04-admin` db-spec (29)** and **`m04-services` db-spec (16)**.

## Known limitations

- **HTTP surface is incremental.** The owned console + tenant administration are wired under `/api/v1/admin`; the
  remaining orchestration areas (identity, RBAC, workflow, rules, notifications, audit) ship as **tested library
  services** in `@finapp/m04-admin` following the identical delegated pattern, and are exposed as the console grows.
  The service layer + governance/services DB specs cover the pattern; the additional controllers are a mechanical
  next increment.
- No M04 module spec pre-existed; the architecture is captured in ADR-103/104 + this completion report.
- Local HTTP RLS is exercised via `SET ROLE` to the non-owner role; PostgreSQL 16 CI is authoritative.

## Remaining manual action

Merge the M04 implementation PR, then run post-merge M04 certification.
