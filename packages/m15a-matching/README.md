# m15a-matching — Matching engine (Stage 3)

The **PURE, deterministic, explainable** bank-reconciliation matching engine. It **owns ZERO tables** and performs
**no I/O**: given a bank statement line, a candidate ledger entry and a versioned ruleset it returns a reproducible
integer score, a confidence band, a colour status, the exact variances (money in **INTEGER MINOR UNITS**), the
reference/description comparison and machine-readable reason + rule codes. **Same inputs + same ruleset version ⇒
identical output** — no database, no ambient clock, no randomness, no float money. Consumed by `@finapp/m15-recon`,
which owns all the reconciliation tables; **AI suggestions (m27) are a separate, optional layer and are never
required** — reconciliation runs fully on this engine alone.

## What it is (and is not)

- **Zero tables, no I/O.** The engine reads no database, opens no connection and imports no module internals. It is
  a library of pure functions over plain data.
- **Deterministic + reproducible.** No `Date.now`, no randomness, no float. Date variance is computed from ISO
  `YYYY-MM-DD` dates by UTC midnight. The same statement line, ledger entry and ruleset version always yield the
  same `CandidateScore` — so a run's evidence is replayable and auditable (ADR-082).
- **Explainable.** Every score carries the exact amount variance (minor units), the whole-day date variance, the
  reference match (exact / partial / none), a description similarity ratio, direction compatibility and
  machine-readable `reasonCodes` + `ruleCodes`. `m15-recon` persists this as append-only candidate evidence.
- **Integer-minor-unit money.** `assertMinorUnits` rejects any non-integer / float value fail-closed;
  `amountVarianceMinor`, `sumMinor` and `balances` are exact integer arithmetic. Text-similarity ratios are in
  [0,1] and are **not** money (ADR-007/082).

## API

- **`scoreCandidate(statement, ledger, ruleset)`** → a `CandidateScore`: integer score 0..100, confidence band,
  colour status, amount variance (minor units), date variance (days), reference match, description ratio, direction
  compatibility, reason + rule codes. Rule kinds contribute integer weights: `exact_amount`, `exact_reference`,
  `date_window` (decays across the window), `similarity` (Jaccard token ratio) and `composite` (the weighted sum
  itself). A direction mismatch halves the score.
- **`confidenceOf(score, amountVariance, refMatch, directionCompatible)`** → band. `exact` is gated on a **zero
  amount-variance AND an exact reference AND a compatible direction AND score ≥ 100** — a high fuzzy score alone
  never certifies an exact match; then `strong` ≥ 80, `partial` ≥ 50, `review` ≥ 25, else `unmatched`.
- **`classifyMatchType(statementCount, ledgerCount)`** → `one_to_one` / `one_to_many` / `many_to_one` /
  `many_to_many` (split + grouped are recorded by `m15-recon` on the match).
- **`sumMinor(amounts)` / `balances(statementAmounts, ledgerAmounts)`** — certify a split/grouped match balances by
  **exact integer equality** of the two sides' minor-unit sums.
- **`bestCandidate(statement, ledgers, ruleset)`** — the highest-scoring candidate, ties broken deterministically by
  lowest amount variance, then lowest date variance, then lowest ledger id.

## Vocabulary

`RULE_KINDS` (exact_reference, exact_amount, date_window, similarity, composite), `CONFIDENCE_BANDS`
(exact, strong, partial, review, unmatched) mapped by `COLOUR_STATUS` to dark_green / light_green / amber / orange /
red (`escalated` is reserved for the workflow, not the engine), `MATCH_TYPES`, `DIRECTIONS` and `EXCEPTION_TYPES`,
each with a type guard. `m15-recon` re-exports this vocabulary so services and validators share one source.

## Reuse (no duplicate engines)

This package builds no shared platform service: it has no database, no outbox, no audit and no authorization — those
live in `m15-recon`, which persists the engine's output as append-only evidence and publishes
`reconciliation.lifecycle` through the single m06 outbox. The engine is imported as a plain library.

## Tests

`test/m15a-matching.smoke.ts` — scoring, confidence-band gating (incl. the exact-match gate), colour status,
match-type classification, split/grouped balancing by exact integer sums, deterministic tie-breaking and
integer-minor-unit rejection of float. Smoke: `npm run test:smoke`. Stage 3, ADR-081…082 — **implemented, not yet
certified**.
