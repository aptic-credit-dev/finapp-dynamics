# Tier-1 Web-Wiring Completion Report

> Implements the six Tier-1 web-wiring gaps from the merged functional-completion audit. Backend endpoints were
> already present and DB-proven; this work wires the UI to them. **No production declaration. M42 remains NO_GO.
> G1–G4 assurance statuses unchanged.** Companion: `MODULE_FUNCTIONAL_COMPLETION_AUDIT.md`,
> `MODULE_CRUD_LIFECYCLE_MATRIX.md`.

## 1. Starting SHA
`64a90608cda5ed878910c9bd4b274d3f4dfe8b2d` (baseline verified: format · lint 0-err · typecheck · smoke
8080/0 · web build).

## 2. Branch & final SHA
Branch `release/tier1-web-wiring-completion` off `64a9060`. Final SHA: **`9aa8fbe`** (docs commit appended after).

## 3. Commits created
- `94c0a1f` feat(web): wire six Tier-1 web-wiring gaps (M09/M13/M17/M18/M28/M02)
- `9aa8fbe` test(api/m18): direct template-withdraw integration coverage
- (this) docs(tier1): completion report + matrix/report updates

## 4. Files changed
- `apps/web/src/app.tsx` — the six UI controls (single-file web app; all six screens live here, so per-file
  module separation isn't possible — commits grouped by concern).
- `apps/web/src/api.ts` — M17 `advanceRecovery` extended to pass the backend's already-supported optional
  `reasonCode` (no new endpoint).
- `apps/api/test/api-legaldocs.db-spec.ts` — direct template-withdraw assertions.
- `docs/build/*` — this report + matrix/report updates.

## 5. Status of each of the six operations
Legend: **WIRED** = control visible to authorized users, reaches the real backend, backend contract DB-proven,
permission/tenant/audit enforced server-side — **authenticated browser sign-off OPEN** (see §9), so not promoted
to the audit's strict "WORKING/COMPLETE".

| Op | Control | Permission | Allowed states | Backend proof | Status |
|---|---|---|---|---|---|
| M09 createDocument | "Create document" metadata form (Documents) | `documents.document.create` | needs an ACTIVE document type | api-documents db-spec | **WIRED** |
| M13 triageCase | Triage control w/ severity+priority (case drawer) | `cases.case.triage` | from `opened`/`reopened` | api-cases db-spec | **WIRED** |
| M17 advanceRecovery | "Advance stage" select + reason (recovery drawer) | `recovery.case.update` | ordered `RECOVERY_MACHINE` next-stages | api-recovery db-spec | **WIRED** |
| M18 withdrawTemplate | danger+reason "Withdraw" (templates) | `legaldocs.template.manage` | draft/under_review/changes_requested/approved/published → withdrawn | api-legaldocs db-spec (new) | **WIRED** |
| M28 exportCopilotQuery | privileged "Export" (copilot response) | `ai.copilot.export` | response `complete` & not held | m28 db-spec | **WIRED** |
| M02 updateIdentity | profile edit form (identity drawer) | `identity.registry.edit` | any status except `closed` | api-identity db-spec | **WIRED** |

## 6. UI behaviour implemented
Every control: permission-gated (hidden when unauthorized) · confirmation for state changes (two-step `ActionButton`
arm→confirm, or explicit multi-field submit) · required-field validation with disabled submit · busy/`…` state for
duplicate-submission protection · success/error notices · optimistic-concurrency version threading (re-fetch after
success so the next action doesn't 409) · register/detail refresh on success · accessible `aria-label`s on inputs ·
no native dialogs (would block automation). M09 explicitly separates **record/metadata create** from
**framework-only byte upload**. M17 constrains the next-stage select to the authoritative recovery adjacency (no
arbitrary stage). M28 export surfaces "references only — never prompt/answer text or secrets". M02 edits only
displayName/given/family/organizationRef and states role/tenant/status/credentials are never editable.

## 7. Permissions enforced
`documents.document.create`, `cases.case.triage`, `recovery.case.update`, `legaldocs.template.manage`,
`ai.copilot.export`, `identity.registry.edit` — all server-authoritative (service-level `authz.require`, default
deny) AND frontend-gated. No new permissions/events/audit codes/migrations were added.

## 8. Tests and exact results
- **web typecheck**: PASS · **prettier**: PASS · **eslint**: 0 errors (68 pre-existing warnings) · **vite build**:
  PASS.
- **DB integration lane** (disposable local PG, 84 migrations, `DATABASE_APP_ROLE=finapp_app`): **98 specs,
  3046 assertions, 0 failed** (up from 3043 — the 3 new template-withdraw assertions). Affected specs green:
  api-cases, api-recovery, api-documents, api-identity, api-legaldocs (25), api-copilot.
- **smoke lane**: 51 suites, **8080 assertions, 0 failed**.
- Coverage note: happy-path + key negatives for triage/advance/create/identity-update/export are covered by the
  existing api-* / m28 db-specs; template-withdraw coverage was added here (authorized withdraw, record-still-
  exists, already-withdrawn→409). No web component-test framework exists in the repo (only vite), so UI-level
  assertions are via typecheck/build + the backend integration lane, not DOM tests.

## 9. Browser acceptance results
- **Unauthenticated boot: PASS** — the bundle with all six changes loads (login renders, staging banner, **0
  console errors**), API fail-closed.
- **Authenticated persona acceptance: OPEN** — driving a persona session requires typing a password into the
  login form, which the operating safety policy prohibits (even for a synthetic local credential), and the full
  `seed-personas` set hit a local FK ordering issue. Per instruction, all other verification is complete and
  browser acceptance is explicitly left **OPEN**. The API/DB integration lane is the end-to-end substitute (real
  auth → RBAC → CRUD → RLS → audit).

## 10. Remaining Tier-1 blockers
None outstanding in scope — all six are wired and backend-proven. The only remaining item for each is
**authenticated browser sign-off** (§9), which gates promotion to strict WORKING/COMPLETE.

## 11. Remaining Tier-2 work (out of scope for this branch)
M19 accounting-entity (dead-end) + fiscal-period create; M17 recovery-case create / M20 recon-run create,
manual-match, GL-import upload; legal sub-domains (M13 decisions/tasks, M14 court-events/pleadings/costs/appeal,
M16 witnesses/exhibits/orders/bundles, M18 clauses/taxonomy); M32 analytics definition authoring; M08 template/
escalation admin; M22 delegation/policy admin; M21 journal header edit; M02-rbac role-attribute edit; UX-safety
two-step confirm on plain sub-entity destructive buttons (e.g. `removeCaseParty`).

## 12. Discovered backend-contract defects
None. All six endpoints behaved per the audited contract. One minor client-side gap corrected (not a backend
defect): the web `advanceRecovery` client did not forward the backend's already-supported optional `reasonCode`;
extended to do so (no endpoint change).

## 13. No hard-delete / no privilege-escalation
Confirmed. No `@Delete` route was added or called; M18 withdraw and all lifecycle actions are status transitions
that preserve history. M02 edit is a strict allow-list (displayName/given/family/organizationRef) — no role,
tenant, status, permission, credential, or secret field is accepted or exposed; the backend allow-list makes
mass-assignment structurally impossible. M28 export carries opaque citation references only — no prompts, answer
text, or secrets.

## 14. M42 status
**NO_GO — unchanged.** No production-readiness claim; no deploy; no merge; G1–G4 assurance statuses untouched.

## 15. Exact next action
1. Run **authenticated persona browser acceptance** for the six controls (a human enters the synthetic persona
   credentials; fix the local `seed-personas` FK ordering) — confirm authorized visibility, unauthorized hidden +
   server 403, persistence-after-refresh, invalid-transition rejection, cross-tenant denial, audit entries. On
   pass, promote each op to WORKING in the matrix.
2. Then push `release/tier1-web-wiring-completion` and open a PR (do not merge/deploy until review). Keep M42
   NO_GO until Stage-7 assurance closes.
