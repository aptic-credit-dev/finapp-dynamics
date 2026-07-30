# Stage 3 — M15 Bank Reconciliation + Matching Engine — Completion Report

**Modules:** `m15-recon` + `m15a-matching` · **Packages:** `@finapp/m15-recon`, `@finapp/m15a-matching` ·
**Branch:** `feature/stage-3-m15-reconciliation-matching` · **Baseline:** governance-approved main
`f01f9cff73838c9347a90de9f95e71c8c739ec51` (PR #37). **Status:** implemented on branch; all local gates green,
**not merged** (approved for build via governance PR #37 — previously `documented`); the implementation PR +
post-merge certification are the next steps.

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified-pending** = to be observed green on the authoritative PostgreSQL 16 CI lane · **not yet
merged**.

## What was built

Bank reconciliation + a deterministic, explainable matching engine — one combined build unit. **`m15a-matching`
owns ZERO tables**: it is a PURE engine (no I/O, no ambient clock, no randomness, no float money) that scores a
bank statement line against a candidate ledger entry under a versioned ruleset, assigns a confidence band + colour
status, computes exact variances in INTEGER MINOR UNITS, and classifies match cardinality (1:1, 1:many, many:1,
split, grouped). **`m15-recon`** owns the reconciliation DATA + lifecycle and orchestrates the engine. It is
**not** a chart of accounts (m19), a GL-reconciliation engine (m20), a journal/posting engine (m21), an approval
workflow (m22) or a finance integration (m23); AI suggestions (m27) are an OPTIONAL, separable layer — deterministic
reconciliation works fully without them.

- **PURE matching engine** (`m15a-matching/src/`): rule kinds (exact reference/amount, date window, similarity,
  composite); a deterministic composite score (0–100); confidence bands `exact`/`strong`/`partial`/`review`/
  `unmatched` → colour `dark_green`/`light_green`/`amber`/`orange`/`red`; `exact` is a QUALITATIVE determination
  (zero amount variance + exact reference + compatible direction), never a fuzzy-score artifact; explainable reason
  codes; `balances`/`sumMinor` certify split/grouped matches to the minor unit. Money is integer minor units —
  `assertMinorUnits` rejects a float fail-closed (ADR-007/082).
- **Persistence** (`0001`/`0002`, **18 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs, **NO DELETE grant anywhere**): recon_bank_account, recon_matching_ruleset
  (versioned, one-active), recon_matching_rule, recon_ruleset_history (append-only), recon_statement_import
  (duplicate-protected by per-account file hash), recon_statement_line (bigint minor units), recon_ledger_import,
  recon_ledger_entry (bigint minor units), recon_run, recon_status_history (append-only), recon_match
  (idempotency-keyed), recon_match_line (append-only), recon_match_candidate (append-only engine evidence),
  recon_exception, recon_manual_decision (append-only override evidence), recon_run_summary (append-only),
  recon_note (append-only), recon_import_error (append-only). **8 append-only ledgers.**
- **Services** (`m15-recon/src/`): `CatalogService` (bank accounts + versioned rulesets/rules), `ImportService`
  (statement + ledger ingestion, duplicate protection, per-line validation → append-only import errors, integer
  minor units), `ReconciliationService` (run lifecycle + the matching orchestration via m15a: candidates +
  auto-proposed matches + exceptions; a run cannot complete with an open required exception), `MatchService`
  (confirm/reject/unmatch, manual + split/grouped match balancing, exception resolve/waive, notes). One
  `M15Emitter` writes audit (m03) + events on the **one outbox m06 owns**.
- **API** (`/api/v1/reconciliation`): bank accounts, rulesets/rules, statement + ledger imports, runs (create/
  run-matching/complete/reopen), candidates, matches (confirm/reject/unmatch), manual matches, exceptions
  (resolve/waive), notes, summaries, across four controllers. Every mutating route declares a permission + audit
  code; money fields are strings on the wire (never a float).

## Scope

| Fact | Value |
|---|---|
| Source added | `packages/m15a-matching` (PURE engine) + `packages/m15-recon` (domain, repository, emit, 4 services) + `apps/api/src/reconciliation` (views + 4 controllers + module) + registries/contracts/tests/docs |
| Migrations | **2** for m15 (`0001`, `0002`); m15a owns none; **34** total replayed |
| Tables created | **18** (m15-recon); **0** (m15a) |
| Permissions added | **29** (`reconciliation.*` three-segment; **11** privileged incl. match.unmatch / manual.match+group / ruleset.publish+manage / run.reopen / exception.waive / bank_account.manage+deactivate / analytics.export / platform) — seeded |
| Audit codes added | **28** (`RECON_*` SCREAMING_SNAKE); `registered_code_count` **520 → 548** |
| Events added | **ONE** family — `reconciliation.lifecycle` (**24** event types, version 1); contracts `DOMAIN_EVENT_FAMILIES` **16 → 17** |
| Services / controllers | **4** services (Catalog / Import / Reconciliation / Match) + the PURE m15a engine; **4** controllers |
| Routes | **20** mutating routes (each `@Endpoint` permission + audit code) + **22** read routes |
| Lifecycles | run (draft→matching→review→completed, reopened), match (proposed→confirmed/rejected→unmatched), ruleset (draft→active→superseded→retired, immutable-after-publish), exception (open→resolved/waived) |
| ADRs | ADR-081…084 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **18** tables; composite `(tenant_id,id)` keys + **19** composite FKs (0 single-column); asserted through the non-owner app role. |
| Authorization | Default-deny; every mutation `authz.require`s its three-segment `reconciliation.*` permission; over HTTP 401/403 fail-closed. **11** privileged permissions gate manual override / unmatch / waive / ruleset publish / run reopen / configuration; no vague `reconciliation.admin`. |
| Decimal-safe money | Money is INTEGER MINOR UNITS (bigint) — **0 finance columns use a binary float**; the engine's `assertMinorUnits` rejects a float fail-closed; variances/sums are integer; API fields are strings on the wire (ADR-007/082). |
| Deterministic + explainable matching | The m15a engine is reproducible from the same inputs + ruleset version; each candidate records score, confidence band, colour status, exact variances (minor units) and reason codes as append-only evidence; AI (m27) is optional/separable (ADR-082). |
| Manual override integrity | Manual review/override is APPEND-ONLY `recon_manual_decision` evidence that NEVER overwrites the engine's `recon_match_candidate` evidence; split/grouped matches must balance exactly in minor units (ADR-083). |
| Completion gate | A run cannot complete while a REQUIRED exception is open (fail closed) (ADR-083). |
| Duplicate-import protection | A second statement import with the same (bank_account, file_hash) is a clean conflict (DB unique index + service pre-check). |
| Versioning | Matching rulesets are versioned + immutable-after-publish (one active per code); a change is a new version via supersession. |
| Idempotency / concurrency | Statement/ledger imports idempotency-keyed; matches idempotency-keyed (`run:…:stmt:…`); mutable aggregates use single-winner optimistic-concurrency CAS (stale write → conflict). |
| Append-only evidence | The 8 ledgers INSERT+SELECT only (0 UPDATE grant); NO DELETE on any recon table. |
| Single outbox | m15 owns no outbox; publishes `reconciliation.lifecycle` through m06's outbox. |
| Data minimisation | Audit + event payloads carry ids, states, match types, confidence bands, scores, variances (minor units), reason codes and dates only — never full account numbers, raw statement narratives, counterparty PII or secrets (proven by a leak-scan). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean (**exit 0**). **Lint:** `eslint` **0 errors** (63 style warnings). **Format:**
  `prettier --check .` clean.
- **Smoke lane (tested locally):** **23 suites, 4407 assertions, 0 failed** — including `m15a-matching` (**43**,
  the PURE deterministic engine) and `conformance` (**2400**).
- **Migrations (tested locally):** **34** in dependency order, applied on a fresh PostgreSQL from an empty database.
- **DB + API lane (tested locally, real PostgreSQL 15.2):** **46 specs, 1494 assertions, 0 failed** —
  `m15-recon.db-spec` (**36** governance), `m15-services.db-spec` (**37** end-to-end), `api-reconciliation.db-spec`
  (**11** HTTP end-to-end), and the whole prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **CI-verified-pending**.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**.

## Live DB governance verified

18/18 recon tables RLS ENABLE+FORCE + `tenant_isolation` + composite `(tenant_id,id)` PK; **0 DELETE grants**;
the 8 append-only ledgers have **0 UPDATE grant**; **19** composite FKs (0 single-column); **0** float columns
(money is bigint minor units); **29** permissions seeded (**11** privileged); per-account statement file-hash
duplicate-protection index; one-active matching ruleset; match idempotency index; direction/match-type/
confidence-band/score/exception-type CHECKs; only `workflow_event_outbox` exists (**m15 owns no outbox**).

## Spec divergence (recorded)

The 18-table composition was fixed here (BANK_RECONCILIATION.md gives the capability list + count 18, not the exact
set) — ADR-081. Three audit codes were added for accuracy during the build (`RECON_RULESET_CREATED`,
`RECON_RULE_ADDED`, `RECON_NOTE_ADDED`) so creating a draft ruleset / adding a rule / adding a note are audited
under their own codes rather than under `RECON_RULESET_PUBLISHED`. The `exact` confidence band is a qualitative
determination (exact amount + reference + direction), not a perfect composite score, so a genuine exact match is
never demoted because a narrative differs. The scope decisions (18 tables; m15a as a separate zero-table PURE
engine; deterministic/explainable/integer-minor-unit matching; append-only override; the completion gate) are
captured in **ADR-081…084** and this report.

## Limitations (deferred, documented — not defects)

- No chart of accounts (m19), GL reconciliation (m20), journals/postings (m21), approval workflow (m22), finance
  integration (m23), payments, AR/AP, cash management, or AI models (m27).
- AI-assisted classification / match suggestions are the optional m27 layer; deterministic matching stands alone.
- Analytics export permissions are seeded for forward use; the MVP surface exposes reads + run summaries.

## Scope discipline (contamination)

Only `m15-recon` + `m15a-matching` (+ their API wiring, registries, contracts family, tests, docs) were built.
Every real SQL table reference is `recon_*`; m19/m09 are referenced by OPAQUE id. No chart-of-accounts / GL-recon /
journal / posting / approval / integration / payments / AR/AP / AI implementation; no historical migration edited;
no duplicated shared service; no second outbox. The manifest change is confined to the m15 block. The
implementation is on the branch; it is **not merged** — the PR + post-merge PostgreSQL 16 certification are next.
