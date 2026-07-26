# Stage 2.4 — M08 Notifications & Escalation — Architecture

**Module:** `m08-notify` · **Branch:** `feature/stage-2-4-m08-notifications` · **Baseline:** certified Stage 2.3
main `f5b06d7` (PR #15 merge). **ADRs:** ADR-038…043.

## Purpose & boundary

One generic, multi-tenant **notification + escalation** service consumed by Feedback, Cases, Workflow, Finance
and others through events/contracts — never by embedding delivery in each module. It is **not** a marketing
campaign engine, a CRM, a dialer, or a bulk promotional tool (see Exclusions). It consumes the shared services
via kernel tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and owns no shared service.

## Shape (mirrors m07)

- **PURE domain** — channel abstraction + destination normalization (with webhook SSRF guard); safe
  deterministic `{{ variable }}` rendering (ADR-040); typed variable validation; template/request/escalation
  state machines; retry-policy + escalation-level calculators; recipient dedup; preference/suppression eval.
- **8 tables** — template (+ immutable version, one ACTIVE), request (lease + idempotency), delivery
  (append-only evidence), escalation policy (immutable, one ACTIVE) + instance (lease), preference (+ dest
  suppression), inbox. All composite `(tenant_id,id)`, RLS FORCE + `tenant_isolation`, no-DELETE grants.
- **Services** — Template / Notification / Escalation / Preference / Inbox, each permissioned + transactional,
  audit + outbox in the business tx via one `M08Emitter`.
- **API** `/api/v1/notifications` — authoring/lifecycle, request create/cancel/retry + delivery reads,
  escalation policies/instances, self-service preferences + inbox. Worker paths (dispatch, advance) are not
  exposed.

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| Providers | channel-neutral ports/adapters; deterministic test doubles only; no secrets; webhook SSRF guard | 038 |
| Templates/policies | versioned, immutable-at-publish `spec` JSON; one ACTIVE; content_hash | 039 |
| Rendering | explicit substitution only — no eval/Function/vm; escaping + hard limits; deterministic | 040 |
| Evidence | request holds variable values under RLS; audit/events/delivery carry ids/hashes/status only | 041 |
| Preferences | optional/operational/security/legal categories; security+legal bypass all suppression | 042 |
| Concurrency | compare-and-set LEASE = single-winner dispatch/advance; bounded, idempotent | 043 |

## Integration

m06 workflow / m07 rules trigger notifications and escalations through events/contracts, never by importing
m08 internals. A notification delivery failure never mutates a completed rules decision or workflow transition.
`notification.lifecycle` (21 types) flows through the single m06 outbox.
