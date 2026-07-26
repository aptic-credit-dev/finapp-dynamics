# Stage 3.1 — M12 Enterprise Feedback Management — Completion Report

**Module:** `m12-feedback` · **Branch:** `feature/stage-3-1-m12-feedback` · **Baseline:** certified Stage 2.5 main
`6aa474426b069182db5037b6c93ba5e305e2feba` (PR merge, verified). **Status:** implemented on branch; implementation
PR open, **not merged** (awaiting review + post-merge certification).

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified** = green on the authoritative PostgreSQL 16 CI lane · **not yet merged** · **deferred** =
documented, out of MVP scope.

## What was built

A generic, multi-tenant **customer feedback-management platform** for feedback captured from daily
post-transaction service calls across loans, insurance, bid bonds, performance bonds, advance-payment guarantees
and trade finance. Nothing is Aptic-specific — sources, products, departments, branches, relationship officers and
transaction types are configurable data. **Not** a survey table, call-recording system, AI sentiment engine, CRM,
or the M13 case system.

- **PURE domain** (`src/domain/`): limits + vocab (channels, sentiments, severities, feedback types, root-cause
  categories); the feedback (15-state) + spec state machines; questionnaire spec + answer validation +
  deterministic CSAT/NPS score normalization; SLA policy spec + deterministic clock-driven SLA math; the closure
  eligibility gate (machine-readable reason codes); duplicate/related matching.
- **Clock + adapter ports** (`ports.ts`): `Clock` (`SystemClock` + `FixedClock`) so SLA math is deterministic
  with no ambient `Date.now`; `SourceSystemAdapter` normalizing external transactions — **deterministic doubles
  only**, no real ApticOne/AutoBonds/BimaPro/Imarisha adapter, no secrets.
- **Persistence** (`0001_feedback.sql`, **15 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs): `feedback_source_system`, `feedback_category`, `feedback_questionnaire`
  (versioned, one-active, immutable-after-publish), `feedback_sla_policy` (same), `feedback_source_transaction`
  (external-tx unique + idempotent), `feedback_record` (core aggregate; contact + narrative SENSITIVE; 15-state),
  `feedback_answer` (append-only), `feedback_queue_item` (single-winner claim), `feedback_contact_attempt`
  (append-only), `feedback_assignment_history` (append-only), `feedback_activity`, `feedback_resolution` (one per
  feedback), `feedback_sla_instance` (one per feedback), `feedback_case_handoff` (pending unique + idempotent),
  `feedback_relationship` (duplicate/related). `0002`: **NO DELETE anywhere**; the append-only ledgers INSERT+SELECT
  only.
