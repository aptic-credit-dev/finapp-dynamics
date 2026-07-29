# Stage 3.1 — M19 Finance Operations Foundation — Readiness

**Verdict: GO** (built on the certified platform baseline; all shared-service dependencies merged + certified on
main; M19 is the first module of Stage 3 Finance and the root the rest of the finance domain builds on — was
`documented`).

## Dependencies available

- **kernel** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02-identity** — real RBAC (`RbacAuthz`) + the `permissions` catalogue m19 seeds `finance.*` into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port); the `FIN_` prefix is shared with
  m23-finance-integration (codes must not collide). ✅
- **m06-workflow** — owns the single outbox; m19 publishes `finance.lifecycle` through it and creates no second
  outbox. ✅
- Test harness, migrate tool (m19-finance in `module-order`), conformance. ✅

## The finance-domain-root boundary

M19 is the **root of the finance domain**, not a consumer of it. Reconciliation (m15/m15a), GL reconciliation
(m20), the journal / posting engine (m21), approval workflow (m22), finance integration (m23) and finance AI (m27)
are **downstream** — they read m19's reference data (entities, accounts, currencies + FX, tax, dimensions, cost
centres, config) and honour the **accounting-period open/closed/locked gate** through `finance.lifecycle` events
and the finance API under their own permissions. **m19 reads none of their tables**, imports none of their
internals and performs no cross-module mutation. Because those modules are downstream, none is a build dependency
of m19 — the foundation can be built and certified first (ADR-080).

## The decimal-safe boundary

The finance foundation carries **NO monetary amounts or balances** — journals, journal lines, postings and ledger
balances live with the posting engine (m21), not here. The only money-adjacent values are **exact-decimal FX
rates** (`finance_exchange_rate.rate`, NUMERIC(30,12)) and **tax rates** (`finance_tax_rate.rate_percent`,
NUMERIC(9,6)), validated in `money.ts` as canonical decimal **strings** (`isValidRate` / `isValidPercentage`) and
stored as exact NUMERIC — **never** parsed into a binary float (CLAUDE.md money rule, ADR-007/078). No float
appears anywhere in m19, and no event/audit payload carries an amount.

## The period-close postability gate

Accounting periods (`finance_fiscal_period`) carry an **open / closed / locked** state through the single choke
point `checkPeriodTransition` (`open` ↔ `closed` → `locked`; `locked` is terminal/sealed). `isPeriodPostable`
fails closed — only an `open` period is postable. This state is the **cross-module "no posting into a closed
period" gate** the journal engine (m21) reads; m19 **emits** the period open/close/lock/reopen transitions on
`finance.lifecycle` but **never posts a ledger entry itself** (ADR-078). Fiscal-year close (`open` ↔ `closed`) and
ledger-account lifecycle (`draft` → `active` ↔ `inactive` → `archived`) are governed by their own machines; only
an `active` account is postable.

## Versioning, idempotency & concurrency

Finance configuration (`finance_config`) is **versioned and immutable-after-publish**: a published (`active`)
config is frozen (`isConfigFrozen`), there is **one active version per entity+scope** (a partial unique index on
`status = 'active'`), a change is a **new version via supersession** (`version_number` + `supersedes_id` /
`superseded_by_id`), and creation is **idempotency-keyed** (a partial unique index on `idempotency_key`) so a
re-submission returns the existing record rather than a duplicate. Every mutable aggregate carries a `version`
column for **optimistic concurrency** (CAS on `WHERE version = $expected`). FX rates are idempotent — one rate per
`(base, quote, type, date)`.

## Integration seams

- **authorization (m02)** — every endpoint enforces its three-segment `finance.*` permission (default deny).
- **audit (m03)** — every controlled mutation writes a `FIN_` code through the kernel `AUDIT` port in the business
  tx; the prefix is shared with m23 and codes must not collide.
- **workflow / outbox (m06)** — `finance.lifecycle` flows through the single outbox m06 owns; no second outbox.

## Security & isolation boundaries

- Tenant isolation: RLS ENABLE+FORCE + a `tenant_isolation` policy on **all 18 tables**, composite
  `(tenant_id, id)` keys and composite FKs; the application role is NOLOGIN/NOBYPASSRLS and is granted **no
  DELETE** anywhere (archive-by-status / deactivate / supersede instead, ADR-010); the **3 append-only ledgers**
  (`finance_account_history`, `finance_period_history`, `finance_config_history`) are INSERT+SELECT only.
- Default-deny authorization: **45** `finance.*` permissions, seeded — **16** privileged (entity-manage /
  account-type-manage / account-archive / fiscal-year-close / fiscal-year-reopen / period-close / period-lock /
  period-reopen / currency-manage / exchange-rate-manage / tax-code-manage / tax-rate-manage / config-manage /
  config-publish / analytics-export / platform-administer); **no wildcard, no vague `finance.admin`** (ADR-079).
- Event/audit payloads carry ids, codes, states, dates and safe reference dimensions **only** — never monetary
  amounts, balances or float (ADR-007/078).

## Determinism & port abstraction

Effective-dating (period boundaries, FX rate dates, tax effective dates, config publication) is deterministic via
an injected `Clock` port — no ambient `Date.now`; the same inputs always yield the same result, proven with a
`FixedClock`. m19 builds **no timer engine**.

## Assumptions

- No production FX-rate or tax-authority feed is configured → rates are entered/curated as exact-decimal reference
  data behind existing permissions; real provider feeds are deferred behind ports, no secrets.
- Journals, postings, balances and reconciliation are owned by downstream modules (m21/m15/m20) → m19 stores
  reference/config data + the period gate only, and is consumed by those modules, not the reverse.
- Currency lists are curated per tenant (`finance_currency` is tenant-scoped), not promoted to a global registry.

## Exclusions (verified out of scope, Framework-Only where deferred)

No journals / journal lines / postings / ledger-posting engine (M21); no reconciliation (M15/M15a); no GL
reconciliation (M20); no approval workflow (M22); no finance integration / external accounting connector (M23);
**no AI** (M27); no cash application / accounts receivable / accounts payable / payment / bank feed; no monetary
balances anywhere. Those modules **consume** this foundation downstream and are referenced by boundary only.

## Implementation gates

format · lint (wiped dist) · build · smoke · conformance · migrations (dry-run + fresh replay) · DB specs ·
API specs · RLS · grants/no-DELETE · append-only · permissions · audit · events · outbox · one-active-config ·
immutable-after-publish · idempotency (config + FX rate) · concurrency (optimistic CAS) · period-close
postability gate · decimal-safe (exact NUMERIC FX/tax, no float) · security negatives · isolation/cross-tenant ·
contamination. PostgreSQL 16 CI is authoritative.

## Deferred provider integrations

A real FX-rate provider feed and a tax-authority rate feed (behind existing ports/permissions, no secrets), and
any downstream posting/reconciliation consumer — all reached through `finance.lifecycle` events + the finance API,
never by another module reading m19's tables.
