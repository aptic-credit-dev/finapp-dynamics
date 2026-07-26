# Stage 3.1 — M12 Enterprise Feedback Management — Architecture

**Module:** `m12-feedback` · **Branch:** `feature/stage-3-1-m12-feedback` · **Baseline:** certified Stage 2.5 main
`6aa47442` (PR merge). **ADRs:** ADR-052…056.

## Purpose & boundary

One generic, multi-tenant **customer feedback-management platform** for feedback captured from daily
post-transaction service calls across loans, insurance, bid bonds, performance bonds, advance-payment guarantees
and trade finance. It is a closed-loop capture → classify → assign → resolve → close engine with deterministic
CSAT/NPS scoring, SLA tracking and escalation — **not** a survey table, a call-recording system, an AI sentiment
engine, a CRM, or the M13 case-management system (see Exclusions). Nothing is Aptic-specific: source systems,
products, departments, branches, relationship officers and transaction types are **configurable data**, never
hardcoded. It consumes shared services via kernel tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and owns no shared
service.

## Shape (mirrors m07/m08/m09)

- **PURE domain** — feedback + spec state machines; questionnaire spec + answer validation + deterministic
  CX-score normalization (CSAT/NPS); SLA policy spec + deterministic clock-driven SLA math; closure eligibility
  gate returning machine-readable reason codes; duplicate/related matching. No I/O; exhaustively unit-tested.
- **Clock + adapter ports** — `Clock` (SLA math is deterministic via an injected clock, no ambient `Date.now`);
  `SourceSystemAdapter` normalizing external transactions — deterministic doubles only, no real ApticOne/
  AutoBonds/BimaPro/Imarisha adapters, no secrets.
- **15 tables** — configurable sources + categories; versioned questionnaires + SLA policies (one-active,
  immutable-after-publish); source-transaction ingestion (external-tx unique + idempotent); the `feedback_record`
  core aggregate (customer contact + narrative SENSITIVE; 15-state lifecycle); append-only answers; single-winner
  queue claim; append-only contact-attempt / assignment-history ledgers; activity log; one resolution + one SLA
  instance per feedback; pending-unique idempotent case handoff; duplicate/related relationships. All composite
  `(tenant_id,id)`, RLS ENABLE+FORCE + `tenant_isolation`, no-DELETE.
- **Services** — Catalog / Feedback / Records, each permissioned + transactional, audit + outbox in the business
  tx via one `M12Emitter`.
- **API** `/api/v1/feedback` — sources, categories, questionnaires, SLA policies, ingestion, records, capture,
  classify, assign, contact attempts, resolution (submit/approve), closure, SLA/escalation, case handoff,
  duplicate/related linking.

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| Permission model | granular three-segment `feedback.*`; privileged `feedback.customer_contact.read` + `feedback.platform.administer`; no vague `feedback.admin` | 052 |
| Declarative config | questionnaires, categories and closure criteria are declarative data; complex decisioning delegated to m07 rules | 053 |
| SLA math | deterministic clock-driven math via a `Clock` port; timer dispatch + escalation delegated to m06/m08 | 054 |
| Sensitivity | customer contact + free-text narrative stored under RLS, REDACTED on read unless caller holds `feedback.customer_contact.read`, and NEVER in events/audit | 055 |
| Fail-closed handoff | hard limits fail closed; controlled M13 case handoff via port + pending record + versioned event, no fake case table + no second escalation engine | 056 |

## Integration (reuse, no duplicate engines)

m06 workflow orchestrates review/approval gates and owns the single outbox; m07 rules consume typed feedback
facts (sentiment, severity, type, category — never raw narrative) for classification/closure decisioning; m08
sends notifications and drives escalation; m09 documents attaches supporting evidence — all through
events/contracts, never by importing their internals. A notification/escalation failure never mutates a committed
resolution or a completed closure. Case handoff to **M13 (which does not exist yet)** is a port + a pending
handoff record + a versioned event ONLY — m12 creates no case table. `feedback.lifecycle` (24 types, version 1)
flows through the single m06 outbox.
