# Stage 1A — M01 Tenant Foundation — Completion Report

**2026-07-15** · Branch `feature/stage-1-saas-foundation` · M01 only. No other Stage 1 module was
implemented.

## Verdict: CONDITIONAL GO for the next Stage 1 component (m02-identity)

M01 is built, tested and verified end-to-end against a live database. Build, lint, format and the PURE
lane are green; the DB spec passes.

**The one condition is the one the prompt itself sets:** isolation has been proven against PostgreSQL
**15.2**, not 16. No PostgreSQL 16 exists on this machine (Docker daemon down; only 15.2 binaries are
installed). CI runs `postgres:16` on every pull request and asserts `server_version_num` is 16.x — that
run is the certification, and it has not happened for this branch yet. Per the prompt's own rule ("Do not
mark the stage complete if tenant isolation has not been proven against PostgreSQL 16"), **M01 is not
complete until CI is green.**

---

## 1. Repository

| | |
|---|---|
| Branch | `feature/stage-1-saas-foundation` |
| Base | `eb54903` (`stage-0-governed-complete`) |
| Commits | `f2c680b`, `75f3501`, `833bdf9`, `3a2fa13`, `e5ffbcb`, `a0de973` |
| Working tree | clean |

## 2. Deviations from the prompt — read this first

Six conflicts between the prompt and the repository's authoritative conventions. In each case the
repository won, because the kernel and the registries *enforce* their conventions at boot and in CI —
the prompt's literal names would not have run.

| # | Prompt | Repository | Resolution |
|---|---|---|---|
| 1 | `/api/v1/admin/tenants` | `naming-map.yaml`: `api_prefixes: [/api/v1/tenants]` | **`/api/v1/tenants`.** The kernel validates that a route's prefix belongs to the declaring module. |
| 2 | `tenant.view` (2 segments) | kernel `validateEndpointSpec` requires `<domain>.<entity>.<action>` | **`tenant.registry.view`.** `tenant.view` throws at class-definition time. Still inside the registered `tenant.*` namespace. |
| 3 | `TENANT_CREATED` (2 segments) | registry `format: <PREFIX>_<ENTITY>_<ACTION>` | **`TENANT_REGISTRY_CREATED`.** Pairs 1:1 with the permissions. |
| 4 | — | `naming-map` **GAP-1**: `tenant.lifecycle` declared in the manifest, absent from `event-registry.yaml` | **Registered.** Flag flipped to `event_family_registered: true`. |
| 5 | Read `docs/build/ENTERPRISE_BUILD_READINESS_REPORT.md`, `IMPLEMENTATION_MANIFEST.yaml`, `STAGE_0_ARCHITECTURE_FREEZE.md` | **None of the three exist** | Used the real authorities: `manifests/*.yaml`, `docs/01-architecture/`, `docs/07-engineering/`. |
| 6 | "Tenant A cannot infer another tenant through list or count" | ADR-001 / `SAAS_FOUNDATION` / `STAGE_1_PROMPT`: `tenants` and subsidiaries are global **non-FORCE** | **ADR-014**, approved by the product owner: `tenants` is RLS FORCE with an explicit system escape; org tables are tenant-scoped FORCE. Stricter than the docs. |

## 3. Stage 0 components reused (not duplicated)

Kernel `RequestContext` / `SystemContext` / `ProblemError` / `@Endpoint` / `Db` contract and its four DI
tokens; the contracts event union; the migration runner (dependency-ordered, checksummed, advisory-locked);
the PURE + DB test harness; the CI lanes; the `tenant_isolation` convention **verbatim**, `NULLIF(..., '')`
included.

## 4. Gaps in Stage 0 that M01 had to fill

Stage 0 declared four tokens but shipped one interface and bound nothing.

| Added | Where | Why there |
|---|---|---|
| `Audit`, `Authz`, `Outbox` contracts | `packages/kernel/src/` | A contract belongs with its token. m03/m02/m06 implement them; nobody re-declares them. |
| `PgDb` — the single `Db` implementation | `@finapp/kernel/pg` subpath | Lives with the contract it implements, so no module invents its own. The subpath keeps the kernel root dependency-free and strip-types loadable. |
| Envelope: `type`, `causationId`, `actor`, `classification` | `packages/contracts/` | The prompt requires all four. Correlation groups a request; causation orders a chain within it. |

## 5. Files created / modified

**Created (24)** — `packages/m01-tenant/` (2 migrations, 5 domain modules, 2 repositories, 2 services,
resolver, adapters, permissions, audit codes, events, index, 2 test suites, README);
`packages/kernel/src/{audit,authz,outbox,pg-db}.ts`; `packages/contracts/src/tenant-events.ts`;
`apps/api/src/tenant/{tenant.controller,tenant.module}.ts`; this report.

