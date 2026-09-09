# Tier-2 Wave-2 Legal Workflows — Completion Report

> Completes UI-to-API-to-DB workflows for existing M13/M14/M16/M18 legal-domain sub-record contracts. Reuses
> existing backend contracts (no new endpoints, no new migrations). **No production deployment. M42 remains
> NO_GO. G1–G4 unchanged.** Companion: `TIER2_WAVE2_BROWSER_ACCEPTANCE_CHECKLIST.md`.

## 1. Starting SHA
`67e0802c47e895cf5daa86b8d7c2a384798b6ff2` (baseline verified: deps · format · typecheck · smoke 8080/0 · build).

## 2. Branch & final SHA
`release/tier2-wave2-legal-workflows` off `67e0802`. Final SHA: the docs commit that adds this report (last in §3).

## 3. Commits created
- `09b5946` feat(web/m13): case decisions, tasks, activity-complete
- `a064d0e` feat(web/m14): matter court-events, pleadings, costs, appeal
- `0607916` feat(web/m16): litigation witnesses, exhibits, orders, obligations, bundles
- `c95f7a1` feat(web/m18): template create, clauses lifecycle, taxonomy
- `ea3e272` test(api): HTTP coverage for Wave-2 legal sub-records (M13/M14/M16)
- (this) docs(tier2): Wave-2 report + browser checklist + matrix/report updates

## 4. Files changed
`apps/web/src/app.tsx` (M13 CaseDrawer, M14 MatterDrawer, M16 ProceedingDrawer, M18 LegalDocsWorkspace);
`apps/web/src/api.ts` (new sub-record clients); `apps/api/test/{api-cases,api-legal,api-litigation}.db-spec.ts`;
`docs/build/*`.

## 5. M13 workflow status — Case Management: **WIRED**
- **Decisions:** submit (`cases.decision.submit`) + a DISTINCT approver approves (`cases.decision.approve`, SoD
  enforced server-side + DB CHECK; approve only on `submitted`). Audit `CASE_DECISION_SUBMITTED`/`_APPROVED`.
- **Tasks:** create (`cases.task.manage`) + complete (expectedVersion). Audit `CASE_TASK_CREATED`/`_COMPLETED`.
- **Activities:** create (already worked) + a new Complete control (`cases.activity.complete`, expectedVersion,
  `CASE_ACTIVITY_COMPLETED`). Triage/parties preserved; no M12-feedback duplication.
- **Not modelled (reported, not invented):** decision reject-over-HTTP; task assign/reopen/close/escalate (states
  exist in schema but no endpoint) — surfaced in-UI as unavailable.

## 6. M14 workflow status — Legal Matters: **WIRED**
- **Court events:** schedule + complete (`legal.court_event.manage`, expectedVersion on complete). Audit
  `LEGAL_COURT_EVENT_SCHEDULED`/`_COMPLETED`.
- **Pleadings:** register (draft) + file (draft/ready→filed, expectedVersion, court stamp). Audit
  `LEGAL_PLEADING_REGISTERED`/`_FILED`; filed-document history preserved.
- **Legal costs:** record references only — **exact integer minor units, no ledger/posting/payment** (ADR-063),
  append-only. `legal.cost.manage` (privileged); audit `LEGAL_COST_RECORDED`. **Edit/approve/void absent by
  domain** — none offered (INTENTIONALLY_READ_ONLY after record).
- **Appeal:** update inline matter appeal fields (status/forum/deadline, expectedVersion). `legal.appeal.manage`
  (privileged); audit `LEGAL_APPEAL_INITIATED`. **Free-form per domain (no appeal state machine)** — noted.
- Lifecycle (assign/reassign/close/reopen/archive) already WORKING; standalone priority/risk update is absent.

## 7. M16 workflow status — Litigation: **WIRED**
- **Witnesses:** add (`litigation.witness.manage`). Contact is **redacted server-side** unless
  `litigation.witness_contact.read`; UI cautions against unnecessary personal data. Audit `LITIGATION_WITNESS_ADDED`.
  Withdraw/deactivate **not modelled** (no column/op) — not faked.
- **Exhibits:** register + single-winner admit/reject/withdraw (`litigation.exhibit.manage`; re-decide → 409).
  Audit `LITIGATION_EXHIBIT_REGISTERED`/`_ADMITTED`. Chain-of-custody **not modelled** — not faked.
- **Court orders:** record append-only (`litigation.order.manage`, privileged) + compliance **obligations**
  create/complete/breach (`litigation.compliance.manage`). Audit `LITIGATION_ORDER_RECORDED`, `COMPLIANCE_*`.
  Order edit/escalate **not modelled**.
- **Bundles:** create + maker-checker approve (SoD) + file + add-item, correct expectedVersion. **add-item is
  UI-locked once approved/filed** (backend has no state guard — the caveat is enforced client-side). Audit
  `LITIGATION_BUNDLE_CREATED`/`_APPROVED`/`_FILED`. remove/reorder/finalize-lock/supersede **absent** — not faked.
