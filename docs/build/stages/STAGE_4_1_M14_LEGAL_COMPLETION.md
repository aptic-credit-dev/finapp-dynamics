# Stage 4.1 — M14 Enterprise Legal Matter Management — Completion Report

**Module:** `m14-legal` · **Package:** `@finapp/m14-legal` · **Branch:** `feature/stage-4-1-m14-legal-matters`
· **Baseline:** certified Stage 3.2 main `12628451a9b4427724d08adbca8b9d626160aa92` (cert PR #23).
**Status:** implemented on branch; all local gates green, **not merged** (stopped before merge); PR + post-merge
certification are the next steps.

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified-pending** = to be observed green on the authoritative PostgreSQL 16 CI lane · **not yet
merged** · **deferred** = documented, out of scope.

## What was built

A generic, multi-tenant **enterprise legal-matter platform** — a governed instruct → open → work →
litigate/negotiate → resolve → close engine for litigation, disputes, regulatory and enforcement matters, pre-
action and negotiation/mediation/arbitration tracking, pleadings and court events, deadline and **limitation**
control, external-counsel management, costs/exposure and outcomes. Nothing is Aptic- or Kenya-specific: matter
types, jurisdictions, forums/courts, statutes, firms, advocates, SLA policies and deadlines are **configurable
data**, never hardcoded. It is **not** a general ledger, an accounts-payable or payment engine, a court-filing/
scraping integration, an AI legal-research tool, an external-counsel or customer portal, or the M16/M17/M18
modules. M14 owns full legal **matters**; M13 owns case-management **support** and emits `case.converted_to_matter`
for M14 to consume idempotently.

- **PURE domain** (`src/domain/`): limits + vocab; the matter (25-state) + spec state machines; matter-type spec +
  SLA-policy spec validation (versioned, one-active, immutable-after-publish); deterministic clock/date-driven SLA
  + deadline + limitation math; the closure eligibility gate (machine-readable reason codes); relationship rules.
- **Clock port** (`ports.ts`): SLA + deadline + limitation math is deterministic via an injected `Clock`
  (`SystemClock` + `FixedClock`) — no ambient `Date.now`, no ambient calendar; `limitation` deadlines are
  high-risk and clearly distinguishable (`isLimitation` / `isLimitationSafe`); timer dispatch + escalation delegate
  to m06/m08. Decisioning (risk classification, SLA selection, closure eligibility) delegates to m07 rules via a
  recorded `ruleEvaluationId` — **rules never mutate a matter**. The M13 conversion is consumed fire-and-forget
  through the `CaseConversion` seam; m14 never reads m13's tables.
- **Persistence** (`0001`/`0002`, **25 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs, **NO DELETE grant anywhere**): `legal_matter_type`, `legal_sla_policy`
  (versioned, one-active per code+scope, immutable-after-publish), `legal_jurisdiction`, `legal_matter` (core
  aggregate; SENSITIVE legal positions/strategy; 25-state lifecycle CHECK), `legal_case_conversion` (M13
  idempotency ledger keyed on `source_case_id`), `legal_matter_status_history`, `legal_assignment_history`,
  `legal_instruction`, `legal_party`, `legal_activity`, `legal_task`, `legal_issue`, `legal_position`,
  `legal_opinion`, `legal_research_reference`, `legal_pleading`, `legal_court_event`, `legal_deadline`,
  `legal_external_counsel`, `legal_counsel_report`, `legal_cost_reference`, `legal_settlement` (maker-checker + the
  `legal_settlement_sod_ck` DB CHECK), `legal_outcome`, `legal_note`, `legal_relationship`. **6 append-only
  ledgers** (`legal_matter_status_history`, `legal_assignment_history`, `legal_case_conversion`,
  `legal_counsel_report`, `legal_outcome`, `legal_note`) are INSERT+SELECT only.
- **Services**: `CatalogService` (versioned matter types + SLA policies + jurisdictions), `MatterService` (intake
  incl. idempotent M13 conversion, instruction, triage, assignment, the full lifecycle, closure, reopening),
  `MatterWorkService` (parties, activities, tasks, issues, pleadings, court events, deadlines, research, notes),
  `MatterLegalService` (positions, opinions, external counsel + reports, costs, settlement maker-checker, outcomes,
  relationships, analytics). One `M14Emitter` writes audit (m03) + events on the **one outbox m06 owns**, in the
  business tx.
- **API** (`/api/v1/legal`): matter types, SLA policies, jurisdictions, intake (incl. M13 conversion), instruction,
  triage, assignment, the full matter lifecycle, parties, activities, tasks, issues, positions, opinions, research,
  pleadings, court events, deadlines, external counsel + reports, costs, settlement (maker-checker), outcomes,
  notes, relationships, closure/reopening, analytics across four controllers (catalog, matters, work, legal).
  Every mutating route declares a permission (default deny); sensitive fields redacted in views.

## Scope

| Fact | Value |
|---|---|
| Source added | `packages/m14-legal` (domain, ports, repository, emit, 4 services) + `apps/api/src/legal` (views + 4 controllers + module) + registries/contracts/tests/docs |
| Migrations | **2** for m14 (`0001`, `0002`); **24** total in the repo, m14 last |
| Tables created | **25** |
| Permissions added | **70** (`legal.*` three-segment; **23** privileged incl. positions / opinions / privileged-notes / party-contact / confidential-settlement / settlement-approve / config / platform) — seeded |
| Audit codes added | **55** (`LEGAL_*` SCREAMING_SNAKE, all ≥ 3 segments); `registered_code_count` **263 → 318** |
| Events added | **ONE** family — `legal.lifecycle` (**36** event types, version 1); contracts `DomainEvent` union / `DOMAIN_EVENT_FAMILIES` **11 → 12** families |
| Services / controllers | **4** services (Catalog / Matter / MatterWork / MatterLegal); **4** controllers (catalog, matters, work, legal) |
| Lifecycle | **25** matter states (`draft`, `instructed`, `opened`, `legal_review`, `awaiting_information`, `pre_action`, `negotiation`, `mediation`, `arbitration`, `filed`, `awaiting_service`, `active_litigation`, `hearing`, `judgment_pending`, `judgment_entered`, `appeal_pending`, `on_appeal`, `settlement_pending`, `settled`, `enforcement`, `resolved`, `closed`, `reopened`, `withdrawn`, `archived`); explicit transitions, append-only `legal_matter_status_history` evidence; `archived` is terminal |
| ADRs | ADR-061…064 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **25** tables; composite `(tenant_id,id)` keys + composite FKs; asserted through the non-owner app role (`finapp_app`). |
| Authorization | Default-deny; every mutation `authz.require`s its three-segment `legal.*` permission; a header cannot grant authority (proven over HTTP). **23** privileged permissions gate positions/opinions/privileged-notes/party-contact/confidential-settlement/approval/config surfaces. |
| Sensitivity / redaction | Legal positions/strategy, opinions, privileged notes, party contacts and confidential settlement terms stored under RLS, REDACTED on read unless the caller holds the dedicated privileged permission; reading un-redacted privileged data is itself audited; NEVER in events or audit payloads (ids, states, dates and safe reason codes only); no document storage references in API responses (ADR-064). |
| Maker-checker / SoD | Settlement approval requires proposer ≠ approver, enforced in `MatterLegalService` AND the DB CHECK `legal_settlement_sod_ck`; self-approve → 409, an independent approver succeeds (proven in services + HTTP specs). |
| Immutability | Published matter-type + SLA-policy specs frozen (one-active per code+scope, immutable-after-publish); status/assignment/conversion/counsel-report/outcome/note ledgers append-only. |
| Versioned specs | Matter types + SLA policies + jurisdictions are versioned with exactly one ACTIVE version; declarative config; decisioning delegated to m07 via a recorded `ruleEvaluationId` — rules never mutate a matter (ADR-061). |
| Deterministic SLA / deadlines / limitation | SLA start materializes stage deadlines (no bespoke SLA-instance table); all dates computed from an injected `Clock` — no ambient `Date.now` (ADR-062); a `FixedClock` proves deterministic deadline + limitation breach; `limitation` deadlines are high-risk + distinguishable; timer dispatch/escalation delegate to m06/m08. |
| Finance references only | Costs, exposure + enforcement store finance + court **references** only (integer minor units as reference data) — no general ledger, accounts payable, journal posting, payment execution, tax, reconciliation or collections accounting (ADR-063). |
| M13 conversion | Fire-and-forget over `case.converted_to_matter`; idempotent single-matter creation via the `legal_case_conversion` unique ledger keyed on `source_case_id`; preserves the originating case id + correlation; m14 **never reads m13-owned tables**. Duplicate conversion events create no second matter. |
| Append-only evidence | The 6 ledgers INSERT+SELECT only (0 UPDATE grant); NO DELETE on any m14 table. |
| Idempotency | DB-enforced on matter-number and the M13 conversion (unique `legal_case_conversion` ledger); conflict → existing matter. |
| Single outbox | m14 owns no outbox; publishes `legal.lifecycle` through m06's outbox. |
| Sensitive-data minimisation | Audit + events carry ids, states, dates and safe reason codes only — never legal positions, opinions, note bodies, party contacts or confidential settlement terms (ADR-064). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean (**exit 0**). **Lint:** `eslint` **0 errors** (pre-existing non-blocking warnings
  only), on a wiped `dist`. **Format:** `prettier --check` clean.
- **Smoke lane (tested locally):** **18 suites, 3092 assertions, 0 failed** — including `m14-legal` (**60**),
  `conformance` (**1448**, validating every `@Endpoint` permission + audit code against the registries, the RLS
  convention over the new migrations, `registered_code_count`=len(codes), and the newly-registered `legal.lifecycle`
  family), and `migrate` (**26**).
- **Migrations (tested locally):** **24** in dependency order, applied on a fresh PostgreSQL from an empty database
  (dry-run + fresh replay); m14 last.
- **DB + API lane (tested locally, real PostgreSQL 15.2, roles `finapp_app` + `finapp_owner`):** **31 specs, 876
  assertions, 0 failed** — `m14-legal.db-spec` (**40**), `m14-services.db-spec` (**30**), `api-legal.db-spec`
  (**23** HTTP end-to-end), and the whole prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **CI-verified-pending** at the
  time of writing.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**.

## Live DB governance verified

25/25 legal tables RLS ENABLE+FORCE + `tenant_isolation`; **0 DELETE grants** for the app role; the 6 append-only
ledgers have **0 UPDATE grant**; **70** permissions seeded (**23** privileged); matter-number + M13-conversion
idempotency uniqueness; one-active matter-type/SLA-policy/jurisdiction; settlement SoD CHECK
(`legal_settlement_sod_ck`); relationship self-edge CHECK + composite FK.

## Limitations (deferred, documented — not defects)

- **No finance foundation / general ledger / accounts payable / payment execution / journal posting / tax /
  reconciliation / collections accounting** — costs, exposure + enforcement store finance + court references only
  (ADR-063); the finance foundation is a later stage.
- **No production court-filing/scraping**, no production calendar/telephony/SMS/email providers — timer dispatch +
  notifications delegate to m06/m08 (Framework Only).
- **No AI legal research/summarization/drafting/decision-making** — classification and decisioning are
  human/rule-driven (m07), never AI outputs.
- **No external-counsel or customer portal, no vendor-management platform, no full regulatory-reporting engine.**
- **No M16/M17/M18 internals** — those remain downstream stages.

## Spec divergence (recorded)

The module-registry reference baseline is **23** tables; this implementation lands at **25 tables**, making the
matter a first-class object (its own versioned matter types + SLA policies + jurisdictions, the M13 conversion
ledger, status + assignment ledgers, and the full legal work surface). The divergence (25 vs 23 tables; enterprise
expansion; finance/AI/portal excluded) is captured in **ADR-061…064** and this report.

## Scope discipline (contamination)

Only `m14-legal` (+ its API wiring, registries, contracts family, tests, docs) was built. No M16/M17/M18, finance,
general-ledger, accounts-payable, payment, reconciliation, court-filing/scraping or AI implementation; m14 reads
none of m13's tables (the conversion flows fire-and-forget through `case.converted_to_matter`). No shared platform
service was duplicated; no second outbox; no duplicate audit table; no second RBAC or escalation engine. The
manifest change is confined to the m14 block. The implementation is on the branch; it is **not merged** — the PR +
post-merge PostgreSQL 16 certification are the next steps.
