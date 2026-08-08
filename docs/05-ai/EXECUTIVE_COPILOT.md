# Executive Copilot (m28)

## Purpose
A governed executive assistant that summarises across feedback, cases, legal deadlines, and reconciliation for
MD/CEO/COO/CFO, with citations and drill-down to source records. 7 reference tables.

## Capabilities
Executive summaries; cross-domain briefings; KPI narration; risk surfacing — read-only, cited, human-verifiable.
Consumes reporting/analytics (m32) and the AI foundation (m24).

## Guardrails
Read-only. Never acts, approves, posts, or files. Only surfaces data the executive is authorized to see (RLS +
masking). Every briefing is audited and cites its sources.

## MVP
Executive summary panel over the MVP dashboards, human-reviewed.

## Implementation status (Stage 5, `feature/stage-5-m28-executive-ai`)

**Implemented (governed, mvp:partial).** See ADR-111, ADR-112 and
`docs/build/stages/STAGE_5_M28_EXECUTIVE_AI_*`.

- **7 tables** — `copilot_config/session/query/response` (mutable, versioned) + `copilot_citation/feedback/idempotency`
  (append-only). RLS FORCE + `tenant_isolation` on all 7; no DELETE grant; no float; no secret column. Governance is
  DB-enforced: `copilot_query.read_only` CHECK; config can never disable read-only/citations/export-review; a completed
  response must be cited (`copilot_response_cited_ck`); a persisted citation must reference something and be
  entitlement-granted.
- **Read-only** in five layers (intent/command gate, prompt-injection screen, service authz, no-mutation API, DB
  CHECK/grants). A mutating/controlled or jailbreak intent is durably `refused` with a reason code and no side effect.
- **Cited** — every substantive answer carries ≥1 entitlement-granted citation (reference only, never content; large
  content via M09 refs); otherwise `review_required`.
- **RLS-masked** — evidence visible only across the caller's tenant ∧ scope ∧ sensitivity ∧ required-entitlement
  intersection; masked evidence is dropped (never cited/counted).
- **M24** consumed BY CONTRACT via `CopilotAiGatewayPort` (opaque ids; DLP/routing/confidence live in M24; never
  auto-approves an M24 output). **M32 UNBUILT** → deferred behind read-only `ExecutiveAnalyticsPort` (fixture double +
  fail-closed unavailable port). No 2nd AI engine, no new event family, no 2nd outbox.
- **GAP-4 resolved** — `/api/v1/copilot` reuses the shared `ai.*` namespace with 7 `ai.copilot.*` codes (4 privileged);
  9 `AI_COPILOT_*` audit codes (shared `AI_` prefix).
