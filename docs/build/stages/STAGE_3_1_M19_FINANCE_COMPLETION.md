# Stage 3.1 — M19 Finance Operations Foundation — Completion Report

**Module:** `m19-finance` · **Package:** `@finapp/m19-finance` · **Branch:**
`feature/stage-3-1-m19-finance-operations` · **Baseline:** governance-approved main
`470d19a5b8aba933270ca360a271437c93afbe34` (PR #34). **Status:** implemented on branch; all local gates green,
**not merged** (M19 was approved for build via governance PR #34 — previously `documented`); the implementation PR +
post-merge certification are the next steps.

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified-pending** = to be observed green on the authoritative PostgreSQL 16 CI lane · **not yet
merged** · **deferred** = documented, out of scope.

## What was built

The **finance operations FOUNDATION** — the finance reference-data root of the finance domain, consumed by
reconciliation (m15), GL reconciliation (m20) and the journal engine (m21). It owns accounting entities, the chart
of accounts (account types + ledger accounts), the fiscal calendar (fiscal years + accounting periods with an
open/closed/locked state), currencies + FX rates, cost centres, analytical dimensions, tax codes + rates, payment
terms, and versioned finance configuration. It is **not** a journal/posting engine (m21), a reconciliation engine
(m15/m15a), a GL-reconciliation engine (m20), an approval workflow (m22), a finance integration (m23), or an AI
tool (m27); it holds no journals, no postings, no cash/AR/AP/payments. Nothing is jurisdiction-specific: the chart,
currencies, calendar, dimensions, tax and terms are configurable per tenant.

- **PURE domain** (`src/domain/` + `money.ts`): the governed vocab (account classes + normal side, lifecycle
  states, rate types, tax types); the ledger-account, accounting-period, fiscal-year and finance-config state
  machines; and **decimal-safe** money helpers — FX + tax rates are validated as exact decimal STRINGS and never
  parsed to a binary float (ADR-007/078). The foundation carries no monetary amounts or balances.
- **Clock port** (`ports.ts`): effective-dating is deterministic via an injected `Clock` (`SystemClock` +
  `FixedClock`).
- **Persistence** (`0001`/`0002`, **18 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs, **NO DELETE grant anywhere**): finance_entity, finance_account_type,
  finance_currency, finance_exchange_rate (EXACT NUMERIC(30,12); idempotent natural key), finance_entity_currency,
  finance_account (chart of accounts; tree; lifecycle; SoD-free), finance_account_history (append-only),
  finance_fiscal_year, finance_fiscal_period (the postability gate), finance_period_history (append-only),
  finance_cost_center, finance_dimension, finance_dimension_value, finance_tax_code, finance_tax_rate (EXACT
  NUMERIC(9,6); effective-dated), finance_payment_term, finance_config (versioned, immutable-after-publish,
  one-active per entity+scope, idempotency-keyed), finance_config_history (append-only). **3 append-only ledgers**
  (account/period/config history) are INSERT+SELECT only.
- **Services**: `CatalogService` (reference data), `ChartService` (ledger accounts), `CalendarService` (fiscal
  years + periods), `ConfigService` (versioned config). One `M19Emitter` writes audit (m03) + events on the **one
  outbox m06 owns**, in the business tx.
- **API** (`/api/v1/finance`): entities, account types, currencies + FX rates, entity currencies, cost centres,
  dimensions + values, tax codes + rates, payment terms; ledger accounts + lifecycle + history; fiscal years +
  periods (open/close/lock/reopen) + history; finance config (create/update/publish/supersede/retire) + history,
  across four controllers. Every mutating route declares a permission (default deny) and an audit code; FX/tax
  rate fields are strings on the wire (never a float).

## Scope

| Fact | Value |
|---|---|
| Source added | `packages/m19-finance` (domain, money, ports, repository, emit, 4 services) + `apps/api/src/finance` (views + 4 controllers + module) + registries/contracts/tests/docs |
| Migrations | **2** for m19 (`0001`, `0002`); **32** total replayed in the repo, m19 in Stage 3 |
| Tables created | **18** |
| Permissions added | **45** (`finance.*` three-segment; **16** privileged incl. account.archive / fiscal_year.close / period.close+lock / currency.manage / config.manage+publish / analytics.export / platform) — seeded (GAP-4 closed) |
| Audit codes added | **34** (`FIN_*` SCREAMING_SNAKE, all ≥ 3 segments; prefix shared with m23); `registered_code_count` **486 → 520** |
| Events added | **ONE** family — `finance.lifecycle` (**33** event types, version 1); contracts `DomainEvent` union / `DOMAIN_EVENT_FAMILIES` **15 → 16** families |
| Services / controllers | **4** services (Catalog / Chart / Calendar / Config); **4** controllers |
| Routes | **38** mutating routes (each `@Endpoint` permission + audit code) + **21** read routes |
| Lifecycles | ledger account (draft→active↔inactive→archived), accounting period (open→closed↔reopen→locked), fiscal year (open↔closed), finance config (draft→active→superseded→retired, immutable-after-publish) |
| ADRs | ADR-077…080 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **18** tables; composite `(tenant_id,id)` keys + **23** composite FKs (0 single-column); asserted through the non-owner app role (`finapp_app`). |
| Authorization | Default-deny; every mutation `authz.require`s its three-segment `finance.*` permission; a header cannot grant authority (proven over HTTP → 403). **16** privileged permissions gate close/lock/config/archive/configuration actions; no vague `finance.admin`. |
| Decimal-safe money | **No monetary amounts or balances** in the foundation; the only money-adjacent values are EXACT NUMERIC FX rates (30,12) + tax rates (9,6), validated as decimal strings and never parsed to a float — **0 finance columns use `real`/`double precision`** (ADR-007/078). The exact rate string is preserved verbatim on write + read (proven). |
| Posting gate | Accounting periods carry an open/closed/locked state; `isPeriodPostable` is true only while open; close/lock emit `PeriodClosed`/`PeriodLocked` — the cross-module signal downstream posting (m21) reads to honour "no posting into a closed period". **m19 never posts a ledger entry** (ADR-078). |
| Immutability / versioning | Published finance configuration is immutable — `content_hash` freezes at publish, one active per entity+scope; a change is a new version via supersession (`version_number` bumped, prior→superseded). Ledger accounts / periods / config transition through explicit state machines; the 3 history ledgers are append-only. |
| Idempotency | DB-enforced on the finance-config idempotency key (partial unique index) and the exchange-rate natural key (base, quote, type, date) — a replay returns the existing row. |
| Optimistic concurrency | Mutable aggregates carry a `version` column; UPDATEs are single-winner CAS (`WHERE version = $expected`) returning null on stale → conflict (proven by a stale-write rejection). |
| Append-only evidence | account/period/config history INSERT+SELECT only (0 UPDATE grant); NO DELETE on any m19 table (accounts/entities/cost-centres archive by status; reference data deactivates). |
| Single outbox | m19 owns no outbox; publishes `finance.lifecycle` through m06's outbox (only `workflow_event_outbox` exists). |
| Sensitive-data minimisation | Audit + events carry ids, codes, states and dates only — never monetary amounts or balances (proven by a payload scan). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean (**exit 0**). **Lint:** `eslint` **0 errors** (62 style warnings, matching the
  certified baseline pattern). **Format:** `prettier --check .` clean.
- **Smoke lane (tested locally):** **22 suites, 4238 assertions, 0 failed** — including `m19-finance` (**73**),
  `conformance` (**2280**, validating every `@Endpoint` permission + audit code against the registries, the RLS
  convention over the new migrations, `registered_code_count` = len(codes) = **520**, and the newly-registered
  `finance.lifecycle` family), and `migrate` (**26**).
- **Migrations (tested locally):** **32** in dependency order, applied on a fresh PostgreSQL from an empty
  database.
- **DB + API lane (tested locally, real PostgreSQL 15.2, roles `finapp_app` + `finapp_owner`):** **43 specs, 1410
  assertions, 0 failed** — `m19-finance.db-spec` (**37** governance), `m19-services.db-spec` (**60** end-to-end),
  `api-finance.db-spec` (**12** HTTP end-to-end), and the whole prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **CI-verified-pending** at the
  time of writing.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**.

## Live DB governance verified

18/18 finance tables RLS ENABLE+FORCE + `tenant_isolation` + composite `(tenant_id,id)` PK; **0 DELETE grants**
for the app role; the 3 append-only ledgers have **0 UPDATE grant**; **23** composite FKs (0 single-column); **0**
finance columns use a binary float; **45** permissions seeded (**16** privileged); currency-code + period-status +
account-class CHECKs; exchange-rate `rate > 0` + `base <> quote` + natural-key idempotency; config one-active +
idempotency-key; account/cost-centre/dimension self-parent CHECKs; only `workflow_event_outbox` exists (**m19 owns
no outbox**).

## Repository GAPs closed (documented in ADRs 077–080)

- **The 18-table composition (ADR-077):** the repository specified only the count (`module-registry.yaml:27`,
  `reference_tables: 18`) with no module spec and no enumeration; this stage fixes the exact set.
- **GAP-2 — API prefix:** `/api/v1/finance` registered (`naming-map.yaml`).
- **GAP-4 — permission namespace:** `finance.*` seeded + registered in `permission-registry.yaml`.
- **Event family:** `finance.lifecycle` introduced (`naming-map.yaml` had `event_families: []`) — ADR-079. The
  `FIN_` audit prefix is shared with m23; codes do not collide.

## Limitations (deferred, documented — not defects)

- **No journals / journal lines / postings / ledger-posting engine** — m21; the foundation provides the chart,
  periods and currencies journals reference, and the period gate, but posts nothing.
- **No reconciliation (m15/m15a), no GL reconciliation (m20), no approval workflow (m22), no finance integration
  (m23), no AI (m27).**
- **No monetary amounts / balances / cash / AR / AP / payments** — out of scope for the foundation.
- **Analytics/export + platform-administer permissions** are seeded for forward use but have no route in this
  foundation layer yet (no analytics service methods) — declared, unused, not surfaced.

## Spec divergence (recorded)

Several reference-data update routes and config retire reuse the registered `FIN_*_REGISTERED` / `FIN_CONFIG_SUPERSEDED`
audit codes (the service records under those) — there are no dedicated `*_UPDATED` / `FIN_CONFIG_RETIRED` codes.
Config supersession is a 3-step sequence (prior→superseded, insert successor, publish successor) to respect the
`finance_config_one_active` partial unique index; a period's entity is derived from its fiscal year so the two
cannot disagree. The scope decisions (18 tables; the finance foundation as the domain root; decimal-safe with no
monetary amounts; the period posting gate; keyword-free reference data; the closed naming GAPs) are captured in
**ADR-077…080** and this report.

## Scope discipline (contamination)

Only `m19-finance` (+ its API wiring, registries, contracts family, tests, docs) was built. No journals, postings,
reconciliation, GL reconciliation, approval workflow, finance integration, AI, cash/AR/AP/payments; no Legal (M14/
M16/M17/M18) duplication; no Enterprise Platform (M30+) code; every SQL table reference is `finance_*`. No shared
platform service was duplicated; no second outbox; no duplicate audit table. No historical migration was edited.
The manifest change is confined to the m19 block. The implementation is on the branch; it is **not merged** — the
PR + post-merge PostgreSQL 16 certification are the next steps.
