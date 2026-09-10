# Human Authenticated Browser-Acceptance — Operator Runbook & Evidence Log

> **Purpose.** Authenticated browser acceptance for the Integrated Module Acceptance audit
> (`release/integrated-module-acceptance`, base `main` @ `a824879`). The automated evidence
> (DB integration lane **98 specs / 3,093 assertions / 0 failed** with the non-superuser app role, plus a full
> source-confirmed web-wiring inventory) proves the backend + wiring. What remains is a **human** driving the
> authenticated UI. This document is the runbook the operator follows and the log where they record evidence.
>
> **Why a human runs this.** The acceptance assistant may not type, request, print, store or otherwise handle any
> password — even a synthetic one — and the audit's automation host had no renderable browser viewport (Chrome
> reported 0×0). The operator therefore controls every credential end-to-end and drives their own browser. **No
> module is `ACCEPTED` until the operator signs off the relevant section below with evidence.**
>
> **Governance (unchanged by this exercise):** synthetic data only; M42 remains `NO_GO`; Stage-7 G1–G4 unchanged;
> no production deploy; no production certificate; never paste real credentials, tokens, secrets or PII.

---

## 0. Safety rules for the operator

- Use a **throwaway** local password (≥12 chars) that exists nowhere else. Never a real/reused credential.
- Set it only via the `LOGIN_PW` environment variable in your own shell. Do not commit it, print it, or paste it
  into chat. The seed scripts hash it with Argon2id and never store it in clear.
- Screenshots: capture **only** post-login application content. Never capture the login form mid-type, a password
  manager, tokens, cookies, or real personal data. Synthetic persona names/emails (`*@staging.local`) are fine.
- If anything asks you to disable RLS, run as a DB superuser for the app, or grant hard-delete — **stop**; that
  would invalidate the acceptance.

---

## 1. Environment startup (disposable, local, synthetic)

All commands are run from the repo root on the audit branch. PostgreSQL 15.2 binaries at `C:\ZKBioTime\pgsql\bin`
were used during the audit; any local PG ≥15 works. Authoritative CI is PG16 (identical schema/policies).

### 1.1 Disposable PostgreSQL on port 5433
```bash
PGBIN="C:/ZKBioTime/pgsql/bin"
PGDATA="<a throwaway dir>/pgdata"          # NOT under the repo; a temp/scratch path
"$PGBIN/initdb.exe" -U postgres -A trust -E UTF8 --locale=C -D "$PGDATA"
"$PGBIN/pg_ctl.exe" -D "$PGDATA" -l "<scratch>/pg.log" -o "-p 5433" start
"$PGBIN/psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d postgres \
  -c "CREATE DATABASE finapp_test;" \
  -c "CREATE ROLE finapp_app   NOLOGIN NOBYPASSRLS;" \
  -c "CREATE ROLE finapp_owner NOLOGIN;"
```
`finapp_app` **must** be `NOBYPASSRLS` (not a superuser) — this is what makes RLS genuinely enforced. A superuser
app connection silently bypasses RLS and invalidates the tenant-isolation checks.

### 1.2 Migrations (84)
```bash
DATABASE_URL="postgres://postgres@127.0.0.1:5433/finapp_test" \
DATABASE_APP_ROLE=finapp_app DATABASE_OWNER_ROLE=finapp_owner \
npm run migrate            # expect: "migrate: 84 applied, 0 already up to date."
```

### 1.3 Synthetic tenant bootstrap + persona seed (operator sets LOGIN_PW)
```bash
export LOGIN_PW='<local throwaway ≥12 chars — do not commit/print>'
DATABASE_URL="postgres://postgres@127.0.0.1:5433/finapp_test" node deploy/staging/bootstrap-synthetic.mjs
DATABASE_URL="postgres://postgres@127.0.0.1:5433/finapp_test" node deploy/staging/seed-personas.mjs
DATABASE_URL="postgres://postgres@127.0.0.1:5433/finapp_test" node deploy/staging/seed-login.mjs
# Optional demo data for richer acceptance (feedback/cases/legal/recovery/finance/recon/etc.):
#   node deploy/staging/seed-<domain>-demo.mjs   (see deploy/staging/*-demo.mjs)
```
The seed scripts connect with the elevated `DATABASE_URL` role for *setup only*; the running app uses the
non-superuser `finapp_app` role (below). `bootstrap-synthetic.mjs` seeds `stg_tenant_1` with the canonical tenant
id `ac1fd32d-0929-4729-9b50-b57ec5b5286b` (relied on by the seed/accept scripts).

