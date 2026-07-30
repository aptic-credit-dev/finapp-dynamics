# Stage 3 — M15 Bank Reconciliation + Matching Engine — Implementation Plan

Grounded in the m07/m08/m09/m12–m18 + m19 pattern. Built on `feature/stage-3-m15-reconciliation-matching` from the
certified platform baseline (kernel + m01-tenant + m02-identity + m03-audit + m06-workflow + m07-rules +
m09-documents) plus the finance-domain root m19-finance; `m15-recon` + `m15a-matching` were `documented`. Counts
below are **exact** where the module is already built (18 tables, 8 append-only ledgers, 29 permissions / 11
privileged, 25 audit codes, 24 event types, m15a **zero tables**); the stage is **implemented, not yet certified**,
so no CI-green or test-count claim is made here.

## Sequence (planned)

1. **contracts** — one family `reconciliation.lifecycle` (**24 event types**, version 1, classification
   `confidential`); wired into the `DomainEvent` union + `DOMAIN_EVENT_FAMILIES`; contracts smoke bumped one
   family. Payloads carry ids, states, match types, confidence bands, scores, variances (minor units), reason codes
   and dates only — never account numbers, raw statement content, counterparty PII, secrets or a float
   (ADR-007/082).
2. **m15a-matching (PURE engine, zero tables)** — the governed vocabularies (`RULE_KINDS`, `CONFIDENCE_BANDS` +
   `COLOUR_STATUS`, `MATCH_TYPES`, `DIRECTIONS`, `EXCEPTION_TYPES`), integer-minor-unit helpers (`assertMinorUnits`,
   `amountVarianceMinor`, `dateVarianceDays`) and the engine (`scoreCandidate`, `confidenceOf`, `classifyMatchType`,
   `sumMinor` / `balances`, `bestCandidate`). Deterministic + explainable; no I/O, no ambient clock, no randomness,
   no float.
3. **package skeleton + catalogues** — `packages/m15-recon` (package.json, tsconfig, root + apps/api refs);
   **29** `reconciliation.*` permissions (granular, three-segment, no wildcard, no vague `reconciliation.admin`;
   **11** privileged — bank_account-manage / bank_account-deactivate / run-reopen / match-unmatch / ruleset-manage /
   ruleset-publish / exception-waive / manual-match / manual-group / analytics-export / platform-administer);
   **25** `RECON_` audit codes.
4. **PURE domain** — limits (`RECON_LIMITS`, fail-closed) + the import / line / decision / note / source
   vocabularies (the confidence + colour + match-type vocab re-exported from m15a so services + validators share one
   source); the four state machines through their single choke points — `checkRunTransition`,
   `checkMatchTransition`, `checkRulesetTransition` (immutable-after-publish via `isRulesetFrozen`) and
   `checkExceptionTransition`; `isRunOpen` / `isExceptionOpen`.
5. **clock port** — `Clock` (`SystemClock` + `FixedClock`) so aging + effective-dating are deterministic; no
   ambient `Date.now`, no bespoke timer engine. Canonical `contentHashOf` for the ruleset content hash + the
   statement/ledger file hash used for per-account duplicate protection.
6. **migrations** — `0001_reconciliation.sql` (**18 tables**, RLS ENABLE+FORCE, composite keys/FKs, a `version`
   column per mutable aggregate; the per-account file-hash duplicate-import unique index, the idempotency-key
   indexes on imports + matches, the one-active-per-code ruleset partial unique index, immutable-after-publish; the
   8 append-only ledgers; the `reconciliation.*` permission seed) and `0002_grant_application_role.sql` (**NO DELETE
   anywhere**; the 8 append-only ledgers INSERT+SELECT only).
7. **repository + emit + errors** — all SQL (optimistic-lock CAS on `version`, one-active-ruleset partial-unique
   enforcement, immutable-after-publish guards, file-hash + idempotency-key lookup, append-only inserts for
   candidate / manual-decision / match-line / history / summary / note / import-error); `M15Emitter` (audit m03 +
   m06 outbox in the business tx).
8. **services** — BankAccount + Ruleset (versioned, immutable-after-publish, supersession), Import (statement +
   ledger ingestion, duplicate-protected, validation errors), Run (create → start matching → review → complete →
   reopen — completion fails closed on unresolved required exceptions), Match (run the m15a engine → propose →
   confirm/reject/unmatch, manual match/group/split — override recorded as append-only evidence), Exception
   (resolve/waive), Analytics; index.
