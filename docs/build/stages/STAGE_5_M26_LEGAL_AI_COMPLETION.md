# Stage 5 — M26 Legal AI — Completion (GOVERNED, mvp:false)

**Module:** `m26-legal-ai` · **Branch:** `feature/stage-5-m26-legal-ai` · **Date:** 2026-08-06
**Capability:** Legal AI — human-reviewed, citation-backed AI suggestions over M14 matters, reusing the M24 gateway.
Governance PR #61 approved the build (baseline `main` `96bc00d`).

## What shipped

Human-reviewed, citation-backed AI **assistance** for the legal domain — summaries, chronology,
issue/obligation/deadline extraction, clause analysis, evidence-gap detection and drafting assistance, each a
**SUGGESTION** with confidence + citations. **LEGAL-ADVISORY ONLY:** it never files, reaches a legal conclusion,
settles, enforces, creates a hearing/deadline/decision, or mutates a matter — a human legal reviewer decides and
M14 remains the legal source of truth.

- **11 FORCE-RLS tables** (4 mutable aggregates `legal_ai_config/subject/analysis/suggestion` + 7 append-only:
  `analysis_history`/`finding`/`citation`/`suggestion_history`/`review`/`evidence`/`idempotency`); composite
  `(tenant_id, id)` keys + composite FKs (within m26); no DELETE grant. Migrations `0001`/`0002`.
- **Consumes M24 BY CONTRACT** through `AiGatewayPort` (`M24AiGateway` wraps m24 `RequestService`/`ReviewService`):
  provider selection, DLP, approved-provider routing, confidence, citations and usage/cost live in **M24** — never
  duplicated or bypassed. M26 holds only opaque m24 request/output ids; it never selects providers, touches
  credentials, or writes M24 tables. Duplicate handoff prevented by an idempotency ledger; a blocked/rejected M24
  request leaves the analysis durably `failed`.
- **M14 / M09 by opaque reference** — matters/documents by opaque uuid (reads no m14/m09 table). A **citation**
  holds an M09 document reference + version/hash + bounded location + evidence classification — **never content**.
- **Pure domain**: subject/analysis/finding/citation/suggestion vocabularies + state machines, `evaluateReviewGate`
  (human + citation, fail closed) and `evaluateEthicalWall` (privilege access, fail closed), integer basis-points
  confidence.
- **Five services**: `LegalAiConfigurationService`, `LegalAiAnalysisService` (bind subject + ethical wall →
  governed analysis via M24 → extracted/inferred findings), `LegalAiEvidenceService` (citations/evidence),
  `LegalAiReviewService` (human legal review; citation + ethical-wall gates; drives M24 output approval),
  `LegalAiSuggestionService` (advisory suggestions; a human decides, M26 never acts on M14).
- **6 `ai.*` permissions** (`ai.legal.read/analyze/review/configure/export`, `ai.privileged.read`; 4 privileged) in
  the **shared** namespace; **14 `AI_LEGAL_` audit codes** (shared `AI_`; `registered_code_count` 705 → 719). **No
  new API root, no new event family, no second outbox** (naming-map). ADR-107, ADR-108; README; architecture,
  readiness, implementation-plan, this completion doc; manifest + registries synchronised.

### Governance guarantees (enforced in three layers)

**No autonomous action** — an analysis or suggestion can only be decided by a HUMAN: pure `evaluateReviewGate` →
services (non-null human actor) → DB `legal_ai_analysis_human_ck` / `legal_ai_suggestion_human_ck`. An **accept** of
a citations-required analysis needs a citation (`legal_ai_analysis_cite_ck`) and is refused unless M24 approved the
output. **Ethical wall** — privileged/work-product material requires `ai.privileged.read` (`evaluateEthicalWall`,
fail closed); every privileged access is audited (`AI_LEGAL_PRIVILEGED_READ`). **Fact vs inference** — a finding is
`extracted`/`inferred`, never a verified fact (`legal_ai_finding_factstatus_ck`). Config `require_human_review`
always on, `auto_apply` always off. Confidence is integer basis points (0..10000). Audit payloads carry safe ids,
subject type, status, classification, confidence, reason codes, timestamps and opaque references only — never legal
text, privileged narrative, prompt/output, document content, contacts, secrets or credentials.

## Boundary & contamination verdict

**Clean.** M26 owns only its 11 `legal_ai_*` tables; reads no m14/m09/m24 table; creates **no** duplicate shared
service (AI foundation, provider routing, DLP, workflow, notifications, audit, RBAC, outbox, vector and prompt
engines all consumed, never re-implemented); adds **no** second outbox and **no** new event family; performs **no**
court filing, settlement, enforcement, autonomous legal decision or matter mutation. Consumes m24 (gateway), m14 +
m09 (opaque refs). Did not modify M24, M14 or M09. Out of scope and untouched: Finance AI (m27), AI governance
(m29), M16/M17/M18, provider adapters, RAG/vector, m41. No external network, no production provider.

## Verification

- **Build:** green (whole solution). **Lint:** `npm run lint` — **0 errors** (68 baseline warnings; m26 adds none).
- **Format:** `npm run format:check` — clean.
- **Smoke lane:** 31 suites, **5609 assertions**, 0 failures (m26 smoke 71; conformance 3072 — validating the 6 new
  `ai.*` permissions, 14 `AI_LEGAL_` audit codes and count 719).
- **Migration replay:** `npm run migrate` — **50 applied** on a fresh database, in dependency order (m26 last);
  checksums/ordering enforced (no historical migration edit).
- **DB lane** (PostgreSQL 15.2 throwaway, non-owner app role via `SET ROLE`, `DATABASE_APP_ROLE=finapp_app`, fresh
  DB): **64 specs, 2029 assertions, 0 failures**, including **`m26-legal-ai` db-spec (33)** and **`m26-services`
  db-spec (24)**, and every `api-*` HTTP spec green.

### Live DB governance proven

11/11 tables RLS ENABLE+FORCE + `tenant_isolation`; cross-tenant reads return nothing; 0 DELETE grants; 0 UPDATE on
the 7 append-only ledgers; 0 float columns; `confidence_bps` integer; 0 secret columns; the no-autonomous-action
CHECKs, the citations-required CHECK, the fact-vs-inference CHECK, the privilege CHECK, config CHECKs; unique
idempotency ledger; composite FKs; single outbox (m06). End to end through the real M24 gateway: request a governed
analysis → citation-required accept (refused with 0 citations, then allowed → drives M24 output approval) →
advisory suggestion → human decide; ethical-wall denial + audited privileged access; DLP-blocked restricted
analysis fails closed; default deny; audit carries no secret or content; cross-tenant isolation holds.

## PostgreSQL 16 compatibility

All DDL is PG16-compatible (`gen_random_uuid()`, partial unique indexes, composite PK/FK, RLS FORCE,
`current_setting('app.tenant_id', true)` policies). Proven locally on PG 15.2 (the available throwaway); the
PostgreSQL 16 CI DB lane is authoritative.

## Known limitations

- **No HTTP API** — naming-map `api_prefixes: []`; M26 is an internal governed library consumed via the M24 gateway.
- **Deterministic generation** — the underlying AI generation is M24's deterministic double (ADR-105); no real
  model, no real DLP (m41), no production provider. Findings' labels are AI-sourced suggestions a human confirms.
- **mvp:false** — a non-MVP module sequenced next per BUILD_SEQUENCE; RAG/vector retrieval and precedent search are
  incremental follow-ups on the same tables and gateway.

## Remaining manual action
Merge the M26 implementation PR, then run post-merge M26 certification.
