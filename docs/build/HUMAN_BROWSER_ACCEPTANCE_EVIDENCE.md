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

---

# PART B — Executed authenticated acceptance (session 2026-09-10)

> A supervised, human-assisted authenticated browser pass was executed against the disposable stack (PG `:5433`
> non-superuser `finapp_app` role → genuine RLS; API `:3000` **production mode** with the bootstrap admin; web
> `:5173`). A human operator seeded personas and performed every login privately (the assistant never handled a
> password). Evidence below is **verified live** in the browser and cross-checked in the database. Items not driven
> are recorded **BLOCKED — not tested**, never auto-passed.

## B.1 Session integrity
- Operator logins landed on the controlled stack: `sessions` = 1 active; `login_attempts` = succeeded. Verified in DB.
- API production boot ran the ADR-020 bootstrap: *"platform administrator provisioned"*. Unauthenticated
  `GET /recovery/recoveries` → **401**; `GET /health` → **200**. Listeners localhost-only. **No console errors**
  at any point.

## B.2 M02 Identity & RBAC — persona `stg_admin_login` (platform_admin) → **PASS (browser + DB)**
- **View:** identity register lists all 10 seeded personas. PASS.
- **Edit + persist:** edited an identity profile (Given name → `AcceptanceProbe`); DB confirms
  `identities.given_name='AcceptanceProbe'`; audit `m02-identity / IDENTITY_REGISTRY_UPDATED / success / actor=user`. PASS.
- **RBAC roles:** 2 system roles shown **immutable**; note *"A grantor can only confer permissions it itself holds"*
  (no privilege escalation). PASS.
- **No hard delete / no credential shown:** drawer states *"No credential is ever shown. No hard delete — disposal is a
  governed transition."* PASS.

## B.3 Cross-cutting security invariants — **PASS (browser + DB)**
- **Unauthorized read denied (fail-closed):** admin lacking `gl_reconciliation.account.read` → UI shows
  *"Missing required permission: gl_reconciliation.account.read."* PASS.
- **RBAC control visibility:** the maker persona sees **"+ New recovery case"**; the checker persona does **not**
  (same page, different rights). PASS.
- **Tenant isolation (live):** Tenant 1 Roles shows 10 roles (2 system + 8 tenant-custom); switching to Tenant 2
  shows **only the 2 global system roles** — tenant-custom roles are not leaked across tenants. PASS.
- **Entitlement gating (ADR-135):** Recovery/Treasury/Compliance verticals were **hidden** until the tenant was
  granted the capability, then **appeared** on reload — availability = entitlement, actions = RBAC. PASS.
- **Two-step confirm:** "Take ownership" required a second "Confirm" click (duplicate-submit protection). PASS.
- **Audit hash-chain:** all audit events carry `event_hash` (append-only integrity). PASS.

## B.4 M17 Recovery — persona `stg_recovery_officer` (maker) → **PASS for tested maker paths (browser + DB)**
- **Create:** created `REC-4ee68d6c63ed` (draft); audit `RECOVERY_CASE_CREATED / success / user`. PASS.
- **Owner assignment + eligibility:** "Take ownership" (two-step) → `legal_owner` = the officer's identity,
  status `draft→under_review`, `version 1→2`, audit `RECOVERY_CASE_ASSIGNED / success`. The owner-eligibility guard
  **accepted** the officer (an active tenant member). PASS.
- **Exposure edit (Wave-4 invariant):** set Principal 25000.50 → `principal_amount_minor = 2500050` (exact minor
  units, no float); **`recovered_amount_minor` and `outstanding_amount_minor` remained NULL** (edit never moved the
  progress amounts); `version 2→3`; audit `RECOVERY_CASE_UPDATED / success`. PASS.
- **Lifecycle state machine:** advance options correctly changed to the valid next-states from `under_review`. PASS.
- **RBAC-gated sub-sections:** **Debtor & parties** and **Deadlines** sections were correctly **hidden** for this
  persona (lacks `recovery.party.read` / `recovery.deadline.read`). PASS (correct gating).
- **Debtor/party capture, deadline capture, cross-member owner picker:** **BLOCKED — not tested.** No seeded persona
  holds `recovery.party.manage` / `recovery.deadline.manage` / membership-read, so these UI paths could not be
  driven. Backend-proven in `api-recovery.db-spec` (add/list/remove party, add/extend deadline, ineligible/
  cross-tenant owner → 400, PII redaction).

## B.5 M17 Recovery — persona `stg_recovery_manager` (checker) → **PASS (browser)**
- Recovery register renders; **no "+ New recovery case"** control (lacks `recovery.case.create`) — maker/checker
  separation visible. PASS.

## B.6 Modules NOT browser-tested this session → **BACKEND PROVEN — browser acceptance incomplete**
M08, M09, M12, M13, M14, M16, M18, M19, M20, M21, M22, M28, M32, M41 were **not** driven in the browser: the
minimal seed provisioned Stage-7 security/recovery/treasury/compliance personas only (no legal/CS/finance/analytics
domain personas), and only Tenant-1 vertical entitlements were added for the Recovery pass. These remain
**BLOCKED — not tested** in the browser (backend-proven in the DB lane). To complete them, seed the relevant domain
personas (e.g. `seed-legal-cs-personas.mjs`) + demo data + entitlements, then run §3 as the appropriate personas.

