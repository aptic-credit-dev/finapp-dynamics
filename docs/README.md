# Finapp Dynamics — Project Handover Package

## What Finapp Dynamics is

Finapp Dynamics is a multi-tenant, enterprise-grade SaaS platform for Aptic Group and its subsidiaries (Aptic
Credit Limited, Finapp Systems Limited, Aptic Insurance Agency, Crystal Bonds Limited), built to be
commercialised for external organisations later. It unifies operational, legal, and finance workflows that are
normally handled in separate systems, with a governed AI layer over the top. The functional pillars are Feedback
Management, Case Management, Legal Matter & Litigation Management, Recovery & Enforcement, Bank & GL
Reconciliation, a Journal Engine, and a cross-platform AI layer (Operational, Legal, Finance AI + an Executive
Copilot) — all on a shared enterprise platform (workflow/rules, reporting/analytics, integration, automation,
commercial SaaS, mobile/offline, security/GRC).

## Current project status — read this first

**This package is a design, architecture, and reference-implementation handover — not a finished, deployed
product.** The work to date was produced inside Claude and consists of two things:

1. **A complete architecture and planning corpus** — the enterprise blueprint, MVP PRD, screen catalogue, user
   journeys, database schema, API/event/permission catalogues, engineering backlog, build sequence, and phase
   deliverable specs. This is authoritative design.
2. **A substantial reference implementation** produced module-by-module in-session (a NestJS/TypeScript monorepo
   with PostgreSQL 16, RLS FORCE tenant isolation, a transactional outbox, and per-module smoke + DB-integration
   test suites). This code demonstrates the architecture end-to-end and passes its own test suites, but it has
   **not** been run against production infrastructure, penetration-tested, load-tested, or migrated with real
   data. Treat it as a certified-by-construction reference baseline that a team validates, hardens, and
   operationalises — not as a shipped system.

Concretely, the reference baseline covers 45 packages, ~898 database tables (886 tenant-scoped with RLS FORCE),
81 domain-event families, ~916 audit codes, ~1,234 permissions, and 37 test suites. Phase 6I issued a
**GO for controlled, staged, pilot-first production release** — conditional on the live-infrastructure hardening
steps (pentest, DR drills, load/chaos, real-data migration) that cannot be done inside a design environment.

## What has been designed

Everything in the functional scope above, across Phases 1–6: the SaaS foundation (tenancy, auth, RBAC, audit),
shared operational services (workflow, rules, status, SLA, timeline, escalation, notifications, documents), all
business modules, the AI layer, the enterprise platform (6A–6H), and the final certification gate (6I). See
`PROJECT_INDEX.md` for the full map and `docs/` for the consolidated specifications.

## What has not yet been built

No GitHub repository, no CI/CD running against real infrastructure, no deployed environments, no live external
integrations (connectors are framework + contract only), no executed data migration, no completed
penetration/DR/load testing, and no Phase 7 vertical business solutions. These are the first real-world
engineering activities, and several are explicit CONDITIONAL-GO conditions.

## Recommended MVP

A disciplined MVP that proves the platform without over-reaching (full detail in `docs/02-product/MVP_SCOPE.md`):
the SaaS foundation (tenancy, auth, RBAC, audit, admin console), shared operational services, Feedback
Management, Case Management, Bank + GL Reconciliation with **draft-only** journals (no auto-posting), a read-only
Legal portfolio, basic reporting, and a small set of governed AI summaries — behind feature flags, with
read-only or sandbox external integrations. Everything high-risk (journal posting, payments, legal filing,
autonomous AI action) stays out of the MVP.

## Repository initialization instructions

```bash
# 1. Create the repository from this handover package
git init finapp-dynamics && cd finapp-dynamics
cp -r /path/to/finapp-dynamics-handover/* .

# 2. Commit the design baseline
git add -A && git commit -m "chore: import Finapp Dynamics architecture & handover package"

# 3. Create the long-lived branches
git branch develop
git push -u origin main
git push -u origin develop

# 4. Start Stage 0 (repository + toolchain scaffolding) on a feature branch
git checkout -b feature/stage-0-foundation
```

`CLAUDE.md` and `docs/08-prompts/STAGE_0_PROMPT.md` tell Claude Code exactly how to begin.

## Recommended Claude Code workflow

1. Open the repository in Claude Code and have it read `CLAUDE.md`, then `docs/01-architecture/` and
   `docs/01-architecture/ARCHITECTURE_DECISION_REGISTER.md` **before writing any code**.
2. Load `manifests/implementation-manifest.yaml` — it is the machine-readable source of truth for what to build,
   in what order, with which shared services, permissions, events, and tests.
3. Work **one approved stage at a time**. Each stage: build → add permissions + events + audit codes + tests →
   run the stage's smoke + DB suites → update the docs and manifest → commit → request the next stage.
4. Never mark anything `implemented` in the manifest without real, tested code.

## Recommended Git strategy

Trunk-based with short-lived feature branches off `develop`, squash-merged after review; `main` is always
releasable. One branch per stage/module (`feature/stage-1-saas-foundation`, `feature/m12-feedback`, …).
Conventional Commits. Tag release candidates (`v0.1.0-rc.1`) at each MVP release gate. CI must pass the full
smoke lane on every PR and the DB-integration lane on merges to `develop`.

## The first development stage

**Stage 0 — Repository & toolchain foundation.** Scaffold the monorepo (package manager, TypeScript project
references, lint/format, the migration runner, the CI skeleton, and the test harness) with **no business logic**.
This establishes the conventions every later module depends on. See `docs/08-prompts/STAGE_0_PROMPT.md`.

> **Status statement:** Finapp Dynamics is currently a design-and-architecture package plus an in-session
> reference implementation. It is **not** a completed, deployed software system. Repository initialization and
> staged, validated re-build/hardening in Claude Code is the recommended next step.
