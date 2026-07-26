# Stage 3.2 — M13 Enterprise Case Management — Completion Report

**Module:** `m13-case` · **Package:** `@finapp/m13-case` · **Branch:** `feature/stage-3-2-m13-case-management`
· **Baseline:** certified Stage 3.1 main `936e33779e0944b0a1630fd87220a2c1447fe2d9` (PR merge, verified).
**Status:** implemented on branch; all local gates green, **not merged** (stopped before merge); PR + post-merge
certification are the next steps.

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified-pending** = to be observed green on the authoritative PostgreSQL 16 CI lane · **not yet
merged** · **deferred** = documented, out of scope.

## What was built

A generic, multi-tenant **enterprise case-management platform** — a governed intake → triage → assign → work →
decide → close/reopen engine for cases, complaints, investigations, legal-matter support, litigation and
recovery/enforcement tracking, and internal/regulatory/incident matters. Nothing is Aptic- or Kenya-specific: case
types, legal jurisdictions/references, SLA policies, teams and deadlines are **configurable data**, never
hardcoded. It is **not** a general ledger, a debt-collection accounting engine, a court-filing integration, an AI
legal-research tool, an external-counsel or customer portal, or the M14 legal module. Full legal **matters** live
in M14; M13 carries legal-matter **support** and emits `case.converted_to_matter` for M14 to consume.

- **PURE domain** (`src/domain/`): limits + vocab; the case (18-state) + spec state machines; case-type spec +
  SLA-policy spec validation (versioned, one-active, immutable-after-publish); deterministic clock/date-driven SLA
  + deadline math; the closure eligibility gate (machine-readable reason codes); relationship/duplicate matching.
