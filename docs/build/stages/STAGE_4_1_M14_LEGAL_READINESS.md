# Stage 4.1 — M14 Enterprise Legal Matter Management — Readiness

**Verdict: GO** (built on certified Stage 3.2 baseline `12628451`, cert PR #23; all dependencies merged +
certified on main).

## Dependencies available

- **kernel** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02-identity** — real RBAC (`RbacAuthz`) + the `permissions` catalogue m14 seeds into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port). ✅
- **m06-workflow** — owns the single outbox; m14 publishes `legal.lifecycle` through it; review/approval/closure
  orchestration and SLA timer dispatch delegate here. ✅
- **m07-rules** — consumes typed matter facts for risk classification, SLA selection and closure eligibility via a
  recorded `ruleEvaluationId` (declarative delegation, ADR-061); rules never mutate matters. ✅
- **m08-escalation** — notifications + escalation reused through events/contracts (no second escalation engine). ✅
- **m09-docs** — pleadings + supporting documents + evidence attached by reference (no bytes) through events/
  contracts. ✅
- **m13-case** — the versioned M13→M14 conversion (`case.converted_to_matter`) consumed fire-and-forget; m14 never
  reads m13-owned tables. ✅
- Test harness, migrate tool (m14-legal in `module-order`), conformance. ✅

## The M13 conversion boundary

M14 consumes the versioned M13 conversion and creates exactly **one** matter, idempotent via
`legal_case_conversion` keyed on `source_case_id` + tenant. It preserves the originating case id + correlation/
causation and emits `legal.lifecycle` matter-created events. The conversion is **fire-and-forget** (m13 emits, m14
consumes); duplicate `case.converted_to_matter` events create **no second matter** — re-delivery returns the
existing matter. **m14 never reads m13-owned tables.**

## Matter-type configuration & legal boundary

Matter types, jurisdictions, forums/courts, statutes, external firms, advocates, SLA policies and deadlines are
**configurable data**, published as versioned immutable-after-publish specs (one-active). Nothing is Aptic-/
Kenya-specific in core logic. M14 owns full legal matters; costs, exposure and enforcement store finance + court
**references** only, and M14 reaches no posting, payment or accounting conclusion.

## Integration seams

- **workflow (m06)** — review/approval/closure gates + the single outbox.
- **rules (m07)** — risk classification, SLA selection, closure eligibility via `ruleEvaluationId`; rules never
  mutate matters.
- **escalation/notifications (m08)** — reused through events; no second escalation engine.
- **documents/evidence (m09)** — pleadings + supporting material attached by reference only; no bytes, no document
  storage refs in API responses.

## Security & privacy boundaries

- Legal positions/strategy, opinions, privileged notes, party contacts and confidential settlement terms are
  SENSITIVE: stored under RLS, REDACTED on read unless the caller holds the dedicated privileged `legal.*`
  permission, and never placed in events or audit payloads — which carry ids, states, dates and safe reason codes
  only (ADR-064).
- Every endpoint enforces its three-segment `legal.*` RBAC permission; the **23** privileged permissions
  (positions / opinions / privileged-notes / party-contact / confidential-settlement / settlement-approve /
  config / platform) are default-deny; no wildcard.
- Maker-checker on settlement: the proposer cannot be the approver (segregation of duties), enforced in the
  service AND the DB CHECK `legal_settlement_sod_ck`.
- `limitation` deadlines are treated as high-risk and are clearly distinguishable from ordinary procedural
  deadlines — a missed limitation is irreversible.

## Determinism & port abstraction

SLA + deadline + limitation math is deterministic via an injected `Clock` port — no ambient `Date.now`, no
production calendar; the same matter + policy always yields the same due dates and stage state. Intake, M13
conversion and settlement submission are idempotent: the source case id is unique per tenant, and re-submission
returns the existing matter/record rather than a duplicate.

## Assumptions

- No production calendar/telephony/SMS/email provider is configured → deterministic `Clock` doubles only; real
  providers deferred behind existing ports, no secrets.
- Matter classification, risk, jurisdiction and forum are human/rule-driven fields — not AI outputs.
- Firm/advocate directory and finance/court identifiers are owned by other systems → configurable declarative
  references; costs/settlement store finance + court **references** only.

## Exclusions (verified out of scope, Framework-Only where deferred)

No finance foundation / general ledger / accounts payable / payment execution / journal posting / tax /
reconciliation / collections accounting; no production court-filing/scraping; no production calendar/telephony/
SMS/email providers; no AI legal research / summarization / drafting / decision-making; no external-counsel or
customer portal; no vendor-management platform; no full regulatory-reporting engine; no M16/M17/M18 internals.

## Implementation gates

format · lint (wiped dist) · build · smoke · conformance · migrations (dry-run + fresh replay) · DB specs ·
API specs · RLS · permissions · audit · events · outbox · idempotency (M13 conversion) · concurrency ·
append-only · maker-checker/SoD · redaction · security negatives · clock/deadline/limitation-determinism ·
contamination. PostgreSQL 16 CI is authoritative.

## Deferred provider integrations

Production notification channels (SMS/email), a real calendar/business-day source behind the `Clock`,
court-filing/scraping and external-counsel systems, and any regulatory-reporting export — all behind existing
ports/contracts; a standing SLA/deadline/limitation/escalation sweeper worker (timer dispatch delegates to
m06/m08).
