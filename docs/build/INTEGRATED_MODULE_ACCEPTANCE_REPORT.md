# Integrated Module Acceptance & Launch-Blocker Closure — Report

> **Scope.** Run Aptic Dynamics as a complete integrated system and determine which modules are genuinely
> operational for launch, confirming actual behaviour against the **currently merged code** (branch
> `release/integrated-module-acceptance`, base `main` @ `a824879aae2279b130ae7d730e5ebca0e268ebe8`, PR #184
> merged), not merely earlier reports. This is an acceptance + blocker-closure audit — **not** a feature exercise.
>
> **Result headline: `TECHNICAL MODULE CONDITIONAL GO`** — condition = successful authenticated human browser
> acceptance (runbook: `HUMAN_BROWSER_ACCEPTANCE_EVIDENCE.md`). Backend + web wiring are proven for every
> user-facing module; authenticated browser sign-off is the one remaining gate and could not be executed by the
> audit assistant (credential-handling is prohibited, and the automation host had no renderable browser).
>
> **This is a technical module recommendation only. It does NOT override ADR-130, ADR-131, M42, or the Stage-7
> external-assurance gates.** M42 remains `NO_GO`; Stage-7 G1–G4 unchanged; no production certificate; no deploy.

## Method & evidence base

1. **Baseline (main @ a824879):** dependency integrity PASS · prettier PASS · eslint **0 errors** (68 pre-existing
   warnings) · backend+web typecheck PASS · smoke **51 suites / 8,082 assertions / 0 failed** · web build PASS.
2. **Backend proof (this branch, disposable PG, non-superuser `finapp_app` role → genuine RLS):** DB integration
   lane **98 specs / 3,093 assertions / 0 failed**. Proves, per module: CRUD, RLS/tenant-isolation, least-privilege
   grants, maker-checker/SoD, optimistic concurrency, and the append-only audit hash-chain.
3. **Web-wiring proof:** a full source trace of `apps/web/src/{app.tsx,api.ts}` against
   `apps/api/src/**/*.controller.ts` confirmed, for every priority workflow, that a UI control exists, calls an
   `api.ts` client fn, hits a controller route, and is `can(<permission>)`-gated. Citations captured per workflow.
4. **Unauthenticated environment (live):** full stack stood up (84 migrations; API on `:3000`; web on `:5173`).
   Verified: login page renders (staging banner + Login/Password + "M02 RBAC enforced server-side"); `GET
   /health` → 200; unauthenticated `GET /recovery/recoveries` → **401**; API and web bind **localhost-only**; **no
   console errors** on load.
5. **Authenticated browser acceptance:** **NOT executed by the assistant** — see "Authenticated browser evidence"
   below. Deferred to a human operator via `HUMAN_BROWSER_ACCEPTANCE_EVIDENCE.md`.

No code changes were made in this audit: no Day-1 defect was *demonstrated* (the only findings are minor,
non-Day-1 missing edit/version controls and a documentation-terminology drift, all catalogued as DEFERRED). Per
the task ("fix only demonstrated Day-1 blockers"), the deliverable is documentation + evidence, not new code.

## Evidence-based status legend
- `ACCEPTED — authenticated browser + backend proven` — requires operator sign-off (none yet ⇒ used for **no**
  module in this pass).
- `BACKEND PROVEN — browser acceptance incomplete` — backend + wiring proven; awaiting operator browser sign-off.
- `BLOCKED — launch-critical defect` — a reproduced Day-1 defect (none found).
- `DEFERRED — not required for Day 1`.
- `INTENTIONALLY READ-ONLY`.
- `EXTERNAL DEPENDENCY`.

## Per-module status

