# Stage 4.2 — M16 Enterprise Litigation Management — Readiness

**Verdict: GO** (built on certified Stage 4.1 baseline `b6660a03`, cert PR #25; all dependencies merged +
certified on main).

## Dependencies available

- **kernel** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02-identity** — real RBAC (`RbacAuthz`) + the `permissions` catalogue m16 seeds into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port). ✅
- **m06-workflow** — owns the single outbox; m16 publishes `litigation.lifecycle` through it; review/approval/
  closure orchestration and SLA timer dispatch delegate here. ✅
- **m07-rules** — consumes typed proceeding facts for risk classification, SLA selection and closure eligibility
  via a recorded `ruleEvaluationId` (declarative delegation, ADR-065); rules never mutate proceedings. ✅
- **m08-escalation** — notifications + escalation reused through events/contracts (no second escalation engine). ✅
- **m09-docs** — pleadings + supporting documents + evidence + bundles attached by reference (no bytes) through
  events/contracts. ✅
- **m14-legal** — the governed M14→M16 matter referral consumed fire-and-forget through the `MatterReferral`
  inbound contract; m16 never reads m14-owned tables. ✅
- Test harness, migrate tool (m16-litigation in `module-order`), conformance. ✅

## The M14 referral boundary

M16 consumes the M14 matter referral through a governed **inbound contract** (`MatterReferral` port + `POST
/litigation/from-matter`) and creates exactly **one** proceeding, idempotent via `litigation_referral` keyed on
`referral_key` + tenant. It preserves the source matter id + correlation/causation and emits
`ProceedingReferredFromMatter`. The referral is **fire-and-forget**; duplicate referrals on the same key create
**no second proceeding** — re-delivery returns the existing proceeding. A single matter **may be referred several
times** (several proceedings), each on its own referral key. **m16 never reads m14-owned tables.**

## Proceeding-type configuration & litigation boundary

Proceeding types, jurisdictions, forums, courts, tribunals, statutes and procedural rules are **configurable
data**, published as versioned immutable-after-publish specs (one-active). Nothing is Kenya-specific in core logic.
M16 owns full adjudicative proceedings; litigation costs store court + finance **references** only, and M16 reaches
no posting, payment or accounting conclusion.

## Integration seams

- **workflow (m06)** — review/approval/closure gates + the single outbox.
- **rules (m07)** — risk classification, SLA selection, closure eligibility via `ruleEvaluationId`; rules never
  mutate proceedings.
- **escalation/notifications (m08)** — reused through events; no second escalation engine.
- **documents/evidence/bundles (m09)** — pleadings + supporting material + exhibit bundles attached by reference
  only; no bytes, no document storage refs in API responses.

## Security & privacy boundaries

- Legal strategy, full pleadings, witness statements, full submissions, private witness/party contacts and
  confidential order/outcome terms are SENSITIVE: stored under RLS, REDACTED on read unless the caller holds the
  dedicated privileged `litigation.*` permission, and never placed in events or audit payloads — which carry ids,
  states, dates and safe reason codes only (ADR-068).
- Every endpoint enforces its three-segment `litigation.*` RBAC permission; the **20** privileged permissions
  (strategy / pleadings / witness-statements / submissions / witness-contact / party-contact / confidential-terms /
  filing-approve / bundle-approve / config / platform) are default-deny; no wildcard.
- Maker-checker on filing + bundle: the preparer cannot be the approver (segregation of duties), enforced in the
  service AND the DB CHECKs `litigation_filing_sod_ck` / `litigation_bundle_sod_ck`.
- Single-winner CAS on service verification (`verification_status`) and exhibit admission (`admitted_status`) — no
  two winners.
- `limitation` deadlines are treated as high-risk and are clearly distinguishable from ordinary procedural
  deadlines — a missed limitation is irreversible.

## Determinism & port abstraction

SLA + deadline + limitation math is deterministic via an injected `Clock` port — no ambient `Date.now`, no
production calendar; the same proceeding + policy always yields the same due dates and stage state. Referral
intake, the M14 referral and controlled actions are idempotent: the referral key is unique per tenant, and re-
submission returns the existing proceeding/record rather than a duplicate.

## Assumptions

- No production calendar/telephony/SMS/email provider is configured → deterministic `Clock` doubles only; real
  providers deferred behind existing ports, no secrets.
- Proceeding classification, risk, jurisdiction and forum are human/rule-driven fields — not AI outputs.
- Forum/court/tribunal directory and finance/court identifiers are owned by other systems → configurable
  declarative references; costs store court + finance **references** only.

## Exclusions (verified out of scope, Framework-Only where deferred)

No M17 internals (recovery / enforcement allocation / debtor ledger / payment plans / attachment / auction /
garnishee / collections accounting); no M18 internals (precedent repository / knowledge graph / AI research /
summarization / drafting); no finance foundation / general ledger / accounts payable / journal posting / payment /
reconciliation; no production e-filing / court scraping / court calendar / telephony / email/SMS; no AI legal
research / summarization / drafting / decisioning; no external-counsel or customer or witness portal; no vendor-
management platform; no full regulatory-reporting engine.

## Implementation gates

format · lint (wiped dist) · build · smoke · conformance · migrations (dry-run + fresh replay) · DB specs ·
API specs · RLS · permissions · audit · events · outbox · idempotency (M14 referral) · concurrency ·
append-only · maker-checker/SoD · single-winner CAS · redaction · security negatives · clock/deadline/limitation-
determinism · contamination. PostgreSQL 16 CI is authoritative.

## Deferred provider integrations

Production notification channels (SMS/email), a real calendar/business-day source behind the `Clock`, court
e-filing/scraping and court-calendar systems, and any regulatory-reporting export — all behind existing ports/
contracts; a standing SLA/deadline/limitation/escalation sweeper worker (timer dispatch delegates to m06/m08).
