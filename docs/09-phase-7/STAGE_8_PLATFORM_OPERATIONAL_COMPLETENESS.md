# Stage-8 — Platform Operational Completeness Sweep

> Rapid platform-wide audit of every implemented module (M01–M42) + the Stage-8 composition verticals
> (M43/M44/M45), classified by a traffic-light on **operational** coherence (usable CRUD/governed actions ×
> RBAC × RLS × audit × UI reachability). Base: `main` after PR #156 (M45 Compliance) merged — the sequence
> #152 Users & Access → #153 M43 Treasury → #154 m22 Approvals → #155 M44 Recovery → #156 M45 Compliance →
> **#157 M41 read-model** is all on `main`. **Open pre-merge (stacked): M19 Fiscal Calendar, then M21 Journals &
> Posting (this PR, based on the M19 branch).** Synthetic staging only. **No module is omitted.**
>
> This is an operational-completeness map, **not** a production GO and **not** a certification. Controls
> (RBAC/RLS/audit/maker-checker) are uniformly present in built modules — the gaps below are almost entirely
> **UI/workflow reachability**, not control violations.

## Legend
- **GREEN** — operationally complete: core workflow exposed + usable, RBAC/RLS/audit present.
- **AMBER** — backend complete, UI/workflow incomplete (canonical capability exists, user actions not exposed).
- **RED** — material functional/control gap OR dead/obsolete declaration.
- **BLUE** — framework/internal module that correctly has no ordinary business UI.

## Traffic-light inventory (44 module packages)

