# Stage 3.2 — M13 Enterprise Case Management — Post-Merge Certification

**Date:** 2026-07-27
**Module:** `m13-case` (enterprise case management: configurable case types + SLA policies, the M12 feedback
handoff, triage, assignment, parties, activities, tasks, issues, investigation, findings, documents/evidence,
deadlines, hearings, decisions, settlement, the recovery/legal boundary, closure, reopening, relationships,
analytics).
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch
`cert/stage-3-2-m13-case-management`; certification PR pending, not merged).

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#22** |
| Reviewed implementation head | `5cf058637a3dd03fd08ee0a5928a5e19c977b679` |
| Implementation merge SHA (squash) | `4c5ae6a41d2d693014ecb6a603f967e542c6c28f` |
| Certified baseline SHA (main tested) | `4c5ae6a41d2d693014ecb6a603f967e542c6c28f` |
| Certification branch | `cert/stage-3-2-m13-case-management` (cut from merged main) |
| Parent baseline (pre-merge main) | `936e33779e0944b0a1630fd87220a2c1447fe2d9` (certified Stage 3.1, cert PR #21) |
| PR #22 | `state: closed`, `merged: true`, `merged_at: 2026-07-26T20:16:55Z`, base `main` |

**Tree-equivalence:** PR #22 was **squash-merged** (`4c5ae6a` has a single parent `936e337`), so the reviewed
head is not a literal ancestor — ancestry is not required. `git diff 5cf0586 4c5ae6a` is **empty**: the merged
tree is **byte-identical** to the reviewed head across the entire repository. No unexpected files.

## 2. Scope certified (merge diff `936e337..4c5ae6a`)

54 files, +10079/−49. ADR-057…060; the m13 architecture/readiness/plan/completion docs + this certification
report; `packages/m13-case` (domain, ports, migrations, repository, four services, emitter, permissions/audit
codes, tests); `packages/contracts/src/case-events.ts` + the `DomainEvent` union (9→**11** families) + the
contracts smoke; cases permissions (56, registered **and seeded**); cases audit codes (50); event-registry
`case.lifecycle` + `case.converted_to_matter` (GAP-1 closed); m13 migrations; `/api/v1/cases` API (10 files under
`apps/api`) + `AppModule` wiring; m13 tests; build wiring (`tsconfig.json`); manifest Stage 3.2 block + the
**truthful `certification_3_1` finalization** (m12 cert PR #21 → certified); the assertion-count bump in
`contracts`/`m02-identity` smoke.

**Exclusions (verified absent):** no m14/finance/reconciliation/accounting/general-ledger/journal/payment/
collections implementation; no AI; no production court-filing / calendar / telephony / SMS / email adapter; no
external-counsel or customer portal; no document editor; no regulatory-reporting engine; no later modules (a
`git diff --name-only` grep for `m14|m15|m19|m20|m21|finance|reconcil|journal|ledger|payment|ai` returns nothing
but m13/registry/doc lines). **No second outbox; no duplicate audit table; no second RBAC engine; no second
escalation engine; no case table owned by m12; no legal-matter tables owned by m13.**

## 3. Local gate results (baseline `4c5ae6a`)

Environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative — see §11); Node **v22.14.0**;
connected via `DATABASE_APP_ROLE=finapp_app` + `DATABASE_OWNER_ROLE=finapp_owner` (non-superuser, RLS enforced).
Lint ran on a **wiped `dist`** (CI lint-before-build order).

| Gate | Result |
| --- | --- |
| Format check | ✅ PASS |
| Lint (wiped dist) | ✅ **0 errors** |
| Build / typecheck | ✅ 0 type errors |
| PURE smoke | ✅ **17 suites, 2771 assertions, 0 failures** (m13-case 67) |
| Conformance | ✅ **1193 assertions** (endpoint perms/audit + RLS convention + `registered_code_count`=len + GAP-1) |
| Migration replay (fresh) | ✅ **22 applied, 0 already-applied** (from an empty database), dependency order |
| DB integration + API specs | ✅ **28 specs, 783 assertions, 0 failures** (m13-case 34, m13-services 31, **api-cases 15**) |

## 4. Database governance (live checks on `finapp_cert2`)

Table inventory derived from the migrated schema (not the report): **20** m13 tables — `case_type`,
`case_sla_policy`, `case_record`, `case_handoff_intake`, `case_status_history`, `case_assignment_history`,
`case_party`, `case_activity`, `case_task`, `case_issue`, `case_investigation`, `case_finding`, `case_document`,
`case_evidence`, `case_deadline`, `case_hearing`, `case_decision`, `case_settlement`, `case_note`,
`case_relationship`.

- **RLS:** all **20/20** report `relrowsecurity=t` AND `relforcerowsecurity=t`; each has a `tenant_isolation`
  policy (20/20). Composite `(tenant_id,id)` PKs; **19** composite tenant-safe FKs.
- **Grants:** **0 DELETE** grants to `finapp_app` on any m13 table; the five append-only ledgers
  (`case_status_history`, `case_assignment_history`, `case_finding`, `case_note`, `case_handoff_intake`) grant
  exactly `INSERT, SELECT` (**0 UPDATE**). No hidden superuser dependency (the DB lane runs as `finapp_app`).
- **Constraints/indexes:** one-active (`case_type_one_active`, `case_sla_policy_one_active`); idempotency
  (`case_record_idem_key`, `case_handoff_intake_handoff_key`); case-number uniqueness (`case_record_number_key`);
  relationship active-uniqueness (`case_relationship_active_key`); the **decision + settlement SoD CHECKs**
  (`case_decision_sod_ck`, `case_settlement_sod_ck` — `approved_by <> submitted_by/proposed_by`); the relationship
  **self-edge CHECK** (`case_relationship_noself_ck`); the 18-state `case_record_status_ck` lifecycle CHECK.
- **Optimistic concurrency:** **14** tables carry a `version` column; the five append-only ledgers and the
  CAS-verified `case_evidence` correctly do not. Historical (m01–m12) migrations were **not** edited — the merge
  only added `packages/m13-case/migrations/*`.

## 5. M12 → M13 handoff (§10)

Proven end-to-end over HTTP (`api-cases`) AND at the service layer (`m13-services`): m12 requests a case handoff
(`POST /feedback/records/:id/case-handoff`) → m13 accepts it (`POST /cases/handoff`) → **exactly one case per
handoff** (a repeat returns the same case; idempotent via the `case_handoff_intake` unique ledger) → the m12
feedback transitions to **`converted_to_case`**. The originating feedback id + correlation/causation are
preserved; the case records `source='feedback_handoff'`, `originating_module='m12-feedback'`. Integration is
through a **`FeedbackHandoffSource` port** bound (in `apps/api`) to a `M12FeedbackHandoffAdapter` over m12's
**public `RecordsService`** — m13 issues no query against an m12-owned table, and m12 owns no case table.
Completion is reported back through the governed boundary and is triggered **only on first creation** (m12's
`completeCaseHandoff` is not idempotent on a non-pending handoff).

## 6. Case types, lifecycle, numbers, triage, assignment (§11-15)

- **Case types + SLA policies:** versioned, immutable-after-publish specs (one ACTIVE per code+scope,
  content-hash frozen at publish); `spec.code` must equal the code; scope `tenant`/`platform` (platform requires
  `cases.platform.administer`); invalid specs rejected by the validators. Declarative — no executable expression;
  decisioning delegates to m07 (ADR-057). Proven in `m13-services` (create→validate→publish→activate).
- **Lifecycle:** **18** states (`case_record_status_ck`), transitions through the PURE `checkCaseTransition`
  choke point; invalid transitions rejected; `case_status_history` is **append-only** transition evidence; stale
  versions rejected (optimistic lock); `closed` is reopenable/archivable; `cancelled`/`archived` are terminal.
- **Case numbers:** `CASE-<12 hex>` — deterministic format, tenant-scoped, unique (`case_record_number_key`),
  stable after creation; a duplicate number is rejected (proven in `m13-case`).
- **Triage:** captures severity/priority/confidentiality/risk/team/recommended SLA/legal status; records a
  `ruleEvaluationId` when supplied; m07 rules return typed decisions and never mutate the case (ADR-057). Proven.
- **Assignment/reassignment:** append-only `case_assignment_history`; delegation flag; a stale version is
  rejected (proven). Reassignment requires `cases.case.reassign`.

## 7. Working entities — parties, activities, tasks, issues, investigation, findings, evidence (§16-21, §29)

Proven in `m13-services`: parties (references, not duplicated master data; contact redacted, ADR-060);
activities (headline + free-text, incl. correspondence via subtype; full documents stay in m09; narratives never
in events/audit); tasks (orchestration delegated to m06 via `workflow_task_ref`; single-completion CAS); issues/
allegations (independent per case, mandatory flag gating closure); one investigation per case
(`case_investigation_case_key`), completion is single-transition; **append-only** findings per issue; document
**references** to m09 (no bytes; storage refs never exposed); evidence register with **single-winner verify**
(`verification_status='unverified'` CAS — a second verify loses) and **no forensic chain-of-custody claim**.

## 8. Deadlines, hearings, SLA, escalation, workflow, rules (§22-28)

- **Deadlines:** deterministic due-date computation (offset-days / explicit) against an injected `Clock`;
  `evaluateDeadline` marks breach single-winner once the clock passes due (proven with a `FixedClock` — a fresh
  deadline is not breached, a clock advance breaches). Extension is permission-controlled + audited.
- **Hearings:** scheduling/update/complete with optimistic locking; adjournment; no production calendar (virtual
  link is a redactable reference).
- **SLA:** versioned policy; `startSla` materializes stage deadlines (no bespoke SLA-instance table, ADR-058);
  no ambient `Date.now`; timer dispatch delegated to m06/m08.
- **Escalation:** reuses m08 by **publishing a `CaseEscalated` event** + recording an escalation reference — no
  second escalation engine (proven in `m13-services`).
- **Workflow/rules:** m06 references (`workflow_instance_ref`, `workflow_task_ref`) link case + workflow state
  without conflating them; m07 is consumed via recorded `ruleEvaluationId`, typed facts only, never mutating.

## 9. Decisions, settlement, recovery boundary, remedies (§30-33)

- **Decisions:** **maker-checker** — the submitter cannot approve their own decision (proven: self-approve returns
  409 in `m13-services` AND over HTTP; an independent approver succeeds), enforced in the service AND the
  `case_decision_sod_ck` DB CHECK; append-only; approval is a single CAS transition.
- **Settlement:** **maker-checker** (`case_settlement_sod_ck`); confidential terms + amount are redacted (view)
  and never in events/audit; no payment execution.
- **Recovery/remedies:** store **finance references only** (integer minor units as reference data; recovery
  state/claimed/recovered) — m13 implements no ledger, journal, payment allocation, reconciliation, or
  collections accounting (ADR-059). Remedies are captured on the decision.

## 10. Closure, reopening, archival, relationships, notes (§35-39)

- **Closure** is **rule-gated** (`evaluateClosure` returns machine-readable reason codes): an un-worked case is
  refused (no approved decision / open mandatory task / open deadline / unresolved mandatory issue / active legal
  hold), a fully-worked case closes (proven in `m13-services` + HTTP). A legal hold blocks archival.
- **Reopening** requires a reason (audited, `reason_required`); prior closure history is preserved (append-only
  status history); reopen retains prior closure evidence.
- **Relationships:** typed, tenant-scoped; **self-edge rejected** (CHECK); a reverse duplicate/parent-child edge
  is rejected (cycle guard); active-unique.
- **Notes:** confidential/privileged/legal-advice notes require `cases.privileged_notes.create`, are filtered on
  read unless the caller holds `cases.privileged_notes.read` (privileged access audited), and note **content is
  never placed in events or audit** (ADR-060).

## 11. Authoritative CI (PostgreSQL 16)

Implementation PR **#22**, head `5cf0586` — **Smoke lane + DB lane both `success`** on `postgres:16`. Post-merge
push to main `4c5ae6a` — **Smoke lane + DB lane both `success`**. The merged tree is byte-identical to the
reviewed head, so the PG16 evidence transfers to the certified baseline. The local PG15.2 run independently
re-confirms every gate.

## 12. Authorization, audit, events & outbox (§43-46)

- **Authorization:** **56** `cases.*` permissions, **seeded** (**15** privileged incl. `cases.confidential.read`,
  `cases.privileged_notes.read/create`, `cases.decision.approve`, `cases.settlement.approve`,
  `cases.evidence.verify`, `cases.party_contact.read`, `cases.legal.manage`, `cases.recovery.manage`,
  `cases.type.manage`, `cases.sla_policy.manage`, `cases.case.reopen`, `cases.case.archive`,
  `cases.analytics.export`, `cases.platform.administer`); every mutating route declares its 3-segment permission
  (`@Endpoint`), enforced server-side (default deny). Proven over HTTP: 401 anon; an `x-permissions` header
  cannot self-grant (403).
- **Audit:** **50** `CASE_` codes via the m03 `AUDIT` port (no duplicate audit table); `registered_code_count`
  213→**263** = len(codes) (conformance-enforced); the 8 core case-record codes are `CASE_RECORD_*` (3-segment
  format); payloads carry ids/states/reason codes only — no private contacts, privileged/confidential notes, full
  narratives, document contents, confidential settlement terms, legal advice, or secrets.
- **Events / contracts:** `case.lifecycle` (**32** types) + `case.converted_to_matter` (**1** type), version 1,
  owned by m13, registered in event-registry + naming-map (GAP-1 closed) and in the contracts `DomainEvent` union
  (9→**11** families); `case.converted_to_matter` is the controlled m14 boundary. Both classified `confidential`;
  payloads carry ids/states/dates/reason codes only.
- **Outbox:** m13 owns **no** outbox — the only `%outbox%` table is m06's `workflow_event_outbox`. m13 publishes
  through it in the caller's transaction (atomic, no dual-write, no second delivery path).

## 13. API security, privacy & analytics (§40, §47)

Proven over HTTP + at the service layer: cross-tenant reads return nothing (RLS); confidential case detail is
`[redacted]` for a caller without `cases.confidential.read` (a privileged caller reads it, and the access is
audited); party contacts, privileged notes and confidential settlement terms are redacted; storage references
are never exposed; maker-checker cannot be bypassed; a header cannot self-grant. Analytics are **bounded
aggregate counts over safe dimensions** inside tenant context — no contact/privileged/settlement leakage, no raw
SQL input, no cross-tenant inference.

## 14. Idempotency & concurrency (§41-42)

DB-enforced idempotency on the M12 handoff (`case_handoff_intake` unique), case creation + external intake
(partial unique idempotency key); a repeat returns the stored row. Concurrency safety via optimistic locks
(14 `version` columns), single-winner CAS (queue-less: evidence verify, deadline breach, task/activity/hearing
completion, decision/settlement approval), unique constraints and transition guards — a duplicate handoff creates
no second case, a stale version loses, a self-approval is refused. Proven in `m13-services` + `api-cases`.

## 15. Repository-derived counts (§48)

| Item | Count |
| --- | --- |
| Files changed vs Stage 3.1 baseline (excl. build output) | **54** (+10079 / −49) |
| Migrations (m13) | **2** (22 total in the repo) |
| Tables | **20** (20 RLS FORCE, 5 append-only) |
| Permissions (`cases.*`) | **56** (15 privileged) |
| Audit codes (`CASE_*`) | **50** (`registered_code_count` → 263) |
| Event types | **32** `case.lifecycle` + **1** `case.converted_to_matter` (11 families total) |
| API endpoints | **50** mutating (all audited `@Endpoint`) + **19** reads |
| Smoke suites / assertions | **17** / **2771** (m13 67, conformance 1193) |
| DB specs / assertions | **28** / **783** (m13-case 34, m13-services 31, api-cases 15) |
| ADRs | **4** (ADR-057…060) |

## 16. Documented limitations (deferred, not defects — each verified)

- **No finance / general ledger / accounting / journal posting / payment execution / reconciliation / full
  collections platform** — recovery + settlement store finance references only (ADR-059); those remain later
  modules (m19/m15/m20/m21).
- **No AI** — sentiment/classification/findings/decisions are human- or rule-driven (m07), never AI.
- **No production court-filing / calendar / telephony / SMS / email adapters** — deterministic ports/references
  only; notifications + escalation are delegated to m08.
- **No external-counsel / customer portal, no document editor, no full regulatory-reporting engine.**
- **M14 legal matters are a downstream boundary only** — m13 emits `case.converted_to_matter` and owns no
  legal-matter tables (legal-matter *support* fields live inline on the case).

None weakens any architecture, RLS, authorization, audit, maker-checker, immutability, SLA/deadline, privacy, or
test guarantee.

## 17. Verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** The M13 enterprise case-management module is implemented on `main`
(`4c5ae6a`), byte-identical to the reviewed PR #22 head, with all certification gates executed and green locally
and both authoritative PG16 CI lanes green. Certification is recorded on branch
`cert/stage-3-2-m13-case-management`; the certification PR is pending and **not merged**. No later module
(m14/finance) was touched.
