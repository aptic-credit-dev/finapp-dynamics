# Stage 3 — M15 Bank Reconciliation + Matching Engine — Readiness

**Verdict: GO** (built on the certified platform baseline plus the merged finance-domain root m19-finance; all
shared-service dependencies are on main; `m15-recon` + `m15a-matching` were `documented` and are the Stage 3
reconciliation surface that consumes the m19 foundation).

## Dependencies available

- **kernel** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02-identity** — real RBAC (`RbacAuthz`) + the `permissions` catalogue m15 seeds `reconciliation.*` into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port); the `RECON_` prefix is m15's own (no collision). ✅
- **m06-workflow** — owns the single outbox; m15 publishes `reconciliation.lifecycle` through it and creates no
  second outbox. ✅
- **m07-rules** — the shared rules engine, consumed through its contract for configurable matching policy. ✅
- **m09-documents** — a PDF statement import links an m09 document by **opaque ref** (no FK). ✅
- **m19-finance** — the finance foundation (accounting entity, currency) referenced by **opaque id only**. ✅
- **m15a-matching** — the PURE, deterministic matching engine (zero tables), imported as a library. ✅
- Test harness, migrate tool (m15-recon in `module-order`), conformance. ✅

## The matching-engine boundary (PURE, zero tables)

`m15a-matching` is a **PURE, deterministic, explainable** engine: it **owns ZERO tables** and performs no I/O. It
scores a statement line against a candidate ledger entry under a **versioned ruleset**, returning an integer score,
a confidence band, a colour status, the exact variances (money in **integer minor units**), the
reference/description comparison and machine-readable reason + rule codes. **Same inputs + same ruleset version ⇒
identical output** — no ambient clock, no randomness, no float. `m15-recon` owns all **18 tables** and consumes the
engine as a library; the engine reads no database and imports no module internals. This keeps the matching logic
independently unit-testable and reproducible, and its evidence auditable (ADR-081/082).

## The decimal-safe boundary (integer minor units)

Every monetary value in reconciliation is an **INTEGER minor-unit `bigint`** — statement + ledger amounts, amount
variances, ruleset tolerances, referenced opening/closing balances, match variances and split/grouped sums.
`assertMinorUnits` rejects any non-integer / float fail-closed; `amountVarianceMinor`, `sumMinor` and `balances`
are exact integer arithmetic. A split/grouped match is certified balanced only when the two sides' minor-unit sums
are **exactly equal**. **No float, no decimal arithmetic on money, anywhere** (CLAUDE.md money rule, ADR-007/082).
Text-similarity ratios are in [0,1] and are kept explicitly distinct from money. No event or audit payload carries
a float; amounts in payloads are minor-unit strings.

## Determinism, explainability & reproducibility

Deterministic **rules run first** and every proposed match is **explainable and human-confirmable**: the engine
records the score, the exact amount + date variances, the reference match, a description ratio, direction
compatibility and machine-readable reason + rule codes as append-only `recon_match_candidate` evidence, tagged with
the **ruleset id + version** so a run is reproducible. Confidence bands map exact/strong/partial/review/unmatched →
colour dark_green/light_green/amber/orange/red (+ a reserved `escalated` tone owned by the workflow, not the
engine). The `exact` band is gated on a **zero amount-variance AND an exact reference AND a compatible direction** —
a high fuzzy score alone never certifies an exact match. **AI suggestions (m27) are an optional, separable layer:
reconciliation is fully functional with the deterministic engine alone** (ADR-082).

## Manual override & the no-auto-complete rule

Manual review/override — manual match, unmatch, tick, group, split, waive, reopen — is recorded as **append-only
`recon_manual_decision` evidence that never overwrites** the engine's `recon_match_candidate` evidence: both the
machine's proposal and the human's decision are preserved for audit. Manual override, unmatch, ruleset publish/
manage, run reopen, exception waive, manual match/group and analytics export are **privileged** actions. A **run
cannot auto-complete with unresolved required exceptions** — the completion service checks the exception state and
fails closed until every required exception is resolved or explicitly waived (ADR-083).

## Versioning, idempotency & concurrency

