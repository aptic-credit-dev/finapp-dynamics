# @finapp/m28-executive-ai — Executive Copilot (Stage 5, governed, mvp:partial)

A **READ-ONLY, CITED, RLS-MASKED** executive assistant. It answers executive questions and produces cross-domain
summaries (operations, finance, legal, feedback, cases, KPIs, trends, risk, exceptions, portfolio) for MD/CEO/COO/CFO —
every substantive answer is **evidence-backed** (citations, human-verifiable) and **RLS-masked** (a caller only ever
receives data their tenant + row-level entitlements already permit). **AI assists; a human decides** (CLAUDE.md).

## Hard rules (`read_only`, `cited`, `rls_masking`)

- **Read-only.** The copilot **never** mutates a business record, approves, posts, disburses, reconciles, closes a case,
  files a matter, sends a notification, changes roles/rules/workflow or executes **any** controlled action. Enforced in
  **five layers**: the pure command/intent gate (`evaluateReadOnlyGate`), the pure prompt-injection screen
  (`screenPromptInjection`), the services (`ai.copilot.*` authorization, default deny), the API (no business-mutation
  route exists), and the database (`copilot_query.read_only` CHECK; config can never disable read-only; the app role has
  **no grant on any business table**). A refused query is durably `refused` with a machine-readable reason code and no
  side effect — the copilot may **suggest** what a human should consider, never execute it.
- **Cited.** A completed response must carry ≥1 citation (`copilot_response_cited_ck` — no uncited factual answer, no
  fabricated citation); otherwise it is `review_required`. Citations are **references** (opaque record/document ids,
  version/hash, location, retrieval time, confidence) — never copied restricted content (large content via M09 refs).
- **RLS-masked.** Evidence is visible only across the **intersection** of the caller's authority: same tenant, matching
  scope (platform ⇒ `ai.copilot.platform`), sensitivity gate (confidential/restricted ⇒ `ai.copilot.sensitive`) and
  every required entitlement. Masked evidence is dropped — never cited, never counted (no hidden-count leakage, no
  cross-tenant inference).

## What it owns

- **7 tables**: `copilot_config`, `copilot_session`, `copilot_query`, `copilot_response` (mutable aggregates) +
  `copilot_citation`, `copilot_feedback`, `copilot_idempotency` (append-only ledgers). Every tenant-scoped table has a
  composite `(tenant_id, id)` PK, RLS ENABLE+FORCE + `tenant_isolation`, composite FKs, and version columns; no DELETE
  grant; append-only ledgers are INSERT+SELECT only; no float; no secret column.
- **7 permissions** in the shared `ai.*` namespace (**GAP-4 resolution**, ADR-111): `ai.copilot.read/query/feedback`
  (unprivileged) + `ai.copilot.export/sensitive/configure/platform` (privileged).
- **9 audit codes** under the shared `AI_` prefix: `AI_COPILOT_*`.
- **REST API** under `/api/v1/copilot` (the first Stage-5 AI module with an HTTP surface): sessions, queries, responses,
  citations, feedback, config, capabilities. No business-mutation route.

## What it does NOT own (consumed BY CONTRACT / deferred)

- **M24 AI foundation** — consumed through `CopilotAiGatewayPort` (`M24CopilotGateway` wraps M24's `RequestService`).
  Provider selection, DLP, routing, confidence and usage all live in M24; M28 holds only opaque M24 request/output ids
  and never auto-approves an M24 output. No second AI engine, no provider/network/secret.
- **M32 analytics (UNBUILT, Stage 6)** — deferred behind the read-only `ExecutiveAnalyticsPort` with a deterministic
  fixture double and a fail-closed `UnavailableAnalyticsPort`. M28 does **not** implement m32.
- **Cross-domain reads** (finance/operations/legal/cases/documents) — through read-only ports with deterministic doubles
  (no network, no production provider). No port has a write method; none reads another module's private tables.
- **No new event family, no second outbox** — the AI request/output lifecycle is emitted by M24 through the one m06 outbox.

## Query / response lifecycle

```
query:    received → authorized → masked → evidence_resolved → ai_requested → generated → validated → completed
                                                                                          └→ refused | failed
response: draft → citation_validated → policy_validated → complete | review_required | rejected
```

All transitions run through a single choke point (`checkQueryTransition` / `checkResponseTransition`) with optimistic
concurrency (version) and idempotency (a replayed key returns the same query — no duplicate M24 handoff).

## Tests

- `test/m28-executive-ai.smoke.ts` — PURE: read-only/injection/citation/masking gates, lifecycles, permissions, audit codes.
- `test/m28-executive-ai.db-spec.ts` — schema/governance on real Postgres (RLS/FORCE, grants, CHECKs, isolation).
- `test/m28-services.db-spec.ts` — the end-to-end pipeline through M24 (cited answer, masking, refusals, DLP, idempotency, audit privacy).
- `apps/api/test/api-copilot.db-spec.ts` — the HTTP surface (401/403/404/409, idempotency, pagination, refusals, no mutation route).

See `docs/05-ai/EXECUTIVE_COPILOT.md` and ADR-111 / ADR-112.
