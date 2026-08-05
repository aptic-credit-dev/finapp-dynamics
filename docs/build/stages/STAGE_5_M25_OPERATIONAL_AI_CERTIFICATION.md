# Stage 5 — M25 Operational AI — Certification (CERTIFIED ON BRANCH)

**Module:** `m25-operational-ai` · **Verdict:** **CERTIFIED WITH DOCUMENTED LIMITATIONS (governed MVP)** · **Date:** 2026-08-05
**Certification branch:** `cert/stage-5-m25-operational-ai` (cut from merged `main` `e7d29fa`)

## Merge provenance (verified, not assumed)

| | |
| --- | --- |
| Implementation PR | **#59** — `state=closed`, `merged=true`, `merged_at=2026-08-05T11:45:43Z` |
| Reviewed head | `37e753587359b2440af6287ec3146368545f38c0` |
| Squash merge onto main | `e7d29fa9a4165e5f502344b9e24b514259eb4b32` (1 parent `decd561` = main after governance PR #58) |
| Tree identical to reviewed head | **yes** — `git diff 37e7535 e7d29fa` is empty (byte-identical) |
| CI on reviewed head `37e7535` | Smoke lane **success** + DB lane **success** (PostgreSQL 16) |
| CI on main push `e7d29fa` | Smoke lane **success** + DB lane **success** (PostgreSQL 16) |
| Contamination | **CLEAN** — merge scope `decd561..e7d29fa` is M25-only |

## Gates re-executed on the certification branch (merged main, wiped-dist)

- **Format:** `npm run format:check` — clean.
- **Lint:** `npm run lint` on a wiped-dist tree — **0 errors** (68 pre-existing baseline warnings; M25 adds none).
- **Build:** `npm run build` — green.
- **Smoke lane:** 30 suites, **5497 assertions, 0 failures** (m25 smoke 57; conformance 3031 validating the 7 new `ai.*` permissions, 11 `AI_OPS_` audit codes and count 705).
- **Migration replay:** `npm run migrate` — **48 applied** on a fresh database, in dependency order (m25 last).
- **DB lane** (real PostgreSQL, non-owner app role via `SET ROLE`, `DATABASE_APP_ROLE=finapp_app`, fresh DB): **62 specs, 1972 assertions, 0 failures** — `m25-operational-ai` (29) + `m25-services` (20) + every `api-*` spec green.

## Certification areas — live-DB evidence

Every number below is a direct query against the migrated certification database.

- **Tables & tenancy:** 9/9 `ops_ai_*` tables with RLS **ENABLE + FORCE** and a `tenant_isolation` policy; cross-tenant reads return nothing.
- **No autonomous action (recommends only):** the governance CHECKs are all present — `ops_ai_analysis_human_ck` and `ops_ai_suggestion_human_ck` (a decided state requires a human reviewer), `ops_ai_config_review_ck` (`require_human_review` always on) and `ops_ai_config_autoapply_ck` (`auto_apply` always off). Enforced in three layers (pure `evaluateDecisionGate` + services + DB). An accept is refused unless M24 approved the output (proven in `m25-services`).
- **Append-only & no-delete:** 0 DELETE grants on any `ops_ai_*` table; 0 UPDATE on the 5 append-only ledgers.
- **Money/precision/secrets:** 0 float columns; `confidence_bps` is `integer` (preserved from M24); 0 secret/credential columns (opaque refs only).
- **Permissions:** 7 `ai.operational.*` / `ai.suggestion.*` codes seeded in the shared `ai.*` namespace (3 privileged).
- **Single outbox:** the only `%outbox%` relation is m06 `workflow_event_outbox`; M25 owns none and adds no event family.
- **Consumes M24 by contract:** the end-to-end `m25-services` spec runs the governed pipeline through the real M24 gateway (register/approve provider → governed analysis → human accept drives M24 output approval → recommends-only suggestion → human decide); a DLP-blocked restricted analysis fails closed; default deny; audit carries no secret or content.

## Report

| Field | Value |
| --- | --- |
| Implementation merge | `e7d29fa9a4165e5f502344b9e24b514259eb4b32` (PR #59) |
| Current main | `e7d29fa9a4165e5f502344b9e24b514259eb4b32` |
| Cert branch | `cert/stage-5-m25-operational-ai` |
| Cert head | (this docs-only commit) |
| Tables | 9 (4 mutable aggregates + 5 append-only ledgers) |
| Permissions | 7 `ai.*` (3 privileged), shared m24 namespace |
| Audit | 11 `AI_OPS_` codes, shared `AI_` prefix (count 705) |
| Events | none (reuses m24 `ai.*_lifecycle`); no second outbox |
| Tests | 3 (smoke + 2 DB specs) |
| Assertions | smoke 5497 (m25 57); DB 1972 (m25 49) |
| DB specs | `m25-operational-ai` 29, `m25-services` 20 |
| Boundary verdict | CLEAN — consumes m24/m12/m13 by contract; no duplicate engine; m24/m12/m13 unmodified |
| Contamination verdict | CLEAN — merge scope M25-only |
| CI | Smoke + DB (PostgreSQL 16) success on reviewed head and main push |

## PostgreSQL 16 compatibility

Authoritative evidence is the PostgreSQL 16 CI DB lane, **success** on both the reviewed head `37e7535` and the main push `e7d29fa`. Local re-verification used a PostgreSQL 15.2 throwaway; all DDL is PG16-compatible.

## Limitations (documented, intentional MVP scope)

- **No HTTP API** — naming-map `api_prefixes: []`; M25 is an internal governed library consumed via the M24 gateway.
- **Deterministic generation** — the underlying AI generation is M24's deterministic double (ADR-105); no real model or real DLP (m41).
- **Duplicate detection / similar-historical-cases / response-suggestions** are incremental follow-ups on the same tables and gateway (the spec MVP is feedback/case summaries + sentiment as human-reviewed suggestions).

## Verdict

**CERTIFIED ON BRANCH.**

## Remaining manual action
Merge the M25 certification PR, then begin governance verification for M26 Credit AI.
