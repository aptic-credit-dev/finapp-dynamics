# Delivery Roadmap

The design spans Phases 1–6; delivery is staged so each layer proves the next. Phase 7 follows a live platform.

| Phase | Theme | Design status | Notes |
|---|---|---|---|
| 0 | Repository & toolchain foundation | Ready to build | Stage 0 — scaffold only, no business logic |
| 1 | SaaS foundation (tenancy, auth, RBAC, audit, admin) | Designed + reference-implemented | The spine everything depends on |
| 2 | Shared operational services + Feedback + Case | Designed + reference-implemented | Workflow, rules, status, SLA, timeline, escalation, notifications, documents |
| 3 | Finance (Bank Recon, GL Recon, Journal, Approval) | Designed + reference-implemented | Maker-checker, decimal-safe, draft-only posting |
| 4 | Legal, Litigation, Recovery, Legal Docs | Designed + reference-implemented | Privilege + ethical walls |
| 5 | AI layer (Foundation, Operational/Legal/Finance AI, Copilot) | Designed + reference-implemented | Human-in-the-loop, governed |
| 6A–6I | Enterprise platform (studio, analytics, integration, automation, SaaS, mobile, security/GRC, certification) | Designed + reference-implemented | 6I issued GO (conditional) |
| 7 | Vertical business modules & industry solutions | Designed (foundation) | After live, stable platform |

## Recommended delivery sequence for the rebuilt repository
Stage 0 (toolchain) → Stage 1 (SaaS foundation) → Stage 2 (shared services, then Feedback, then Case) → Stage 3
(Finance foundation → Bank Recon → GL Recon → Journal → Approval) → Stage 4 (Legal → Litigation → Recovery →
Legal Docs) → Stage 5 (AI foundation → Operational/Legal/Finance AI → Copilot → governance) → Stage 6 (platform
6A→6I in order) → pilot + hardening → Phase 7.

## MVP milestone
The first releasable milestone is the MVP defined in `docs/02-product/MVP_SCOPE.md`: SaaS foundation + shared
services + Feedback + Case + Bank/GL reconciliation with draft-only journals + read-only Legal portfolio + basic
reporting + governed AI summaries, behind feature flags with read-only/sandbox integrations. High-risk actions
are deferred past MVP.

## Hardening milestones (CONDITIONAL-GO conditions)
Live penetration test, DR failover/failback drill, enterprise-scale load + chaos runs, and real-data migration
execution with Finance + Legal sign-off. These are scheduled operations activities, each represented as a
time-bound conditional pass in the certification programme.
