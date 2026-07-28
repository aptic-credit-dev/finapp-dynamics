# Stage 4.2 — M16 Enterprise Litigation Management — Completion Report

**Module:** `m16-litigation` · **Package:** `@finapp/m16-litigation` · **Branch:**
`feature/stage-4-2-m16-litigation-management` · **Baseline:** certified Stage 4.1 main
`b6660a037a6e25717e0b7a48e6d9baf9bde3d9e0` (cert PR #25). **Status:** implemented on branch; all local gates green,
**not merged** (stopped before merge); PR + post-merge certification are the next steps.

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified-pending** = to be observed green on the authoritative PostgreSQL 16 CI lane · **not yet
merged** · **deferred** = documented, out of scope.

## What was built

A generic, multi-tenant **enterprise litigation & adjudicative-proceedings platform** — a governed refer → review
→ file → serve → litigate → decide → comply/appeal → conclude engine for court and tribunal proceedings, parties
and claims, filings and service, appearances and the proceeding record, witnesses, experts and exhibits, hearing
bundles, orders, compliance obligations, outcomes, appeals, deadline and **limitation** control, litigation costs
and relationships. Nothing is Kenya-specific: proceeding types, jurisdictions, forums, courts, tribunals, statutes
and procedural rules are **configurable data**, never hardcoded. It is **not** a general ledger, an accounts-
payable or payment engine, a recovery/enforcement or collections-accounting engine (M17), a precedent/knowledge or
AI-research tool (M18), a court e-filing/scraping integration, or an external-counsel or customer portal. M16 owns
full adjudicative **proceedings**; M14 owns the legal **matter** and refers it inbound through a governed contract.

- **PURE domain** (`src/domain/`): limits + vocab; the proceeding (30-state) + spec state machines; proceeding-type
  spec + SLA-policy spec validation (versioned, one-active, immutable-after-publish); deterministic clock/date-
  driven SLA + deadline + limitation math; the closure eligibility gate (machine-readable reason codes);
  relationship rules.
- **Clock port** (`ports.ts`): SLA + deadline + limitation math is deterministic via an injected `Clock`
  (`SystemClock` + `FixedClock`) — no ambient `Date.now`, no ambient calendar; `limitation` deadlines are
  high-risk and clearly distinguishable (`isLimitation` / `isLimitationSafe`); timer dispatch + escalation delegate
  to m06/m08. Decisioning (risk classification, SLA selection, closure eligibility) delegates to m07 rules via a
  recorded `ruleEvaluationId` — **rules never mutate a proceeding**. The M14 referral is consumed fire-and-forget
  through the `MatterReferral` inbound contract; m16 never reads m14's tables.
- **Persistence** (`0001`/`0002`, **25 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs, **NO DELETE grant anywhere**): `litigation_proceeding_type`,
  `litigation_sla_policy` (versioned, one-active per code+scope, immutable-after-publish), `litigation_proceeding`
  (core aggregate; SENSITIVE legal strategy; 30-state lifecycle CHECK), `litigation_referral` (M14 idempotency
  ledger keyed on `referral_key`, one proceeding per key), `litigation_status_history`,
  `litigation_assignment_history`, `litigation_party`, `litigation_claim`, `litigation_filing` (maker-checker + the
  `litigation_filing_sod_ck` DB CHECK), `litigation_service` (single-winner verification), `litigation_appearance`,
  `litigation_proceeding_record`, `litigation_witness`, `litigation_expert`, `litigation_exhibit` (single-winner
  admission), `litigation_bundle` (maker-checker + the `litigation_bundle_sod_ck` DB CHECK),
  `litigation_bundle_item`, `litigation_order`, `litigation_compliance_obligation`, `litigation_outcome`,
  `litigation_appeal` (one-active per proceeding), `litigation_deadline`, `litigation_cost_reference`,
  `litigation_note`, `litigation_relationship`. **7 append-only ledgers** (`litigation_referral`,
  `litigation_status_history`, `litigation_assignment_history`, `litigation_proceeding_record`,
  `litigation_order`, `litigation_outcome`, `litigation_note`) are INSERT+SELECT only.
- **Services**: `CatalogService` (versioned proceeding types + SLA policies), `ProceedingService` (referral intake
  incl. idempotent M14 referral, review, approval-to-file, assignment, the full lifecycle, closure, reopening),
  `LitigationWorkService` (parties, claims, filings maker-checker, service single-winner, appearances, the
  proceeding record, witnesses, experts, exhibits single-winner, bundles maker-checker + items, orders, compliance,
  outcomes, appeals, deadlines, costs, notes, relationships, analytics). One `M16Emitter` writes audit (m03) +
  events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/litigation`): proceeding types, SLA policies, referral intake (incl. M14 referral), review,
  approval-to-file, assignment, the full proceeding lifecycle, parties, claims, filings (maker-checker), service
  (single-winner), appearances, the proceeding record, witnesses, experts, exhibits (single-winner), bundles
  (maker-checker) + items, orders, compliance obligations, outcomes, appeals, deadlines, costs, notes,
  relationships, closure/reopening, analytics across three controllers (catalog, proceedings, litigation). Every
  mutating route declares a permission (default deny); sensitive fields redacted in views.

## Scope

| Fact | Value |
|---|---|
| Source added | `packages/m16-litigation` (domain, ports, repository, emit, 3 services) + `apps/api/src/litigation` (views + 3 controllers + module) + registries/contracts/tests/docs |
| Migrations | **2** for m16 (`0001`, `0002`); **26** total in the repo, m16 last |
| Tables created | **25** |
| Permissions added | **56** (`litigation.*` three-segment; **20** privileged incl. strategy / pleadings / witness-statements / submissions / witness-contact / party-contact / confidential-terms / filing-approve / bundle-approve / config / platform) — seeded |
| Audit codes added | **58** (`LITIGATION_*` SCREAMING_SNAKE, all ≥ 3 segments) |
| Events added | **ONE** family — `litigation.lifecycle` (**36** event types, version 1); contracts `DomainEvent` union / `DOMAIN_EVENT_FAMILIES` **12 → 13** families |
| Services / controllers | **3** services (Catalog / Proceeding / LitigationWork); **3** controllers (catalog, proceedings, litigation) |
| Lifecycle | **30** proceeding states (`draft`, `referred`, `under_review`, `approved_to_file`, `awaiting_filing`, `filed`, `awaiting_service`, `served`, `awaiting_response`, `pleadings_open`, `case_management`, `directions`, `pre_trial`, `hearing_scheduled`, `hearing`, `submissions`, `decision_pending`, `ruling_delivered`, `judgment_delivered`, `appeal_pending`, `on_appeal`, `compliance`, `stayed`, `settled`, `withdrawn`, `dismissed`, `concluded`, `closed`, `reopened`, `archived`); explicit transitions, append-only `litigation_status_history` evidence; `archived` is terminal |
| ADRs | ADR-065…068 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **25** tables; composite `(tenant_id,id)` keys + composite FKs; asserted through the non-owner app role (`finapp_app`). |
| Authorization | Default-deny; every mutation `authz.require`s its three-segment `litigation.*` permission; a header cannot grant authority (proven over HTTP). **20** privileged permissions gate strategy/pleadings/witness-statements/submissions/witness-contact/party-contact/confidential-terms/filing-approve/bundle-approve/config surfaces. |
| Sensitivity / redaction | Legal strategy, full pleadings, witness statements, full submissions, private witness/party contacts and confidential order/outcome terms stored under RLS, REDACTED on read unless the caller holds the dedicated privileged permission; reading un-redacted privileged data is itself audited; NEVER in events or audit payloads (ids, states, dates and safe reason codes only); no document storage references in API responses (ADR-068). |
| Maker-checker / SoD | Filing + bundle approval require preparer ≠ approver, enforced in `LitigationWorkService` AND the DB CHECKs `litigation_filing_sod_ck` / `litigation_bundle_sod_ck`; self-approve → 409, an independent approver succeeds (proven in services + HTTP specs). |
| Single-winner CAS | Service verification (`verification_status`) and exhibit admission (`admitted_status`) are single-winner — two concurrent attempts yield exactly one winner (proven in services). |
| Immutability | Published proceeding-type + SLA-policy specs frozen (one-active per code+scope, immutable-after-publish); referral/status/assignment/proceeding-record/order/outcome/note ledgers append-only. |
| Versioned specs | Proceeding types + SLA policies are versioned with exactly one ACTIVE version; declarative config; decisioning delegated to m07 via a recorded `ruleEvaluationId` — rules never mutate a proceeding (ADR-065). |
| Deterministic SLA / deadlines / limitation | SLA start materializes stage deadlines (no bespoke SLA-instance table); all dates computed from an injected `Clock` — no ambient `Date.now` (ADR-066); a `FixedClock` proves deterministic deadline + limitation breach; `limitation` deadlines are high-risk + distinguishable; timer dispatch/escalation delegate to m06/m08. |
| Finance references only | Litigation costs store court + finance **references** only (integer minor units as reference data) — no accounts payable, general ledger, journal posting, payment execution, tax, reconciliation or collections accounting (ADR-067). |
| M14 referral | Fire-and-forget over the `MatterReferral` inbound contract; idempotent single-proceeding creation via the `litigation_referral` unique ledger keyed on `referral_key`; preserves the source matter id + correlation/causation; m16 **never reads m14-owned tables**; a matter may be referred several times (several proceedings). Duplicate referrals on a key create no second proceeding. |
| Downstream boundaries | M17 enforcement + M18 knowledge reached only by safe boundary events (`EnforcementReferralReady`, `KnowledgeCandidateCreated`) — no M17/M18 internals crossed. |
| Append-only evidence | The 7 ledgers INSERT+SELECT only (0 UPDATE grant); NO DELETE on any m16 table. |
| Idempotency | DB-enforced on proceeding-number and the M14 referral (unique `litigation_referral` ledger); conflict → existing proceeding. |
| Single outbox | m16 owns no outbox; publishes `litigation.lifecycle` through m06's outbox. |
| Sensitive-data minimisation | Audit + events carry ids, states, dates and safe reason codes only — never legal strategy, pleadings, witness statements, submissions, party contacts or confidential order/outcome terms (ADR-068). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean (**exit 0**). **Lint:** `eslint` **0 errors** (**46** style warnings, matching the
  certified baseline pattern), on a wiped `dist`. **Format:** `prettier --check` clean.
- **Smoke lane (tested locally):** **19 suites, 3401 assertions, 0 failed** — including `m16-litigation` (**71**),
  `conformance` (**1680**, validating every `@Endpoint` permission + audit code against the registries, the RLS
  convention over the new migrations, `registered_code_count`=len(codes), and the newly-registered
  `litigation.lifecycle` family), and `migrate` (**26**).
- **Migrations (tested locally):** **26** in dependency order, applied on a fresh PostgreSQL from an empty database
  (dry-run + fresh replay); m16 last.
- **DB + API lane (tested locally, real PostgreSQL 15.2, roles `finapp_app` + `finapp_owner`):** **34 specs, 978
  assertions, 0 failed** — `m16-litigation.db-spec` (**41**), `m16-services.db-spec` (**40**),
  `api-litigation.db-spec` (**21** HTTP end-to-end), and the whole prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **CI-verified-pending** at the
  time of writing.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**.

## Live DB governance verified

25/25 litigation tables RLS ENABLE+FORCE + `tenant_isolation` + composite `(tenant_id,id)` PK; **0 DELETE grants**
for the app role; the 7 append-only ledgers have **0 UPDATE grant**; **24** composite FKs; **56** permissions
seeded (**20** privileged); proceeding-number + M14-referral idempotency uniqueness; one-active proceeding-type/
SLA-policy; filing + bundle SoD CHECKs (`litigation_filing_sod_ck` / `litigation_bundle_sod_ck`); single-winner
service verification + exhibit admission; one-active appeal per proceeding; relationship self-edge CHECK +
composite FK; only `workflow_event_outbox` exists (**m16 owns no outbox**).

## Bug found + fixed by the DB spec

The DB spec caught **one real bug**: `acceptReferral` used the text `referral_key` as a `causation_id` uuid
fallback (an invalid uuid) — **fixed to `null`**. The spec was extended to guard the regression.

## Limitations (deferred, documented — not defects)

- **No M17 internals** — recovery / enforcement allocation / debtor ledger / payment plans / attachment / auction /
  garnishee / collections accounting remain the downstream M17 stage; m16 emits only the safe `EnforcementReferralReady`
  boundary signal.
- **No M18 internals** — precedent repository / knowledge graph / AI research / summarization / drafting remain the
  downstream M18 stage; m16 emits only the safe `KnowledgeCandidateCreated` boundary signal.
- **No finance foundation / general ledger / accounts payable / payment execution / journal posting / tax /
  reconciliation / collections accounting** — litigation costs store court + finance references only (ADR-067); the
  finance foundation is a later stage.
- **No production e-filing / court scraping / court calendar**, no production telephony/SMS/email providers — timer
  dispatch + notifications delegate to m06/m08 (Framework Only).
- **No AI legal research/summarization/drafting/decisioning** — classification and decisioning are human/rule-driven
  (m07), never AI outputs.
- **No external-counsel or customer or witness portal, no vendor-management platform, no full regulatory-reporting
  engine.**

## Spec divergence (recorded)

This implementation lands at **25 tables**, making the proceeding a first-class object — distinct from an M14
matter's court-event/deadline fields — with its own versioned proceeding types + SLA policies, the M14 referral
ledger, status + assignment ledgers, and the full litigation work surface. The scope decisions (25 tables; the
proceeding as a first-class object; the governed M14→M16 inbound contract; finance/M17/M18/AI/portal excluded) are
captured in **ADR-065…068** and this report.

## Scope discipline (contamination)

Only `m16-litigation` (+ its API wiring, registries, contracts family, tests, docs) was built. No M17/M18
internals, finance, general-ledger, accounts-payable, payment, reconciliation, court-filing/scraping or AI
implementation; m16 reads none of m14's tables (the referral flows fire-and-forget through the `MatterReferral`
inbound contract). No shared platform service was duplicated; no second outbox; no duplicate audit table; no second
RBAC or escalation engine. The manifest change is confined to the m16 block. The implementation is on the branch;
it is **not merged** — the PR + post-merge PostgreSQL 16 certification are the next steps.
