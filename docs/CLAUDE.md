# CLAUDE.md — Operating Instructions for Claude Code

This file governs how Claude Code works in the Finapp Dynamics repository. Read it fully before doing anything.

## Before writing any code

1. Read `docs/01-architecture/ENTERPRISE_ARCHITECTURE_BLUEPRINT.md`,
   `docs/01-architecture/SHARED_SERVICE_OWNERSHIP.md`,
   `docs/01-architecture/DOMAIN_BOUNDARIES.md`, and
   `docs/01-architecture/ARCHITECTURE_DECISION_REGISTER.md`.
2. Load `manifests/implementation-manifest.yaml`. It is the authoritative, machine-readable plan: phase, stage,
   module, capability, priority, MVP inclusion, dependencies, shared services consumed, DB/API/event ownership,
   permissions, tests, status, and target repository location.
3. Confirm which **single stage** is approved for build. Do not start a stage that is not `approved_for_build`.

## Non-negotiable engineering rules

- **Reuse shared services.** There is exactly one authoritative implementation of each shared service —
  authentication, tenant resolution, authorization (RBAC), audit, status engine, workflow, rules, SLA, timeline,
  escalation, notifications, documents, the transactional outbox, secrets, idempotency, entitlements, usage
  metering, and reporting. Consume them through their DI tokens and contracts. **Never create a duplicate shared
  platform service.**
- **Maintain tenant isolation.** Every tenant-scoped table has RLS FORCE and a `tenant_isolation` policy plus
  composite `(tenant_id, id)` keys and composite foreign keys. Always operate inside tenant context. The only
  legitimately-global tables are the tenancy control plane, the audit spine, pre-authentication login attempts,
  and global reference registries — do not add to that list without an ADR.
- **Preserve maker-checker and Segregation of Duties.** Finance and other controlled actions require an approver
  who is not the requester. Never let one identity both create and approve a controlled action.
- **Use decimal-safe money handling.** Never use floating-point arithmetic for money. Amounts are integer minor
  units or exact decimals; journals must balance (debits == credits) before posting.
- **Use the Transactional Outbox** (in `m06-workflow`) for every domain event. Never add a second event-delivery
  path or a second outbox table.
- **With every module, add** its permissions (to the identity seed catalogue), its domain events (to the
  contracts event union), its audit codes (to the audit registry — unregistered codes fail CI), and its tests
  (a PURE smoke suite plus a DB-integration spec). Every mutating route is an audited endpoint with a permission.
- **Idempotency for high-risk actions** — posting, payments, migrations, event ingestion — keyed and safe to
  retry.

## Hard prohibitions

- **Never auto-post Finance journals.** AI and automation may recommend journal entries; a human approves and
  posts. No posting into closed periods, no duplicate posting, no posting without approval.
- **Never allow AI to approve or execute controlled actions.** AI assists, summarises, classifies, and
  recommends with confidence and citations; humans decide. AI must not approve, post, file, or reach a legal
  conclusion, and must not submit restricted data to unapproved providers.
- **Never claim untested integrations are production-ready.** Connectors ship as Framework Only / Sandbox Ready /
  Production Ready Pending Credentials until proven against real systems. State the honest status.
- **Never create duplicate shared platform services** (restated because it is the most common failure mode).
- **Never mark manifest items `implemented` without real, tested code.**

## Working rhythm

Work **one approved stage at a time**. For each stage:

1. Build the stage per its module spec in `docs/04-modules/` (or `03-platform/`, `05-ai/`).
2. Add permissions, events, audit codes, and tests alongside the code.
3. Run the stage's smoke suite and DB-integration spec; run the full baseline before committing.
4. Update the relevant `docs/` files and `manifests/*.yaml` so documentation stays synchronized with the code.
5. Commit in small, reviewable units (Conventional Commits), then request approval for the next stage.

## Money, time, and safety defaults

- Money: decimal/minor-unit only; balanced journals; no float.
- Time: store UTC; render in tenant timezone; respect business calendars for SLAs and escalations.
- Safety: fail closed. When a check is ambiguous, deny and surface a clear reason. Every controlled action is
  auditable, and no security event disappears silently.

## Keep documentation synchronized

The `docs/` tree and the `manifests/` YAML are part of the deliverable, not an afterthought. If the
implementation diverges from a spec, record the divergence as an ADR and update the affected documents in the
same change — never let code and documentation drift apart.
