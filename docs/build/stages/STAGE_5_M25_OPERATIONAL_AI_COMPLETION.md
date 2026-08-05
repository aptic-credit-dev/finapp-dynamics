# Stage 5 — M25 Operational AI — Completion (GOVERNED MVP)

**Module:** `m25-operational-ai` · **Branch:** `feature/stage-5-m25-operational-ai` · **Date:** 2026-08-05
**Capability:** Operational AI (feedback/case) — human-reviewed AI suggestions over Feedback (m12) and Case (m13),
reusing the M24 governed AI gateway. Governance PR #58 approved the build.

## What shipped

Human-reviewed AI **assistance** for Feedback and Case — summaries, sentiment, complaint/feedback classification,
root-cause hints, suggested activities and routing/escalation recommendations, each a **SUGGESTION** with confidence +
citations. **RECOMMENDS ONLY:** it never closes, escalates, reassigns or resolves a controlled item on its own — a
human decides and acts through m12/m13's own endpoints.

- **9 FORCE-RLS tables** (4 mutable aggregates `ops_ai_config`/`ops_ai_subject`/`ops_ai_analysis`/`ops_ai_suggestion`
  + 5 append-only ledgers: 2 histories + `ops_ai_evidence`/`ops_ai_review`/`ops_ai_idempotency`); composite
  `(tenant_id, id)` keys + composite FKs (within m25 only); no DELETE grant. Migrations `0001`/`0002`.
- **Consumes M24 BY CONTRACT** through `AiGatewayPort` (`M24AiGateway` wraps M24 `RequestService`/`ReviewService`).
  Provider routing, DLP, approved-provider gating, confidence, citations and usage/cost all live in **M24** — never
  duplicated. M25 owns **no** provider, routing, DLP, prompt/vector engine or outbox. No network, no HTTP, no SDK.
- **Pure domain**: subject/analysis/suggestion vocabularies + state machines, the human-decision gate
  (`evaluateDecisionGate`, fails closed), integer basis-points confidence.
- **Three services**: `ConfigService` (versioned config; human-review always on, auto-apply always off),
  `OperationalAiService` (bind subject → governed analysis via M24 → human accept/reject/dismiss; an accept drives the
  M24 output approval and is refused unless M24 approved it), `SuggestionService` (recommends-only suggestions; a human
  decides, M25 never acts on m12/m13).
- **7 `ai.*` permissions** (`ai.operational.*` / `ai.suggestion.*`; 3 privileged) in the **shared** m24 namespace,
  **11 `AI_OPS_` audit codes** (shared `AI_` prefix; `registered_code_count` 694 → 705). **No new API root, no new
  event family, no second outbox** (naming-map authoritative) — the AI request/output lifecycle is emitted by M24.
- Feedback/case/document/M24-request/output referenced by **OPAQUE uuid** only (no cross-module FK; reads no
  m12/m13/m24 table). No float column; no secret column. README; this completion doc; manifest + registries synced.

### The governance guarantees (enforced in three layers)

**No autonomous action** — an analysis or a suggestion can only be decided (accepted/rejected/dismissed) by a HUMAN:
(1) the pure `evaluateDecisionGate` (a human reviewer + a known decision, fails closed), (2) the services (non-null
human actor), and (3) the DB `ops_ai_analysis_human_ck` / `ops_ai_suggestion_human_ck`. An **accept** additionally
requires that **M24 approved** the underlying AI output (else refused — fail closed). Config `require_human_review`
can never be turned off and `auto_apply` can never be enabled (`ops_ai_config_review_ck` / `ops_ai_config_autoapply_ck`).
Confidence is integer basis points (0..10000), preserved from M24. A DLP-blocked restricted analysis fails closed
(the analysis is `failed`; M24 durably rejected the request).

## Boundary & contamination verdict

**Clean.** M25 owns only its 9 `ops_ai_*` tables; reads no m12/m13/m24 table; creates **no** duplicate shared service
(the AI foundation, provider routing, DLP, workflow, notifications, audit, RBAC, outbox, vector and prompt engines are
all consumed, never re-implemented); adds **no** second outbox and **no** new event family; executes **no** controlled
business action. It consumes m24 (by the gateway port), m12 and m13 (opaque refs) only. Did not modify M24, M12 or M13.
Out of scope and untouched: Credit/Finance/Legal AI (m26/m27), AI governance (m29), provider adapters, RAG/vector, m41.

## Verification

- **Build:** `npm run build` — green (whole solution).
- **Lint:** `npm run lint` — **0 errors** (68 pre-existing baseline warnings; m25 adds none).
- **Format:** `npm run format:check` — clean.
- **Smoke lane:** 30 suites, **5497 assertions**, 0 failures (m25 smoke 57; conformance 3031 — validating the 7 new
  `ai.*` permissions, 11 `AI_OPS_` audit codes and count 705).
- **Migration replay:** `npm run migrate` — **48 applied** on a fresh database, in dependency order (m25 last).
- **DB lane (PostgreSQL 15.2 throwaway, non-owner app role via `SET ROLE`, `DATABASE_APP_ROLE=finapp_app`, fresh DB):**
  **62 specs, 1972 assertions, 0 failures**, including **`m25-operational-ai` db-spec (29)** and **`m25-services`
  db-spec (20)**, and every `api-*` HTTP spec green.

### Live DB governance proven

9/9 tables RLS ENABLE+FORCE + `tenant_isolation`; cross-tenant reads return nothing; 0 DELETE grants; 0 UPDATE on the
5 append-only ledgers; 0 float columns; `confidence_bps` is `integer`; 0 secret columns; the no-autonomous-action CHECKs
(`ops_ai_analysis_human_ck`, `ops_ai_suggestion_human_ck`); config `require_human_review`/`auto_apply` CHECKs; unique
idempotency ledger; composite FKs; single outbox (m06) — m25 owns none. End to end through the real M24 gateway:
request a governed analysis → human accept (drives M24 output approval) → recommends-only suggestion → human decide;
DLP-blocked restricted analysis fails closed; no autonomous action; default deny; audit carries no secret or content;
cross-tenant isolation holds.

## PostgreSQL 16 compatibility

All DDL is PG16-compatible (`gen_random_uuid()`, partial unique indexes, composite PK/FK, RLS FORCE,
`current_setting('app.tenant_id', true)` policies). Proven locally on PG 15.2 (the available throwaway); the
PostgreSQL 16 CI DB lane is authoritative.

## Known limitations / not in the MVP

- **No HTTP API** — naming-map declares `api_prefixes: []`; M25 is an internal governed library consumed by the M24
  gateway. No `apps/api` wiring (naming reserved for none).
- **Deterministic generation** — the underlying AI generation is M24's deterministic double (ADR-105); no real model
  or real DLP (m41) ships. Sentiment/classification labels are human-confirmed suggestions, not a second AI engine.
- **Duplicate detection / similar-historical-cases / response suggestions** (Section D examples) are **not** in the
  MVP — the spec MVP is feedback/case summaries + sentiment as human-reviewed suggestions; the remaining capabilities
  are incremental follow-ups on the same tables and gateway.

## Remaining manual action
Merge the M25 implementation PR, then run post-merge M25 certification.
