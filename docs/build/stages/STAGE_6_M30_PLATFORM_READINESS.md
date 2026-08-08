# Stage 6A — M30 Platform Foundation — Readiness

**Governance:** PR #73 merged to `main` (`3fc66fb8dfb5d312cd642ed1c24dd72e9e5d9fc1`).

## Preconditions (all met)
- [x] Governance merged: m30 `status: approved_for_build` on main; Stage 5 AI (m24..m29) complete + certified.
- [x] Dependencies: Stage 1 foundation (m01/m02/m03/m06) implemented + certified. No later-stage dependency.
- [x] Naming (naming-map authoritative): api_prefixes [] (no REST), permission_namespaces resolved to platform.* (GAP-2), event_families [platform.lifecycle], audit PLATFORM_.

## Governance gaps resolved at build
1. **GAP-2 (permission namespace):** platform.* namespace registered (ADR-115); 9 codes, 6 privileged; control-plane = platform.control.administer.
2. **GAP-5 (feature-flag ownership / second-engine):** feature flags were never implemented; m04-admin is orchestration-only. M30 is canonical owner; m04 consumes by contract. Recorded in SHARED_SERVICE_OWNERSHIP.md. No duplicate engine (ADR-115).
3. **Secrets seam:** M30 owns secret references only (opaque secretref:, zero secret values); real key mgmt = m41 behind a fail-closed port (ADR-116).

## Non-goals
Building m31–m42; a secrets/key-management engine (m41); a production secrets adapter; a REST API; a second
RBAC/audit/workflow/outbox/feature-flag engine; modifying m04-admin; editing a historical migration.

## Test strategy
PURE smoke (gates, feature evaluation, secrets-seam, permissions, audit codes) + package DB spec (RLS/FORCE, grants,
CHECKs, zero secret-value columns, isolation) + services DB spec (config plain + secret-bearing, features incl.
no-authz-bypass + absolute control, platform-scope authz, secret references, idempotency, cross-tenant). Full repo lane.
