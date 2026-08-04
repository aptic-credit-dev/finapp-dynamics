# M22 — Finance Approval Workflow (maker-checker + Segregation of Duties)

**Module:** `m22-approval` · **Stage:** 3 (Finance) · **MVP:** yes · **Status:** implemented (Stage 3)
**API:** `/api/v1/approvals` · **Permissions:** `approvals.*` (25; 12 privileged) · **Audit:** `APPROVAL_` (23)
**Events:** `approval.lifecycle` (16 types) · **Tables:** 24 FORCE-RLS (18 append-only) · **ADRs:** ADR-097 … ADR-100

## Purpose

M22 is the **single lifecycle choke point** through which every **controlled finance action** passes before it may
execute. The canonical case is **posting a journal**: m21 prepares a balanced, validated draft and submits it *for
approval*; m22 runs **maker-checker + Segregation of Duties**, and only a governed **approval** releases the reference
that m21/m23 gate posting on. AI and automation may recommend; **a human approves** — m22 **never approves on behalf of
a human**, and never lets one identity both make and check a controlled action (CLAUDE.md hard rules).

The engine is **generic and configurable** (not journal-specific): a request names a `subject_type`
(`journal_posting`, `payment`, `adjustment`, …) and an **opaque** `subject_ref` in the owning module. m22 owns the
workflow only — no journals (m21), chart of accounts/periods (m19), or integration/posting (m23).

## The one aggregate + its lifecycle

`approval_request` is the aggregate and the only choke point. Statuses and the **explicit valid transitions**
(`domain/lifecycles.ts`, mirrored by DB CHECKs):

```
draft ──submit──▶ pending ──decision──▶ approved | rejected | returned
  │                  │  ▲                                   │
  └──cancel──▶ cancelled  └──escalate──▶ escalated          └──resubmit──▶ pending
```

- **Terminal-state protection** — `approved` / `rejected` / `cancelled` have no outgoing edges.
- **Controlled resubmission** — the single `returned → pending` edge.
- **Controlled cancellation** — `→ cancelled` from every non-terminal state.
- **No direct status mutation** — every transition goes through a service that consults the lifecycle machine, writes
  append-only history, and CAS-guards the write (**optimistic concurrency**; a stale `expectedVersion` is rejected).

## Maker-checker + SoD (the heart)

The PURE engine (`engine.ts`) decides whether an actor may act as **checker**, failing **closed**:

| Rule | Blocks when | Reason code |
| --- | --- | --- |
| maker ≠ checker | actor is the request's maker (requester) | `maker_is_checker` |
| preparer ≠ checker | actor prepared the underlying artefact | `preparer_is_checker` |
| delegate ≠ maker | actor acts under a delegation *from the maker* | `delegate_is_maker` |
| distinct 2nd approver | the same actor supplies a required second approval | `single_approver` |

Enforced in **three layers**: (1) the pure engine, (2) `DecisionService` (which also records an
`approval_sod_check` and audits `APPROVAL_SOD_BLOCKED` — a refused controlled action is **never silent**), and (3) DB
CHECKs (`final_approver <> requested_by`; an `approve`/`override_approve` actor `<> maker`; `delegate <> delegator`).
A request becomes `approved` only when the **distinct-approver quorum** is met **and** a `final_approver` (provably not
the maker) is named — releasing an `approval_outcome` whose id is the **approval reference** downstream posting gates on.

**Decisions** (`approval_decision`, append-only): `approve`, `reject`, `return`, `abstain`, `escalate`, `cancel`, and
the privileged `override_request` / `override_approve` / `override_reject`. **Overrides still honour SoD.**

## Reuse — never a second engine

| Capability | Reused from | How |
| --- | --- | --- |
| Authorization (default deny) | m02 | `AUTHZ.require` per route + service |
| Audit | m03 | `AUDIT` in the same tx |
| Workflow instance | m06 | opaque `workflow_ref` recorded in `approval_workflow_link` |
| SLA timers / escalation clock | m06 | opaque `timer_ref` in `approval_timer`; deterministic `Clock` port |
| Notifications | m08 | opaque `notification_ref` in `approval_notification` |
| Event delivery | m06 outbox | `approval.lifecycle` via `M22Emitter` — m22 owns **no** outbox |

Escalation is **deterministic**: single-fire per `(request, step, to_level)` (`UNIQUE NULLS NOT DISTINCT`, so a
request-level escalation with `step_id IS NULL` still collides), **depth-bounded**, and **notify-only vs
reassignment**. m22 builds **no** second timer or notification engine.

## Data protection

Every tenant-scoped table has RLS **FORCE** + `tenant_isolation`, composite `(tenant_id, id)` keys and composite FKs.
Money thresholds are **bigint minor units** (never float; ADR-007). Event/audit payloads carry ids, states, levels,
decisions, reason codes and opaque references **only** — never subject narratives, counterparty PII, or secrets. The
application role has **no DELETE**; 18 ledgers are INSERT+SELECT only.

## Boundaries

Owns the approval workflow **only**. NEVER approves on behalf of a human; NEVER posts to a ledger/ERP (m21/m23 do,
gated on the approval reference m22 releases); NEVER stands up a second workflow/timer/notification engine. m23
(finance integration) is **downstream** — it *consumes* m22, it is not a prerequisite.

## Tests

PURE smoke suite (vocabulary, lifecycles, SoD + quorum engine, permissions, audit codes); a governance DB spec (RLS,
no-DELETE, append-only, money, every SoD CHECK, single-fire/bounded escalation, quorum, idempotency, one-active-policy,
composite FKs, single outbox); and a services DB spec proving the full maker-checker + SoD flow end to end on real
PostgreSQL. See `packages/m22-approval/test/`.
