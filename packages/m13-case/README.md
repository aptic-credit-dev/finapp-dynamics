# m13-case — Enterprise case management (Stage 3.2)

A **generic, configurable, multi-tenant enterprise case-management platform** — cases, complaints,
investigations, legal-matter support, litigation tracking, recovery/enforcement tracking, internal/regulatory/
incident matters — with a governed lifecycle, SLA/deadlines, escalation, evidence and audit. Nothing is
Aptic-/Kenya-specific: **case types, jurisdictions, legal references, SLA policies, teams and deadlines are
configurable data**, never hardcoded. **Not** a finance/ledger, a payment/collections engine, an AI legal
researcher, a court-filing integration, or a customer/counsel portal. Full legal **matters** are m14 — m13 emits
`case.converted_to_matter`.

## Layers

- **PURE domain** (`src/domain/`): the case + spec state machines (18-state lifecycle, single choke point);
  case-type + SLA-policy spec validation (declarative — no executable expression, ADR-057); deterministic
  clock-driven SLA + deadline math (due dates, warn/breach, offset/explicit rules, ADR-058); closure eligibility
  gate (machine-readable reason codes; legal hold + critical escalation always block); relationship rules; the
  shared vocabulary + fail-closed hard limits. Plus deterministic `case-number` formatting.
- **Ports** (`ports.ts`): a `Clock` (SLA + deadline math take it — no ambient `Date.now`), a
  `FeedbackHandoffSource` (the M12 seam), and an `IntakeAdapter` (external systems normalize to safe fields + a
  payload hash). Deterministic test doubles only — no real external adapters, no secrets.
- **Persistence** (`migrations/0001_cases.sql`, 20 tables, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs): `case_type` + `case_sla_policy` (immutable-after-publish specs,
  one-active), `case_record` (core aggregate; SENSITIVE fields + inline legal/recovery dimensions),
  `case_handoff_intake` (M12 idempotency), `case_status_history` + `case_assignment_history` + `case_finding` +
  `case_note` (append-only), `case_party`, `case_activity` (also correspondence), `case_task`, `case_issue`,
  `case_investigation`, `case_document` (m09 refs), `case_evidence`, `case_deadline`, `case_hearing`,
  `case_decision` (maker-checker + SoD CHECK), `case_settlement`, `case_relationship`. `0002`: NO DELETE anywhere;
  the five append-only ledgers are INSERT+SELECT only.
- **Services**: `CatalogService` (versioned case types + SLA policies), `CaseService` (intake incl. M12 handoff,
  triage, assignment, the full lifecycle, closure, reopening, m14 conversion), `CaseWorkService` (parties,
  activities, tasks, issues, investigation, findings, documents, evidence, deadlines, hearings, notes),
  `CaseDecisionService` (decisions + settlements with maker-checker, recovery/legal boundary, escalation, SLA,
  relationships, analytics). One `M13Emitter` writes audit (m03) + events on the **one outbox m06 owns**.
- **API** (`/api/v1/cases`): 50 audited mutating routes + 19 reads across four controllers. Every mutating route
  is an audited `@Endpoint` with a permission enforced server-side (default deny); views **redact** confidential
  case detail, party contacts, privileged notes and confidential settlement terms.

## Governance

Tenant isolation (RLS FORCE on all 20 tables), default-deny authorization (56 `cases.*` permissions, seeded —
the confidentiality/approval/config set privileged, ADR-057), audit via the m03 port (50 `CASE_` codes, no
duplicate audit table), the single m06 outbox for `case.lifecycle` (32 event types) + `case.converted_to_matter`
(1), idempotent M12 handoff/creation/intake, single-winner evidence verify + deadline breach, optimistic
concurrency on every mutation, **maker-checker segregation of duties** on decision + settlement approval
(submitter ≠ approver, enforced in the service AND a DB CHECK), rule-gated closure with explainable reason codes,
and **confidentiality/privilege minimization** — sensitive detail is RLS-stored, redacted on read, and never in
events/audit (ADR-060).

## Reuse (no duplicate engines)

Workflow (m06), rules (m07), escalation + notifications (m08), documents/evidence (m09) and the feedback handoff
(m12) are reused **through events/contracts and ports**, never by importing their internals. SLA/deadline math is
deterministic via a `Clock` port; timer dispatch/escalation is delegated to m06/m08. The **M12→M13 handoff** is a
port + a pending idempotency ledger (one case per handoff). The **M13→M14 boundary** is the
`case.converted_to_matter` event — m13 owns no legal-matter tables. Recovery/settlement store **finance references
only** — no ledger, no posting, no payment (ADR-059).

## Tests

`test/m13-case.smoke.ts` (PURE domain), `test/m13-case.db-spec.ts` (RLS/grants/append-only/idempotency/SoD/
constraints/isolation), `test/m13-services.db-spec.ts` (end-to-end incl. deterministic deadline breach, decision +
settlement SoD, rule-gated closure, idempotent M12 handoff, relationships, redaction, cross-tenant), and
`apps/api/test/api-cases.db-spec.ts` (HTTP end-to-end incl. the REAL M12→M13 handoff). Smoke: `npm run test:smoke`;
DB lane: `npm run test:db` against a real PostgreSQL (CI is PostgreSQL 16, authoritative). ADR-057…060.
