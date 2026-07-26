# m12-feedback — Enterprise feedback management (Stage 3.1)

An **enterprise feedback-management platform** (not a survey table) for feedback captured from daily
post-transaction customer calls across loans, insurance, bid bonds, performance bonds, advance-payment
guarantees and trade finance. Nothing is Aptic-specific: **source systems, products, departments, branches,
relationship officers and transaction types are configurable data**, never hardcoded. **Not** a case-management
system, an AI sentiment engine, a call recorder, or a CRM.

## Layers

- **PURE domain** (`src/domain/`): the feedback-record + spec state machines (15-state lifecycle, single
  choke point); questionnaire spec + answer validation + deterministic CSAT/NPS/effort normalization
  (questions are DATA — no executable expression, ADR-053); SLA policy spec + deterministic clock-driven SLA
  math (due dates, warn/breach, pause-adjusted, ADR-054); closure eligibility gate (machine-readable reason
  codes); duplicate/related matching; the shared vocabulary + fail-closed hard limits (ADR-056).
- **Ports** (`ports.ts`): a `Clock` (SLA math takes it — no ambient `Date.now`) and a `SourceSystemAdapter`
  (ingestion normalizes to safe fields + a payload hash; **no** raw external payloads). Deterministic test
  doubles only — no real adapters to ApticOne/AutoBonds/BimaPro/Imarisha, no secrets.
- **Persistence** (`migrations/0001_feedback.sql`, 15 tables, all RLS ENABLE+FORCE + `tenant_isolation`,
  composite `(tenant_id,id)` keys + composite FKs): `feedback_source_system`, `feedback_category`,
  `feedback_questionnaire` + `feedback_sla_policy` (immutable-after-publish specs, one-active),
  `feedback_source_transaction` (idempotent ingestion), `feedback_record` (core aggregate; `customer_contact`
  + `narrative` are SENSITIVE), `feedback_answer`, `feedback_queue_item` (single-winner claim),
  `feedback_contact_attempt`, `feedback_assignment_history`, `feedback_activity`, `feedback_resolution`,
  `feedback_sla_instance`, `feedback_case_handoff` (pending, idempotent), `feedback_relationship`. `0002`: NO
  DELETE anywhere; answers, contact attempts and assignment history are INSERT+SELECT only.
- **Services**: `CatalogService` (configurable sources/categories + versioned questionnaire/SLA-policy
  lifecycle), `FeedbackService` (ingestion, contact queue, the full record lifecycle: capture → classify →
  assign → resolution with maker≠checker approval → rule-gated closure, plus reopen + positive recognition),
  `RecordsService` (deterministic SLA tracking, escalation, controlled M13 case handoff, duplicate/related
  linking). One `M12Emitter` writes audit (m03) + events on the **one outbox m06 owns**.
- **API** (`/api/v1/feedback`): audited mutating routes + reads across three controllers. Every mutating route
  is an audited `@Endpoint` with a permission enforced server-side (default deny); views **redact** the
  customer contact and the confidential internal response.

## Governance

Tenant isolation (RLS FORCE on all 15 tables), default-deny authorization (37 `feedback.*` permissions,
seeded — `feedback.customer_contact.read` + `feedback.platform.administer` privileged, ADR-052), audit via the
m03 port (35 `FEEDBACK_*` codes, no duplicate audit table), the single m06 outbox for `feedback.lifecycle`
(24 event types), idempotent ingestion/record-creation/case-handoff, single-winner queue claim, optimistic
concurrency on every mutation, **maker-checker segregation of duties** on resolution approval (submitter ≠
approver), rule-gated closure with explainable reason codes, and **sensitive-data minimization** — customer
contacts and narratives are RLS-stored, redacted on read, and never in events/audit (ADR-055).

## Reuse (no duplicate engines)

Workflow (m06), rules (m07), escalation + notifications (m08) and documents (m09) are reused **through
events/contracts**, never by importing their internals. SLA math is deterministic via a `Clock` port; timer
dispatch/escalation is delegated to m06/m08. **Case handoff to M13** (which does not exist yet) is a **port +
a pending handoff record + a versioned event ONLY** — m12 owns no case table and no second escalation engine
(ADR-056). Sentiment/severity/classification are human- or rule-driven fields, **not** AI.

## Tests

`test/m12-feedback.smoke.ts` (PURE domain), `test/m12-feedback.db-spec.ts` (RLS/grants/constraints/isolation/
idempotency/single-winner), `test/m12-services.db-spec.ts` (end-to-end incl. deterministic SLA breach, resolution
SoD, rule-gated closure, controlled case handoff, redaction, cross-tenant), and
`apps/api/test/api-feedback.db-spec.ts` (HTTP end-to-end). Smoke: `npm run test:smoke`; DB lane: `npm run test:db`
against a real PostgreSQL (CI is PostgreSQL 16, authoritative). ADR-052…056.
