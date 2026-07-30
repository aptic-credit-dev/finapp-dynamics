# Stage 3 — M15 Bank Reconciliation + Matching Engine — Architecture

**Modules:** `m15-recon` + `m15a-matching` · **Packages:** `@finapp/m15-recon` + `@finapp/m15a-matching` ·
**Branch:** `feature/stage-3-m15-reconciliation-matching` · **Baseline:** the certified platform baseline (kernel +
m01-tenant + m02-identity + m03-audit + m06-workflow + m07-rules + m09-documents) plus the finance-domain root
m19-finance. **ADRs:** ADR-081…084. (Both modules were previously `documented`; they are approved for build in
Stage 3 Finance as the reconciliation surface that the m19 foundation feeds.)

## Purpose & boundary

Bank reconciliation for high-volume statement-to-book matching, plus a **deterministic, explainable matching
engine**. `m15-recon` **owns all 18 tables** — the bank accounts, statement + ledger imports and lines,
reconciliation runs, matches + their members, engine candidate evidence, exceptions, manual decisions, run
summaries, notes and import errors — and the versioned matching **rulesets**. `m15a-matching` **owns ZERO tables**:
it is a PURE, deterministic, explainable engine (scoring, confidence bands, colour status, match-type
classification, split/grouped balancing) with no I/O, no ambient clock, no randomness and no float money, consumed
by `m15-recon`. Reconciliation runs on **deterministic rules first** (every match is explainable and
human-confirmable); **AI suggestions (m27) are an optional, separable layer — reconciliation works fully without
m27**. It is **not** a chart of accounts (M19 — referenced by opaque id), a GL reconciliation engine (M20), a
journal / journal-line / posting / ledger engine (M21), an approval-workflow engine (M22), a finance-integration
engine (M23) or a finance-AI tool (M27). Money is **INTEGER MINOR UNITS (bigint) — never float** (ADR-007,
CLAUDE.md): every variance, tolerance, balance reference and sum is an integer. It consumes shared services via
kernel tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and the m07 rules / m09 documents contracts, and owns no shared
service.

## Shape (mirrors m07/m08/m09/m12–m18 + m19)

- **PURE matching engine** (`@finapp/m15a-matching`, **zero tables**) — the deterministic, explainable choke point:
  `scoreCandidate` (a statement line vs a ledger entry under a versioned ruleset → an integer score 0..100, exact
  amount variance in minor units, whole-day date variance, reference match exact/partial/none, a Jaccard
  description ratio in [0,1] — a text ratio, **not** money — and machine-readable reason + rule codes),
  `confidenceOf` (score → band; `exact` is gated on zero amount-variance AND an exact reference AND a compatible
  direction — a high fuzzy score alone never certifies exact), `classifyMatchType`, `sumMinor` / `balances`
  (certify a split/grouped match balances by exact integer equality) and `bestCandidate` (deterministic
  tie-breaking: score, then amount variance, then date variance, then ledger id). The governed vocabularies
  (`RULE_KINDS`, `CONFIDENCE_BANDS` + `COLOUR_STATUS`, `MATCH_TYPES`, `DIRECTIONS`, `EXCEPTION_TYPES`),
  `assertMinorUnits` (rejects non-integer / float fail-closed) and integer variance helpers. Same inputs + same
  ruleset version ⇒ identical output. No I/O; exhaustively unit-tested.
- **PURE domain** (`m15-recon/src/domain/`) — the four reconciliation state machines, each a single choke point
  (callers fail closed on `!ok`): `checkRunTransition` (run: `draft` → `matching` ↔ `review` → `completed` →
  `reopened` → `matching`), `checkMatchTransition` (match: `proposed` → `confirmed`/`rejected`; `confirmed` →
  `unmatched`), `checkRulesetTransition` (ruleset: `draft` → `active` → `superseded` → `retired`,
  immutable-after-publish via `isRulesetFrozen`) and `checkExceptionTransition` (exception: `open` →
  `resolved`/`waived`). Hard limits (`RECON_LIMITS`) fail closed; the import / line / decision / note / source
  vocabularies; the confidence + colour + match-type vocab is re-exported from m15a so services and validators
  share one source. **A run cannot auto-complete with unresolved required exceptions** (enforced in the service
  using this machine + the exception state).
- **Integer-minor-unit money** (ADR-082) — statement + ledger amounts, variances, tolerances, referenced balances
  and split/grouped sums are `bigint` minor units end to end; `assertMinorUnits` rejects any non-integer. **No
  float, no decimal arithmetic on money, ever.** Text-similarity scores are ratios, kept distinct from money.
- **Clock port** (`ports.ts`) — a `Clock` (`SystemClock` / `FixedClock`) so aging and effective-dating are
  deterministic and replayable; no ambient `Date.now`. m15 builds no timer engine — dispatch/escalation delegates
  to m06/m08.
