# Module Functional-Completion Audit

> Verifies real end-to-end business functionality of every web-surfaced module. Method: clean local database
> integration run + smoke lane + full source trace of the web client and API controllers. The detailed grid is in
> `MODULE_CRUD_LIFECYCLE_MATRIX.md`; the outcome/implementation log is in
> `MODULE_FUNCTIONAL_COMPLETION_REPORT.md`. Branch `release/module-functional-completion` off `main` `ff4aec1`.

## 1. Headline finding

The user-observed defect — "the app displays modules but on some screens you cannot create/edit/delete" — is
**real and precisely located in the web layer**. It is **not** a backend gap:

- **Backend is functionally complete and proven.** A clean local run applied all **84 migrations** and passed the
  **DB integration lane: 98 specs / 3043 assertions / 0 failed**, plus the **smoke lane: 51 suites / 8080
  assertions / 0 failed**. This exercises create/read/update/lifecycle, **tenant isolation (RLS)**, **least-
  privilege grants**, **maker-checker/SoD**, and the **audit hash-chain** for every module. Every "missing" UI
  operation has a **working backend endpoint**.
- **The gaps are UI wiring.** On several screens the `app.tsx` React client renders reads and some lifecycle
  actions but does not wire the create/edit/sub-entity mutation — even though the `api.ts` client and the
  controller already exist. These are the screens where a user "can't create/edit."

## 2. What is genuinely working (verified backend; UI wired)

Full permitted lifecycle surfaced and wired: **m08** notifications inbox, **m12** feedback (capture→classify→
resolve(maker-checker)→confirm→close) + feedback setup, **m18** knowledge (submit→review→approve→publish→
withdraw), **m19** fiscal year + **chart-of-accounts/GL-account** (create/edit/activate/deactivate/archive),
**m21** journals (draft→validate→submit→approve→authorize-post, **no auto-post**), **m22** approvals inbox
(approve/reject/return/escalate, SoD), **m28** copilot (advisory, read-only by policy) + config, **m32** governed
analytics query, **m39** plans/versions/subscriptions (define→author→publish maker-checker; activate/suspend/
cancel), **m41** secrets lifecycle (define/activate/rotate/revoke/destroy + reveal-**authorization never
plaintext**) + GRC controls, **m02** identity & rbac core (create/lifecycle/assign/revoke).

Two documented "gaps" were found **stale (already implemented)**: m39 plan-version authoring and m41 secrets
lifecycle admin are both fully surfaced.

## 3. The real web gaps (ranked, backend proven-present)

**Tier-1 (pure UI wiring — `api.ts` client already exists):** m09 `createDocument`, m12 `addFeedbackActivity`,
m13 `triageCase`, m17 `advanceRecovery`, m18 `withdrawTemplate`, m28 `exportCopilotQuery`, m02-identity
`updateIdentity` edit.

**Tier-2 (small `api.ts` wrapper + UI; backend exists):** m19 **accounting-entity** admin (a UI **dead-end** —
the app tells the user to "register one in Finance configuration first" but no such control exists), m19
**fiscal-period** create, m17 **recovery-case create**, m20 **recon-run create / manual-match / GL-import
upload**, legal sub-domains (m13 decisions/tasks, m14 court-events/pleadings/costs/appeal, m16 witnesses/exhibits/
orders/bundles, m18 clauses/taxonomy), m32 analytics definition authoring, m08 template/escalation admin, m22
delegation/policy admin.

## 4. Correct lifecycle / retention posture (Phase-3) — already satisfied by design

- **No unrestricted hard delete anywhere.** There is **no `@Delete` route in any controller**. Teardown is
  archive/close/withdraw/retire/revoke/destroy/tombstone — verified by the DB lane's negative-privilege
  assertions (app role holds no DELETE; history tables reject UPDATE/DELETE).
- **Financial/transaction records:** journals never auto-post; posting is a separate authorised action; reversal/
  cancellation via governed transitions. **Legal matters/litigation/legal-docs:** archive/close/withdraw with
  reason + audit; no destructive delete. **Feedback:** close/reopen (controlled); no delete. **Users:**
  deactivate/suspend/close, never delete. **Roles:** retire, never delete; system roles immutable. **Audit
  logs:** append-only, permanently read-only. **Secrets:** metadata + rotate/revoke/destroy; **never reveal
  plaintext**. **Analytics/dashboards:** read + governed query.
- Destructive/lifecycle actions in the UI use a two-step arm→confirm control (`ActionButton`), permission-gated,
  with `danger` styling and a mandatory reason where required. **One hardening note:** a few plain sub-entity
  buttons (e.g. `removeCaseParty`) are single-click without the two-step confirm — a small UX-safety follow-up,
  not a security hole (still permission-gated + server-authoritative + audited).

## 5. Environmental status (honest; per the task's "report any environmental blocker")

- **Database / integration tests: RAN LOCALLY and PASS.** A throwaway PostgreSQL 15.2 cluster was stood up
  (binaries present locally); 84 migrations + 3043 DB assertions green. Authoritative CI is PostgreSQL 16; results
  are expected to match (identical schema/policies).
- **RLS caveat recorded:** the app must connect as a non-superuser role (`DATABASE_APP_ROLE=finapp_app` → `SET
  LOCAL ROLE`) for RLS to apply; a superuser connection bypasses RLS (an initial mis-set run produced 15 false
  cross-tenant failures, resolved by setting the role). Not a product defect.
- **Browser acceptance:** a local stack (API + web + seeded personas) and a connected Chrome are available; live
  persona-driven browser acceptance is being run for the implemented slice and recorded in the report. Full 8-
  persona × all-screens acceptance is a broader exercise tracked as remaining work — **no module is marked
  COMPLETE on code-trace alone.**
- **Production:** not touched. Staging: not redeployed. **M42 remains NO_GO.**

## 6. Scope decision (freeze reopening)

The observed defect authorises reopening the business-functionality freeze **only** for objectively missing/broken
workflows. This audit confirms the missing workflows are the **Tier-1/Tier-2 web-wiring gaps** above. Implementation
proceeds **narrowly** on those, smallest-and-most-verifiable first (Tier-1: client already exists), each with tests
and browser acceptance, on `release/module-functional-completion`. No unrelated features. No backend re-architecture
(backend is complete). No change to intentionally-read-only surfaces. No production/M42 change.
