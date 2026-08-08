# Stage 5 — M29 AI Governance & Release — Architecture

**Module:** `m29-ai-governance` · **Stage:** 5 (last AI module) · **MVP:** false · **Branch:** `feature/stage-5-m29-ai-governance`
**ADRs:** ADR-113 (event ownership), ADR-114 (no AI self-approval / governance model).

## 1. Purpose
The enterprise oversight layer for the AI lifecycle: governs AI use cases + policies and the human-approved RELEASE of
M24 assets (model/prompt/provider/policy/use-case versions) with evaluation evidence, controlled waivers, and
suspension/withdrawal. AI governs AI; a human decides.

## 2. The load-bearing rule (AI never approves its own release) — 3 layers
| Layer | Enforcement |
|-------|-------------|
| Pure gates | `evaluateSodGate`/`evaluateReleaseGate`/`evaluateWaiverGate` + `isHumanActor` (null/blank/system/ai/automation ≠ human; proposer ≠ approver), fail closed |
| Services | explicit human-actor guard + gate before every approval; default-deny `ai.governance.*` authz |
| Database | `ai_governance_release_human_ck` (approved ⇒ approved_by NOT NULL); `_sod_ck` (approved_by ≠ proposed_by); `_evidence_ck` (non-waiver ⇒ evaluation_passed); decision.decider NOT NULL |

Also DB-enforced: policy `require_human_approval`/`require_evaluation` always true, `allow_restricted_provider` always
false; use-case `controlled_action_prohibited` always true; absolute controls never waivable.

## 3. Boundaries (consumed BY CONTRACT / not owned)
- **M24** consumed by opaque reference only (no m24/business table read, no provider call, no credential/secret, no prompt/output content). No provider selection, no DLP bypass.
- **Event family** `ai.governance_lifecycle` owned by M24; M29 is an authorized emitter reusing `GovernanceControlUpdated` on the one m06 outbox (ADR-113). No new family, no second outbox.
- **No REST API** (`api_prefixes: []`), no runtime/deployment control, no production provider, no second AI engine, no duplication of M25–M28.

## 4. Data model (7 tables)
Mutable aggregates (SELECT/INSERT/UPDATE, versioned): `ai_governance_policy`, `ai_governance_use_case`,
`ai_governance_release`. Append-only ledgers (INSERT/SELECT): `ai_governance_evaluation`, `ai_governance_decision`,
`ai_governance_history`, `ai_governance_idempotency`. Every tenant-scoped table: composite `(tenant_id,id)` PK+UNIQUE,
RLS ENABLE+FORCE + `tenant_isolation`, composite FKs within m29, no DELETE grant, no float, no secret column, confidence/
accuracy integer bps.

## 5. Lifecycles (single choke point + optimistic concurrency + idempotency)
- Release: `draft → assessment → evaluation_pending → review_pending → approved → released`, plus `→ rejected | suspended | withdrawn | superseded`.
- Waiver: `draft → assessment → evaluation_pending → review_pending → approved | rejected`, `approved → expired`.

## 6. Permissions / audit / events
- Permissions (shared `ai.*`): reuse `ai.governance.read`/`manage` (m24) + 3 NEW privileged `ai.governance.approve`/`override`/`export`.
- Audit (shared `AI_`): 16 `AI_GOVERNANCE_*` codes.
- Events: `ai.governance_lifecycle` / `GovernanceControlUpdated` via the one m06 outbox. No new family.

## 7. Services
`AiGovernancePolicyService`, `AiUseCaseGovernanceService`, `AiReleaseService`, `AiEvaluationService`, `AiWaiverService`,
`AiGovernanceDecisionService` (evidence export). Each authorizes independently (default deny), records append-only
evidence + a human decision, and emits the lifecycle event in the same transaction.