**Modified (12)** — kernel/contracts index + package.json; `contracts/src/{envelope,events}.ts`;
`contracts/test/contracts.smoke.ts` (0 → 1 families, deliberately); `tools/test-runner/src/db-harness.ts`
(added `asSystem`); `apps/api/src/{app.module,main}.ts` + tsconfig/package.json; root `tsconfig.json`;
`docs/01-architecture/ARCHITECTURE_DECISION_REGISTER.md` (ADR-014);
`manifests/{implementation,audit-code,permission,event,naming}` registries.

## 6. Migrations, tables, RLS

`0001_tenancy_control_plane.sql`, `0002_grant_application_role.sql`. Both applied cleanly; the ordered
plan and checksums verified via `migrate --dry-run`.

| Table | Scope | Policy |
|---|---|---|
| `tenant_type_catalogue` | Global reference registry | **No RLS** (ADR-001 exception). 10 types seeded. |
| `tenants` | Control plane | `tenant_isolation`: own row **OR** `app.system_context='on'` (ADR-014) |
| `tenant_status_history` | Tenant-scoped, append-only | `tenant_isolation`, **no escape** |
| `tenant_environments` | Tenant-scoped | `tenant_isolation`, no escape |
| `tenant_entities` | Tenant-scoped | `tenant_isolation`, no escape |
| `tenant_departments` | Tenant-scoped | `tenant_isolation`, no escape |
| `tenant_branches` | Tenant-scoped | `tenant_isolation`, no escape |

Enforced by the database, not by convention: composite `(tenant_id, id)` keys and composite FKs;
status/timestamp agreement checks; one default environment per tenant; **no DELETE privilege anywhere**
(ADR-010 soft delete becomes a guarantee); `tenant_status_history` is INSERT+SELECT only (ADR-005).

**No down-migrations** — the Stage 0 runner does not support them. Deferred.

## 7. APIs, permissions, audit codes, events

- **API** — `/api/v1/tenants`: create, list, get, patch, status-history, plus 11 lifecycle actions. Every
  mutating route carries `@Endpoint({ permission, auditCode })`. `expectedVersion` is mandatory on every
  mutation — optimistic concurrency only works if the client must state what it thinks it is changing.
- **19 permissions** under `tenant.*`. **Declared, not granted** — no role holds them until m02.
- **18 audit codes** under `TENANT_`, all registered.
- **17 event types** in `tenant.lifecycle`, payload v1.

## 8. Tests

| Suite | Result |
|---|---|
| PURE smoke — `m01-tenant` | **251 assertions** |
| PURE smoke — contracts / kernel / migrate | 21 / 35 / 26 |
| **Smoke lane total** | **4 suites, 333 assertions, 0 failures** |
| DB spec — `m01-tenant` | **46 assertions** |
| DB spec — `rls-convention` (Stage 0) | 26 assertions |
| **DB lane total** | **2 specs, 72 assertions, 0 failures** (PostgreSQL 15.2 — see §10) |

The DB spec proves isolation **through the non-owner application role**, and asserts the role model
itself: if the app role were ever superuser or `BYPASSRLS`, every other assertion in the file would be
worthless. It covers cross-tenant read/update/insert/delete refusal, `count(*)` non-inference, the
composite-FK cross-tenant refusal, **pooled-connection reuse**, the ADR-014 asymmetry, and append-only
history.

**API verified end-to-end against a live database**, not just compiled: 403 without permission; 409 on
duplicate code; 409 on an illegal transition with a stated reason; 409 on a stale `expectedVersion`; 409
when a required reason is missing; and a full `draft → under_review → approved → provisioning → approved
→ active → suspended` walk with all 7 history rows.

## 9. Build / lint / type-check / security

| Gate | Result |
|---|---|
| `npm run build` (tsc project refs) | ✅ clean |
| `npm run lint` (type-aware ESLint) | ✅ 0 errors (2 warnings: redundant runtime guards on total records) |
| `npm run format:check` | ✅ clean |
| Type-check | ✅ strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| Secrets | ✅ none added |

Security posture: deny-by-default authorization; refusals name the permission but never the resource
(a 403 that reveals existence is an enumeration oracle); unknown and unusable tenants return the **same**
refusal; audit `detail` records field *names*, never values, because the spine is append-only; UUIDs are
shape-checked before reaching SQL; every query is parameterised.

