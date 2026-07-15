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

**Stage 0 (repository & toolchain) is now implemented and tested** — see "Getting started" below. Everything
beyond it is still design-only: no business module, table, route, permission, event, or audit code exists in this
repository yet.

Also outstanding: CI/CD running against real infrastructure, deployed environments, live external integrations
(connectors are framework + contract only), executed data migration, completed penetration/DR/load testing, and
Phase 7 vertical business solutions. These are the first real-world engineering activities, and several are
explicit CONDITIONAL-GO conditions.

## Getting started

Requires **Node.js >= 22.6** (the test harness uses `--experimental-strip-types`). PostgreSQL 16 is optional for
day-to-day work — the DB lane skips without it.

```bash
npm install
npm run verify        # lint + build + PURE smoke suites. No database needed.

# Individually:
npm run build         # tsc project references
npm run lint          # ESLint (type-aware)
npm run test:smoke    # PURE suites — run straight off source, no build required
npm run test:db       # DB integration specs; SKIPPED (green) unless DATABASE_URL is set
npm run migrate -- --dry-run   # print the ordered migration plan
npm run migrate       # apply migrations; refuses to run without DATABASE_URL

npm run build && node apps/api/dist/src/main.js   # API on :3000, health at /api/v1/health
```

Before touching the database, read `docs/07-engineering/DATABASE_CONVENTIONS.md` — the tenant-isolation
convention has two non-obvious traps (a pooled-connection GUC that reverts to `''`, and RLS not applying to
superusers) that it explains and that `tools/migrate/test/rls-convention.db-spec.ts` proves.

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

## Stages

- **Stage 0 — Repository & toolchain foundation. Implemented.** The monorepo, TypeScript project references,
  lint/format, the kernel, the contracts event union (empty by design), the migration runner, the CI skeleton,
  and the test harness — with no business logic. See `docs/08-prompts/STAGE_0_PROMPT.md` and the `delivered` /
  `verification` blocks under stage 0 in `manifests/implementation-manifest.yaml`.
- **Stage 1 — SaaS foundation. Approved, not started.** m01 → m02 → m03 → m06 → m07 → m08 → m09 → m04. Proves
  tenant isolation + audit against real tables. See `docs/08-prompts/STAGE_1_PROMPT.md`.

> **Status statement:** Finapp Dynamics is a design-and-architecture package plus an in-session reference
> implementation, on top of an implemented Stage 0 toolchain. It is **not** a completed, deployed software
> system. Staged, validated re-build/hardening in Claude Code — one approved stage at a time — is the way
> forward.
