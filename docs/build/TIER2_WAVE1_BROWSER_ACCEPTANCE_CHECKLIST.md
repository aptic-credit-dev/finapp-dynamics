# Tier-2 Wave-1 — Human Authenticated Browser-Acceptance Checklist

> Automated password entry is policy-restricted, so authenticated browser acceptance is performed by a **human**.
> This checklist covers the Wave-1 workflows (M17 recovery create; M19 entity + fiscal period; M20 run/import/
> manual-match/certification). Use **synthetic local/staging-safe accounts only**. **Never** paste real
> credentials. Browser acceptance stays **OPEN** until a human completes and signs this off. No workflow is
> COMPLETE until its checks pass.

## Environment (local, disposable)
1. Start PostgreSQL (throwaway); `DATABASE_URL=postgres://postgres@127.0.0.1:5433/finapp_test`.
2. `npm run migrate`.
3. Seed (the FK-ordering defect is fixed — personas now seed):
   ```
   export LOGIN_PW='<choose a local throwaway password, ≥12 chars — do not commit/print>'
   node deploy/staging/bootstrap-synthetic.mjs
   node deploy/staging/seed-personas.mjs
   node deploy/staging/seed-login.mjs
   ```
4. API: `DATABASE_APP_ROLE=finapp_app DATABASE_OWNER_ROLE=finapp_owner API_PORT=3000 FINAPP_ALLOWED_ORIGINS=http://localhost:5173 FINAPP_COOKIE_SECURE=false FINAPP_COOKIE_SAMESITE=lax node apps/api/dist/src/main.js`
5. Web: `cd apps/web && npx vite --port 5173` → open `http://localhost:5173`.
6. Log in with a seeded persona (see below). The human types the password; it is never stored.

## Personas (seeded; synthetic)
`stg_admin_login` (platform admin — sees all), plus (via seed-personas) `stg_treasury_maker`,
`stg_treasury_approver`, `stg_recovery_officer`, `stg_recovery_manager`, `stg_compliance_officer`, `stg_auditor`,
`stg_restricted`. Expected: an authorized persona sees the action; an unauthorized persona does **not** see it
**and** a direct API call still 403s; another tenant's data is never visible (cross-tenant 404/denied).

---

## M17 — Recovery case creation
Authorized (e.g. `stg_recovery_officer`/manager or admin with `recovery.case.create`):
- [ ] Recovery cases → "+ New recovery case" is visible.
- [ ] Form validates: Create disabled until recovery type code + title present; invalid amount blocked.
- [ ] Create persists; the register refreshes and the new case opens (status `draft`, `REC-…` number).
- [ ] Reload the list — the new case is still present (persistence after refresh).
- [ ] Audit history shows `RECOVERY_CASE_CREATED`.
Unauthorized (`stg_restricted`):
- [ ] "+ New recovery case" is hidden; a direct `POST /recovery/recoveries` returns 403.
Cross-tenant:
- [ ] A case created under tenant A is not visible when acting as tenant B.

## M19 — Accounting entity
Authorized (`finance.entity.manage`/`activate`/`deactivate`):
- [ ] Finance Configuration → "Accounting Entities" tab visible; "New entity" form present.
- [ ] Create with code+name persists; appears in the list (status `active`).
- [ ] Duplicate code is rejected with a clear message (unique per tenant).
- [ ] Edit name/currency persists (reflects after refresh); a stale edit surfaces a conflict message.
- [ ] Deactivate → status `inactive`; Activate → `active` (no hard delete; record persists).
- [ ] Audit shows `FIN_ENTITY_REGISTERED`/`UPDATED`/`ACTIVATED`/`DEACTIVATED`.
Unauthorized: entity controls hidden; direct POST 403.
Cross-tenant: entity from tenant A not visible as tenant B.
Note (documented gap): deactivating an entity with dependents is NOT blocked by the domain — verify the UI caution
is shown.

## M19 — Fiscal period (already-working + new guard)
- [ ] Under an entity → fiscal year (open), the "Open period" form is present.
- [ ] Duplicate period #, end-before-start, and date-overlap with an existing period each block submission with a
      clear inline message (client-side guard).
- [ ] A valid, non-overlapping period opens and persists; close/lock/reopen behave per permission.
- [ ] Audit shows `FIN_PERIOD_OPENED` (+ close/lock/reopen as used).

## M20 — Reconciliation run
Authorized (`gl_reconciliation.run.create`, treasury_reconciliation entitlement):
- [ ] Treasury → runs → "+ New run" visible; account select populated.
- [ ] Create run (optional period + opening/closing balances) persists and opens the run.
- [ ] Reload — the run persists. Audit shows `GLRECON_RUN_CREATED`.
Unauthorized/entitlement-off: control hidden; direct POST 403; Treasury group hidden without entitlement.

## M20 — GL import (structured rows)
- [ ] "+ Import GL (structured rows)" visible (`gl_reconciliation.import.create`).
- [ ] Account + source format + batch reference + ≥1 valid row required; invalid amount flagged per row.
- [ ] Import reports the accepted line count; a bad-direction/amount row is rejected and appears under the import's
      errors (view per import).
- [ ] Re-importing the same batch reference is idempotent (no duplicate import).
- [ ] No file-upload control is present (structured rows only — by design).

## M20 — Manual match (exact 1:1)
Authorized (privileged `gl_reconciliation.match.manual`):
- [ ] For an executed run, candidate pairs list with per-candidate variance.
- [ ] "Match" is disabled unless variance is exactly zero AND a reason is entered (no tolerance).
- [ ] Confirm an exact candidate → match recorded; the original entries remain traceable; audit shows the manual
      decision.
- [ ] Attempting to match a non-zero-variance candidate is not possible from the UI (and the server would reject).
Note: split/many-to-many grouping is intentionally not surfaced (bounded follow-up).

## M20 — Certification (NOT SoD — verify labelling)
- [ ] For a completed run, "Draft certification" → certify/reject controls appear
      (`gl_reconciliation.certification.create`).
- [ ] With open exceptions/items, plain Certify is blocked (409); the privileged override path
      (`gl_reconciliation.certification.override`) requires a reason.
- [ ] Reject preserves history. Nothing is posted to the core ledger.
- [ ] The UI clearly states this is NOT approver≠maker SoD (real SoD = M21/M22 journals). Confirm no wording
      implies M20 enforces maker-checker.

---

## Sign-off
- [ ] All authorized paths persist and audit correctly.
- [ ] All unauthorized paths are hidden AND server-denied (403).
- [ ] Cross-tenant isolation holds (404/denied).
- [ ] No hard delete anywhere; no privilege escalation via identity/entity/recovery.
- [ ] Financial amounts are exact (minor units).
- Reviewer: __________________  Date: __________  Result: PASS / FAIL (browser acceptance remains OPEN until PASS)