### 1.4 First-administrator bootstrap reference (ADR-020 — an account id, NOT a password)
`FINAPP_BOOTSTRAP_ADMIN_ACCOUNT` must be the **UUID of an already-seeded account** (it only grants the immutable
`platform_admin` role to that existing account; it is not a secret and carries no password). Get the admin
persona's account id from the DB, then export it:
```bash
"$PGBIN/psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d finapp_test -tAc \
  "SELECT ua.id FROM user_accounts ua JOIN authentication_credentials c ON c.account_id=ua.id \
   WHERE ua.login_identifier LIKE 'stg_admin%' AND ua.status='active' LIMIT 1;"
export FINAPP_BOOTSTRAP_ADMIN_ACCOUNT='<that account uuid>'
```

### 1.5 Boot the API (non-superuser app role → genuine RLS)
```bash
DATABASE_URL="postgres://postgres@127.0.0.1:5433/finapp_test" \
DATABASE_APP_ROLE=finapp_app DATABASE_OWNER_ROLE=finapp_owner \
FINAPP_BOOTSTRAP_ADMIN_ACCOUNT="$FINAPP_BOOTSTRAP_ADMIN_ACCOUNT" \
API_PORT=3000 FINAPP_ALLOWED_ORIGINS="http://localhost:5173" \
FINAPP_COOKIE_SECURE=false FINAPP_COOKIE_SAMESITE=lax \
NODE_ENV=production node apps/api/dist/src/main.js
# expect: "api: listening on http://localhost:3000/api/v1 ..."   (run `npm run build` first if dist is stale)
```

### 1.6 Boot the web app
```bash
cd apps/web && npx vite --port 5173      # http://localhost:5173 (proxies /api → :3000)
```

