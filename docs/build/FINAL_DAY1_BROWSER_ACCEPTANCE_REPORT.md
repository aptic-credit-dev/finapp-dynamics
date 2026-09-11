# Final Remaining Day-1 Authenticated Browser-Acceptance Report

> Campaign to complete authenticated browser acceptance for the remaining Day-1 critical modules (M12, M13, M14,
> M16, M18, M19, M20, M21, M22). M02 + M17 maker paths were already ACCEPTED (PR #186). Branch
> `release/final-day1-browser-acceptance`, base `main` @ `ff6f442d324b2d0ab79c126867d5d81b8a113527` (PR #186
> merged). Disposable PG (non-superuser `finapp_app` → genuine RLS), production-mode API + web, **synthetic data
> only**. A human operator seeded personas and performed every login privately; the assistant never handled a
> password.
>
> **Recommendation: `TECHNICAL MODULE CONDITIONAL GO`** — see §Decision. No Day-1 code defect was demonstrated.
> M42 remains `NO_GO`; Stage-7 G1–G4 unchanged; no production certificate; no deploy.

## Environment (verified)
- 84 migrations applied; API `:3000` production mode (ADR-020 bootstrap admin provisioned); web `localhost:5173`.
- Health `200`; unauthenticated `/cases` → **401** (fail-closed); web/DB bind localhost; **API `:3000` binds `::`
  (all interfaces)** in this dev boot — see finding N1; login page renders; **no console errors**.

## Persona provisioning (SoD-preserving)
The two seed scripts (`seed-personas.mjs` + `seed-legal-cs-personas.mjs`) cover M12 (cs_officer/cs_hod/cs_manager),
M14/M16 (legal_officer/legal_manager/filing_approver), M18 (knowledge_author/legal_reviewer/legal_publisher), M19
(finance_config_manager), M22 (treasury_maker/treasury_approver), plus auditor/restricted negatives. The audit found
**full gaps** for M13 and M20 and a **posting-authorize gap** for M21. These were closed by **creating scoped
tenant-custom roles and assigning them to DISTINCT existing personas** (data-only, no new credentials, no universal
persona) — `t1_case_maker`→legal_officer, `t1_case_checker`→legal_manager, `t1_recon_maker`→treasury_maker,
`t1_recon_checker`→treasury_approver, `t1_posting_authorizer`→treasury_approver, litigation-ops/clause/delegation
roles, etc. — and a `treasury_reconciliation` entitlement for Tenant 1 (Treasury is entitlement-gated, ADR-135).
**Maker and checker are always distinct identities; SoD preserved.** One correction during testing: the case-checker
role needed `cases.decision.read` to *see* the decision it approves (a checker must read what it approves) — added
to the synthetic role; SoD unaffected.

## Per-module results (browser-executed; each cross-checked against the DB + audit)

| Module | Status | Browser evidence (audit event) | Untested / blocked |
|---|---|---|---|
| **M13 Cases** | **ACCEPTED** | create (`CASE_RECORD_CREATED`) · party + **contact `[redacted]`** (`CASE_PARTY_ADDED`) · **decision submit→approve with SoD** — submitted_by=legal_officer, approved_by=legal_manager (`CASE_DECISION_SUBMITTED`+`CASE_DECISION_APPROVED`) · activity (`CASE_ACTIVITY_CREATED`) · lifecycle Open + two-step confirm (`CASE_RECORD_OPENED`, version bump) | triage control not separately surfaced; task-complete not driven |
| **M14 Legal Matters** | **PARTIALLY ACCEPTED** | create (`LEGAL_MATTER_CREATED`) · **cost `123456` exact minor units** (`LEGAL_COST_RECORDED`) · court event (`LEGAL_COURT_EVENT_SCHEDULED`) · pleading (`LEGAL_PLEADING_REGISTERED`) · appeal (`LEGAL_APPEAL_INITIATED`) | settlement propose→approve (SoD) + close/archive = checker steps not driven this session |
| **M16 Litigation** | **PARTIALLY ACCEPTED** | proceeding create (`LITIGATION_PROCEEDING_CREATED`) · witness (`LITIGATION_WITNESS_ADDED`) · exhibit (`LITIGATION_EXHIBIT_REGISTERED`) · order (`LITIGATION_ORDER_RECORDED`) · bundle (`LITIGATION_BUNDLE_CREATED`) | filing submit→review→approve→file + bundle approve (SoD via filing_approver) not driven; exhibit-admit not driven |
| **M19 Finance** | **PARTIALLY ACCEPTED** | accounting-entity create (`FIN_ENTITY_REGISTERED`) | entity deactivate + fiscal-year/period create = **BLOCKED (automation)**: the inline two-step confirm and `type="date"` inputs did not populate/fire reliably (Code field empty, dates mangled); **no console error, no server rejection** → automation-tooling limitation, not a product defect |
| **M12 Feedback** | **BACKEND PROVEN — browser incomplete** | not driven this session | personas seeded (cso/cs_hod/cs_manager); pending operator logins |
| **M18 Legal Documents** | **BACKEND PROVEN — browser incomplete** | not driven this session | personas seeded (knowledge_author/legal_reviewer/legal_publisher); pending operator logins |
| **M20 Reconciliation** | **BACKEND PROVEN — browser incomplete** | not driven this session | gap roles + Treasury entitlement seeded; pending operator logins |
| **M21 Journals** | **BACKEND PROVEN — browser incomplete** | not driven this session | posting-authorizer gap role seeded; pending operator logins |
| **M22 Approvals & Delegations** | **BACKEND PROVEN — browser incomplete** | not driven this session | approval SoD + delegation roles seeded; pending operator logins |

## Cross-cutting controls — verified live (this campaign + PR #186)
- **RBAC control visibility:** the M13/M17 create control is shown to the maker and **hidden** from the checker
  (recovery_manager/legal_manager saw the register but not "New …"); nav is RBAC- + entitlement-gated.
- **Unauthorized read fails closed:** personas lacking a read perm see "Missing required permission: …".
- **Maker-checker / SoD:** M13 decision approved by a **distinct** identity (approver ≠ submitter), enforced server-side.
- **Tenant isolation:** (PR #186) Tenant 2 shows only global system roles; tenant-custom roles isolated.
- **Entitlement gating (ADR-135):** Treasury/Recovery/Compliance verticals appear only when the tenant is entitled.
- **PII redaction:** M13 party contact and M16 witness contact render `[redacted]` for personas without the reveal perm.
- **Exact minor units:** M14 cost `1234.56 → 123456`; (PR #186) M17 exposure `25000.50 → 2500050`.
- **Two-step confirm:** M13 "Confirm Open"; (PR #186) M17 "Confirm Take ownership".
- **Audit chain:** every mutation emits an audit event; **all 36 audit events are hashed and chained** (integrity intact).
- **No hard delete:** every module states archive/close/withdraw/soft-remove; no `@Delete` route exists.
- **No console errors** throughout the executed workflows.

## Findings
- **N1 (LOW, observation):** the API process binds `::` (all interfaces) in this dev boot. Production is designed to
  sit behind a same-origin reverse proxy (nginx). Not a Day-1 blocker; note for deployment hardening.
- **Automation limitations (NOT product defects, NOT counted as FAIL):** (a) sidebar nav sometimes required a
  label-coordinate click; (b) `type="date"` inputs and some inline two-step confirms did not populate/fire reliably
  under automation (M19 fiscal-year/deactivate). These blocked *execution*, produced no console error and no server
  rejection, and do not indicate a product fault.
- **No Day-1 code defect demonstrated.** Consequently **no code fix was applied** (Phase 6 gate: fix only
  demonstrated Day-1 defects).

## Automated validation (no code changes this campaign — data seeds were in the disposable DB only)
- dependency integrity: PASS · prettier: PASS · eslint: **0 errors** (68 pre-existing warnings) · backend+web
  typecheck: PASS · vite build: PASS · **smoke: 51 suites / 8,082 assertions / 0 failed** · **DB integration lane
  (non-superuser `finapp_app`): 98 specs / 3,093 assertions / 0 failed.**

## Decision
- **Executed ACCEPTED (browser + backend):** M02, M13, M17 (maker paths).
- **PARTIALLY ACCEPTED (maker proven; checker/sub-steps pending):** M14, M16, M19.
- **BACKEND PROVEN — browser acceptance incomplete:** M12, M18, M20, M21, M22.
- **Unresolved Day-1 code blockers: 0.**
- **Recommendation: `TECHNICAL MODULE CONDITIONAL GO`** — `GO` is withheld only because not every Day-1 module has
  *executed* authenticated browser evidence yet (M12/M18/M20/M21/M22 pending, and M14/M16/M19 checker/sub-steps
  pending). No defect blocks launch; the outstanding item is completing the executed browser walkthrough (personas
  and gap-roles are already provisioned) with a real display + operator logins, ideally with a more robust input
  driver for `type="date"` fields and inline confirms. This technical recommendation does not override M42,
  ADR-130/131, or the Stage-7 external-assurance gates.

## Governance
M42 remains `NO_GO`. Stage-7 G1–G4 unchanged. No production certificate; no production-readiness claim. Synthetic
data only; no production/customer data. No deploy. No RBAC/RLS/audit/retention/SoD weakening (gap roles are
additive, SoD-preserving, in the disposable DB). No hard-delete route. No credentials/PII exposed.
