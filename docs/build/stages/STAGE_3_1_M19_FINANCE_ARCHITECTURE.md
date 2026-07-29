# Stage 3.1 — M19 Finance Operations Foundation — Architecture

**Module:** `m19-finance` · **Package:** `@finapp/m19-finance` · **Branch:**
`feature/stage-3-1-m19-finance-operations` · **Baseline:** the certified platform baseline (kernel + m01-tenant +
m02-identity + m03-audit + m06-workflow). **ADRs:** ADR-077…080. (M19 was previously `documented` — the first
module of Stage 3 Finance; it is approved for build as the finance-domain root that m15 / m20 / m21 depend on.)

## Purpose & boundary

One generic, multi-tenant **finance reference / foundation data layer** — the **root of the finance domain**. It
owns the reference and configuration data every downstream finance module builds on: **accounting entities**, the
**chart of accounts** (account types + ledger accounts), the **fiscal calendar** (fiscal years + accounting
periods carrying an open/closed/locked state), **currencies + FX rates**, **cost centres**, **analytical
dimensions**, **tax codes + rates**, **payment terms**, and **versioned finance configuration**. It is **not** a
journal / journal-line / posting / ledger engine (M21), a reconciliation engine (M15/M15a), a GL reconciliation
engine (M20), an approval-workflow engine (M22), a finance-integration engine (M23), a finance-AI tool (M27), or
any cash / accounts-receivable / accounts-payable / payment surface (see Exclusions). M19 owns full **finance
foundation data**; it holds **no journals, no journal lines, no postings and no monetary balances**, it
**references** no other module and reads none of their tables. Nothing is Kenya- or Aptic-specific: chart codes,
cost centres, dimensions, tax codes, currencies and payment terms are **configurable per-tenant data**, never
hardcoded. It consumes shared services via kernel tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and owns no shared
service.

## Shape (mirrors m07/m08/m09/m12–m18)

- **PURE domain** — the finance-foundation state machines, each a single choke point: `checkAccountTransition`
  (ledger account: `draft` → `active` ↔ `inactive` → `archived`, `archived` terminal), `checkPeriodTransition`
  (accounting period: `open` ↔ `closed` → `locked`, `locked` terminal — the postability gate),
  `checkFiscalYearTransition` (`open` ↔ `closed`) and `checkConfigTransition` (versioned config: `draft` →
  `active` → `superseded` → `retired`, immutable-after-publish via `isConfigFrozen`). The governed control
  vocabularies (the five account classes + normal balance side via `normalSideOf`; rate types; entity-currency
  roles; dimension kinds; tax types; payment-term bases; all lifecycle statuses); fail-closed hard limits
  (`FINANCE_LIMITS`). `isPeriodPostable` / `isAccountPostable` fail closed (only `open` / `active` is postable).
  No I/O; exhaustively unit-tested.
- **Decimal-safe money** — the foundation carries **NO monetary amounts or balances**; the only money-adjacent
  values are **exact-decimal FX rates** (NUMERIC(30,12)) and **tax rates** (NUMERIC(9,6)), validated in `money.ts`
  as canonical decimal **strings** (`isValidRate` / `isValidPercentage`), **never** parsed into a binary float
  (ADR-007/078). No journal, no posting, no balance ever appears in m19.
- **Clock port** — effective-dating (period boundaries, FX rate dates, tax effective dates, config publication) is
  deterministic via an injected `Clock` (`SystemClock` / `FixedClock`); no ambient `Date.now`. m19 builds **no
  timer engine** — downstream dispatch/escalation, where needed, delegates to m06/m08.
