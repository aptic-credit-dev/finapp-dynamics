# Stage 5 — M29 AI Governance & Release — Readiness

**Governance:** PR #70 merged to `main` (`667c7855e92bf129b950a964c7bc4594347d6e11`).

## Preconditions (all met)
- [x] Governance merged: m29 `status: approved_for_build` on `main`.
- [x] Dependency **M24** implemented + certified and consumed BY CONTRACT (opaque refs). Available.
- [x] Naming (naming-map authoritative): `api_prefixes: []` (no REST surface); `permission_namespaces: ['ai.*']` (`ai.governance.read`/`manage` already registered); `event_families: [ai.governance_lifecycle]` (already registered, m24-owned); audit `AI_`.

## Governance gaps addressed (flagged at approval)
1. **No dedicated module spec** in `docs/05-ai` — architecture/readiness authored here from ENTERPRISE_AI_FOUNDATION + manifest/naming truth (precedent m19/m23).
2. **Event ownership** of `ai.governance_lifecycle` (co-listed m24+m29) — resolved by ADR-113: m24 owns the family, m29 is an authorized emitter reusing `GovernanceControlUpdated`; no new family, no contracts/event-registry edit.
3. **mvp:false** — governance/release oversight is post-MVP (like m26); approved for build by precedent.

## Non-goals
Building M30–M42 / Stage 6; a production provider; a second AI engine/outbox/event family; any REST API; any domain
action or deployment/runtime control; AI self-approval; editing a historical migration.

## Test strategy
PURE smoke (gates, lifecycles, evaluatePasses, permissions, audit codes) + package DB spec (schema/RLS/grants/human+SoD+
evidence CHECKs/isolation) + services DB spec (end-to-end: propose → evaluate → self/AI approval refused → independent
human approves → release/suspend; waivers + absolute-control block; idempotency; audit/event). Full repository lane.
