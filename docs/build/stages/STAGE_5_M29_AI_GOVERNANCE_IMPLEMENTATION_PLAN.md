# Stage 5 — M29 AI Governance & Release — Implementation Plan

Ordered, reviewable units (as committed):

1. **Architecture / ADRs** — ADR-113 (event ownership: m24 owns family, m29 authorized emitter), ADR-114 (no AI self-approval / governance model); stage docs + README.
2. **Migrations / domain** — `0001_ai_governance.sql` (7 tables; RLS FORCE, `tenant_isolation`, human/SoD/evidence/policy/use-case CHECKs; 3 new `ai.governance.*` permission seed), `0002_grant_application_role.sql` (no DELETE; append-only ledgers INSERT+SELECT); pure `domain.ts` (classifications, risk tiers, subject kinds, release/waiver lifecycles, `isHumanActor` type guard, SoD/release/waiver gates, `evaluatePasses`, absolute controls, reason codes).
3. **Services / M24 integration** — `emit.ts` (authorized `ai.governance_lifecycle` emitter over the m06 outbox), `repository.ts`, services (`policy`, `use-case`, `release`, `evaluation`, `waiver`, `decision`/export).
4. **Tests** — pure smoke, schema DB spec, services DB spec.
5. **Registries / manifest / docs** — permission-registry (`ai.governance.approve`/`override`/`export`), audit-code-registry (16 `AI_GOVERNANCE_*`, count 741→757), implementation-manifest (m29 → implemented), module-registry, completion report.

## Key design decisions
- **Waivers are modelled as a `subject_kind='waiver_exception'` release** (no 8th table): the same human-approver + SoD CHECKs apply; the evidence gate is exempt for waivers; absolute-control waivers are refused at request time.
- **The event family is reused, not extended** (ADR-113): m29 emits M24's existing `GovernanceControlUpdated` type with a discriminating `AiLifecyclePayload` — no contracts/event-registry change, conformance stays green.
- **`isHumanActor` is a type guard** (`actor is string`): a `null`/blank/`system`/`ai`/`automation` actor is never a human, and narrowing removes the need for non-null assertions while enforcing "no AI self-approval" at the type level.