- **18 tables** — `finance_entity` (the accounting entity / book, distinct from the m01 tenant org unit; tree);
  `finance_account_type` (asset/liability/equity/income/expense + normal side); `finance_currency` +
  `finance_exchange_rate` (exact-decimal FX, one rate per base/quote/type/date) + `finance_entity_currency`
  (functional/presentation/transaction role); `finance_account` (the chart of accounts; tree; `postable` flag;
  draft→active↔inactive→archived) + append-only `finance_account_history`; `finance_fiscal_year` +
  `finance_fiscal_period` (the postability gate; open/closed/locked; `closed_at`/`locked_at`) + append-only
  `finance_period_history`; `finance_cost_center` (tree); `finance_dimension` + `finance_dimension_value` (tree);
  `finance_tax_code` + `finance_tax_rate` (exact-decimal, effective-dated); `finance_payment_term`; `finance_config`
  (versioned, immutable-after-publish, one active version per entity+scope via a partial unique index,
  idempotency-keyed) + append-only `finance_config_history`. All composite `(tenant_id,id)`, RLS ENABLE+FORCE +
  `tenant_isolation`, a `version` column for optimistic concurrency; **no table grants DELETE**; the **3
  append-only ledgers** (account/period/config history) are INSERT+SELECT only.
- **Services** — Catalog / Chart / Calendar / Config, each permissioned + transactional, audit + outbox in the
  business tx via one `M19Emitter`.
- **API** `/api/v1/finance` — accounting entities, account types + the chart of accounts, the fiscal calendar
  (create fiscal year → create period → open → close → lock → reopen), currencies + FX rates + entity-currency
  config, cost centres, dimensions + values, tax codes + rates, payment terms, and the versioned finance
  configuration (create → publish → supersede), plus reads + analytics.

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| The finance-foundation composition | the finance domain's root is **18 FORCE-RLS reference/foundation tables** — accounting entities, chart of accounts (account types + ledger accounts), fiscal calendar (fiscal years + accounting periods), currencies + FX, cost centres, dimensions, tax codes + rates, payment terms and versioned config, with **3 append-only history ledgers**; the repository specified only the count (18), so the **exact set is fixed here**; m19 owns none of the transactional finance layers | 077 |
| Decimal-safe foundation + the period gate | the foundation holds **no monetary amounts or balances**; the only money-adjacent values are **exact NUMERIC FX rates + tax rates** (never float); accounting periods carry an **open/closed/locked state** that is the cross-module **"no posting into a closed period"** gate the journal engine (m21) reads — m19 **never posts** a ledger entry | 078 |
| Closing the m19 naming GAPs | introduce the **`finance.lifecycle`** event family (the naming-map had `event_families: []`); register **`/api/v1/finance`** (GAP-2) and the **`finance.*`** permission namespace (GAP-4, seeded into the identity catalogue); the **`FIN_`** audit prefix is **shared with m23-finance-integration** — codes must not collide | 079 |
| Strict finance-foundation boundary | M19 owns **reference/foundation data only** and holds **no journals, postings, reconciliation, approvals, AI, or cash/AR/AP/payments** (those are m21 / m15 / m20 / m22 / m27); it **reads no other module's tables** and mutates nothing cross-module — downstream modules consume its reference data + period gate through events + the API | 080 |

## Integration (reuse, no duplicate engines)

m02 authorization decides every `finance.*` permission (default deny, three-segment codes); m03 audit records
every controlled mutation through the kernel `AUDIT` port in the business tx (34 `FIN_` codes, the prefix shared
with m23); m06 workflow owns the **single transactional outbox** onto which m19 publishes `finance.lifecycle`
(m19 owns no outbox). All through kernel DI tokens, events/contracts and ports — never by importing another
module's internals. **Downstream** finance modules consume this foundation, not the reverse: reconciliation (m15),
GL reconciliation (m20), the journal/posting engine (m21), approval workflow (m22), finance integration (m23) and
finance AI (m27) read m19's reference data and honour the **period open/closed/locked gate** through the
`finance.lifecycle` events + the finance API under their own permissions — **m19 reads none of their tables** and
mutates nothing cross-module (ADR-080). The one family `finance.lifecycle` (33 event types, version 1) flows
through the single m06 outbox; payloads carry ids, codes, states, dates and safe reference dimensions only — never
monetary amounts, balances or float (ADR-007/078).
