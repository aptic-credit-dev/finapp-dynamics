# Executive Overview

Finapp Dynamics is a multi-tenant enterprise SaaS platform for Aptic Group and its subsidiaries, designed to be
commercialised for external organisations. It replaces a patchwork of separate tools with one governed platform
spanning customer feedback, case management, legal matter & litigation management, recovery & enforcement, bank
and GL reconciliation, a journal engine, and a cross-platform AI layer — all on shared enterprise services
(workflow, rules, reporting, integration, automation, commercial SaaS, mobile/offline, security/GRC).

## Why it exists
Aptic operates across subsidiaries, departments, and branches with distinct product lines. Service quality,
internal issues, legal matters, and financial reconciliations are tracked in disconnected systems, which makes
management visibility, escalation, and audit slow and error-prone. Finapp Dynamics unifies these into a single
operating layer with consistent workflow, audit, and role-based access — and adds a governed AI layer that
summarises, classifies, and recommends without ever making controlled decisions on its own.

## What has been produced
A complete architecture and planning corpus, plus a substantial in-session reference implementation (a
NestJS/TypeScript + PostgreSQL 16 monorepo) that demonstrates the full architecture end-to-end and passes its own
test suites. This is a certified-by-construction baseline — not a deployed product. It has not yet been run on
production infrastructure, penetration-tested, load-tested, or migrated with real data.

## Status
The design is complete across Phases 1–6. The reference baseline covers 45 packages, ~898 tables (886 with RLS
FORCE tenant isolation), 81 event families, ~916 audit codes, ~1,234 permissions, and 37 test suites. The final
certification gate (Phase 6I) issued a **GO for controlled, staged, pilot-first production release**, conditional
on the live-infrastructure hardening that cannot be done in a design environment (penetration testing, DR drills,
load/chaos testing, real-data migration).

## What comes next
Initialize a GitHub repository from this package and continue in Claude Code, working one approved stage at a
time: scaffold the toolchain, then the SaaS foundation, then modules in dependency order, validating and
hardening as you go. Phase 7 (vertical business solutions) follows once the platform is live and stable.