### 1.7 Pre-login environment gate (already verified by the audit, re-confirm locally)
- [ ] `http://localhost:5173` renders the **login page** (staging banner "STAGING · SYNTHETIC DATA · NOT
      PRODUCTION"; Login / Password fields; "M02 RBAC enforced server-side"). *(Audit: confirmed.)*
- [ ] `GET http://localhost:3000/api/v1/health` → `200`. *(Audit: confirmed.)*
- [ ] `GET http://localhost:3000/api/v1/recovery/recoveries` **unauthenticated** → `401`. *(Audit: confirmed.)*
- [ ] API (`:3000`) and web (`:5173`) bind to localhost only — not `0.0.0.0`. *(Audit: confirmed.)*
- [ ] Browser console shows **no errors** on the login page. *(Audit: confirmed.)*

---

## 2. Human-assisted login (never share the password with the assistant)

1. Open `http://localhost:5173` in your browser.
2. Sign in as a synthetic persona (e.g. `stg_admin_login`) by typing the throwaway `LOGIN_PW` **yourself**.
3. Confirm the dashboard renders and the staging banner is present.
4. Do not display or record the credential anywhere. Only note *"logged in as <persona> — OK"* below.
5. Re-authenticate as a second persona only where a section requires a different actor (maker-checker / RBAC).

Personas (from `seed-personas.mjs` / `seed-legal-cs-personas.mjs`): an admin (`stg_admin_login`, broad rights),
plus restricted / auditor / analyst / collections / finance / legal personas. Use a **least-privileged** persona
to prove negative (hidden control + 403) cases and a **different** persona to prove maker-checker.

---

## 3. Module-by-module acceptance checklist

For each row: perform the action in the UI, confirm the outcome, **refresh** and confirm persistence, watch the
console for errors, and tick the box. Record the audit event where noted (visible via the audit/timeline views or
the DB `audit_log`). Mark the module `ACCEPTED` only when every non-deferred row passes. Deferred / external rows
are pre-marked — confirm they are *honestly surfaced* (the UI states the limitation), not silently broken.

### M12 Feedback  — status on sign-off: ☐ ACCEPTED
- [ ] Create feedback record → appears in register; refresh persists.
- [ ] Add activity to the record (audit `feedback activityCreated`).
- [ ] Escalate (reason required) → escalation recorded.
- [ ] Comment — via "add activity" (there is no separate comment endpoint; confirm this is how comments work).
- [ ] Resolve (submit) then a **different** persona approves the resolution (maker-checker / SoD).
- [ ] Close; then confirm a closed record blocks further mutation (reopen control gated; direct mutation 4xx).

### M09 Documents — status: ☐ ACCEPTED
- [ ] Create document **metadata** → appears; classification set; refresh persists.
- [ ] Lifecycle: initiate version / place & release legal hold / request→approve→execute disposition / archive.
- [ ] Confirm the UI clearly states **byte upload/download is unavailable** (no object store bound) — metadata
      creation works, byte storage is EXTERNAL DEPENDENCY. This is not a defect.

### M13 Cases — status: ☐ ACCEPTED
- [ ] Create case; view; triage.
- [ ] Submit a decision; a **different** persona approves it (maker-checker).
- [ ] Add task; complete task; add activity.
- [ ] Lifecycle: open / resolve / close / reopen / archive (each gated + audited).

### M14 Legal Matters — status: ☐ ACCEPTED
- [ ] Create/view matter.
- [ ] Court event schedule + complete; pleading register + file; record legal cost (exact minor units);
      update appeal.
- [ ] Lifecycle: open/assign/resolve/close/reopen/archive/escalate; confirm restrictions on terminal states.

### M16 Litigation — status: ☐ ACCEPTED
- [ ] Add witness; register + admit exhibit; record order + add/complete/breach obligation; create + approve +
      file bundle.
- [ ] Filing: submit → review → approve → file; confirm **approver ≠ submitter** (SoD) is enforced.
- [ ] Confirm locked/filed-state restrictions (no edit after lock).

### M17 Recovery — status: ☐ ACCEPTED
- [ ] Create recovery case; on create the drawer opens.
- [ ] Add a debtor/party (reference + redacted contact) and remove one (soft; no hard delete).
- [ ] Edit header & exposure (principal/interest/cost/recoverable); confirm **Recovered/Outstanding unchanged**;
      blank amount = leave unchanged.
- [ ] Assign an owner from the **active-member picker**; reassign with a reason.
- [ ] Attempt to assign an **ineligible / cross-tenant / arbitrary-name** owner → rejected (400). *(Backend proven
      in `api-recovery.db-spec`; confirm the UI surfaces the rejection.)*
- [ ] Capture a deadline (future date); extend with reason; confirm a `limitation` date in the past is rejected
      and the UI states **no statutory limitation is calculated**.
- [ ] Advance stage; resolve/close/reopen/archive; confirm terminal-state edit is blocked.

### M18 Legal Documents — status: ☐ ACCEPTED
- [ ] Template create; clause authoring; taxonomy create + retire.
- [ ] Lifecycle is **submit → approve → publish → withdraw** (+ supersede); maker-checker = submit(maker) +
      approve(checker). **Note:** the verbs "validate / activate / retire" do **not** exist for
      templates/clauses (that terminology in earlier checklists is documentation drift — see the acceptance
      report). Confirm the real lifecycle transitions work.
- [ ] Note: taxonomy **edit** has no UI control (create + retire only) — DEFERRED, not a Day-1 blocker.

### M19 Finance Administration — status: ☐ ACCEPTED
- [ ] Accounting-entity create / edit / activate / deactivate.
- [ ] Fiscal-year create + close/reopen; fiscal-period create; confirm invalid-date / overlap guard.
- [ ] GL account / chart-of-accounts create / update / activate / deactivate / archive.

### M20 Reconciliation — status: ☐ ACCEPTED
- [ ] Create reconciliation run; import **structured GL rows**; manual match (exact zero variance).
- [ ] Attempt to re-match an already-matched line → rejected (409).
- [ ] Raise a reconciling item (exact minor units) and clear it (reason; no hard delete).
- [ ] Certification draft → certify; a privileged override path exists (this is an override, **not** SoD).
- [ ] Confirm the UI shows **no file-upload control** (byte ingestion is EXTERNAL DEPENDENCY) and split/
      many-to-many is not offered (DEFERRED). Not defects.

### M21 Journals — status: ☐ ACCEPTED
- [ ] Draft create; edit header (description/reference/date) — **lines/balance untouched**.
- [ ] Add/update/remove lines; balance integrity holds.
- [ ] validate → submit → (approval) → authorize-post; confirm **authorize ≠ submit** (SoD) and **no auto-post**.
- [ ] Withdraw a draft; confirm a posted journal is immutable.

### M22 Approvals & Delegations — status: ☐ ACCEPTED
- [ ] Approve / reject / return / escalate a request (reason where required); confirm **approver ≠ requester**.
- [ ] Grant a delegation (delegator ≠ delegate); list; revoke (reason; no hard delete).
- [ ] Self-delegation (same id) is blocked (button disabled + server rejects).

### M02 Identity & RBAC — status: ☐ ACCEPTED
- [ ] Edit an identity profile (allow-listed fields); refresh persists.
- [ ] Edit a tenant-custom role's name/description; grant/revoke a role permission.
- [ ] A system/protected role rejects attribute edit and permission change (server + DB); confirm **no privilege
      escalation** (kind/status/tenant not editable).
- [ ] Create a membership; grant an assignment.

### M08 Notifications — status: ☐ ACCEPTED
- [ ] Template create → validate → publish → activate → retire (one active per template).
- [ ] Confirm the UI does **not** claim external delivery — there is no provider; delivery is EXTERNAL
      DEPENDENCY. Content is metadata only; no secret fields.
- [ ] Note: an explicit "new version" authoring control is not surfaced (client fn exists) — DEFERRED, minor.

### M28 Copilot — status: ☐ ACCEPTED
- [ ] Open a session; run a **governed** query; confirm references-only output (no execution).
- [ ] Export a query result (privileged, references-only); send feedback.
- [ ] Confirm held/incomplete queries restrict export.

### M32 Analytics — status: ☐ ACCEPTED
- [ ] Create a dataset (whitelisted source/dims/measures — **no arbitrary SQL field**).
- [ ] Create a metric → validate → request review → a **different** persona publishes (maker-checker; published
      is immutable).
- [ ] Create a report (draft); run a governed query.

---

## 4. Persona & security matrix (run across the modules above)

Record PASS/FAIL with the persona used. Do not capture credentials in any evidence.

| Check | How | Result |
|---|---|---|
| Authorized control visible | privileged persona sees the control | ☐ |
| Unauthorized control hidden | least-privileged persona: control absent | ☐ |
| Direct unauthorized API → 401/403 | call the endpoint without/with wrong perms | ☐ |
| Cross-tenant denied | tenant-B persona sees none of tenant-A's records | ☐ |
| Maker ≠ checker enforced | same persona cannot approve own record (M12/M13/M16/M21/M22/M32) | ☐ |
| Stale version rejected | edit with an old version → 409 | ☐ |
| Invalid lifecycle transition rejected | illegal state move → 4xx | ☐ |
| Immutable/final record protected | posted journal / published metric / closed case | ☐ |
| Audit event created | change appears in audit/timeline | ☐ |
| No secret/PII exposed | secrets reveal metadata only; contact redacted | ☐ |
| Persists after refresh | reload → data present | ☐ |
| No console errors during workflow | dev tools console clean | ☐ |

---

## 5. Defect log (fill in during acceptance)

| # | Module | Steps to reproduce | Expected | Actual | Layer (UI/client/API/domain/schema/seed) | Severity (Day-1 blocker? Y/N) | Evidence (screenshot ref) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

> Route **only demonstrated Day-1 blockers** back to engineering for the smallest correct fix + a failing test.
> Do not raise deferred/external-dependency items (byte storage, external delivery, split-match, statutory
> limitation calc, taxonomy-edit UI, notification version-authoring UI) as blockers — they are catalogued in
> `DAY1_LAUNCH_BLOCKER_REGISTER.md` as non-Day-1.

---

## 6. Screenshot evidence index

Save screenshots to a local, non-committed folder. List them here by filename + one-line caption. **Never** attach
an image containing a credential, token, cookie or real PII.

| File | Module | What it shows |
|---|---|---|
| | | |

---

## 7. Final operator sign-off

- Modules marked `ACCEPTED` (all non-deferred rows passed): __________________________________________
- Modules with a demonstrated Day-1 blocker (see defect log): _______________________________________
- Deferred/external limitations confirmed as honestly surfaced (not broken): ☐
- Security & tenant-isolation matrix (§4) fully PASS: ☐
- Synthetic data only; no real credentials/PII captured: ☐
- Disposable DB and services torn down; ports closed: ☐

Operator: __________________  Date: __________  Overall result: PASS / FAIL

> Until this sign-off is completed with evidence, every user-facing module remains
> **BACKEND PROVEN — browser acceptance incomplete**, and the audit recommendation stays
> **TECHNICAL MODULE CONDITIONAL GO** (condition = this authenticated browser acceptance passing).
