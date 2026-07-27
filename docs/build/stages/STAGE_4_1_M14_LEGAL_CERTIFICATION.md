# Stage 4.1 — M14 Enterprise Legal Matter Management — Post-Merge Certification

**Date:** 2026-07-27
**Module:** `m14-legal` (enterprise legal matter management: configurable versioned matter types + SLA policies +
jurisdictions, the M13 case conversion, legal instructions, assignment, parties, activities/correspondence, tasks,
issues, legal positions/strategy, opinions, research references, pleadings, court events, deadlines + limitation,
external counsel + reports, cost + exposure references, maker-checker settlements, judgments/outcomes, appeal +
enforcement tracking, closure/reopening/archival, relationships, analytics).
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch
`cert/stage-4-1-m14-legal-matters`; certification PR pending, not merged).

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#24** |
| Reviewed implementation head | `baf4c71330a894fba378bb24a908b622fb68d8cf` |
| Implementation merge SHA (squash) | `41e7bf42ce8ba9b2cd02d50a9af73e8bb70d30a2` |
| Certified baseline SHA (main tested) | `41e7bf42ce8ba9b2cd02d50a9af73e8bb70d30a2` |
| Current `origin/main` | `41e7bf42ce8ba9b2cd02d50a9af73e8bb70d30a2` (= the merge commit) |
| Certification branch | `cert/stage-4-1-m14-legal-matters` (cut from merged main) |
| Parent baseline (pre-merge main) | `12628451a9b4427724d08adbca8b9d626160aa92` (certified Stage 3.2, cert PR #23) |
| PR #24 | `state: closed`, `merged: true`, `merged_at: 2026-07-27T06:53:29Z`, base `main` |

**Tree-equivalence:** PR #24 was **squash-merged** (`41e7bf4` has a single parent `1262845`), so the reviewed head
is not a literal ancestor — ancestry is not required. `git diff baf4c71 41e7bf4` is **empty**: the merged tree is
**byte-identical** to the reviewed head across the entire repository. No unexpected files. `origin/main` is exactly
the merge commit.

## 2. Scope certified (merge diff `1262845..41e7bf4`)

53 files, +10688/−48. ADR-061…064; the m14 architecture/readiness/plan/completion docs + this certification report;
`packages/m14-legal` (27 files: domain, ports, hash, errors, matter-number, migrations, repository, four services,
emitter, permissions/audit codes, tests, README, package/tsconfig); `packages/contracts/src/legal-events.ts` + the
`DomainEvent` union (11→**12** families) + the contracts smoke; legal permissions (70, registered **and seeded**);
legal audit codes (55); event-registry `legal.lifecycle`; m14 migrations; `/api/v1/legal` API (6 files under
`apps/api/src/legal`) + `AppModule` wiring + `apps/api` package/tsconfig; m14 tests; build wiring (root `tsconfig`,
`package-lock`); manifest Stage 4.1 block + the truthful `certification_3_2` finalization (already certified in the
baseline); the family-count bump in `m02-identity` smoke.

**Exclusions (verified absent):** no M16/M17/M18 internals; no finance / general-ledger / accounts-payable / journal-
posting / payment / reconciliation / collections-accounting implementation; no AI (legal research/summarization/
drafting/decisioning); no production court-filing / court-scraping / calendar / telephony / SMS / email adapter; no
external-counsel or customer portal; no vendor-management platform; no full regulatory-reporting engine; no later
modules (`git diff --name-only 1262845..41e7bf4 | grep -iE 'm16|m17|m18|m15|m19|finance|recon|ledger|journal|payment|
collections'` returns nothing). **No second outbox; no duplicate audit table; no second RBAC engine; no second
workflow engine; no second escalation engine; m14 owns no case table; m13 owns no legal-matter table.**

## 3. Local gate results (baseline `41e7bf4`)

Environment: PostgreSQL **15.2** throwaway (`finapp_cert4`, port 5434 — CI PostgreSQL 16 is authoritative, see §11);
connected via `DATABASE_APP_ROLE=finapp_app` + `DATABASE_OWNER_ROLE=finapp_owner` (non-superuser, RLS enforced). Lint
ran on a **wiped `dist`** (CI lint-before-build order). The throwaway database was recreated from empty and removed
after verification.

| Gate | Result |
| --- | --- |
| Format check | ✅ PASS |
| Lint (wiped dist) | ✅ **0 errors** (32 style warnings, matching the certified baseline pattern) |
| Build / typecheck | ✅ 0 type errors |
| PURE smoke | ✅ **18 suites, 3092 assertions, 0 failures** (m14-legal 60) |
| Conformance | ✅ **1448 assertions** (endpoint perms/audit + RLS convention + `registered_code_count`=len + event-family registration) |
| Migration dry-run | ✅ lists all 24 migrations incl. the two m14 files, dependency order |
| Migration replay (fresh) | ✅ **24 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **31 specs, 876 assertions, 0 failures** (m14-legal 40, m14-services 30, **api-legal 23**) |

## 4. Database governance (live checks on `finapp_cert4`)

Table inventory derived from the migrated schema (not the report): **25** m14 tables — `legal_matter_type`,
`legal_sla_policy`, `legal_jurisdiction`, `legal_matter`, `legal_case_conversion`, `legal_matter_status_history`,
`legal_assignment_history`, `legal_instruction`, `legal_party`, `legal_activity`, `legal_task`, `legal_issue`,
`legal_position`, `legal_opinion`, `legal_research_reference`, `legal_pleading`, `legal_court_event`,
`legal_deadline`, `legal_external_counsel`, `legal_counsel_report`, `legal_cost_reference`, `legal_settlement`,
`legal_outcome`, `legal_note`, `legal_relationship`.

- **RLS:** all **25/25** report `relrowsecurity=t` AND `relforcerowsecurity=t`; each has a `tenant_isolation`
  policy (25/25). Composite `(tenant_id,id)` PRIMARY KEYs on all 25; **22** composite tenant-safe FKs.
- **Grants:** **0 DELETE** grants to `finapp_app` on any m14 table; the six append-only ledgers
  (`legal_matter_status_history`, `legal_assignment_history`, `legal_case_conversion`, `legal_counsel_report`,
  `legal_outcome`, `legal_note`) grant exactly `INSERT, SELECT` (**0 UPDATE**). The DB lane runs entirely as the
  non-owner `finapp_app` — no hidden superuser dependency.
- **Constraints/indexes:** one-active (`legal_matter_type_one_active`, `legal_sla_policy_one_active`); idempotency
  (`legal_matter_idem_key`, `legal_case_conversion_case_key` = one matter per source case); matter-number
  uniqueness (`legal_matter_number_key`); the **settlement SoD CHECK** (`legal_settlement_sod_ck` — `approved_by
  <> proposed_by`); the relationship **self-edge CHECK** (`legal_relationship_noself_ck`) + active-uniqueness; the
  25-state `legal_matter_status_ck` lifecycle CHECK (+ confidentiality/priority/optlock CHECKs).
- **Optimistic concurrency:** **17** tables carry a `version` column; the append-only ledgers and single-winner
  tables correctly do not. Historical (m01–m13) migrations were **not** edited — the merge only added
  `packages/m14-legal/migrations/*`.

## 5. M13 → M14 conversion (§10)

Proven end-to-end over HTTP (`api-legal`) AND at the service layer (`m14-services`): m13 creates a case
(`POST /cases`) → m13 converts it (`POST /cases/:id/convert-to-matter`, which records an audit + publishes
`case.converted_to_matter` through the m06 outbox) → m14 accepts the conversion (`POST /legal/from-case`) → **exactly
one matter per source case** (a repeat returns the same matter, `created=false`; idempotent via the
`legal_case_conversion` unique ledger keyed on `source_case_id`). The source case id is preserved
(`source_case_id`), `source='case_conversion'`, and correlation/causation flow through. The conversion is
**fire-and-forget**: m14 consumes the versioned `case.converted_to_matter` contract and issues no query against an
m13-owned table; m13 owns no legal-matter table. Matter creation + the `MatterCreated`/`MatterConvertedFromCase`
event intents commit in one transaction through the single m06 outbox.

## 6. Matter types, jurisdictions, lifecycle, numbers, instructions, assignment (§11-16)

- **Matter types + SLA policies:** versioned, immutable-after-publish specs (one ACTIVE per code+scope, content-hash
  frozen at publish); `spec.code` must equal the code; invalid specs (bad code, invalid default risk, non-string
  required roles, negative minutes, warn % > 100) are rejected by the validators. Configurable — nothing Aptic-/
  Kenya-specific hardcoded (ADR-061). Proven in `m14-services` (create→validate→publish→activate).
- **Jurisdictions/forums:** `legal_jurisdiction` is a tenant-configurable reference (court/tribunal/arbitration/
  mediation/regulatory), permission-controlled (`legal.jurisdiction.manage`); no hardcoded forum logic; non-
  litigation matters do not require court data.
- **Lifecycle:** **25** states (`legal_matter_status_ck`), transitions through the PURE `checkMatterTransition`
  choke point; invalid transitions rejected; `legal_matter_status_history` is **append-only**; stale versions
  rejected (optimistic lock); `archived` is the sole terminal; reopened matters preserve prior closure history.
- **Matter numbers:** `MATTER-<12 hex>` — deterministic format, tenant-scoped, unique (`legal_matter_number_key`),
  stable after creation; a duplicate number is rejected (proven in `m14-legal`).
- **Instructions:** controlled accept/reject with optimistic locking; an authorized user accepts or rejects (with a
  reason); acceptance status is `pending/accepted/rejected/superseded`; unauthorized users cannot decide; full
  privileged instruction narratives never enter events/audit (ADR-064). Proven in `m14-services` + HTTP.
- **Assignment/reassignment:** append-only `legal_assignment_history`; assignment advances an opened matter to
  `legal_review`; a stale version is rejected; reassignment requires `legal.matter.reassign`. Proven.

## 7. Working entities — parties, activities, tasks, issues, positions, opinions, research (§17-23)

Proven in `m14-services`: parties (references to master data, not duplicated; contact redacted, ADR-064; role
vocabulary validated); activities (headline + free-text, incl. correspondence via subtype/direction; full documents
stay in m09; narratives never in events/audit); tasks (orchestration delegated to m06 via `workflow_task_ref`;
single-completion; mandatory flag gates closure); issues (independent per matter, mandatory flag); **legal
positions/strategy** (gated behind `legal.position.read` — a caller without it is refused; content never in
events/audit; ADR-064); **opinions** (metadata + m09 document reference; summary redacted from non-confidential
readers; full opinion stays in m09); research references (citation/summary metadata only — no large copyrighted
text, no AI research).

## 8. Deadlines & limitation, court events, pleadings, SLA, workflow, rules, notifications (§24-30)

- **Deadlines & limitation:** deterministic due-date computation (offset-days / explicit) against an injected
  `Clock`; `evaluateDeadline` marks breach single-winner once the clock passes due (proven with a `FixedClock` — a
  fresh deadline is not breached; a 3-day advance past a 1-day deadline breaches). `limitation` is a distinct
  high-risk deadline type with an explicit safety check; extension is permission-controlled.
- **Court events:** scheduling/update/complete with optimistic locking; adjournment; date integrity; no production
  calendar (virtual link is a redactable reference).
- **Pleadings/documents:** metadata + m09 document references only (no bytes in m14); filing status lifecycle; no
  production court-filing integration; storage references redacted.
- **SLA:** versioned policy; `startSla` materializes stage deadlines; deterministic (no ambient `Date.now`); timer
  dispatch delegated to m06/m08 (ADR-062).
- **Workflow/rules/notifications:** m06 references (`workflow_instance_ref`) link matter + workflow state without
  conflating them; m07 is consumed via a recorded evaluation id, typed facts only, never mutating; escalation reuses
  m08 by **publishing an event** + recording an escalation reference — no second escalation engine.

## 9. External counsel, costs, exposure, settlement, outcomes, appeal, enforcement (§31-38)

- **External counsel + reports:** firm/advocate **references**, engagement/reporting metadata; counsel reports are
  metadata + m09 document references (full report in m09, excluded from events/audit). No vendor-management platform,
  no accounts payable, no bank/payment details.
- **Costs + exposure:** `legal_cost_reference` and matter exposure fields store **finance + court references only**
  (integer minor units as reference data) — no ledger, journal posting, payment execution, tax engine, or
  reconciliation (ADR-063). Exposure aggregates are permission-controlled.
- **Settlement:** **maker-checker** — the proposer cannot approve their own settlement (proven: self-approve returns
  409 in `m14-services` AND over HTTP; an independent approver succeeds), enforced in the service AND the
  `legal_settlement_sod_ck` DB CHECK; confidential terms + amount are redacted (view) and never in events/audit; no
  payment execution.
- **Outcomes/judgments:** typed outcome vocabulary; safe summary + awarded/costs amounts as references; full
  judgments remain in m09. **Appeal** + **enforcement** are reference-only tracking (stage vocabulary, deadlines,
  recovered amount as a reference) — no collections accounting, no production enforcement integration, no hidden
  M16/M17/M18.

## 10. Closure, reopening, archival, relationships, notes (§40-44)

- **Closure** is **rule-gated** (`evaluateClosure` returns machine-readable reason codes): an un-worked matter is
  refused (missing outcome, open mandatory task, open deadline, imminent limitation, active legal hold, open
  critical escalation), a fully-worked matter closes (proven in `m14-services` + HTTP). A legal hold blocks archival.
- **Reopening** requires a reason; prior closure history is preserved (append-only status history).
- **Relationships:** typed (11 kinds incl. `converted_from_case`), tenant-scoped; **self-edge rejected** (CHECK);
  active-unique. Proven.
- **Notes:** confidential/privileged/counsel/strategy notes are restricted; privileged content is filtered on read
  unless the caller holds the privileged permission, and note **content is never placed in events or audit**
  (ADR-064).

## 11. Authoritative CI (PostgreSQL 16)

Implementation PR **#24**, head `baf4c71` — **Smoke lane + DB lane both `success`** on `postgres:16`. Post-merge
push to main `41e7bf4` — **Smoke lane + DB lane both `success`**. The merged tree is byte-identical to the reviewed
head, so the PG16 evidence transfers to the certified baseline. The local PG15.2 run independently re-confirms every
gate.

## 12. Authorization, audit, events & outbox (§47-50)

- **Authorization:** **70** `legal.*` permissions, **seeded** (**23** privileged incl. `legal.confidential.read`,
  `legal.privileged.read`, `legal.position.read`, `legal.party_contact.read`, `legal.instruction.accept/reject`,
  `legal.settlement.approve`, `legal.matter.reopen/archive`, the `*.manage` configuration set, and
  `legal.platform.administer`); every mutating route declares its 3-segment permission (`@Endpoint`), enforced
  server-side (default deny). Proven over HTTP: 401 anon; an `x-permissions` header cannot self-grant (403).
- **Audit:** **55** `LEGAL_` codes via the m03 `AUDIT` port (no duplicate audit table); `registered_code_count`
  263→**318** = len(codes) (conformance-enforced); all codes are ≥3-segment `LEGAL_<ENTITY>_<ACTION>`; payloads
  carry ids/states/reason codes only — no legal advice, strategy, full opinions, privileged notes, private contacts,
  document contents, confidential settlement terms, raw correspondence, or secrets.
- **Events / contracts:** `legal.lifecycle` (**36** types), version 1, owned by m14, registered in event-registry
  and in the contracts `DomainEvent` union (11→**12** families); classified `confidential`; payloads carry
  ids/states/dates/reason codes and bounded safe amounts only.
- **Outbox:** m14 owns **no** outbox — the only `%outbox%` table is m06's `workflow_event_outbox`. m14 publishes
  through it in the caller's transaction (atomic, no dual-write, no second delivery path); the M13 conversion is
  idempotent so duplicate delivery is safe.

## 13. API security, privacy & analytics (§51-52)

Proven over HTTP + at the service layer: cross-tenant reads return nothing (RLS); a confidential/privileged matter's
`legalDescription` is `[redacted]` for a caller without `legal.confidential.read` (a privileged caller reads it, and
the access is audited); party contacts, legal positions, opinion contents, privileged notes and confidential
settlement terms are redacted; storage references are never exposed; maker-checker cannot be bypassed; a header
cannot self-grant. Analytics are **bounded aggregate counts over safe dimensions** inside tenant context — no
privileged/contact/settlement leakage, no raw SQL input, no cross-tenant inference.

## 14. Idempotency & concurrency (§45-46)

DB-enforced idempotency on the M13 conversion (`legal_case_conversion` unique on `source_case_id`) and matter
creation (partial unique idempotency key); a repeat returns the stored row/matter. Concurrency safety via optimistic
locks (17 `version` columns), single-winner deadline breach, unique constraints and transition guards — a duplicate
conversion creates no second matter, a stale version loses, a self-approval is refused. Proven in `m14-services` +
`api-legal`. (One real bug was surfaced by the HTTP spec during implementation: `recordOutcome` stamps the matter
and bumps its version, so a subsequent close must re-read the current version — fixed and re-verified; no residual
defect.)

## 15. Repository-derived counts (§53)

| Item | Count |
| --- | --- |
| Files changed vs Stage 3.2 baseline (excl. build output) | **53** (+10688 / −48) |
| Migrations (m14) | **2** (24 total in the repo) |
| Tables | **25** (25 RLS FORCE, 6 append-only) |
| Permissions (`legal.*`) | **70** (23 privileged) |
| Audit codes (`LEGAL_*`) | **55** (`registered_code_count` → 318) |
| Event types | **36** `legal.lifecycle` (12 families total) |
| API endpoints | **56** mutating (all audited `@Endpoint`) + **23** reads |
| Matter lifecycle states | **25** (terminal: `archived`) |
| Smoke suites / assertions | **18** / **3092** (m14 60, conformance 1448) |
| DB specs / assertions | **31** / **876** (m14-legal 40, m14-services 30, api-legal 23) |
| ADRs | **4** (ADR-061…064) |

## 16. Documented limitations (deferred, not defects — each verified)

- **No M16 / M17 / M18 internals** — litigation, recovery/enforcement, and legal-documents/knowledge remain later
  modules; M14 provides the matter foundation only.
- **No finance / general ledger / accounts payable / journal posting / payment execution / reconciliation /
  collections accounting** — costs, exposure and enforcement store finance + court references only (ADR-063).
- **No AI** — matter-type/risk/priority classification, positions and opinions are human- or rule-driven (m07),
  never AI legal research, drafting, summarization, or decisioning.
- **No production court-filing / court-scraping / calendar / telephony / SMS / email adapters** — deterministic
  ports/references only; notifications + escalation delegate to m08.
- **No external-counsel portal, no customer portal, no vendor-management platform, no full regulatory-reporting
  engine.**
- **The M13 case conversion is a governed inbound boundary** — m14 consumes `case.converted_to_matter` and owns no
  case table; m13 owns no legal-matter table.

None weakens any architecture, RLS, authorization, audit, maker-checker, immutability, SLA/deadline/limitation,
privacy, or test guarantee.

## 17. Verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** The M14 enterprise legal-matter module is implemented on `main`
(`41e7bf4`), byte-identical to the reviewed PR #24 head, with all certification gates executed and green locally and
both authoritative PG16 CI lanes green. Certification is recorded on branch `cert/stage-4-1-m14-legal-matters`; the
certification PR is pending and **not merged**. No later module (M16/M17/M18/finance) was touched.
