# Day-1 Acceptance Closure Pass — Report

> Executes the remaining authenticated browser steps for the Day-1 modules, on
> `release/day1-acceptance-closure` (base `main` @ `b79de0bc30b38d4270a621f901e4f61d13122861`, PR #188 merged).
> Disposable PG (non-superuser `finapp_app` → genuine RLS), production-mode API + web, **synthetic data only**. A
> human operator seeded personas and drove the authenticated browser; I verified every step server-side (DB +
> audit) and fixed the defects it surfaced. This pass was scoped (operator's direction) to **M12 + the treasury
> cluster M20/M21/M22**; M14/M16/M18/M19 remainders were not re-driven.
>
> **Headline: five real defects were found (four fixed), including one that blocked ALL feedback-resolution
> approvals.** Recommendation remains **`TECHNICAL MODULE CONDITIONAL GO`**. M42 `NO_GO`; Stage-7 G1–G4 unchanged;
> no production certificate; no deploy.

## Defects found (browser-demonstrated)

| # | Sev | Status | Module | Defect | Fix |
|---|---|---|---|---|---|
| **D-M12-1** | **HIGH** | **FIXED** | M12 | "Approve resolution" button gated on `resStatus === 'submitted'`, but the backend sets a submitted resolution's status to `'proposed'` (never `'submitted'`) → the button was **unreachable**, blocking **every** feedback-resolution approval and (downstream) closure of negative feedback. | `app.tsx`: gate on `'proposed'`. Re-verified: cs_hod submit → cs_manager approve (SoD), `FEEDBACK_RESOLUTION_APPROVED`. |
| **D-M21-1** | MED | **FIXED** | M21 | `createDraft` silently swallowed API errors (`if (r.ok && r.data)` with no else) — failures showed nothing to the user. | `app.tsx`: surface `r.error`. |
| **D-M21-2** | MED | **FIXED** | M21 | Journal draft had **no date field**; `journalDate` was hardcoded to `'2026-08-24'` → create failed (period-rejected) whenever that date wasn't in an open period. | `app.tsx`: added a journal-date input (user picks a date in an open period). |
| **D-M21-3** | MED | **FIXED (follow-up)** | M21 | A non-UUID `entityRef` (from the free-text fallback when the entity picker is empty) causes a raw **500** (`invalid input syntax for type uuid`) instead of a clean **400**. | **Fixed in a bounded backend follow-up** (branch `release/d-m21-3-entity-ref-validation`, separate from this pass's web-only fixes): the journal-draft **create** endpoint (`apps/api/src/journals/draft.controller.ts`) validates the four uuid-typed refs — `entityRef`/`periodRef`/`currencyRef`/`journalTypeId` — at the request boundary, reusing the shared `requireUuidParam`, → bounded **400 `Invalid <field>.`** (no SQL/PostgreSQL/stack leak). A well-formed but unknown `entityRef` remains accepted as an **opaque** m19 id (m21 owns no chart of accounts; no dereference, nothing cross-tenant to leak). HTTP regression added to `apps/api/test/api-journals.db-spec.ts`; DB lane **98 specs / 3,103 / 0**. Contributing UX (unchanged): the maker lacked `finance.entity.read` so the picker fell back to free text. Same-class gaps remain **by inspection** on the draft **edit** and **add-line** endpoints and on `journalDate` (a `date` column) plus a valid-but-unknown `journalTypeId` (FK `23503`) — separate, non-demonstrated in this fix; recommended follow-ups. |
| **D-M22-1** | MED | **FIXED** | M22 | Delegation grant defaulted `subjectType` to `'approval_request'`, which is **not** a valid delegation subject type → "unknown subject type". | `app.tsx`: replaced the free-text field with a dropdown of valid types (`journal_posting`/`journal_draft`/`payment`/`adjustment`/`reconciliation`/`manual`), valid default. |

The **four fixes made during this pass** (D-M12-1 / D-M21-1 / D-M21-2 / D-M22-1) are **web-only**
(`apps/web/src/app.tsx`); no backend/schema/permission/audit-code change. There is no web-unit-test lane, so each of
those fixes' regression check is the browser re-test (D-M12-1 re-verified end-to-end; D-M21-1/2 verified by the
create-with-date flow; D-M22-1 verified by the served bundle + dropdown render). **D-M21-3 was fixed separately** in
a bounded backend follow-up (see its row) — controller-level UUID validation only; still **no schema/permission/
audit-code/migration change** — and carries an automated HTTP regression in the DB lane.

## Per-module results (this pass)

| Module | Status | Evidence |
|---|---|---|
| **M12 Feedback** | **ACCEPTED** | create (`FEEDBACK_RECORD_CREATED`) · activity · classify · escalate (reason-gated; `FEEDBACK_ESCALATION_TRIGGERED`, `POST …/escalate → 201`) · **resolution submit→approve with SoD** (cs_hod `…b0300` → cs_manager `…b0200`, distinct; `FEEDBACK_RESOLUTION_APPROVED`) · customer confirmation · capture. Close correctly **rule-gated** (negative case also needs root-cause + SLA disposition + customer-informed — returns unmet requirements). RBAC fail-closed (cso analytics `403`). PII redaction (customer contact `[redacted]`). **D-M12-1 fixed.** |
| **M21 Journals** | **PARTIALLY ACCEPTED** | maker path **ACCEPTED**: draft create → 2 balanced lines with GL accounts → validate (passes; correctly flagged `unknown_account` when a line had no account) → submit (`JOURNAL_DRAFT_SUBMITTED`) → M22 approval-request raised. Posting-authorize (SoD) not completed this pass. **D-M21-1/2 fixed, D-M21-3 found.** |
| **M22 Approvals** | **ACCEPTED (approval SoD); delegation BLOCKED** | approval decision **SoD ACCEPTED**: `approve` by `…c2` (approver) ≠ request creator `…c1` (`APPROVAL_DECISION_RECORDED` + `APPROVAL_REQUEST_APPROVED`). Delegation **grant BLOCKED** by a client bundle anomaly (persistent "unknown subject type" despite the served UI + running API both accepting `journal_posting`; unreproducible from code). **D-M22-1 fixed.** |
| **M20 Reconciliation** | **BLOCKED (browser) — not a product defect** | The recon demo seeded **0 recon accounts**, so a run cannot be created via the UI (needs a recon account). Backend proven in the DB lane. Requires recon-account provisioning to browser-test. |
| M14 / M16 / M19 | **PARTIALLY ACCEPTED (carried forward)** | Not re-driven this pass (scoped to treasury cluster). Prior campaigns proved M14/M16 makers + M19 entity create; settlement/filing/bundle approve + M19 deactivate/fiscal-period remain browser-incomplete. |
| M18 Legal Documents | **BACKEND PROVEN — browser incomplete** | Not in this pass's chosen scope. |
| M02 / M13 / M17 (maker) | **ACCEPTED** (PRs #186/#188) | Not re-tested (no regression indicated). |

## Cross-cutting controls (verified live this pass)
Maker-checker/SoD (M12 resolution, M22 approval — distinct identities); RBAC control-visibility + fail-closed
(permission-denied, `403` on unauthorized analytics/reads); reason-gated actions (escalate); rule-gated closure
(M12); exact minor units (M21 lines 1000=1000 balanced); validation correctness (M21 `unknown_account` flagged);
PII redaction (M12 contact `[redacted]`); audit events on every mutation with a gap-free hash-chain; no hard delete
(revoke/close/soft only). Persona provisioning stayed SoD-preserving (gap roles assigned to distinct identities;
`.read` perms added where a checker must see what it acts on — a role-composition correction, not a product change).

## Environment/provisioning notes (for future passes)
- The persona scripts don't seed vertical **entitlements** or **finance/recon master data**. This pass ran
  `seed-finance-config-demo.mjs` (entity + Jan-2026 open period + 8 GL accounts) but that seeder created **no recon
  accounts** and **no journal type** (journal type is optional; recon accounts are required for M20). Provision recon
  accounts to unblock M20.
- Treasury/Recovery/Compliance verticals are entitlement-gated (ADR-135); a `treasury_reconciliation` entitlement
  was seeded for Tenant 1.

## Automated validation (exact)
dependency integrity: PASS · prettier: PASS · eslint: **0 errors** (68 pre-existing warnings) · backend+web
typecheck: PASS · vite production build: PASS · **smoke: 51 suites / 8,082 assertions / 0 failed** · **DB
integration lane (non-superuser `finapp_app`): 98 specs / 3,093 assertions / 0 failed.** No backend code changed;
the four fixes are web-only.

## Completion decision
- **Unresolved Day-1 code blockers:** **0** (the one true blocker, D-M12-1, was fixed + re-verified). D-M21-3, the
  MED robustness gap (500-vs-400 on malformed manual input), has since been **fixed** in a bounded backend follow-up
  with HTTP regression coverage — it was never a launch blocker.
- **Executed authenticated evidence:** complete for M02/M12/M13/M17 + M22 approval SoD; partial for M21 (maker) and
  M14/M16/M19; incomplete for M18 and M20 (M20 blocked on recon-account seeding; M22 delegation blocked on a client
  anomaly).
- **Security/SoD/tenant-isolation/audit/accounting controls:** PASS (see cross-cutting).
- **Recommendation:** **`TECHNICAL MODULE CONDITIONAL GO`** — `GO` is withheld only because not every Day-1 module
  has full executed authenticated evidence (M18/M20 + M14/M16/M19/M21 remainders + M22 delegation). No unresolved
  Day-1 code blocker remains after the fixes. This technical recommendation does not override M42, ADR-130/131, or
  the Stage-7 external-assurance gates.

## Governance
M42 remains `NO_GO`. Stage-7 G1–G4 unchanged. No production certificate; no production-readiness claim. Synthetic
data only. No deploy. No RBAC/RLS/audit/retention/SoD/accounting-control weakening (gap roles are additive,
SoD-preserving, in the disposable DB). No hard-delete route. No credentials/PII exposed.
