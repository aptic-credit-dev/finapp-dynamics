# Project Index — Finapp Dynamics

This index maps the handover package and the full module inventory. All counts are drawn from the in-session
reference implementation and are the baseline a rebuilt repository should reach.

## Package map

| Path | Purpose |
|---|---|
| `README.md` | What the project is, status, MVP, repo init, workflow |
| `CLAUDE.md` | Claude Code operating instructions |
| `PROJECT_INDEX.md` | This index |
| `DECISIONS_AND_ASSUMPTIONS.md` | Approved decisions + working assumptions |
| `OPEN_QUESTIONS.md` | Unresolved questions needing a business owner |
| `HANDOVER_REPORT.md` | Final handover report + GO recommendation |
| `docs/00-executive/` | Executive overview, product vision, delivery roadmap |
| `docs/01-architecture/` | Blueprint, dependency map, shared-service ownership, boundaries, ADRs |
| `docs/02-product/` | MVP PRD, MVP scope, roles, journeys, screens |
| `docs/03-platform/` | SaaS foundation, auth/tenancy/RBAC, shared services, Phase 6 platform, security/GRC |
| `docs/04-modules/` | Feedback, Case, Legal, Recovery, Bank Recon, GL Recon, Journal |
| `docs/05-ai/` | AI foundation, Operational/Legal/Finance AI, Executive Copilot |
| `docs/06-data-and-contracts/` | DB schema, API, event, permission, audit-code, integration catalogues |
| `docs/07-engineering/` | Backlog, build sequence, release gates, database conventions, test/UAT/migration strategy |
| `docs/08-prompts/` | Build-orchestration + stage prompts + module-build index |
| `docs/09-phase-7/` | Vertical solutions foundation + portfolio |
| `manifests/` | Machine-readable manifest + module/API/event/permission/audit-code registries + naming map |

## Code (Stage 0 — implemented)

| Location | What |
|---|---|
| `packages/kernel/` | DI tokens (DB, AUDIT, AUTHZ, OUTBOX), RequestContext, ProblemError, `@Endpoint`, ambient-transaction `Db` |
| `packages/contracts/` | The typed domain-event union — empty at Stage 0, appended to per module |
| `packages/m*/` | Placeholder READMEs. No code until the owning stage is approved. |
| `apps/api/` | NestJS host under `/api/v1` (ADR-008). Health only. |
| `apps/web/` | Framework-free shell — stack undecided (OPEN_QUESTIONS.md #17) |
| `tools/migrate/` | Migration runner + the RLS convention sample and its proof |
| `tools/test-runner/` | PURE smoke harness + DB integration lane |

**`docs/07-engineering/DATABASE_CONVENTIONS.md` is required reading before any schema work** — it carries the
tenant-isolation convention and the two traps (a pooled-connection GUC reverting to `''`; RLS not applying to
superusers) that `tools/migrate/test/rls-convention.db-spec.ts` proves.

## Module inventory (reference baseline)

Phases 1–2 (SaaS foundation + shared services), Phase 3 (Finance), Phase 4 (Legal/Recovery business), Phase 5
(AI), Phase 6 (Enterprise Platform). Table counts are from the reference implementation.

| Module | Name | Phase | Tables |
|---|---|---|---|
| kernel / contracts | Shared kernel + event/DTO contracts | 1 | — |
| m01-tenant | Tenancy control plane | 1 | 10 |
| m02-identity | Authentication, RBAC, permissions | 1 | 8 |
| m03-audit | Audit spine + code registry | 1 | 7 |
| m04-admin | Admin console | 1 | — |
| m05-hub | Entity registry / adapter seam | 1 | — |
| m06-workflow | Status, workflow, SLA, timeline, transactional outbox | 2 | 18 |
| m07-rules | Rules engine | 2 | — |
| m08-notify | Notifications + escalation | 2 | 8 |
| m09-docs | Document service | 2 | 7 |
| m10-report | Reporting | 2 | — |
| m11-ai | AI seam (early) | 2 | 14 |
| m12-feedback | Feedback Management | 2 | 17 |
| m13-case | Case Management | 2 | 18 |
| m14-legal | Legal Matter Management | 4 | 23 |
| m15-recon / m15a-matching | Bank Reconciliation + matching engine | 3 | 18 |
| m16-litigation | Litigation & Court Management | 4 | 31 |
| m17-recovery | Recovery & Enforcement | 4 | 38 |
| m18-legaldocs | Legal Documents & Knowledge | 4 | 49 |
| m19-finance | Finance Operations foundation | 3 | 18 |
| m20-glrecon | GL Reconciliation | 3 | 24 |
| m21-journal | Journal Engine | 3 | 18 |
| m22-approval | Finance Approval Workflow | 3 | 24 |
| m23-finance-integration | Finance integration/QA/release | 3 | 3 |
| m24-ai-foundation | Enterprise AI Foundation (gateway, registries, RAG) | 5 | 21 |
| m25-operational-ai | Operational AI | 5 | 9 |
| m26-legal-ai | Legal AI | 5 | 11 |
| m27-finance-ai | Finance AI | 5 | 12 |
| m28-executive-ai | Executive Copilot | 5 | 7 |
| m29-ai-governance | AI governance & release | 5 | 7 |
| m30-platform | Enterprise Platform Foundation (6A) | 6 | 26 |
| m31-studio | Workflow/BPM/Forms/Rules Studio (6B) | 6 | 25 |
| m32-analytics | Reporting & Analytics Builder (6C) | 6 | 42 |
| m33-integration | Integration Foundation (6D-1) | 6 | 38 |
| m34-marketplace | Connector Marketplace (6D-2) | 6 | 25 |
| m35-devportal | Public APIs & Developer Portal (6D-3) | 6 | 18 |
| m36-events | Webhooks & Event Streaming (6D-4) | 6 | 34 |
| m37-govrelease | Integration Governance, QA & Release (6D-5) | 6 | 12 |
| m38-automation | Scheduler, Automation & Extension Framework (6E) | 6 | 44 |
| m39-saas | Tenant Admin, Billing, White-Labelling, Commercial SaaS (6F) | 6 | 72 |
| m40-resilience | Mobile, Offline, Observability, Backup, BC (6G) | 6 | 20 |
| m41-security | Enterprise Security, Privacy, Compliance & GRC (6H) | 6 | 79 |
| m42-certification | Enterprise Integration, Certification & Release (6I) | 6 | 43 |

## Platform totals (reference baseline)

45 packages · ~898 tables (886 RLS FORCE + 12 legitimately global) · 81 domain-event families · ~916 audit
codes · ~1,234 permissions · 37 test suites. Phase 6I recommendation: GO for controlled, staged, pilot-first
production release, conditional on live-infrastructure hardening.
