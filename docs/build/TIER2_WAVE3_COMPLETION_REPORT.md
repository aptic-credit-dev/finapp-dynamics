# Tier-2 Wave-3 — Admin, Analytics, Finance Controls & RBAC Completion

> Completes the remaining launch-critical Tier-2 workflows (M32, M08, M22, M21, M02, M20). Reuses existing backend
> contracts; one bounded, safe backend fix (M20 already-matched guard). **No production deployment. M42 remains
> NO_GO. Stage-7 G1–G4 unchanged.** Companion: `TIER2_WAVE3_BROWSER_ACCEPTANCE_CHECKLIST.md`.

## Starting SHA
`5b0f3b72d26ad612e83a5fb04a4c1b2b2bc65bb0` (baseline verified: deps · format · typecheck · smoke 8080/0 · build).

## Branch & final SHA
`release/tier2-wave3-admin-analytics-controls` off `5b0f3b7`. Final SHA: the docs commit adding this report.

## Commits
- `dfb92e5` feat(web/m21): journal draft header editing
- `fe187fe` feat(m02/m22/m20): role-attr edit, approval delegations, reconciling items + already-matched guard
- `3aa0bc3` feat(web/m32/m08): analytics authoring + notification template administration
- `5e437bd` test(api): Wave-3 coverage (M20 guard + reconciling items, M02 role-attr edit)
- (this) docs(tier2): Wave-3 report + browser checklist + matrix/report updates

## Files changed
`apps/web/src/app.tsx`, `apps/web/src/api.ts`, `packages/m20-glrecon/src/match.service.ts` (backend guard),
`apps/api/test/{api-gl-reconciliation,api-rbac}.db-spec.ts`, `docs/build/*`.

## Workflow status (classification per repo criteria)
| Workflow | Status | Notes |
|---|---|---|
| **M32 dataset create** | WIRED — backend proven, browser OPEN | governed; whitelisted dims/measures; NO arbitrary SQL |
| **M32 metric create + validate + request-review + publish** | WIRED — browser OPEN | full maker-checker (SoD + human approver); published immutable; lifecycle surfaced per dataset's draft metrics |
| **M32 report create** | WIRED — browser OPEN | draft only |
| M32 dataset edit / retire | BLOCKED — backend absent | no endpoint/service — not simulated |
| M32 report validate/review/publish path | BLOCKED — backend absent (HTTP) | report validate/review routes not exposed → publish unreachable; stated in-UI |
| **M08 template create + validate + publish + activate + retire** | WIRED — browser OPEN | replaces the read-only viewer; content metadata only, no secret; one-active per template |
| M08 preview / test-render | BLOCKED — backend absent | render is worker-only; no preview endpoint — not faked |
| M08 actual send (email/SMS/webhook) | BLOCKED — external integration | provider adapter absent; a local preview is not delivery |
| M08 escalation policy admin | EXISTS_BUT_UNWIRED (deferred) | backend exists; not surfaced this wave (bounded follow-up) |
| **M22 delegation grant + revoke + list** | WIRED — browser OPEN | self-delegation blocked (client+server+DB); revoke reason-gated; no hard delete |
| M22 delegation edit / activate-expire; policy/config/reason-code admin | EXISTS_BUT_UNWIRED / INCOMPLETE_BACKEND | delegation edit + expire have no backend writer; policy/config admin deferred |
| **M21 journal draft header edit** | WIRED — browser OPEN | draft/validated only; metadata (description/reference/date); never touches lines/amounts/balance; posting/approval unaffected |
| **M02 RBAC role attribute edit** | WIRED — browser OPEN | name/description only (allow-listed); system/immutable roles rejected server+DB; no privilege escalation (permissions are a separate anti-escalation endpoint) |
| **M20 reconciling-item raise + clear** | WIRED — browser OPEN | exact minor units; clear = close, no hard delete |
| **M20 already-matched rejection** | WORKING (server) — bounded backend fix | `manualMatch` now 409s any GL/source line that is not `unmatched` — proven by integration test |
| M20 split / many-to-many matching | BLOCKED — needs a new read endpoint | write side is safe (exact-balance enforced); a per-line unmatched read + multi-select builder is the bounded follow-up — deferred |
| M20 source-file ingestion | INTENTIONALLY structured-rows | no object-store/import contract exists — not faked |
| M20 HTTP integration coverage | done (already existed + extended) | reconciling-item + already-matched-guard assertions added |

