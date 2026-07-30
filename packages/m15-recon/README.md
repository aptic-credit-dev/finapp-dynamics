# m15-recon — Bank reconciliation (Stage 3)

Bank reconciliation for high-volume statement-to-book matching. It owns **multi-bank accounts**, versioned
**matching rulesets**, **statement + ledger imports** (CSV/Excel/PDF/API/manual, per-account duplicate-protected)
and their **lines**, **reconciliation runs**, **matches** (1:1 / 1:many / many:1 / split / grouped) with their
members and **explainable engine evidence**, **exceptions** with aging, **manual review/override** evidence, run
summaries and notes. The matching **logic** is the PURE `@finapp/m15a-matching` engine (zero tables) — reconciliation
runs on **deterministic rules first** and every match is explainable and human-confirmable; **AI suggestions (m27)
are optional — reconciliation works fully without them**. **Not** a chart of accounts (m19 — referenced by opaque
id), a GL reconciliation engine (m20), a journal / posting / ledger engine (m21), an approval-workflow engine (m22),
a finance-integration engine (m23) or a finance-AI tool (m27). Money is **INTEGER MINOR UNITS (`bigint`) — never
float** (ADR-007): every amount, variance, tolerance, referenced balance and split/grouped sum is an integer.

## Layers

- **Matching engine** (`@finapp/m15a-matching`, a **separate PURE package, zero tables**): scores a statement line
  against a candidate ledger entry under a versioned ruleset — an integer score, confidence band, colour status,
  exact variances in minor units, reference/description comparison and machine-readable reason + rule codes. Same
  inputs + same ruleset version ⇒ identical output. Consumed here as a library (ADR-081/082).
- **PURE domain** (`src/domain/`): the four reconciliation state machines — the single choke points every lifecycle
  object goes through — for **runs** (`checkRunTransition`: draft → matching ↔ review → completed → reopened →
  matching), **matches** (`checkMatchTransition`: proposed → confirmed/rejected; confirmed → unmatched),
  **matching rulesets** (`checkRulesetTransition`: draft → active → superseded → retired, immutable-after-publish
  via `isRulesetFrozen`) and **exceptions** (`checkExceptionTransition`: open → resolved/waived); fail-closed hard
  limits (`RECON_LIMITS`) and the import / line / decision / note / source vocabularies. **A run cannot
  auto-complete with unresolved required exceptions.** No I/O; exhaustively unit-tested.
- **Integer-minor-unit money** (`@finapp/m15a-matching`, ADR-082): statement + ledger amounts, variances,
  tolerances, referenced balances and split/grouped sums are `bigint` minor units; `assertMinorUnits` rejects any
  non-integer / float fail-closed. **No float, no decimal arithmetic on money.** Text-similarity ratios are kept
  distinct from money.
- **Ports** (`ports.ts`): a `Clock` (`SystemClock` / `FixedClock`) so aging + effective-dating are deterministic and
  replayable — no ambient `Date.now`. m15 reuses the platform's shared engines through kernel DI tokens (`DB`,
  `AUDIT`, `AUTHZ`, `OUTBOX`) and the m07 rules / m09 documents contracts — it owns no shared service and builds no
  timer/outbox/workflow engine of its own. `hash.ts` provides the canonical `contentHashOf` for the ruleset content
  hash and the statement/ledger file hash used for per-account duplicate protection.