- **18 tables** (`migrations/0001_reconciliation.sql`) — `recon_bank_account` (multi-bank; `entity_ref` /
  `currency_ref` are **opaque m19 ids, no FK**); `recon_matching_ruleset` (versioned, immutable-after-publish, one
  active per code) + `recon_matching_rule` (kind + integer weight, consumed by the engine) + append-only
  `recon_ruleset_history`; `recon_statement_import` (**per-account file-hash duplicate-protected**, idempotency-keyed)
  + `recon_statement_line` (minor units); `recon_ledger_import` + `recon_ledger_entry` (minor units); `recon_run`
  (over a bank account + period, using a ruleset; balances are **references only**) + append-only
  `recon_status_history`; `recon_match` (1:1 / 1:many / many:1 / many:many / split / grouped; idempotency-keyed) +
  append-only `recon_match_line` (members) + append-only `recon_match_candidate` (**engine evidence** — score,
  variances, reason + rule codes; reproducible); `recon_exception` (type + aging + required flag) + append-only
  `recon_manual_decision` (**manual review/override evidence that never overwrites the engine's candidate
  evidence**); append-only `recon_run_summary`, `recon_note` and `recon_import_error`. All composite
  `(tenant_id, id)`, RLS ENABLE+FORCE + `tenant_isolation`, composite FKs, a `version` column on mutable
  aggregates; **no table grants DELETE** (`0002`, ADR-010); the **8 append-only ledgers** (ruleset / status
  history, match line, match candidate, manual decision, run summary, note, import error) are INSERT+SELECT only.
- **API** `/api/v1/reconciliation` — bank accounts; matching rulesets (draft → publish → supersede); statement +
  ledger imports (CSV/Excel/PDF/API/manual, duplicate-protected); reconciliation runs (create → start matching →
  review → complete → reopen); matches (run the engine → confirm/reject/unmatch, manual match/group/split);
  exceptions (resolve/waive); notes; plus reads, explainable candidate evidence and analytics. Every mutating route
  is an audited `@Endpoint` with a `reconciliation.*` permission enforced server-side (default deny).

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| The 18-table composition + the separate PURE engine | reconciliation is **18 FORCE-RLS tables owned by `m15-recon`** (bank accounts, rulesets + rules, statement/ledger imports + lines, runs, matches + members + candidate evidence, exceptions, manual decisions, run summaries, notes, import errors), with **8 append-only ledgers**; the matching **logic** is the **separate PURE `m15a-matching` package (ZERO tables)** — no I/O, deterministic, consumed by `m15-recon`; the spec gave only the capability list + the count (18), so the **exact set is fixed here** | 081 |
| Deterministic, explainable, reproducible matching | rule kinds (exact reference, exact amount, date window, similarity, composite) → an integer score → **confidence bands** exact/strong/partial/review/unmatched mapped to **colour status** dark_green/light_green/amber/orange/red (+ reserved `escalated`); money is **integer minor units, never float** (ADR-007); **AI suggestions (m27) are an optional, separable layer and are never required** | 082 |
| Split/grouped/1:many/many:1 + append-only override | matches span **1:1 / 1:many / many:1 / split / grouped**, split/grouped certified balanced by exact integer sums; **manual override is append-only evidence** (`recon_manual_decision`) that **never overwrites** the engine's `recon_match_candidate` evidence; a **run cannot auto-complete with unresolved required exceptions** | 083 |
| Strict reconciliation boundary | M15 owns **bank reconciliation + matching only** — no chart of accounts (m19), GL reconciliation (m20), journals/postings (m21), approvals (m22) or integration (m23); m19 + m09 are referenced by **opaque id** (no FK); **per-account file-hash** duplicate-import protection | 084 |

## Integration (reuse, no duplicate engines)

m02 authorization decides every `reconciliation.*` permission (default deny, three-segment codes, 11 privileged);
m03 audit records every controlled mutation through the kernel `AUDIT` port in the business tx (25 `RECON_` codes);
m06 workflow owns the **single transactional outbox** onto which m15 publishes `reconciliation.lifecycle` (m15 owns
no outbox); m07 rules and m09 documents are consumed through their contracts (a PDF import links an m09 document by
opaque ref). All through kernel DI tokens, events/contracts and ports — never by importing another module's
internals. **Upstream**, m15 reads the m19 finance foundation (accounting entity, currency) by **opaque id only** —
it holds no FK into m19 and reads none of its tables (ADR-084). The matching **logic** is the PURE `m15a-matching`
engine, imported as a library. The one family `reconciliation.lifecycle` (24 event types, version 1,
classification `confidential`) flows through the single m06 outbox; payloads carry identifiers, states, match
types, confidence bands, scores, variances (minor units), reason codes and dates only — never full bank account
numbers, raw statement content, counterparty PII or secrets, and never a float (ADR-007/082).
