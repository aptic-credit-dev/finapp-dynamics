# Tier-2 Wave-4 — M17 Recovery: Debtor, Owner, Deadline & Exposure Capture

> Completes the launch-critical M17 recovery-case **capture** workflow: an authorised user can create AND maintain
> a recovery case with debtor/customer details, an accountable case owner, recovery deadlines/relevant dates, and
> debt & exposure information. Extends the existing `createRecovery` workflow — it does NOT add a competing engine.
> Two bounded, additive, reversible backend extensions; **no migration**. **No production deployment. M42 remains
> NO_GO. Stage-7 G1–G4 unchanged.** Companion: `TIER2_WAVE4_BROWSER_ACCEPTANCE_CHECKLIST.md`.

## Starting SHA
`ebef9d3fb499259702c7a2308486fa8769fecf1a` (main; PR #183 merged). Baseline verified green before any change:
dependency integrity · prettier · eslint · typecheck (backend + web) · smoke 8080/0 · vite build.

## Branch
`release/tier2-wave4-recovery-case-capture` off `ebef9d3`. Committed locally only — **not pushed, not merged, not
deployed** (per task).

## Domain audit first (the gap map)
Before implementing, M17 was audited. Result:
- **Debtor (party):** backend COMPLETE (`POST/GET /recovery/recoveries/:id/parties`, `POST /recovery/parties/:pid/
  remove`; contact held as opaque `contact_ref`, redacted on read unless `recovery.party_contact.read`). → needed
  **UI + api.ts wiring only.**
- **Deadline:** backend COMPLETE (`POST/GET …/deadlines`, `…/deadlines/:did/extend`; due instant derived from a
  rule; `limitation` only checked to not be in the past — NO statutory calculation). → **UI + api.ts wiring only.**
- **Owner:** `assign`/`reassign` backend complete but `owner` was an **unvalidated bare string** (no FK, no
  eligibility check). → **UI wiring + a bounded backend guard.**
- **Exposure / header edit after create:** **genuinely MISSING API** — the repo `patchRecovery` supported it but
  no service/controller/audit exposed it. → **bounded backend extension.**

## Commits
- `feat(m17): owner-eligibility guard on assign + PATCH case header/exposure edit` (backend)
- `feat(web/m17): debtor, owner-picker, deadline & header/exposure capture in the recovery drawer` (web)
- `test(api/m17): Wave-4 capture coverage (+21 HTTP assertions) + m17-services owner-membership seed`
- `docs(tier2): Wave-4 report + browser checklist + matrix/report updates`

## Files changed
Backend: `packages/m17-recovery/src/{audit-codes,permissions(none),repository,recovery.service}.ts`,
`apps/api/src/recovery/recoveries.controller.ts`, `manifests/audit-code-registry.yaml`. Web:
`apps/web/src/{api.ts,app.tsx}`. Tests: `apps/api/test/api-recovery.db-spec.ts`,
`packages/m17-recovery/test/m17-services.db-spec.ts`. Docs: `docs/build/*`.

## Backend extensions (bounded, additive, reversible — no schema change)
1. **Owner-eligibility guard** (`RecoveryService.assign`): the owner must be a **uuid** and an **ACTIVE member of
   the tenant**. Validated with `repository.isActiveTenantMember` — `SELECT … FROM tenant_memberships WHERE
   identity_id=$1 AND status='active'` run inside the caller's tenant context. `tenant_memberships` is the shared
   **tenancy control plane** (RLS FORCE, no system escape), so a cross-tenant identity is invisible and rejected,
   as are suspended/ended/pending memberships and arbitrary names. Fail-closed `400` with a clear reason. This
   **strengthens** SoD/ownership accountability; it removes no existing capability.
2. **Case header + stated-exposure edit** (new `updateCase` + `PATCH /recovery/recoveries/:id`): reuses the
   existing `recovery.case.update` permission and the repo `patchRecovery`; adds `title` to `patchRecovery` and a
   new **`RECOVERY_CASE_UPDATED`** audit code (registered). Allow-lists title/summary/description/priority/risk/
   confidentiality/currency/sourceReference + `principal/interest/cost/recoverable` STATED exposure amounts.
   **Deliberately never touches** `recovered`/`outstanding` (moved only by recorded receipts/outcomes — the
   recovery-progress invariant), owner/team/strategy (dedicated flows), lifecycle status, or tenant. Optimistic-
   locked (`expectedVersion`); blocked once the case is terminal. Audit carries the changed **field names only**,
   never the (sensitive) values (ADR-072).

## Web wiring (single-file React over the canonical m17 API)
The recovery **create** form is unchanged in shape; after a successful create the drawer opens so the user
completes capture. New `RecoveryDrawer` sections (all RBAC-gated, tenant-scoped, audited server-side):
- **Edit header & exposure** — the `updateCase` form (blank amount = leave unchanged; exact minor units).
- **Accountable owner** — a picker over **active tenant memberships** (RLS-safe), with Assign / Reassign (reason);
  the server guard is the authority.
- **Debtor & parties** — list + add (role, customer/identity reference, display label, redacted contact reference,
  liability, confidentiality) + remove (soft). Guidance: prefer a REFERENCE over copying PII; never enter full
  identifiers/secrets.
- **Deadlines & relevant dates** — list (with a client-derived overdue hint) + capture (type + date) + extend
  (date + reason). The UI states plainly that a `limitation` date is user-entered and not statutorily computed.
New `api.ts` clients: `updateRecovery`, `getRecoveryParties`/`addRecoveryParty`/`removeRecoveryParty`,
`getRecoveryDeadlines`/`addRecoveryDeadline`/`extendRecoveryDeadline`, and `assignRecovery` extended with optional
reason/team.

## Permissions & audit events
**No new permissions** (reuses `recovery.case.update` / `recovery.case.assign` / `recovery.case.reassign` /
`recovery.party.read` / `recovery.party.manage` / `recovery.party_contact.read` / `recovery.deadline.read` /
`recovery.deadline.manage`). **One new audit code:** `RECOVERY_CASE_UPDATED` (registered in
`manifests/audit-code-registry.yaml`; `registered_code_count` bumped 979 → 980).

## Migrations
**None.** The 84 existing migrations apply cleanly.

## Validation results (exact; disposable local PG 15.2, non-superuser app role for real RLS)
- dependency integrity: PASS · prettier: PASS · eslint: PASS (0 errors, pre-existing warnings unchanged) ·
  typecheck (backend + web): PASS · vite production build: PASS.
- **smoke lane: 51 suites, 8082 assertions, 0 failed** (+2: the new audit code in the conformance/registry checks).
- **DB integration lane (fresh throwaway PG, 84 migrations, `DATABASE_APP_ROLE=finapp_app` → real RLS): 98 specs,
  3093 assertions, 0 failed.** `api-recovery` is now 43 assertions (+21 Wave-4): PATCH edit + persistence,
  exposure set (recovered/outstanding untouched), stale-version 409, negative-amount 400, invalid-priority 400,
  add debtor party, **PII: contact redacted without `party_contact.read` and revealed with it**, party
  soft-remove (stale 409 / correct-version ok), **ineligible owner 400** (non-member uuid), **non-uuid name 400**,
  active-member assign ok, **cross-tenant owner 400**, reassign-with-reason ok, deadline explicit-future ok,
  **limitation-in-the-past 400**, deadline extend ok. `m17-services` seeds an active membership for the owner
  (assignment now validates real membership).

## Browser acceptance
**OPEN.** Unauthenticated boot passes; the authenticated persona walkthrough is a human step (entering a password
into the login form is prohibited by policy, even for a throwaway local credential). See the checklist. No
workflow is promoted to WORKING/COMPLETE without that human sign-off.

## Security / controls preserved
Server-authoritative RBAC (default-deny) + UI gating; FORCE RLS + tenant isolation on every touched table;
optimistic concurrency (`expectedVersion`) on every versioned mutation; **owner accountability strengthened**
(active-same-tenant-member only); PII minimised (opaque references, contact redacted on read, audit carries field
names not values); exact integer minor units (no float); header edit never moves recovered/outstanding or crosses
into posting; **no hard-delete route added** (party remove is a soft deactivate with append-only history); no
secret/credential exposed. No AI approves/executes any controlled action.

## Remaining functional gaps (reported, not faked)
Party **edit** (backend absent — the `RECOVERY_PARTY_UPDATED` code is reserved but unused; correction = remove +
re-add); deadline **complete/waive** (status column supports it but no endpoint); an audited **contact-reveal**
event (`RECOVERY_PARTY_CONTACT_ACCESSED` is reserved but the read path does not yet emit it). All bounded
follow-ups.

## M42 status
**NO_GO — unchanged.** No production-readiness claim; no certificate; no deploy; Stage-7 G1–G4 untouched.

## Exact next action
1. A human runs `TIER2_WAVE4_BROWSER_ACCEPTANCE_CHECKLIST.md` (personas seed), promoting each workflow to WORKING
   on pass.
2. Then push `release/tier2-wave4-recovery-case-capture` and open a PR (no merge/deploy until review). Follow-ups:
   party edit + deadline complete/waive + audited contact-reveal (bounded backend).
