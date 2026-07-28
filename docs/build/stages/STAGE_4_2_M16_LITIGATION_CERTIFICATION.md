# Stage 4.2 — M16 Enterprise Litigation Management — Post-Merge Certification

**Date:** 2026-07-28
**Module:** `m16-litigation` (enterprise litigation & adjudicative proceedings: configurable versioned proceeding
types + SLA policies, the M14 matter referral, proceedings, parties, claims, filings, service of process,
appearances/diary, hearing records, witnesses, experts, exhibits, hearing bundles, orders, compliance obligations,
rulings/judgments, appeals, litigation deadlines + limitation, cost references, closure, reopening, relationships,
analytics).
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch
`cert/stage-4-2-m16-litigation-management`; certification PR pending, not merged).

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#26** |
| Reviewed implementation head | `3b629fd77dfd1d44082e3682230c6a29f2830435` |
| Implementation merge SHA (squash) | `de3bc46bd556b1179933488c2511d1f67845281e` |
| Certified baseline SHA (main tested) | `de3bc46bd556b1179933488c2511d1f67845281e` |
| Current `origin/main` | `de3bc46bd556b1179933488c2511d1f67845281e` (= the merge commit) |
| Certification branch | `cert/stage-4-2-m16-litigation-management` (cut from merged main) |
| Parent baseline (pre-merge main) | `b6660a037a6e25717e0b7a48e6d9baf9bde3d9e0` (certified Stage 4.1, cert PR #25) |
| PR #26 | `state: closed`, `merged: true`, `merged_at: 2026-07-28T09:53:03Z`, base `main` |

**Tree-equivalence:** PR #26 was **squash-merged** (`de3bc46` has a single parent `b6660a0`), so the reviewed head
is not a literal ancestor — ancestry is not required. `git diff 3b629fd de3bc46` is **empty**: the merged tree is
**byte-identical** to the reviewed head across the entire repository. `origin/main` is exactly the merge commit.

## 2. Scope certified (merge diff `b6660a0..de3bc46`)

52 files, +11507/−47. ADR-065…068; the m16 architecture/readiness/plan/completion docs + this certification report;
`packages/m16-litigation` (domain, ports, hash, errors, proceeding-number, migrations, repository, three services,
emitter, permissions/audit codes, tests, README, package/tsconfig); `packages/contracts/src/litigation-events.ts` +
the `DomainEvent` union (12→**13** families) + the contracts smoke; litigation permissions (56, registered **and
seeded**); litigation audit codes (58); event-registry `litigation.lifecycle` (promoted to an implemented group
owned by m16); naming-map GAP-2 filled; m16 migrations; `/api/v1/litigation` API (5 files under
`apps/api/src/litigation`) + `AppModule` wiring + `apps/api` package/tsconfig; m16 tests; build wiring (root
`tsconfig`, `package-lock`); manifest Stage 4.2 block + the **truthful `certification_4_1` finalization** (m14 cert
PR #25 → certified); the family-count bump in `m02-identity` smoke.

**Exclusions (verified absent):** no M17 internals (recovery/enforcement allocation, debtor ledger, payment plans,
attachment/auction/garnishee, collections accounting); no M18 internals (precedent repository, knowledge graph, AI
research/summarization/drafting); no finance / general-ledger / accounts-payable / journal-posting / payment /
reconciliation implementation; no production e-filing / court-scraping / calendar / telephony / SMS / email adapter;
no external-counsel / customer / witness portal; no vendor-management platform; no full regulatory-reporting engine;
no later modules (`git diff --name-only b6660a0..de3bc46 | grep -iE 'm17|m18|m15|m19|finance|recon|ledger|journal|
payment|collections'` returns nothing). **No second outbox; no duplicate audit table; no second RBAC/workflow/
escalation engine; m16 owns no matter table; m14 owns no proceeding table. Historical (m01–m14) migrations were
NOT edited — the merge only added `packages/m16-litigation/migrations/*`.**

## 3. Local gate results (baseline `de3bc46`)

Environment: PostgreSQL **15.2** throwaway (`finapp_cert16`, port 5437 — CI PostgreSQL 16 is authoritative, see
§20); connected via `DATABASE_APP_ROLE=finapp_app` + `DATABASE_OWNER_ROLE=finapp_owner` (non-superuser, RLS
enforced). Lint ran on a **wiped `dist`** (CI lint-before-build order). The throwaway database was recreated from
empty and removed after verification.

| Gate | Result |
| --- | --- |
| Format check | ✅ PASS |
| Lint (wiped dist) | ✅ **0 errors** (46 style warnings, matching the certified baseline pattern) |
| Build / typecheck | ✅ 0 type errors |
| PURE smoke | ✅ **19 suites, 3401 assertions, 0 failures** (m16-litigation 71) |
| Conformance | ✅ **1680 assertions** (endpoint perms/audit + RLS convention + `registered_code_count`=len + event-family registration) |
| Migration dry-run | ✅ lists all 26 migrations incl. the two m16 files, dependency order |
| Migration replay (fresh) | ✅ **26 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **34 specs, 978 assertions, 0 failures** (m16-litigation 41, m16-services 40, **api-litigation 21**) |

## 4. Database governance (live checks on `finapp_cert16`)

Table inventory derived from the migrated schema (not the report): **25** m16 tables — `litigation_proceeding_type`,
`litigation_sla_policy`, `litigation_proceeding`, `litigation_referral`, `litigation_status_history`,
`litigation_assignment_history`, `litigation_party`, `litigation_claim`, `litigation_filing`, `litigation_service`,
`litigation_appearance`, `litigation_proceeding_record`, `litigation_witness`, `litigation_expert`,
`litigation_exhibit`, `litigation_bundle`, `litigation_bundle_item`, `litigation_order`,
`litigation_compliance_obligation`, `litigation_outcome`, `litigation_appeal`, `litigation_deadline`,
`litigation_cost_reference`, `litigation_note`, `litigation_relationship`.

- **RLS:** all **25/25** report `relrowsecurity=t` AND `relforcerowsecurity=t`; each has a `tenant_isolation`
  policy (25/25). Composite `(tenant_id,id)` PRIMARY KEYs on all 25; **24** composite tenant-safe FKs.
- **Grants:** **0 DELETE** grants to `finapp_app` on any m16 table; the seven append-only ledgers
  (`litigation_referral`, `litigation_status_history`, `litigation_assignment_history`,
  `litigation_proceeding_record`, `litigation_order`, `litigation_outcome`, `litigation_note`) grant exactly
  `INSERT, SELECT` (**0 UPDATE**). The DB lane runs entirely as the non-owner `finapp_app`.
- **Constraints/indexes:** one-active (`litigation_proceeding_type_one_active`, `litigation_sla_policy_one_active`,
  `litigation_appeal_one_active`); idempotency (`litigation_proceeding_idem_key`, `litigation_referral_key_key` =
  one proceeding per referral key); proceeding-number uniqueness (`litigation_proceeding_number_key`); the **filing
  + bundle maker-checker SoD CHECKs** (`litigation_filing_sod_ck`, `litigation_bundle_sod_ck` — `approved_by <>
  prepared_by`); the relationship **self-edge CHECK** (`litigation_relationship_noself_ck`) + active-uniqueness; the
  30-state `litigation_proceeding_status_ck` lifecycle CHECK.
- **Optimistic concurrency:** **17** tables carry a `version` column; the append-only ledgers and single-winner
  tables correctly do not.

## 5. M14 → M16 referral (§10)

Proven end-to-end over HTTP (`api-litigation`) AND at the service layer (`m16-services`): a caller refers an M14
matter to litigation (`POST /litigation/from-matter` carrying only safe reference fields), and m16 accepts it →
**exactly one proceeding per referral key** (a repeat with the same `referral_key` returns the same proceeding,
`created=false`; idempotent via the `litigation_referral` unique ledger). A **fresh** referral key from the **same**
matter yields a **new** proceeding — a matter may have several proceedings, so uniqueness is on the referral key,
not the matter id. The source matter id is preserved (`source_matter_id`), `source='matter_referral'`, and
correlation/causation flow through. The referral is a **governed inbound contract** (the `MatterReferral` port); m16
issues no query against an m14-owned table, m14 owns no proceeding table, and referral evidence commits in the same
transaction as the proceeding + its `ProceedingReferredFromMatter` outbox event. (A real bug surfaced during
implementation — `acceptReferral` used the text referral key as a `uuid` causation-id fallback — was fixed to
`null` and re-verified; no residual defect.)

## 6. Proceeding types, lifecycle, numbers, assignment (§11-14)

- **Proceeding types + SLA policies:** versioned, immutable-after-publish specs (one ACTIVE per code+scope,
  content-hash frozen at publish); `spec.code` must equal the code; invalid specs (bad code, invalid default risk,
  non-string forum/stage lists, negative minutes, warn % > 100) are rejected by the validators. Configurable —
  nothing Kenya-specific hardcoded (ADR-065). Proven in `m16-services` (create→validate→publish→activate).
- **Lifecycle:** **30** states (`litigation_proceeding_status_ck`), transitions through the PURE
  `checkProceedingTransition` choke point; invalid transitions rejected; `litigation_status_history` is
  **append-only**; stale versions rejected (optimistic lock); `archived` is the sole terminal; reopened proceedings
  preserve prior closure history. Proven advance→settled→rule-gated close→reopen over HTTP + at the service layer.
- **Proceeding numbers:** `PROC-<12 hex>` — deterministic, tenant-scoped, unique (`litigation_proceeding_number_key`),
  stable after creation; a duplicate number is rejected (proven in `m16-litigation`).
- **Assignment/reassignment:** append-only `litigation_assignment_history`; assignment advances a draft proceeding
  to `under_review`; a stale version is rejected; reassignment requires `litigation.proceeding.reassign`.

## 7. Parties, claims, filings, service, appearances, records (§15-20)

Proven in `m16-services` + `api-litigation`: parties (references to master data; contact redacted behind
`litigation.party_contact.read`, ADR-068; role vocabulary validated); claims (structured type/statement/amount;
full argument never in events/audit); **filings** (metadata + m09 references; **maker-checker** — the preparer
cannot approve their own filing (409 in `m16-services` AND over HTTP; an independent approver succeeds), enforced in
the service AND the `litigation_filing_sod_ck` DB CHECK); **service** (single-winner verification —
`verification_status='unverified'` CAS, a second verify/reject loses); appearances (schedule/update/complete/adjourn,
optimistic locking, no production calendar — virtual link is a redactable reference); proceeding records
(append-only; full transcripts stay in m09).

## 8. Witnesses, experts, exhibits, bundles (§21-24)

Proven in `m16-services`: witnesses (references + litigation status; contacts redacted behind
`litigation.witness_contact.read`; full statements stay in m09); experts (metadata + m09 report references; no
vendor management / payment); **exhibits** (single-winner admission — `admitted_status` CAS, a second decision
loses; no binary storage, no forensic claim); **bundles** (**maker-checker** — the preparer cannot approve their own
bundle (409 in `m16-services` AND over HTTP; an independent approver succeeds), enforced in the service AND the
`litigation_bundle_sod_ck` DB CHECK; contents remain in m09; `litigation_bundle_item` composite FK to the bundle).

## 9. Orders, compliance, outcomes, appeals, deadlines, SLA (§25-30)

- **Orders:** append-only `litigation_order` (typed vocabulary; operative-terms metadata; full order in m09).
- **Compliance obligations:** one or more per order; deterministic deadlines; completion is a single CAS
  transition; M08 escalation reuse; no payment execution.
- **Outcomes/rulings/judgments:** append-only `litigation_outcome` (typed vocabulary; safe summary + awarded/costs
  amounts as references; full decision in m09); M16 signals M14 through a safe event, never mutating m14.
- **Appeals:** controlled creation; **duplicate active appeal rejected** (`litigation_appeal_one_active` partial
  unique index → 409); appeal deadline cannot be suppressed; no M17 enforcement.
- **Litigation deadlines:** deterministic due-date computation (offset-days / explicit) against an injected `Clock`;
  breach single-winner once the clock passes due (proven with a `FixedClock` — a fresh deadline is not breached, a
  clock advance breaches); `limitation` is a distinct high-risk deadline type. **SLA:** versioned policy; `startSla`
  materializes stage deadlines; deterministic (no ambient `Date.now`); timer dispatch delegated to m06/m08.

## 10. Workflow, rules, notifications, documents, external counsel (§31-35)

m06 references (`workflow_instance_ref`) link proceeding + workflow state without conflating them; m07 is consumed
via a recorded evaluation id, typed facts only, never mutating; escalation reuses m08 by **publishing an event** +
recording an escalation reference — no second escalation engine (proven in `m16-services`). m09 holds all documents/
bundles (m16 stores references only, no bytes; storage references redacted). External-counsel references are reused
from m14; no duplicate law-firm master, no vendor-management platform, no bank/payment data.

## 11. Costs, M17 & M18 boundaries (§36-38)

- **Costs:** `litigation_cost_reference` stores **court + finance references only** (integer minor units as
  reference data) — no accounts payable, general ledger, journal posting, payment execution, tax engine, or
  reconciliation (ADR-067).
- **M17 enforcement boundary:** m16 records only decree/order references, judgment amounts, compliance/appeal/stay
  state, and emits a safe `EnforcementReferralReady` event — no debtor ledger, payment allocation, payment plans,
  attachment/auction/garnishee/collections workflow, or enforcement accounting.
- **M18 knowledge boundary:** m16 emits only a safe `KnowledgeCandidateCreated` event — no precedent repository,
  knowledge graph, AI research/summarization/drafting, or legal intelligence.

## 12. Closure, reopening, archival, relationships (§39-41)

- **Closure** is **rule-gated** (`evaluateClosure` returns machine-readable reason codes): an un-worked proceeding
  is refused (missing outcome, open deadline, open compliance obligation, active stay, imminent limitation, open
  critical escalation), a fully-worked proceeding closes (proven in `m16-services` + HTTP). A legal hold blocks
  archival (`archive` refuses on `legal_hold`).
- **Reopening** requires a reason; prior closure history is preserved (append-only status history).
- **Relationships:** typed (11 kinds incl. `referred_from_matter`), tenant-scoped; **self-edge rejected** (CHECK);
  active-unique.

## 13. Authoritative CI (PostgreSQL 16)

Implementation PR **#26**, head `3b629fd` — **Smoke lane + DB lane both `success`** on `postgres:16`. Post-merge
push to main `de3bc46` — **Smoke lane + DB lane both `success`**. The merged tree is byte-identical to the reviewed
head, so the PG16 evidence transfers to the certified baseline. The local PG15.2 run independently re-confirms every
gate.

## 14. Authorization, audit, events & outbox (§44-47)

- **Authorization:** **56** `litigation.*` permissions, **seeded** (**20** privileged incl.
  `litigation.confidential.read`, `litigation.privileged.read/create`, `litigation.party_contact.read`,
  `litigation.witness_contact.read`, `litigation.filing.approve`, `litigation.service.verify`,
  `litigation.bundle.approve`, `litigation.order.manage`, `litigation.compliance.manage`,
  `litigation.outcome.manage`, `litigation.appeal.manage`, `litigation.proceeding.reopen/archive`,
  `litigation.analytics.export`, `litigation.platform.administer`); every mutating route declares its 3-segment
  permission (`@Endpoint`), enforced server-side (default deny). Proven over HTTP: 401 anon; an `x-permissions`
  header cannot self-grant (403).
- **Audit:** **58** `LITIGATION_` codes via the m03 `AUDIT` port (no duplicate audit table); `registered_code_count`
  318→**376** = len(codes) (conformance-enforced); all codes are ≥3-segment `LITIGATION_<ENTITY>_<ACTION>`; payloads
  carry ids/states/reason codes only — no legal strategy, full pleadings, witness statements, full submissions,
  private witness/party contacts, document contents, confidential order/outcome terms, secrets, or notification
  destinations.
- **Events / contracts:** `litigation.lifecycle` (**36** types), version 1, owned by m16, registered in
  event-registry and in the contracts `DomainEvent` union (12→**13** families); classified `confidential`; payloads
  carry ids/states/dates/reason codes and bounded safe amounts only.
- **Outbox:** m16 owns **no** outbox — the only `%outbox%` table is m06's `workflow_event_outbox`. m16 publishes
  through it in the caller's transaction (atomic, no dual-write, no second delivery path); the M14 referral is
  idempotent so duplicate delivery is safe.

## 15. API security, privacy & analytics (§48-49)

Proven over HTTP + at the service layer: cross-tenant reads return nothing (RLS); a confidential/privileged
proceeding's `summary` is `[redacted]` for a caller without `litigation.confidential.read` (a privileged caller
reads it); party + witness contacts, privileged notes and confidential order/outcome terms are redacted; storage
references are never exposed; maker-checker cannot be bypassed; a header cannot self-grant. Analytics are **bounded
aggregate counts over safe dimensions** inside tenant context — no privileged/contact/outcome leakage, no raw SQL
input, no cross-tenant inference.

## 16. Idempotency & concurrency (§42-43)

DB-enforced idempotency on the M14 referral (`litigation_referral` unique on `referral_key`) and proceeding
creation (partial unique idempotency key); a repeat returns the stored row. Concurrency safety via optimistic locks
(17 `version` columns), single-winner CAS (service verification, exhibit admission, deadline breach, filing/bundle
approval, appeal one-active), unique constraints and transition guards — a duplicate referral creates no second
proceeding, a stale version loses, a self-approval is refused. Proven in `m16-services` + `api-litigation`.

## 17. Repository-derived counts (§50)

| Item | Count |
| --- | --- |
| Files changed vs Stage 4.1 baseline (excl. build output) | **52** (+11507 / −47) |
| Migrations (m16) | **2** (26 total in the repo) |
| Tables | **25** (25 RLS FORCE, 7 append-only) |
| Permissions (`litigation.*`) | **56** (20 privileged) |
| Audit codes (`LITIGATION_*`) | **58** (`registered_code_count` → 376) |
| Event types | **36** `litigation.lifecycle` (13 families total) |
| API endpoints | **60** mutating (all audited `@Endpoint`) + **23** reads |
| Proceeding lifecycle states | **30** (terminal: `archived`) |
| Smoke suites / assertions | **19** / **3401** (m16 71, conformance 1680) |
| DB specs / assertions | **34** / **978** (m16-litigation 41, m16-services 40, api-litigation 21) |
| ADRs | **4** (ADR-065…068) |

## 18. Documented limitations (deferred, not defects — each verified)

- **No M17 internals** — recovery/enforcement (allocation, debtor ledger, payment plans, attachment/auction/
  garnishee, collections accounting) remain a later module; M16 records references + emits a safe
  `EnforcementReferralReady` boundary event only.
- **No M18 internals** — precedent repository, knowledge graph, AI research/summarization/drafting remain a later
  module; M16 emits a safe `KnowledgeCandidateCreated` boundary event only.
- **No finance / general ledger / accounts payable / journal posting / payment execution / reconciliation** —
  costs store references only (ADR-067).
- **No AI** — proceeding-type/risk classification and outcomes are human- or rule-driven (m07), never AI.
- **No production e-filing / court-scraping / calendar / telephony / SMS / email adapters** — deterministic
  ports/references only; notifications + escalation delegate to m08.
- **No external-counsel / customer / witness portal, no vendor-management platform, no full regulatory-reporting
  engine.**

None weakens any architecture, RLS, authorization, audit, maker-checker, single-winner, immutability, SLA/deadline/
limitation, privacy, or test guarantee.

## 19. Verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** The M16 enterprise litigation module is implemented on `main`
(`de3bc46`), byte-identical to the reviewed PR #26 head, with all certification gates executed and green locally and
both authoritative PG16 CI lanes green. Certification is recorded on branch
`cert/stage-4-2-m16-litigation-management`; the certification PR is pending and **not merged**. No later module
(M17/M18/finance) was touched.
