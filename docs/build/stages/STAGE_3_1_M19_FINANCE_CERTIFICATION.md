# Stage 3.1 — M19 Finance Operations Foundation — Post-Merge Certification

**Verdict: CERTIFIED ON BRANCH.** The merged implementation of `m19-finance` on `main` (`b0f86f8`, PR #35) has been
re-verified from a clean checkout: every gate is green, the certification branch is byte-identical to the reviewed
head, all governance guarantees hold on a real PostgreSQL, decimal-safety round-trips exactly, and the module
honours its finance-foundation boundaries. This record + the manifest update are the only changes on the
certification branch (evidence only — no feature work). The certification PR is open and **not merged**.

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#35** |
| Reviewed implementation head | `712e0a17c3ee8ce1acd07944a54ab9197bdfbda5` |
| Implementation merge SHA (squash) | `b0f86f84bb57aac06ff2d0b9d018a451b5f2da61` |
| Certified baseline SHA (main tested) | `b0f86f84bb57aac06ff2d0b9d018a451b5f2da61` |
| Current `origin/main` | `b0f86f84bb57aac06ff2d0b9d018a451b5f2da61` (= the merge commit) |
| Certification branch | `cert/stage-3-1-m19-finance-operations` (cut from merged main) |
| Parent governance SHA (pre-merge main) | `470d19a5b8aba933270ca360a271437c93afbe34` (governance PR #34) |
| PR #35 | `state: closed`, `merged: true`, `merged_at: 2026-07-29T11:48:01Z`, base `main` |
| Stage / dependencies | Stage 3 (Finance); deps m02/m03/m06 (+ ambient kernel/m01) certified |

## 2. Tree equivalence

`git diff 712e0a1 b0f86f8` → **EMPTY** (0 lines). PR #35 was squash-merged; the certified tree is byte-identical
to the reviewed implementation head. The certification branch was cut from the merge SHA and its only diff vs the
merge is this report + the manifest record.

## 3. Local gate results (baseline `b0f86f8`, clean checkout)

| Gate | Result |
| --- | --- |
| Build / typecheck (wiped `dist`) | ✅ `tsc --build` **exit 0** |
| Format check | ✅ `prettier --check .` clean |
| Lint | ✅ `eslint` **0 errors** (62 style warnings, matching the certified baseline pattern) |
| PURE smoke | ✅ **22 suites, 4238 assertions, 0 failures** (m19-finance 73) |
| Conformance | ✅ **2280 assertions** (endpoint perms/audit codes vs registries, RLS convention over the new migrations, `registered_code_count` = len(codes) = 520, `finance.lifecycle` family registration) |
| Migration dry-run | ✅ lists all 32 migrations incl. the two m19 files in dependency order |
| Migration replay (fresh) | ✅ **32 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **43 specs, 1410 assertions, 0 failures** (m19-finance.db-spec 37, m19-services.db-spec 60, **api-finance.db-spec 12**) |

Local environment: PostgreSQL **15.2** throwaway; the authoritative PostgreSQL **16** CI is verified on the
implementation PR (§S) and re-run on the certification PR.

## 4. Database governance (live checks on the fresh certified schema)

18/18 finance tables verified: RLS **ENABLE + FORCE** + a `tenant_isolation` policy (18/18), composite
`(tenant_id, id)` primary keys (18/18). **23** composite foreign keys, **0** single-column FKs. **0 DELETE grants**
for the app role on any finance table; the **3** append-only ledgers (`finance_account_history`,
`finance_period_history`, `finance_config_history`) have **0 UPDATE grant**. **0** finance columns use a binary
float (`real`/`double precision`); the 2 rate columns (`finance_exchange_rate.rate` NUMERIC(30,12),
`finance_tax_rate.rate_percent` NUMERIC(9,6)) are exact NUMERIC. `finance_config_one_active` (partial unique) +
`finance_config_idem_key` (idempotency) + `finance_exchange_rate_key` (natural-key idempotency) indexes present.
Account/cost-centre/dimension self-parent CHECKs; currency-code + period-status + account-class + effective-date
CHECKs. **45** permissions seeded (**16** privileged). Exactly **one** outbox table exists
(`workflow_event_outbox`) — **m19 owns no outbox**. No orphan references (every association FK is composite
`(tenant_id, id)`; the composite-FK + self-parent negatives are proven in the specs).

## 5. Delivered capabilities (certified)

Accounting entities + hierarchy; account types (class + normal side); the chart of accounts (ledger accounts, tree,
draft→active↔inactive→archived lifecycle, postable-only-when-active); fiscal years (open↔closed); accounting
periods (open→closed↔reopen→locked — the "no posting into a closed period" gate); currencies + lifecycle;
**exact-decimal FX rates**; entity-currency configuration (functional/presentation/transaction); cost centres +
hierarchy; analytical dimensions + values; tax codes + **exact-decimal effective-dated rates**; payment terms;
**versioned finance configuration** (draft → publish [immutable-after-publish, one-active per entity+scope,
idempotency-keyed] → supersession). All proven end-to-end in `m19-services.db-spec` (60) and over HTTP in
`api-finance.db-spec` (12).

## 6. Decimal-safety certification

**No floating-point arithmetic** for FX or tax rates: rates are accepted + returned as exact decimal STRINGS,
stored as NUMERIC (never REAL/FLOAT/DOUBLE PRECISION — **0 float columns**), and never parsed through
`Number`/`parseFloat` in the persistence path. A high-precision round-trip through NUMERIC(30,12) preserved
`123456789012.123456789012` (24 significant digits) exactly. The services spec asserts a recorded rate string is
returned verbatim, and a payload scan proves **no monetary amount or balance appears in any event or audit
payload**. m19 stores no journal amounts or ledger balances (ADR-007/078).

## 7. Security, tenancy & permissions

Default-deny: every mutation `authz.require`s its three-segment `finance.*` permission; over HTTP an anonymous
caller is **401**, an unprivileged caller with a forged `x-permissions` header is **403**, a cross-tenant GET is
**404**. **45** permissions (**16** privileged — account.archive / fiscal_year.close+reopen / period.close+lock+
reopen / currency.manage / exchange_rate.manage / tax.manage / config.manage+publish / analytics.export /
platform); no vague `finance.admin`; enforcement lives server-side in the services (not only controllers). The
permission registry matches the source `M19_PERMISSIONS` constants and the seed. Cross-tenant reads/lists/actions
are denied through the non-owner `finapp_app` role (NOLOGIN, NOBYPASSRLS) — FORCE RLS binds it.

## 8. Audit & events

**34** `FIN_` audit codes (all ≥ 3 segments; prefix shared with m23, no collision) written through the m03 AUDIT
port in the business transaction; `registered_code_count` = **520** = len(codes). One event family
`finance.lifecycle` (**33** types, v1) published on the **single m06 outbox** (every event carries `family =
finance.lifecycle`, ordering key = aggregate id `recordId`, consumers dedupe on `eventId`);
`DOMAIN_EVENT_FAMILIES` = **16**. The downstream finance families (`reconciliation.lifecycle`, `glrecon.lifecycle`,
`journal.lifecycle`, `approval.lifecycle`, `posting_request.lifecycle`) are **NOT** owned by m19. Audit + event
payloads carry ids, codes, states and dates only — never monetary amounts or balances.

## 9. Lifecycle, idempotency & concurrency

Ledger-account, accounting-period, fiscal-year and finance-config transitions each go through a single service
choke point (`checkAccountTransition` / `checkPeriodTransition` / `checkFiscalYearTransition` /
`checkConfigTransition`); illegal transitions (reactivate-archived, reopen-locked, publish-from-draft-jump,
edit-published) are rejected. Config is immutable-after-publish + one-active per entity+scope; supersession creates
`version_number + 1`, marks the prior superseded, links the successor. Idempotency: config idempotency key +
exchange-rate natural key (base, quote, type, date) — a replay returns the existing row. Optimistic concurrency:
single-winner CAS (`WHERE version = $expected`) returning null on stale → conflict, proven by a stale-write
rejection.

## 10. API certification

The `/api/v1/finance` surface — **38** mutating routes (each `@Endpoint` permission + FIN_ audit code) + **21**
read routes across four controllers — was exercised by booting the REAL AppModule over HTTP: register entity →
account type → currency; create ledger account → activate; create fiscal year → period → close (period.close);
create config → publish (config.publish); record + read back an exact-decimal FX rate (string); plus 401/403 +
cross-tenant isolation. Exact-decimal rate handling has no precision loss on the wire.

## 11. Authoritative CI (PostgreSQL 16)

Implementation PR #35 (head `712e0a1`, merge `b0f86f8`): **Smoke lane ✅ success** + **DB lane (PostgreSQL 16) ✅
success** on the full head SHA. The certification PR re-runs both lanes on the certification head — recorded green
before this record is considered final.

## 12. Repository-derived counts

| Item | Count |
| --- | --- |
| Migrations (m19 / replayed) | **2** / **32** |
| Tables | **18** |
| FORCE RLS tables | **18** |
| Append-only ledgers | **3** |
| Composite FKs (single-column) | **23** (**0**) |
| Float columns | **0** |
| Permissions (privileged) | **45** (**16**) |
| Audit codes (m19) | **34** |
| Registered audit codes (total) | **520** |
| Event types (`finance.lifecycle`) | **33** |
| Event families | **16** |
| Mutating routes / read routes | **38** / **21** |
| ADRs | **4** (ADR-077…080) |
| Smoke suites / assertions | **22** / **4238** |
| Conformance assertions | **2280** |
| DB + API specs / assertions | **43** / **1410** |

## 13. Ownership-boundary certification

M19 owns **only** the finance foundation: entities, account types, chart of accounts, fiscal calendar, currencies +
FX reference rates, entity currencies, cost centres, analytical dimensions, tax reference data, payment terms,
versioned finance configuration. It implements **none** of: journals, journal lines/batches, postings, ledger/
double-entry posting, bank reconciliation, matching, GL reconciliation, approval workflow, posting approval,
finance integrations, payments, receivables, payables, cash management, treasury, budgeting, invoicing,
collections, AI, embeddings, vector/semantic search, legal-domain, or M15/M15a/M20/M21/M22/M23/M24+ functionality.
Every real SQL table reference is `finance_*`; the migration creates only `finance_*` tables.

## 14. Contamination verdict — CLEAN

Only `m19-finance` (+ its API wiring, registries, contracts family, tests, docs) is present. No journals, postings,
reconciliation, GL reconciliation, approval workflow, finance integration, payments, AR/AP, cash management, AI, or
later-module code; no Legal (M14/M16/M17/M18) duplication; no historical migration edited; no duplicated shared
platform service; no second outbox; no hidden floating-point finance arithmetic; no event/audit payload monetary
leakage. On the certification branch the only changes are this report + the manifest certification record.

## 15. Known limitations (deferred, documented — not defects)

Out of M19's scope: M15/M15a reconciliation + matching, M20 GL reconciliation, M21 journals + postings, M22
approvals, M23 finance integrations, payments, receivables, payables, cash management, and AI. Analytics/export +
platform-administer permissions are seeded for forward use but have no route in this foundation layer yet.

## Verdict

**CERTIFIED ON BRANCH.** All gates green from a clean checkout of merged `main`; tree byte-identical to the
reviewed head; capability, database, API, security, tenancy, permission, audit, event, lifecycle, decimal-safety,
idempotency, concurrency, ownership-boundary and contamination checks all pass. The certification PR is open and
**not merged**.
