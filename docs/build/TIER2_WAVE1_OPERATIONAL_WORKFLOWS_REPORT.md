# Tier-2 Wave-1 Operational Workflows — Completion Report

> Delivers UI-to-API-to-DB workflows for operationally critical M17/M19/M20 functions. Reuses existing backend
> contracts (no new endpoints, no new migrations). **No production deployment. M42 remains NO_GO. G1–G4
> unchanged.** Companions: `TIER2_WAVE1_BROWSER_ACCEPTANCE_CHECKLIST.md`, `MODULE_CRUD_LIFECYCLE_MATRIX.md`.

## 1. Starting SHA
`21907fc6bc590a05ffecb036946017299be5f1f5` (baseline verified: deps · format · typecheck · smoke 8080/0 · web
build).

## 2. Branch & final SHA
`release/tier2-wave1-operational-workflows` off `21907fc`. Final SHA: **`652e26a`** (docs commit appended after).

## 3. Commits created
- `75147fa` feat(web/m17): wire recovery case creation
- `d94406f` feat(web/m19): wire accounting-entity admin + fiscal-period overlap guard
- `e5dd775` feat(web/m20): wire recon run creation, GL import, manual match, certification
- `652e26a` fix(staging-seed): bootstrap the canonical Synthetic Tenant 1 id
- (this) docs(tier2): Wave-1 report + browser checklist + matrix/report updates

## 4. Files changed
- `apps/web/src/app.tsx` — M17/M19/M20 UI.
- `apps/web/src/api.ts` — new clients: `createRecovery`; `createFinanceEntity` / `updateFinanceEntity` /
  `financeEntityLifecycle`; `createReconRun` / `createGlImport` / `createManualMatch` / `createCertification` /
  `certifyRun` / `rejectCertification` / `getRunCandidates`.
- `apps/api/test/api-finance.db-spec.ts` — entity edit/lifecycle/duplicate-code HTTP assertions.
- `deploy/staging/bootstrap-synthetic.mjs` — canonical Synthetic-Tenant-1 id (seed-personas FK fix).
- `docs/build/*` — this report, browser checklist, matrix/report updates.

## 5. M17 status — Recovery case creation: **WIRED**
"+ New recovery case" on the Recovery cases list → `POST /recovery/recoveries` (`recovery.case.create`, audit
`RECOVERY_CASE_CREATED`) via new `api.createRecovery`. Fields limited to the domain create contract:
`recoveryTypeCode` (required, active type; a datalist suggests codes seen on existing cases) + `title` (required);
`priority`/`recoveryRisk`/`confidentiality` validated enums; `currency`; `principalAmountMinor` (exact minor
units); `summary`. Server forces `recoveryNumber`/`status=draft`/`tenant_id` (no arbitrary tenant/owner/stage).
Debtor parties, owner assignment and deadlines are separate follow-up endpoints on the case drawer (not part of
create). On success the register refreshes and the new case opens. No hard delete. Cross-tenant create is denied
(existing api-recovery db-spec). **Contract note:** the domain has no debtor/owner/due-date field on create and no
duplicate-by-debtor guard (only idempotency-key + unique recovery number) — surfaced honestly, not invented.

## 6. M19 status — Accounting entity: **WIRED**; Fiscal period: **ALREADY WORKED (audit correction)**
- **Accounting entity** (real gap — was a UI dead-end): new "Accounting Entities" tab in Finance Configuration —
  create / edit / activate / deactivate → `POST /finance/entities[/:id[/activate|deactivate]]`
  (`finance.entity.manage`/`activate`/`deactivate`) via new api clients. `code` required + unique-per-tenant
  (server-enforced) + immutable after create; `name`/`functionalCurrencyCode`/`description` editable with
  `expectedVersion`; single-permission (no maker-checker per domain); no hard delete.
- **Fiscal period** — **the prior audit was wrong**: period create + close/lock/reopen already work end-to-end
  (`api.openPeriod` + `PeriodsPanel`). Not re-implemented. Added a **client-side** overlap / duplicate-number /
  date-order guard on the existing period form. **Contract gaps reported, not invented:** the m19 domain enforces
  only `period_number` uniqueness + `start<=end` + fiscal-year-open — there is **no** server overlap or
  within-fiscal-year containment guard, and **no** server dependency guard on entity deactivate. These are
  surfaced in the UI as cautions; the domain was not modified.

## 7. M20 status — Reconciliation
- **Run create: WIRED** — "+ New run" in the runs workspace → `POST /gl-reconciliation/runs`
  (`gl_reconciliation.run.create`). Selects the reconciliation account; optional period + opening/closing balances
  (exact minor units). **Correction:** the run references `glAccountId` only — the domain has no entity/bank/
  currency field on the run. Opens the created run.
- **GL import: WIRED (structured rows)** — `POST /gl-reconciliation/gl-imports`
  (`gl_reconciliation.import.create`): account + source format + batch reference (dedup/idempotency) + a dynamic
  rows editor (date / amount-in-minor-units / direction / reference). **No file/object-store** upload (honest —
  none exists on staging). Reports accepted line count; rows with a bad direction/amount are rejected server-side
  and recorded as import errors; re-importing the same batch reference is idempotent.
- **Manual match: WIRED (exact 1:1)** — `POST /gl-reconciliation/manual-matches` (**privileged**
  `gl_reconciliation.match.manual`), candidate-driven: shows each candidate's variance; "Match" is enabled only
  at **zero variance** (no tolerance); requires a reason; the server re-validates exact balance. The UI only
  offers run candidates (the server does not itself block re-matching an already-matched line, so the UI must —
  and does — restrict selection). **Split / many-to-many is domain-supported but not surfaced** (needs run-scoped
  line selection + summed-variance) — a bounded follow-up stated in-UI.
