# Stage 3.1 — M19 Finance Operations Foundation — Implementation Plan

Grounded in the m07/m08/m09/m12–m18 pattern. Built on `feature/stage-3-1-m19-finance-operations` from the certified
platform baseline (kernel + m01-tenant + m02-identity + m03-audit + m06-workflow); M19 is the first module of
Stage 3 Finance — the finance-domain root that m15 / m20 / m21 depend on (was `documented`). Counts below are
**exact** where the foundation is already built (18 tables, 45 permissions / 16 privileged, 34 audit codes, 33
event types) and finalized in the completion report.

## Sequence (planned)

1. **contracts** — one family `finance.lifecycle` (33 event types, version 1); wired into the `DomainEvent` union
   + `DOMAIN_EVENT_FAMILIES`; contracts smoke bumped one family. Payloads carry ids, codes, states, dates + safe
   reference dimensions only — never monetary amounts, balances or float (ADR-007/078). Closes the naming-map GAP
   (`event_families` was `[]`, ADR-079).
2. **package skeleton + catalogues** — `packages/m19-finance` (package.json, tsconfig, root + apps/api refs);
   **45** `finance.*` permissions (granular, three-segment, no wildcard, no vague `finance.admin`; **16**
   privileged — entity-manage / account-type-manage / account-archive / fiscal-year-close / fiscal-year-reopen /
   period-close / period-lock / period-reopen / currency-manage / exchange-rate-manage / tax-code-manage /
   tax-rate-manage / config-manage / config-publish / analytics-export / platform-administer); **34** `FIN_` audit
   codes (prefix shared with m23, no collision).
3. **PURE domain** — limits + governed vocabularies (`ACCOUNT_CLASSES` + `normalSideOf`, balance sides, rate
   types, entity-currency roles, dimension kinds, tax types, payment-term bases, all lifecycle statuses); the four
   state machines through their single choke points — `checkAccountTransition`, `checkPeriodTransition`
   (the postability gate), `checkFiscalYearTransition`, `checkConfigTransition` (immutable-after-publish via
   `isConfigFrozen`); `isPeriodPostable` / `isAccountPostable` (fail closed); decimal-safe rate helpers in
   `money.ts` (`isValidRate` NUMERIC(30,12), `isValidPercentage` NUMERIC(9,6), `isCurrencyCode`, `isMinorUnits`)
   — no float, ever.
4. **clock port** — `Clock` (`SystemClock` + `FixedClock`) so effective-dating (period boundaries, FX rate dates,
   tax effective dates, config publication) is deterministic; no ambient `Date.now`, no bespoke timer engine.
5. **migrations** — `0001_finance.sql` (**18 tables**, RLS ENABLE+FORCE, composite keys/FKs, a `version` column
   per mutable aggregate; the exact-decimal FX `finance_exchange_rate` one-rate-per-base/quote/type/date index,
   the exact-decimal effective-dated `finance_tax_rate`, the `finance_fiscal_period` open/closed/locked gate, the
   `finance_config` one-active-per-entity+scope + idempotency-key partial unique indexes, immutable-after-publish;
   the 3 append-only history ledgers; the `finance.*` permission seed) and `0002_grant_application_role.sql`
   (**NO DELETE anywhere**; the 3 append-only ledgers INSERT+SELECT only).
6. **repository + emit + errors** — all SQL (optimistic-lock CAS on `version`, one-active-config partial-unique
   enforcement, immutable-after-publish guards, idempotency-key lookup, append-only inserts); `M19Emitter` (audit
   m03 + m06 outbox in the business tx).
7. **services** — Catalog (accounting entities, currencies + FX, entity-currency config, cost centres, dimensions
   + values, tax codes + rates, payment terms), Chart (account types + the chart of accounts through their
   lifecycle), Calendar (fiscal years + accounting periods through open → close → lock → reopen — the postability
   gate), Config (versioned finance configuration, immutable-after-publish, idempotency-keyed, supersession);
   index.
8. **API** — `apps/api/src/finance` (views + controllers under `/api/v1/finance` + the module binding the
   Framework-Only clock port; mutating endpoints + reads + analytics); wired into `AppModule`. No monetary
   amounts, balances or float in any response (GAP-2, ADR-079).
9. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true` for
   `finance.lifecycle`, `permission_namespace_registered: true` for `finance.*` (GAP-4), `/api/v1/finance` (GAP-2);
   manifest m19 → implemented + `certification_3_1`.
10. **tests** — smoke (domain), db-spec (governance), services-db-spec (end-to-end + optimistic concurrency +
    period-close gate + one-active-config + immutable-after-publish + idempotency + exact-decimal FX/tax +
    cross-tenant), api-spec (HTTP).
11. **docs** — README, architecture/readiness/plan/completion, ADR-077…080.

## Foundation lifecycle machines

Four explicit machines, each a single choke point; callers fail closed on `!ok`:

- **ledger account** — `draft` → (`active` / `archived`); `active` ↔ `inactive`; either → `archived` (terminal).
  Only an `active` account is postable (`isAccountPostable`). Transitions recorded in append-only
  `finance_account_history`.
- **accounting period** — `open` ↔ `closed`; either → `locked` (terminal/sealed). Only `open` is postable
  (`isPeriodPostable`) — the cross-module "no posting into a closed period" gate m21 reads. Transitions recorded
  in append-only `finance_period_history` (`closed_at` / `locked_at`).
- **fiscal year** — `open` ↔ `closed`.
- **finance configuration** — `draft` → `active` → `superseded` → `retired`. A published (`active` or beyond)
  config is **immutable** (`isConfigFrozen`); one active version per entity+scope; a change is a NEW version via
  supersession. Transitions recorded in append-only `finance_config_history`.

## Design choices

- **18 tables** (the finance-domain root — accounting entities, account types + the chart of accounts with its
  history ledger, currencies + FX + entity-currency config, fiscal years + accounting periods with their history
  ledger, cost centres, dimensions + values, tax codes + rates, payment terms, and versioned config with its
  history ledger — justifies 18; the repository fixed only the count, the exact set is decided in ADR-077).
- Chart codes, cost centres, dimensions, tax codes, currencies and payment terms are **configurable per-tenant
  data**; the governed control vocabularies (account classes + normal side, lifecycle states, rate/tax types) are
  enumerated in code; nothing Kenya-/Aptic-specific is baked into core.
- **Decimal-safe** — the foundation carries no monetary amounts or balances; FX + tax rates are exact NUMERIC
  decimals validated as strings, never float (ADR-007/078); accounting periods carry the open/closed/locked gate
  that m21 honours — m19 never posts (ADR-078).
- Finance configuration is **versioned, immutable-after-publish** (one active version per entity+scope, change =
  new version via supersession) and **idempotency-keyed**; every mutable aggregate has **optimistic concurrency**
  (`version` + `WHERE version = $expected`); FX rates are idempotent (one per base/quote/type/date) (ADR-078).
- **Strict boundary** — m19 owns reference/foundation data only; no journals, postings, reconciliation, approvals,
  AI or cash/AR/AP/payments (m21 / m15 / m20 / m22 / m27); it reads no other module's tables and mutates nothing
  cross-module — downstream modules consume its reference data + period gate (ADR-080). Real FX/tax provider feeds
  are deferred behind existing ports (documented).

## Verification

Every gate to be actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Exact counts
(45 permissions / 16 privileged, 34 audit codes, 33 event types, 18 tables, 3 append-only ledgers, 4 state
machines) confirmed in the completion report.
