# Stage 4.3 — M17 Enterprise Recovery & Enforcement — Architecture

**Module:** `m17-recovery` · **Package:** `@finapp/m17-recovery` · **Branch:**
`feature/stage-4-3-m17-recovery-enforcement` · **Baseline:** certified Stage 4.2 main `b959298c` (cert PR #27).
**ADRs:** ADR-069…072. (M17 was previously `deferred`; governance PR #28 approved it for build once m14 + m16 were
certified.)

## Purpose & boundary

One generic, multi-tenant **enterprise recovery & enforcement platform** for debt recovery and the enforcement of
adjudicated outcomes — debtors and liable parties, enforceable instruments, recovery strategy, demands and
negotiations, repayment arrangements, enforcement actions (attachment, execution, auction), security realization,
recovery agents, receipts, waivers, write-off recommendations, outcomes, deadline and **limitation** control,
recovery costs and relationships — a governed refer → review → strategise → demand → negotiate → arrange → enforce
→ recover → resolve engine with configurable SLA and deadlines, escalation, evidence and audit. It is **not** a
general ledger, an accounts-receivable or payment engine, a cash-application or reconciliation engine, an
accounting write-off engine, a precedent/knowledge or AI-research tool (M18), a production e-auction/court/
telephony integration, or an external portal (see Exclusions). M17 owns full **recovery cases**; M16 owns the
adjudicative **proceeding** and refers an enforcement outcome inbound. Nothing is Kenya-specific: recovery types,
courts, auctioneers, statutes, notices and enforcement methods are **configurable data**, never hardcoded. It
consumes shared services via kernel tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and owns no shared service.

## Shape (mirrors m07/m08/m09/m12/m13/m14/m16)

- **PURE domain** — recovery + spec state machines; recovery-type spec + SLA-policy spec validation (versioned,
  immutable-after-publish, one-active); deterministic clock/date-driven SLA + deadline + limitation math; closure
  eligibility gate returning machine-readable reason codes; relationship rules. No I/O; exhaustively unit-tested.
- **Clock port** — SLA, deadline and limitation math is deterministic via an injected `Clock` (`SystemClock`/
  `FixedClock`); no ambient `Date.now`, no ambient calendar. `limitation` deadlines are high-risk and clearly
  distinguishable from ordinary procedural deadlines (ADR-070). Decisioning (risk classification, SLA selection,
  closure eligibility) delegates to m07 rules via a recorded `ruleEvaluationId` — rules never mutate recoveries.
- **25 tables** — versioned `recovery_type` + `recovery_sla_policy` (one-active, immutable-after-publish); the
  `recovery_case` core aggregate (SENSITIVE debtor/strategy fields; 29-state lifecycle); `recovery_referral` (M16
  idempotency ledger, one recovery per referral key); append-only `recovery_status_history` +
  `recovery_assignment_history`; parties (debtors/liable parties); `recovery_instrument` (enforceable instruments);
  `recovery_strategy` (append-only); demands; negotiations; `recovery_arrangement` (maker-checker SoD CHECK
  `approved_by <> proposed_by`) + `recovery_installment` (operational schedule metadata, composite FK to the
  arrangement); enforcement actions; security; agents + `recovery_agent_report` (append-only); `recovery_receipt`
  (REFERENCE only, append-only); `recovery_waiver` (append-only); `recovery_writeoff_recommendation` (maker-checker
  SoD CHECK `approved_by <> recommended_by`); `recovery_outcome` (append-only); deadlines, cost references,
  `recovery_note` (append-only), and `recovery_relationship`. All composite `(tenant_id,id)`, RLS ENABLE+FORCE +
  `tenant_isolation`, no-DELETE, append-only ledgers INSERT+SELECT only.
- **Services** — Catalog / Recovery / RecoveryWork, each permissioned + transactional, audit + outbox in the
  business tx via one `M17Emitter`.
- **API** `/api/v1/recovery` — recovery types, SLA policies, referral intake (incl. the M16 enforcement referral),
  review, strategy selection, assignment, the full recovery lifecycle, parties, enforceable instruments,
  strategies, demands, negotiations, arrangements (maker-checker) + installments, enforcement actions, security,
  agents + reports, receipts (references), waivers, write-off recommendations (maker-checker), outcomes, deadlines,
  costs, notes, relationships, closure/reopening, analytics.

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| Configurable config + inbound contract | recovery types + SLA policies are declarative versioned data; recovery types, courts, auctioneers, statutes, notices and enforcement methods are tenant-configurable — nothing Kenya-specific in core; decisioning delegated to m07 via a recorded `ruleEvaluationId`; the M16→M17 boundary is a governed `EnforcementReferral` inbound contract + `/recovery/from-proceeding`, idempotent on a referral key (one recovery per key; a proceeding may produce several referrals), and m17 never reads m16/m14-owned tables (ids are opaque references) | 069 |
| Deterministic time | SLA + deadline + limitation math is deterministic via a `Clock` port; no ambient `Date.now`, no production calendar; `limitation` deadlines high-risk + distinguishable; hard limits fail-closed; 25 tables (the recovery as a first-class object, distinct from an M16 proceeding's enforcement fields); timers delegate to m06/m08 | 070 |
| Finance references only | M17 stores ALL amounts as **references** only — no cash application, general ledger, accounts receivable, payment execution, reconciliation or accounting write-off; installments are operational schedule metadata (met/missed markers, not payments); receipts are reference records; write-off is a recommendation with maker-checker approval; arrangement approval is maker-checker (both DB CHECKs) | 071 |
| Privilege/confidentiality + controls | debtor/party contacts, negotiation strategy, settlement terms, bank/payment details and security valuations stored under RLS, REDACTED on read behind privileged permissions, and NEVER in events/audit; maker-checker on arrangement + write-off (approver ≠ proposer/recommender, DB CHECKs); downstream M18 reached only by safe boundary signals | 072 |

## Integration (reuse, no duplicate engines)

m06 workflow orchestrates review/approval/closure gates and owns the single outbox; m07 rules consume typed
recovery facts (type, risk, jurisdiction, instrument — never raw negotiation strategy or debtor contact) for risk
classification, SLA selection and closure eligibility via a recorded `ruleEvaluationId`; m08 sends notifications
and drives escalation (no second escalation engine); m09 documents + evidence attach demand letters, agreements
and supporting material by reference (no bytes) — all through events/contracts and ports, never by importing their
internals. A notification/escalation failure never mutates a committed arrangement or an approved write-off
recommendation. M17 **consumes** the M16 enforcement referral through a governed `EnforcementReferral` inbound
contract (`POST /recovery/from-proceeding`), fire-and-forget, creating exactly one recovery idempotently via the
`recovery_referral` ledger keyed on `referral_key` — a single proceeding may produce several referrals, yielding
several recoveries; **m17 never reads m16/m14-owned tables** (the proceeding/matter ids are opaque references) and
emits `RecoveryReferredFromProceeding`. Downstream **M18 knowledge** is reached only by safe boundary signals — no
M18 internals (precedent repository / knowledge graph / AI). The one family `recovery.lifecycle` (36 event types,
version 1) flows through the single m06 outbox (contracts `DOMAIN_EVENT_FAMILIES` grew 13 → 14).
