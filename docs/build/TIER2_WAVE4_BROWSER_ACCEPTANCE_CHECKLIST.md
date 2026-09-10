# Tier-2 Wave-4 — Human Authenticated Browser-Acceptance Checklist

> Automated password entry is policy-restricted, so authenticated acceptance is performed by a **human**. Covers
> M17 recovery **capture**: debtor/party, accountable owner, deadlines/relevant dates, and case header + stated-
> exposure edit. **Synthetic local/staging-safe accounts only. Never paste real credentials.** Browser acceptance
> stays **OPEN** until a human signs off; nothing is COMPLETE until passed.

## Environment (local, disposable)
1. Throwaway PostgreSQL; `DATABASE_URL=postgres://postgres@127.0.0.1:5433/finapp_test`; `npm run migrate`.
2. Seed (personas seed after the Wave-1 FK fix):
   ```
   export LOGIN_PW='<local throwaway ≥12 chars — do not commit/print>'
   node deploy/staging/bootstrap-synthetic.mjs && node deploy/staging/seed-personas.mjs && node deploy/staging/seed-login.mjs
   ```
3. API (non-superuser app role → real RLS): `DATABASE_APP_ROLE=finapp_app DATABASE_OWNER_ROLE=finapp_owner API_PORT=3000 FINAPP_ALLOWED_ORIGINS=http://localhost:5173 FINAPP_COOKIE_SECURE=false FINAPP_COOKIE_SAMESITE=lax node apps/api/dist/src/main.js`
4. Web: `cd apps/web && npx vite --port 5173` → `http://localhost:5173`; log in as a persona (human types password).
5. Verify: unauthenticated boot renders login; API fail-closed (401); no console errors.

## Personas
`stg_admin_login` (all recovery permissions), plus a restricted/collections persona (no
`recovery.party_contact.read`, no `recovery.case.reassign`) and an out-of-tenant persona. Expected: authorised
control visible; unauthorised control hidden AND direct API call 403; cross-tenant data never visible; audit
records each change.

---

## M17 — Recovery (Recovery → Cases)
### Create → open
- [ ] "New recovery case" (type + title + priority/risk/confidentiality/currency/principal/summary) persists as a
      **draft**; on create the case **drawer opens** automatically.

### Edit header & exposure
- [ ] "Edit header & exposure" → change title/priority/summary and set interest/cost/recoverable → **Save
      changes** persists (refresh confirms). A **blank amount leaves the value unchanged**.
- [ ] The **Recovered / Outstanding** figures are NOT editable here and are unchanged by the edit.
- [ ] A stale edit (after another change) is rejected (optimistic concurrency). Audit shows `RECOVERY_CASE_UPDATED`.

### Accountable owner
- [ ] The **owner picker** lists only **active tenant members** (RLS-safe). Assign an owner → the case shows the
      owner and moves to `under_review`.
- [ ] Reassign with a reason → persists. The restricted persona (no `recovery.case.reassign`) does not see the
      Reassign control AND a direct API call is 403.
- [ ] An attempt to assign an identity from ANOTHER tenant (or an arbitrary name) is rejected server-side (400) —
      the picker never offers such an identity.

### Debtor & parties
- [ ] Add a **principal_debtor** with a customer/identity reference, a display label, a contact reference and a
      liability amount → appears in the parties table.
- [ ] As a persona WITHOUT `recovery.party_contact.read`, the **contact shows `[redacted]`**; as a privileged
      persona it shows the reference. The full contact is never leaked to the under-privileged persona.
- [ ] Remove a party → it is soft-removed (no hard delete); a stale-version remove is rejected (409).

### Deadlines & relevant dates
- [ ] Capture a **review** deadline with a future date → appears with its due date.
- [ ] Capture a **limitation** deadline with a PAST date → rejected (the UI states no statutory limitation is
      calculated; only "not in the past" is enforced).
- [ ] Extend a deadline (new future date + **reason**) → persists; an overdue deadline is visually flagged.

### RBAC / isolation / audit
- [ ] Every authoring control is hidden when the permission is absent AND the direct API call is 403.
- [ ] A second tenant sees none of the first tenant's recoveries, parties, deadlines or owners.
- [ ] Each change produces an audit record (`RECOVERY_CASE_UPDATED`, `RECOVERY_PARTY_ADDED`/`_REMOVED`,
      `RECOVERY_CASE_ASSIGNED`/`_REASSIGNED`, `RECOVERY_DEADLINE_CREATED`/`_EXTENDED`).

---

## Sign-off
- [ ] All authorised paths persist + audit correctly; unauthorised paths hidden AND server-denied (403).
- [ ] Cross-tenant isolation holds; owner is always an active same-tenant member; no hard delete; exact minor
      units; recovered/outstanding never hand-edited; no secrets/PII exposed (contact redacted).
- Reviewer: __________________  Date: __________  Result: PASS / FAIL (browser acceptance remains OPEN until PASS)
