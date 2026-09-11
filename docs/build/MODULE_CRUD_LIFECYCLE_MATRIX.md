# Module CRUD / Lifecycle Matrix

> End-to-end functional matrix for every web-surfaced module. Built from: (a) a **clean local DB integration
> run** — 84 migrations applied, `db lane: 98 specs, 3043 assertions passed, 0 failed` — proving backend CRUD +
> RLS + least-privilege + maker-checker + audit; (b) the smoke lane (51 suites, 8080 assertions, 0 failed);
> (c) a full source trace of `apps/web/src/{app.tsx,api.ts}` against `apps/api/src/**/*.controller.ts`.
> Companion narrative: `MODULE_FUNCTIONAL_COMPLETION_AUDIT.md`. Verdicts here are **code + DB-proven**; live
> browser acceptance status is tracked separately (see the audit's "Environmental status").

> **⚑ Integrated Acceptance reconciliation (`a824879`, 2026-09-10).** The per-row `MISSING*`/`PARTIAL` markers in
> §B below predate Tier-1 + Tier-2 Waves 1–4 and are now **stale**. A full source-confirmed web-wiring trace of
> the merged tree shows every DAY-1 CRITICAL/SUPPORTING workflow is **UI-wired → api.ts → controller →
> permission-gated** (see `INTEGRATED_MODULE_ACCEPTANCE_REPORT.md`): m02 identity/role **edit** WIRED; m09 document
> **create** WIRED; m13 **triage** WIRED; m17 **create/advance/debtor/owner/deadline/exposure-edit** WIRED; m18
> **template/clause/taxonomy** + submit→approve→publish→withdraw WIRED; m19 **entity/fiscal-period** WIRED; m20
> **run/manual-match/reconciling-item/certify** WIRED; m21 **header-edit** WIRED; m22 **delegation** WIRED; m28
> **export** WIRED; m32 **dataset/metric/report authoring** WIRED; m08 **template lifecycle** WIRED. The
> evidence-based per-module statuses in `INTEGRATED_MODULE_ACCEPTANCE_REPORT.md` (all **BACKEND PROVEN — browser
> acceptance incomplete**, pending operator sign-off) **supersede** the stale cell markers here.
>
> **Correction (doc drift):** M18 templates/clauses have **no** `validate`/`activate`/`retire` verbs. The real
> lifecycle is **submit → approve → publish → withdraw (+ supersede)**; maker-checker = submit(maker) +
> approve(checker). Remaining genuine non-Day-1 gaps: m18 taxonomy-**edit** UI, m08 version-authoring UI, m20
> split-match, m32 dataset-edit/report-publish backend, various config/master-data edit surfaces — all **DEFERRED**
> (see `DAY1_LAUNCH_BLOCKER_REGISTER.md`).
>
> **⚑ Authenticated browser status (final campaign, `ff6f442`).** Executed live: **M02, M13, M17(maker)** = ACCEPTED
> (M13 with full decision maker-checker SoD); **M14, M16, M19** = PARTIALLY ACCEPTED (maker paths browser-proven);
> **M12, M18, M20, M21, M22** = BACKEND PROVEN — browser acceptance incomplete (personas + SoD-preserving gap roles
> provisioned; pending operator logins). See `FINAL_DAY1_BROWSER_ACCEPTANCE_REPORT.md`. 0 Day-1 code defects.

**Status legend:** WORKING (UI wired → mutation → DB, permission-gated) · PARTIAL (some lifecycle ops surfaced,
others not) · MISSING (backend exists, no UI) · MISSING* (backend **and** `api.ts` client exist, only `app.tsx`
wiring absent — smallest possible gap) · READ-ONLY (intentional by policy) · INFRA (intentionally unavailable
pending infra) · N/A.

**Platform invariant (verified):** there is **no `@Delete` route in any controller**. Teardown is modelled as
archive / close / withdraw / retire / revoke / destroy / tombstone. This satisfies the Phase-3 retention rules by
construction (no unrestricted hard delete anywhere; financial/legal records preserve history).

---

## A. Backend proof (DB integration lane, local PG16-equivalent PG15.2 throwaway)

| Proof | Result |
|---|---|
| Migrations applied | 84 / 84, 0 errors |
| DB integration specs | **98 specs, 3043 assertions, 0 failed** |
| Tenant isolation / RLS (every module) | PASS (cross-tenant read → 0 rows; cross-tenant id → 404) |
| Least-privilege grants | PASS (app role holds no DELETE; history tables no UPDATE/DELETE — negative assertions) |
| Maker-checker / SoD | PASS (approver ≠ requester enforced; DB CHECK) |
| Audit hash-chain | PASS (`gapfree=true`) |
| Smoke (pure) lane | 51 suites, 8080 assertions, 0 failed |

*Note on method:* the app must connect as a **non-superuser** role for RLS to apply; running with
`DATABASE_APP_ROLE=finapp_app` (so the app issues `SET LOCAL ROLE`) is required — a superuser connection bypasses
RLS. An initial local run without that env produced 15 false "cross-tenant" failures; with it, 0 failures. This is
an environment-config point, not a product defect (RLS policies are `FORCE` + correct predicate on every table).

---

## B. WEB-surfaced business modules — lifecycle matrix

Columns: Create · View · Edit · Delete/Archive/Close · Submit/Approve · Activity/Doc · then API / DB / RBAC / RLS /
Audit (all proven at backend per §A) · Browser proof · Status.

| Module → Entity | Create | View | Edit | Del/Arch/Close | Submit/Approve | Activity/Sub | API | DB | RBAC | RLS | Audit | Browser | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **m02-identity** Identity | WORKING | WORKING | **MISSING\*** (PATCH `updateIdentity` unwired) | deactivate/suspend/close WORKING (no hard-delete=policy) | N/A | accounts/memberships WORKING | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** (edit form) |
| **m02-rbac** Role | WORKING | WORKING | PARTIAL (perms WORKING; attr PATCH unwired) | suspend/retire WORKING (no delete=policy) | N/A | assignment grant/revoke WORKING | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** (attr edit) |
| **m08-notify** Inbox | N/A (system) | WORKING | N/A | READ-ONLY | mark-read WORKING | preferences WORKING | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| m08 Template/Escalation authoring | MISSING | WORKING (tmpl) | MISSING | MISSING | MISSING | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (admin) |
| **m09-docs** Document | **MISSING\*** (`createDocument` unwired) | WORKING | classification WORKING; metadata/withdraw MISSING | archive WORKING | — | version/hold/disposition WORKING (SoD) | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** (create) |
| m09 byte upload/download | INFRA | INFRA | — | — | — | — | ✓backend | — | ✓ | ✓ | ✓ | n/a | **INFRA** (no object store) |
| **m12-feedback** Record | WORKING | WORKING | via actions | close/reopen WORKING (no delete=policy) | resolve→approve WORKING (SoD) | add-activity **MISSING\*** | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** (activity add) |
| m12 Setup (questionnaire/SLA/category/source) | WORKING | WORKING | upsert WORKING | lifecycle WORKING | N/A (single-perm, no SoD—by design) | — | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| **m13-case** Case | WORKING | WORKING | via actions | close/archive/reopen WORKING | open/resolve/escalate WORKING | party/activity WORKING | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** |
| m13 triage / decisions / settlements / tasks / investigation | triage **MISSING\***; others MISSING | — | — | — | MISSING | MISSING | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (sub-domains) |
| **m14-legal** Matter | WORKING | WORKING | via actions | close/archive/reopen WORKING | open/resolve/escalate WORKING; settlement propose→approve WORKING (SoD) | positions/opinions/counsel/activity WORKING | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** |
| m14 court-events / pleadings / costs / appeal / parties | MISSING | — | — | — | MISSING | parties MISSING | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (sub-domains) |
| **m16-litigation** Proceeding | WORKING | WORKING | via actions | close/archive/reopen WORKING | conclude/escalate WORKING; filing submit→review→approve→file WORKING (SoD) | filings WORKING | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** |
| m16 witnesses / exhibits / orders / bundles / hearings-add | MISSING | hearings/service READ | — | — | MISSING | MISSING | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (sub-domains) |
| **m17-recovery** Recovery case | create WIRED (W1) | WORKING | **header+exposure edit WIRED (W4)** | resolve/close/reopen/archive WORKING (no delete=policy) | arrangement propose→approve WORKING (SoD) | note WORKING; advance WIRED | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** (browser OPEN) |
| m17 debtor / owner / deadlines | **debtor+owner+deadline capture WIRED (W4)** | WIRED (W4) | party remove / deadline extend WIRED (W4) | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** (browser OPEN) |
| **m18-legaldocs** Knowledge | WORKING | WORKING | via actions | withdraw WORKING (reason) | submit→review→approve→publish WORKING (SoD) | — | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| m18 Template | MISSING (create); withdraw **MISSING\*** | WORKING | — | withdraw MISSING\* | submit→approve→publish WORKING | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** |
| m18 clauses / opinions / research / taxonomy | MISSING | — | — | — | MISSING | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (sub-domains) |
| **m19-finance** Fiscal year | WORKING | WORKING | N/A | close/reopen WORKING | N/A | — | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| m19 Fiscal period | **MISSING** (create no api/UI) | WORKING | N/A | close/lock/reopen WORKING | N/A | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** (create) |
| m19 GL account / Chart of Accounts | WORKING | WORKING | WORKING | activate/deactivate/archive WORKING | READ-ONLY(no SoD=policy) | history READ | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| m19 Accounting entity | **MISSING** (backend exists; UI references a control that doesn't exist — dead-end) | WORKING | MISSING | MISSING | N/A | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (dead-end) |
| m19 catalog (cost-centre/dimension/tax/payment-term/fx; type/currency edit) | MISSING | partial | MISSING | MISSING | N/A | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (master-data) |
| **m20-glrecon** Recon run | MISSING (create) | WORKING | execute/complete WORKING | reopen WORKING | N/A | — | ✓backend/partial | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** (create) |
| m20 Match / Exception / GL import | manual-match MISSING; import-upload MISSING | WORKING | confirm/reject/resolve/waive/accept/reject WORKING | unmatch WORKING | — | assign MISSING | ✓partial | ✓ | ✓ | ✓ | ✓ | pending | **PARTIAL** |
| m20 Certification / reconciling-item / ruleset admin | MISSING | partial | MISSING | MISSING | certify/reject MISSING | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** |
| **m21-journal** Journal draft | WORKING | WORKING | lines WORKING; header edit MISSING\* | withdraw WORKING | validate→submit→(M22)→authorize-post WORKING (SoD, no auto-post) | notes WORKING | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| m21 journal type/config/reason-codes | MISSING | — | MISSING | — | MISSING | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (config) |
| **m22-approval** Approval request | via journal flow WORKING | WORKING | N/A | N/A | approve/reject/return/escalate WORKING (SoD) | — | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| m22 override/resubmit/cancel; delegations; policy admin | MISSING | partial | MISSING | MISSING | override MISSING | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (admin) |
| **m28-copilot** Session/Query | WORKING | WORKING | N/A | N/A | READ-ONLY advisory (no execution=policy) | feedback WORKING; export **MISSING\*** | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** (advisory) |
| m28 Config | WORKING | WORKING | — | — | publish WORKING | — | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| **m32-analytics** Governed query | N/A | WORKING | — | — | run-query WORKING | — | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** (read) |
| m32 Dataset/Metric/Report authoring | MISSING | WORKING | MISSING | MISSING | validate/review/publish MISSING | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **MISSING** (authoring) |
| m32 non-Feedback adapters | INFRA (pending m33) | — | — | — | — | — | ✓backend | — | ✓ | ✓ | ✓ | n/a | **INFRA** |
| **m39-saas** Plan / Version / Subscription | WORKING (plan, version author, entitlement, quota) | WORKING | change-plan WORKING | suspend/cancel WORKING (no delete=policy) | publish WORKING (SoD); subscription activate/renew WORKING | usage/overrides/billing READ | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** (sub-create MISSING\*) |
| m39 usage/overrides/billing writes | READ-ONLY (append-only/administered elsewhere=policy) | READ-ONLY | — | — | — | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **READ-ONLY** |
| **m41-security** Secret/Key | WORKING (define) | WORKING (metadata/versions/reveals) | N/A (immutable) | revoke/destroy WORKING (SoD; no hard-delete) | activate/rotate WORKING; reveal-authorization WORKING (**never plaintext**) | — | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| m41 GRC control | WORKING (define) | WORKING | N/A (no update route=canonical) | N/A (no retire=canonical) | record-assessment WORKING (append-only) | — | ✓ | ✓ | ✓ | ✓ | ✓ | pending | **WORKING** |
| m41 Privacy / DLP / Incident | READ-ONLY (UI); writes backend-only | READ-ONLY | — | — | — | — | ✓backend | ✓ | ✓ | ✓ | ✓ | pending | **READ-ONLY / PARTIAL** |

---

## C. FRAMEWORK-ONLY (no business UI by design — correct)

kernel, contracts, m01-tenant (switcher only), m02-auth (login), m03-audit (append-only spine — **must never get
edit/delete UI**), m04-admin, m05-hub, m06-workflow, m07-rules, m10-report (→m32), m11-ai (→m24-29), m15-recon
(→m20), m15a-matching, m23-finance-integration, m24-ai-foundation, m25-operational-ai, m26-legal-ai,
m27-finance-ai, m29-ai-governance, m30-platform, m31-studio, m33-integration, m34-marketplace, m35-devportal,
m36-events, m37-govrelease, m38-automation, m40-resilience, m42-certification. **Audit Logs: append-only,
permanently read-only — no edit/delete to be added, ever (Phase-3 rule 8).**

---

## D. Genuine launch-relevant WEB gaps (ranked; backend proven-present for all)

**Tier-1 — status:** m12 `addFeedbackActivity` merged (PR #179); the remaining six are now **WIRED** on
`release/tier1-web-wiring-completion` (backend-proven; authenticated browser sign-off OPEN — see
`TIER1_WEB_WIRING_COMPLETION_REPORT.md`):
1. m09 `createDocument` — ✅ WIRED ("Create document" metadata form, `documents.document.create`).
2. m12 `addFeedbackActivity` — ✅ MERGED.
3. m13 `triageCase` — ✅ WIRED (triage control, `cases.case.triage`).
4. m17 `advanceRecovery` — ✅ WIRED (ordered "Advance stage" + reason, `recovery.case.update`).
5. m28 `exportCopilotQuery` — ✅ WIRED (privileged export, references-only, `ai.copilot.export`).
6. m18 `withdrawTemplate` — ✅ WIRED (danger+reason withdraw, `legaldocs.template.manage`).
7. m02-identity `updateIdentity` (PATCH) — ✅ WIRED (profile edit form, `identity.registry.edit`).

**Tier-2 Wave-1 — WIRED** on `release/tier2-wave1-operational-workflows` (backend-proven; browser sign-off OPEN —
see `TIER2_WAVE1_OPERATIONAL_WORKFLOWS_REPORT.md`):
8. m19 **accounting-entity** create/edit/activate/deactivate — ✅ WIRED (Finance Config → Accounting Entities tab).
9. m19 **fiscal-period** create — ✅ **already worked** (audit correction: `openPeriod` + `PeriodsPanel`); added a
   client-side overlap/duplicate-#/date guard.
10. m17 **recovery case create** ✅ WIRED; m20 **recon-run create** ✅, **GL import** ✅ (structured rows),
    **manual-match** ✅ (exact 1:1; split/many-to-many deferred), **certification** ✅ (privileged override — NOT
    SoD; real SoD is M21/M22).

**Tier-2 Wave-2 — WIRED** on `release/tier2-wave2-legal-workflows` (backend-proven; browser sign-off OPEN — see
`TIER2_WAVE2_LEGAL_WORKFLOWS_REPORT.md`):
11. Legal sub-domains — ✅ WIRED: m13 decisions/tasks/activity-complete; m14 court-events/pleadings/costs/appeal;
    m16 witnesses/exhibits/orders/obligations/bundles; m18 template-create/clauses/taxonomy. Backend-absent ops
    (m13 task assign/escalate; m18 composition + mandatory-validation; m16 witness-withdraw/exhibit-custody/order-
    edit/bundle-remove-reorder; taxonomy dependency guard) reported as not-modelled, not invented.

**Tier-2 Wave-3 — WIRED** on `release/tier2-wave3-admin-analytics-controls` (backend-proven; browser sign-off
OPEN — see `TIER2_WAVE3_COMPLETION_REPORT.md`):
12. ✅ m32 analytics authoring (dataset/metric+maker-checker-lifecycle/report create); ✅ m08 template
    authoring lifecycle; ✅ m22 delegation grant/revoke/list; ✅ m21 journal header edit; ✅ m02 role-attr edit;
    ✅ m20 reconciling-items + a bounded backend already-matched guard (409). Backend-absent items (m32 dataset
    edit/retire + report publish-path; m08 preview/send + escalation admin; m22 delegation edit/expire +
    policy/config admin; m20 split-match + source-file) reported as gaps, not simulated.

**Tier-2 Wave-4 — WIRED** on `release/tier2-wave4-recovery-case-capture` (backend-proven; browser sign-off OPEN —
see `TIER2_WAVE4_RECOVERY_COMPLETION_REPORT.md`):
13. ✅ m17 recovery **debtor / party capture** (add/list/remove, contact redacted on read); ✅ **accountable owner**
    assignment via an active-tenant-member picker (bounded backend guard: owner must be an ACTIVE same-tenant
    identity — cross-tenant/disabled/non-uuid rejected); ✅ **deadline / relevant-date capture** (user-entered
    explicit date; NO statutory limitation calc) + extend; ✅ **case header + stated-exposure EDIT** (new bounded
    `PATCH /recovery/recoveries/:id` + `RECOVERY_CASE_UPDATED` audit; never touches recovered/outstanding, owner,
    or lifecycle). +21 HTTP assertions (cross-tenant, stale-version, PII-not-leaked, ineligible owner, invalid
    date/money).

**Tier-2 Wave-5+ — MISSING (remaining):**
14. m17 party edit + deadline complete/waive (backend absent); m20 split many-to-many (needs a new unmatched-line
    read endpoint) + source-file ingestion (no storage contract); m22 policy/config/reason-code admin; m08
    escalation admin; m32 dataset-edit/report-publish backend; sub-entity confirm hardening.

**Intentionally READ-ONLY / not gaps:** audit spine, copilot advisory, DLP findings, privacy records, saas
usage/billing evidence, analytics governed-query-only reads, all catalogs, no-hard-delete everywhere, m09 byte I/O
(INFRA), m32 non-Feedback adapters (INFRA).