## B.7 Findings (from the executed pass) — see `DAY1_LAUNCH_BLOCKER_REGISTER.md`
- **F1 (LOW, non-blocking):** the recovery **create** accepted an unrecognized recovery-type code
  (`nonexistent_type_probe`) and stored a **null** `recovery_type_version` instead of rejecting an inactive/unknown
  type. The case remains fully governed (RBAC/RLS/audit/lifecycle). **Not a Day-1 blocker** (no security/financial/
  tenant/SoD impact). Recommended bounded follow-up: validate the recovery type is active on create.
- **F2 (LOW, non-blocking):** the accountable-owner **picker** is empty for `stg_recovery_officer` — the role can
  `recovery.case.assign` but lacks membership-read to populate the cross-member list; only "Take ownership"
  (self-assign) is usable. Day-1 need is met by self-assign; consider adding membership-read to the recovery-officer
  role bundle for cross-member assignment.

## B.8 Environment provisioning notes (for the operator, to extend coverage)
- Grant a tenant a vertical by inserting a `saas_entitlement_assignment` row (`allowance='included'`,
  `source_kind='override'`) for `debt_recovery` / `treasury_reconciliation` / `regulatory_compliance`, **or** run
  the proper SaaS entitlement grant via the API as an entitled admin.
- Recovery **create** needs an **active recovery type** (draft→validated→published→active). None is seeded by the
  minimal seed; author one via the recovery catalog before creating "real" typed cases.

## B.9 Executed-pass outcome
- **Browser-ACCEPTED (backend + authenticated browser):** **M02 Identity & RBAC** (view/edit/persist/audit) and the
  **M17 Recovery maker paths** create / owner-assign(+eligibility) / exposure-edit(+recovered-untouched invariant) /
  lifecycle. Cross-cutting **security + tenant-isolation + entitlement-gating + audit-chain invariants: PASS (live).**
- **Still browser-incomplete:** the remaining Day-1 modules + M17 debtor/deadline sub-flows (no seeded personas).
- **Day-1 code blockers demonstrated: 0** (F1/F2 are LOW, non-blocking).
- **Recommendation unchanged: `TECHNICAL MODULE CONDITIONAL GO`** — materially advanced (2 modules + all
  cross-cutting invariants now browser-proven); condition = complete the remaining modules' authenticated browser
  sign-off via §3 with domain personas. M42 remains `NO_GO`; Stage-7 G1–G4 unchanged; no production certificate.

---

# PART C — Final Day-1 browser campaign (session 2026-09-11)

Full detail: `FINAL_DAY1_BROWSER_ACCEPTANCE_REPORT.md`. Disposable PG (non-superuser `finapp_app` → real RLS),
production API + web; operator seeded personas (both scripts) and logged in privately per persona; SoD-preserving
gap roles were data-seeded to distinct existing personas (no new credentials, no universal persona); a
`treasury_reconciliation` entitlement was added for Tenant 1.

**Executed browser evidence (each cross-checked in DB + audit):**
- **M13 Cases → ACCEPTED:** create (`CASE_RECORD_CREATED`), party with contact **`[redacted]`** (`CASE_PARTY_ADDED`),
  **decision submit→approve with SoD** — `submitted_by=legal_officer`, `approved_by=legal_manager` (distinct)
  (`CASE_DECISION_SUBMITTED` + `CASE_DECISION_APPROVED`), activity (`CASE_ACTIVITY_CREATED`), lifecycle Open + two-step
  confirm (`CASE_RECORD_OPENED`).
- **M14 Legal Matters → PARTIALLY ACCEPTED (maker):** create, **cost `123456` exact minor units**, court event,
  pleading, appeal (all audited). Settlement-approve + close (checker) not driven.
- **M16 Litigation → PARTIALLY ACCEPTED (maker):** proceeding, witness, exhibit, order, bundle (all audited).
  Filing/bundle approve (SoD) + exhibit-admit not driven.
- **M19 Finance → PARTIALLY ACCEPTED:** accounting-entity create (`FIN_ENTITY_REGISTERED`); deactivate +
  fiscal-year/period **BLOCKED (automation)** — `type="date"` inputs + inline confirm did not populate/fire under the
  driver; no console error, no server rejection (not a product defect).
- **M12, M18, M20, M21, M22 → BLOCKED — not driven** (personas + gap roles provisioned; pending operator logins).

**Invariants live:** RBAC control visibility (maker sees create, checker doesn't), permission-denied fail-closed,
**real SoD** (M13 approve by a distinct identity), PII redaction (party + witness `[redacted]`), exact minor units,
two-step confirm, audit hash-chain (36/36 chained), no hard delete, no console errors, ADR-135 entitlement gating.

**0 Day-1 code defects → no code fix.** Recommendation stays **`TECHNICAL MODULE CONDITIONAL GO`**.
