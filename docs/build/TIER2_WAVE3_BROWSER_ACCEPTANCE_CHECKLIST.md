# Tier-2 Wave-3 — Human Authenticated Browser-Acceptance Checklist

> Automated password entry is policy-restricted, so authenticated acceptance is performed by a **human**. Covers
> M32 analytics authoring, M08 template administration, M22 delegations, M21 journal header edit, M02 role-attr
> edit, M20 reconciling items + already-matched guard. **Synthetic local/staging-safe accounts only. Never paste
> real credentials.** Browser acceptance stays **OPEN** until a human signs off; nothing is COMPLETE until passed.

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
`stg_admin_login` (all), plus restricted/auditor/analyst personas. Expected: authorized control visible;
unauthorized control hidden AND direct API call 403; cross-tenant data never visible; audit records each change.

---

## M32 — Analytics (Reporting → Analytics)
- [ ] Datasets tab → "New dataset" (source/key/name) persists; no arbitrary-SQL field exists.
- [ ] Metrics tab → pick a dataset, "New metric" (key/name/aggregation/measure) → draft appears in the dataset's
      draft list; Validate → validated; Request review → review_pending; a DIFFERENT persona with
      `analytics.metric.publish` Publishes (SoD; the author cannot publish their own); published is immutable.
- [ ] Reports tab → "New report" persists (draft). Confirm the UI states report publish path is a backend gap.
- [ ] Unauthorized persona: authoring controls hidden; direct POST 403. Cross-tenant denial. Audit present.

## M08 — Notifications (templates tab)
- [ ] "New template" (key/name/channel/body) persists (draft). Expand its versions.
- [ ] Version lifecycle: Validate → Publish (content frozen) → Activate (one active per template) → Retire
      (reason). A different persona is required for the privileged steps per your role setup.
- [ ] Confirm the UI states no preview/test-render and no send are offered (content is metadata-only; delivery
      needs a real external provider). No secret/credential field anywhere.
- [ ] Unauthorized persona: authoring hidden; direct POST 403.

## M22 — Approvals (delegations card)
- [ ] "Approval delegations" card visible with `approvals.delegation.read`; grant form visible with
      `approvals.delegation.manage`.
- [ ] Grant a delegation (delegator ≠ delegate) → appears active; self-delegation (same id) is blocked (button
      disabled + server rejects). Revoke (reason) → revoked; no hard delete.
- [ ] Confirm the UI states the domain applies SoD at decision time (not an authority-bound/overlap check at
      grant time). Cross-tenant delegations not visible.

## M21 — Journals (draft drawer)
- [ ] On a draft or validated journal: "Edit header" → change description/reference/date → saved; the balance
      bar and lines are unchanged (amounts/debits/credits untouched).
- [ ] On a submitted/posted journal: the header-edit control is absent (mutable-gated) and a direct edit is
      rejected server-side. Audit shows `JOURNAL_DRAFT_EDITED`.

## M02 — Roles & Permissions (role drawer)
- [ ] Open a tenant-custom role → "Edit name / description" → saved; refresh shows the new values.
- [ ] Open a system/immutable role → the attribute-edit control is absent; a direct PATCH is rejected (server+DB).
- [ ] Confirm permissions/kind/status/tenant are never editable via this form (no privilege escalation).

## M20 — Reconciliation (Treasury → runs)
- [ ] Select a run → "Reconciling items": raise an item (type/amount) → exact minor units shown; Clear (reason)
      → cleared; no delete.
- [ ] Already-matched guard: after confirming/manual-matching a line, attempting to match it again is rejected
      (server 409). Manual match still requires exact zero variance.
- [ ] Confirm structured-row import only (no file-upload control); split/many-to-many is not surfaced (deferred).

---

## Sign-off
- [ ] All authorized paths persist + audit correctly; unauthorized paths hidden AND server-denied (403).
- [ ] Cross-tenant isolation holds; SoD holds where enforced; no hard delete; exact minor units for M20/M21.
- [ ] No secrets/credentials exposed; M21 header edit never alters balance; M02 edit cannot escalate privilege.
- Reviewer: __________________  Date: __________  Result: PASS / FAIL (browser acceptance remains OPEN until PASS)