- **Services**: `CatalogService`, `FeedbackService`, `RecordsService`. One `M12Emitter` writes audit (m03) +
  events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/feedback`): sources, categories, questionnaires, SLA policies, ingestion, records, capture,
  classify, assign, contact attempts, resolution submit/approve, closure, SLA/escalation, case handoff,
  duplicate/related linking. Every mutating route declares a permission (default deny); sensitive fields redacted
  in views.

## Scope

| Fact | Value |
|---|---|
| Source added | `packages/m12-feedback` (domain, ports, repository, emit, 3 services) + `apps/api/src/feedback` (views + 3 controllers + module) + registries/contracts/tests/docs |
| Migrations | **2** (`0001_feedback.sql`, `0002_grant_application_role.sql`); **20** total in the repo, m12 last |
| Tables created | **15** |
| Permissions added | **37** (`feedback.*` three-segment; privileged: `feedback.customer_contact.read`, `feedback.platform.administer`) — seeded |
| Audit codes added | **35** (`FEEDBACK_*` SCREAMING_SNAKE); `registered_code_count` +35 |
| Events added | `feedback.lifecycle` family, **24** event types (version 1); added to the contracts `DomainEvent` union + `DOMAIN_EVENT_FAMILIES` |
| Lifecycle | **15** feedback states (`pending_contact` → … → `closed`, plus reopened / converted_to_case / cancelled / unreachable / expired branches) |
| ADRs | ADR-052…056 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **15** tables; asserted through the non-owner app role. |
| Authorization | Default-deny; every mutation `authz.require`s its three-segment `feedback.*` permission; a header cannot grant authority (proven over HTTP). Privileged `feedback.customer_contact.read` + `feedback.platform.administer`. |
| Sensitivity / redaction | Customer contact + free-text narrative stored under RLS, REDACTED on read unless the caller holds `feedback.customer_contact.read`; never in events or audit (ADR-055). |
| Maker-checker / SoD | Resolution submit ≠ approve; the submitter cannot approve their own resolution (segregation of duties). |
| Immutability | Published questionnaire + SLA-policy specs frozen (one-active, immutable-after-publish); answers/contact-attempt/assignment ledgers append-only. |
| Versioned specs | Questionnaires + SLA policies are versioned with exactly one ACTIVE version; declarative config (ADR-053). |
| Deterministic SLA | SLA due dates + stage state computed from an injected `Clock` port — no ambient `Date.now` (ADR-054); timer dispatch/escalation delegate to m06/m08. |
| Closure gate | Closure gated by configurable criteria returning machine-readable reason codes; positive feedback closes after a light review, negative/high-risk enters controlled analysis. |
| Case handoff | M13 handoff via port + a pending (unique + idempotent) handoff record + a versioned event ONLY — no case table, no second escalation engine (ADR-056). |
| Append-only evidence | Answers / contact attempts / assignment history INSERT+SELECT only; NO DELETE on any m12 table. |
| Idempotency | DB-enforced on ingestion (external-tx unique), record creation, and case handoff; conflict → 409. |
| Concurrency | Optimistic locks (`version` + `WHERE version=$expected`) + unique-constraint single-winner queue claim. |
| Single outbox | m12 owns no outbox; publishes `feedback.lifecycle` through m06's `WorkflowOutbox`. |
| Sensitive-data minimisation | Audit + events carry identifiers, statuses, reason codes and safe analytics dimensions only — never contact details or narrative (ADR-055). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean. **Lint:** 0 errors (pre-existing non-blocking warnings only), on a wiped `dist`.
  **Format:** clean.
- **Smoke lane (tested locally):** **16 suites, 2476 assertions, 0 failed** — including `m12-feedback` (**61**)
  and `conformance` (**976**, validating every `@Endpoint` permission + audit code against the registries, the RLS
  convention over the new migrations, `registered_code_count`=len(codes), and the newly-registered
  `feedback.lifecycle` family).
- **Migrations (tested locally):** 20 in dependency order; dry-run + **fresh replay from an empty database**.
- **DB lane (tested locally, real PostgreSQL 15.2, non-owner `finapp_app` role):** **25 specs, 703 assertions, 0
  failed** — `m12-feedback` (**27**), `m12-services` (**36**), `api-feedback` (**14** HTTP end-to-end), and the
  whole prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **not yet CI-verified** at the
  time of writing.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**.

## Section evidence (matrix)

RLS + isolation + fail-closed, no-DELETE + append-only ledger grants, permission seed (37), one-active versioned
questionnaire/SLA-policy, external-tx idempotency uniqueness, single-winner queue claim, pending-handoff
uniqueness (`m12-feedback.db-spec`). Configurable source/category + versioned questionnaire/SLA lifecycle +
immutability, default-deny, answer validation + deterministic CSAT/NPS, clock-driven SLA math, closure-gate reason
codes, capture→classify→assign→resolve→close lifecycle, **resolution maker-checker (submitter ≠ approver)**,
duplicate/related linking, M13 case handoff (port + pending record + event), cross-tenant isolation
(`m12-services.db-spec`). HTTP: 401 anon, 403 unprivileged (header can't grant), **contact/narrative redaction
without `feedback.customer_contact.read`**, idempotent ingestion/handoff (409 on conflict), tenant isolation
(`api-feedback.db-spec`). Domain lifecycles + questionnaire/SLA/closure/matching math + clock + adapter doubles
(`m12-feedback.smoke`).

## Limitations (deferred, documented — not defects)

- **No real external source adapters** (ApticOne/AutoBonds/BimaPro/Imarisha) — deterministic doubles only, no
  secrets; real adapters are a future responsibility behind the existing `SourceSystemAdapter` port (Framework
  Only).
- **No AI sentiment/summarization** — sentiment, severity, classification and root-cause are human/rule-driven
  fields, not AI outputs; complex decisioning delegates to m07 rules.
- **No M13 case-management internals** — handoff is a port + pending record + versioned event; m12 creates no case
  table and no second escalation engine (ADR-056).
- **No call recording, production SMS/email/CRM, data warehouse, or unrestricted CSV import.**
- **No standing SLA/escalation sweeper worker** — SLA state is assessed on demand via the clock port; timer
  dispatch delegates to m06/m08; a background sweeper is deferred.

## Scope discipline (contamination)

Only `m12-feedback` (+ its API wiring, registries, contracts family, tests, docs) was built. **No M13/case/AI/
call-recording/CRM/data-warehouse implementation** and no real external adapter (grep of the merge diff for those
returns nothing but registry/doc lines). No shared platform service was duplicated; no second outbox; no duplicate
audit table; no second RBAC or escalation engine; no case table. The manifest change is confined to the m12 block
+ the `certification_2_5` finalization. The implementation PR is open; it is **not merged**.
