# m16-litigation — Enterprise litigation & adjudicative-proceedings management (Stage 4.2)

A **generic, configurable, multi-tenant enterprise litigation platform** — court and tribunal proceedings,
parties and claims, filings and service, appearances and the proceeding record, witnesses, experts and exhibits,
hearing bundles, orders, compliance obligations, outcomes, appeals, deadline and limitation control, litigation
costs and relationships — with a governed lifecycle, SLA/deadlines, escalation, evidence and audit. Nothing is
Kenya-specific: **proceeding types, jurisdictions, forums, courts, tribunals, statutes and procedural rules are
configurable data**, never hardcoded. **Not** a finance/ledger, an accounts-payable or payment engine, an AI legal
researcher, a court e-filing/scraping integration, or a customer/counsel portal. M16 consumes an M14 **matter
referral** through a governed inbound contract — it owns full **adjudicative proceedings**; m14 owns the legal
matter.

## Layers

- **PURE domain** (`src/domain/`): the proceeding + spec state machines (30-state lifecycle, single choke point);
  proceeding-type + SLA-policy spec validation (declarative — no executable expression, ADR-065); deterministic
  clock-driven SLA + deadline + **limitation** math (due dates, warn/breach, offset/explicit rules; limitation
  deadlines treated as high-risk and clearly distinguishable, ADR-066); closure eligibility gate (machine-readable
  reason codes); relationship rules; the shared vocabulary + fail-closed hard limits. Plus deterministic
  `proceeding-number` formatting and a content-hash util.
- **Ports** (`ports.ts`): a `Clock` (SLA + deadline + limitation math take it — no ambient `Date.now`), a
  `MatterReferral` type and a `ProceedingIntakeAdapter` (external systems normalize to safe fields + a payload
  hash). Deterministic test doubles only (`SystemClock`/`FixedClock`) — no real external adapters, no secrets.
- **Persistence** (`migrations/0001_litigation.sql`, **25 tables**, all RLS ENABLE+FORCE + `tenant_isolation`,
  composite `(tenant_id,id)` keys + composite FKs): `litigation_proceeding_type` + `litigation_sla_policy`
  (immutable-after-publish specs, one-active), `litigation_proceeding` (core aggregate; SENSITIVE legal strategy
  fields; 30-state lifecycle), `litigation_referral` (M14 idempotency ledger, one proceeding per referral key),
  `litigation_status_history` + `litigation_assignment_history` (append-only), `litigation_party`,
  `litigation_claim`, `litigation_filing` (maker-checker + SoD CHECK), `litigation_service` (single-winner
  verification), `litigation_appearance`, `litigation_proceeding_record` (append-only), `litigation_witness`,
  `litigation_expert`, `litigation_exhibit` (single-winner admission), `litigation_bundle` (maker-checker + SoD
  CHECK), `litigation_bundle_item`, `litigation_order` (append-only), `litigation_compliance_obligation`,
  `litigation_outcome` (append-only), `litigation_appeal` (one-active per proceeding), `litigation_deadline`,
  `litigation_cost_reference`, `litigation_note` (append-only), `litigation_relationship`. `0002`: NO DELETE
  anywhere; the **7 append-only ledgers** are INSERT+SELECT only.
- **Services**: `CatalogService` (versioned proceeding types + SLA policies), `ProceedingService` (referral intake
  incl. idempotent M14 referral, review, approval-to-file, assignment, the full lifecycle, closure, reopening),
  `LitigationWorkService` (parties, claims, filings maker-checker, service single-winner, appearances, the
  proceeding record, witnesses, experts, exhibits single-winner, bundles maker-checker, orders, compliance,
  outcomes, appeals, deadlines, costs, notes, relationships, analytics). One `M16Emitter` writes audit (m03) +
  events on the **one outbox m06 owns**.
- **API** (`/api/v1/litigation`): audited mutating routes + reads across three controllers (catalog, proceedings,
  litigation). Every mutating route is an audited `@Endpoint` with a permission enforced server-side (default
  deny); views **redact** legal strategy, full pleadings, witness statements, full submissions, private
  witness/party contacts and confidential order/outcome terms.

## Governance

Tenant isolation (RLS FORCE on all 25 tables), default-deny authorization (**56** `litigation.*` permissions,
seeded — **20** privileged, ADR-065), audit via the m03 port (**58** `LITIGATION_` codes, no duplicate audit
table), the single m06 outbox for `litigation.lifecycle` (**36** event types), idempotent M14 referral (one
proceeding per referral key), single-winner service verification + exhibit admission, optimistic concurrency on
every mutation, **maker-checker segregation of duties** on filing + bundle approval (approver ≠ preparer, enforced
in the service AND the DB CHECKs `litigation_filing_sod_ck` / `litigation_bundle_sod_ck`), rule-gated closure with
explainable reason codes, and **litigation privilege/confidentiality minimization** — legal strategy, full
pleadings, witness statements, full submissions, private witness/party contacts and confidential order/outcome
terms are RLS-stored, redacted on read, and never in events/audit (ADR-068).

## Reuse (no duplicate engines)

Workflow (m06), rules (m07), escalation + notifications (m08), documents/evidence/bundles (m09) and the M14 matter
referral are reused **through events/contracts and ports**, never by importing their internals. SLA/deadline/
limitation math is deterministic via a `Clock` port; timer dispatch/escalation is delegated to m06/m08. The
**M14→M16 referral** is fire-and-forget over a governed `MatterReferral` inbound contract + the
`litigation_referral` idempotency ledger (one proceeding per referral key; a matter may be referred several times)
— m16 owns no matter tables and **never reads m14-owned tables**. Litigation costs store **court + finance
references only** — no ledger, no accounts payable, no posting, no payment, no tax, no reconciliation (ADR-067).
Downstream **M17 enforcement** and **M18 knowledge** are reached only by safe boundary events
(`EnforcementReferralReady`, `KnowledgeCandidateCreated`) — no M17/M18 internals (ADR-068).

## Tests

`test/m16-litigation.smoke.ts` (PURE domain), `test/m16-litigation.db-spec.ts` (RLS/grants/append-only/
idempotency/SoD/single-winner/constraints/isolation), `test/m16-services.db-spec.ts` (end-to-end incl.
deterministic deadline/limitation breach, filing + bundle SoD, single-winner service + exhibit, rule-gated
closure, idempotent M14 referral, relationships, redaction, cross-tenant), and
`apps/api/test/api-litigation.db-spec.ts` (HTTP end-to-end). Smoke: `npm run test:smoke`; DB lane:
`npm run test:db` against a real PostgreSQL (CI is PostgreSQL 16, authoritative). ADR-065…068.