| Module | Purpose | Backend | UI | Class | Priority | Gap |
|---|---|---|---|---|---|---|
| m01-tenant | Tenancy control plane | ✅ | switcher only | BLUE | — | framework |
| m02-auth | Session/login | ✅ | login page | BLUE | — | framework |
| m02-identity | Identity/accounts/memberships | ✅ | **Users & Access** | GREEN | — | — |
| m02-rbac | Roles/permissions/assignments | ✅ | **Roles/Assignments** | GREEN | — | — |
| m03-audit | Audit spine (hash-chained) | ✅ | none | BLUE | P2 | no audit-viewer (framework) |
| m04-admin | Admin console orchestration | ✅ (services) | none (web uses m02 direct) | AMBER | P1 | orchestration is service-only (no controllers) |
| m05-hub | (intended hub) | ❌ README only | none | RED | P1(hygiene) | **obsolete** placeholder → renumbered m30 |
| m06-workflow | Workflow/SLA/**outbox** | ✅ | none | BLUE | — | framework |
| m07-rules | Versioned rules engine | ✅ | none | BLUE | — | framework |
| m08-notify | Notifications/escalation | ✅ | none | AMBER | P2 | no inbox/preferences UI |
| m09-docs | Documents/records | ✅ | none | AMBER | P2 | no document UI |
| m10-report | (intended reporting) | ❌ README only | none | RED | P1(hygiene) | **obsolete** → m32-analytics |
| m11-ai | (intended AI) | ❌ README only | none | RED | P1(hygiene) | **obsolete** → m24-m29 |
| m12-feedback | Feedback management | ✅ | none | AMBER | P2 | no feedback UI |
| m13-case | Case management | ✅ | **Legal → Cases** | GREEN(case slice) | P2 | lifecycle+parties+activities+links done; decisions/settlements/tasks/investigation not surfaced; **`partyContactAccessed` PII audit now wired** |
| m14-legal | Legal matters | ✅ | **Legal → Matters** | GREEN(matter slice) | P2 | matter lifecycle+positions/opinions/counsel/settlements(SoD)+from-case link done; court-events/pleadings/costs/appeal not surfaced; **`LEGAL_PARTY_CONTACT_ACCESSED` PII audit now wired** |
| m15-recon | Bank reconciliation | ✅ | none (superseded by m20) | AMBER | P1 | full API, **zero web consumers** (Treasury runs on m20) |
| m15a-matching | Deterministic matcher | ✅ (pure) | n/a | BLUE | — | internal engine |
| m16-litigation | Litigation cases | ✅ | none | AMBER | P2 | no UI |
| m17-recovery | Debt recovery | ✅ | **Recovery vertical** | GREEN | — | (deep CRUD = PR3) |
| m18-legaldocs | Legal knowledge library | ✅ | none | AMBER | P2 | no UI |
| m19-finance | GL accounts/periods/config | ✅ | **Finance → Fiscal Calendar (period controls)** | GREEN(calendar slice) | P2 | fiscal-year + period open/close/lock/reopen + history now operational; GL-account/config admin UI still pending |
| m20-glrecon | Bank↔GL reconciliation | ✅ | **Treasury vertical (+PR2 actions)** | GREEN | — | — |
| m21-journal | Draft journal engine | ✅ | **Finance → Journals workspace (draft→submit→posting→authorize)** | GREEN(workspace slice) | P2 | posting-result is evidence-only; external core-post deferred (m23/m33) |
| m22-approval | **Maker-checker/SoD engine** | ✅ | **NONE** | **RED** | **P0** | **no approver screen — every maker-checker loop dead-ends** |
| m23-finance-integration | Posting-integration record | ✅ (framework) | n/a | BLUE | — | intentional framework (ADR-096/101) |
| m24-ai-foundation | AI gateway/pipeline | ✅ (service) | none | BLUE | P2 | `/api/v1/ai` declared, unwired |
| m25-operational-ai | Operational AI suggest | ✅ (contract) | none | BLUE | P2 | recommend-only, no surface |
| m26-legal-ai | Legal AI | ✅ (contract) | none | BLUE | P2 | recommend-only |
| m27-finance-ai | Finance AI (no auto-post) | ✅ (contract) | none | BLUE | P2 | recommend-only |
| m28-executive-ai | Executive copilot | ✅ | none | AMBER | P1 | full copilot API, zero UI |
| m29-ai-governance | AI governance/waivers | ✅ (services) | none | AMBER→RED | P1 | **controls have no controllers** (unreachable) |
| m30-platform | Kernel/config/features | ✅ | none | BLUE | — | framework |
| m31-studio | Design-time authoring | ✅ | none | BLUE | — | framework |
| m32-analytics | Governed reporting | ✅ | none | AMBER | P1 | no reporting UI |
| m33-integration | Connector SDK | ✅ | none | BLUE | — | infra |
| m34-marketplace | Connector marketplace | ✅ | none | BLUE | P2 | optional curation UI |
| m35-devportal | Developer portal | ✅ | none | BLUE | — | developer-facing |
| m36-events | Webhooks/streaming | ✅ | none | BLUE | — | infra |
| m37-govrelease | Release governance | ✅ | none | BLUE | — | infra |
| m38-automation | Scheduler/automation | ✅ | none | BLUE | — | infra |
| m39-saas | Plans/subscriptions/entitlements | ✅ | **Administration → Plans & Subscriptions** | GREEN(admin slice) | P2 | plan-version authoring UI + usage/overrides/billing read models still pending |
| m40-resilience | Backup/observability | ✅ | none | BLUE | — | infra |
| m41-security | Secrets/privacy/DLP/GRC | ✅ | **Compliance vertical (GRC define+assess+read; Privacy/DLP/incident read model)** | AMBER→GREEN(compliance slice) | P2 | GRC + privacy/DLP/incident now operationally readable (RLS + RBAC); only **secrets** admin UI remains unbuilt (privileged maker-checker) |
| m42-certification | Certification programmes | ✅ | none | BLUE | — | internal governance runtime |

**Totals:** GREEN 4 · BLUE 20 · AMBER 16 · RED 4.

## Control-gap check
No RED **control** violations (no mutating endpoint without permission+audit; no tenant table without RLS FORCE)
were found in any *wired* controller across all 44 packages. The RED items are: one reachability P0
(m22-approval has no UI) and three **obsolete README-only placeholders** (m05/m10/m11, superseded by renumbered
modules). Every AMBER item is a UI/reachability gap over an intact, RBAC+RLS+audit-governed backend.

## P0 gaps (fix now)
1. **m22-approval — no actioning UI (THE top platform P0).** The decision API (`approve/reject/return/escalate/
   override`, SoD-enforced, audited) is complete, but there is no Approvals screen and no web client. Every
   maker-checker workflow dead-ends — including the Treasury journal *Propose adjustment* flow (PR2 surfaces the
   maker side; the checker side is unreachable). Highest-value single fix on the platform.

## P1 gaps (next)
- ~~m19-finance period close/reopen~~ **DONE (this PR)** — Fiscal Calendar UI: fiscal-year + period lifecycle.
- ~~m21-journal posting-request/authorize lifecycle no UI~~ **DONE (this PR)** — Finance → Journals workspace.
- ~~m39-saas entitlement/subscription/plan admin console~~ **DONE (this PR)** — Plans & Subscriptions admin +
  plan-version/entitlement read model. See **`STAGE_8_WEB_MODULE_COMPLETENESS.md`** for the full web-surface audit:
  the remaining P1 web gaps are the **Legal cluster** (m13/m14/m16/m18), **m32 analytics**, **m28 copilot**.
- m32-analytics reporting/dashboard UI.
- m41-security: GRC + privacy/DLP/incident now live on main (read model merged #157); only **secrets** admin UI
  remains (P2). This stacked branch merges main in, so all of it composes here too.
- m28-executive-ai copilot UI; m29-ai-governance **has no controllers** (wire or classify future).
- m04-admin orchestration is service-only; m15-recon superseded by m20 (retire or expose).
- **Hygiene:** m05-hub / m10-report / m11-ai are obsolete README placeholders → mark retired in the manifest.

## Role seeding + the platform_admin coverage gap (verified against the live staging DB)
Only two **system** roles are seeded — `platform_admin`, `tenant_admin` — plus tenant-custom roles created ad hoc
via the Users & Access UI (e.g. `treasury_officer_pr1`). No canonical **persona** role matrix (Treasury
Officer/Approver, Recovery Officer/Manager, Compliance Officer/Reviewer, Auditor, Restricted) is seeded.

**Verified platform_admin coverage (staging): 155 / 834 permissions (~19%).** A static-migration analysis
suggested ~7% and "cannot perform recovery/finance" — that is **wrong per live truth** (recovery works). The
real, verified picture: platform_admin is **curated to the Stage-8 surfaces** and has **zero** coverage of the
dark modules:
- **Full / near-full:** identity 20/20 · rbac 13/13 · tenant 19/19 · auth 2/2 · grc 3/3 · gl_reconciliation
  34/35 · recovery 55/58 · journals 9/27.
- **ZERO** (~29 namespaces): admin 0/30 · **approvals 0/25** · finance 0/45 · legal 0/70 · litigation 0/56 ·
  cases 0/56 · workflow 0/24 · notifications 0/21 · documents 0/27 · feedback 0/37 · saas 0/12 · analytics 0/12
  · ai 0/51 · security 0/8 · privacy 0/3 · reconciliation 0/29 (superseded m15) · rules 0/13 · and the infra set.

**Consequence (a real P1, and it gates the P0):** any new UI over a zero-coverage module 403s for platform_admin
until the matching permissions are granted. In particular **the m22-approval P0 UI is unusable until
`approvals.*` is granted to a role** — the approvals seed must ship *with* that PR. Fix shape: a staging
seed/reconciliation granting each module's permissions to the appropriate system/persona role (never a
wildcard), scoped per PR as each module's UI is exposed.

## Dead-declaration scan (verified highlights)
- **Read permissions declared, not enforced** (intentional given the read model — reads are gated by tenant
  membership + RLS, not per-resource permission): the `*.read`/`*.view`/`analyticsRead` family across ~18
  modules. Inert today; wire only if per-resource read authorization becomes a requirement.
- **Dead audit codes:** the 18 `m04-admin` codes are **obsolete duplicates** of codes m02-rbac/m06/m07/m08 own
  and emit → safe to delete. Genuine wiring gaps worth fixing: `partyContactAccessed` (**m13 now WIRED** — a
  contact reveal on `GET /cases/:id/parties` emits `CASE_PARTY_CONTACT_ACCESSED`; m14/m16/m17 still to do);
  event-without-audit pairs `RECOVERY_ARRANGEMENT_ACTIVATED` and
  `LITIGATION_SERVICE_COMPLETED`; `RECOVERY_CASE_SUSPENDED` (state + code exist, transition unwired). The rest
  (`exportRequested`, `slaBreached`, m06 compensation/timer, m03 retention/legal-hold) are intentional future.
- **Event families:** none dead — all 53 declared families are emitted/consumed.
- **Nav:** no orphans either direction; gating sound (entitlement for verticals, RBAC for Administration,
  fail-closed router, no wildcard). The `<main>` render switch is a hard-coded chain, so a new screen needs a
  code edit there (not a plugin registry) — acceptable, noted.

## Delivered so far
- **PR #152 (merged)** — Users & Access Administration (m02 identity/RBAC) → m02 GREEN.
- **PR #153 (merged)** — M43 Treasury operational actions (run execute/complete/reopen, match
  confirm/reject/unmatch, exception resolve/waive, import accept/reject) → m20 Treasury GREEN. Proven on staging:
  exception resolved (audited); run Complete **failed closed** ("1 required exception(s) still open").
- **PR #154 (merged)** — m22 Approvals inbox + reusable maker-checker UI → m22 P0 cleared.
- **PR #155 (merged)** — M44 Recovery operational actions (case lifecycle, take-ownership, arrangements
  +approve via canonical m17 SoD, demands, outcomes) → m17 GREEN (operational).
- **PR #156 (merged)** — M45 Compliance operational completion: canonical **Define control** (`POST
  /grc/controls`) + register search over the read/assess slice → GRC governed-complete to the canonical limit.
- **PR (open, pre-merge)** — M41 privacy/DLP/incident **read-model completion**: RLS-scoped, permission-gated
  `GET` endpoints (`privacy.policy.read` / `security.dlp.read`) + Compliance "Privacy & security" tabs. Closes
  the write-only backend gap; no mutation added. Proven on PG15 (m41-services 35 assertions: RLS + perm gating).
- **PR (this sweep, pushed, pre-merge)** — M19 **Finance → Fiscal Calendar**: fiscal-year (create/close/reopen)
  + accounting-period (open/close/lock-seal/reopen) + history, over the canonical m19 CalendarService. Entity
  from `GET /finance/entities`. Single-actor privileged controls (NOT maker-checker), expectedVersion, audited;
  lock is a terminal seal; posting-window gate m21 honours. Frontend-only (all m19 routes pre-existed).

## M45 Compliance — capability classification (canonical limit)
| Capability | Canonical HTTP | Classification |
|---|---|---|
| Controls — create | `POST /grc/controls` | **GOVERNED CRUD** (create only; perm+audit) |
| Controls — read/list/search | `GET /grc/controls` | **READ + ACTION** (client filter/search) |
| Controls — update/retire | none | **NOT EXPOSED / CANONICAL GAP** (no route; posture changes via assessments) |
| Assessments — record/history | `POST`/`GET .../assessments` | **APPEND-ONLY** |
| Evidence | `evidenceRef` on assessment | **APPEND-ONLY** (no standalone entity) |
| Findings | none (only DLP-scan findings, table-only) | **NOT EXPOSED / BACKEND GAP** |
| Remediation | none | **NOT EXPOSED** (no canonical concept) |
| Privacy (classifications/records) | `GET`/`POST` classifications, records | **READ-ONLY** (list/detail; records append-only, opaque subject ref) ✅ *gap closed* |
| Security incidents / DLP policies | `GET`/`POST` incidents, dlp/policies, dlp/findings | **READ-ONLY** (findings append-only evidence) ✅ *gap closed* |
| Review / certification | m42 (separate module, consumes GRC by contract) | **NOT EXPOSED here** (out of M45 scope) |

Note: there is **no self-certification path** in GRC at all — an assessment is append-only evidence of control
state, never a regulator certification; the UI renders control/assessment **state** and never "Compliant" as a
blanket verdict. **The privacy/DLP/incident BACKEND GAP is now CLOSED** (this PR): RLS-scoped, permission-gated
(`privacy.policy.read` / `security.dlp.read`) `GET` read models added at repository→service→controller, surfaced
as the Compliance **Privacy & security** tabs. No mutation was added; DLP findings + privacy records stay
append-only. Remaining m41 UI gap: the **secrets** lifecycle admin (privileged maker-checker) has no screen.

## M19 Finance Fiscal Calendar — capability classification
| Capability | Canonical HTTP | Classification |
|---|---|---|
| Fiscal years | `POST fiscal-years` (+`/close`,`/reopen`), `GET fiscal-years` | **GOVERNED CRUD** (create + close/reopen; perm+version+audit; no delete) |
| Accounting periods | `POST fiscal-years/:id/periods` (+period `/close`,`/lock`,`/reopen`), `GET .../periods`, `GET periods/:id` | **GOVERNED CRUD** (open/close/lock/reopen state machine; lock = terminal seal) |
| Period history | `GET periods/:id/history` | **READ-ONLY / APPEND-ONLY** (canonical transitions) |
| Posting-period enforcement | m21 `posting.service` reads period status | **READ + ACTION (cross-module)** — m21 blocks submit/prepare/authorize when period ≠ open (ADR-078) |
| Finance config / entity selection | `GET finance/entities` | **READ + ACTION** (entity picker; register/activate is existing m19 config, not this PR) |

Note: period transitions are **single-actor privileged controls** (distinct `finance.period.*` permissions +
expectedVersion + audit), **not** maker-checker — dual-control lives in m21 posting (authorizer ≠ requester).
The M19 UI deliberately does **not** route through M22.

## M21 Journals & Posting — capability classification
| Capability | Canonical HTTP | Classification |
|---|---|---|
| Journal drafts | `POST/GET drafts`, `drafts/:id/edit` | **GOVERNED CRUD** (create/edit while mutable; no delete) |
| Journal lines | `drafts/:id/lines`, `lines/:id/{update,remove}` | **GOVERNED CRUD** (add/edit/remove while draft mutable) |
| Validation | `drafts/:id/validate`, `GET .../validations` | **READ + ACTION** (deterministic; balance/debits/credits) |
| Submission / withdrawal | `drafts/:id/{submit,withdraw}` | **READ + ACTION** (submit→m22; withdraw needs reason) |
| Posting requests | `drafts/:id/posting-requests`, `.../{authorize,cancel}` | **GOVERNED CRUD** (prepare/authorize/cancel; period-gated) |
| M22 approval | reuses `/approvals` inbox (subjectType `journal_posting`) | **READ + ACTION** (checker path; maker ≠ checker, SoD) |
| Authorisation | `posting-requests/:id/authorize` (approvalRef+approvedBy) | **READ + ACTION** (records opaque m22 ref; SoD DB CHECK; period open) |
| Posting results | `posting-requests/:id/results` | **APPEND-ONLY** (evidence; external core-post deferred m23/m33) |
| Cancellation | `posting-requests/:id/cancel` | **READ + ACTION** (reason required) |
| Reversal / void | none | **NOT EXPOSED** (no canonical route; corrections = new adjusting journals) |

## M39 Subscription/Entitlement — assessment (read-only, next after M21)
- **Readable now:** `GET plans`, `GET plans/:id`, `GET subscriptions`, `GET quota/check`, `GET entitlements/check`.
- **Write, no read:** plan **versions**, version **entitlements**, **quota-policies**, **usage**, **overrides**,
  **billing-cycles** — a **BACKEND GAP** (create/validate/publish exist; no GET to list them back).
- **UI today:** only the entitlement self-check is wired; no plan/subscription admin screen.
- **Recommended next PR (M39a, frontend):** Subscriptions admin (list + activate/change-plan/suspend/cancel/renew)
  + Plans list/detail/create + quota/entitlement self-check display. **M39b (backend read-model, like M41):** add
  RLS-scoped GETs for versions/entitlements/quota-policies/usage/overrides before a full plan-version admin UI.

## Recommended PR sequence
- ~~PR3 — M44 Recovery~~ **merged (#155).** · ~~PR4 — M45 Compliance~~ **merged (#156).** · ~~M41 read-model~~ **merged (#157).**
- **PR5 — Platform P0: m22-approval actioning UI** — **merged (#154).**
- **M19 Fiscal Calendar** → **M21 Journals** → **M39 Plans & Subscriptions** (this PR) — stacked, pre-merge.
- **NEXT (per `STAGE_8_WEB_MODULE_COMPLETENESS.md`) — the Legal cluster** (m13-case/m14-legal/m16-litigation/
  m18-legaldocs: a new Legal nav group), then **m32 analytics/reporting**, then **m28 copilot**, then P2
  (notify/docs/feedback, m19 config slice, m41 secrets, m39 plan-version authoring) + manifest hygiene m05/m10/m11.

## Verdicts (per the completeness gate)
- **READY:** m02-identity, m02-rbac, m17-recovery, m19-finance (calendar), m20-glrecon, m21-journal (workspace), m41-security (compliance read model).
- **READY WITH LIMITATION:** m32, m39 (backend governed; admin UI pending).
- **FRAMEWORK ONLY:** m01, m02-auth, m03, m06, m07, m15a, m23-m27, m30, m31, m33-m38, m40, m42.
- **CLEARED (was NOT READY):** m22-approval P0 — Approvals UI merged (#154). **OBSOLETE:** m05, m10, m11.
