# Stage 4.3 — M17 Enterprise Recovery & Enforcement — Implementation Plan

Grounded in the m07/m08/m09/m12/m13/m14/m16 pattern. Built on `feature/stage-4-3-m17-recovery-enforcement` from
certified Stage 4.2 main `b959298c` (cert PR #27); M17 approved for build via governance PR #28 (was `deferred`).
Counts below are **approximate** targets, finalized in the completion report.

## Sequence (planned)

1. **contracts** — one family `recovery.lifecycle` (~36 event types, version 1); wired into the `DomainEvent`
   union + `DOMAIN_EVENT_FAMILIES` (13 → 14); contracts smoke bumped one family. The M16→M17 inbound contract
   (`EnforcementReferral`) plus the safe downstream M18 boundary signal.
2. **package skeleton + vocabularies** — `packages/m17-recovery` (package.json, tsconfig, root + apps/api refs);
   ~58 `recovery.*` permissions (granular, no wildcard; ~20 privileged — debtor-contact / party-contact /
   negotiation-strategy / settlement-terms / bank-details / security-valuation / arrangement-approve /
   writeoff-approve / config / platform); ~55 `RECOVERY_*` audit codes.
3. **PURE domain** — limits + vocab (recovery sources, instrument types, recovery strategies, confidentiality
   levels, recovery risks, priorities, party roles, demand types, arrangement types, enforcement action types,
   security types, receipt types, deadline types, cost types, write-off reasons, outcome types, note types);
   recovery + spec lifecycles (the 29 recovery states below); recovery-type spec + SLA-policy spec validation
   (versioned, immutable-after-publish, one-active); deterministic clock-driven SLA + deadline + **limitation**
   math (limitation high-risk + distinguishable); closure eligibility gate (machine-readable reason codes);
   relationship rules; content-hash util.
4. **clock port** — `Clock` (`SystemClock` + `FixedClock`) so SLA + deadline + limitation math is deterministic;
   no ambient `Date.now`, no ambient calendar — deterministic doubles only; the `EnforcementReferral` +
   `RecoveryIntakeAdapter` seam for the M16 referral.
5. **migrations** — `0001_recovery.sql` (~25 tables, RLS ENABLE+FORCE, composite keys/FKs, one-active versioned
   recovery types + SLA policies, `recovery_referral` idempotency on `referral_key` + tenant, append-only status /
   assignment / referral / strategy / agent-report / receipt / waiver / outcome / note ledgers, maker-checker SoD
   CHECKs on arrangement + write-off recommendation, installment composite FK to the arrangement, permission seed)
   and `0002_grant_application_role.sql` (NO DELETE anywhere; the 9 append-only ledgers INSERT+SELECT only).
6. **repository + emit + errors** — all SQL (optimistic-lock CAS on `version`, unique-constraint referral ledger,
   append-only inserts); `M17Emitter` (audit m03 + m06 outbox in the business tx).
7. **services** — Catalog (versioned immutable-after-publish recovery types + SLA policies), Recovery (referral
   intake incl. idempotent M16 referral, review, strategy selection, assignment, the full lifecycle, closure,
   reopening), RecoveryWork (parties, instruments, strategies, demands, negotiations, arrangements maker-checker +
   installments, enforcement actions, security, agents + reports, receipts, waivers, write-off recommendations
   maker-checker, outcomes, deadlines, costs, notes, relationships, analytics/reporting); index.
8. **API** — `apps/api/src/recovery` (views with redaction + 3 controllers under `/api/v1/recovery` + module
   binding Framework-Only clock port; mutating endpoints + reads); wired into `AppModule`. No document storage
   references in responses.
9. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true` for
   `recovery.lifecycle`; manifest m17 → implemented + `certification_4_3`; finalize `certification_4_2`.
10. **tests** — smoke (domain), db-spec (governance), services-db-spec (end-to-end + concurrency + maker-checker +
    idempotent M16 referral + deterministic deadline/limitation breach), api-spec (HTTP + redaction).
11. **docs** — README, architecture/readiness/plan/completion, ADR-069…072.

## Recovery lifecycle states

`draft` → `referred` → `under_review` → `strategy_selection` → `demand_issued` → `awaiting_response` →
`negotiation` → `arrangement_pending` → `arrangement_active` → `arrangement_default` → `enforcement_pending` →
`enforcement_active` → `attachment` → `execution` → `auction` → `security_realization` → `agent_recovery` →
`partial_recovery` → `recovered` → `write_off_recommended` → `written_off` → `uncollectible` → `settled` →
`suspended` → `resolved` → `closed`; with `reopened`, `withdrawn` and `archived`. Transitions are explicit and each
carries preserved transition evidence in the append-only `recovery_status_history`. `archived` is terminal.

## Design choices

- **~25 tables** (the enterprise scope — the recovery as a first-class object, distinct from an M16 proceeding's
  enforcement fields, with its own versioned recovery types + SLA policies, the referral ledger, status +
  assignment ledgers, parties, enforceable instruments, strategies, demands, negotiations, arrangements +
  installments, enforcement actions, security, agents + reports, receipts, waivers, write-off recommendations,
  outcomes, deadlines, costs, notes, relationships — justifies ~25; documented in ADR-070).
- Recovery types + SLA policies are **declarative versioned data**; risk classification, SLA selection and closure
  eligibility delegate to m07 rules via a recorded `ruleEvaluationId` (ADR-069) — rules never mutate recoveries.
  Classification/risk/jurisdiction/instrument are human/rule-driven fields, not AI outputs.
- SLA + deadline + limitation math is **deterministic** via an injected `Clock` port (no ambient `Date.now`, no
  production calendar, ADR-070); `limitation` deadlines are high-risk + distinguishable; timer dispatch +
  escalation delegate to m06/m08.
- Maker-checker on arrangement + write-off recommendation (proposer/recommender ≠ approver, service + DB CHECKs
  `recovery_arrangement_sod_ck` / `recovery_writeoff_recommendation_sod_ck`); optimistic concurrency (`version` +
  `WHERE version=$expected`); idempotency on the M16 referral via the unique `recovery_referral` ledger — duplicate
  referrals on the same key create no second recovery (ADR-069).
- Debtor/party contacts, negotiation strategy, settlement terms, bank/payment details + security valuations are
  sensitive: redacted on read behind dedicated privileged `recovery.*` permissions, never in events/audit
  (ADR-072).
- **M16→M17 referral** is fire-and-forget + idempotent single-recovery creation over the `EnforcementReferral`
  inbound contract; m17 owns no proceeding/matter tables and never reads m16/m14-owned tables (opaque references);
  a proceeding may produce several referrals. M17 stores **ALL amounts as references** only — no cash application/
  ledger/AR/payment/reconciliation/accounting write-off; installments are met/missed schedule metadata, receipts
  are reference records, write-off is a recommendation with maker-checker approval (ADR-071). Downstream M18
  reached only by safe boundary signals. Real calendar/notification providers are deferred behind existing ports
  (documented).

## Verification

Every gate to be actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Approximate
counts (~58 permissions, ~55 audit codes, ~36 event types, ~25 tables, 29 states) confirmed in the completion
report.
