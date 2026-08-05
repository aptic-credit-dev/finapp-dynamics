# Stage 5 — M24 Enterprise AI Foundation — Completion (GOVERNED MVP)

**Module:** `m24-ai-foundation` · **Branch:** `feature/stage-5-m24-ai-foundation` · **Date:** 2026-08-05
**Capability:** Enterprise AI Foundation — provider-agnostic AI gateway + registries + a governed AI request → output
lifecycle (governed summaries/classifications, human-reviewed). Governance PR #55 approved the build.

## What shipped

The **GOVERNED** enterprise-AI layer (Stage 5 MVP). AI **assists only** — it summarises, classifies and recommends
with confidence + citations; it **never** approves, posts, files, reaches a conclusion or executes a controlled
action, and **never** routes restricted data to an unapproved provider. A human decides.

- **17 FORCE-RLS tables** (7 mutable aggregates + 10 append-only ledgers); composite `(tenant_id, id)` keys +
  composite FKs; no DELETE grant. Migrations `0001_ai_foundation.sql`, `0002_grant_application_role.sql`.
- **Pure domain** (`domain.ts`): data classifications, request + output state machines, reason codes, integer
  basis-points confidence, the approved-provider **routing** decision (`evaluateRouting`, fail closed) and the
  human-approval **gate** (`evaluateApprovalGate`, fail closed), secret-reference pattern.
- **Provider abstraction (ports + DETERMINISTIC doubles ONLY, ADR-105)** (`ports.ts`): `AiProvider`,
  `PromptRenderer`, `DlpPolicyEvaluator`, `OutputValidator`, `CitationResolver`, `HumanReviewGateway`, `UsageMeter`,
  `CostCalculator`, `ProviderHealthPort`. **No production adapter, no provider secret, no network call, no lock-in.**
  A provider holds a `secretref:` pointer only. Real DLP (m41) and real models drop in behind the ports later.
- **Three services**: `CatalogService` (versioned provider/model/prompt/DLP-policy/config registries),
  `RequestService` (submit idempotent → process: DLP → approved-provider routing → deterministic generation →
  usage/cost → draft output in `review_pending`), `ReviewService` (the HUMAN approval gate + citations).
- **23 `ai.*` permissions** (three-segment, 10 privileged), **22 `AI_` audit codes**, **3 event families**
  (`ai.request_lifecycle` / `ai.output_lifecycle` / `ai.governance_lifecycle`) — all registered; conformance green.
- **One outbox**: publishes through the single m06 outbox; owns no second outbox. Reuses m02/m03/m06/m09.
- **ADR-105, ADR-106** recorded; module README rewritten; this completion doc; manifest + registries synchronised.

### The governance guarantees (enforced in three layers)

**No autonomous action** — an AI output can only be `approved` by a HUMAN: (1) the pure `evaluateApprovalGate`
(a human reviewer + required citations, fails closed), (2) `ReviewService` (non-null human actor), and (3) the DB
`ai_output_human_ck` (`status <> 'approved' OR reviewed_by IS NOT NULL`) + `ai_output_cite_ck`. A request cannot
route/generate before **DLP clears** (`ai_request_dlp_ck`); **restricted/confidential** data cannot proceed without
an **approved-provider** binding (`ai_request_approved_ck` + `evaluateRouting`). Human review and DLP `block_restricted`
can never be turned off (`ai_config_review_ck`, `ai_dlp_policy_block_ck`). Confidence is integer basis points
(0..10000, never a float); cost is `bigint` minor units (ADR-007). **Governance refusals are DURABLE** (ADR-106):
a DLP block / unapproved-routing refusal **commits** the request's `rejected` status + its DLP finding / audit /
governance event **before** the 403 is raised (two-phase — a security event never disappears). Large inputs/outputs/
evidence are m09 document references; audit/event payloads carry ids/states/reason codes/confidence/opaque refs only
— never prompt/output content, secrets or restricted data.

## Boundary & contamination verdict

**Clean.** M24 owns only its 17 `ai_*` tables and reads no other module's tables; it creates **no** duplicate shared
service (DLP is a port m41 fills; provider/model/prompt registries are M24's own governed config, not a second
identity/rules engine); it adds **no** second outbox and **no** controlled-action execution. It consumes m02
(auth/RBAC), m03 (audit), m06 (workflow + the one outbox) and m09 (documents) through their contracts; m41 is
deferred behind `DlpPolicyEvaluator` (ADR-105), exactly as M23 deferred m33. Naming reserved and honoured:
`/api/v1/ai`, `ai.*`, `AI_`, and the three `ai.*_lifecycle` families.

## Verification

- **Build:** `npm run build` — green (whole solution).
- **Lint:** `npm run lint` — **0 errors** (style warnings only, the repo baseline).
- **Smoke lane:** 29 suites, **5403 assertions**, 0 failures (m24 smoke **73**, conformance 2994 — validating the
  23 `ai.*` permissions, 22 `AI_` audit codes and 3 event families).
- **DB lane (PostgreSQL 15.2 throwaway, non-owner app role via `SET ROLE`, fresh DB, `DATABASE_APP_ROLE=finapp_app`):**
  **60 specs, 1923 assertions, 0 failures**, including **`m24-ai-foundation` db-spec (41)** and **`m24-services`
  db-spec (29)**, and every `api-*` HTTP spec green.

### Live DB governance proven

17/17 tables RLS ENABLE+FORCE + `tenant_isolation`; cross-tenant reads return nothing; 0 DELETE grants; 0 UPDATE on
the 10 append-only ledgers; 0 float columns; `cost_minor` is `bigint`, `confidence_bps` is `integer`; **0
credential/secret value columns** (only the `secret_reference` pointer); the secret-reference CHECK rejects an inline
secret; the no-autonomous-approval CHECK; the citations-required CHECK; DLP-before-routing + approved-provider CHECKs;
human-review and DLP-block cannot be disabled; unique idempotency ledger; composite FKs; single outbox (m06) — m24
owns none. End to end: register/approve a provider (secret reference only) → submit (idempotent) → process (DLP →
routing → generate → usage/cost) → **human** approves → request completes; DLP block and unapproved-routing fail
closed and are **durably rejected**; default deny; audit/events carry no secret or prompt/input content; cross-tenant
isolation holds.

## PostgreSQL 16 compatibility

All DDL is PG16-compatible (`gen_random_uuid()`, partial unique indexes, `text[]`, composite PK/FK, RLS FORCE,
`current_setting('app.tenant_id', true)` policies). Proven locally on PG 15.2 (the available throwaway); the
PostgreSQL 16 CI DB lane is authoritative.

## Known limitations / not in the MVP

- **HTTP `/api/v1/ai` controllers** are an incremental follow-up (as M04 deferred its controllers) — the governed
  service + DB layer is authoritative now; the naming is reserved. No `AiModule` is wired into `apps/api` yet.
- **RAG / vector retrieval** is deferred per the spec MVP (the capability line names it); it lands behind the same
  ports in a later increment (ADR-106).
- **Real provider adapters + real DLP (m41)** are prohibited-until-approved behind the ports (ADR-105); the MVP ships
  deterministic offline doubles only. Framework-status honesty preserved — no untested integration is claimed.
- Local HTTP RLS is exercised via `SET ROLE` to the non-owner app role; PostgreSQL 16 CI is authoritative.

## Remaining manual action
Merge the M24 implementation PR, then run post-merge M24 certification.