- **Persistence** (`migrations/0001_reconciliation.sql`, **18 tables**, all RLS ENABLE+FORCE + `tenant_isolation`,
  composite `(tenant_id, id)` keys + composite FKs, a `version` column for optimistic concurrency):
  `recon_bank_account` (multi-bank; `entity_ref` / `currency_ref` are **opaque m19 ids, no FK**),
  `recon_matching_ruleset` (versioned, immutable-after-publish, one active per code) + `recon_matching_rule`
  (kind + integer weight) + append-only `recon_ruleset_history`, `recon_statement_import` (per-account file-hash
  duplicate-protected, idempotency-keyed) + `recon_statement_line` (minor units), `recon_ledger_import` +
  `recon_ledger_entry` (minor units), `recon_run` (balances **referenced** only) + append-only
  `recon_status_history`, `recon_match` (1:1 / 1:many / many:1 / many:many / split / grouped; idempotency-keyed) +
  append-only `recon_match_line` (members) + append-only `recon_match_candidate` (explainable engine evidence),
  `recon_exception` (type + aging + required flag) + append-only `recon_manual_decision` (manual override evidence
  that never overwrites the engine's candidate evidence), and append-only `recon_run_summary`, `recon_note` and
  `recon_import_error`. `0002_grant_application_role.sql`: **NO DELETE anywhere** (accounts archive by status;
  imports / lines / matches / exceptions transition by status; rulesets supersede/retire, ADR-010); the **8
  append-only ledgers** (ruleset / status history, match line, match candidate, manual decision, run summary, note,
  import error) are INSERT+SELECT only.
- **Services**: BankAccount + Ruleset (versioned, immutable-after-publish, supersession), Import (statement + ledger
  ingestion, duplicate-protected), Run (create → start matching → review → complete → reopen — completion fails
  closed on unresolved required exceptions), Match (run the m15a engine → confirm/reject/unmatch, manual
  match/group/split — override recorded as append-only evidence), Exception (resolve/waive), Analytics. One
  `M15Emitter` writes audit (m03) + events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/reconciliation`): audited mutating routes + reads across bank accounts, rulesets, imports, runs,
  matches, exceptions, notes, explainable candidate evidence and analytics. Every mutating route is an audited
  `@Endpoint` with a `reconciliation.*` permission enforced server-side (default deny). Responses carry ids, states,
  match types, confidence bands, scores, variances (minor units), reason codes and dates only — never raw statement
  content, full account numbers or float.

## Governance

Tenant isolation (RLS FORCE on all 18 tables), default-deny authorization (**29** `reconciliation.*` permissions,
seeded — **11** privileged: bank_account-manage / bank_account-deactivate / run-reopen / match-unmatch /
ruleset-manage / ruleset-publish / exception-waive / manual-match / manual-group / analytics-export /
platform-administer; there is no vague `reconciliation.admin`, ADR-084), audit via the m03 port (**25** `RECON_`
codes), the single m06 outbox for the one `reconciliation.lifecycle` family (**24** event types, version 1,
classification `confidential`), versioned immutable-after-publish rulesets (one active per code), per-account
file-hash duplicate-import protection + idempotency-keyed imports and matches, and **optimistic concurrency** (a
`version` column + CAS) on every mutable aggregate. Manual override is **append-only evidence** that never overwrites
the engine's candidate evidence, and a **run cannot auto-complete with unresolved required exceptions** (ADR-083).
Money is integer minor units, never float (ADR-007/082).

## Reuse (no duplicate engines)

Authorization (m02), audit (m03), workflow + the single transactional outbox (m06), rules (m07) and documents (m09)
are reused **through kernel DI tokens, events/contracts and ports**, never by importing their internals. M15
publishes `reconciliation.lifecycle` onto the **one outbox m06 owns** — it never creates a second outbox. The
matching **logic** is the PURE `@finapp/m15a-matching` engine, imported as a library. It owns **no chart of
accounts** (m19), **no GL reconciliation** (m20), **no journals / postings / ledger** (m21), **no approval
workflow** (m22), **no finance integration** (m23) and **no AI** (m27); m19 + m09 are referenced by **opaque id**
(no FK) and m15 **reads none of their tables** (ADR-084). Aging + effective-dating are deterministic via the `Clock`
port; m15 builds no timer engine.

## Tests

`packages/m15a-matching/test/m15a-matching.smoke.ts` (the PURE engine — scoring, confidence bands, colour status,
match-type classification, split/grouped balancing, integer-minor-unit rejection of float),
`test/m15-recon.db-spec.ts` (governance — RLS / grants / no-DELETE / append-only / one-active-ruleset /
duplicate-import / idempotency / isolation), plus the domain smoke, the services DB spec (end-to-end incl. the
no-auto-complete-with-required-exceptions rule, manual-override append-only evidence, optimistic concurrency) and the
HTTP API spec. Smoke: `npm run test:smoke`; DB lane: `npm run test:db` against a real PostgreSQL (CI is PostgreSQL
16, authoritative). Stage 3, ADR-081…084 — **implemented, not yet certified**.
