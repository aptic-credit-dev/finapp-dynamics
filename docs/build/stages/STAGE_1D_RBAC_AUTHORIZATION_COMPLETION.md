# Stage 1D — RBAC & Authorization (m02-rbac) — Completion Report

## STATUS: IMPLEMENTED ON FEATURE BRANCH — smoke + DB green locally — NOT yet CI-certified, NOT merged (2026-07-19)

This report is deliberately honest about what has and has not happened. The code is complete and both
local lanes are green. It has **not** run in CI, and it is **not** merged. It must not be marked certified,
and Stage 2 must not begin, until the PR's required lanes (Smoke, and DB against PostgreSQL 16) pass green
with no skips and the branch merges.

---

## 1. Certified starting baseline SHA

`004b2fd57f3caa15dad6c47c34dbd8a13093cbc2` — the certified Stage 1C merge (PR #6) on `main`. The branch was
cut from this and has **not** been rebased onto anything uncertified.

## 2. Branch

`feature/stage-1d-rbac-authorization`. Small, reviewable Conventional Commits. No force-push. Not merged.

## 3. Architecture acceptance

ADR-017 (Persistent RBAC Model), ADR-018 (Authorization Scope Model), ADR-019 (Segregation of Duties) and
ADR-020 (Administrator Bootstrap) were flipped PROPOSED → ACCEPTED (2026-07-19) in a separate commit
(`docs(architecture): accept stage 1d rbac decisions`). The Stage 1D readiness verdict was flipped
CONDITIONAL GO → GO. The six open decisions were resolved as:

- **D1** — organizational scope only where M01 node ids exist (entity / branch / department); no ABAC.
- **D2** — the canonical API prefix is `/api/v1/rbac` (one prefix; resources in the path).
- **D3** — `rbac.*` permissions and `RBAC_` audit codes are owned by `m02-rbac` (moved off `m02-identity`).
- **D4** — audit via the existing kernel port (in-memory stand-in until m03); no second audit path.
- **D5** — no authorization cache; permissions are resolved fresh per request (immediate revocation).
- **D6** — break-glass / emergency access is deferred (not in the MVP surface).

## 4. Scope implemented (Parts A–N)

- **Registries & contracts** — `rbac.*` permission namespace (13 codes), `RBAC_` audit prefix (13 codes,
  `registered_code_count` 50 → 63), the `identity.authorization` event family (12 types), and the m02-rbac
  entry in the naming map.
- **Persistence** — one migration (`0001_rbac.sql`): `permissions` (global reference, seeded from the
  registry), `roles` / `role_permissions` / `sod_rules` (mixed platform/tenant scope, system rows
  immutable), `role_assignments` (tenant-scoped, no escape), `platform_role_assignments` (control plane,
  system escape), and the two append-only status histories (mixed scope). A second migration grants the
  application role exactly the verbs it needs — **no DELETE** on roles or assignments (retire / revoke by
  status, never drop).
- **Domain** — the role and assignment state machines, effective-permission and scope-containment rules,
  all fail-closed.
- **Services** — `RoleService`, `AssignmentService` (grant validates a live role, a live membership, org
  scope, anti-escalation and SoD), `SodService`, `CatalogueService`, `PermissionResolver`, `RbacAuthz`
  (the persistent AUTHZ adapter), the `RbacEmitter`, and `BootstrapService`.
- **Authorization wiring** — `AUTHZ` is bound to `RbacAuthz`; the actor boundary fills
  `RequestContext.permissions` from the resolver, fresh per request.
- **x-permissions & ContextAuthz retired** — the header is deleted from all live source and `ContextAuthz`
  is deleted from `m01-tenant`. Conformance asserts **zero** live use of both.
- **Bootstrap** — the first-administrator grant runs once at boot (ADR-020), fails closed in production.
- **RBAC admin API** — `/api/v1/rbac`: roles (lifecycle + concrete permissions), assignments (grant /
  revoke / suspend / reactivate), SoD rules, and the permission catalogue.

## 5. Security controls enforced (and where)

| Control | Enforcement |
|---|---|
| Default deny; unknown permission is false | `RbacAuthz.can` set-check |
| No client permission injection | `x-permissions` deleted; conformance asserts zero live use |
| No self-escalation | grantor may only confer permissions it holds (`RoleService.changePermissions`, `AssignmentService.grant`) |
| No cross-tenant assignment | `role_assignments` tenant-scoped, RLS no escape (proven in the DB spec) |
| System roles immutable | `is_immutable` DB guard + service conflict |
| No assignment to a non-active role | `AssignmentService.grant` checks `role.status = 'active'` |
| SoD at grant time | `SodService.firstConflict` → 409, fail closed |
| Immediate revocation | no cache; resolver reads live rows per request (proven in the DB spec) |
| System context is not a universal allow | `withSystem` relaxes rows, never actions; `RbacAuthz` reads carried permissions only |
| Bootstrap cannot be reused arbitrarily | idempotent on one configured account; not reachable from any API route |
| Production fails closed | bootstrap throws without a valid `FINAPP_BOOTSTRAP_ADMIN_ACCOUNT` |
| No physical DELETE of roles/assignments | grant migration withholds DELETE |

## 6. A real bug, found and fixed

The role and assignment status histories were first written as global system-escape tables, but a tenant
role's lifecycle and a tenant assignment's grant/revoke run in **tenant** context, and the history must be
written in the same transaction. The m02-rbac DB spec caught the resulting RLS violation. Fixed at the
source (the migration has not shipped): both histories are now tenant-scoped with a mixed policy — a tenant
transition writes under tenant context, a platform one under the system escape with `tenant_id` NULL.

## 7. Test evidence (local)

- **Smoke lane:** 9 suites, **1166 assertions**, 0 failures. Includes the new `m02-rbac` pure suite (state
  machines, scope algebra, vocabularies, the default-deny authorizer).
- **DB lane (PostgreSQL 15.2 throwaway):** 9 specs, **332 assertions**, 0 failures. Includes the new
  `m02-rbac` DB spec (resolution, tenant isolation, immediate revocation, service enforcement, SoD,
  immutability) and the `api-rbac` HTTP spec (lifecycle, assignment, catalogue, 403 for the unprivileged,
  409 for SoD). The `api-auth` and `api-identity` specs were reworked to authorize through **real** role
  grants instead of the deleted header, and pass.
- **Lint:** 0 errors (6 pre-existing style warnings, matching the sibling modules).

CI has **not** run. The DB lane was verified locally on PostgreSQL 15.2; the required CI lane runs against
PostgreSQL 16.

## 8. Known limitations (honest)

- **SoD administration is platform-scoped**, gated by the privileged `rbac.sod.*` permissions; tenant
  self-service of SoD rules is not modelled. Global mandatory rules are migration-seeded.
- **Scope containment is exact-node** for org scopes — the branch → department tree is not walked (that is
  M01 data; a future refinement). Platform and tenant-wide scopes behave fully.
- **No authorization cache** (D5) — correct for immediate revocation, at the cost of a per-request resolve.
- **Break-glass / emergency access deferred** (D6).
- **Audit is the in-memory stand-in** (D4) — entries are recorded through the kernel port but not yet
  persisted to a tamper-evident spine; that lands with m03.
- **CI not yet run; not merged.**

## 9. Definition of Done

- [x] ADR-017..020 accepted; readiness GO; decisions D1–D6 resolved.
- [x] m02-rbac module: persistence, domain, services, resolver, authorizer, bootstrap.
- [x] `x-permissions` and `ContextAuthz` deleted; `AUTHZ` bound to `RbacAuthz`; conformance asserts zero use.
- [x] RBAC admin API under `/api/v1/rbac`; every mutating route has a permission and a registered audit code.
- [x] Permissions, events, audit codes registered; conformance green.
- [x] Pure smoke suite + DB-integration spec for m02-rbac; api-rbac HTTP spec.
- [x] Smoke and DB lanes green locally.
- [ ] CI (Smoke + DB on PostgreSQL 16) green on the PR — **pending**.
- [ ] Merged to `main` — **pending, do not merge without green CI**.

## 10. Recommendation

**Open the PR.** The stage is implemented and both local lanes are green. Do **not** mark it certified and
do **not** begin Stage 2 until the PR's required lanes pass and the branch merges. This report and the
manifest record that distinction rather than eliding it.
