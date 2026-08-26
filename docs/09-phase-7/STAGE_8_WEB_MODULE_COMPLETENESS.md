# Stage-8 — Web-Surface Module Completeness

> Every implemented module classified by whether it has an appropriate **web surface**. Companion to
> `STAGE_8_PLATFORM_OPERATIONAL_COMPLETENESS.md` (which scores backend/control completeness); this scores
> **UI reachability**. Verified against `apps/web/src/{app.tsx,api.ts}` and `apps/api/src/**/*.controller.ts`.
> Synthetic staging only. **No module is omitted.** This is not a production GO.

## Classification legend
- **WEB READY** — a usable operational/admin/reporting screen exists, permission- and (where applicable)
  entitlement-gated, backend-authoritative.
- **WEB READY WITH LIMITATION** — a real screen exists but a meaningful slice of the canonical surface is not yet
  surfaced (documented, with a concrete follow-up).
- **FRAMEWORK ONLY** — correctly has no ordinary business UI (kernel/infra/engine/AI-contract/obsolete-placeholder).
- **NOT WEB READY** — a business-facing module with a real, tested backend but **no usable web surface**. These
  are the genuine gaps.

## Branch note (important)
This report is written from the **M39 branch stacked on M19 → M21**, which was branched off `main` *before* PR
**#157 (M41 privacy/security read-model)** merged. The M41 privacy/DLP/incident **"Privacy & security"** tabs are
therefore absent from *this branch's* build but **present on `main`** (merged #157) — they are classified
**WEB READY** here on that basis, and reappear once this stack merges up. Likewise M19/M21/M39 in this table are
pre-merge on their stacked branches.

## Module inventory (44 packages + Stage-8 verticals)

