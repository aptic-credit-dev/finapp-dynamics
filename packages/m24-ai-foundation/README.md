# m24-ai-foundation — Enterprise AI Foundation (Stage 5, GOVERNED MVP)

The central, **provider-agnostic** AI gateway + model/prompt/DLP registries and a **governed AI
request → output lifecycle** with DLP, confidence, source citations, **mandatory human review**,
usage/cost metering and **approved-provider routing per data classification**.

> **AI ASSISTS ONLY.** It summarises, classifies and recommends with confidence + citations. It
> **never** approves, posts, files, reaches a conclusion or executes a controlled action, and it
> **never** routes restricted data to an unapproved provider. A human decides. (CLAUDE.md hard rules.)

|                  |                                                                    |
| ---------------- | ------------------------------------------------------------------ |
| Module code      | `m24-ai-foundation`                                                |
| Build stage      | 5 (`docs/07-engineering/BUILD_SEQUENCE.md`)                        |
| MVP              | partial — gateway + registries + governed summaries/classifications |
| Status           | `implemented` (`manifests/module-registry.yaml`)                   |
| Owned tables     | 17 (all FORCE-RLS, composite `(tenant_id, id)` keys + composite FKs) |
| API prefix       | `/api/v1/ai` · perms `ai.*` · audit `AI_` · 3 event families        |

## What ships

- **Provider abstraction (ports + DETERMINISTIC doubles only).** `AiProvider`, `PromptRenderer`,
  `DlpPolicyEvaluator`, `OutputValidator`, `CitationResolver`, `HumanReviewGateway`, `UsageMeter`,
  `CostCalculator`, `ProviderHealthPort`. **No production adapter, no provider secret, no network
  call, no vendor lock-in** (ADR-105). A provider holds a `secretref:` pointer only — zero credential
  columns. Real DLP (m41) and real models drop in behind these ports later.
- **Registries.** Versioned `ai_provider` (approved for data classifications), `ai_model`,
  `ai_prompt` (immutable-after-publish), `ai_dlp_policy` (`block_restricted` always on), `ai_config`
  (`require_human_review` always on) — one active per code/scope, `CatalogService`.
- **Governed request → output lifecycle (`RequestService`, `ReviewService`).**
  `received → dlp_checked → routed → generating → generated → review_pending → completed|rejected`.
  DLP must clear **before** routing; restricted/confidential data routes **only** to an approved
  provider (fail closed); deterministic generation records **usage + cost** (`bigint` minor units);
  the output lands in `review_pending` and a **human** approves it — the request is **never** completed
  autonomously.
- **No autonomous action, three layers (ADR-106).** pure `evaluateApprovalGate` → `ReviewService`
  (non-null human actor) → DB `ai_output_human_ck` / `ai_output_cite_ck`. Confidence is **integer
  basis points** (0..10000). Governance refusals (DLP block, unapproved routing) are **durably
  recorded** before the 403 (two-phase; a security event never disappears).
- **m09 for large content.** Inputs/outputs/evidence are opaque m09 document references — never inline.
- **One outbox.** Publishes `ai.request_lifecycle` / `ai.output_lifecycle` / `ai.governance_lifecycle`
  through the single m06 outbox; owns no second outbox. Reuses m02/m03/m06/m09 (m41 deferred behind
  the DLP port).

## Tests

- `test/m24-ai-foundation.smoke.ts` — PURE engine, ports/doubles, permissions, audit codes (67 assertions).
- `test/m24-ai-foundation.db-spec.ts` — governance on real PostgreSQL: RLS FORCE, no-DELETE,
  append-only ledgers, no-float, zero-secret-column, the six governance CHECKs, single outbox.
- `test/m24-services.db-spec.ts` — the governed pipeline end to end: register/approve provider →
  submit (idempotent) → process (DLP → routing → generate → usage/cost) → **human** review; DLP block
  and unapproved-routing fail closed and are durably rejected; default deny; audit/events carry no
  secret or content; cross-tenant isolation.

## Not in the MVP (incremental follow-ups)

- **HTTP `/api/v1/ai` controllers** — the governed service + DB layer is authoritative now; the REST
  surface is a follow-up (as M04 deferred its controllers). Naming is reserved.
- **RAG / vector retrieval** — deferred per the spec MVP; lands behind the same ports (ADR-106).
- **Real provider adapters + real DLP (m41)** — prohibited-until-approved behind the ports (ADR-105).
