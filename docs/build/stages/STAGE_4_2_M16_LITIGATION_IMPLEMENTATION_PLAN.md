# Stage 4.2 — M16 Enterprise Litigation Management — Implementation Plan

Grounded in the m07/m08/m09/m12/m13/m14 pattern. Built on `feature/stage-4-2-m16-litigation-management` from
certified Stage 4.1 main `b6660a03` (cert PR #25). Counts below are **approximate** targets, finalized in the
completion report.

## Sequence (planned)

1. **contracts** — one family `litigation.lifecycle` (~36 event types, version 1); wired into the `DomainEvent`
   union + `DOMAIN_EVENT_FAMILIES` (12 → 13); contracts smoke bumped one family. The M14→M16 inbound contract
   (`MatterReferral`) plus the safe downstream boundary events (`EnforcementReferralReady`,
   `KnowledgeCandidateCreated`).
2. **package skeleton + vocabularies** — `packages/m16-litigation` (package.json, tsconfig, root + apps/api refs);
   ~56 `litigation.*` permissions (granular, no wildcard; ~20 privileged — strategy / pleadings / witness-
   statements / submissions / witness-contact / party-contact / confidential-terms / filing-approve / bundle-
   approve / config / platform); ~58 `LITIGATION_*` audit codes.
3. **PURE domain** — limits + vocab (proceeding sources, forum types, organization roles, confidentiality levels,
   litigation risks, priorities, party roles, claim types, filing roles, service methods, appearance types, witness
   types, order types, outcome types, deadline types, cost types, note types); proceeding + spec lifecycles (the 30
   proceeding states below); proceeding-type spec + SLA-policy spec validation (versioned, immutable-after-publish,
   one-active); deterministic clock-driven SLA + deadline + **limitation** math (limitation high-risk +
   distinguishable); closure eligibility gate (machine-readable reason codes); relationship rules; content-hash util.
4. **clock port** — `Clock` (`SystemClock` + `FixedClock`) so SLA + deadline + limitation math is deterministic;
   no ambient `Date.now`, no ambient calendar — deterministic doubles only; the `MatterReferral` +
   `ProceedingIntakeAdapter` seam for the M14 referral.
5. **migrations** — `0001_litigation.sql` (~25 tables, RLS ENABLE+FORCE, composite keys/FKs, one-active versioned
   proceeding types + SLA policies, `litigation_referral` idempotency on `referral_key` + tenant, append-only
   status / assignment / referral / proceeding-record / order / outcome / note ledgers, maker-checker SoD CHECKs on
   filing + bundle, single-winner columns on service + exhibit, one-active appeal per proceeding, permission seed)
   and `0002_grant_application_role.sql` (NO DELETE anywhere; the 7 append-only ledgers INSERT+SELECT only).
6. **repository + emit + errors** — all SQL (optimistic-lock CAS on `version`, unique-constraint referral ledger,
   single-winner CAS on service verification + exhibit admission, append-only inserts); `M16Emitter` (audit m03 +
   m06 outbox in the business tx).
7. **services** — Catalog (versioned immutable-after-publish proceeding types + SLA policies), Proceeding (referral
   intake incl. idempotent M14 referral, review, approval-to-file, assignment, the full lifecycle, closure,
   reopening), LitigationWork (parties, claims, filings maker-checker, service single-winner, appearances, the
   proceeding record, witnesses, experts, exhibits single-winner, bundles maker-checker + items, orders, compliance,
   outcomes, appeals, deadlines, costs, notes, relationships, analytics/reporting); index.
8. **API** — `apps/api/src/litigation` (views with redaction + 3 controllers under `/api/v1/litigation` + module
   binding Framework-Only clock port; mutating endpoints + reads); wired into `AppModule`. No document storage
   references in responses.
9. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true` for
   `litigation.lifecycle`; manifest m16 → implemented + `certification_4_2`; finalize `certification_4_1`.
10. **tests** — smoke (domain), db-spec (governance), services-db-spec (end-to-end + concurrency + maker-checker +
    single-winner + idempotent M14 referral + deterministic deadline/limitation breach), api-spec (HTTP +
    redaction).
11. **docs** — README, architecture/readiness/plan/completion, ADR-065…068.

## Proceeding lifecycle states

`draft` → `referred` → `under_review` → `approved_to_file` → `awaiting_filing` → `filed` → `awaiting_service` →
`served` → `awaiting_response` → `pleadings_open` → `case_management` → `directions` → `pre_trial` →
`hearing_scheduled` → `hearing` → `submissions` → `decision_pending` → `ruling_delivered` → `judgment_delivered` →
`appeal_pending` / `on_appeal` → `compliance` → `stayed` → `settled` → `withdrawn` → `dismissed` → `concluded` →
`closed`; with `reopened` and `archived`. Transitions are explicit and each carries preserved transition evidence
in the append-only `litigation_status_history`. `archived` is terminal.

## Design choices

- **~25 tables** (the enterprise scope — the proceeding as a first-class object, distinct from an M14 matter's
  court-event/deadline fields, with its own versioned proceeding types + SLA policies, the referral ledger, status
  + assignment ledgers, parties, claims, filings, service, appearances, the proceeding record, witnesses, experts,
  exhibits, bundles + items, orders, compliance obligations, outcomes, appeals, deadlines, costs, notes,
  relationships — justifies ~25; documented in ADR-066).
- Proceeding types + SLA policies are **declarative versioned data**; risk classification, SLA selection and
  closure eligibility delegate to m07 rules via a recorded `ruleEvaluationId` (ADR-065) — rules never mutate
  proceedings. Classification/risk/jurisdiction/forum are human/rule-driven fields, not AI outputs.
- SLA + deadline + limitation math is **deterministic** via an injected `Clock` port (no ambient `Date.now`, no
  production calendar, ADR-066); `limitation` deadlines are high-risk + distinguishable; timer dispatch +
  escalation delegate to m06/m08.
- Maker-checker on filing + bundle (preparer ≠ approver, service + DB CHECKs `litigation_filing_sod_ck` /
  `litigation_bundle_sod_ck`); single-winner CAS on service verification + exhibit admission; optimistic
  concurrency (`version` + `WHERE version=$expected`); idempotency on the M14 referral via the unique
  `litigation_referral` ledger — duplicate referrals on the same key create no second proceeding (ADR-065).
- Legal strategy, full pleadings, witness statements, full submissions, private witness/party contacts +
  confidential order/outcome terms are sensitive: redacted on read behind dedicated privileged `litigation.*`
  permissions, never in events/audit (ADR-068).
- **M14→M16 referral** is fire-and-forget + idempotent single-proceeding creation over the `MatterReferral`
  inbound contract; m16 owns no matter tables and never reads m14-owned tables; a matter may be referred several
  times. Litigation costs store court + finance **references** only — no ledger/accounts-payable/posting/payment/
  tax/reconciliation (ADR-067). Downstream M17/M18 reached only by safe boundary events. Real calendar/notification
  providers are deferred behind existing ports (documented).

## Verification

Every gate to be actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Approximate
counts (~56 permissions, ~58 audit codes, ~36 event types, ~25 tables, 30 states) confirmed in the completion
report.