- **Clock + DateCalculator ports** (`ports.ts`): SLA + deadline math is deterministic via an injected `Clock`
  (`SystemClock` + `FixedClock`) — no ambient `Date.now`, no ambient calendar; timer dispatch + escalation
  delegate to m06/m08. Decisioning (triage classification, SLA selection, closure eligibility) delegates to m07
  rules via a recorded `ruleEvaluationId` — **rules never mutate a case**. The M12 handoff is consumed through a
  `FeedbackHandoffSource` port (the api wires a `M12FeedbackHandoffAdapter` over m12's public `RecordsService`);
  m13 never reads m12's tables.
- **Persistence** (`0001`/`0002`, **20 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs, **NO DELETE grant anywhere**): `case_type`, `case_sla_policy` (versioned,
  one-active per code+scope, immutable-after-publish), `case_record` (core aggregate; SENSITIVE fields + inline
  `legal_*`/`recovery_*` dimensions; 18-state lifecycle CHECK), `case_handoff_intake` (M12 idempotency),
  `case_party`, `case_activity` (correspondence via subtype), `case_task`, `case_issue`, `case_investigation` (one
  per case), `case_document` (m09 references; no bytes), `case_evidence`, `case_deadline`, `case_hearing`,
  `case_decision` (maker-checker + a `submitted_by <> approved_by` DB CHECK), `case_settlement` (maker-checker +
  DB CHECK), `case_relationship` (self-edge CHECK, active-unique). **5 append-only ledgers** (`case_status_history`,
  `case_assignment_history`, `case_finding`, `case_note`, `case_handoff_intake`) are INSERT+SELECT only.
- **Services**: `CatalogService` (versioned case types + SLA policies), `CaseService` (intake incl. idempotent M12
  handoff, triage, assignment, the full lifecycle, closure, reopening, m14 conversion), `CaseWorkService`
  (parties, activities, tasks, issues, investigation, findings, documents, evidence, deadlines, hearings, notes),
  `CaseDecisionService` (decisions + settlements maker-checker, recovery/legal boundary, escalation, deterministic
  SLA, relationships, analytics). One `M13Emitter` writes audit (m03) + events on the **one outbox m06 owns**, in
  the business tx.
- **API** (`/api/v1/cases`): case types, SLA policies, intake (incl. M12 handoff), triage, assignment, the full
  case lifecycle, parties, activities, tasks, issues, investigation, findings, documents, evidence, deadlines,
  hearings, notes, decisions (maker-checker), settlement, relationships, closure/reopening, analytics. Every
  mutating route declares a permission (default deny); sensitive fields redacted in views.

## Scope

| Fact | Value |
|---|---|
| Source added | `packages/m13-case` (domain, ports, repository, emit, 4 services) + `apps/api/src/cases` (views + controllers + module + `M12FeedbackHandoffAdapter`) + registries/contracts/tests/docs |
| Migrations | **2** for m13 (`0001`, `0002`); **22** total in the repo, m13 last |
| Tables created | **20** |
| Permissions added | **56** (`cases.*` three-segment; ~15 privileged incl. `cases.confidential.read`, `cases.privileged_notes.read`/`create`, `cases.decision.approve`, `cases.settlement.approve`, `cases.evidence.verify`, `cases.party_contact.read`, `cases.legal.manage`, `cases.recovery.manage`, `cases.type.manage`, `cases.sla_policy.manage`, `cases.case.reopen`, `cases.case.archive`, `cases.analytics.export`, `cases.platform.administer`) — seeded |
| Audit codes added | **50** (`CASE_*` SCREAMING_SNAKE); `registered_code_count` **213 → 263** |
| Events added | **TWO** families — `case.lifecycle` (**32** event types) + `case.converted_to_matter` (**1**); contracts `DomainEvent` union **9 → 11** families |
| Routes | **50** mutating `@Endpoint` routes + **19** reads under `/api/v1/cases` |
| Lifecycle | **18** case states (`draft`, `opened`, `triage`, `assigned`, `under_review`, `investigation`, `awaiting_information`, `awaiting_internal_action`, `awaiting_external_action`, `hearing_scheduled`, `in_litigation`, `under_recovery`, `decision_pending`, `resolved`, `closed`, `reopened`, `cancelled`, `archived`); explicit transitions, append-only `case_status_history` evidence; `closed` is reopenable/archivable, `cancelled` + `archived` are terminal |
| ADRs | ADR-057…060 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **20** tables; composite `(tenant_id,id)` keys + composite FKs; asserted through the non-owner app role. |
| Authorization | Default-deny; every mutation `authz.require`s its three-segment `cases.*` permission; a header cannot grant authority (proven over HTTP). ~15 privileged permissions gate confidential/privileged/legal/recovery/approval surfaces. |
| Sensitivity / redaction | Party contacts, privileged/confidential/legal-advice notes, correspondence bodies and confidential settlement terms stored under RLS, REDACTED on read unless the caller holds the dedicated privileged permission; reading confidential/privileged data is itself audited; NEVER in events or audit payloads; no document storage references in API responses (ADR-060). |
| Maker-checker / SoD | Decision + settlement approval require submitter/proposer ≠ approver, enforced in the service AND a DB CHECK; self-approve → 409, an independent approver succeeds (proven in services + HTTP specs). |
| Immutability | Published case-type + SLA-policy specs frozen (one-active per code+scope, immutable-after-publish); status/assignment/finding/note/handoff ledgers append-only. |
| Versioned specs | Case types + SLA policies are versioned with exactly one ACTIVE version; declarative config; decisioning delegated to m07 via a recorded `ruleEvaluationId` — rules never mutate a case (ADR-057). |
| Deterministic SLA / deadlines | SLA start materializes stage deadlines (no bespoke SLA-instance table); all dates computed from an injected `Clock` — no ambient `Date.now` (ADR-058); a `FixedClock` proves deterministic deadline breach; timer dispatch/escalation delegate to m06/m08. |
| Finance references only | Settlement + recovery/enforcement store finance **references** only (integer minor units as reference data) — no general ledger, journal posting, payment allocation, collections accounting, or reconciliation (ADR-059). |
| M12 handoff | Idempotent single-case intake via the `case_handoff_intake` unique ledger, consumed through a `FeedbackHandoffSource` port; preserves the originating feedback id + correlation; completes the m12 handoff (feedback → `converted_to_case`) ONLY on first creation. Proven end-to-end over HTTP. |
| M14 boundary | M13 emits `case.converted_to_matter` for M14 to consume — no fake matter table, no second escalation engine. |
| Append-only evidence | The 5 ledgers INSERT+SELECT only (0 UPDATE grant); NO DELETE on any m13 table. |
| Idempotency | DB-enforced on case-number and M12 handoff (unique ledger); conflict → 409. |
| Single outbox | m13 owns no outbox; publishes `case.lifecycle` + `case.converted_to_matter` through m06's `WorkflowOutbox`. |
| Sensitive-data minimisation | Audit + events carry ids, states, dates and safe reason codes only — never party contact, note bodies, correspondence bodies or confidential terms (ADR-060). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean. **Lint:** 0 errors (pre-existing non-blocking warnings only), on a wiped `dist`.
  **Format:** clean.
- **Smoke lane (tested locally):** **17 suites, 2771 assertions, 0 failed** — including `m13-case` (**67**) and
  `conformance` (**1193**, validating every `@Endpoint` permission + audit code against the registries, the RLS
  convention over the new migrations, `registered_code_count`=len(codes), and the newly-registered `case.lifecycle`
  + `case.converted_to_matter` families).
- **Migrations (tested locally):** **22** in dependency order, applied on PostgreSQL; dry-run + fresh replay from
  an empty database.
- **DB lane (tested locally, real PostgreSQL 15.2, non-owner app role):** **28 specs, 783 assertions, 0 failed** —
  `m13-case.db-spec` (**34**), `m13-services.db-spec` (**31**), `api-cases` (**15** HTTP end-to-end, proving the
  REAL M12→M13 handoff: m12 request handoff → m13 accept → feedback becomes `converted_to_case`), and the whole
  prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **CI-verified-pending** at the
  time of writing.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**.

## Live DB governance verified

20/20 tables RLS ENABLE+FORCE + `tenant_isolation`; **0 DELETE grants**; the 5 append-only ledgers have **0 UPDATE
grant**; **56** permissions seeded; case-number + handoff idempotency uniqueness; one-active case-type/SLA-policy;
decision SoD CHECK; relationship self-edge CHECK + composite FK.

## Defects caught and fixed during build

Two real defects were surfaced by the DB/API specs and fixed:

1. `acceptHandoff` re-called m12's `completeCaseHandoff` on a repeat handoff, which 409s because the m12 handoff is
   not idempotent once completed — fixed to complete the m12 handoff **only on first creation**.
2. The `api-cases` HTTP spec had to capture the m12 feedback before requesting the handoff — `converted_to_case` is
   unreachable from a raw `pending_contact` feedback in m12's lifecycle machine.

## Limitations (deferred, documented — not defects)

- **No general ledger / finance foundation / accounting / journal posting / reconciliation / payment processing /
  debt-collection accounting** — settlement + recovery store finance references only (ADR-059); those remain later
  modules.
- **No external court-filing integration**, no production calendar/telephony/SMS/email providers — timer dispatch +
  notifications delegate to m06/m08 (Framework Only).
- **No AI legal research/summarization/decision-making** — classification and decisioning are human/rule-driven
  (m07), never AI outputs.
- **No external-counsel or customer portal, no document editor, no full regulatory-reporting engine.**
- **No M14 legal matters** — M13 carries legal-matter support and emits `case.converted_to_matter` only; full
  matters are a downstream boundary.

## Spec divergence (recorded)

The spec `docs/04-modules/CASE_MANAGEMENT.md` is a brief 18-reference-table baseline; this implementation lands at
**20 tables** and expands the module to the enterprise scope the Stage 3.2 build directed. The divergence (20 vs 18
tables; enterprise expansion; sentiment/AI excluded) is captured in **ADR-057…060** and this report.

## Scope discipline (contamination)

Only `m13-case` (+ its API wiring, registries, contracts families, tests, docs) was built. No M14/legal-matter,
finance, general-ledger, reconciliation, court-filing or AI implementation; m13 reads none of m12's tables (the
handoff flows through a port over m12's public `RecordsService`). No shared platform service was duplicated; no
second outbox; no duplicate audit table; no second RBAC or escalation engine; no matter table. The manifest change
is confined to the m13 block. The implementation is on the branch; it is **not merged** — the PR + post-merge
PostgreSQL 16 certification are the next steps.
