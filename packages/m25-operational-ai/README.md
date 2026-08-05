# m25-operational-ai — Operational AI (Stage 5, GOVERNED MVP)

Human-reviewed AI **assistance** for Feedback (m12) and Case (m13): summaries, sentiment,
complaint/feedback classification, root-cause hints, suggested activities and routing/escalation
recommendations — every one a **SUGGESTION** with confidence + citations.

> **RECOMMENDS ONLY.** It never closes, escalates, reassigns or resolves a controlled feedback/case
> item on its own. A human decides, and a human acts through m12/m13's own controlled endpoints.
> (CLAUDE.md hard rules.)

|                  |                                                                    |
| ---------------- | ------------------------------------------------------------------ |
| Module code      | `m25-operational-ai`                                               |
| Build stage      | 5 (`docs/07-engineering/BUILD_SEQUENCE.md`)                        |
| MVP              | partial — feedback/case summaries + sentiment as human suggestions  |
| Status           | `implemented` (`manifests/module-registry.yaml`)                   |
| Owned tables     | 9 (all FORCE-RLS, composite `(tenant_id, id)` keys)                |
| API / perms / audit / events | none / shares `ai.*` / shares `AI_` / none (reuses m24's) |

## What ships

- **Consumes M24 by contract.** The `AiGatewayPort` (`M24AiGateway` adapter) wraps M24's
  `RequestService` + `ReviewService` — so **provider routing, DLP, approved-provider gating,
  confidence, citations and usage/cost all live in M24** and are never duplicated here. M25 holds only
  OPAQUE m24 request/output ids. No provider adapter, no network, no HTTP client, no SDK.
- **Governed analysis lifecycle** (`OperationalAiService`): bind a subject (opaque m12/m13 ref) →
  request a governed analysis (M24 generates; the analysis lands in `review_pending`) → a **human**
  accepts/rejects/dismisses. An accept drives the M24 output approval and is **refused unless M24
  approved** the output (fail closed). An analysis is **never** auto-accepted.
- **Recommends-only suggestions** (`SuggestionService`): from an accepted analysis, create a suggestion
  (activity/routing/escalation/reassignment); a **human** decides it. M25 records the decision and
  **never** applies it to m12/m13.
- **No autonomous action, three layers**: pure `evaluateDecisionGate` → services (non-null human
  actor) → DB `ops_ai_analysis_human_ck` / `ops_ai_suggestion_human_ck`. Config
  `require_human_review` is always on and `auto_apply` always off (CHECKs). Confidence is **integer
  basis points** (0..10000), preserved from M24.
- **9 tables**: `ops_ai_config`, `ops_ai_subject`, `ops_ai_analysis` (+ history),
  `ops_ai_suggestion` (+ history), `ops_ai_evidence`, `ops_ai_review`, `ops_ai_idempotency`. All
  FORCE-RLS, no DELETE, five append-only ledgers, no float, no secret column, opaque cross-module refs.
- **7 `ai.*` permissions** (shared m24 namespace; 3 privileged), **11 `AI_OPS_` audit codes** (shared
  `AI_` prefix). **No new API root, no new event family, no second outbox** (naming-map authoritative);
  the AI request/output lifecycle is emitted by M24 through the one m06 outbox.

## Tests

- `test/m25-operational-ai.smoke.ts` — PURE domain, decision gate, permissions, audit codes.
- `test/m25-operational-ai.db-spec.ts` — governance on real PostgreSQL: RLS FORCE, no-DELETE,
  append-only ledgers, no-float, no-secret, the human-decision + config CHECKs, single outbox.
- `test/m25-services.db-spec.ts` — the governed pipeline end to end through the real M24 gateway:
  request → human accept (drives M24 approval) → recommends-only suggestion → human decide; DLP-blocked
  restricted analysis fails closed; no autonomous action; default deny; AI_OPS_ audit carries no secret
  or content; cross-tenant isolation.

## Not in scope (boundaries)

Credit/Finance/Legal AI (m26/m27), AI governance (m29), provider adapters, RAG/vector retrieval, m41,
and any controlled business action — all explicitly out. M25 recommends; a human decides and acts.