9. **API** — `apps/api/src/reconciliation` (views + controllers under `/api/v1/reconciliation` + the module binding
   the clock port; mutating endpoints + reads + explainable candidate evidence + analytics); wired into
   `AppModule`. No raw statement content, account numbers or float in any response.
10. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true` for
    `reconciliation.lifecycle`, `permission_namespace_registered: true` for `reconciliation.*`,
    `/api/v1/reconciliation`; manifest m15-recon + m15a-matching → implemented.
11. **tests** — m15a smoke (the PURE engine: scoring, bands, colour, match-type, split/grouped balancing,
    integer-minor-unit rejection of float), m15-recon smoke (the domain machines), db-spec (governance: RLS /
    grants / no-DELETE / append-only / one-active-ruleset / duplicate-import / idempotency / cross-tenant), services
    db-spec (end-to-end incl. the no-auto-complete-with-required-exceptions rule, manual-override append-only,
    optimistic concurrency), api-spec (HTTP).
12. **docs** — the two READMEs, architecture/readiness/plan, ADR-081…084.

## Reconciliation lifecycle machines

Four explicit machines, each a single choke point; callers fail closed on `!ok`:

- **reconciliation run** — `draft` → `matching`; `matching` → `review` / back to `draft`; `review` → `completed` /
  back to `matching`; `completed` → `reopened`; `reopened` → `matching`. `isRunOpen` is everything except
  `completed`. **A run cannot move to `completed` with unresolved required exceptions** — enforced in the service
  using this machine + the exception state. Transitions recorded in append-only `recon_status_history`.
- **match** — `proposed` → `confirmed` / `rejected`; `confirmed` → `unmatched`; `rejected` / `unmatched` terminal.
  Members recorded in append-only `recon_match_line`; the engine's reasoning in append-only `recon_match_candidate`.
- **matching ruleset** — `draft` → `active` → `superseded` → `retired` (`retired` terminal). A published (`active`
  or beyond) ruleset is **immutable** (`isRulesetFrozen`); one active version per code; a change is a NEW version
  via supersession. Transitions recorded in append-only `recon_ruleset_history`.
- **exception** — `open` → `resolved` / `waived` (both terminal). `isExceptionOpen` is `open` only; a `required`
  exception must be resolved or waived before its run can complete.

## Design choices

- **18 tables** owned by `m15-recon` (bank accounts; rulesets + rules with their history ledger; statement + ledger
  imports + lines; runs with their status-history ledger; matches with their member + candidate-evidence ledgers;
  exceptions; manual-decision, run-summary, note and import-error ledgers — justifies 18; the spec fixed only the
  count + capability list, the exact set is decided in ADR-081) and **zero tables** in `m15a-matching`.
- The matching **logic** is a **separate PURE package** (`m15a-matching`) — deterministic, explainable, no I/O — so
  it is independently unit-testable and reproducible, and `m15-recon` consumes it as a library (ADR-081).
- **Decimal-safe** — every monetary value is an integer minor-unit `bigint`; variances, tolerances, referenced
  balances and split/grouped sums are exact integer arithmetic; `assertMinorUnits` rejects float fail-closed; text
  ratios are kept distinct from money (ADR-007/082). No float anywhere.
- **Deterministic rules first, AI optional** — the deterministic engine produces every explainable, human-confirmable
  match; **AI suggestions (m27) are an optional, separable layer and are never required** (ADR-082).
- **Append-only evidence + no auto-complete** — manual override is append-only `recon_manual_decision` that never
  overwrites the engine's `recon_match_candidate` evidence; a run cannot auto-complete with unresolved required
  exceptions (ADR-083).
- **Strict boundary** — m15 owns bank reconciliation + matching only; no chart of accounts / GL reconciliation /
  journals / postings / approvals / integration / AI (m19 / m20 / m21 / m22 / m23 / m27); m19 + m09 are referenced
  by opaque id (no FK), and m15 reads no other module's tables (ADR-084). Real bank-feed / accounting-connector
  feeds are deferred behind existing ports.

## Verification

Every gate to be actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Exact counts
(29 permissions / 11 privileged, 25 audit codes, 24 event types, 18 tables, 8 append-only ledgers, 4 state
machines, m15a zero tables) are confirmed against the code; the stage is **implemented, not yet certified**.
