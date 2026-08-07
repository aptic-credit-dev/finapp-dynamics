# Stage 5 — M27 Finance AI — Certification (CERTIFIED ON BRANCH)

**Module:** `m27-finance-ai` · **Verdict:** **CERTIFIED WITH DOCUMENTED LIMITATIONS (governed, mvp:partial)** · **Date:** 2026-08-07
**Certification branch:** `cert/stage-5-m27-finance-ai` (cut from merged `main` `97795a2`)

## A. Implementation-merge provenance (verified, not assumed)

| | |
| --- | --- |
| Governance PR | **#64** — merged; governance merge SHA `ccce6d6` (main after approve) |
| Implementation PR | **#65** — `state=closed`, `merged=true`, `merged_at=2026-08-07T08:36:43Z`, base `main` |
| Original implementation tree | `e59d8d1` |
| Final reviewed head | `8c87583` (empty CI-retrigger commit; `git diff e59d8d1 8c87583` empty = byte-identical) |
| Implementation merge SHA | `97795a294733fec491207a75b6d7ccdd22cb161d` (1 parent `ccce6d6`) |
| Current origin/main | `97795a2` (contains the merge) |
| Tree equivalence | **EMPTY** — `git diff 8c87583 97795a2` and `git diff e59d8d1 97795a2` both empty (byte-identical) |
| CI on reviewed head `8c87583` | Smoke **success** + DB **success** (PostgreSQL 16) |
| CI on main push `97795a2` | Smoke **success** + DB **success** (PostgreSQL 16) |
| Contamination | **CLEAN** — merge scope `ccce6d6..97795a2` is M27-only |

*CI note: the M27 implementation was delayed by a transient repo-wide GitHub Actions execution stall (`2026-08-06 13:49Z–21:24Z`); once execution resumed, an empty retrigger commit (`8c87583`, byte-identical tree) produced a clean run — both required lanes green. No code changed to obtain the pass.*

## Certification gates re-executed on the cert branch (merged main)

- **Format:** `npm run format:check` — clean.
- **Lint:** `npm run lint` — **0 errors** (68 pre-existing baseline warnings; M27 adds none).
- **Build:** `npm run build` — green.
- **Smoke lane:** 32 suites, **5703 assertions, 0 failures** (m27 smoke **57**; conformance **3109** validating the 5 new `ai.*` permissions, 13 `AI_FINANCE_` audit codes and audit total 732).
- **Migration ordering/checksums + fresh replay:** `npm run migrate` — **52 applied** on a fresh database in dependency order (m27 last); no historical migration edit.
- **DB lane** (real PostgreSQL, non-owner app role via `SET ROLE`, `DATABASE_APP_ROLE=finapp_app`, fresh DB): **66 specs, 2086 assertions, 0 failures** — `m27-finance-ai` (**34**) + `m27-services` (**23**) + every `api-*` spec green.

## Live-DB evidence (direct queries) + area verdicts

Repository scope: module `m27-finance-ai`, capability **Finance AI (recon suggestions; NO auto-post)**, Stage 5,
**mvp:partial**; **no HTTP API** (`api_prefixes: []`); **shared** `ai.*` namespace; **shared** `AI_` audit prefix; **no
new event family** (reuses m24 `ai.*_lifecycle`); consumes M24 + M15/M15a + M20 by contract; hard rules `no_autopost`,
`explainable_matches`.

- **Tables & tenancy — PASS.** 12/12 `finance_ai_*` tables with RLS ENABLE + FORCE + `tenant_isolation`; composite
  `(tenant_id, id)` keys + composite FKs; **0** unsafe single-column tenant FKs; cross-tenant reads return nothing.
- **No-auto-post — PASS.** `finance_ai_config_autopost_ck` (`auto_post = false` always); config can never enable
  auto-post; no journal/posting/balance-mutation path exists; a suggestion has no "posted" state.
- **No-auto-match — PASS.** `finance_ai_config_automatch_ck` (`auto_match = false` always); M27 suggests candidates
  only — the M15a matching engine owns matches (proven in `m27-services`: a suggestion decision creates no match).
- **Human review — PASS** (three layers): pure `evaluateReviewGate` → services (non-null human actor) → DB
  `finance_ai_analysis_human_ck` / `finance_ai_suggestion_human_ck`; config `require_human_review` always on; an accept
  requires M24 output approval.
- **Explainability — PASS.** `finance_ai_suggestion_explain_ck` (an accepted explainability-required suggestion needs
  ≥1 matched feature); proven: accept refused with 0 features, allowed after a feature is recorded.
- **Money-safety — PASS.** **0** float columns; `amount_minor` is **bigint** minor units (carried as a string,
  ADR-007); `confidence_bps` is `integer`; no balance is mutated; a suggestion is never a confirmed accounting fact.
- **M24 boundary — PASS.** Consumed only via `AiGatewayPort` (opaque request/output ids); never selects providers,
  reads M24 tables, accesses secrets or bypasses DLP; duplicate handoff idempotent; a blocked M24 request leaves the
  analysis durably `failed`; deterministic doubles only; no production provider; no network.
- **M15/M15a boundary — PASS.** Opaque recon-run/line/exception refs; reads no m15 table; matching owned by M15a; M27
  cannot create a final match or close an exception.
- **M20 boundary — PASS.** Opaque GL-run/line refs; reads no m20 table; M27 cannot certify a balance or create a
  journal.
- **RLS/tenancy — PASS.** 0 DELETE grants; 0 UPDATE on the 8 append-only ledgers; 4 version columns (the 4 mutable
  aggregates); single m06 outbox (m27 owns none).
- **Privacy — PASS.** Audit/events carry safe ids/states/suggestion types/reason codes/confidence/opaque refs only —
  the `m27-services` spec asserts no secret or prompt/input/bank-statement content appears in any audit entry.
- **Idempotency / concurrency — PASS.** Unique idempotency ledger (no duplicate analysis / no duplicate M24 handoff);
  optimistic version CAS (stale rejected); single-winner completion/review.
- **Permissions — PASS.** 5 `ai.finance.*` codes (3 privileged), default deny, per-service authorization, no universal
  bypass. **Audit — PASS:** 13 `AI_FINANCE_*` codes, registry total **732**, unique + registered, in-transaction.
- **Contamination — CLEAN.** No M24/M15a/M20 duplication or table access; no m28/m29/m41; no production provider; no
  external network; no auto-match/exception-close/journal-post/balance-mutation; no new event family; no second outbox;
  no historical migration edit. M24/M15/M15a/M20 unmodified.

## Documented limitations (truthful, non-blocking)

No HTTP API (naming-map assigns none); deterministic generation via M24's test double (ADR-105); no production
model/provider; no production m41 DLP; no RAG/vector retrieval; richer anomaly/risk scoring is a follow-up;
`mvp:partial` (MVP = reconciliation match suggestions as human-confirmable hints).

## PostgreSQL 16 compatibility

Authoritative: the PostgreSQL 16 CI DB lane is **success** on both the reviewed head `8c87583` and the main push
`97795a2`. Local re-verification used a PostgreSQL 15.2 throwaway; all DDL (incl. bigint minor units) is PG16-compatible.

## Final verdict

**CERTIFIED ON BRANCH.**

## Remaining manual action
Merge the M27 certification PR, then begin governance verification for the next repository-approved Stage 5 module.
