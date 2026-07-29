# m19-finance — Finance operations foundation (Stage 3.1)

The **finance reference / foundation data layer** — the root of the finance domain that reconciliation (m15),
GL reconciliation (m20) and the journal engine (m21) build on. It owns **accounting entities**, the **chart of
accounts** (account types + ledger accounts), the **fiscal calendar** (fiscal years + accounting periods with an
open/closed/locked state — the "no posting into a closed period" gate), **currencies + FX rates**, **cost
centres**, **analytical dimensions**, **tax codes + rates**, **payment terms** and **versioned finance
configuration**. Nothing is hardcoded: chart-of-accounts codes, cost centres, dimensions, tax codes, currencies
and payment terms are **configurable per-tenant data**; only the governed control vocabularies (account classes +
normal side, lifecycle states, rate/tax types) are enumerated in code. **Not** a journal / posting / ledger engine
(m21), a reconciliation engine (m15/m15a), a GL reconciliation engine (m20), an approval-workflow engine (m22), a
finance-integration engine (m23), a finance-AI tool (m27), or any cash / AR / AP / payment surface. M19 owns
**finance foundation data**; it carries **no journals, no journal lines, no postings and no monetary balances**,
and it reads no other module's tables.

## Layers

- **PURE domain** (`src/domain/`): the finance-foundation state machines — the single choke points every
  lifecycle object goes through — for **ledger accounts** (`checkAccountTransition`: draft → active ↔ inactive →
  archived), **accounting periods** (`checkPeriodTransition`: open ↔ closed → locked; `locked` terminal),
  **fiscal years** (`checkFiscalYearTransition`: open ↔ closed) and the **versioned finance configuration**
  (`checkConfigTransition`: draft → active → superseded → retired, immutable-after-publish via `isConfigFrozen`);
  the governed control vocabularies (five account classes + normal balance side via `normalSideOf`, rate types,
  entity-currency roles, dimension kinds, tax types, payment-term bases, all lifecycle statuses) and fail-closed
  hard limits (`FINANCE_LIMITS`). `isPeriodPostable` / `isAccountPostable` fail closed — only an `open` period and
  an `active` account are postable, the gate m21 reads. No I/O; exhaustively unit-tested.
- **Decimal-safe money** (`money.ts`, ADR-078): the foundation carries **NO monetary amounts or balances** — the
  only money-adjacent values are **exact-decimal FX rates** (`isValidRate`, NUMERIC(30,12)) and **tax rates**
  (`isValidPercentage`, NUMERIC(9,6)), validated as canonical decimal **strings**, never parsed into a binary
  float (CLAUDE.md money rule, ADR-007). Plus `isCurrencyCode` (ISO-4217-style) and `isMinorUnits` (0..6).
- **Ports** (`ports.ts`): a `Clock` (`SystemClock` / `FixedClock`) so effective-dating (period boundaries, FX
  rate dates, tax effective dates, config publication) is deterministic and replayable — no ambient `Date.now`.
  M19 reuses the platform's shared engines through kernel DI tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) — it owns
  no shared service and builds no timer/outbox/workflow engine of its own.
- **Persistence** (`migrations/0001_finance.sql`, **18 tables**, all RLS ENABLE+FORCE + `tenant_isolation`,
  composite `(tenant_id,id)` keys + composite FKs, a `version` column for optimistic concurrency): `finance_entity`
  (accounting entity / book), `finance_account_type` (asset/liability/equity/income/expense + normal side),
  `finance_currency` + `finance_exchange_rate` (exact-decimal FX, one rate per base/quote/type/date) +
  `finance_entity_currency` (functional/presentation/transaction role), `finance_account` (chart of accounts;
  tree; `postable`; lifecycle) + append-only `finance_account_history`, `finance_fiscal_year` +
  `finance_fiscal_period` (the postability gate; open/closed/locked) + append-only `finance_period_history`,
  `finance_cost_center`, `finance_dimension` + `finance_dimension_value`, `finance_tax_code` +
  `finance_tax_rate` (exact-decimal, effective-dated), `finance_payment_term`, and `finance_config` (versioned,
  immutable-after-publish, one active version per entity+scope, idempotency-keyed) + append-only
  `finance_config_history`. `0002_grant_application_role.sql`: **NO DELETE anywhere** (accounts / entities / cost
  centres / dimensions archive by status; reference data deactivates; config supersedes/retires by status,
  ADR-010); the **3 append-only ledgers** (`finance_account_history`, `finance_period_history`,
  `finance_config_history`) are INSERT+SELECT only.
