# m17-recovery — Enterprise recovery & enforcement management (Stage 4.3)

A **generic, configurable, multi-tenant enterprise recovery & enforcement platform** — debt recovery and the
enforcement of adjudicated outcomes, debtors and liable parties, enforceable instruments, recovery strategy,
demands and negotiations, repayment arrangements, enforcement actions (attachment, execution, auction), security
realization, recovery agents, receipts, waivers, write-off recommendations, outcomes, deadline and limitation
control, recovery costs and relationships — with a governed lifecycle, SLA/deadlines, escalation, evidence and
audit. Nothing is Kenya-specific: **recovery types, courts, auctioneers, statutes, notices and enforcement methods
are configurable data**, never hardcoded. **Not** a finance/ledger, an accounts-receivable, cash-application,
payment or reconciliation engine, an accounting write-off engine, an AI legal researcher, a production e-auction/
court integration, or an external portal. M17 consumes an M16 **enforcement referral** through a governed inbound
contract — it owns full **recovery cases**; m16 owns the adjudicative proceeding.

## Layers

- **PURE domain** (`src/domain/`): the recovery + spec state machines (29-state lifecycle, single choke point);
  recovery-type + SLA-policy spec validation (declarative — no executable expression, ADR-069); deterministic
  clock-driven SLA + deadline + **limitation** math (due dates, warn/breach, offset/explicit rules; limitation
  deadlines treated as high-risk and clearly distinguishable, ADR-070); closure eligibility gate (machine-readable
  reason codes); relationship rules; the shared vocabulary + fail-closed hard limits. Plus deterministic
  `recovery-number` formatting and a content-hash util.
- **Ports** (`ports.ts`): a `Clock` (SLA + deadline + limitation math take it — no ambient `Date.now`), an
  `EnforcementReferral` type and a `RecoveryIntakeAdapter` (external systems normalize to safe fields + a payload
  hash). Deterministic test doubles only (`SystemClock`/`FixedClock`) — no real external adapters, no secrets.
- **Persistence** (`migrations/0001_recovery.sql`, **25 tables**, all RLS ENABLE+FORCE + `tenant_isolation`,
  composite `(tenant_id,id)` keys + composite FKs): `recovery_type` + `recovery_sla_policy` (immutable-after-publish
  specs, one-active), `recovery_case` (core aggregate; SENSITIVE debtor/strategy fields; 29-state lifecycle),
  `recovery_referral` (M16 idempotency ledger, one recovery per referral key), `recovery_status_history` +
  `recovery_assignment_history` (append-only), `recovery_party`, `recovery_instrument` (enforceable instruments),
  `recovery_strategy` (append-only), `recovery_demand`, `recovery_negotiation`, `recovery_arrangement`
  (maker-checker + SoD CHECK), `recovery_installment` (operational schedule metadata; composite FK to the
  arrangement), `recovery_enforcement_action`, `recovery_security`, `recovery_agent`, `recovery_agent_report`
  (append-only), `recovery_receipt` (REFERENCE only, append-only), `recovery_waiver` (append-only),
  `recovery_writeoff_recommendation` (maker-checker + SoD CHECK), `recovery_outcome` (append-only),
  `recovery_deadline`, `recovery_cost_reference`, `recovery_note` (append-only), `recovery_relationship`. `0002`:
  NO DELETE anywhere; the **9 append-only ledgers** are INSERT+SELECT only.
- **Services**: `CatalogService` (versioned recovery types + SLA policies), `RecoveryService` (referral intake
  incl. idempotent M16 referral, review, strategy selection, assignment, the full lifecycle, closure, reopening),
  `RecoveryWorkService` (parties, instruments, strategies, demands, negotiations, arrangements maker-checker +
  installments, enforcement actions, security, agents + reports, receipts, waivers, write-off recommendations
  maker-checker, outcomes, deadlines, costs, notes, relationships, analytics). One `M17Emitter` writes audit (m03)
  + events on the **one outbox m06 owns**.
- **API** (`/api/v1/recovery`): audited mutating routes + reads across three controllers (catalog, recoveries,
  recovery). Every mutating route is an audited `@Endpoint` with a permission enforced server-side (default deny);
  views **redact** debtor/party contacts, negotiation strategy, settlement terms, bank/payment details and security
  valuations.

## Governance

Tenant isolation (RLS FORCE on all 25 tables), default-deny authorization (**58** `recovery.*` permissions,
seeded — **20** privileged, ADR-069), audit via the m03 port (**55** `RECOVERY_` codes, no duplicate audit table),
the single m06 outbox for `recovery.lifecycle` (**36** event types), idempotent M16 referral (one recovery per
referral key), optimistic concurrency on every mutation, **maker-checker segregation of duties** on arrangement +
write-off approval (approver ≠ proposer/recommender, enforced in the service AND the DB CHECKs
`recovery_arrangement_sod_ck` / `recovery_writeoff_recommendation_sod_ck`), rule-gated closure with explainable
reason codes, and **recovery privilege/confidentiality minimization** — debtor/party contacts, negotiation
strategy, settlement terms, bank/payment details and security valuations are RLS-stored, redacted on read, and
never in events/audit (ADR-072).

## Reuse (no duplicate engines)

Workflow (m06), rules (m07), escalation + notifications (m08), documents/evidence (m09) and the M16 enforcement
referral are reused **through events/contracts and ports**, never by importing their internals. SLA/deadline/
limitation math is deterministic via a `Clock` port; timer dispatch/escalation is delegated to m06/m08. The
**M16→M17 referral** is fire-and-forget over a governed `EnforcementReferral` inbound contract + the
`recovery_referral` idempotency ledger (one recovery per referral key; a proceeding may produce several referrals)
— m17 owns no proceeding/matter tables and **never reads m16/m14-owned tables** (the ids are opaque references).
M17 stores **ALL amounts as references only** — no cash application, no general ledger, no accounts receivable, no
payment, no reconciliation, no accounting write-off; installments are operational schedule metadata (met/missed),
receipts are reference records, and write-off is a maker-checker recommendation a human/finance system executes
(ADR-071). Downstream **M18 knowledge** is reached only by safe boundary signals — no M18 internals (ADR-072).

## Tests

`test/m17-recovery.smoke.ts` (PURE domain), `test/m17-recovery.db-spec.ts` (RLS/grants/append-only/idempotency/SoD/
constraints/isolation), `test/m17-services.db-spec.ts` (end-to-end incl. deterministic deadline/limitation breach,
arrangement + write-off SoD, rule-gated closure, idempotent M16 referral, relationships, redaction, cross-tenant),
and `apps/api/test/api-recovery.db-spec.ts` (HTTP end-to-end). Smoke: `npm run test:smoke`; DB lane:
`npm run test:db` against a real PostgreSQL (CI is PostgreSQL 16, authoritative). ADR-069…072.
