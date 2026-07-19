# Stage 1D — RBAC & Authorization (m02-rbac)

Persistent role-based access control replaces the last place a caller could assert its own authority. The
`x-permissions` header and the `ContextAuthz` stand-in are **deleted**; `AUTHZ` is bound to a persistent
`RbacAuthz`, and a caller's permissions are resolved from role assignments in the database, fresh per
request.

**Baseline:** cut from `004b2fd` (certified Stage 1C merge, PR #6). Not rebased onto anything uncertified.

## What this delivers

- **m02-rbac module** — persistence (roles, permissions, role/permission grants, tenant and platform
  assignments, SoD rules, append-only status histories), the role/assignment state machines and scope
  algebra, and the services (role, assignment, SoD, catalogue, permission resolver, authorizer, bootstrap).
- **Authorization, for real** — `RequestContext.permissions` is filled by the persistent resolver at the
  actor boundary; `RbacAuthz` is a default-deny set check. No client input carries authority.
- **`/api/v1/rbac` API** — roles (lifecycle + concrete permissions), assignments (grant / revoke /
  suspend / reactivate), SoD rules, and the permission catalogue. Every mutating route has a permission and
  a registered audit code; enforcement lives in the services.
- **First-administrator bootstrap** (ADR-020) — runs once at boot, fails closed in production, idempotent.
- **Architecture accepted** — ADR-017..020 flipped to ACCEPTED; decisions D1–D6 resolved; readiness GO.

## Security properties (proven by tests)

Default deny · no client permission injection · no self-escalation · cross-tenant assignment isolation
(RLS, no escape) · immutable system roles · SoD blocked at grant time (409) · immediate revocation (no
cache) · system context is not a universal allow · production fails closed · no physical DELETE of roles or
assignments.

## A bug found and fixed

The status-history tables were global system-escape but are written inside tenant transactions; the DB spec
caught the RLS violation. Fixed at the source (migration unshipped): both histories are now tenant-scoped
with a mixed policy.

## Test evidence (local)

- Smoke: **9 suites, 1166 assertions, 0 failures** (incl. the new m02-rbac pure suite).
- DB (PostgreSQL 15.2 throwaway): **9 specs, 332 assertions, 0 failures** (incl. new m02-rbac and api-rbac
  specs; api-auth/api-identity reworked to authorize through real role grants, not the dead header).
- Lint: 0 errors.

CI has not run yet; the required DB lane runs against PostgreSQL 16. **Do not merge until CI is green.**

## Out of scope / deferred (honest)

SoD administration is platform-scoped; org scope containment is exact-node (no tree walk); no auth cache
(D5); break-glass deferred (D6); audit is the in-memory stand-in until m03 (D4).

See `docs/build/stages/STAGE_1D_RBAC_AUTHORIZATION_COMPLETION.md` for the full report.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
