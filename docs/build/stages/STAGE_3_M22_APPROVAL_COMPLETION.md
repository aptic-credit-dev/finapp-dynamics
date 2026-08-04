# Stage 3 — M22 Approval Workflow — Completion

**Module:** `m22-approval` · **Branch:** `governance/approve-m22-approval` · **Date:** 2026-08-04
**Capability:** Finance Approval Workflow — maker-checker + Segregation of Duties

## What shipped

A generic, configurable **finance approval workflow** — the single lifecycle choke point for controlled finance
actions (canonically, posting an m21 journal). A human decides; m22 records and **enforces** maker-checker + SoD.

- **24 FORCE-RLS tables** (6 mutable aggregates + 18 append-only ledgers); composite `(tenant_id, id)` keys + FKs; no
  DELETE grant. Migrations `0001_approval.sql`, `0002_grant_application_role.sql`.
- **25 permissions** (`approvals.*`, 12 privileged), seeded in migration 0001 and registered in
  `permission-registry.yaml`.
- **23 audit codes** (`APPROVAL_`, incl. `APPROVAL_SOD_BLOCKED`), registered in `audit-code-registry.yaml`
  (`registered_code_count` 608 → 631).
- **`approval.lifecycle`** event family (16 types), registered in `event-registry.yaml`, appended to the contracts
  union (21st family), delivered through the ONE m06 outbox.
- **Pure engine** (`engine.ts`): SoD evaluation (maker/preparer/delegate/single-approver) + quorum + bounded
  escalation, fully deterministic and unit-tested.
- **Five services**: `CatalogService` (policy/config/reason-code), `RequestService` (create/submit/cancel/resubmit +
  workflow/SLA/notify hooks), `DecisionService` (approve/reject/return/abstain/escalate + override — the SoD choke
  point), `DelegationService`, `EscalationService` (clock-driven, single-fire, depth-bounded).
- **HTTP API** under `/api/v1/approvals` (4 controllers), wired into `apps/api` via `ApprovalsModule`.
- **ADR-097 … ADR-100** recorded.

## Invariants proven DB-side

`final_approver <> requested_by`; an `approve`/`override_approve` decision actor `<> maker`; `delegate <> delegator`;
override actor `<> maker`; no `approved` below quorum or without a final approver; single-fire escalation
(`UNIQUE NULLS NOT DISTINCT`, so request-level `step_id IS NULL` still collides) + depth CHECK; unique idempotency
ledger; `enforce_sod = true` CHECK; one released outcome per request (an approval naming its approver); single outbox
(m06); RLS FORCE + `tenant_isolation` on all 24 tables; money = bigint minor units, no float.

## Verification

- **Build:** `npm run build` — green (whole solution).
- **Lint:** `npm run lint` — 0 errors.
- **Smoke lane:** 26 suites, **4995 assertions**, 0 failures (incl. `m22-approval` smoke 72, `contracts` 138,
  `conformance` 2757).
- **DB lane (PostgreSQL 15.2 throwaway):** every package-level spec green, incl. **`m22-approval` db-spec (50
  assertions)** and **`m22-services` db-spec (33 assertions)**. The `api-*` HTTP specs fail only in the local
  throwaway (the app connects as a superuser that bypasses RLS, and those specs require a full auth session) — the
  same failures occur for m19/m20/m21/legal and are unrelated to m22; they pass in CI (PostgreSQL 16, non-superuser
  role).

## Known limitations

- **Posting is not performed here** — m22 releases the approval reference; m21/m23 post (posting is draft-first /
  deferred per ADR-096). No external system is invoked.
- **HTTP RLS is validated in CI, not the local throwaway** (the local run connects as `postgres`, a superuser that
  bypasses RLS). Package-level specs exercise RLS correctly via `SET ROLE` to the non-owner application role.
- **Escalation is driven by an injected `Clock`** and an external SLA-timer signal (m06); m22 records the timer
  reference and fires the single escalation — it does not itself schedule wall-clock timers.

## Remaining manual action

Merge the M22 implementation PR, then run post-merge M22 certification (Smoke + DB on PostgreSQL 16 CI).