- **Hearing preparation** is modelled via reference fields on create (no standalone endpoint) — NOT_APPLICABLE.

## 8. M18 workflow status — Legal Documents: **WIRED (with a documented domain gap)**
- **Template create:** "+ New template" (`legaldocs.template.manage`, draft, audit `LEGALDOC_TEMPLATE_CREATED`).
  Tier-1 withdraw preserved.
- **Clauses:** Clauses tab — create (draft) + maker-checker submit/approve(SoD)/publish + reason-gated withdraw
  (`legaldocs.clause.*`). Content is an opaque m09 ref only (never inline/secret text); published edits need a new
  version; no hard delete.
- **Taxonomy:** Taxonomy tab — create (code unique per tenant+kind, 409 on dup) + soft retire
  (`legaldocs.taxonomy.manage`).
- **Composition + mandatory-clause validation: DO NOT EXIST in the m18 domain** (no table/endpoint/service). Per
  the "do not manufacture unsupported legal processes" rule, these are **NOT implemented** and are stated in-UI as
  not modelled. Taxonomy retire has **no server dependency guard** (UI caution only).

## 9. Existing contracts reused
All of the above endpoints already existed server-side (controllers + services + migrations + audit + RLS). Work
was adding `api.ts` clients + drawer/tab UI + tests. No backend logic added.

## 10. New endpoints or migrations
**None.** No schema change; no new route. (Composition/mandatory-validation would be net-new backend and were
deliberately not built.)

## 11. Permissions and audit controls
No new permissions or audit codes. Server-authoritative RBAC on every op (literal codes in §5–§8), plus
frontend gating. SoD preserved where the domain enforces it (case decisions, bundle approve, clause/template
approve). RLS FORCE + `tenant_isolation` on every touched table (verified). Optimistic concurrency
(expectedVersion) on every versioned op. No hard delete anywhere.

## 12. Tests with exact results
- web typecheck ✅ · prettier ✅ · vite build ✅.
- **DB integration lane** (disposable local PG, 84 migrations, `DATABASE_APP_ROLE=finapp_app`): **98 specs, 3065
  assertions, 0 failed** (+15). New HTTP assertions: api-cases (task create+complete, activity complete), api-legal
  (court-event schedule+complete, pleading register+file, cost record + anon-401, appeal update), api-litigation
  (witness add, exhibit register+admit + single-winner-409, order record, bundle create+item + preparer-self-
  approve SoD-409). M18 template+clause already HTTP-covered; taxonomy service-lane covered.
- **smoke lane**: 51 suites, **8080 assertions, 0 failed**.

## 13. Browser acceptance status
**OPEN.** Unauthenticated boot passes; authenticated persona walkthrough is a human step (password entry is
policy-restricted for the agent). The `seed-personas` FK fix from Wave-1 keeps personas seedable. Follow
`TIER2_WAVE2_BROWSER_ACCEPTANCE_CHECKLIST.md`. No module is promoted to strict COMPLETE until a human performs it.

## 14. Intentionally read-only / not-modelled operations
Legal costs after record (no edit/approve/void — ADR-063 references-only); court orders (append-only); witness
contact (view-layer redaction only); exhibit chain-of-custody (column exists, no op); M18 clause/template content
(opaque m09 ref, immutable when published — new version required); authorities/precedents (read registries).

## 15. Remaining legal-domain gaps (backend-absent — would be net-new work, not wiring)
Decision reject; task assign/reopen/escalate; matter priority/risk standalone update; witness withdrawal; exhibit
chain-of-custody trail; order edit/escalate; bundle remove/reorder/finalize-lock/supersede; **template-clause
composition + mandatory-clause validation**; taxonomy retire-dependency guard; server-side fiscal-period overlap
(Wave-1 carryover). Each is reported, not invented.

## 16. Remaining non-legal Tier-2 work
M20 split/many-to-many matching + source-import + reconciling-items + HTTP lane (Wave-1 follow-ups); M32 analytics
authoring; M08 template/escalation admin; M22 delegation/policy admin; M21 journal header edit; M02-rbac
role-attribute edit; recovery debtor/owner/deadline capture; sub-entity confirm hardening.

## 17. No legal-evidence hard delete introduced
Confirmed. No `@Delete` route added or called anywhere. Every teardown/lifecycle op is a status transition
(withdraw/supersede/retire/archive/complete/breach) that preserves evidentiary history; exhibits/orders/bundles/
pleadings/costs are append-only or transition-only.

## 18. M42 status
**NO_GO — unchanged.** No production-readiness claim; no deploy; no merge; G1–G4 assurance statuses untouched.

## 19. Exact next action
1. A human runs the Wave-2 authenticated persona walkthrough (`TIER2_WAVE2_BROWSER_ACCEPTANCE_CHECKLIST.md`),
   promoting each workflow to WORKING on pass.
2. Then push `release/tier2-wave2-legal-workflows` and open a PR (no merge/deploy until review). Keep M42 NO_GO
   until Stage-7 assurance closes.