## 10. PostgreSQL version — the outstanding condition

**Proven on 15.2. Not yet certified on 16.**

Docker is not running and no PostgreSQL 16 exists locally, so the DB lane ran against a throwaway 15.2
instance (started from bundled binaries on a non-default port, torn down afterwards). RLS FORCE,
`tenant_isolation`, composite-FK and privilege semantics are identical across 15 and 16, so the proof is
real — but it is not the certification the platform targets, and I did not substitute it for one.

CI runs `postgres:16`, on pull requests as well as pushes, and asserts `server_version_num` is 16.x.
**That run is the gate.**

## 11. Known limitations — M01 is not shippable alone

1. **No authentication.** The API reads actor and permissions from `x-actor-id` / `x-permissions`
   headers. Anyone who can reach it can claim any actor and any permission. The authorization checks are
   real; their *input* is not trustworthy. **Do not expose this API outside a trusted network.**
   m02-identity replaces it.
2. **Audit is not persisted.** `RecordingAudit` collects intent in memory and ignores the `tx`. A
   rollback discards the change and keeps the record — evidence of an attempt, not of a fact. m03 owns
   the spine.
3. **Events are not delivered.** `RecordingOutbox` collects in memory. Nothing drains them; no consumer
   would ever see them. **No second outbox table was created** (ADR-004) — m06 owns the only one. The
   contract boundary is real, so the swap changes no call site.
4. **Tenant entitlement is unchecked.** The resolver proves the claimed tenant is real and usable, not
   that *this caller* is entitled to it. That needs an authenticated actor (m02).
5. **No down-migrations** (runner limitation).
6. **Provisioning is state only** — no infrastructure is provisioned, per §3.3.
7. The platform-wide conformance tool does not exist; M01 enforces registry conformance for M01 in its
   own smoke suite.

## 12. Deferred

Authentication/MFA/users/roles (m02) · audit spine (m03) · outbox runtime + idempotency store (m06) ·
billing/plans/subscriptions/metering (m39) · white-labelling and custom domains · infrastructure
provisioning · tenant self-registration · down-migrations · platform conformance tool.

## 13. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **PostgreSQL 16 CI has not run for this branch** | **Medium–High** | Open the PR. Isolation is proven on 15.2 only. This is the stage gate. |
| R2 | A stand-in adapter survives its owning module | **High** | Marked in `adapters.ts`, the README, the manifest and here. m02/m03/m06 must delete them — a surviving stand-in is a duplicate shared service. |
| R3 | M01 exposed before m02 | **High** | No authentication (§11.1). Not for any network a stranger can reach. |
| R4 | The API is deployed connecting as owner or superuser | **High** | Both bypass/are exempt from RLS. `DATABASE_APP_ROLE` must be a non-owner NOBYPASSRLS role; the DB spec asserts the role model. |
| R5 | The compromised PAT is still not confirmed revoked | **High** | Unchanged across four reports. Independent of M01. |
| R6 | `main` is unprotected | Medium | Both required checks are selectable now. |
| R7 | ADR-014's escape is over-used | Medium | `withSystem` requires a reason and sees nothing in tenant-scoped tables. Watch for it spreading in review. |

## 14. Recommendation

### CONDITIONAL GO for m02-identity

M01 satisfies its definition of done with one exception, and that exception is the stage gate:

✅ Registry, lifecycle, environments, entities, departments, branches · tenant context authoritative ·
client-supplied ids not trusted · cross-tenant reads/writes fail · missing context fails safely ·
pooled-connection isolation proven · APIs validate permissions · transitions server-enforced · status
history preserved · audit intent produced · events typed and versioned · tests pass · docs and manifest
updated · **no other Stage 1 module implemented**

❌ **Isolation is proven on PostgreSQL 15.2, not 16.**

| # | Condition | Owner | Required by |
|---|---|---|---|
| C1 | **`postgres:16` DB lane green for this branch** | Engineer | **Before M01 is called complete and before m02 begins in earnest** |
| C2 | Revoke the compromised PAT | Repository owner | Immediately |
| C3 | Enable branch protection on `main` | Repository admin | Before Stage 1 merges |
| C4 | m02 must DELETE `ContextAuthz` and bind the real `AUTHZ` | Engineer | With m02 |

Open the PR to trigger C1:
`https://github.com/aptic-credit-dev/finapp-dynamics/compare/main...feature/stage-1-saas-foundation?expand=1`

**Do not merge M01 to `main` until C1 passes.** Stage 1 creates the first real tenant tables; the RLS
convention is the only thing keeping tenants apart, and it has never run on the targeted version.
