# Stage 4.1 — M14 Enterprise Legal Matter Management — Architecture

**Module:** `m14-legal` · **Package:** `@finapp/m14-legal` · **Branch:** `feature/stage-4-1-m14-legal-matters`
· **Baseline:** certified Stage 3.2 main `12628451` (cert PR #23). **ADRs:** ADR-061…064.

## Purpose & boundary

One generic, multi-tenant **enterprise legal-matter platform** for litigation, disputes, regulatory and
enforcement matters, pre-action and negotiation/mediation/arbitration tracking, pleadings and court events,
deadline and **limitation** control, external-counsel management, costs/exposure and outcomes — a governed
instruct → open → work → litigate/negotiate → resolve → close engine with configurable SLA and deadlines,
escalation, evidence and audit. It is **not** a general ledger, an accounts-payable or payment engine, a
court-filing/scraping integration, an AI legal-research tool, an external-counsel or customer portal, or the M16/
M17/M18 modules (see Exclusions). M14 owns full legal **matters**; M13 owns case-management **support** and emits
`case.converted_to_matter`, which M14 consumes idempotently. Nothing is Aptic- or Kenya-specific: matter types,
jurisdictions, forums/courts, statutes, firms, advocates, SLA policies and deadlines are **configurable data**,
never hardcoded. It consumes shared services via kernel tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and owns no
shared service.

## Shape (mirrors m07/m08/m09/m12/m13)

- **PURE domain** — matter + spec state machines; matter-type spec + SLA-policy spec validation (versioned,
  immutable-after-publish, one-active); deterministic clock/date-driven SLA + deadline + limitation math; closure
  eligibility gate returning machine-readable reason codes; relationship rules. No I/O; exhaustively unit-tested.
- **Clock port** — SLA, deadline and limitation math is deterministic via an injected `Clock` (`SystemClock`/
  `FixedClock`); no ambient `Date.now`, no ambient calendar. `limitation` deadlines are high-risk and clearly
  distinguishable from ordinary procedural deadlines (ADR-062). Decisioning (risk classification, SLA selection,
  closure eligibility) delegates to m07 rules via a recorded `ruleEvaluationId` — rules never mutate matters.
- **25 tables** — versioned `legal_matter_type` + `legal_sla_policy` (one-active, immutable-after-publish) +
  `legal_jurisdiction`; the `legal_matter` core aggregate (SENSITIVE legal positions/strategy; 25-state lifecycle);
  `legal_case_conversion` (M13 idempotency ledger); append-only `legal_matter_status_history` +
  `legal_assignment_history`; instructions, parties, activities, tasks, issues; legal `positions`, `opinions`,
  `research_reference`; `pleading`, `court_event`, `deadline`; `external_counsel` + append-only `counsel_report`;
  `cost_reference`, `settlement` (maker-checker), append-only `outcome`, append-only `note`, and `relationship`.
  All composite `(tenant_id,id)`, RLS ENABLE+FORCE + `tenant_isolation`, no-DELETE, append-only ledgers
  INSERT+SELECT only.
- **Services** — Catalog / Matter / MatterWork / MatterLegal, each permissioned + transactional, audit + outbox in
  the business tx via one `M14Emitter`.
- **API** `/api/v1/legal` — matter types, SLA policies, jurisdictions, intake (incl. M13 conversion), instruction,
  triage, assignment, the full matter lifecycle, parties, activities, tasks, issues, positions, opinions, research,
  pleadings, court events, deadlines, external counsel + reports, costs, settlement (maker-checker), outcomes,
  notes, relationships, closure/reopening, analytics.

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| Configurable config | matter types + SLA policies + jurisdictions/forums are declarative versioned data; matter types, courts, statutes, firms, advocates are tenant-configurable — nothing Aptic-/Kenya-specific in core; decisioning delegated to m07 via a recorded `ruleEvaluationId` — rules never mutate matters | 061 |
| Deterministic time | SLA + deadline + limitation math is deterministic via a `Clock` port; no ambient `Date.now`, no production calendar; `limitation` deadlines high-risk + distinguishable; hard limits fail-closed; 25 tables (matter as a first-class object) over the 23-table baseline; timers delegate to m06/m08 | 062 |
| Finance references only | costs, exposure + enforcement store finance + court **references** only — no general ledger, accounts payable, posting, payment execution, tax, reconciliation or collections accounting (finance is a later stage) | 063 |
| Privilege/confidentiality | legal positions/strategy, opinions, privileged notes, party contacts + confidential settlement terms stored under RLS, REDACTED on read behind privileged permissions, and NEVER in events/audit; M13→M14 conversion is fire-and-forget + idempotent (one matter per source case) | 064 |

## Integration (reuse, no duplicate engines)

m06 workflow orchestrates review/approval/closure gates and owns the single outbox; m07 rules consume typed matter
facts (type, risk, jurisdiction, forum — never raw legal position or party contact) for risk classification, SLA
selection and closure eligibility via a recorded `ruleEvaluationId`; m08 sends notifications and drives escalation
(no second escalation engine); m09 documents + evidence attach pleadings and supporting material by reference (no
bytes) — all through events/contracts and ports, never by importing their internals. A notification/escalation
failure never mutates a committed settlement or a completed closure. M14 **consumes** the versioned M13 conversion
(`case.converted_to_matter`) fire-and-forget, creating exactly one matter idempotently via the
`legal_case_conversion` ledger keyed on `source_case_id`; **m14 never reads m13-owned tables** (m13 emits, m14
consumes). The one family `legal.lifecycle` (36 event types, version 1) flows through the single m06 outbox
(contracts `DOMAIN_EVENT_FAMILIES` grew 11 → 12).