| Module | Purpose | Web surface | Verdict |
|---|---|---|---|
| m01-tenant | Tenancy control plane | Tenant switcher only | FRAMEWORK ONLY |
| m02-auth | Session / login | Login page | FRAMEWORK ONLY |
| m02-identity | Identities / accounts / memberships | **Users & Access** | **WEB READY** |
| m02-rbac | Roles / permissions / assignments | **Roles & Assignments** | **WEB READY** |
| m03-audit | Hash-chained audit spine | none | FRAMEWORK ONLY |
| m04-admin | Admin console orchestration | none (web uses m02 direct) | FRAMEWORK ONLY |
| m05-hub | obsolete placeholder | none | FRAMEWORK ONLY (obsolete → m30) |
| m06-workflow | Workflow / SLA / outbox | none | FRAMEWORK ONLY |
| m07-rules | Versioned rules engine | none | FRAMEWORK ONLY |
| m08-notify | Notifications / escalation / inbox | **Notifications inbox** | **WEB READY** (inbox read + one-way mark-read, preferences, delivery evidence, template viewer) |
| m09-docs | Documents / records | **Documents workspace** | **WEB READY WITH LIMITATION** (metadata + governance — classification, legal hold, disposition maker-checker, versions, relationships, catalog — fully operational; byte upload/download is framework-only on staging, no object store bound) |
| m10-report | obsolete placeholder | none | FRAMEWORK ONLY (obsolete → m32) |
| m11-ai | obsolete placeholder | none | FRAMEWORK ONLY (obsolete → m24-29) |
| m12-feedback | Feedback management + setup | **Customer Service → Feedback Management + Feedback Setup** | **WEB READY** (operational FMS lifecycle capture→classify→resolution(maker-checker)→confirmation→close + M13 case-handoff + analytics dashboard; **Feedback Setup** admin now surfaces questionnaire/category/SLA-policy/source-system lifecycle with RLS-scoped list routes + read/manage separation. Honest backend notes, NOT web gaps: config lifecycle uses a single `.manage` per object — no maker-checker SoD for setup; category is not runtime-enforced in classify (free-text). Source-system UI exposes no credentials — none are modelled) |
| m13-case | Case management + decisions | **Legal → Cases** | **WEB READY WITH LIMITATION** (case lifecycle + parties + activities + links done; decisions/settlements/tasks/investigation not surfaced) |
| m14-legal | Legal matters | **Legal → Matters** | **WEB READY WITH LIMITATION** (matter lifecycle + positions/opinions/counsel + settlements SoD + from-case link done; court-events/pleadings/costs/appeal not surfaced) |
| m15-recon | Legacy bank recon | none (superseded by m20) | FRAMEWORK ONLY |
| m15a-matching | Deterministic matcher | n/a (pure) | FRAMEWORK ONLY |
| m16-litigation | Litigation proceedings | **Legal → Litigation** | **WEB READY WITH LIMITATION** (proceeding lifecycle + filings maker-checker + hearings/service + from-matter link done; witnesses/exhibits/orders/bundles not surfaced) |
| m17-recovery | Debt recovery lifecycle | **Recovery + Recovery cases** | **WEB READY** |
| m18-legaldocs | Legal knowledge library | **Legal → Legal Documents** | **WEB READY WITH LIMITATION** (knowledge editorial lifecycle + templates maker-checker + authorities/precedents read done; clauses/opinions/research/taxonomy admin + m09 file link not surfaced) |
| m19-finance | Fiscal calendar / periods / entities | **Finance → Fiscal calendar** | **WEB READY WITH LIMITATION** (GL-account/chart/config admin not surfaced) |
| m20-glrecon | Bank↔GL reconciliation | **Treasury (recon/accounts/exceptions/reports)** | **WEB READY** |
| m21-journal | Draft journal + posting engine | **Finance → Journals** | **WEB READY** |
| m22-approval | Maker-checker / SoD engine | **Approvals inbox** | **WEB READY** |
| m23-finance-integration | Posting-integration record | none | FRAMEWORK ONLY |
| m24-ai-foundation | AI gateway / pipeline | none | FRAMEWORK ONLY |
| m25-operational-ai | Operational AI (recommend-only) | none | FRAMEWORK ONLY |
| m26-legal-ai | Legal AI (recommend-only) | none | FRAMEWORK ONLY |
| m27-finance-ai | Finance AI (no auto-post) | none | FRAMEWORK ONLY |
| m28-executive-ai | Executive copilot (`/copilot`) | **Executive → Copilot** | **WEB READY** (grounded advisory: query→response+citations grounded in the live M32 Feedback adapter; read-only/no-execution boundary server-enforced) |
| m29-ai-governance | AI governance / waivers | none (no controllers) | FRAMEWORK ONLY (unwired) |
| m30-platform | Kernel / config / features | none | FRAMEWORK ONLY |
| m31-studio | Design-time authoring | none | FRAMEWORK ONLY |
| m32-analytics | Governed reporting (`/analytics`) | **Reporting → Analytics & Reports** | **WEB READY WITH LIMITATION** (datasets/metrics/reports + governed query with one REAL Feedback adapter live; other domains adapter-pending m33) |
| m33-integration | Connector SDK | none | FRAMEWORK ONLY |
| m34-marketplace | Connector marketplace | none | FRAMEWORK ONLY |
| m35-devportal | Developer portal | none | FRAMEWORK ONLY (dev-facing) |
| m36-events | Webhooks / streaming | none | FRAMEWORK ONLY |
| m37-govrelease | Release governance | none | FRAMEWORK ONLY |
| m38-automation | Scheduler / automation | none | FRAMEWORK ONLY |
| m39-saas | Plans / subscriptions / entitlements | **Administration → Plans & Subscriptions** (this PR) | **WEB READY WITH LIMITATION** (version create/publish + usage/overrides/billing admin not surfaced) |
| m40-resilience | Backup / observability | none | FRAMEWORK ONLY |
| m41-security | Secrets / privacy / DLP / GRC | **Compliance (GRC) + Privacy & security (on main, #157)** | **WEB READY WITH LIMITATION** (secrets lifecycle admin not surfaced) |
| m42-certification | Certification programmes | none | FRAMEWORK ONLY |

## Summary counts (after M12 Feedback Setup)
- **WEB READY**: m02-identity, m02-rbac, m17-recovery, m20-glrecon, m21-journal, m22-approval, **m08-notify**, **m28-executive-ai**, **m12-feedback** (9).
- **WEB READY WITH LIMITATION**: m19-finance, m39-saas, m41-security, m13-case, m14-legal, **m16-litigation**,
  **m18-legaldocs**, **m32-analytics**, **m09-docs** (9).
- **NOT WEB READY (genuine gaps)**: NONE — every business-facing module now has a web surface (Stage-8 web-surfacing programme complete). Remaining follow-ups are admin/setup slices + real storage/adapter bindings, tracked per-module above.
- **FRAMEWORK ONLY**: the remaining 26 (kernel/infra/engine/AI-contract/obsolete).

## Next admin/setup surface — ranked recommendation (after M12 Feedback Setup)
The web-surfacing programme is complete; remaining work is admin/setup slices behind already-WEB-READY modules.
Ranked by user value × backend-readiness × isolation risk:
1. **M19 Finance config (GL account / chart-of-accounts admin)** — highest value: Journals + GL-recon are live
   but the chart of accounts / posting config has no authoring UI, so account setup is API-only today. Backend
   is real and RLS-scoped; adds a Finance → Accounts setup surface. **Recommended next.**
2. **M39 plan authoring (version create → publish lifecycle)** — Plans & Subscriptions lists exist but new plan
   versions can't be authored in the UI. Bounded lifecycle mirroring the M12 setup pattern; low risk.
3. **M41 secrets lifecycle admin** — sensitive: must surface metadata/rotation state ONLY, never secret material
   (mirror the credential-free discipline used for feedback source systems). Needs careful redaction review.
4. **Deeper legal admin** (M14 court-events/pleadings, M16 witnesses/exhibits/orders, M18 clauses/taxonomy) —
   several WITH-LIMITATION legal modules; individually smaller, collectively large. Sequence after finance.

Recommendation: take **M19 Finance config** next — it unblocks real account setup for the already-live Journals
and GL-reconciliation surfaces and follows the same repository→service→controller→bounded-DTO list-route pattern
proven here, with strong maker-checker/SoD already in the finance engine (unlike M12 setup's single-permission
config lifecycle).

## Global Stage-8 web-navigation smoke (current composed branch: main+M41 + M19 + M21 + M39 + M13)
Verified by source-level composition (nav item + route dispatch + api client wired + RBAC/entitlement gate). No
BROKEN screens. Live browser run not executed (no live stack this turn — see "Staging visibility truth" below).

| Screen | Nav | Route | API wired | RBAC | Entitlement | Verdict |
|---|---|---|---|---|---|---|
| Users & Access | ✓ | ✓ | ✓ (`/identities`,`/accounts`,`/tenant-memberships`) | identity.* | — (RBAC group) | READY |
| Roles & Permissions | ✓ | ✓ | ✓ (`/rbac`) | rbac.* | — | READY |
| Access Assignments | ✓ | ✓ | ✓ (`/rbac`) | rbac.assignment.* | — | READY |
| Treasury / Reconciliation | ✓ | ✓ | ✓ (`/gl-reconciliation`) | gl_reconciliation.* | treasury_reconciliation | READY |
| Approvals | ✓ | ✓ | ✓ (`/approvals`) | approvals.request.read | — | READY |
| Recovery | ✓ | ✓ | ✓ (`/recovery`) | recovery.* | debt_recovery | READY |
| Compliance / GRC | ✓ | ✓ | ✓ (`/grc`) | grc.* | regulatory_compliance | READY |
| Privacy / Security / DLP | ✓ | ✓ | ✓ (`/privacy`,`/security`) | privacy.policy.read / security.dlp.read | regulatory_compliance | READY |
| Finance → Fiscal Calendar | ✓ | ✓ | ✓ (`/finance`) | finance.{period,fiscal_year,entity}.read | — (RBAC group) | READY |
| Finance → Journals | ✓ | ✓ | ✓ (`/journals`,`/approvals`) | journals.* | — | READY |
| Administration → Plans & Subscriptions | ✓ | ✓ | ✓ (`/saas`) | saas.{plan,subscription}.* | — | READY |
| Legal → Cases | ✓ | ✓ | ✓ (`/cases`) | cases.* | — (RBAC group; `legal_services` entitlement is the future option) | READY WITH LIMITATION |

**Zero BROKEN.** Every completed Stage-8 business-facing screen composes and renders on this branch. The one
WITH-LIMITATION (Cases) reflects the un-surfaced deeper case sub-domains (decisions/settlements/tasks), not a
reachability defect.

## Genuine web gaps — ranked for the next bounded PRs
**P1 (high-value operational surfaces, full backends, zero UI):**
1. **Legal cluster — COMPLETE**: m13-case + m14-legal + m16-litigation on main; **m18-legaldocs (this PR)** =
   Legal → Legal Documents. The Legal group is now Cases + Matters + Litigation + Legal Documents — the full legal
   workspace with the case→matter→proceeding referral chain plus the knowledge/template library. Next web P1 gaps:
   **m32-analytics**, **m28-executive-ai**; P2: m08-notify, m09-docs.
2. **m32-analytics** — reporting/dashboard (`analytics/definitions`, `analytics/runtime`); no UI at all.
3. **m28-executive-ai** — executive copilot (`copilot/*`, full API); no entry point.

**P2 (workspace/communications surfaces):**
4. **m08-notify** — notification inbox / preferences / template admin.
5. **m09-docs** — document list / access UI.
6. **m12-feedback** — feedback capture / triage.
7. **m19-finance config slice** — GL-account master + chart-of-accounts + finance config (calendar slice done).
8. **m41-security secrets** — secrets lifecycle admin (privileged maker-checker; sensitive).
9. **m39-saas plan-version authoring** — create version / add entitlement / add quota / validate / publish UI
   (reads now exist post-this-PR; authoring UI is the follow-up), plus usage/overrides/billing-cycle read models.

## Navigation groups
Current (coherent, all populated): **Overview, Treasury, Recovery, Finance, Compliance, Approvals,
Administration**. Recommended additions once their UIs are built: **Legal** (m13/m14/m16/m18), **Reporting**
(m32), **Copilot** (m28). Gating stays: entitlement for commercial verticals, RBAC for platform/admin
capabilities, fail-closed router, backend authoritative.

## Web-readiness verdict
The platform is **NOT yet web-complete**: 9 business-facing modules with real backends have no web surface (Legal
×4, Analytics, Copilot, Notify, Docs, Feedback). Every one is explicitly listed above with a ranked follow-up —
none is silently backend-only. The finance/commercial/compliance/recovery/treasury/identity spine **is** web-ready
(with the documented limitations). Recommended next: the **Legal cluster** (largest gap), then Analytics, then
Copilot.
