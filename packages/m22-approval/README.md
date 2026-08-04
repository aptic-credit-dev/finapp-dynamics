# m22-approval — Finance Approval Workflow (maker-checker + SoD)

The **one lifecycle choke point** for controlled finance actions (e.g. posting an m21 journal): a single aggregate
(`approval_request`) with **explicit valid transitions**, transition **reason codes**, **service-layer authorization**,
**optimistic concurrency**, **idempotency**, **append-only** status/decision history, **audit**, **events**, **workflow
+ notification hooks**, deterministic (**clock-driven**) **escalation**, **controlled cancellation + resubmission**, and
**terminal-state protection**. A human decides; **m22 records and enforces** — it **never approves on behalf of a
human**, **never lets one identity both make and check** a controlled action, and **never posts** (m21/m23 post, gated
on the approval reference m22 releases).

|                  |                                                          |
| ---------------- | -------------------------------------------------------- |
| Module code      | `m22-approval`                                           |
| Build stage      | 3 (Finance) — `docs/07-engineering/BUILD_SEQUENCE.md`    |
| API prefix       | `/api/v1/approvals`                                       |
| Permissions      | `approvals.*` (25; 12 privileged)                        |
| Audit prefix     | `APPROVAL_` (23 codes, incl. `APPROVAL_SOD_BLOCKED`)     |
| Event family     | `approval.lifecycle` (16 types)                          |
| Tables           | 24 FORCE-RLS (18 append-only); no DELETE grant           |
| ADRs             | ADR-097 … ADR-100                                        |

## What it owns (24 tables)

- **Reference/config** — `approval_policy` (versioned, one active per subject_type+scope), `approval_policy_step`
  (immutable spec), `approval_policy_history`, `approval_config` (versioned, immutable-after-publish, idempotency-keyed),
  `approval_reason_code` (configurable registry).
- **Core request** — `approval_request` (the aggregate / choke point), `approval_request_step`, append-only
  `approval_decision` (the decision ledger), `approval_status_history`, `approval_step_history`.
- **Actors / SoD / delegation** — append-only `approval_assignment`, `approval_delegation` (grant),
  `approval_delegation_history`, append-only `approval_sod_check` (SoD evidence), `approval_participant` (distinct
  participant ledger).
- **Escalation / SLA / notify / workflow** — append-only `approval_escalation` (single-fire, depth-bounded),
  `approval_timer` (m06 SLA-timer link), `approval_notification` (m08 dispatch), `approval_workflow_link` (m06
  instance link).
- **Idempotency / evidence / outcome** — append-only `approval_idempotency` (unique per key), `approval_note`,
  `approval_evidence` (m09 refs), `approval_outcome` (terminal + released approval reference), `approval_override`.

## Invariants (DB-enforced — maker-checker + SoD)

- **Maker != checker** — `approval_request.final_approver <> requested_by`; `approval_decision`: an `approve` /
  `override_approve` actor is never the request's `maker`; `approval_override` actor is never the maker. (Mirrors the
  pure engine in `engine.ts`, which fails **closed**.)
- **No approval without quorum** — a request can only be `approved` once `approvals_count >= required_approvals` **and**
  a `final_approver` is named.
- **A delegate is never the delegator** (`approval_delegation.delegate <> delegator`); a delegated approver still
  cannot launder SoD (enforced in `DecisionService`).
- **Single-fire, bounded escalation** — `UNIQUE NULLS NOT DISTINCT (request, step, to_level)` (a request-level
  escalation has `step_id IS NULL`, so `NULLS NOT DISTINCT` is load-bearing) + a depth CHECK.
- **No duplicate action** — `approval_idempotency` is unique per key; `approval_request` is idempotency-keyed.
- **SoD can never be disabled** — `approval_config.enforce_sod = true` CHECK.
- **One released outcome per request**, and a released outcome must be an approval naming its final approver.
- Every table: composite `(tenant_id, id)` keys, RLS **FORCE** + `tenant_isolation`, composite FKs, `version` on
  mutable aggregates. **No DELETE** grant; 18 ledgers are INSERT+SELECT only.

## What it reuses (never rebuilds)

m02 authorization, m03 audit, **m06 workflow + SLA + timers + the ONE outbox**, **m08 notifications** — all through DI
tokens / events / **opaque references** (`workflow_ref`, `timer_ref`, `notification_ref`). It builds **no second**
workflow, timer or notification engine. `subject_ref` (what is being approved) is an opaque id owned by another module
(e.g. an m21 posting-request id) — m22 never reads that module's tables.

## Tests

- `test/m22-approval.smoke.ts` — PURE: vocabulary, lifecycles, the SoD + quorum engine, permissions, audit codes.
- `test/m22-approval.db-spec.ts` — governance on real PostgreSQL: RLS, no-DELETE, append-only, money=bigint, the SoD
  CHECKs, single-fire/bounded escalation, quorum, idempotency, one-active-policy, composite FKs, single outbox.
- `test/m22-services.db-spec.ts` — end-to-end maker-checker + SoD: maker-can't-approve-own, preparer-can't-check,
  delegate-can't-launder-SoD, distinct-checker approval + released reference, two-approver quorum, reject / return +
  resubmit / cancel, single-fire escalation, override-honours-SoD, optimistic concurrency, default deny, data
  minimisation, cross-tenant isolation.