- **Certification: WIRED (honestly labelled)** — draft / certify / reject with a privileged override path
  (`gl_reconciliation.certification.create`/`override`). **Correction / explicit gap:** M20 certification is
  **NOT** approver≠maker segregation of duties — the domain does not enforce it. The UI states this and points to
  the **M21/M22 journal** path for real SoD sign-off. Certification posts **nothing** to the core ledger.

## 8. Backend contracts reused or added
**Reused (no new endpoints):** `POST /recovery/recoveries`; `POST /finance/entities[/:id[/activate|deactivate]]`;
`POST /finance/fiscal-years/:id/periods` (already wired); `POST /gl-reconciliation/{runs,gl-imports,
manual-matches,certifications,certifications/:id/certify,certifications/:id/reject}`; `GET
/gl-reconciliation/runs/:id/candidates`. **Added:** none (backend unchanged).

## 9. Migrations added
**None.** No schema change.

## 10. Permissions and audit events
No new permissions or audit codes. Permissions enforced (server + UI): `recovery.case.create`;
`finance.entity.manage`/`activate`/`deactivate`; `gl_reconciliation.run.create`/`import.create`/`match.manual`
(privileged)/`certification.create`/`certification.override` (privileged). Audit codes emitted by the reused
endpoints: `RECOVERY_CASE_CREATED`; `FIN_ENTITY_REGISTERED`/`UPDATED`/`ACTIVATED`/`DEACTIVATED`;
`GLRECON_RUN_CREATED`/`IMPORT_CREATED`/`MANUAL_DECISION_RECORDED`/`GROUPED_MATCH_CREATED`/`CERTIFICATION_CREATED`/
`OVERRIDDEN`/`REJECTED`.

## 11. Tests with exact results
- web typecheck ✅ · prettier ✅ · vite build ✅.
- **DB integration lane** (disposable local PG, 84 migrations, `DATABASE_APP_ROLE=finapp_app`): **98 specs, 3050
  assertions, 0 failed** (+4 new M19 entity edit/deactivate/activate/duplicate-code HTTP assertions).
- **smoke lane**: 51 suites, **8080 assertions, 0 failed**.
- Coverage by workflow: M17 create — api-recovery db-spec (anon 401, create, idempotency, cross-tenant forge).
  M19 entity — api-finance db-spec (register + **new** edit/deactivate/activate/duplicate-409 + cross-tenant RLS).
  M19 period — api-finance db-spec (create + close). M20 run/import/manual-match/certify — `m20-glrecon`
  service db-spec (48 assertions: balance-invariant + duplicate rejection, idempotency, manual-match exact-balance,
  certify blocked-without-override + override-permission default-deny + empty-reason 400 + privileged override,
  stale-version, cross-tenant RLS). **Gap:** M20 has no HTTP-level test (only service-level) — the new api clients
  are thin pass-throughs to the service-proven endpoints; an HTTP M20 lane is a recommended follow-up.
- **Not applicable:** "maker approving own work / valid maker-checker approval" — M20 has no SoD; that scenario
  belongs to the M21/M22 journal path (out of Wave-1 scope).

## 12. Browser acceptance status
**OPEN.** Unauthenticated boot passes; authenticated persona acceptance requires a human (password entry is
policy-restricted for the agent). The environment is now **ready**: the `seed-personas` FK-ordering defect is
fixed (canonical Synthetic-Tenant-1 id), so all personas seed. Follow
`TIER2_WAVE1_BROWSER_ACCEPTANCE_CHECKLIST.md`. No workflow is promoted to strict COMPLETE until a human performs
it.

## 13. Remaining defects
None blocking. Honest domain gaps (reported, not invented): M19 period overlap + within-FY containment
(server-side absent; UI guards only); M19 entity deactivate has no server dependency guard; M20 certification is
not approver≠maker SoD; M20 manual-match has no server already-matched guard (UI restricts) and split/many-to-many
grouping isn't surfaced; recovery create has no debtor/owner/date field or duplicate-by-debtor guard.

## 14. Remaining Tier-2 modules / follow-ups
M20 split/many-to-many manual match; M20 HTTP test lane; M20 source-import + reconciling-item + exception-assign;
recovery debtor-party/owner/deadline capture on create; legal sub-domains (M13/M14/M16/M18); M32 analytics
authoring; M08/M22 admin; M21 journal header edit; M02-rbac role-attribute edit; sub-entity confirm hardening.

## 15. No hard-delete / no maker-checker bypass
Confirmed. No `@Delete` route added or called anywhere; all teardown is status transition (deactivate/reject/etc.,
history preserved). No maker-checker was bypassed or faked — M20 certification is **not** claimed as SoD (the UI
says so and defers real SoD to M21/M22). M19 config is single-permission by domain (not maker-checker), stated
honestly. M02 identity is untouched here.

## 16. M42 status
**NO_GO — unchanged.** No production-readiness claim; no deploy; no merge; G1–G4 assurance statuses untouched.

## 17. Exact next action
1. A human runs the authenticated persona walkthrough in `TIER2_WAVE1_BROWSER_ACCEPTANCE_CHECKLIST.md` against a
   local/staging-safe stack (personas now seed), promoting each workflow to WORKING on pass.
2. Then push `release/tier2-wave1-operational-workflows` and open a PR (no merge/deploy until review). Keep M42
   NO_GO until Stage-7 assurance closes. Wave-2 (remaining §14) follows.
