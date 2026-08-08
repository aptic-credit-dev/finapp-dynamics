# Stage 5 — M28 Executive AI / Executive Copilot — Architecture

**Module:** `m28-executive-ai` · **Stage:** 5 · **MVP:** partial · **Branch:** `feature/stage-5-m28-executive-ai`
**Spec:** `docs/05-ai/EXECUTIVE_COPILOT.md` · **ADRs:** ADR-111, ADR-112

## 1. Purpose

A governed, **read-only** executive assistant for MD/CEO/COO/CFO. It answers executive questions and produces
**cited** cross-domain summaries — operational, finance, legal, feedback/case, KPI, trend, risk, exception and
portfolio — and surfaces only what the caller is already entitled to see (**RLS masking**). AI assists; a human decides.

## 2. Hard rules and where they live

| Hard rule | Enforcement layers |
|-----------|--------------------|
| **read_only** | pure command/intent gate (`evaluateReadOnlyGate`) → prompt-injection screen (`screenPromptInjection`) → service authorization (`ai.copilot.*`, default deny) → API (no business-mutation route) → DB (`copilot_query.read_only` CHECK; `copilot_config` read_only/citations/export-review CHECKs; **no grant on any business table**) |
| **cited** | pure citation gate (`evaluateCitationGate`) → service persists only entitlement-granted citations → DB (`copilot_response_cited_ck`: completed ⇒ citation_count>0; `copilot_citation_ref_ck`, `copilot_citation_granted_ck`) |
| **rls_masking** | pure entitlement model (`evaluateEntitlement`/`maskEvidence`: tenant ∧ scope ∧ sensitivity ∧ required-entitlement intersection) → read ports return entitlement metadata → masked evidence dropped (never cited/counted) → DB RLS FORCE + `tenant_isolation` |

## 3. Boundaries (consumed BY CONTRACT / deferred — never duplicated)

- **M24 AI foundation** via `CopilotAiGatewayPort` (`M24CopilotGateway` wraps M24 `RequestService`). Provider/DLP/routing/
  confidence/usage live in M24; M28 holds opaque M24 request/output ids only, never auto-approves an M24 output. No 2nd
  AI engine, no provider/network/secret.
- **M32 analytics (UNBUILT, Stage 6)** deferred behind read-only `ExecutiveAnalyticsPort` (deterministic fixture double +
  fail-closed `UnavailableAnalyticsPort` ⇒ `review_required`). M28 does **not** build m32.
- **Cross-domain reads** (finance/ops/legal/cases/docs) via read-only ports with deterministic doubles. No write method;
  no private-table access.
- **No new event family, no second outbox** — AI lifecycle emitted by M24 through the one m06 outbox. `event_families: []`.

## 4. Data model (7 tables)

Mutable aggregates (SELECT/INSERT/UPDATE, versioned): `copilot_config`, `copilot_session`, `copilot_query`,
`copilot_response`. Append-only ledgers (INSERT/SELECT): `copilot_citation`, `copilot_feedback`, `copilot_idempotency`.
Every tenant-scoped table: composite `(tenant_id, id)` PK + UNIQUE, RLS ENABLE+FORCE + `tenant_isolation`, composite FKs
within m28 only, no DELETE grant, no float, no secret column, confidence integer bps 0..10000, large content behind M09
refs. DB-enforced governance CHECKs: `copilot_query_readonly_ck`, `copilot_config_{readonly,citations,export_review}_ck`,
`copilot_response_cited_ck`, `copilot_citation_{ref,granted}_ck`.

## 5. Lifecycles (single choke point + optimistic concurrency + idempotency)

- **Query:** `received → authorized → masked → evidence_resolved → ai_requested → generated → validated → completed`,
  fail-closed `→ refused | failed`.
- **Response:** `draft → citation_validated → policy_validated → complete | review_required | rejected`.

## 6. GAP-4 resolution (permission namespace)

`/api/v1/copilot` had `permission_namespaces: []`. Resolved by **reusing the shared `ai.*` namespace** with 7 new
`ai.copilot.*` codes (ADR-111) — no new namespace, no admin bypass. Every route authorizes one code (default deny);
export/sensitive/configure/platform are privileged.

## 7. API surface

`/api/v1/copilot`: `POST/GET /sessions`, `POST/GET /queries`, `GET /queries/:id/response`, `GET /queries/:id/citations`,
`POST /queries/:id/export` (privileged), `POST /responses/:id/feedback`, `GET/POST /config`, `POST /config/:id/publish`,
`GET /capabilities`. Mutating routes carry `@Endpoint(permission, auditCode)`; reads authorize in-service. No business
mutation route exists.