- **Services**: `CatalogService` (accounting entities, currencies + FX, entity-currency config, cost centres,
  dimensions + values, tax codes + rates, payment terms — the reference data), `ChartService` (account types +
  the chart of accounts / ledger accounts through their lifecycle), `CalendarService` (fiscal years + accounting
  periods through the open/close/lock/reopen transitions — the postability gate), `ConfigService` (versioned
  finance configuration, immutable-after-publish, idempotency-keyed). One `M19Emitter` writes audit (m03) + events
  on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/finance`): audited mutating routes + reads across the catalog, chart, calendar and config
  surfaces. Every mutating route is an audited `@Endpoint` with a `finance.*` permission enforced server-side
  (default deny). Payloads and responses carry ids, codes, states, dates and safe reference dimensions only — no
  monetary amounts, balances or float.

## Governance

Tenant isolation (RLS FORCE on all 18 tables), default-deny authorization (**45** `finance.*` permissions,
seeded — **16** privileged: entity-manage / account-type-manage / account-archive / fiscal-year-close /
fiscal-year-reopen / period-close / period-lock / period-reopen / currency-manage / exchange-rate-manage /
tax-code-manage / tax-rate-manage / config-manage / config-publish / analytics-export / platform-administer;
there is no vague `finance.admin`, ADR-079), audit via the m03 port (**34** `FIN_` codes — the prefix is shared
with m23-finance-integration and codes must not collide, ADR-079), the single m06 outbox for the one
`finance.lifecycle` family (**33** event types, version 1), the **period open/closed/locked state** as the
cross-module "no posting into a closed period" gate (ADR-078), immutable-after-publish + one-active-version
versioning on `finance_config` (idempotency-keyed), and **optimistic concurrency** (a `version` column + CAS) on
every mutable aggregate. The foundation is **decimal-safe** — no monetary amounts/balances anywhere; FX and tax
rates are exact NUMERIC decimals, never float (ADR-007/078).

## Reuse (no duplicate engines)

Authorization (m02), audit (m03) and workflow + the single transactional outbox (m06) are reused **through kernel
DI tokens, events/contracts and ports**, never by importing their internals. M19 publishes `finance.lifecycle`
onto the **one outbox m06 owns** — it never creates a second outbox. It owns **no journal / posting / ledger
engine** (m21), **no reconciliation** (m15/m15a), **no GL reconciliation** (m20), **no approval workflow** (m22),
**no finance integration** (m23), **no AI** (m27) and **no cash / AR / AP / payment** surface — those consume this
foundation's reference data + period gate downstream; m19 **reads none of their tables** and mutates nothing
cross-module (ADR-080). Effective-dating is deterministic via the `Clock` port; m19 builds no timer engine.

## Tests

`test/m19-finance.smoke.ts` (PURE domain — the account / period / fiscal-year / config machines, postability +
decimal-rate validation, vocab + limits), `test/m19-finance.db-spec.ts` (RLS / grants / append-only / no-DELETE /
one-active-config / idempotency / constraints / isolation), `test/m19-services.db-spec.ts` (end-to-end incl. the
period open/close/lock gate, account lifecycle, config supersession + idempotency, exact-decimal FX/tax rates,
optimistic concurrency, cross-tenant) and `apps/api/test/api-finance.db-spec.ts` (HTTP end-to-end). Smoke:
`npm run test:smoke`; DB lane: `npm run test:db` against a real PostgreSQL (CI is PostgreSQL 16, authoritative).
ADR-077…080.
