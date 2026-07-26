# Stage 3.2 — M13 Enterprise Case Management — Readiness

**Verdict: GO** (built on certified Stage 3.1 baseline `936e3377`, PR merged and verified; all dependencies
merged + certified on main).

## Dependencies available

- **kernel** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02-identity** — real RBAC (`RbacAuthz`) + the `permissions` catalogue m13 seeds into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port). ✅
- **m06-workflow** — owns the single outbox; m13 publishes `case.lifecycle` + `case.converted_to_matter` through
  it; review/approval/closure orchestration and SLA timer dispatch delegate here. ✅
- **m07-rules** — consumes typed case facts for triage classification, SLA selection and closure eligibility via a
  recorded `ruleEvaluationId` (declarative delegation, ADR-057); rules never mutate cases. ✅
- **m08-escalation** — notifications + escalation reused through events/contracts (no second escalation engine). ✅
- **m09-docs** — supporting documents + evidence attached by reference (no bytes) through events/contracts. ✅
- **m12-feedback** — the versioned feedback→case handoff (`CaseHandoffRequested` / `feedback.escalated`) consumed
  through a port; the M12 handoff is completed back (feedback → converted_to_case). ✅
- Test harness, migrate tool (m13-case in `module-order`), conformance. ✅

## The M12 handoff boundary

M13 consumes the versioned M12 handoff and creates exactly **one** case, idempotent via `case_handoff_intake`
keyed on the handoff id + tenant. It preserves the originating feedback id + correlation/causation, completes the
M12 handoff through a port (feedback → converted_to_case), and emits `case.handoff.accepted`. Duplicate handoff
events create **no second case** — re-delivery returns the existing case.

## Case-type configuration & legal boundary

Case types, legal jurisdictions/references, SLA policies, teams and deadlines are **configurable data**, published
as versioned immutable-after-publish specs (one-active). Non-legal and legal cases share the generic core; legal
cases carry inline `legal_*` support dimensions and can emit `case.converted_to_matter` for **M14** to own the
full legal matter — M13 implements no matter table and reaches no legal conclusion.

## Integration seams

- **workflow (m06)** — review/approval/closure gates + the single outbox.
- **rules (m07)** — triage, SLA selection, closure eligibility via `ruleEvaluationId`; rules never mutate cases.
- **escalation/notifications (m08)** — reused through events; no second escalation engine.
- **documents/evidence (m09)** — attached by reference only; no bytes, no document storage refs in API responses.

## Security & privacy boundaries

- Party contacts, confidential/privileged notes, correspondence bodies and confidential settlement terms are
  SENSITIVE: stored under RLS, REDACTED on read unless the caller holds the dedicated permission
  (`cases.party_contact.read`, `cases.privileged_notes.read`, `cases.confidential.read`), and never placed in
  events or audit payloads — which carry ids, states, dates and safe reason codes only (ADR-060).
- Every endpoint enforces its three-segment `cases.*` RBAC permission; privileged permissions
  (confidential / privileged-notes / settlement-approve / decision-approve / evidence-verify / platform) are
  default-deny; no wildcard.
- Maker-checker on decisions and settlement: the submitter cannot be the approver (segregation of duties).
- The evidence register is append-only and makes **no forensic chain-of-custody claim**.

## Determinism & port abstraction

SLA + deadline math is deterministic via injected `Clock` + `DateCalculator` ports — no ambient `Date.now`, no
production calendar; the same case + policy always yields the same due dates and stage state. Intake, handoff
consumption and decision submission are idempotent: the handoff id is unique per tenant, and re-submission returns
the existing case/decision rather than a duplicate.

## Assumptions

- No production calendar/telephony/SMS/email provider is configured → deterministic `Clock`/`DateCalculator`
  doubles only; real providers deferred behind existing ports, no secrets.
- Case classification, priority, jurisdiction and root cause are human/rule-driven fields — not AI outputs.
- Team/department/branch directory and finance identifiers are owned by other modules → configurable declarative
  references; settlement/recovery store finance **references** only.

## Exclusions (verified out of scope, Framework-Only where deferred)

No general ledger / finance foundation / accounting / journal posting / reconciliation / payment processing /
debt-collection accounting; no external court-filing integration; no production calendar/telephony/SMS/email
providers; no AI legal research / summarization / decision-making; no external-counsel or customer portal; no
document editor; no full regulatory-reporting engine; no M14 legal / M15 recon / finance internals.

## Implementation gates

format · lint (wiped dist) · build · smoke · conformance · migrations (dry-run + fresh replay) · DB specs ·
API specs · RLS · permissions · audit · events · outbox · idempotency (intake + handoff) · concurrency ·
append-only · maker-checker/SoD · redaction · security negatives · clock/date-determinism · contamination.
PostgreSQL 16 CI is authoritative.

## Deferred provider integrations

Production notification channels (SMS/email), a real calendar/business-day source behind `DateCalculator`,
court-filing and external-counsel systems, and any regulatory-reporting export — all behind existing
ports/contracts; a standing SLA/deadline/escalation sweeper worker (timer dispatch delegates to m06/m08).
