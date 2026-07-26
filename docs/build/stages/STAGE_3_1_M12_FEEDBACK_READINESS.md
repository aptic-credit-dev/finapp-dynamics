# Stage 3.1 — M12 Enterprise Feedback Management — Readiness

**Verdict: GO** (built on certified Stage 2.5 baseline `6aa47442`, PR merged and verified).

## Dependencies available

- **kernel** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02** — real RBAC (`RbacAuthz`) + the `permissions` catalogue m12 seeds into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port). ✅
- **m06-workflow** — owns the single outbox; m12 publishes `feedback.lifecycle` through it; review/approval
  orchestration and SLA timer dispatch delegate here. ✅
- **m07-rules** — consumes typed feedback facts for classification/closure decisioning (declarative delegation, ADR-053). ✅
- **m08-escalation** — notifications + escalation reused through events/contracts (no second escalation engine). ✅
- **m09-docs** — supporting evidence attached through events/contracts. ✅
- Test harness, migrate tool (m12-feedback in `module-order`), conformance. ✅

## Security boundaries

- Customer contact details and free-text narratives are SENSITIVE: stored under RLS, REDACTED on read unless the
  caller holds `feedback.customer_contact.read`, and never placed in events or audit payloads (ADR-055).
- Every endpoint enforces its three-segment `feedback.*` RBAC permission; `feedback.customer_contact.read` and
  `feedback.platform.administer` are privileged and default-deny.
- Maker-checker on resolution: the submitter cannot be the approver (segregation of duties).
- Hard limits fail closed; case handoff to M13 is a controlled port + pending record + event — no fake case table.

## Determinism & port abstraction

SLA math is deterministic via an injected `Clock` port — no ambient `Date.now`; the same feedback + policy always
yields the same due dates and stage state. `SourceSystemAdapter` normalizes external transactions behind a port,
bound to deterministic in-memory doubles (Framework Only). Ingestion, record creation and case handoff are
idempotent: external-transaction id is unique, and re-submission returns the existing record rather than a
duplicate.

## Privacy risks & mitigations

- **Contact/narrative leakage** → sensitive fields redacted on read behind `feedback.customer_contact.read`;
  audit/events carry identifiers, statuses, reason codes and safe analytics dimensions only (ADR-055).
- **Cross-tenant access** → RLS ENABLE+FORCE + `tenant_isolation` on all 15 tables; composite `(tenant_id,id)`
  keys/FKs; asserted through the non-owner app role.
- **Improper mutation of the record** → append-only ledgers (answers, contact attempts, assignment history) are
  INSERT+SELECT only; the application role has NO DELETE anywhere; resolution/closure gated + optimistically
  concurrent.

## Assumptions

- No real external source adapter (ApticOne/AutoBonds/BimaPro/Imarisha) is configured → deterministic doubles
  only; real adapters deferred, no secrets.
- Sentiment, severity, classification and root-cause are human/rule-driven fields — not AI outputs.
- Relationship-officer/department/branch directory data owned by other modules → configurable declarative refs.

## Exclusions (verified out of scope)

No M13 case-management internals; no AI sentiment/summarization; no call recording; no production SMS/email/CRM
integrations; no data warehouse; no unrestricted CSV import; no real external adapters (deterministic adapters +
contracts only). Framework-Only where deferred.

## Implementation gates

format · lint (wiped dist) · build · smoke · conformance · migrations (dry-run + fresh replay) · DB specs · API
specs · RLS · permissions · audit · events · outbox · idempotency · concurrency · append-only · maker-checker/SoD ·
redaction · security negatives · clock-determinism · contamination. PostgreSQL 16 CI is authoritative.

## Deferred provider integrations

Real source-system adapters (ApticOne/AutoBonds/BimaPro/Imarisha), production notification channels (SMS/email),
CRM, and any data-warehouse export — all behind existing ports/contracts; a standing SLA/escalation sweeper worker
(timer dispatch delegates to m06/m08).
