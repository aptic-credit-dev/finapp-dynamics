# Stage 4.2 — M16 Enterprise Litigation Management — Architecture

**Module:** `m16-litigation` · **Package:** `@finapp/m16-litigation` · **Branch:**
`feature/stage-4-2-m16-litigation-management` · **Baseline:** certified Stage 4.1 main `b6660a03` (cert PR #25).
**ADRs:** ADR-065…068.

## Purpose & boundary

One generic, multi-tenant **enterprise litigation & adjudicative-proceedings platform** for court and tribunal
proceedings — parties and claims, filings and service, appearances and the proceeding record, witnesses, experts
and exhibits, hearing bundles, orders, compliance obligations, outcomes, appeals, deadline and **limitation**
control, litigation costs and relationships — a governed refer → review → file → serve → litigate → decide →
comply/appeal → conclude engine with configurable SLA and deadlines, escalation, evidence and audit. It is **not**
a general ledger, an accounts-payable or payment engine, a recovery/enforcement or collections-accounting engine
(M17), a precedent/knowledge or AI-research tool (M18), a court e-filing/scraping integration, or an external-
counsel or customer portal (see Exclusions). M16 owns full adjudicative **proceedings**; M14 owns the legal
**matter** and refers it inbound. Nothing is Kenya-specific: proceeding types, jurisdictions, forums, courts,
tribunals, statutes and procedural rules are **configurable data**, never hardcoded. It consumes shared services
via kernel tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and owns no shared service.

## Shape (mirrors m07/m08/m09/m12/m13/m14)

- **PURE domain** — proceeding + spec state machines; proceeding-type spec + SLA-policy spec validation (versioned,
  immutable-after-publish, one-active); deterministic clock/date-driven SLA + deadline + limitation math; closure
  eligibility gate returning machine-readable reason codes; relationship rules. No I/O; exhaustively unit-tested.
- **Clock port** — SLA, deadline and limitation math is deterministic via an injected `Clock` (`SystemClock`/
  `FixedClock`); no ambient `Date.now`, no ambient calendar. `limitation` deadlines are high-risk and clearly
  distinguishable from ordinary procedural deadlines (ADR-066). Decisioning (risk classification, SLA selection,
  closure eligibility) delegates to m07 rules via a recorded `ruleEvaluationId` — rules never mutate proceedings.
- **25 tables** — versioned `litigation_proceeding_type` + `litigation_sla_policy` (one-active, immutable-after-
  publish); the `litigation_proceeding` core aggregate (SENSITIVE legal strategy; 30-state lifecycle);
  `litigation_referral` (M14 idempotency ledger, one proceeding per referral key); append-only
  `litigation_status_history` + `litigation_assignment_history`; parties, claims; `litigation_filing` (maker-checker
  SoD CHECK), `litigation_service` (single-winner verification), appearances; append-only
  `litigation_proceeding_record`; witnesses, experts, `litigation_exhibit` (single-winner admission),
  `litigation_bundle` (maker-checker SoD CHECK) + bundle items; append-only `litigation_order`; compliance
  obligations, append-only `litigation_outcome`, `litigation_appeal` (one-active per proceeding); deadlines, cost
  references, append-only `litigation_note`, and `litigation_relationship`. All composite `(tenant_id,id)`, RLS
  ENABLE+FORCE + `tenant_isolation`, no-DELETE, append-only ledgers INSERT+SELECT only.
- **Services** — Catalog / Proceeding / LitigationWork, each permissioned + transactional, audit + outbox in the
  business tx via one `M16Emitter`.
- **API** `/api/v1/litigation` — proceeding types, SLA policies, referral intake (incl. the M14 matter referral),
  review, approval-to-file, assignment, the full proceeding lifecycle, parties, claims, filings (maker-checker),
  service (single-winner), appearances, the proceeding record, witnesses, experts, exhibits (single-winner),
  bundles (maker-checker) + items, orders, compliance obligations, outcomes, appeals, deadlines, costs, notes,
  relationships, closure/reopening, analytics.

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| Configurable config + inbound contract | proceeding types + SLA policies are declarative versioned data; proceeding types, forums, courts, tribunals, statutes, procedural rules are tenant-configurable — nothing Kenya-specific in core; decisioning delegated to m07 via a recorded `ruleEvaluationId`; the M14→M16 boundary is a governed `MatterReferral` inbound contract + `/litigation/from-matter`, idempotent on a referral key (one proceeding per key; a matter may be referred several times), and m16 never reads m14-owned tables | 065 |
| Deterministic time | SLA + deadline + limitation math is deterministic via a `Clock` port; no ambient `Date.now`, no production calendar; `limitation` deadlines high-risk + distinguishable; hard limits fail-closed; 25 tables (the proceeding as a first-class object, distinct from an M14 matter's court-event/deadline fields); timers delegate to m06/m08 | 066 |
| Finance references only | litigation costs store court + finance **references** only — no accounts payable, general ledger, journal posting, payment execution, tax, reconciliation or collections accounting (those are M17/finance, later stages) | 067 |
| Privilege/confidentiality + controls | legal strategy, full pleadings, witness statements, full submissions, private witness/party contacts + confidential order/outcome terms stored under RLS, REDACTED on read behind privileged permissions, and NEVER in events/audit; maker-checker on filing + bundle (approver ≠ preparer, DB CHECK); single-winner CAS on service verification + exhibit admission; downstream M17/M18 reached only by safe boundary events | 068 |

## Integration (reuse, no duplicate engines)

m06 workflow orchestrates review/approval/closure gates and owns the single outbox; m07 rules consume typed
proceeding facts (type, risk, jurisdiction, forum — never raw legal strategy or party contact) for risk
classification, SLA selection and closure eligibility via a recorded `ruleEvaluationId`; m08 sends notifications
and drives escalation (no second escalation engine); m09 documents + evidence + bundles attach pleadings and
supporting material by reference (no bytes) — all through events/contracts and ports, never by importing their
internals. A notification/escalation failure never mutates a committed filing or a completed closure. M16
**consumes** the M14 matter referral through a governed `MatterReferral` inbound contract (`POST
/litigation/from-matter`), fire-and-forget, creating exactly one proceeding idempotently via the
`litigation_referral` ledger keyed on `referral_key` — a single matter may be referred several times, yielding
several proceedings; **m16 never reads m14-owned tables** and emits `ProceedingReferredFromMatter`. Downstream
**M17 enforcement** and **M18 knowledge** are reached only by safe boundary events (`EnforcementReferralReady`,
`KnowledgeCandidateCreated`) — no M17/M18 internals. The one family `litigation.lifecycle` (36 event types,
version 1) flows through the single m06 outbox (contracts `DOMAIN_EVENT_FAMILIES` grew 12 → 13).
