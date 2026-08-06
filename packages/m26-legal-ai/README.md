# m26-legal-ai — Legal AI (Stage 5, GOVERNED, mvp:false)

Human-reviewed, **citation-backed** AI **assistance** for the legal domain (matters/cases from M14):
summaries, chronology, issue/obligation/deadline extraction, clause analysis, evidence-gap detection
and drafting assistance — every output a **SUGGESTION** with confidence + citations.

> **LEGAL-ADVISORY ONLY.** It never files, never reaches a legal conclusion, never settles or enforces,
> never creates a hearing/deadline/decision, and never mutates a matter. It never exposes
> privileged/work-product data to unauthorized users. A human legal reviewer decides; **M14 remains the
> legal source of truth.** (CLAUDE.md hard rules.)

|                  |                                                                    |
| ---------------- | ------------------------------------------------------------------ |
| Module code      | `m26-legal-ai`                                                    |
| Build stage      | 5 (`docs/07-engineering/BUILD_SEQUENCE.md`)                        |
| MVP              | false (non-MVP; sequenced next per BUILD_SEQUENCE)                 |
| Status           | `implemented` (`manifests/module-registry.yaml`)                  |
| Owned tables     | 11 (all FORCE-RLS, composite `(tenant_id, id)` keys)              |
| API / perms / audit / events | none / shares `ai.*` / shares `AI_` / none (reuses m24's) |

## What ships

- **Consumes M24 by contract.** The `AiGatewayPort` (`M24AiGateway`) wraps M24's `RequestService` +
  `ReviewService` — provider routing, DLP, approved-provider gating, confidence, citations and
  usage/cost all live in **M24** and are never duplicated or bypassed. M26 holds only OPAQUE m24
  request/output ids; it never selects providers, touches credentials, or writes M24 tables.
- **M14 / M09 by opaque reference.** Matters and documents are referenced by opaque uuid (M26 reads no
  m14/m09 table). A **citation** holds an M09 document reference + version/hash + bounded location
  (page/section/paragraph) + evidence classification — **never document content**.
- **Governed analysis lifecycle** (`LegalAiAnalysisService`): bind a subject (privilege + ethical
  wall) → request a governed analysis (M24 generates; lands in `review_pending`) → record
  extracted/inferred findings. An analysis is **never** auto-accepted.
- **Citations & evidence** (`LegalAiEvidenceService`): citation-backed outputs; a citation bumps the
  count the review gate checks.
- **Human legal review** (`LegalAiReviewService`): a human accepts/rejects/dismisses; an **accept** of
  a citations-required analysis needs a citation and is refused unless M24 approved the output; the
  ethical wall applies to privileged material.
- **Advisory suggestions** (`LegalAiSuggestionService`): from an accepted analysis; a human decides;
  M26 never acts on the matter.
- **No autonomous action, three layers**: pure `evaluateReviewGate` / `evaluateEthicalWall` → services
  → DB `legal_ai_analysis_human_ck` / `legal_ai_suggestion_human_ck` / `legal_ai_finding_factstatus_ck`
  (a finding is `extracted`/`inferred`, never a verified fact) / config CHECKs. Confidence is **integer
  basis points** (0..10000).
- **6 `ai.*` permissions** (`ai.legal.*` + `ai.privileged.read`; 4 privileged), **14 `AI_LEGAL_` audit
  codes** (shared `AI_` prefix). **No new API root, no new event family, no second outbox** — the AI
  lifecycle is emitted by M24 through the one m06 outbox.

## Tests

- `test/m26-legal-ai.smoke.ts` — PURE domain, ethical-wall + review gates, permissions, audit codes.
- `test/m26-legal-ai.db-spec.ts` — governance on real PostgreSQL: RLS FORCE, no-DELETE, append-only,
  no-float, no-secret, the human-review / citation / fact-vs-inference / config CHECKs, single outbox.
- `test/m26-services.db-spec.ts` — the governed pipeline end to end through the real M24 gateway:
  request → citation-required accept (refused then allowed) → advisory suggestion → human decide;
  ethical-wall denial + audited privileged access; DLP-blocked restricted analysis fails closed; default
  deny; AI_LEGAL_ audit carries no secret/content; cross-tenant isolation.

## Not in scope (boundaries)

Finance AI (m27), AI governance (m29), provider adapters, RAG/vector retrieval, m41; and any controlled
legal action — filing, settlement, enforcement, hearing/deadline/decision creation, matter mutation.
M26 recommends; a human decides and acts through M14.