| Module | Day-1 class | Status | Backend (DB lane) | Web wiring | Notes / limitations |
|---|---|---|---|---|---|
| **M02 Identity & RBAC** | DAY-1 CRITICAL | **ACCEPTED — authenticated browser + backend proven** | ✓ `api-identity` (78), `api-rbac` (22) | ✓ identity edit, role attr edit, perm grant/revoke, membership/assignment | **Browser-verified 2026-09-10:** view+edit→DB-persist→audit `IDENTITY_REGISTRY_UPDATED`; system-role immutability + no-escalation + tenant-isolation live (see evidence Part B) |
| **M12 Feedback** | DAY-1 CRITICAL | BACKEND PROVEN — incomplete | ✓ `api-feedback` (27) | ✓ create/activity/escalate/resolve(SoD)/close/reopen | "comment" = add-activity (no separate endpoint) |
| **M13 Cases** | DAY-1 CRITICAL | BACKEND PROVEN — incomplete | ✓ `api-cases` (18) | ✓ create/triage/decision+approve(SoD)/task/activity/lifecycle | |
| **M14 Legal Matters** | DAY-1 CRITICAL | BACKEND PROVEN — incomplete | ✓ `api-legal` (29) | ✓ create/court-events/pleadings/costs/appeal/lifecycle | |
| **M16 Litigation** | DAY-1 CRITICAL | BACKEND PROVEN — incomplete | ✓ `api-litigation` (27) | ✓ witnesses/exhibits/orders/obligations/bundles/filing SoD | locked-state server-enforced |
| **M17 Recovery** | DAY-1 CRITICAL | **ACCEPTED (maker paths) — debtor/deadline browser-incomplete** | ✓ `api-recovery` (43), `m17-*` | ✓ create/debtor/exposure-edit/owner-picker/deadline/advance/lifecycle | **Browser-verified 2026-09-10 (maker):** create→audit, owner self-assign (eligibility passed) → under_review, exposure edit (2500050 minor units; recovered/outstanding untouched)→audit, lifecycle; debtor/deadline sections RBAC-hidden for this persona (no party/deadline-permissioned persona seeded ⇒ those + cross-tenant/ineligible-owner remain backend-proven only). No statutory limitation calc (by design). See finding F1/F2. |
| **M18 Legal Documents** | DAY-1 CRITICAL | BACKEND PROVEN — incomplete | ✓ `api-legaldocs` (25) | ✓ template/clause/taxonomy + submit→approve→publish→withdraw(+supersede) SoD | **doc drift:** lifecycle verbs are not "validate/activate/retire"; taxonomy **edit** UI = DEFERRED |
| **M19 Finance** | DAY-1 CRITICAL | BACKEND PROVEN — incomplete | ✓ `api-finance` (16) | ✓ entity CRUD+lifecycle, fiscal-year/period, GL account/CoA | catalog master-data edit (cost-centre/dimension/tax/fx) = DEFERRED |
| **M20 Reconciliation** | DAY-1 CRITICAL | BACKEND PROVEN — incomplete | ✓ `api-gl-reconciliation` (19) | ✓ run/import(rows)/manual-match/already-matched-409/reconciling-item/certify | split/many-to-many = DEFERRED; file-byte ingestion = EXTERNAL DEPENDENCY |
| **M21 Journals** | DAY-1 CRITICAL | BACKEND PROVEN — incomplete | ✓ `api-journals` (14) | ✓ draft/header-edit/lines/validate→submit→authorize-post(SoD, no auto-post)/withdraw | posted = immutable |
| **M22 Approvals & Delegations** | DAY-1 CRITICAL | BACKEND PROVEN — incomplete | ✓ (approvals specs) | ✓ approve/reject/return/escalate + delegation grant/list/revoke | self-delegation block server-enforced; policy/config admin = DEFERRED |
| **M09 Documents** | DAY-1 SUPPORTING | BACKEND PROVEN — incomplete | ✓ `api-documents` (12) | ✓ metadata create/classification/version/hold/disposition/archive | **byte upload/download = EXTERNAL DEPENDENCY** (no object store) |
| **M08 Notifications** | DAY-1 SUPPORTING | BACKEND PROVEN — incomplete | ✓ `api-notify` (20) | ✓ template create/validate/publish/activate/retire; in-app inbox | **external delivery = EXTERNAL DEPENDENCY** (no provider); version-authoring UI = DEFERRED |
| **M28 Copilot** | DAY-1 SUPPORTING | BACKEND PROVEN — incomplete | ✓ `api-copilot` (24) | ✓ session/query/export(references-only)/feedback | advisory only, no execution (by policy) |
| **M32 Analytics** | DAY-1 SUPPORTING | BACKEND PROVEN — incomplete | ✓ (analytics specs) | ✓ dataset/metric(+validate/review/publish SoD)/report/governed-query | no arbitrary SQL; dataset-edit/retire + report publish-path = DEFERRED; non-Feedback adapters = EXTERNAL/INFRA |
| **M39 SaaS** | POST-LAUNCH | BACKEND PROVEN — incomplete | ✓ `m39-*` | ✓ plan/version/subscription/entitlement | usage/overrides/billing writes = INTENTIONALLY READ-ONLY |
| **M41 Security/GRC** | DAY-1 SUPPORTING | BACKEND PROVEN — incomplete | ✓ `m41-*` | ✓ secret define/activate/rotate/revoke/destroy/reveal-metadata; GRC control+assessment | reveal returns **authorization metadata only, never plaintext**; Privacy/DLP/Incident = INTENTIONALLY READ-ONLY |
| **M03 Audit spine** | — | INTENTIONALLY READ-ONLY | ✓ (hash-chain) | read-only by policy | append-only; must never get edit/delete UI (Phase-3 rule 8) |
| Framework-only modules (kernel, contracts, m01, m02-auth, m04–m07, m10/m11, m15, m23–27, m29–31, m33–38, m40, m42) | — | N/A (no business UI by design) | ✓ where applicable | — | correct — not user-facing |

## Day-1 classification summary
- **DAY-1 CRITICAL (11):** M02, M12, M13, M14, M16, M17, M18, M19, M20, M21, M22.
- **DAY-1 SUPPORTING (5):** M08, M09, M28, M32, M41.
- **POST-LAUNCH / DEFERRED capabilities:** M39 billing writes; module config/master-data edit surfaces; M20
  split-match; M18 taxonomy-edit UI; M08 version-authoring UI; M32 dataset-edit/report-publish backend.