## Reused vs new backend contracts
- **Reused (no new endpoints):** M32 datasets/metrics(+validate/review/publish)/reports; M08 templates(+versions,
  validate/publish/activate/retire); M22 delegations(grant/revoke/list); M21 `drafts/:id/edit`; M02
  `PATCH /rbac/roles/:id`; M20 manual-matches, reconciling-items(+clear).
- **New backend (bounded, safe):** M20 `manualMatch` unmatched-status precheck (`packages/m20-glrecon/src/
  match.service.ts`) — rejects ineligible lines with 409. No schema change, no new route, no migration.

## Migrations
**None.**

## Permissions & audit events
No new permissions or audit codes. Enforced (server default-deny + UI gate): `analytics.dataset.manage`,
`analytics.metric.author`/`publish`, `analytics.report.author`; `notifications.template.author`/`validate`/
`publish`/`activate`/`retire`; `approvals.delegation.manage`/`read`; `journals.draft.edit`; `rbac.role.edit`;
`gl_reconciliation.item.manage`/`match.manual`. Audit codes emitted by the reused endpoints
(`ANALYTICS_*`, `NOTIFY_*`, `APPROVAL_DELEGATION_*`, `JOURNAL_DRAFT_EDITED`, `RBAC_ROLE_UPDATED`,
`GLRECON_RECONCILING_ITEM_*`, `GLRECON_*`).

## Validation results (exact)
- dependency integrity: PASS (0 problems) · prettier: PASS · eslint: PASS (0 errors, 68 pre-existing warnings) ·
  typecheck (backend + web): PASS · vite production build: PASS.
- **smoke lane: 51 suites, 8080 assertions, 0 failed.**
- **DB integration lane (disposable local PG, 84 migrations, `DATABASE_APP_ROLE=finapp_app` for RLS): 98 specs,
  3072 assertions, 0 failed** (+7 Wave-3: M20 reconciling-item raise/clear + anon-401 + already-matched-409;
  M02 role-attr edit). M08 template lifecycle already HTTP-covered; M22 delegation + M32 metric lifecycle covered
  at the service/package DB layer.

## Browser acceptance
**OPEN.** Unauthenticated boot passes; authenticated persona walkthrough is a human step (password-entry policy).
Environment ready (Wave-1 seed-personas fix). See the checklist. No workflow promoted to WORKING/COMPLETE without
that evidence.

## Remaining functional gaps
M32 dataset edit/retire + report validate/review/publish path; M08 escalation admin (deferred) + preview (absent)
+ send (external); M22 delegation edit/expire + policy/config/reason-code admin (deferred); M20 split/many-to-many
(needs a new unmatched-line read endpoint) + source-file ingestion (no storage contract). All reported, not faked.

## Security / accounting controls preserved
Server-authoritative RBAC (default-deny) + UI gating; FORCE RLS + tenant isolation on every touched table;
optimistic concurrency (expectedVersion) on every versioned op; SoD preserved (M32 publish, M22 self-delegation
block, M08 approver≠author); exact integer minor units (M20/M21); M21 header edit never touches lines/balance;
M02 attribute edit allow-listed (no privilege/role/tenant/credential mutation); no hard-delete route added; no
secret/credential exposed (M08 content metadata-only). M20 already-matched guard **strengthens** the accounting
invariant.

## M42 status
**NO_GO — unchanged.** No production-readiness claim; no certificate; no deploy; G1–G4 untouched.

## Exact next action
1. A human runs `TIER2_WAVE3_BROWSER_ACCEPTANCE_CHECKLIST.md` (personas seed), promoting each workflow to WORKING
   on pass.
2. Then push `release/tier2-wave3-admin-analytics-controls` and open a PR (no merge/deploy until review).
   Follow-ups: M22 policy/config admin, M32 dataset-edit/report-publish backend, M20 split-match read endpoint,
   M08 escalation admin.
