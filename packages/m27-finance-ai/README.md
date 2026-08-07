# m27-finance-ai — Finance AI (Stage 5, GOVERNED, mvp:partial)

Human-reviewed, **explainable** AI **assistance** for reconciliation and finance (bank recon from
M15/M15a, GL recon from M20): match suggestions, exception classification, anomaly detection, risk
flagging and journal-recommendation drafting — every output a **SUGGESTION** with confidence + evidence.

> **NEVER AUTO-POSTS.** It never approves, auto-matches, auto-reconciles, closes an exception, creates
> or posts a journal, or mutates a finance record. Suggestions feed **draft journals + human approval
> only**; a human decides and the owning finance module executes. (CLAUDE.md no-autopost hard rule.)

|                  |                                                                    |
| ---------------- | ------------------------------------------------------------------ |
| Module code      | `m27-finance-ai`                                                  |
| Build stage      | 5 (`docs/07-engineering/BUILD_SEQUENCE.md`)                        |
| MVP              | partial — reconciliation match suggestions as human hints          |
| Status           | `implemented` (`manifests/module-registry.yaml`)                  |
| Owned tables     | 12 (all FORCE-RLS, composite `(tenant_id, id)` keys)              |
| API / perms / audit / events | none / shares `ai.*` / shares `AI_` / none (reuses m24's) |

## What ships

- **Consumes M24 by contract.** The `AiGatewayPort` (`M24AiGateway`) wraps M24's `RequestService` +
  `ReviewService` — provider routing, DLP, approved-provider gating, confidence and usage/cost all live
  in **M24** and are never duplicated or bypassed. M27 holds only OPAQUE m24 request/output ids; it
  never selects providers, touches credentials, or writes M24 tables.
- **M15/M20 by opaque reference.** Reconciliation runs/lines/exceptions and GL runs/lines are opaque
  uuids (M27 reads no m15/m20 table). **Matching stays owned by M15a, GL reconciliation by M20;
  M15/M20 remain the source of truth** — M27 suggests candidates and explains them, but never creates
  a final match, closes an exception, certifies a balance or creates a journal.
- **Explainable matching.** Every suggestion preserves type, reason codes, matched **features**,
  confidence, evidence and matching-method reference. An accepted (explainability-required) suggestion
  must carry at least one feature (`finance_ai_suggestion_explain_ck`) — no unexplained match accepted.
- **No autonomous action, three layers**: pure `evaluateReviewGate` → services (non-null human actor)
  → DB `finance_ai_analysis_human_ck` / `finance_ai_suggestion_human_ck`. Config `require_human_review`
  always on; **`auto_post` and `auto_match` can never be enabled** (CHECKs). An accept requires M24
  output approval.
- **Money-safe.** Amounts are **bigint minor units** (`amount_minor`, carried as a string, never a
  float — ADR-007); no balance is ever mutated. Confidence is integer basis points (0..10000).
- **5 `ai.finance.*` permissions** (3 privileged), **13 `AI_FINANCE_` audit codes** (shared `AI_`).
  **No new API root, no new event family, no second outbox** — the AI lifecycle is m24's via m06.

## Services

`FinanceAiConfigurationService`, `FinanceAiAnalysisService` (bind subject → governed analysis via M24 →
exception classification + model-result summary), `FinanceAiSuggestionService` (explainable suggestions
+ features; human decides), `FinanceAiReviewService` (human analysis review; drives M24 output approval),
`FinanceAiEvidenceService`.

## Tests

- `test/m27-finance-ai.smoke.ts` — PURE domain, review + explainability gates, money-safety, permissions, audit codes.
- `test/m27-finance-ai.db-spec.ts` — governance on real PostgreSQL: RLS FORCE, no-DELETE, append-only,
  no-float (amount bigint), no-secret, the human-review / explainability / no-autopost / no-automatch CHECKs, single outbox.
- `test/m27-services.db-spec.ts` — the governed pipeline end to end through the real M24 gateway:
  request → human accept → explainable suggestion (accept refused without a feature, then allowed) →
  classify exception; DLP-blocked restricted analysis fails closed; default deny; AI_FINANCE_ audit
  carries no secret/content; cross-tenant isolation.

## Not in scope (boundaries)

Executive Copilot (m28), AI governance (m29), provider adapters, RAG/vector retrieval, m41; the M15a
matching engine and M20 GL reconciliation (consumed, never duplicated); and any controlled finance
action — auto-match, exception close, journal creation/approval/posting, balance mutation, payment.
M27 recommends; a human decides and acts through M15/M21.
