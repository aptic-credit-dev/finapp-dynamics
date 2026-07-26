# Stage 3.2 — M13 Enterprise Case Management — Implementation Plan

Grounded in the m07/m08/m09/m12 pattern. Built on `feature/stage-3-2-m13-case-management` from certified
`936e3377`. Counts below are **approximate** targets, finalized in the completion report.

## Sequence (planned)

1. **contracts** — two families `case.lifecycle` and `case.converted_to_matter` (~29 event types across both,
   version 1); wired into the `DomainEvent` union + `DOMAIN_EVENT_FAMILIES`; contracts smoke bumped two families.
   Consumption contract for the M12 handoff (`CaseHandoffRequested` / `feedback.escalated`).
2. **package skeleton + vocabularies** — `packages/m13-case` (package.json, tsconfig, root + apps/api refs);
   ~55 `cases.*` permissions (granular, no wildcard; privileged confidential / privileged-notes /
   settlement-approve / decision-approve / evidence-verify / platform); ~45 `CASE_*` audit codes.
3. **PURE domain** — limits + vocab (case types, priorities, party roles, activity/correspondence subtypes,
   issue classes, evidence kinds, relationship kinds); case + spec lifecycles (the 18 case states below);
   case-type spec + SLA-policy spec validation (versioned, immutable-after-publish, one-active); deterministic
   clock/date-driven SLA + deadline math; closure eligibility gate (machine-readable reason codes);
   relationship/duplicate matching; content-hash util.
4. **clock + date ports** — `Clock` (`SystemClock` + `FixedClock`) and `DateCalculator` so SLA + deadline math is
   deterministic; no ambient `Date.now`, no ambient calendar — deterministic doubles only.
5. **migrations** — `0001_case.sql` (~20 tables, RLS ENABLE+FORCE, composite keys/FKs, one-active versioned
   case types + SLA policies, `case_handoff_intake` idempotency on handoff id + tenant, append-only status /
   assignment / findings / evidence / decision ledgers, permission seed) and `0002_grant_application_role.sql`
   (NO DELETE anywhere; append-only ledgers INSERT+SELECT only).
6. **repository + emit + errors** — all SQL (optimistic-lock CAS on `version`, unique-constraint intake for the
   handoff, append-only inserts); `M13Emitter` (audit m03 + m06 outbox in the business tx).
7. **services** — Catalog (versioned immutable-after-publish case types + SLA policies), Case (intake incl. M12
   handoff, triage, assignment, the full lifecycle, closure, reopening), CaseWork (parties, activities, tasks,
   issues, investigation, findings, documents, evidence, deadlines, hearings, notes), CaseDecision (decisions with
   maker-checker, settlement, relationships, analytics/reporting); index.
8. **API** — `apps/api/src/cases` (views with redaction + controllers under `/api/v1/cases` + module binding
   Framework-Only clock/date ports; ~40 mutating endpoints + reads); wired into `AppModule`. No document storage
   references in responses.
9. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true` for
   both families; manifest m13 → implemented + `certification_3_2`; finalize `certification_3_1`.
10. **tests** — smoke (domain), db-spec (governance), services-db-spec (end-to-end + concurrency + maker-checker +
    idempotent M12 handoff), api-spec (HTTP + redaction).
11. **docs** — README, architecture/readiness/plan/completion, ADR-057…060+.

## Case lifecycle states

`draft` → `opened` → `triage` → `assigned` → `under_review` → `investigation` → `awaiting_information` /
`awaiting_internal_action` / `awaiting_external_action` → `hearing_scheduled` / `in_litigation` /
`under_recovery` → `decision_pending` → `resolved` → `closed`; with `reopened`, `cancelled` and `archived`.
Transitions are explicit and each carries preserved transition evidence in the append-only `case_status_history`.

## Design choices

- **~20 tables** (module-registry reference baseline is 18; the enterprise scope — versioned case types + SLA
  policies, the core record, status + assignment ledgers, parties, activities, tasks, issues, investigation,
  findings, documents, evidence, deadlines, hearings, decisions, settlement, notes, relationships, handoff intake
  — justifies ~20; documented).
- Case types + SLA policies are **declarative versioned data**; triage classification, SLA selection and closure
  eligibility delegate to m07 rules via a recorded `ruleEvaluationId` (ADR-057) — rules never mutate cases.
  Classification/priority/jurisdiction/root-cause are human/rule-driven fields, not AI outputs.
- SLA + deadline math is **deterministic** via injected `Clock` + `DateCalculator` ports (no ambient `Date.now`,
  no production calendar, ADR-058); timer dispatch + escalation delegate to m06/m08.
- Maker-checker on decisions + settlement (submitter ≠ approver); optimistic concurrency (`version` +
  `WHERE version=$expected`); idempotency on intake + M12 handoff via unique constraints — duplicate handoff
  events create no second case (ADR-059).
- Party contacts, privileged notes, correspondence bodies + confidential settlement terms are sensitive: redacted
  on read behind dedicated `cases.*` permissions, never in events/audit (ADR-060).
- **M12→M13 handoff** is idempotent single-case intake + completion port + `case.handoff.accepted`; **M13→M14**
  emits `case.converted_to_matter` — no fake matter table, no second escalation engine (ADR-059). Settlement +
  recovery/enforcement store finance **references** only — no ledger/journal/payment/reconciliation (ADR-060+).
  Real calendar/notification providers are deferred behind existing ports (documented).

## Verification

Every gate to be actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Approximate
counts (~55 permissions, ~45 audit codes, ~29 event types, ~40 mutating endpoints) confirmed in the completion
report.
