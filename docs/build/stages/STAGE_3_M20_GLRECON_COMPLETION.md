# Stage 3 — M20 GL Reconciliation — Completion Report

**Module:** `m20-glrecon` · **Package:** `@finapp/m20-glrecon` · **Branch:**
`feature/stage-3-m20-gl-reconciliation` · **Baseline:** governance-approved main
`6cf749bf4c798e4863d564693e04dfcdcacce2d5` (PR #40). **Status:** implemented on branch; all local gates green,
**not merged** (approved for build via governance PR #40 — previously `documented`); the implementation PR +
post-merge certification are the next steps.

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified-pending** = to be observed green on the authoritative PostgreSQL 16 CI lane · **not yet
merged**.

## What was built

General-ledger reconciliation — reconcile GL balances + transactions against a source system, enforce the balance
invariant, deterministically match GL lines against source records, manage reconciling items + exceptions, certify
balances, and produce DRAFT journal recommendations. **`m20-glrecon` REUSES the PURE `m15a-matching` engine** for
line scoring — it never duplicates the matching algorithm (ADR-087) — and adds only the genuinely-new GL **balance**
engine. It is **not** a chart of accounts (m19), bank reconciliation (m15), a journal/posting engine (m21), an
approval workflow (m22) or a finance integration (m23); AI suggestions (m27) are an OPTIONAL, separable layer.
**It NEVER posts a journal, writes to the general ledger, or approves anything.**

- **GL balance engine** (`m20-glrecon/src/engine.ts`): the single sign convention **calculated closing = opening +
  debits − credits** in INTEGER MINOR UNITS (`aggregateByDirection` / `calculatedClosingMinor` / `reconcileBalance`);
  exact integer variance vs the source closing + a stable reason code (`balance_exact` / `balance_within_tolerance`
  / `source_exceeds_gl` / `gl_exceeds_source`); `assertMinorUnits` rejects a float fail-closed (ADR-007/088). Line
  matching (score / confidence band / colour status / reason codes / split-balancing) is **re-exported from m15a**.
- **Persistence** (`0001`/`0002`, **24 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs, **NO DELETE grant anywhere**): gl_recon_account, gl_ruleset (versioned,
  one-active) + gl_rule + append-only gl_ruleset_history, gl_import (dup-protected by per-account file hash) +
  append-only gl_import_error, gl_balance (**invariant CHECK**), gl_line (bigint minor units), gl_source_import +
  gl_source_line (bigint minor units), gl_recon_run + append-only gl_run_status_history + append-only gl_run_balance
  (**invariant CHECK**), gl_match (idempotency-keyed) + append-only gl_match_line + append-only gl_match_candidate
  (engine evidence), gl_reconciling_item, gl_exception (open→under_review→resolved/waived) + append-only
  gl_manual_decision, gl_certification (**override CHECK**) + append-only gl_certification_history,
  gl_journal_recommendation (**is_draft CHECK**), and append-only gl_run_summary + gl_note. **Ten append-only
  ledgers.**
- **Services** (`m20-glrecon/src/`): `CatalogService` (GL accounts + versioned rulesets/rules), `ImportService`
  (GL + source ingestion, duplicate protection, per-line validation → append-only import errors, the import balance
  invariant, integer minor units), `ReconciliationService` (run lifecycle + the balance-invariant computation + the
  matching orchestration via m15a: candidates + auto-proposed matches + reconciling items + exceptions; a run cannot
  complete with an open required exception), `MatchService` (confirm/reject/unmatch, manual + grouped match
  balancing, exception assign/resolve/waive, reconciling items, notes), `CertificationService` (draft → certify with
  a privileged-override-with-reason gate → reject), `RecommendationService` (draft recommendations create / withdraw
  / hand off to m21). One `M20Emitter` writes audit (m03) + events on the **one outbox m06 owns**.
- **API** (`/api/v1/gl-reconciliation`): GL accounts, rulesets/rules, GL + source imports, runs
  (create/execute/complete/reopen), candidates + run balances, matches (confirm/reject/unmatch), manual matches,
  exceptions (assign/resolve/waive), reconciling items (raise/clear), certifications (create/certify/reject),
  recommendations (create/withdraw/handoff), notes — across six controllers. Every mutating route declares a
  permission + audit code; money fields are strings on the wire (never a float).

## Scope

| Fact | Value |
|---|---|
| Source added | `packages/m20-glrecon` (engine, domain, repository, emit, 6 services) + `apps/api/src/gl-reconciliation` (views + 6 controllers + module) + registries/contracts/tests/docs |
| Migrations | **2** for m20 (`0001`, `0002`); **36** total replayed |
| Tables created | **24** |
| Append-only ledgers | **10** |
| Money model | INTEGER MINOR UNITS (bigint); **0 float columns**; **26** bigint `*_minor` columns |
| Permissions added | **35** (`gl_reconciliation.*` three-segment; **11** privileged) — seeded |
| Audit codes added | **37** (`GLRECON_*` SCREAMING_SNAKE); `registered_code_count` **548 → 585** |
| Events added | **ONE** family — `glrecon.lifecycle` (**33** event types, version 1); contracts `DOMAIN_EVENT_FAMILIES` **17 → 18** |
| Services / controllers | **6** services + the REUSED m15a engine; **6** controllers |
| Routes | **30** mutating routes (each `@Endpoint` permission + audit code) + **31** read routes |
| Lifecycles | run (draft→running→review_required→completed/failed, reopened), match (proposed→confirmed/rejected→unmatched), ruleset (draft→active→superseded→retired), item (open→cleared/waived), exception (open→under_review→resolved/waived), certification (draft→certified/rejected) |
| ADRs | ADR-085…090 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **24** tables; composite `(tenant_id,id)` keys + **27** composite FKs (0 single-column); asserted through the non-owner app role. |
| Authorization | Default-deny; every mutation `authz.require`s its three-segment `gl_reconciliation.*` permission; over HTTP 401/403 fail-closed. **11** privileged permissions gate manual override / unmatch / waive / ruleset publish / run reopen / **certification override** / configuration; no vague `gl_reconciliation.admin`. |
| Decimal-safe money | Money is INTEGER MINOR UNITS (bigint) — **0 columns use a binary float**; the engine's `assertMinorUnits` rejects a float fail-closed; variances/sums/balances are integer; API fields are strings on the wire (ADR-007/088). |
| The balance invariant | **calculated closing = opening + debits − credits** — enforced in the engine AND by DB CHECKs on `gl_balance` and the append-only `gl_run_balance`; a bad closing cannot be imported or recorded (ADR-088). |
| Deterministic + explainable matching | The m15a engine is reproducible from the same inputs + ruleset version; each candidate records score, band, colour status, exact variances (minor units) and reason codes as append-only evidence; AI (m27) is optional/separable (ADR-082/087). |
| Manual override integrity | Manual review/override is APPEND-ONLY `gl_manual_decision` evidence that NEVER overwrites the engine's `gl_match_candidate` evidence; split/grouped matches must balance exactly in minor units (ADR-083). |
| Certification fail-closed | A balance with open required exceptions / open items cannot be certified without a PRIVILEGED override carrying a reason (permission + non-empty reason + DB CHECK); the override is a critical, reason-required audit event (ADR-089). |
| Completion gate | A run cannot complete while a REQUIRED exception is open (fail closed) (ADR-089). |
| Draft-only recommendations | `gl_journal_recommendation.is_draft` is always true (DB CHECK); m20 recommends + hands off to m21 but NEVER posts, writes to the GL, or approves (ADR-090, CLAUDE.md). |
| Duplicate-import protection | A second GL import with the same (gl_account, file_hash) is a clean conflict (DB unique index + service pre-check); source imports likewise. |
| Versioning | Matching rulesets are versioned + immutable-after-publish (one active per code); a change is a new version via supersession. |
| Idempotency / concurrency | GL/source imports idempotency-keyed; matches idempotency-keyed (`run:…:gl:…`); mutable aggregates use single-winner optimistic-concurrency CAS (stale write → conflict). |
| Append-only evidence | The 10 ledgers INSERT+SELECT only (0 UPDATE grant); NO DELETE on any gl_ table. |
| Single outbox | m20 owns no outbox; publishes `glrecon.lifecycle` through m06's outbox. |
| Reuse, no duplication | Line matching REUSES `@finapp/m15a-matching`; m20 adds only the GL balance engine (ADR-087). Authz (m02), audit (m03), workflow+outbox (m06), finance foundation (m19, opaque refs) reached through tokens/events only. |
| Data minimisation | Audit + event payloads carry ids, states, match types, confidence bands, scores, variances (minor units), balance variances, reason codes and dates only — never GL account numbers, raw source narratives, counterparty PII or secrets (proven by a leak-scan). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean (**exit 0**). **Lint:** `eslint` **0 errors** (64 style warnings). **Format:**
  `prettier --check .` clean.
- **Smoke lane (tested locally):** **24 suites, 4619 assertions, 0 failed** — including `m20-glrecon` (**54**, the
  PURE balance engine + determinism) and `conformance` (**2551**).
- **Migrations (tested locally):** **36** in dependency order, applied on a fresh PostgreSQL from an empty database.
- **DB + API lane (tested locally, real PostgreSQL 15.2):** **49 specs, 1587 assertions, 0 failed** —
  `m20-glrecon.db-spec` (**48** governance), `m20-services.db-spec` (**31** end-to-end), `api-gl-reconciliation.db-spec`
  (**14** HTTP end-to-end), and the whole prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **CI-verified-pending**.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**.

## Live DB governance verified

24/24 gl_ tables RLS ENABLE+FORCE + `tenant_isolation` + composite `(tenant_id,id)` PK; **0 DELETE grants**; the 10
append-only ledgers have **0 UPDATE grant**; **27** composite FKs (0 single-column); **0** float columns (money is
bigint minor units, 26 columns); **35** permissions seeded (**11** privileged); the **balance invariant CHECK**
rejects a wrong closing on both `gl_balance` and `gl_run_balance`; the **is_draft CHECK** rejects a non-draft
recommendation; the **override CHECK** rejects an override without a reason; per-account file-hash duplicate-import
protection; one-active ruleset; match idempotency index; direction/match-type/confidence-band/score/exception-type
CHECKs; only `workflow_event_outbox` exists (**m20 owns no outbox**).

## Spec divergence (recorded)

The 24-table composition was fixed here (GL_RECONCILIATION.md gives the capability list + count 24, not the exact
set) — ADR-085. The naming divergence (gl-reconciliation / gl_reconciliation / glrecon) was closed by introducing the
`glrecon.lifecycle` family, registering `/api/v1/gl-reconciliation` and the `gl_reconciliation.*` namespace, and the
`GLRECON_` audit prefix — ADR-086. Reuse of the m15a engine (no duplicated matching logic) — ADR-087. The
DB-enforced balance invariant — ADR-088. The privileged, reasoned certification override — ADR-089. Draft-only
journal recommendations — ADR-090.

## Limitations (deferred, documented — not defects)

- No chart of accounts (m19), bank reconciliation (m15), journals/postings (m21), approval workflow (m22), finance
  integration (m23), payments, AR/AP, cash management, or AI models (m27).
- Journal recommendations are DRAFT only; posting + approval are the downstream m21/m22 contract.
- AI-assisted classification / match suggestions are the optional m27 layer; deterministic reconciliation stands
  alone.
- Analytics export permissions are seeded for forward use; the MVP surface exposes reads + run summaries.

## Scope discipline (contamination)

Only `m20-glrecon` (+ its API wiring, registries, contracts family, tests, docs) was built. Every real SQL table
reference is `gl_*`; m19 is referenced by OPAQUE id. No chart-of-accounts / bank-recon / journal / posting / approval
/ integration / payments / AR/AP / AI implementation; no historical migration edited; no duplicated shared service
(line matching reuses m15a); no second outbox; m20 never posts a journal or approves. The manifest change is confined
to the m20 block + registries. The implementation is on the branch; it is **not merged** — the PR + post-merge
PostgreSQL 16 certification are next.
