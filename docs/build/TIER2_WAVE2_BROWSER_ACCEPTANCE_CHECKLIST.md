# Tier-2 Wave-2 Legal — Human Authenticated Browser-Acceptance Checklist

> Automated password entry is policy-restricted, so authenticated acceptance is performed by a **human**. Covers
> M13 (case decisions/tasks/activities), M14 (matter court-events/pleadings/costs/appeal), M16 (litigation
> witnesses/exhibits/orders/bundles), M18 (legal-docs template/clauses/taxonomy). **Synthetic local/staging-safe
> accounts only. Never paste real credentials.** Browser acceptance stays **OPEN** until a human signs off; no
> module is COMPLETE until its checks pass.

## Environment (local, disposable)
1. Throwaway PostgreSQL; `DATABASE_URL=postgres://postgres@127.0.0.1:5433/finapp_test`; `npm run migrate`.
2. Seed (personas seed correctly after the Wave-1 FK fix):
   ```
   export LOGIN_PW='<local throwaway ≥12 chars — do not commit/print>'
   node deploy/staging/bootstrap-synthetic.mjs && node deploy/staging/seed-personas.mjs && node deploy/staging/seed-login.mjs
   ```
3. API: `DATABASE_APP_ROLE=finapp_app DATABASE_OWNER_ROLE=finapp_owner API_PORT=3000 FINAPP_ALLOWED_ORIGINS=http://localhost:5173 FINAPP_COOKIE_SECURE=false FINAPP_COOKIE_SAMESITE=lax node apps/api/dist/src/main.js`
4. Web: `cd apps/web && npx vite --port 5173` → `http://localhost:5173`; log in as a persona (human types password).

## Personas
`stg_admin_login` (all), plus legal/compliance/auditor/restricted personas. Expected: an authorized persona sees
the control; an unauthorized persona does not see it AND a direct API call still 403s; cross-tenant data is never
visible.

---

## M13 — Cases (open a case → drawer)
- [ ] **Decisions:** submit a decision (type + rationale) — appears as `submitted`; a DIFFERENT persona
      (`cases.decision.approve`) can Approve; the submitter cannot approve their own (SoD). Audit shows
      `CASE_DECISION_SUBMITTED`/`_APPROVED`.
- [ ] **Tasks:** create a task (headline + priority) → appears; Complete it → `completed`. Audit `CASE_TASK_*`.
- [ ] **Activities:** add an activity; Complete a non-completed activity → `completed`.
- [ ] Persistence after refresh; unauthorized persona sees no add/approve controls and is 403 on direct call.
- [ ] Task assign/reopen/escalate are absent (the UI states so) — confirm none is offered.

## M14 — Matters (open a matter → drawer)
- [ ] **Court events:** schedule (type + title + date + forum) → appears `scheduled`; Complete → `completed`.
- [ ] **Pleadings:** register (role) → `draft`; File → `filed` with court stamp; filed history preserved.
- [ ] **Legal costs:** record (type + amount) — amount shows EXACT minor units; no edit/void control exists
      (references-only, append-only); audit `LEGAL_COST_RECORDED`.
- [ ] **Appeal:** update status/forum/deadline → current appeal status reflects after refresh.
- [ ] Unauthorized persona: controls hidden + direct API 403; cross-tenant matter not visible.

## M16 — Litigation (open a proceeding → drawer)
- [ ] **Witnesses:** add (type + role) → appears; contact is redacted unless permitted — confirm no personal data
      leaks.
- [ ] **Exhibits:** register (number + description); Admit/Reject/Withdraw once → status set; a second decision is
      rejected (single-winner).
- [ ] **Court orders:** record (type + terms) → appears (append-only); open a compliance obligation → Complete or
      Breach it.
- [ ] **Bundles:** create → `draft`; a DIFFERENT persona approves (SoD; preparer cannot); File after approve;
      "+ item" is available before approval and DISAPPEARS once approved/filed.
- [ ] Persistence after refresh; unauthorized persona controls hidden + 403; cross-tenant denial.

## M18 — Legal Documents (Legal → Legal Documents)
- [ ] **Templates tab → "+ New template":** create (code + title) → appears `draft`; existing submit/approve/
      publish/withdraw still work.
- [ ] **Clauses tab:** create a clause (code + title + kind) → `draft`; submit → approve (a DISTINCT approver;
      SoD) → publish; Withdraw requires a reason. Content is a reference only (no secret/inline text).
- [ ] **Taxonomy tab:** create an entry (kind + code + label); a duplicate code is rejected (unique per
      tenant+kind); Retire → shows retired (soft). Confirm the UI states retire has no dependency guard.
- [ ] Confirm the UI states template↔clause composition + mandatory-clause validation are NOT modelled (no fake
      composition UI). No secret placeholder/value is ever shown.

---

## Sign-off
- [ ] All authorized paths persist + audit correctly; unauthorized paths hidden AND server-denied (403).
- [ ] Cross-tenant isolation holds; no hard delete of legal evidence; SoD holds where enforced.
- [ ] Money (legal costs) is exact minor units; no ledger posting.
- Reviewer: __________________  Date: __________  Result: PASS / FAIL (browser acceptance remains OPEN until PASS)
