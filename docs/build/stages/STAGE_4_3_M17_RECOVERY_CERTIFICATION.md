# Stage 4.3 — M17 Enterprise Recovery & Enforcement — Post-Merge Certification

**Date:** 2026-07-28
**Module:** `m17-recovery` (enterprise recovery & enforcement: configurable versioned recovery types + SLA policies,
the M16 enforcement referral, recovery cases, debtors/liable parties, enforceable instruments, strategy, demands,
negotiations, operational repayment arrangements + installment schedules, enforcement actions, security/collateral
references, external recovery agents + reports, recovery receipt references, waivers, write-off recommendations,
outcomes, closure, reopening, relationships, analytics).
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch
`cert/stage-4-3-m17-recovery-enforcement`; certification PR pending, not merged).

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#29** |
| Reviewed implementation head | `311757c2824c1ff2eeac2128af5ec3ff365d953e` |
| Implementation merge SHA (squash) | `452376d1787b742aa6a1786934ed16ee3c954ea1` |
| Certified baseline SHA (main tested) | `452376d1787b742aa6a1786934ed16ee3c954ea1` |
| Current `origin/main` | `452376d1787b742aa6a1786934ed16ee3c954ea1` (= the merge commit) |
| Certification branch | `cert/stage-4-3-m17-recovery-enforcement` (cut from merged main) |
| Parent baseline (pre-merge main) | `fd594abcab8aec0a477840d44118fffcfcd66558` (governance PR #28 — see §2) |
| Governance approval | PR **#28** flipped `m17-recovery` `deferred` → `approved_for_build` → main `fd594ab`, rooted on certified Stage 4.2 main `b959298` (cert PR #27) |
| PR #29 | `state: closed`, `merged: true`, `merged_at: 2026-07-28T14:28:30Z`, base `main` |

**Tree-equivalence:** PR #29 was **squash-merged** (`452376d` has a single parent `fd594ab`), so the reviewed head
is not a literal ancestor — ancestry is not required. `git diff 311757c 452376d` is **empty**: the merged tree is
**byte-identical** to the reviewed head across the entire repository. `origin/main` is exactly the merge commit.

## 2. Approval provenance (M17 was deferred)

M17 was **next in `docs/07-engineering/BUILD_SEQUENCE.md`** (Stage 4: m14 → m16 → m17 → m18) but the manifest
carried `m17-recovery` `status: deferred` — the legend defines `deferred` as "Designed but intentionally later
(post-MVP / commercial / Phase 7)", i.e. NOT approved for build. Implementation was correctly refused until a
governance action (PR **#28**, a one-line manifest change `deferred` → `approved_for_build`, CI green) merged →
main `fd594ab`. The M17 implementation branch was then cut from that governance-approved baseline. M14 (legal) and
M16 (litigation) — M17's declared dependencies — are certified and merged on main.

## 3. Scope certified (merge diff `fd594ab..452376d`)

51 files, +11578/−48. ADR-069…072; the m17 architecture/readiness/plan/completion docs + this certification report;
`packages/m17-recovery` (domain, ports, hash, errors, recovery-number, migrations, repository, three services,
emitter, permissions/audit codes, tests, README, package/tsconfig); `packages/contracts/src/recovery-events.ts` +
the `DomainEvent` union (13→**14** families) + the contracts smoke; recovery permissions (58, registered **and
seeded**); recovery audit codes (55); event-registry `recovery.lifecycle` (promoted to an implemented group owned
by m17); m17 migrations; `/api/v1/recovery` API (5 files under `apps/api/src/recovery`) + `AppModule` wiring +
`apps/api` package/tsconfig; m17 tests; build wiring (root `tsconfig`, `package-lock`); manifest Stage 4.3 block +
the **truthful `certification_4_2` finalization** (m16 cert PR #27 → certified); the family-count bump in
`m02-identity` smoke.

**Exclusions (verified absent):** no M18 internals (precedent repository, knowledge graph, AI); no finance /
general-ledger / accounts-receivable / cash-application / payment / reconciliation / accounting-write-off
implementation; no production e-auction / court integration / telephony / SMS / email adapter; no external portal;
no vendor-management platform; no later modules (`git diff --name-only fd594ab..452376d | grep -iE 'm18|m19|finance|
ledger|receivable|reconcil|payment|glrecon|journal'` returns nothing). **No second outbox; no duplicate audit
table; no second RBAC/workflow/escalation engine; m17 owns no matter/proceeding table; m14/m16 own no recovery
table. Historical (m01–m16) migrations were NOT edited — the merge only added `packages/m17-recovery/migrations/*`.**

## 4. Local gate results (baseline `452376d`)

Environment: PostgreSQL **15.2** throwaway (`finapp_cert17`, port 5439 — CI PostgreSQL 16 is authoritative, see
§14); connected via `DATABASE_APP_ROLE=finapp_app` + `DATABASE_OWNER_ROLE=finapp_owner` (non-superuser, RLS
enforced). Lint ran on a **wiped `dist`** (CI lint-before-build order). The throwaway database was recreated from
empty and removed after verification.

| Gate | Result |
| --- | --- |
| Format check | ✅ PASS |
| Lint (wiped dist) | ✅ **0 errors** (60 style warnings, matching the certified baseline pattern) |
| Build / typecheck | ✅ 0 type errors |
| PURE smoke | ✅ **20 suites, 3709 assertions, 0 failures** (m17-recovery 72) |
| Conformance | ✅ **1910 assertions** (endpoint perms/audit + RLS convention + `registered_code_count`=len + event-family registration) |
| Migration dry-run | ✅ lists all 28 migrations incl. the two m17 files, dependency order |
| Migration replay (fresh) | ✅ **28 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **37 specs, 1075 assertions, 0 failures** (m17-recovery 41, m17-services 34, **api-recovery 22**) |

## 5. Database governance (live checks on `finapp_cert17`)

Table inventory derived from the migrated schema (not the report): **25** m17 tables — `recovery_type`,
`recovery_sla_policy`, `recovery_case`, `recovery_referral`, `recovery_status_history`,
`recovery_assignment_history`, `recovery_party`, `recovery_instrument`, `recovery_strategy`, `recovery_demand`,
`recovery_negotiation`, `recovery_arrangement`, `recovery_installment`, `recovery_enforcement_action`,
`recovery_security`, `recovery_agent`, `recovery_agent_report`, `recovery_receipt`, `recovery_waiver`,
`recovery_writeoff_recommendation`, `recovery_outcome`, `recovery_deadline`, `recovery_cost_reference`,
`recovery_note`, `recovery_relationship`.

- **RLS:** all **25/25** report `relrowsecurity=t` AND `relforcerowsecurity=t`; each has a `tenant_isolation`
  policy (25/25). Composite `(tenant_id,id)` PRIMARY KEYs on all 25; **24** composite tenant-safe FKs.
- **Grants:** **0 DELETE** grants to `finapp_app` on any m17 table; the nine append-only ledgers
  (`recovery_referral`, `recovery_status_history`, `recovery_assignment_history`, `recovery_strategy`,
  `recovery_agent_report`, `recovery_receipt`, `recovery_waiver`, `recovery_outcome`, `recovery_note`) grant
  exactly `INSERT, SELECT` (**0 UPDATE**). The DB lane runs entirely as the non-owner `finapp_app`.
- **Constraints/indexes:** one-active (`recovery_type_one_active`, `recovery_sla_policy_one_active`); idempotency
  (`recovery_case_idem_key`, `recovery_referral_key_key` = one recovery per referral key); recovery-number
  uniqueness (`recovery_case_number_key`); the **arrangement + write-off maker-checker SoD CHECKs**
  (`recovery_arrangement_sod_ck` — `approved_by <> proposed_by`; `recovery_writeoff_recommendation_sod_ck` —
  `approved_by <> recommended_by`); the relationship **self-edge CHECK** (`recovery_relationship_noself_ck`) +
  active-uniqueness; the 29-state `recovery_case_status_ck` lifecycle CHECK.
- **Optimistic concurrency:** **16** tables carry a `version` column; the append-only ledgers correctly do not.
  No orphan records — every sub-entity has a composite FK to its parent recovery (or arrangement).

## 6. M16 → M17 enforcement referral (§C-proceeding referrals)

Proven end-to-end over HTTP (`api-recovery`) AND at the service layer (`m17-services`): a caller refers an M16
proceeding's enforceable outcome to recovery (`POST /recovery/from-proceeding` carrying only safe reference
fields), and m17 accepts it → **exactly one recovery per referral key** (a repeat with the same `referral_key`
returns the same recovery, `created=false`; idempotent via the `recovery_referral` unique ledger). A **fresh**
referral key from the **same** proceeding yields a **new** recovery — a proceeding may produce several enforcement
referrals, so uniqueness is on the referral key, not the proceeding id. The source proceeding id is preserved
(`source_proceeding_id`), `source='enforcement_referral'`, and correlation/causation flow through (the causation is
`input.causationId ?? null` — never the text referral key). The referral is a **governed inbound contract** (the
`EnforcementReferral` port); m17 issues no query against an m16- or m14-owned table, m14/m16 own no recovery table,
and referral evidence commits in the same transaction as the recovery + its `RecoveryReferredFromProceeding` outbox
event.

## 7. Recovery types, lifecycle, numbers, assignment, strategy (§lifecycle)

- **Recovery types + SLA policies:** versioned, immutable-after-publish specs (one ACTIVE per code+scope,
  content-hash frozen at publish); `spec.code` must equal the code; invalid specs (bad code, invalid default risk,
  non-string instrument/strategy lists, negative minutes, warn % > 100) are rejected by the validators.
  Configurable — nothing Kenya-specific hardcoded (ADR-069). Proven in `m17-services`.
- **Lifecycle:** **29** states (`recovery_case_status_ck`), transitions through the PURE `checkRecoveryTransition`
  choke point; invalid transitions rejected; `recovery_status_history` is **append-only**; stale versions rejected
  (optimistic lock); `archived` is the sole terminal; reopened recoveries preserve prior history. Proven
  advance→settled→rule-gated close→reopen over HTTP + at the service layer.
- **Recovery numbers:** `REC-<12 hex>` — deterministic, tenant-scoped, unique (`recovery_case_number_key`), stable
  after creation; a duplicate number is rejected (proven in `m17-recovery`).
- **Assignment/reassignment:** append-only `recovery_assignment_history`; assignment advances a draft recovery to
  `under_review`; a stale version is rejected; reassignment requires `recovery.case.reassign`.
- **Strategy:** append-only `recovery_strategy` selection history + a strategy field on the recovery; rationale is
  privileged.

## 8. Instruments, demands, negotiations, arrangements, installments (§instruments…installment metadata)

Proven in `m17-services` + `api-recovery`: enforceable **instruments** (typed vocabulary; reference metadata; full
document in m09); **demands** (typed vocabulary; issue → respond); **negotiations** (open → close; positions are
sensitive, never in events/audit); **arrangements** (**maker-checker** — the proposer cannot approve their own
arrangement (409 in `m17-services` AND over HTTP; an independent approver activates it), enforced in the service
AND the `recovery_arrangement_sod_ck` DB CHECK); **installments** — operational **schedule metadata only** (a
`sequenceNumber` + `met`/`missed` marker linking an optional receipt reference; **no cash application**).

## 9. Enforcement actions, security/collateral, external agents (§recovery actions…external agents)

- **Enforcement actions:** typed vocabulary (attachment, garnishee, execution, warrant, proclamation, auction,
  repossession, eviction, receivership, charging order, stop order, committal, statutory demand, winding-up,
  bankruptcy petition) as **references** — no production enforcement execution; initiate → update → complete.
- **Security/collateral:** typed references (real property, motor vehicle, chattel, shares, deposit, guarantee,
  debenture, lien, cash cover, insurance) with valuation + realized-amount **references** (no valuation engine, no
  cash application); register → realize.
- **External recovery agents:** engagement references + agent reports (append-only) — no vendor-management
  platform, no payment processing, no bank details.

## 10. Receipts, waivers, write-off recommendations, costs — THE FINANCE BOUNDARY (§E, ADR-071)

- **Receipts:** append-only recovery receipt **REFERENCES** (`receipt_type` + `external_reference` +
  `finance_reference`). m17 performs **NO cash application** — the authoritative money movement lives in
  finance/AR; recovered/outstanding tallies on the recovery are **reference figures** only.
- **Waivers:** append-only; a human authority grants; **no accounting posting**.
- **Write-off:** a **RECOMMENDATION** with **maker-checker** approval — the recommender cannot approve their own
  write-off (409 in `m17-services` AND over HTTP; an independent approver approves), enforced in the service AND the
  `recovery_writeoff_recommendation_sod_ck` DB CHECK. m17 records the recommendation only; **the accounting
  write-off is executed by finance/AR elsewhere**.
- **Costs:** enforcement/recovery cost **references** only.
- **Verified absent:** no general ledger, accounts receivable, cash allocation, payment execution, tax engine, or
  reconciliation anywhere in m17.

## 11. Outcomes, deadlines, SLA, closure, reopening, archival (§outcomes…closure)

- **Outcomes:** append-only typed outcomes (fully/partially recovered, settled, written off, uncollectible,
  withdrawn, referred out) with recovered/waived/written-off/outstanding **reference** amounts.
- **Deadlines & limitation:** deterministic due-date computation (offset-days / explicit) against an injected
  `Clock`; breach single-winner once the clock passes due (proven with a `FixedClock`); `limitation` is a distinct
  high-risk type. **SLA:** versioned policy; `startSla` materializes stage deadlines; deterministic (ADR-070).
- **Closure** is **rule-gated** (`evaluateClosure` returns machine-readable reason codes): an un-worked recovery is
  refused (missing outcome, open deadline, open enforcement action, active arrangement, undispositioned write-off,
  imminent limitation, open critical escalation), a fully-worked recovery closes (proven in `m17-services` + HTTP).
  A legal hold blocks archival.
- **Reopening** requires a reason; prior closure history is preserved (append-only status history). **Archival**
  only after eligible closure; no deletion (soft-delete-by-status; no DELETE grant anywhere).

## 12. Workflow, rules, notifications, documents, escalation (§integrations)

m06 references (`workflow_instance_ref`) link recovery + workflow state without conflating them; m07 is consumed via
a recorded evaluation id, typed facts only, never mutating; escalation reuses m08 by **publishing an event** +
recording an escalation reference — no second escalation engine (proven in `m17-services`). m09 holds all documents
(m17 stores references only, no bytes; storage references redacted). External-counsel/agent data is reference-only.

## 13. Authorization, audit, events & outbox (§permissions…outbox)

- **Authorization:** **58** `recovery.*` permissions, **seeded** (**20** privileged incl.
  `recovery.confidential.read`, `recovery.privileged.read/create`, `recovery.party_contact.read`,
  `recovery.instrument.manage`, `recovery.arrangement.approve`, `recovery.enforcement.manage`,
  `recovery.security.realize`, `recovery.agent.manage`, `recovery.waiver.grant`, `recovery.writeoff.recommend`,
  `recovery.writeoff.approve`, `recovery.cost.manage`, `recovery.outcome.manage`, `recovery.case.reopen/archive`,
  `recovery.recovery_type.manage`, `recovery.sla_policy.manage`, `recovery.analytics.export`,
  `recovery.platform.administer`); every mutating route declares its 3-segment permission (`@Endpoint`), enforced
  server-side (default deny). Proven over HTTP: 401 anon; an `x-permissions` header cannot self-grant (403).
- **Audit:** **55** `RECOVERY_` codes via the m03 `AUDIT` port (no duplicate audit table); `registered_code_count`
  376→**431** = len(codes) (conformance-enforced); all codes are ≥3-segment `RECOVERY_<ENTITY>_<ACTION>`; payloads
  carry ids/states/reason codes only — no debtor contacts, negotiation strategy, settlement terms, bank/payment
  details, security valuations, document contents, secrets, or notification destinations.
- **Events / contracts:** `recovery.lifecycle` (**36** types), version 1, owned by m17, registered in
  event-registry and in the contracts `DomainEvent` union (13→**14** families); classified `confidential`; payloads
  carry ids/states/dates/reason codes and bounded safe amounts only.
- **Outbox:** m17 owns **no** outbox — the only `%outbox%` table is m06's `workflow_event_outbox`. m17 publishes
  through it in the caller's transaction (atomic, no dual-write, no second delivery path); the M16 referral is
  idempotent so duplicate delivery is safe.

## 14. Authoritative CI (PostgreSQL 16)

Implementation PR **#29**, head `311757c` — **Smoke lane + DB lane both `success`** on `postgres:16`. Post-merge
push to main `452376d` — **Smoke lane + DB lane both `success`**. The merged tree is byte-identical to the reviewed
head, so the PG16 evidence transfers to the certified baseline. The local PG15.2 run independently re-confirms every
gate.

## 15. API security, privacy & analytics (§security…analytics)

Proven over HTTP + at the service layer: cross-tenant reads return nothing (RLS); a confidential/privileged
recovery's `summary` and amount references are `[redacted]`/null for a caller without `recovery.confidential.read`
(a privileged caller reads them); debtor/party contacts, note content, negotiation strategy and security valuations
are redacted; maker-checker cannot be bypassed; a header cannot self-grant. Analytics are **bounded aggregate counts
over safe dimensions** inside tenant context — no privileged/contact/valuation leakage, no raw SQL input, no
cross-tenant inference.

## 16. Idempotency & concurrency

DB-enforced idempotency on the M16 referral (`recovery_referral` unique on `referral_key`) and recovery creation
(partial unique idempotency key); a repeat returns the stored row. Concurrency safety via optimistic locks (16
`version` columns), single-winner CAS (arrangement approval, write-off approval, deadline breach), unique
constraints and transition guards — a duplicate referral creates no second recovery, a stale version loses, a
self-approval is refused. Proven in `m17-services` + `api-recovery`.

## 17. Repository-derived counts

| Item | Count |
| --- | --- |
| Files changed vs approved (Stage 4.2 + governance) baseline (excl. build output) | **51** (+11578 / −48) |
| Migrations (m17) | **2** (28 total in the repo) |
| Tables | **25** (25 RLS FORCE, 9 append-only) |
| Composite tenant FKs | **24** |
| Permissions (`recovery.*`) | **58** (20 privileged) |
| Audit codes (`RECOVERY_*`) | **55** (`registered_code_count` → 431) |
| Event types | **36** `recovery.lifecycle` (14 families total) |
| API endpoints | **56** mutating (all audited `@Endpoint`) + **23** reads |
| Recovery lifecycle states | **29** (terminal: `archived`) |
| Smoke suites / assertions | **20** / **3709** (m17 72, conformance 1910) |
| DB specs / assertions | **37** / **1075** (m17-recovery 41, m17-services 34, api-recovery 22) |
| ADRs | **4** (ADR-069…072) |

## 18. Documented limitations (deferred, not defects — each verified)

- **No finance / general ledger / accounts receivable / cash application / payment execution / reconciliation /
  accounting write-off** — ALL amounts are references only; write-off is a recommendation with maker-checker
  approval (ADR-071).
- **No M18 internals** — precedent repository, knowledge graph, AI research/summarization/drafting remain a later
  module; M17 emits safe boundary signals only.
- **No AI** — strategy/risk classification and outcomes are human- or rule-driven (m07), never AI.
- **No production e-auction / court integration / telephony / SMS / email adapters** — deterministic ports/
  references only; notifications + escalation delegate to m08.
- **No external portal, no vendor-management platform.**

None weakens any architecture, RLS, authorization, audit, maker-checker, immutability, SLA/deadline/limitation,
privacy, finance-boundary, or test guarantee.

## 19. Verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** The M17 enterprise recovery & enforcement module is implemented on
`main` (`452376d`), byte-identical to the reviewed PR #29 head, with all certification gates executed and green
locally and both authoritative PG16 CI lanes green. Certification is recorded on branch
`cert/stage-4-3-m17-recovery-enforcement`; the certification PR is pending and **not merged**. No later module
(M18/finance) was touched.
