# Stage 5 — M24 Enterprise AI Foundation — Certification (CERTIFIED ON BRANCH)

**Module:** `m24-ai-foundation` · **Verdict:** **CERTIFIED WITH DOCUMENTED LIMITATIONS (governed MVP)** · **Date:** 2026-08-05
**Certification branch:** `cert/stage-5-m24-ai-foundation` (cut from merged `main` `22c3e03`)

## Merge provenance (verified, not assumed)

| | |
| --- | --- |
| Implementation PR | **#56** — `state=closed`, `merged=true`, `merged_at=2026-08-05T08:21:20Z` |
| Reviewed head | `dfa84da05eb5d7ac65a39a91bca18d4ca8c4335e` |
| Squash merge onto main | `22c3e032c2092b5c754942bf4027dd933501e311` (1 parent `ab686cd` = main after governance PR #55) |
| Tree identical to reviewed head | **yes** — `git diff dfa84da 22c3e03` is empty (byte-identical) |
| CI on reviewed head `dfa84da` | Smoke lane **success** + DB lane **success** (PostgreSQL 16) |
| CI on main push `22c3e03` | Smoke lane **success** + DB lane **success** (PostgreSQL 16) |
| Contamination | **CLEAN** — merge scope `ab686cd..22c3e03` is M24-only |

## Gates re-executed on the certification branch (merged main)

- **Format:** `npm run format:check` — clean.
- **Lint:** `npm run lint` on a **wiped-dist** tree — **0 errors** (68 pre-existing baseline warnings; M24 adds none).
- **Build:** `npm run build` — green.
- **Smoke lane:** 29 suites, **5403 assertions, 0 failures** (m24 smoke 73; conformance 2994 validating the 23 `ai.*` permissions, 22 `AI_` audit codes, 3 event families).
- **Migrations:** `npm run migrate` — **46 applied** on a fresh database, in dependency order (m24 `0001`/`0002` last).
- **DB lane** (real PostgreSQL, non-owner app role via `SET ROLE`, `DATABASE_APP_ROLE=finapp_app`, fresh DB): **60 specs, 1923 assertions, 0 failures** — `m24-ai-foundation` (41) + `m24-services` (29) + every `api-*` spec green.

## Certification areas — live-DB evidence

Every number below is a direct query against the migrated certification database.

### Request / output lifecycle, DLP, routing, confidence, human review
- **17/17** `ai_*` tables have RLS **ENABLE + FORCE** and a `tenant_isolation` policy; cross-tenant reads return nothing.
- **DLP before routing** — `ai_request_dlp_ck` present: a request cannot reach `routed/generating/generated/review_pending/completed` unless `dlp_checked = true`. `ai_dlp_policy_block_ck` present: `block_restricted` can never be turned off.
- **Approved-provider routing** — `ai_request_approved_ck` present: restricted/confidential data cannot proceed without `provider_approved = true`; the pure `evaluateRouting` fails closed. Providers hold a `secretref:` pointer only (`ai_provider_secretref_ck`); **0** credential/secret value columns.
- **Confidence** — `confidence_bps` is an **integer** column; `ai_request_conf_ck` + `ai_output_conf_ck` bound it 0..10000. No binary float anywhere (**0** `real`/`double precision` columns across `ai_*`).
- **Human review requires review; no autonomous action** — enforced in three layers: pure `evaluateApprovalGate`, `ReviewService` (non-null human actor), and DB `ai_output_human_ck` (`status <> 'approved' OR reviewed_by IS NOT NULL`). `ai_config_review_ck` present: `require_human_review` can never be turned off. Proven end to end in `m24-services` (a request never completes autonomously; a human approval completes it).

### J. Output & citation certification
- Output schema/structure validated by `OutputValidator` before `review_pending`; an invalid output is `rejected` with a **machine-readable reason code** (`empty_output` / `output_generated`) — **fails closed**.
- **Citation-required outputs cannot be approved without a citation** — `ai_output_cite_ck` (`status <> 'approved' OR citations_required = false OR citation_count > 0`); the `m24-services` spec proves approval is refused with 0 citations and succeeds once one is recorded.
- Citations reference **M09 document refs** (`ai_citation.document_ref` opaque id + span) or approved evidence only; there is no free-text citation body that could fabricate a source. Citations live in an append-only ledger.

### K. Usage & cost certification
- `ai_usage` records **append-only** (INSERT+SELECT only; **0** UPDATE/DELETE grant): `prompt_tokens`, `completion_tokens`, `total_tokens` (all `integer`), `cost_minor` (**`bigint`**), `latency_ms` (`integer`), `request_id` (evidence ref), `by_user`, `correlation_id`, `created_at`. The **provider** and **model** are recorded on the parent `ai_request` (joinable); output references via `request_id`.
- **Exact arithmetic, no floating-point money** — cost = `Math.round(totalTokens * ratePer1kMinor / 1000)` in **integer minor units**; `ai_usage_cost_ck` (`cost_minor >= 0`); token CHECK (`>= 0`). **0** float columns.
- **No payment or accounting posting** — M24 owns no journal/ledger/posting table and executes no controlled action; usage is evidence only.
- *MVP scope (documented):* retry count, pricing-version and an explicit currency column are **not** separate columns in the MVP — generation is a single deterministic attempt, cost is carried in the tenant's base minor units, and pricing is the model's `rate_per_1k_minor` at record time. These are natural extensions when a real, priced provider adapter is approved (ADR-105).

### L. Permissions certification
- **23** `ai.*` permissions seeded in the global `permissions` table, **10** privileged (`provider.manage/approve`, `model.manage`, `prompt.manage/publish`, `config.manage`, `dlp.manage`, `output.review`, `governance.manage`, `platform.administer`).
- Every code is three-segment `ai.<entity>.<action>` (conformance-enforced); there is **no** vague `ai.admin` catch-all. Every mutating service call is `authz.require(...)` **default deny** (proven: a caller without `ai.provider.manage` / `ai.output.review` is refused).

### Tenancy, privacy, boundary
- **0** DELETE grants on any `ai_*` table; **0** UPDATE on the **10** append-only ledgers.
- Audit/event payloads carry ids/states/reason codes/confidence/opaque refs only — the `m24-services` spec asserts **no** secret reference or prompt/input content appears in any audit entry or published event; every event is `isAssistive: true`.
- **Single outbox** — the only `%outbox%` relation is m06 `workflow_event_outbox`; M24 owns none and publishes the 3 `ai.*_lifecycle` families through it. m41 (real DLP/security) is deferred behind `DlpPolicyEvaluator` (ADR-105). **Contamination: CLEAN.**

## PostgreSQL 16 compatibility

Authoritative evidence is the PostgreSQL 16 CI DB lane, **success** on both the reviewed head `dfa84da` and the main push `22c3e03`. Local re-verification used a PostgreSQL 15.2 throwaway (the available binary); all DDL is PG16-compatible.

## Verdict

**CERTIFIED ON BRANCH — CERTIFIED WITH DOCUMENTED LIMITATIONS.** The governed AI foundation meets every hard rule
(human-in-the-loop, confidence + citations, DLP, no restricted data to an unapproved provider) in the engine, the
services and the database. Documented limitations (all intentional MVP scope): deterministic provider/DLP doubles
only — no production adapter or real DLP (m41) — behind ports (ADR-105); HTTP `/api/v1/ai` controllers and RAG/vector
are incremental follow-ups (naming reserved); usage evidence omits retry-count/pricing-version/currency columns until
a priced adapter is approved. No untested integration is claimed production-ready.

## Remaining manual action
Merge the M24 certification PR, then begin governance verification for M25 AI Governance and Orchestration.
