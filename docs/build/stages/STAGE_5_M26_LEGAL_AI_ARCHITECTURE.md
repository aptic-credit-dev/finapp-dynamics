# Stage 5 — M26 Legal AI — Architecture

**Module:** `m26-legal-ai` · **Capability:** Legal AI · **MVP:** false · **Spec:** `docs/05-ai/LEGAL_AI.md`

## Position

M26 is a **governed, internal** legal-AI layer that turns the M24 AI foundation into human-reviewed,
citation-backed **suggestions** over M14 legal matters. It is **legal-advisory only** — it never files,
concludes, settles, enforces or mutates a matter; M14 is the legal source of truth.

## Boundaries (naming-map authoritative)

- **API:** none (`api_prefixes: []`) — internal governed library, no HTTP controllers.
- **Permissions:** shares `ai.*` — 6 new `ai.legal.*` / `ai.privileged.read` codes (4 privileged).
- **Audit:** shares `AI_` — 14 `AI_LEGAL_*` codes.
- **Events:** none (`event_families: []`) — reuses M24's `ai.*_lifecycle`; owns no second outbox.

## Consumed shared services (by contract, never duplicated)

| Service | How consumed |
| --- | --- |
| **M24** AI foundation | `AiGatewayPort` (`M24AiGateway` wraps `RequestService`/`ReviewService`) — routing, DLP, provider approval, confidence, citations, usage/cost all in M24. Opaque request/output ids only. |
| **M14** legal matter | opaque `matter_ref` (uuid) — reads no m14 table; M14 stays the source of truth; M26 never mutates a matter. |
| **M09** documents | opaque `document_ref` (+ version/hash + bounded location) in citations — never document content. |
| **m02** RBAC, **m03** audit | `Authz.require` (default deny), `Audit.write` (AI_LEGAL_) in-transaction. |

## Owned tables (11)

`legal_ai_config`, `legal_ai_subject`, `legal_ai_analysis` (+ `_history`), `legal_ai_finding`,
`legal_ai_citation`, `legal_ai_suggestion` (+ `_history`), `legal_ai_review`, `legal_ai_evidence`,
`legal_ai_idempotency`. 4 mutable aggregates (version/optimistic-lock); 7 append-only ledgers.
All composite `(tenant_id, id)` PK + composite FKs (within m26), RLS ENABLE+FORCE + `tenant_isolation`,
no DELETE grant, no float, no secret column.

## Governance model

- **No autonomous action** (3 layers): `evaluateReviewGate` → services (human actor) → DB
  `legal_ai_analysis_human_ck` / `legal_ai_suggestion_human_ck`.
- **Ethical wall:** `privilege_classification` per subject; privileged/work-product require
  `ai.privileged.read` (`evaluateEthicalWall`, fail closed); every privileged access audited.
- **Citations:** required-citation analyses cannot be accepted without a citation
  (`legal_ai_analysis_cite_ck`); citations are M09 references, never content.
- **Fact vs inference:** findings are `extracted`/`inferred`, never a verified fact
  (`legal_ai_finding_factstatus_ck`).
- **Config:** `require_human_review` always on, `auto_apply` always off.

See ADR-107 (advisory/ethical-wall/fact-vs-inference) and ADR-108 (M24/M14/M09 by contract; citations
are pointers).
