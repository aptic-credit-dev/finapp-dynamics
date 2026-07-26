# Stage 3.2 — M13 Enterprise Case Management — Architecture

**Module:** `m13-case` · **Package:** `@finapp/m13-case` · **Branch:** `feature/stage-3-2-m13-case-management`
· **Baseline:** certified Stage 3.1 main `936e3377` (PR merge). **ADRs:** ADR-057…060+.

## Purpose & boundary

One generic, multi-tenant **enterprise case-management platform** for cases, complaints, investigations,
legal-matter support, litigation tracking, recovery/enforcement tracking, and internal/regulatory/incident
matters — a governed intake → triage → assign → work → decide → close/reopen engine with configurable SLA and
deadlines, escalation, evidence and audit. It is **not** a general ledger, a debt-collection accounting engine, a
court-filing integration, an AI legal-research tool, an external-counsel or customer portal, or the M14 legal
module (see Exclusions). Full legal **matters** live in M14; M13 carries legal-matter **support** and emits
`case.converted_to_matter` for M14 to consume. Nothing is Aptic- or Kenya-specific: case types, legal
jurisdictions/references, SLA policies, teams and deadlines are **configurable data**, never hardcoded. It
consumes shared services via kernel tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and owns no shared service.

## Shape (mirrors m07/m08/m09/m12)

- **PURE domain** — case + spec state machines; case-type spec + SLA-policy spec validation (versioned,
  immutable-after-publish, one-active); deterministic clock/date-driven SLA + deadline math; closure eligibility
  gate returning machine-readable reason codes; relationship/duplicate matching. No I/O; exhaustively unit-tested.
- **Clock + DateCalculator ports** — SLA and deadline math is deterministic via an injected `Clock` +
  `DateCalculator` (no ambient `Date.now`, no ambient calendar); decisioning (triage classification, SLA
  selection, closure eligibility) delegates to m07 rules via a recorded `ruleEvaluationId` — rules never mutate
  cases.
- **~20 tables** — versioned `case_type` + `case_sla_policy` (one-active, immutable-after-publish); the
  `case_record` core aggregate (SENSITIVE party-contact/summary + inline `legal_*` and `recovery_*` analytics
  dimensions; multi-state lifecycle); append-only `case_status_history` + `case_assignment_history`; parties,
  activities (correspondence via subtypes), tasks, issues/allegations, investigation, append-only findings;
  document references (M09; no bytes) + append-only evidence register; deadlines, hearings; append-only
  maker-checker decisions; settlement; confidential/privileged notes; relationships; and the `case_handoff_intake`
  idempotency ledger for M12 consumption. All composite `(tenant_id,id)`, RLS ENABLE+FORCE + `tenant_isolation`,
  no-DELETE, append-only ledgers INSERT+SELECT only.
- **Services** — Catalog / Case / CaseWork / CaseDecision, each permissioned + transactional, audit + outbox in
  the business tx via one `M13Emitter`.
- **API** `/api/v1/cases` — case types, SLA policies, intake (incl. M12 handoff), triage, assignment, the full
  case lifecycle, parties, activities, tasks, issues, investigation, findings, documents, evidence, deadlines,
  hearings, notes, decisions (maker-checker), settlement, relationships, closure/reopening, analytics.

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| Declarative config | case types + SLA policies are declarative versioned data; decisioning (triage, SLA selection, closure) delegated to m07 via a recorded `ruleEvaluationId` — rules never mutate cases | 057 |
| Deterministic time | SLA + deadline math is deterministic via `Clock` + `DateCalculator` ports; no ambient `Date.now`, no production calendar; timer dispatch + escalation delegate to m06/m08 | 058 |
| Handoff boundaries | M12→M13 handoff is idempotent single-case intake via `case_handoff_intake` + a completion port + `case.handoff.accepted`; M13→M14 emits `case.converted_to_matter` — no fake matter table, no second escalation engine | 059 |
| Confidentiality | party contacts, privileged notes, correspondence bodies + confidential settlement terms stored under RLS, REDACTED on read behind dedicated permissions, and NEVER in events/audit | 060 |
| Finance references only | settlement + recovery/enforcement store finance **references** only — no ledger/journal/payment/reconciliation implementation | 060+ |

## Integration (reuse, no duplicate engines)

m06 workflow orchestrates review/approval/closure gates and owns the single outbox; m07 rules consume typed case
facts (type, priority, issue class, jurisdiction — never raw summary or party contact) for triage classification,
SLA selection and closure eligibility via a recorded `ruleEvaluationId`; m08 sends notifications and drives
escalation (no second escalation engine); m09 documents + evidence attach supporting material by reference (no
bytes) — all through events/contracts and ports, never by importing their internals. A notification/escalation
failure never mutates a committed decision or a completed closure. M13 **consumes** the versioned M12 handoff
(`feedback.lifecycle` `CaseHandoffRequested` / `feedback.escalated`), creating exactly one case idempotently and
completing the M12 handoff through a port, then emits `case.handoff.accepted`. The two families
`case.lifecycle` and `case.converted_to_matter` (~29 event types across both, version 1) flow through the single
m06 outbox.
