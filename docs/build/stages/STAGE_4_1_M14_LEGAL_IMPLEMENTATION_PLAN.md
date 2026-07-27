# Stage 4.1 — M14 Enterprise Legal Matter Management — Implementation Plan

Grounded in the m07/m08/m09/m12/m13 pattern. Built on `feature/stage-4-1-m14-legal-matters` from certified Stage
3.2 main `12628451` (cert PR #23). Counts below are **approximate** targets, finalized in the completion report.

## Sequence (planned)

1. **contracts** — one family `legal.lifecycle` (~36 event types, version 1); wired into the `DomainEvent` union +
   `DOMAIN_EVENT_FAMILIES` (11 → 12); contracts smoke bumped one family. Consumption contract for the M13
   conversion (`case.converted_to_matter`).
2. **package skeleton + vocabularies** — `packages/m14-legal` (package.json, tsconfig, root + apps/api refs);
   ~70 `legal.*` permissions (granular, no wildcard; ~23 privileged — positions / opinions / privileged-notes /
   party-contact / confidential-settlement / settlement-approve / config / platform); ~55 `LEGAL_*` audit codes.
3. **PURE domain** — limits + vocab (matter sources, confidentiality levels, legal risks, priorities, party roles,
   deadline types, court-event types, pleading roles, outcome types, enforcement stages, note types); matter + spec
   lifecycles (the 25 matter states below); matter-type spec + SLA-policy spec validation (versioned,
   immutable-after-publish, one-active); deterministic clock-driven SLA + deadline + **limitation** math (limitation
   high-risk + distinguishable); closure eligibility gate (machine-readable reason codes); relationship rules;
   content-hash util.
4. **clock port** — `Clock` (`SystemClock` + `FixedClock`) so SLA + deadline + limitation math is deterministic;
   no ambient `Date.now`, no ambient calendar — deterministic doubles only; the `CaseConversion` + `IntakeAdapter`
   seam for the M13 conversion.
5. **migrations** — `0001_legal.sql` (~25 tables, RLS ENABLE+FORCE, composite keys/FKs, one-active versioned
   matter types + SLA policies + jurisdictions, `legal_case_conversion` idempotency on `source_case_id` + tenant,
   append-only status / assignment / conversion / counsel-report / outcome / note ledgers, permission seed) and
   `0002_grant_application_role.sql` (NO DELETE anywhere; the 6 append-only ledgers INSERT+SELECT only).
6. **repository + emit + errors** — all SQL (optimistic-lock CAS on `version`, unique-constraint conversion ledger,
   append-only inserts); `M14Emitter` (audit m03 + m06 outbox in the business tx).
7. **services** — Catalog (versioned immutable-after-publish matter types + SLA policies + jurisdictions), Matter
   (intake incl. idempotent M13 conversion, instruction, triage, assignment, the full lifecycle, closure,
   reopening), MatterWork (parties, activities, tasks, issues, pleadings, court events, deadlines, research, notes),
   MatterLegal (positions, opinions, external counsel + reports, costs, settlement maker-checker, outcomes,
   relationships, analytics/reporting); index.
8. **API** — `apps/api/src/legal` (views with redaction + 4 controllers under `/api/v1/legal` + module binding
   Framework-Only clock port; mutating endpoints + reads); wired into `AppModule`. No document storage references
   in responses.
9. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true` for
   `legal.lifecycle`; manifest m14 → implemented + `certification_4_1`; finalize `certification_3_2`.
10. **tests** — smoke (domain), db-spec (governance), services-db-spec (end-to-end + concurrency + maker-checker +
    idempotent M13 conversion + deterministic deadline/limitation breach), api-spec (HTTP + redaction).
11. **docs** — README, architecture/readiness/plan/completion, ADR-061…064.

## Matter lifecycle states

`draft` → `instructed` → `opened` → `legal_review` → `awaiting_information` → `pre_action` → `negotiation` /
`mediation` / `arbitration` → `filed` → `awaiting_service` → `active_litigation` → `hearing` → `judgment_pending`
→ `judgment_entered` → `appeal_pending` / `on_appeal` → `settlement_pending` → `settled` → `enforcement` →
`resolved` → `closed`; with `reopened`, `withdrawn` and `archived`. Transitions are explicit and each carries
preserved transition evidence in the append-only `legal_matter_status_history`. `archived` is terminal.

## Design choices

- **~25 tables** (module-registry reference baseline is 23; the enterprise scope — matter as a first-class object
  with its own versioned matter types + SLA policies + jurisdictions, the core matter, status + assignment
  ledgers, the M13 conversion ledger, instructions, parties, activities, tasks, issues, positions, opinions,
  research, pleadings, court events, deadlines, external counsel + reports, costs, settlement, outcomes, notes,
  relationships — justifies ~25; documented in ADR-062).
- Matter types + SLA policies + jurisdictions are **declarative versioned data**; risk classification, SLA
  selection and closure eligibility delegate to m07 rules via a recorded `ruleEvaluationId` (ADR-061) — rules never
  mutate matters. Classification/risk/jurisdiction/forum are human/rule-driven fields, not AI outputs.
- SLA + deadline + limitation math is **deterministic** via an injected `Clock` port (no ambient `Date.now`, no
  production calendar, ADR-062); `limitation` deadlines are high-risk + distinguishable; timer dispatch +
  escalation delegate to m06/m08.
- Maker-checker on settlement (proposer ≠ approver, service + DB CHECK `legal_settlement_sod_ck`); optimistic
  concurrency (`version` + `WHERE version=$expected`); idempotency on the M13 conversion via the unique
  `legal_case_conversion` ledger — duplicate `case.converted_to_matter` events create no second matter (ADR-064).
- Legal positions/strategy, opinions, privileged notes, party contacts + confidential settlement terms are
  sensitive: redacted on read behind dedicated privileged `legal.*` permissions, never in events/audit (ADR-064).
- **M13→M14 conversion** is fire-and-forget + idempotent single-matter creation over `case.converted_to_matter`;
  m14 owns no case tables and never reads m13-owned tables. Costs, exposure + enforcement store finance + court
  **references** only — no ledger/accounts-payable/posting/payment/tax/reconciliation (ADR-063). Real calendar/
  notification providers are deferred behind existing ports (documented).

## Verification

Every gate to be actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Approximate
counts (~70 permissions, ~55 audit codes, ~36 event types, ~25 tables) confirmed in the completion report.
