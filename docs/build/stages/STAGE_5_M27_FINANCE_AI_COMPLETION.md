# Stage 5 — M27 Finance AI — Completion (GOVERNED, mvp:partial)

**Module:** `m27-finance-ai` · **Branch:** `feature/stage-5-m27-finance-ai` · **Date:** 2026-08-06
**Capability:** Finance AI — reconciliation suggestions, explainable matching, NO auto-post. Governance PR #64 approved
the build (baseline `main` `ccce6d6`).

## What shipped

Human-reviewed, **explainable** AI **assistance** for reconciliation and finance (bank recon from M15/M15a, GL recon
from M20) — match suggestions, exception classification, anomaly detection, risk flagging and journal-recommendation
drafting, each a **SUGGESTION** with confidence + evidence. **NEVER auto-posts, auto-matches, approves or mutates a
finance record;** suggestions feed draft journals + human approval only — a human decides and the owning finance
module (M15/M21) executes. M15/M20 remain the source of truth.

- **12 FORCE-RLS tables** (4 mutable aggregates `finance_ai_config/subject/analysis/suggestion` + 8 append-only:
  `analysis_history`/`model_result`/`exception_classification`/`suggestion_history`/`feature`/`evidence`/`review`/
  `idempotency`); composite `(tenant_id, id)` keys + composite FKs (within m27); no DELETE grant. Migrations `0001`/`0002`.
- **Consumes M24 BY CONTRACT** through `AiGatewayPort` (`M24AiGateway` wraps m24 `RequestService`/`ReviewService`):
  provider selection, DLP, approved-provider routing, confidence and usage/cost live in **M24** — never duplicated or
  bypassed. M27 holds only opaque m24 request/output ids; it never selects providers, touches credentials, or writes
  M24 tables. Duplicate handoff prevented by an idempotency ledger; a blocked/rejected M24 request leaves the analysis
  durably `failed`.
- **M15/M20 by opaque reference** — recon runs/lines/exceptions + GL runs/lines by opaque uuid (reads no m15/m20
  table). **Matching stays owned by M15a, GL reconciliation by M20; M15/M20 are the source of truth** — M27 suggests
  candidates and explains them but never creates a final match, closes an exception, certifies a balance or creates a
  journal.
- **Pure domain**: subject/analysis/suggestion/exception/feature vocabularies + state machines, `evaluateReviewGate`
  (human + explainability, fail closed), integer basis-points confidence, bigint minor-unit money guard.
- **Five services**: `FinanceAiConfigurationService`, `FinanceAiAnalysisService` (bind subject → governed analysis via
  M24 → exception classification + model-result summary), `FinanceAiSuggestionService` (explainable suggestions +
  matched features; a human decides), `FinanceAiReviewService` (human analysis review; drives M24 output approval),
  `FinanceAiEvidenceService`.
- **5 `ai.finance.*` permissions** (3 privileged) in the **shared** namespace; **13 `AI_FINANCE_` audit codes** (shared
  `AI_`; `registered_code_count` 719 → 732). **No new API root, no new event family, no second outbox** (naming-map).
  ADR-109, ADR-110; README; architecture, readiness, implementation-plan, this completion doc; manifest + registries
  synchronised.

### Governance guarantees (enforced in three layers)

**No autonomous action / NO auto-post** — an analysis or suggestion can only be decided by a HUMAN: pure
`evaluateReviewGate` → services (non-null human actor) → DB `finance_ai_analysis_human_ck` /
`finance_ai_suggestion_human_ck`; config `require_human_review` can never be off and **`auto_post` / `auto_match` can
never be enabled** (`finance_ai_config_autopost_ck` / `finance_ai_config_automatch_ck`). **Explainable matches** — an
accepted explainability-required suggestion needs at least one matched feature (`finance_ai_suggestion_explain_ck`); no
unexplained match is accepted. An **accept** requires M24 output approval. **Money-safe** — `amount_minor` is bigint
minor units (never a float, ADR-007); no balance is mutated; a suggestion is never a confirmed accounting fact.
Confidence is integer basis points (0..10000). Audit payloads carry safe ids/states/suggestion types/reason codes/
confidence/opaque refs only — never bank-statement text, raw ledger content, prompt/output, secrets or credentials.

## Boundary & contamination verdict

**Clean.** M27 owns only its 12 `finance_ai_*` tables; reads no m15/m20/m24 table; creates **no** duplicate shared
service (AI foundation, provider routing, DLP, the M15a matching engine, M20 GL reconciliation, workflow, audit, RBAC,
outbox all consumed, never re-implemented); adds **no** second outbox and **no** new event family; performs **no**
auto-match, exception close, journal creation/approval/posting, balance mutation or payment. Consumes m24 (gateway),
m15/m20 (opaque refs). Did not modify M24, M15/M15a or M20. Out of scope and untouched: Executive Copilot (m28), AI
governance (m29), provider adapters, RAG/vector, m41. No external network, no production provider.

## Verification

- **Build:** green (whole solution). **Lint:** `npm run lint` — **0 errors** (68 baseline warnings; m27 adds none).
- **Format:** `npm run format:check` — clean.
- **Smoke lane:** 32 suites, **5703 assertions**, 0 failures (m27 smoke 57; conformance 3109 — validating the 5 new
  `ai.*` permissions, 13 `AI_FINANCE_` audit codes and count 732).
- **Migration replay:** `npm run migrate` — **52 applied** on a fresh database, in dependency order (m27 last);
  checksums/ordering enforced (no historical migration edit).
- **DB lane** (PostgreSQL 15.2 throwaway, non-owner app role via `SET ROLE`, `DATABASE_APP_ROLE=finapp_app`, fresh DB):
  **66 specs, 2086 assertions, 0 failures**, including **`m27-finance-ai` db-spec (34)** and **`m27-services` db-spec
  (23)**, and every `api-*` HTTP spec green.

### Live DB governance proven

12/12 tables RLS ENABLE+FORCE + `tenant_isolation`; cross-tenant reads return nothing; 0 DELETE grants; 0 UPDATE on the
8 append-only ledgers; 0 float columns; `confidence_bps` integer, `amount_minor` bigint minor units; 0 secret columns;
the no-autonomous-action CHECKs, the explainability CHECK, the no-autopost + no-automatch config CHECKs; unique
idempotency ledger; composite FKs; single outbox (m06). End to end through the real M24 gateway: request a governed
analysis → human accept (drives M24 output approval) → explainable suggestion (accept refused with 0 features, then
allowed once a feature is recorded) → classify exception; DLP-blocked restricted analysis fails closed; default deny;
audit carries no secret or content; cross-tenant isolation holds.

## PostgreSQL 16 compatibility

All DDL is PG16-compatible (`gen_random_uuid()`, partial unique indexes, composite PK/FK, RLS FORCE,
`current_setting('app.tenant_id', true)` policies, bigint minor units). Proven locally on PG 15.2 (the available
throwaway); the PostgreSQL 16 CI DB lane is authoritative.

## Known limitations

- **No HTTP API** — naming-map `api_prefixes: []`; M27 is an internal governed library consumed via the M24 gateway.
- **Deterministic generation** — the underlying AI generation is M24's deterministic double (ADR-105); no real model,
  no real DLP (m41), no production provider. Suggestion/anomaly outputs are AI-sourced hints a human confirms.
- **mvp:partial** — the MVP is reconciliation match suggestions as human-confirmable hints; richer anomaly/risk
  scoring and RAG/vector retrieval are incremental follow-ups on the same tables and gateway.

## Remaining manual action
Merge the M27 implementation PR, then run post-merge M27 certification.
