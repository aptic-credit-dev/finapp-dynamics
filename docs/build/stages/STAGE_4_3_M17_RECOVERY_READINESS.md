# Stage 4.3 — M17 Enterprise Recovery & Enforcement — Readiness

**Verdict: GO** (built on certified Stage 4.2 baseline `b959298c`, cert PR #27; all dependencies merged +
certified on main; M17 approved for build via governance PR #28 — was `deferred`).

## Dependencies available

- **kernel** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02-identity** — real RBAC (`RbacAuthz`) + the `permissions` catalogue m17 seeds into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port). ✅
- **m06-workflow** — owns the single outbox; m17 publishes `recovery.lifecycle` through it; review/approval/
  closure orchestration and SLA timer dispatch delegate here. ✅
- **m07-rules** — consumes typed recovery facts for risk classification, SLA selection and closure eligibility
  via a recorded `ruleEvaluationId` (declarative delegation, ADR-069); rules never mutate recoveries. ✅
- **m08-escalation** — notifications + escalation reused through events/contracts (no second escalation engine). ✅
- **m09-docs** — demand letters + agreements + evidence attached by reference (no bytes) through events/contracts. ✅
- **m16-litigation** — the governed M16→M17 enforcement referral consumed fire-and-forget through the
  `EnforcementReferral` inbound contract; m17 never reads m16-owned (or m14-owned) tables. ✅
- Test harness, migrate tool (m17-recovery in `module-order`), conformance. ✅

## The M16 referral boundary

M17 consumes the M16 enforcement referral through a governed **inbound contract** (`EnforcementReferral` port +
`POST /recovery/from-proceeding`) and creates exactly **one** recovery, idempotent via `recovery_referral` keyed on
`referral_key` + tenant. It preserves the source proceeding id + optional matter id + correlation/causation and
emits `RecoveryReferredFromProceeding`. The referral is **fire-and-forget**; duplicate referrals on the same key
create **no second recovery** — re-delivery returns the existing recovery. A single proceeding **may produce
several referrals** (several recoveries), each on its own referral key. **m17 never reads m16/m14-owned tables** —
the proceeding/matter ids are opaque references.

## Recovery-type configuration & finance boundary

Recovery types, courts, auctioneers, statutes, notices and enforcement methods are **configurable data**, published
as versioned immutable-after-publish specs (one-active). Nothing is Kenya-specific in core logic. M17 owns full
recovery cases; it stores **ALL amounts as references only** and reaches no cash application, general ledger,
accounts receivable, payment execution, reconciliation or accounting write-off. Repayment arrangements are
operational schedule metadata (installments are met/missed markers, not payments); receipts are reference records;
write-off is a recommendation with maker-checker approval.

## Integration seams

- **workflow (m06)** — review/approval/closure gates + the single outbox.
- **rules (m07)** — risk classification, SLA selection, closure eligibility via `ruleEvaluationId`; rules never
  mutate recoveries.
- **escalation/notifications (m08)** — reused through events; no second escalation engine.
- **documents/evidence (m09)** — demand letters + agreements + supporting material attached by reference only; no
  bytes, no document storage refs in API responses.

## Security & privacy boundaries

- Debtor/party contacts, negotiation strategy, settlement terms, bank/payment details and security valuations are
  SENSITIVE: stored under RLS, REDACTED on read unless the caller holds the dedicated privileged `recovery.*`
  permission, and never placed in events or audit payloads — which carry ids, states, dates and safe reason codes
  only (ADR-072).
- Every endpoint enforces its three-segment `recovery.*` RBAC permission; the **20** privileged permissions
  (debtor-contact / party-contact / negotiation-strategy / settlement-terms / bank-details / security-valuation /
  arrangement-approve / writeoff-approve / config / platform) are default-deny; no wildcard.
- Maker-checker on arrangement + write-off: the proposer/recommender cannot be the approver (segregation of
  duties), enforced in the service AND the DB CHECKs `recovery_arrangement_sod_ck` (`approved_by <> proposed_by`) /
  `recovery_writeoff_recommendation_sod_ck` (`approved_by <> recommended_by`).
- `limitation` deadlines are treated as high-risk and are clearly distinguishable from ordinary procedural
  deadlines — a missed limitation is irreversible.

## Determinism & port abstraction

SLA + deadline + limitation math is deterministic via an injected `Clock` port — no ambient `Date.now`, no
production calendar; the same recovery + policy always yields the same due dates and stage state. Referral intake,
the M16 referral and controlled actions are idempotent: the referral key is unique per tenant, and re-submission
returns the existing recovery/record rather than a duplicate.

## Assumptions

- No production calendar/telephony/SMS/email provider is configured → deterministic `Clock` doubles only; real
  providers deferred behind existing ports, no secrets.
- Recovery classification, risk, jurisdiction and instrument type are human/rule-driven fields — not AI outputs.
- Court/auctioneer/agent directory and finance identifiers are owned by other systems → configurable declarative
  references; ALL amounts are stored as **references** only.

## Exclusions (verified out of scope, Framework-Only where deferred)

No M18 internals (precedent repository / knowledge graph / AI research / summarization / drafting); no finance
foundation / general ledger / accounts receivable / cash application / payment processing / reconciliation /
accounting write-offs; no production e-auction / court integration / telephony / email/SMS; no AI; no external
portals; no vendor-management platform; no later modules.

## Implementation gates

format · lint (wiped dist) · build · smoke · conformance · migrations (dry-run + fresh replay) · DB specs ·
API specs · RLS · permissions · audit · events · outbox · idempotency (M16 referral) · concurrency ·
append-only · maker-checker/SoD · redaction · security negatives · clock/deadline/limitation-determinism ·
contamination. PostgreSQL 16 CI is authoritative.

## Deferred provider integrations

Production notification channels (SMS/email), a real calendar/business-day source behind the `Clock`, production
e-auction, court and telephony systems, and any external portal — all behind existing ports/contracts; a standing
SLA/deadline/limitation/escalation sweeper worker (timer dispatch delegates to m06/m08).
