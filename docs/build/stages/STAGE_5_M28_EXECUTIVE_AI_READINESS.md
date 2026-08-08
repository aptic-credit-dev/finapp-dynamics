# Stage 5 — M28 Executive AI — Readiness

**Module:** `m28-executive-ai` · **Governance:** PR #67 merged to `main` (`dceb5665b452b0bab10d24d5c109020ad3794b2c`).

## Preconditions (all met)

- [x] Governance merged: m28 `status: approved_for_build` on `main`.
- [x] Dependency **M24** certified and consumed BY CONTRACT (gateway port). Available.
- [x] Dependency **M32** is Stage 6, mvp:false, **UNBUILT** → deferred behind a read-only port (do not build m32).
- [x] Naming (naming-map authoritative): api_prefix `/api/v1/copilot`; audit prefix `AI_`; `event_families: []` (reuse
      m24 `ai.*_lifecycle`).
- [x] **GAP-4** (permission namespace absent) resolved before any controller: reuse `ai.*` with `ai.copilot.*` codes
      (ADR-111); naming-map + permission-registry updated; GAP-4 removed from m28's affects list.

## Blockers reviewed (from the governance PR)

1. **M32 unbuilt** → `ExecutiveAnalyticsPort` with deterministic fixture double + fail-closed `UnavailableAnalyticsPort`.
   The copilot remains useful with fixture-backed analytics and returns `review_required` when analytics is unavailable.
2. **GAP-4** → resolved as above; every `/copilot` route (read and mutating) authorizes an `ai.copilot.*` permission,
   default deny, with RLS masking.

## Non-goals (explicitly out of scope)

Building M32; a second AI/DLP engine; production AI providers; M29 governance; any business mutation, approval, posting,
payment, reconciliation, case/legal mutation, notification or controlled action; a new event family; a second outbox;
editing a historical migration.

## Test strategy

PURE smoke (gates, lifecycles, permissions, audit codes) + package DB spec (schema/RLS/grants/CHECKs/isolation) +
services DB spec (end-to-end through M24: cited answer, masking, refusals, DLP, idempotency, audit privacy) + HTTP API
DB spec (401/403/404/409, idempotency, pagination, refusals, no mutation route). Full repository smoke + DB/API lane.
