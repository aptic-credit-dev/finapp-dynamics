# Stage 5 — M27 Finance AI — Architecture

**Module:** `m27-finance-ai` · **Capability:** Finance AI (recon suggestions; NO auto-post) · **MVP:** partial · **Spec:** `docs/05-ai/FINANCE_AI.md`

## Position
M27 turns the M24 AI foundation into human-reviewed, EXPLAINABLE suggestions over M15/M15a bank reconciliation and M20 GL reconciliation. It is advisory only and NEVER auto-posts/auto-matches/approves/mutates a finance record; M15/M20 stay the source of truth and the owning finance module (M15/M21) executes any accepted action.

## Boundaries (naming-map authoritative)
- **API:** none (`api_prefixes: []`) — internal governed library, no HTTP controllers.
- **Permissions:** shares `ai.*` — 5 new `ai.finance.*` codes (3 privileged).
- **Audit:** shares `AI_` — 13 `AI_FINANCE_*` codes.
- **Events:** none (`event_families: []`) — reuses m24 `ai.*_lifecycle`; owns no second outbox.

## Consumed shared services (by contract, never duplicated)
| Service | How consumed |
| --- | --- |
| **M24** AI foundation | `AiGatewayPort` (`M24AiGateway` wraps `RequestService`/`ReviewService`) — routing, DLP, provider approval, confidence, usage/cost in M24. Opaque request/output ids only. |
| **M15/M15a** bank recon + matching | opaque recon-run/line/exception refs — reads no m15 table; matching stays owned by M15a; M27 suggests candidates only. |
| **M20** GL reconciliation | opaque GL-run/line refs — reads no m20 table; M27 explains/suggests; cannot certify a balance or create a journal. |
| **m02** RBAC, **m03** audit | `Authz.require` (default deny), `Audit.write` (AI_FINANCE_) in-transaction. |

## Owned tables (12)
`finance_ai_config`, `finance_ai_subject`, `finance_ai_analysis` (+ `_history`), `finance_ai_model_result`, `finance_ai_exception_classification`, `finance_ai_suggestion` (+ `_history`), `finance_ai_feature`, `finance_ai_evidence`, `finance_ai_review`, `finance_ai_idempotency`. 4 mutable aggregates (version/optimistic-lock); 8 append-only ledgers. Composite `(tenant_id, id)` PK + composite FKs (within m27), RLS ENABLE+FORCE + `tenant_isolation`, no DELETE grant. Money is bigint minor units (never float); no secret column.

## Governance model
- **No autonomous action / no auto-post** (3 layers): `evaluateReviewGate` → services (human actor) → DB `finance_ai_analysis_human_ck` / `finance_ai_suggestion_human_ck`; config `auto_post`/`auto_match` can never be enabled (`finance_ai_config_autopost_ck`/`automatch_ck`), `require_human_review` always on.
- **Explainable matches:** an accepted explainability-required suggestion needs a matched feature (`finance_ai_suggestion_explain_ck`).
- **Money safety:** `amount_minor` bigint minor units; no balance mutation; ADR-007.

See ADR-109 (no-autopost / human-decided / explainable) and ADR-110 (M24/M15/M20 by contract; bigint money; M15/M20 source of truth).