A matching **ruleset is versioned and immutable-after-publish**: a published (`active` or beyond) ruleset is frozen
(`isRulesetFrozen`), there is **one active version per code** (a partial unique index on `status = 'active'`), and a
change is a **new version via supersession** (`version_number` + `supersedes_id` / `superseded_by_id`). Statement +
ledger imports are **duplicate-protected by a per-account file-hash unique index** and idempotency-keyed; matches
are idempotency-keyed. Every mutable aggregate carries a `version` column for **optimistic concurrency** (CAS on
`WHERE version = $expected`).

## Integration seams

- **authorization (m02)** — every endpoint enforces its three-segment `reconciliation.*` permission (default deny).
- **audit (m03)** — every controlled mutation writes a `RECON_` code through the kernel `AUDIT` port in the
  business tx.
- **workflow / outbox (m06)** — `reconciliation.lifecycle` flows through the single outbox m06 owns; no second
  outbox.
- **rules (m07) / documents (m09) / finance (m19)** — consumed through contracts / opaque ids; no FK, no table
  reads.

## Security & isolation boundaries

- Tenant isolation: RLS ENABLE+FORCE + a `tenant_isolation` policy on **all 18 tables**, composite `(tenant_id, id)`
  keys and composite FKs; the application role is NOLOGIN/NOBYPASSRLS and is granted **no DELETE** anywhere
  (archive-by-status / status transitions / supersede instead, ADR-010); the **8 append-only ledgers** are
  INSERT+SELECT only.
- Default-deny authorization: **29** `reconciliation.*` permissions, seeded — **11** privileged (bank_account-manage
  / bank_account-deactivate / run-reopen / match-unmatch / ruleset-manage / ruleset-publish / exception-waive /
  manual-match / manual-group / analytics-export / platform-administer); **no wildcard, no vague
  `reconciliation.admin`**.
- Event/audit payloads carry ids, states, match types, confidence bands, scores, variances (minor units), reason
  codes and dates **only** — never full bank account numbers, raw statement content, counterparty PII, secrets or a
  float (ADR-007/082).

## Determinism & port abstraction

Aging and effective-dating run through an injected `Clock` port — no ambient `Date.now`; the same inputs always
yield the same result, proven with a `FixedClock`. The engine itself computes date variance from ISO dates by UTC
midnight, with no clock at all. m15 builds **no timer engine** — where scheduled dispatch/escalation is needed it
delegates to m06/m08.

## Assumptions

- No production bank-feed or GL-pull connector is configured → statement + ledger data is imported
  (CSV/Excel/PDF/API/manual) behind existing permissions; a real bank-feed / accounting-connector is deferred
  behind ports, no secrets.
- The chart of accounts, currencies and accounting periods are owned by m19 → m15 references them by opaque id and
  reads none of m19's tables; posting of any journal recommendation is owned downstream (m21), draft-only.
- AI-assisted classification / match suggestion (m27) is optional → the deterministic engine stands alone and is
  the certified path.

## Exclusions (verified out of scope, Framework-Only where deferred)

No chart of accounts (M19); no GL reconciliation (M20); no journals / journal lines / postings / ledger-posting
engine (M21); no approval workflow (M22); no finance integration / external accounting connector / bank feed (M23);
**no AI models** (M27 — optional, separate); no auto-posting of any journal (recommendations flow to draft-only
journals downstream). Those surfaces are referenced by boundary only.

## Implementation gates

format · lint (wiped dist) · build · smoke (the PURE engine + the domain machines) · conformance · migrations
(dry-run + fresh replay) · DB specs · API specs · RLS · grants/no-DELETE · append-only (8 ledgers) · permissions ·
audit · events · outbox · one-active-ruleset · immutable-after-publish · idempotency (import file-hash + match) ·
per-account duplicate-import protection · concurrency (optimistic CAS) · no-auto-complete-with-required-exceptions ·
decimal-safe (integer minor units, no float) · determinism/reproducibility (same inputs + ruleset ⇒ same output) ·
manual-override-append-only · security negatives · isolation/cross-tenant · contamination. PostgreSQL 16 CI is
authoritative.

## Deferred provider integrations

A real bank-statement feed and a GL / accounting-connector pull (behind existing ports/permissions, no secrets),
and the optional m27 AI classification / match-suggestion layer — all reached through contracts + the
reconciliation API, never by another module reading m15's tables, and the deterministic engine remains the
certified baseline.
