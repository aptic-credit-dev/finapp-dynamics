# Stage 4.3 — M17 Enterprise Recovery & Enforcement — Completion Report

**Module:** `m17-recovery` · **Package:** `@finapp/m17-recovery` · **Branch:**
`feature/stage-4-3-m17-recovery-enforcement` · **Baseline:** certified Stage 4.2 main
`b959298cee18601b3768f72285062f776bbc35cb` (cert PR #27). **Status:** implemented on branch; all local gates green,
**not merged** (M17 was approved for build via governance PR #28 — previously `deferred`); the implementation PR +
post-merge certification are the next steps.

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified-pending** = to be observed green on the authoritative PostgreSQL 16 CI lane · **not yet
merged** · **deferred** = documented, out of scope.

## What was built

A generic, multi-tenant **enterprise recovery & enforcement platform** — a governed refer → review → strategise →
demand → negotiate → arrange → enforce → recover → resolve engine for debt recovery and the enforcement of
adjudicated outcomes, debtors and liable parties, enforceable instruments, recovery strategy, demands and
negotiations, repayment arrangements, enforcement actions (attachment, execution, auction), security realization,
recovery agents, receipts, waivers, write-off recommendations, outcomes, deadline and **limitation** control,
recovery costs and relationships. Nothing is Kenya-specific: recovery types, courts, auctioneers, statutes, notices
and enforcement methods are **configurable data**, never hardcoded. It is **not** a general ledger, an accounts-
receivable or payment engine, a cash-application or reconciliation engine, an accounting write-off engine, a
precedent/knowledge or AI-research tool (M18), a production e-auction/court/telephony integration, or an external
portal. M17 owns full **recovery cases**; M16 owns the adjudicative **proceeding** and refers an enforcement
outcome inbound through a governed contract.

- **PURE domain** (`src/domain/`): limits + vocab; the recovery (29-state) + spec state machines; recovery-type
  spec + SLA-policy spec validation (versioned, one-active, immutable-after-publish); deterministic clock/date-
  driven SLA + deadline + limitation math; the closure eligibility gate (machine-readable reason codes);
  relationship rules.
- **Clock port** (`ports.ts`): SLA + deadline + limitation math is deterministic via an injected `Clock`
  (`SystemClock` + `FixedClock`) — no ambient `Date.now`, no ambient calendar; `limitation` deadlines are
  high-risk and clearly distinguishable (`isLimitation` / `isLimitationSafe`); timer dispatch + escalation delegate
  to m06/m08. Decisioning (risk classification, SLA selection, closure eligibility) delegates to m07 rules via a
  recorded `ruleEvaluationId` — **rules never mutate a recovery**. The M16 enforcement referral is consumed
  fire-and-forget through the `EnforcementReferral` inbound contract; m17 never reads m16/m14 tables (the ids are
  opaque references).
- **Persistence** (`0001`/`0002`, **25 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs, **NO DELETE grant anywhere**): `recovery_type`, `recovery_sla_policy`
  (versioned, one-active per code+scope, immutable-after-publish), `recovery_case` (core aggregate; SENSITIVE
  debtor/strategy fields; 29-state lifecycle CHECK), `recovery_referral` (M16 idempotency ledger keyed on
  `referral_key`, one recovery per key), `recovery_status_history`, `recovery_assignment_history`, `recovery_party`
  (debtors/liable parties), `recovery_instrument` (enforceable instruments), `recovery_strategy`, `recovery_demand`,
  `recovery_negotiation`, `recovery_arrangement` (maker-checker + the `recovery_arrangement_sod_ck` DB CHECK
  `approved_by <> proposed_by`), `recovery_installment` (operational schedule metadata; composite FK to the
  arrangement), `recovery_enforcement_action`, `recovery_security`, `recovery_agent`, `recovery_agent_report`,
  `recovery_receipt` (REFERENCE only), `recovery_waiver`, `recovery_writeoff_recommendation` (maker-checker + the
  `recovery_writeoff_recommendation_sod_ck` DB CHECK `approved_by <> recommended_by`), `recovery_outcome`,
  `recovery_deadline`, `recovery_cost_reference`, `recovery_note`, `recovery_relationship`. **9 append-only
  ledgers** (`recovery_referral`, `recovery_status_history`, `recovery_assignment_history`, `recovery_strategy`,
  `recovery_agent_report`, `recovery_receipt`, `recovery_waiver`, `recovery_outcome`, `recovery_note`) are
  INSERT+SELECT only.
- **Services**: `CatalogService` (versioned recovery types + SLA policies), `RecoveryService` (referral intake
  incl. idempotent M16 referral, review, strategy selection, assignment, the full lifecycle, closure, reopening),
  `RecoveryWorkService` (parties, instruments, strategies, demands, negotiations, arrangements maker-checker +
  installments, enforcement actions, security, agents + reports, receipts, waivers, write-off recommendations
  maker-checker, outcomes, deadlines, costs, notes, relationships, analytics). One `M17Emitter` writes audit (m03)
  + events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/recovery`): recovery types, SLA policies, referral intake (incl. M16 referral), review,
  strategy selection, assignment, the full recovery lifecycle, parties, instruments, strategies, demands,
  negotiations, arrangements (maker-checker) + installments, enforcement actions, security, agents + reports,
  receipts (references), waivers, write-off recommendations (maker-checker), outcomes, deadlines, costs, notes,
  relationships, closure/reopening, analytics across three controllers (catalog, recoveries, recovery). Every
  mutating route declares a permission (default deny); sensitive fields redacted in views.

## Scope

| Fact | Value |
|---|---|
| Source added | `packages/m17-recovery` (domain, ports, repository, emit, 3 services) + `apps/api/src/recovery` (views + 3 controllers + module) + registries/contracts/tests/docs |
| Migrations | **2** for m17 (`0001`, `0002`); **28** total in the repo, m17 last |
| Tables created | **25** |
| Permissions added | **58** (`recovery.*` three-segment; **20** privileged incl. debtor-contact / party-contact / negotiation-strategy / settlement-terms / bank-details / security-valuation / arrangement-approve / writeoff-approve / config / platform) — seeded |
| Audit codes added | **55** (`RECOVERY_*` SCREAMING_SNAKE, all ≥ 3 segments) |
| Events added | **ONE** family — `recovery.lifecycle` (**36** event types, version 1); contracts `DomainEvent` union / `DOMAIN_EVENT_FAMILIES` **13 → 14** families |
| Services / controllers | **3** services (Catalog / Recovery / RecoveryWork); **3** controllers (catalog, recoveries, recovery) |
| Lifecycle | **29** recovery states (`draft`, `referred`, `under_review`, `strategy_selection`, `demand_issued`, `awaiting_response`, `negotiation`, `arrangement_pending`, `arrangement_active`, `arrangement_default`, `enforcement_pending`, `enforcement_active`, `attachment`, `execution`, `auction`, `security_realization`, `agent_recovery`, `partial_recovery`, `recovered`, `write_off_recommended`, `written_off`, `uncollectible`, `settled`, `suspended`, `resolved`, `closed`, `reopened`, `withdrawn`, `archived`); explicit transitions, append-only `recovery_status_history` evidence; `archived` is terminal |
| ADRs | ADR-069…072 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **25** tables; composite `(tenant_id,id)` keys + composite FKs; asserted through the non-owner app role (`finapp_app`). |
| Authorization | Default-deny; every mutation `authz.require`s its three-segment `recovery.*` permission; a header cannot grant authority (proven over HTTP). **20** privileged permissions gate debtor-contact/party-contact/negotiation-strategy/settlement-terms/bank-details/security-valuation/arrangement-approve/writeoff-approve/config surfaces. |
| Sensitivity / redaction | Debtor/party contacts, negotiation strategy, settlement terms, bank/payment details and security valuations stored under RLS, REDACTED on read unless the caller holds the dedicated privileged permission; reading un-redacted privileged data is itself audited; NEVER in events or audit payloads (ids, states, dates and safe reason codes only); no document storage references in API responses (ADR-072). |
| Maker-checker / SoD | Arrangement + write-off approval require proposer/recommender ≠ approver, enforced in `RecoveryWorkService` AND the DB CHECKs `recovery_arrangement_sod_ck` (`approved_by <> proposed_by`) / `recovery_writeoff_recommendation_sod_ck` (`approved_by <> recommended_by`); self-approve → 409, an independent approver succeeds (proven in services + HTTP specs). |
| Immutability | Published recovery-type + SLA-policy specs frozen (one-active per code+scope, immutable-after-publish); referral/status/assignment/strategy/agent-report/receipt/waiver/outcome/note ledgers append-only. |
| Versioned specs | Recovery types + SLA policies are versioned with exactly one ACTIVE version; declarative config; decisioning delegated to m07 via a recorded `ruleEvaluationId` — rules never mutate a recovery (ADR-069). |
| Deterministic SLA / deadlines / limitation | SLA start materializes stage deadlines (no bespoke SLA-instance table); all dates computed from an injected `Clock` — no ambient `Date.now` (ADR-070); a `FixedClock` proves deterministic deadline + limitation breach; `limitation` deadlines are high-risk + distinguishable; timer dispatch/escalation delegate to m06/m08. |
| Finance references only | M17 stores **ALL amounts as references** only (integer minor units as reference data) — no cash application, general ledger, accounts receivable, payment execution, reconciliation or accounting write-off; installments are operational schedule metadata (met/missed markers, not payments); receipts are reference records; write-off is a recommendation with maker-checker approval (ADR-071). |
| M16 referral | Fire-and-forget over the `EnforcementReferral` inbound contract; idempotent single-recovery creation via the `recovery_referral` unique ledger keyed on `referral_key`; preserves the source proceeding id + optional matter id + correlation/causation; m17 **never reads m16/m14-owned tables** (opaque references); a proceeding may produce several referrals (several recoveries). Duplicate referrals on a key create no second recovery. |
| Downstream boundaries | M18 knowledge reached only by safe boundary signals — no M18 internals (precedent repository / knowledge graph / AI) crossed. |
| Append-only evidence | The 9 ledgers INSERT+SELECT only (0 UPDATE grant); NO DELETE on any m17 table. |
| Idempotency | DB-enforced on recovery-number and the M16 referral (unique `recovery_referral` ledger); conflict → existing recovery. |
| Single outbox | m17 owns no outbox; publishes `recovery.lifecycle` through m06's outbox. |
| Sensitive-data minimisation | Audit + events carry ids, states, dates and safe reason codes only — never debtor contacts, negotiation strategy, settlement terms, bank/payment details or security valuations (ADR-072). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean (**exit 0**). **Lint:** `eslint` **0 errors** (**60** style warnings, matching the
  certified baseline pattern), on a wiped `dist`. **Format:** `prettier --check` clean.
- **Smoke lane (tested locally):** **20 suites, 3709 assertions, 0 failed** — including `m17-recovery` (**72**),
  `conformance` (**1910**, validating every `@Endpoint` permission + audit code against the registries, the RLS
  convention over the new migrations, `registered_code_count`=len(codes), and the newly-registered
  `recovery.lifecycle` family), and `migrate` (**28**).
- **Migrations (tested locally):** **28** in dependency order, applied on a fresh PostgreSQL from an empty database
  (dry-run + fresh replay); m17 last.
- **DB + API lane (tested locally, real PostgreSQL 15.2, roles `finapp_app` + `finapp_owner`):** **37 specs, 1075
  assertions, 0 failed** — `m17-recovery.db-spec` (**41**), `m17-services.db-spec` (**34**),
  `api-recovery.db-spec` (**22** HTTP end-to-end), and the whole prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **CI-verified-pending** at the
  time of writing.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**.

## Live DB governance verified

25/25 recovery tables RLS ENABLE+FORCE + `tenant_isolation` + composite `(tenant_id,id)` PK; **0 DELETE grants**
for the app role; the 9 append-only ledgers have **0 UPDATE grant**; **24** composite FKs; **58** permissions
seeded (**20** privileged); recovery-number + M16-referral idempotency uniqueness; one-active recovery-type/
SLA-policy; arrangement + write-off SoD CHECKs (`recovery_arrangement_sod_ck` / `recovery_writeoff_recommendation_sod_ck`);
installment composite FK to the arrangement; relationship self-edge CHECK + composite FK; only
`workflow_event_outbox` exists (**m17 owns no outbox**).

## Limitations (deferred, documented — not defects)

- **No M18 internals** — precedent repository / knowledge graph / AI research / summarization / drafting remain the
  downstream M18 stage; m17 emits only safe boundary signals.
- **No finance foundation / general ledger / accounts receivable / cash application / payment execution /
  reconciliation / accounting write-offs** — M17 stores ALL amounts as references only (ADR-071); the finance
  foundation is a later stage. Repayment arrangements are operational schedule metadata (met/missed), receipts are
  reference records, and write-off is a maker-checker recommendation that a human/finance system executes.
- **No production e-auction / court integration / telephony/SMS/email providers** — timer dispatch + notifications
  delegate to m06/m08 (Framework Only).
- **No AI** — classification and decisioning are human/rule-driven (m07), never AI outputs.
- **No external portals, no vendor-management platform, no later modules.**

## Spec divergence (recorded)

This implementation lands at **25 tables**, making the recovery a first-class object — distinct from an M16
proceeding's enforcement fields — with its own versioned recovery types + SLA policies, the M16 referral ledger,
status + assignment ledgers, and the full recovery/enforcement work surface. The scope decisions (25 tables; the
recovery as a first-class object; the governed M16→M17 inbound contract; the references-only finance boundary;
M18/AI/portal excluded) are captured in **ADR-069…072** and this report.

## Scope discipline (contamination)

Only `m17-recovery` (+ its API wiring, registries, contracts family, tests, docs) was built. No M18 internals,
finance, general-ledger, accounts-receivable, cash-application, payment, reconciliation, accounting write-off,
e-auction/court integration or AI implementation; m17 reads none of m16's or m14's tables (the referral flows
fire-and-forget through the `EnforcementReferral` inbound contract). No shared platform service was duplicated; no
second outbox; no duplicate audit table; no second RBAC or escalation engine. The manifest change is confined to
the m17 block. The implementation is on the branch; it is **not merged** — the PR + post-merge PostgreSQL 16
certification are the next steps.
