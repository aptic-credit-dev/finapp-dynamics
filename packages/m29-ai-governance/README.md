# @finapp/m29-ai-governance — AI Governance & Release (Stage 5, governed, mvp:false)

The enterprise **oversight layer for the AI lifecycle** — the last Stage-5 AI module. It governs AI **use cases** and
**policies** and the human-approved **RELEASE** of M24 assets (model/prompt/provider/policy/use-case versions), with
evaluation **evidence**, controlled **waivers/overrides**, and suspension/withdrawal. **AI governs AI; a human decides.**

## The load-bearing rule: AI never approves its own release

Enforced in **three layers**:

- **Pure gates** — `evaluateSodGate` / `evaluateReleaseGate` / `evaluateWaiverGate` + `isHumanActor`: a `null`/blank/
  `system`/`ai`/`automation` actor is never a human, and the proposer can never be the approver (maker ≠ checker). Fail
  closed.
- **Services** — an explicit human-actor guard + the gate before every approval; default-deny `ai.governance.*` authz.
- **Database** — `ai_governance_release_human_ck` (approved/released ⇒ non-null `approved_by`),
  `ai_governance_release_sod_ck` (`approved_by <> proposed_by`), `ai_governance_release_evidence_ck` (a non-waiver
  release cannot be approved without a passing evaluation), and the decision ledger's `decider` is NOT NULL.

Additional DB-enforced controls: a **policy** can never disable human approval or evaluation, nor blanket-allow a
restricted provider; a governed **use case** can never permit an AI-executed controlled action; an **ABSOLUTE** control
(no-production-provider, no-secret, no-restricted-data, no-AI-controlled-action, no-AI-self-approval, human-review) can
**never** be waived (`AI_GOVERNANCE_OVERRIDE_BLOCKED`).

## What it owns

- **7 tables**: `ai_governance_policy`, `ai_governance_use_case`, `ai_governance_release` (mutable aggregates) +
  `ai_governance_evaluation`, `ai_governance_decision`, `ai_governance_history`, `ai_governance_idempotency`
  (append-only). RLS ENABLE+FORCE + `tenant_isolation` on all 7; composite PK/FKs; no DELETE grant; append-only ledgers
  are INSERT+SELECT only; no float; no secret column; confidence/accuracy integer basis points.
- **3 new privileged permissions** in the shared `ai.*` namespace: `ai.governance.approve` (the human checker),
  `ai.governance.override` (waiver/exception authority), `ai.governance.export` (evidence export). `ai.governance.read`
  and `ai.governance.manage` are reused from M24. The maker (`manage`) and the checker (`approve`) are distinct.
- **16 audit codes** under the shared `AI_` prefix: `AI_GOVERNANCE_*`.

## What it does NOT own / do

- **No new event family, no second outbox** — M24 owns the `ai.governance_lifecycle` family; M29 is an **authorized
  emitter** that reuses the existing `GovernanceControlUpdated` type on the one m06 outbox (ADR-113).
- **No REST API** (`api_prefixes: []`) — internal governed library.
- **No M24 duplication** — references M24 assets by **opaque uuid** only; reads no m24/business table, calls no provider,
  stores no credential/secret, holds no prompt/output content.
- **No runtime/deployment control** — it records the governed **decision + evidence** and emits the lifecycle event;
  actual deployment stays behind downstream/runtime integration. No production provider, no network, no HTTP client.

## Lifecycles

```
release: draft → assessment → evaluation_pending → review_pending → approved → released
                                                   review_pending → rejected ; approved/released → suspended|withdrawn|superseded
waiver:  draft → assessment → evaluation_pending → review_pending → approved|rejected ; approved → expired
```

All transitions run through a single choke point with optimistic concurrency (version), idempotency and append-only
history/evidence.

## Tests

- `test/m29-ai-governance.smoke.ts` — PURE: SoD/human-approval/release/waiver gates, lifecycles, `evaluatePasses`, permissions, audit codes.
- `test/m29-ai-governance.db-spec.ts` — schema/governance on real Postgres (RLS/FORCE, grants, human/SoD/evidence CHECKs, isolation).
- `test/m29-services.db-spec.ts` — end-to-end: policy → use-case → propose → evaluate → **self-approval refused, AI/system approval refused, independent human approves** → release → suspend; waivers + absolute-control block; idempotency; audit/event.

See ADR-113, ADR-114 and `docs/build/stages/STAGE_5_M29_AI_GOVERNANCE_*`.