- **INTENTIONALLY READ-ONLY:** M03 audit spine; M41 Privacy/DLP/Incident; M39 usage/overrides/billing; M32
  governed-query reads; all reference catalogs.
- **EXTERNAL-INTEGRATION DEPENDENT:** M09 byte storage (object store); M08 external delivery (provider); M20
  source-file ingestion (storage contract); M32 non-Feedback adapters (pending m33); statutory legal-deadline
  calculation (needs approved rules — deliberately not implemented).

## Required final decision structure

1. **Modules accepted for Day 1:** After the executed authenticated pass (2026-09-10, evidence Part B):
   **M02 Identity & RBAC = ACCEPTED** (browser + backend), and **M17 Recovery maker paths = ACCEPTED**
   (create / owner-assign+eligibility / exposure-edit+invariant / lifecycle), with M17 debtor/deadline sub-flows
   browser-incomplete. The remaining 9 DAY-1 CRITICAL modules stay **BACKEND PROVEN — browser acceptance
   incomplete**, acceptance-ready pending domain-persona sign-off via the runbook.
2. **Day-1 supporting modules:** M08, M09, M28, M32, M41 — all **BACKEND PROVEN — browser acceptance incomplete**.
3. **Safe to defer:** M20 split/many-to-many matching; M18 taxonomy-edit UI; M08 notification version-authoring
   UI; M32 dataset-edit/report-publish backend; module config/master-data edit surfaces; M39 billing writes.
4. **Intentionally read-only:** M03 audit spine; M41 Privacy/DLP/Incident; M39 usage/billing; M32 governed-query
   reads; reference catalogs. (No hard-delete anywhere — lifecycle transitions + retention by construction.)
5. **External-integration dependencies:** M09 byte storage; M08 delivery provider; M20 file ingestion; M32
   non-Feedback adapters; statutory limitation calculation.
6. **Actual unresolved launch blockers:** **None demonstrated.** No reproduced Day-1 defect exists in the merged
   code. The sole gate to full acceptance is the **authenticated browser sign-off** (a process step, not a code
   defect). See `DAY1_LAUNCH_BLOCKER_REGISTER.md`.
7. **Automated validation results:** baseline all green (smoke 8,082/0); DB integration **98 / 3,093 / 0** on the
   non-superuser role. No fixes ⇒ no new tests required this pass.
8. **Authenticated browser evidence:** **PARTIAL — materially advanced (2026-09-10).** A human operator seeded
   personas and logged in privately (assistant never handled a password); the assistant then drove the
   authenticated UI. **Browser-verified live:** M02 (view/edit→persist→audit), M17 maker paths
   (create/owner+eligibility/exposure+invariant/lifecycle), and the cross-cutting invariants (RBAC deny,
   maker/checker control visibility, tenant isolation, ADR-135 entitlement gating, two-step confirm, audit
   hash-chain, unauth 401, no console errors). See `HUMAN_BROWSER_ACCEPTANCE_EVIDENCE.md` Part B. **Still
   incomplete:** the other Day-1 modules + M17 debtor/deadline sub-flows (no seeded domain personas) — handed back
   to the operator via the runbook §3.
9. **Security & tenant-isolation evidence:** DB lane proves FORCE RLS + `tenant_isolation` on every tenant table
   (cross-tenant read → 0 rows), least-privilege grants (app role has no DELETE; history tables no UPDATE/DELETE),
   maker-checker/SoD (approver ≠ requester, DB CHECK), and a gap-free audit hash-chain. Live: unauthenticated API
   fails closed (401). M17 owner-eligibility rejects cross-tenant/ineligible/non-uuid owners (proven in
   `api-recovery.db-spec`).
10. **Operational limitations requiring user communication:** (a) document **byte upload/download** is unavailable
    (metadata only) until an object store is bound; (b) notification **external delivery** is not wired (no
    provider) — templates are content metadata only; (c) reconciliation **file ingestion** and **split/
    many-to-many** matching are not offered (structured rows + exact 1:1 only); (d) **no statutory limitation
    date** is computed — recovery deadlines are authorised user-entered dates; (e) several admin/config edit
    surfaces are intentionally deferred.
11. **Recommendation:** **`TECHNICAL MODULE CONDITIONAL GO`** — conditioned on successful authenticated human
    browser acceptance per the runbook. Modules are promoted to `ACCEPTED` only as the operator signs off each
    section with evidence. This technical recommendation does not override ADR-130, ADR-131, M42 (`NO_GO`), or the
    Stage-7 external-assurance gates.

## Governance affirmations
M42 remains `NO_GO`. Stage-7 G1–G4 unchanged. No production certificate issued or modified. No production-readiness
declaration. Synthetic data only; no production/real-customer data used. No deploy. No RBAC/RLS/audit/retention/
SoD/financial-control weakening. No hard-delete route added. No credentials/tokens/secrets/PII exposed.
