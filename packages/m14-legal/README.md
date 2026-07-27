# m14-legal — Enterprise legal matter management (Stage 4.1)

A **generic, configurable, multi-tenant enterprise legal-matter platform** — litigation, disputes,
regulatory and enforcement matters, negotiation/mediation/arbitration tracking, pleadings, court events,
deadlines and limitation control, external counsel management, costs/exposure and outcomes — with a governed
lifecycle, SLA/deadlines, escalation, evidence and audit. Nothing is Aptic-/Kenya-specific: **matter types,
jurisdictions, forums/courts, statutes, external firms and advocates are configurable data**, never hardcoded.
**Not** a finance/ledger, an accounts-payable or payment engine, an AI legal researcher, a court-filing/scraping
integration, or a customer/counsel portal. M14 consumes `case.converted_to_matter` from m13 — it owns full legal
matters; m13 owns case-management support.

## Layers

- **PURE domain** (`src/domain/`): the matter + spec state machines (25-state lifecycle, single choke point);
  matter-type + SLA-policy spec validation (declarative — no executable expression, ADR-061); deterministic
  clock-driven SLA + deadline + **limitation** math (due dates, warn/breach, offset/explicit rules; limitation
  deadlines treated as high-risk and clearly distinguishable, ADR-062); closure eligibility gate (machine-readable
  reason codes); relationship rules; the shared vocabulary + fail-closed hard limits. Plus deterministic
  `matter-number` formatting and a content-hash util.
- **Ports** (`ports.ts`): a `Clock` (SLA + deadline + limitation math take it — no ambient `Date.now`), a
  `CaseConversion` type and an `IntakeAdapter` (external systems normalize to safe fields + a payload hash).
  Deterministic test doubles only (`SystemClock`/`FixedClock`) — no real external adapters, no secrets.
- **Persistence** (`migrations/0001_legal.sql`, **25 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs): `legal_matter_type` + `legal_sla_policy` (immutable-after-publish specs,
  one-active), `legal_jurisdiction`, `legal_matter` (core aggregate; SENSITIVE legal positions/strategy fields;
  25-state lifecycle), `legal_case_conversion` (M13 idempotency ledger), `legal_matter_status_history` +
  `legal_assignment_history` (append-only), `legal_instruction`, `legal_party`, `legal_activity`, `legal_task`,
  `legal_issue`, `legal_position`, `legal_opinion`, `legal_research_reference`, `legal_pleading`,
  `legal_court_event`, `legal_deadline`, `legal_external_counsel`, `legal_counsel_report` (append-only),
  `legal_cost_reference`, `legal_settlement` (maker-checker + SoD CHECK), `legal_outcome` (append-only),
  `legal_note` (append-only), `legal_relationship`. `0002`: NO DELETE anywhere; the **6 append-only ledgers** are
  INSERT+SELECT only.
- **Services**: `CatalogService` (versioned matter types + SLA policies + jurisdictions), `MatterService` (intake
  incl. idempotent M13 conversion, instruction, triage, assignment, the full lifecycle, closure, reopening),
  `MatterWorkService` (parties, activities, tasks, issues, pleadings, court events, deadlines, research, notes),
  `MatterLegalService` (positions, opinions, external counsel + reports, costs, settlement maker-checker,
  outcomes, relationships, analytics). One `M14Emitter` writes audit (m03) + events on the **one outbox m06 owns**.
- **API** (`/api/v1/legal`): audited mutating routes + reads across four controllers (catalog, matters, work,
  legal). Every mutating route is an audited `@Endpoint` with a permission enforced server-side (default deny);
  views **redact** legal positions/strategy, opinions, privileged notes, party contacts and confidential
  settlement terms.

## Governance

Tenant isolation (RLS FORCE on all 25 tables), default-deny authorization (**70** `legal.*` permissions, seeded —
**23** privileged, ADR-061), audit via the m03 port (**55** `LEGAL_` codes, no duplicate audit table), the single
m06 outbox for `legal.lifecycle` (**36** event types), idempotent M13 conversion/creation, single-winner deadline
breach, optimistic concurrency on every mutation, **maker-checker segregation of duties** on settlement approval
(proposer ≠ approver, enforced in the service AND the DB CHECK `legal_settlement_sod_ck`), rule-gated closure with
explainable reason codes, and **legal privilege/confidentiality minimization** — positions, opinions, privileged
notes, party contacts and confidential settlement terms are RLS-stored, redacted on read, and never in
events/audit (ADR-064).

## Reuse (no duplicate engines)

Workflow (m06), rules (m07), escalation + notifications (m08), documents/evidence (m09) and the M13 case
conversion are reused **through events/contracts and ports**, never by importing their internals. SLA/deadline/
limitation math is deterministic via a `Clock` port; timer dispatch/escalation is delegated to m06/m08. The
**M13→M14 conversion** is fire-and-forget over `case.converted_to_matter` + the `legal_case_conversion` idempotency
ledger (one matter per source case) — m14 owns no case tables and **never reads m13-owned tables**. Costs, exposure
and enforcement store **finance + court references only** — no ledger, no accounts payable, no posting, no payment,
no tax, no reconciliation (ADR-063).

## Tests

`test/m14-legal.smoke.ts` (PURE domain), `test/m14-legal.db-spec.ts` (RLS/grants/append-only/idempotency/SoD/
constraints/isolation), `test/m14-services.db-spec.ts` (end-to-end incl. deterministic deadline/limitation breach,
settlement SoD, rule-gated closure, idempotent M13 conversion, relationships, redaction, cross-tenant), and
`apps/api/test/api-legal.db-spec.ts` (HTTP end-to-end). Smoke: `npm run test:smoke`; DB lane: `npm run test:db`
against a real PostgreSQL (CI is PostgreSQL 16, authoritative). ADR-061…064.
