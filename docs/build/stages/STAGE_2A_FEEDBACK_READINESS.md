# Stage 2A — Feedback Management System (m12-feedback) — Readiness Assessment

**Design-only. No source code, migrations, tables, APIs, events, or tests are produced by this document.**

Module of record: **`m12-feedback`** (manifest Stage 2, `capability: Feedback Management (closed loop)`).

---

## 1. Baseline statement

This assessment is written against the **unmerged, uncertified** Stage 1D implementation branch.

| Fact | Value |
|---|---|
| Assessment branch | `feature/stage-2a-feedback-readiness` (cut from the Stage 1D branch head) |
| Stage 1D code location | `feature/stage-1d-rbac-authorization`, local head `cb7e5d8` — pushed, **not merged** |
| `origin/main` | `004b2fd` — the **Stage 1C** certification merge (PR #6). It does **not** contain Stage 1D or `m02-rbac`. |
| Stage 1D status | **Implemented on a feature branch, not yet merged or certified.** No certification SHA, no certification PR, no CI run. |

**Consequence for Stage 2A:** the authorization substrate this stage depends on (persistent RBAC, `RbacAuthz`, the RBAC permission catalogue) exists only on an unmerged branch. Stage 2A **implementation** must not begin until Stage 1D is CI-green and merged to `main`, at which point the true baseline SHA is recorded. This readiness document is design analysis only and takes no dependency on a certified artifact.

---

## 2. Business objectives

Aptic contacts customers after completed transactions (loans, micro-lending, trade finance, insurance) to measure service quality and to detect, resolve, and learn from service failures. Stage 2A delivers the **closed-loop Feedback Management System** that turns a raw source-system transaction into a contacted customer, a classified piece of feedback, and — where warranted — an investigated, corrected, management-reviewed, and closed matter, with full evidence.

Business goals:

1. **Coverage** — every eligible transaction is contactable exactly once per campaign, with no duplicate customer contact and no missed high-value relationships.
2. **Closed loop** — negative feedback cannot silently disappear: it is assigned, investigated, corrected, verified, reviewed, and closed, or escalated.
3. **Timeliness** — every matter carries an SLA appropriate to its severity; breaches escalate automatically.
4. **Accountability** — every action is attributable to a proven identity, permissioned, and audited; closure requires an independent reviewer (maker-checker).
5. **Escalation** — serious matters reach the right level (HOD → GM → MD → Risk/Compliance → Legal) on defined triggers, and can be referred into Case/Legal management.
6. **Insight** — dashboards and reports expose sentiment, category trends, SLA performance, repeat complaints, and officer/branch/product breakdowns.
7. **Tenant fit** — configurable per tenant (categories, severity thresholds, SLA clocks, escalation ladders, channels) across Aptic's lending, insurance, and trade-finance lines.

---

## 3. Scope

In scope for Stage 2A (m12-feedback):

- Transaction **ingestion** from source systems (manual upload, API, scheduled sync) with dedup and reconciliation.
- **Campaign** creation, sampling/eligibility, officer assignment, activation/suspension/closure.
- **Customer contact** attempts across approved channels, with outcomes and follow-ups.
- **Feedback capture** (rating, sentiment, category/subcategory, comments, evidence, preferred resolution, consent).
- **Classification** and **severity** (S1–S4) with reassessment/upgrade/downgrade controls.
- **Positive-feedback** and **negative-feedback** workflows (investigation, corrective action, verification, review).
- **Escalation** (manual, severity-, SLA-, repeat-, and risk-driven) up the management ladder.
- **SLA** timers and breach handling.
- **Closure** and **reopening** with the required evidence and controls.
- **Case-management referral** as an event contract (the consumer, m13-case, is a later module).
- **Notifications**, **audit evidence**, **tenant isolation**, **RBAC**, and the **API / DB / event contracts**.
- **Dashboards and reports** (read models).

---

## 4. Out of scope (Stage 2A)

- **Case Management execution** (`m13-case`) — Stage 2A emits the referral event and models the boundary; the case module consumes it later.
- **Legal / litigation / recovery** modules.
- **AI** classification, summarisation, or routing (later AI stages; Stage 2A is deterministic and human-decided).
- **Outbound telephony/SMS/email delivery integrations** — Stage 2A records contact *outcomes* and *requests* notifications through the notification service; it does not implement carriers/gateways.
- **Marketing/testimonial publishing** beyond capturing a consent flag.
- **The shared platform services themselves** (audit spine, workflow/SLA/timeline/outbox, notifications, documents) — these are **prerequisites** (see §15, §26, §29), owned by m03/m06/m08/m09, not by m12.
- **Frontend/React UI** — API-first; dashboards are specified as read models + endpoints, not implemented screens.

---

## 5. Domain model

The domain is a **closed feedback loop** over four bounded contexts, all downstream of the certified platform (m01 tenancy, m02 identity/auth/rbac):

```
 Source systems (ApticOne, Imarisha, AutoBonds, BimaPro, …)
        │  (ingestion adapter, idempotent, dedup)
        ▼
 ┌──────────────────────┐      ┌──────────────────────┐
 │  INTAKE context      │      │  CAMPAIGN context    │
 │  (source transaction │─────▶│  (eligibility,       │
 │   staged + assigned) │      │   sampling, contact  │
 └──────────────────────┘      │   assignment)        │
                               └───────────┬──────────┘
                                           ▼
                               ┌──────────────────────┐
                               │  FEEDBACK context    │  ← the aggregate root
                               │  contact → capture → │
                               │  classify → severity │
                               │  → workflow → close  │
                               └───────────┬──────────┘
                        feedback.escalated │ (event)
                                           ▼
                               ┌──────────────────────┐
                               │  CASE context (m13)  │  (later; contract only)
                               └──────────────────────┘
```

Shared services consumed (per manifest): **m02** (identity/authz), **m03** (audit spine), **m06** (status/workflow/SLA/timeline/outbox/idempotency), **m08** (notify/escalation), **m09** (documents/evidence). Feedback **orchestrates**; it does not re-implement any of these.

Ubiquitous language: *source transaction*, *campaign*, *contact attempt*, *feedback record*, *classification*, *severity*, *escalation*, *corrective action*, *closure*, *reopen*, *activity (timeline entry)*.

---

## 6. Entity catalogue

Proposed tenant-scoped tables (names indicative; all tenant-scoped carry composite `(tenant_id, id)` PKs, RLS FORCE + `tenant_isolation`, and composite FKs — see §23). Reference catalogues are tenant-configurable and mixed-scope (platform defaults + tenant overrides).

| Entity | Purpose | Scope | Key relationships |
|---|---|---|---|
| `feedback_source_transaction` | Staged transaction ingested from a source system | tenant | → campaign, → assigned CSO (membership) |
| `feedback_ingestion_batch` | One upload/sync run; carries counts, failures, reconciliation | tenant | ← source_transaction |
| `feedback_campaign` | A contact drive over eligible transactions | tenant | ← source_transaction, → assignments |
| `feedback_campaign_assignment` | CSO ↔ campaign/transaction assignment | tenant | → membership (m02) |
| `feedback_record` | **Aggregate root** — one feedback matter | tenant | → source_transaction, → membership, → category |
| `feedback_contact_attempt` | One contact try (outcome, channel, notes, follow-up) | tenant | → feedback_record |
| `feedback_category` / `feedback_subcategory` | Configurable taxonomy | mixed (platform defaults + tenant) | ← feedback_record |
| `feedback_classification` | Class + severity + sentiment snapshot (versioned) | tenant | → feedback_record |
| `feedback_assignment` | Responsible officer/department for a negative matter | tenant | → membership / org node (m01) |
| `feedback_escalation` | One escalation step (level, trigger, actor, target) | tenant | → feedback_record |
| `feedback_corrective_action` | Action taken, owner, due, verification | tenant | → feedback_record |
| `feedback_activity` | **Append-only** timeline entry | tenant | → feedback_record |
| `feedback_sla_timer` | SLA clock instance (start, target, pause, breach) | tenant (or owned by m06) | → feedback_record |
| `feedback_closure` | Closure record (summary, reason, reviewer, SLA result) | tenant | → feedback_record |
| `feedback_reopen` | Reopen record (reason, actor, count) | tenant | → feedback_record |
| `feedback_severity_policy` | Tenant severity→SLA→ladder configuration | mixed | referenced by classification |
| `feedback_status_history` | **Append-only** lifecycle transitions | tenant | → feedback_record |
| `feedback_document_link` | Evidence link (to m09 documents) | tenant | → feedback_record, → m09 document |

**Money note:** `transaction_amount` from source systems is stored as **integer minor units + currency** (or exact decimal), never float (CLAUDE.md). Feedback posts no journals; the amount is descriptive/segmentation data only.

---

## 7. Aggregate boundaries

- **`FeedbackRecord` is the aggregate root.** Contact attempts, classifications, assignments, escalations, corrective actions, activities, SLA timers, closures, and reopens are **inside** its consistency boundary; they are only mutated through the root, in one transaction, so invariants (status legality, maker-checker, SLA state) hold atomically.
- **`Campaign`** is a separate aggregate. It references source transactions and produces feedback records but does not own their lifecycle. Cross-aggregate effects (campaign closure vs. open feedback) are eventually consistent via events, not a shared transaction.
- **`SourceTransaction` / `IngestionBatch`** form the intake aggregate — write-once staging, idempotent on `(source_system, source_reference)`.
- **Reference catalogues** (category, severity policy) are configuration aggregates, edited through admin flows, versioned, never mutated by the feedback runtime.
- **Case** is a *foreign* aggregate (m13); Stage 2A only holds a reference id and emits the referral event — no shared transaction, no FK across the module boundary.

Invariant examples the root enforces: a record cannot close while an SLA timer is breaching-unacknowledged; closure reviewer ≠ investigating owner (SoD); a negative matter cannot skip investigation→verification; reopening restores an SLA and re-arms escalation.

---

## 8. State models

Two primary state machines, both server-side, reason-required on adverse/terminal transitions (matching the m01/m02 pattern), fail-closed on unknown transitions.

**Feedback record status:**

```
draft ─contact→ contacting ─capture→ captured ─classify→ classified
classified ─(positive)→ pending_review ─close→ closed
classified ─(negative)→ assigned ─investigate→ investigating
investigating ─action→ action_in_progress ─verify→ verifying
verifying ─(ok)→ pending_review ─close→ closed
verifying ─(fail)→ investigating         (loop)
any(open) ─escalate→ escalated ─(resolved)→ back to prior lane
closed ─reopen→ investigating             (reopen restores SLA)
any(open) ─refer→ referred_to_case (terminal for feedback; case owns it)
any ─cancel→ cancelled (guarded; e.g. duplicate/ineligible)
```

Terminal: `closed`, `cancelled`, `referred_to_case` (with reopen the one guarded exit from `closed`).

**Contact attempt outcome** (per attempt, not a lifecycle): `answered`, `no_answer`, `unreachable`, `wrong_number`, `callback_requested`, `declined`, `alt_channel`. Attempts accumulate; the record’s contact phase ends on `answered`/`declined` or on exhausting the tenant’s max-attempts policy (→ `unreachable_closed` sub-state).

**Campaign status:** `draft → active → suspended ↔ active → closed`.

**Escalation** is modelled as append-only steps plus a current-level field on the record, not a separate machine.

---

## 9. Feedback lifecycle (end-to-end)

1. **Intake** — source transaction staged, deduped, validated, assigned to a CSO.
2. **Campaign** — eligible transactions batched; contact assignments created; ineligible/opted-out excluded.
3. **Contact** — CSO attempts contact; outcomes recorded; follow-ups scheduled until answered/declined/exhausted.
4. **Capture** — rating, sentiment, category, comments, evidence, preferred resolution, consent.
5. **Classify + severity** — class (positive…regulatory/legal risk) and severity S1–S4 assigned; SLA armed.
6. **Route** — positive → review/close lane; negative → assign → investigate → corrective action → verify.
7. **Escalate** — on trigger (severity, SLA, repeat, risk, manual) up the ladder.
8. **Review** — HOD (and above per severity) reviews resolution; maker-checker enforced.
9. **Close** — with summary, action, owner, customer confirmation (where required), SLA result, evidence.
10. **Reopen** (if unresolved) — restores SLA, re-arms escalation, increments reopen count.
11. **Refer** (if serious) — emit `feedback.escalated`/`feedback.referred_to_case`; m13 takes ownership.

---

## 10. Case escalation lifecycle (boundary contract)

Stage 2A does **not** implement cases. It defines the **referral contract** so m13-case can be built independently:

- **Trigger:** classification of `suspected_misconduct`, `suspected_fraud`, or `regulatory_or_legal_risk`; or a manual "refer to case" by an authorised role; or policy (e.g., S1 unresolved past SLA).
- **Emission:** the feedback root, in one transaction, records a `feedback_escalation` of kind `case_referral`, sets status `referred_to_case`, writes an audit code, and publishes `feedback.referred_to_case` (payload: feedback id, tenant, severity, category, summary reference, evidence links, correlation id) **through the transactional outbox (m06)** — the single event path.
- **Consumption:** `m13-case` (manifest: `consumes_events: [feedback.escalated]`) opens a case and links back by reference. No cross-module FK; the link is by id + event, preserving aggregate independence.
- **Return path:** case outcome may (later) re-open or annotate the feedback record via a case→feedback event; Stage 2A reserves the inbound contract but does not implement the consumer.

---

## 11. SLA model

- **Clock instance per matter**, keyed to severity, started at classification (or at negative-lane entry), owned conceptually by **m06** (status/SLA/timeline). Feedback requests timers; m06 tracks and fires.
- **Attributes:** start, target (from severity policy), business-calendar aware (UTC stored, tenant timezone + working calendar applied — CLAUDE.md time rules), pause/resume (e.g., awaiting customer), breach threshold(s) (warn at X%, breach at 100%).
- **Breach handling:** at warn → notification to owner; at breach → auto-escalate one ladder level + notification to owner + supervisor/HOD per policy + audit event. A breach never auto-closes and never auto-resolves.
- **Reopen** restores a fresh SLA per policy (configurable: full clock vs. remainder).
- **Reporting:** SLA met/breached is captured on closure and feeds dashboards.

Because m06 is unbuilt, the SLA engine is a **prerequisite dependency**, not a Stage-2A deliverable (see §26/§29).

---

## 12. Severity model (S1–S4)

| Level | Meaning | Example criteria | Default SLA (illustrative, tenant-configurable) | Ladder floor | Mandatory notify |
|---|---|---|---|---|---|
| **S1** | Critical | Suspected fraud/misconduct, regulatory/legal risk, VIP/high-value, safety | Very short (e.g., hours) | HOD + GM (+ MD on breach) | HOD, GM, Risk/Compliance |
| **S2** | High | Repeat complaint, unresolved negative, material service failure | Short (e.g., 1–2 business days) | Supervisor + HOD | HOD |
| **S3** | Medium | Standard complaint / service request | Medium (e.g., 3–5 business days) | Responsible officer + Supervisor | Supervisor |
| **S4** | Low | Suggestion, minor negative, compliment follow-up | Long / best-effort | Responsible officer | Owner |

Controls: **reassessment** allowed at defined points; **upgrade** is low-friction (any authorised handler); **downgrade** requires a higher role + reason (prevents SLA-gaming); every change is audited and re-arms SLA/escalation. Severity criteria, SLA clocks, and ladder are **tenant configuration** (`feedback_severity_policy`), with platform defaults.

---

## 13. Activity timeline model

- **Append-only** `feedback_activity`, one row per meaningful event, never updated or deleted (mirrors the m01/m02 status-history pattern; tenant-scoped mixed nothing — pure tenant rows).
- Each entry: heading (typed enum), actor (identity), role at time of action, timestamp (UTC), correlation id, structured detail (ids/counts/transitions only — **no secrets, no PII dumps**), optional evidence links.
- Standard headings (extensible): *Customer Contact Attempted, Customer Reached, Callback Scheduled, Feedback Recorded, Complaint Identified, Severity Assigned, Matter Assigned, Internal Response Requested, Internal Response Received, Investigation Started, Corrective Action Recorded, Action Verified, Escalated (level), SLA Warning, SLA Breached, Management Review, Customer Confirmation, Closed, Reopened, Referred to Case.*
- The timeline is the human-readable narrative; the **audit spine (m03)** is the tamper-evident legal record. They are distinct: timeline is a read model for handlers; audit is compliance evidence. Both are written in the same transaction as the change.

---

## 14. Notification model

- Notifications and escalation delivery are owned by **m08-notify** (`notification_templates, notifications, escalations`; `/api/v1/notifications`; `notification.lifecycle`). Feedback **requests** notifications; it does not template or deliver them.
- **Triggers:** contact follow-up due, feedback captured, complaint identified, severity assigned/changed, matter assigned, internal response requested/overdue, SLA warn/breach, escalation step, management review requested, closure, reopening, case referral.
- **Recipients** resolved by role/ladder from RBAC + org structure (owner, supervisor, HOD, GM, MD, Risk/Compliance), never by raw address in the feedback module.
- **Channels:** in-app + approved external channels (email/SMS) via m08; Stage 2A records the *intent and outcome reference*, not the transport.
- Because m08 is unbuilt, notifications are a **prerequisite dependency**.

---

## 15. Integration architecture

```
 Source systems ──(adapter)──▶ m12 Intake ──▶ m12 Feedback ──(outbox/m06)──▶ events
                                   │                    │
                                   │                    ├─ audit ──▶ m03 (spine)
                                   │                    ├─ notify ─▶ m08
                                   │                    ├─ docs ───▶ m09 (evidence)
                                   │                    └─ SLA/timeline/status ─▶ m06
                                   └─ reconciliation ◀── source (counts/refs)
```

- **Single event path:** all domain events go through the **m06 transactional outbox** (ADR-004) — no second bus, no second outbox.
- **Shared-service consumption via DI tokens/contracts** (kernel `DB/AUTHZ/AUDIT/OUTBOX`, plus m06/m08/m09 contracts) — never a duplicate implementation.
- **Adapters** per source system are thin, isolate source quirks, and normalise into the intake contract.

**Critical dependency reality:** of `m12`'s five consumed services, only **m02** exists (on an unmerged branch). **m03, m06, m08, m09 are unbuilt** (`AUDIT`/`OUTBOX` are in-memory stand-ins that persist/deliver nothing). This is the dominant readiness constraint (§26, §29).

---

## 16. Source system ingestion

- **Modes:** manual upload (CSV/spreadsheet), API push, scheduled pull/sync.
- **Idempotency:** keyed on `(source_system, source_reference)`; re-ingesting the same transaction is a safe no-op (high-risk action → idempotent per CLAUDE.md).
- **Dedup:** exact (same source ref) and fuzzy candidate flags (same customer + product + date window) surfaced for review, never auto-merged.
- **Validation:** source-system reference present and well-formed; product/branch/department/officer resolve against tenant reference data; amount decimal-safe; contact info present or flagged.
- **Assignment:** to a CSO (tenant membership) by rule (branch/product/round-robin) or manually.
- **Failure handling:** per-row accept/reject with reasons; a batch is partially applied with a failure report; nothing silently dropped.
- **Reconciliation:** batch carries source counts vs. accepted vs. feedback-created; discrepancies reported.
- **Fields ingested:** customer name/contact, transaction reference, product, service type, relationship officer, branch, department, transaction date, amount, source system, assigned CSO.
- **PII:** customer contact data is confidential (data-classification labelled), tenant-isolated, minimised in views/events/audit (ids and references, not raw PII, in events/audit).

---

## 17. API design (catalogue — proposed, not implemented)

Prefix **`/api/v1/feedback`** (manifest `api_ownership`). Every mutating route carries an `@Endpoint({ permission, auditCode })`, resolves the actor via the platform boundary, and is tenant-scoped unless noted. Indicative resources:

| Area | Method + path (illustrative) | Permission |
|---|---|---|
| Intake | `POST /feedback/ingest` (batch), `GET /feedback/ingestions/:id` | `feedback.intake.create` / `.view` |
| Source txns | `GET /feedback/transactions`, `GET /feedback/transactions/:id` | `feedback.transaction.view` |
| Campaigns | `POST /feedback/campaigns`, `PATCH …`, `POST …/activate|suspend|close` | `feedback.campaign.*` |
| Contact | `POST /feedback/records/:id/contact-attempts` | `feedback.contact.record` |
| Records | `POST /feedback/records`, `GET …`, `GET …/:id` | `feedback.record.create|view` |
| Capture/classify | `PATCH /feedback/records/:id/capture`, `…/classify` | `feedback.record.capture|classify` |
| Severity | `POST /feedback/records/:id/severity` | `feedback.severity.set` |
| Assign/investigate | `POST …/assign`, `…/investigate`, `…/corrective-actions` | `feedback.matter.*` |
| Escalate | `POST /feedback/records/:id/escalate` | `feedback.escalation.raise` |
| Review/close | `POST …/review`, `…/close` | `feedback.record.review|close` |
| Reopen | `POST /feedback/records/:id/reopen` | `feedback.record.reopen` |
| Refer to case | `POST /feedback/records/:id/refer` | `feedback.record.refer` |
| Timeline | `GET /feedback/records/:id/activities` | `feedback.record.view` |
| Config | `…/categories`, `…/severity-policies` (admin) | `feedback.config.*` |
| Reports | `GET /feedback/reports/*`, `GET /feedback/dashboards/*` | `feedback.report.view` |

All mutations require optimistic concurrency (`expectedVersion`), like m01/m02. Closure/reopen enforce maker-checker server-side.

---

## 18. Event catalogue (proposed)

Family **`feedback.lifecycle`** (manifest `event_ownership`), version 1, published via the m06 outbox. Indicative types:

`FeedbackIngested, CampaignCreated, CampaignActivated, CampaignSuspended, CampaignClosed, ContactAttempted, CustomerReached, FeedbackCaptured, FeedbackClassified, SeverityAssigned, SeverityChanged, MatterAssigned, InvestigationStarted, CorrectiveActionRecorded, ActionVerified, FeedbackEscalated, SlaWarned, SlaBreached, ManagementReviewRequested, FeedbackClosed, FeedbackReopened, FeedbackReferredToCase.`

Cross-module contract event: **`feedback.referred_to_case`** (consumed by m13). All payloads carry tenant id, feedback id, correlation id, classification/severity, and reference ids only (PII-minimised). Family is appended to the contracts `DomainEvent` union at the tail (append-only), registered in `event-registry.yaml`, with `naming-map` parity — same discipline as identity.authorization in Stage 1D.

---

## 19. Permission catalogue (proposed)

Namespace **`feedback.*`** (owner `m12-feedback`), three-segment `feedback.<entity>.<action>` (kernel `PERMISSION_PATTERN`). Indicative set (~25):

`feedback.intake.create/view`, `feedback.transaction.view/assign`, `feedback.campaign.view/create/edit/activate/suspend/close`, `feedback.contact.record`, `feedback.record.create/view/capture/classify/review/close/reopen/refer`, `feedback.severity.set`, `feedback.matter.assign/investigate/act`, `feedback.escalation.raise/view`, `feedback.config.view/manage`, `feedback.report.view`.

Registered in `permission-registry.yaml`; granted through **m02-rbac** roles (CSO, Supervisor, HOD, GM, MD, Risk/Compliance, Feedback Admin). Default-deny; no wildcard grants; no client injection (Stage 1D guarantees). SoD: the close/review permission must be grantable independently of investigate/act so maker-checker can be enforced by role design.

---

## 20. Audit requirements

- Audit prefix **`FEEDBACK_`** (`<PREFIX>_<ENTITY>_<ACTION>`, ≥3 segments), registered in `audit-code-registry.yaml` (unregistered codes fail CI). Indicative: `FEEDBACK_RECORD_CREATED/CLASSIFIED/CLOSED/REOPENED`, `FEEDBACK_SEVERITY_ASSIGNED/CHANGED`, `FEEDBACK_MATTER_ASSIGNED`, `FEEDBACK_ESCALATION_RAISED`, `FEEDBACK_SLA_BREACHED`, `FEEDBACK_REFERRED_TO_CASE`, `FEEDBACK_CAMPAIGN_*`, `FEEDBACK_INGEST_*`.
- Every mutating route is an audited endpoint with a permission and a registered code.
- Audit is written **in the same transaction** as the change, through the kernel `AUDIT` port → **m03 audit spine** (tamper-evident, append-only). Until m03 is real, audit is the in-memory stand-in and **cannot be claimed as tamper-evident** — a hard readiness caveat for any compliance claim.
- Audit detail carries ids/counts/transitions only — never customer PII, never comment bodies.

---

## 21. Reporting requirements

Read models / report endpoints (no BI tool assumed):

- Feedback volume by period, product, branch, department, officer, source system.
- Sentiment/rating distribution and trend.
- Category/subcategory breakdown; complaint rate.
- SLA performance: met vs. breached, by severity/team; time-to-close.
- Escalation frequency and level reached; MD/GM/HOD load.
- Repeat complaints and reopen rate (quality-of-resolution signal).
- Corrective-action completion and verification pass rate.
- Officer/campaign productivity (attempts, reach rate, capture rate).

All reports are tenant-scoped, permissioned (`feedback.report.view`), and PII-minimised (aggregates; drill-down gated by record-view permission).

---

## 22. Dashboard requirements

Role-oriented dashboards (specified as read models + endpoints; UI is out of scope):

- **CSO:** my assigned transactions, contact backlog, follow-ups due, my open matters, my SLA clocks.
- **Supervisor/HOD:** team queue, aging/breaching matters, escalations to me, review queue.
- **GM/MD:** severity heatmap, S1/S2 open, breach trend, referrals to case, repeat-complaint hotspots.
- **Risk/Compliance:** suspected fraud/misconduct/regulatory items, referrals, evidence completeness.
- **Feedback Admin:** campaign status, ingestion health/reconciliation, configuration.

Dashboards are queries over the same tenant-isolated data + read models; no separate data store in Stage 2A.

---

## 23. Multi-tenancy considerations

- Every feedback table is **tenant-scoped**: composite `(tenant_id, id)` PK, composite FKs `(tenant_id, …)`, **RLS FORCE** + `tenant_isolation` policy (`tenant_id = current_setting('app.tenant_id')` with no escape), following the exact m01/m02 pattern.
- **No cross-tenant reference.** Source transactions, campaigns, records, evidence links, activities — all keyed by tenant; RLS proves isolation, not application code.
- **Configuration is per tenant** (categories, severity policy, SLA clocks, ladder, channels, calendars) with platform defaults via mixed-scope reference tables (platform rows `tenant_id NULL`, tenant overrides) — the roles/sod_rules pattern from Stage 1D.
- Global/control-plane additions are avoided; no feedback table belongs on the legitimately-global list without an ADR.
- The application role gets least-privilege grants (no DELETE on lifecycle/append-only tables; retire/close by status, per ADR-010 pattern).

---

## 24. RBAC considerations

- Consumes the Stage 1D **persistent authorization**: `AUTHZ` → `RbacAuthz`, permissions resolved from role assignments at the boundary; feedback services call `authz.require(ctx, permission)` (service-level enforcement, matching m02).
- **Roles** map to the escalation ladder: Customer Service Officer, Supervisor, HOD, GM, MD, Risk/Compliance, Legal liaison, Feedback Admin — provisioned as tenant roles via m02-rbac, holding subsets of `feedback.*`.
- **Scope:** feedback work is naturally branch/department-scoped; leverage Stage 1D org-scope (ADR-018) so a CSO sees their branch, a HOD their department, a GM/MD tenant-wide — via role assignment scope, not bespoke filters.
- **SoD (maker-checker):** closure/review is a distinct permission from investigate/act; the reviewer identity must differ from the investigating owner — enforced server-side and reinforceable by a Stage 1D SoD rule (e.g., `feedback.record.close` vs. `feedback.matter.act`).
- No client-supplied permissions; default-deny; unknown permission fails closed (Stage 1D guarantees).

---

## 25. Security model

- **Fail closed** everywhere: unknown status transition, missing permission, INDETERMINATE authorization, ambiguous severity → deny with a clear reason.
- **PII minimisation:** customer contact data classified confidential; excluded from events, audit detail, and list/aggregate views; drill-down gated by permission.
- **Idempotency** on ingestion and on any externally-triggered action (retryable, keyed).
- **Optimistic concurrency** on all mutations; one handler cannot silently overwrite another.
- **Evidence integrity:** attachments via m09 documents (classified, versioned, linked) — not raw blobs in feedback tables.
- **No AI decisions:** classification/severity/closure are human-decided; any future AI is advisory only (later stages), never auto-closing or auto-referring.
- **Auditability:** every controlled action audited; no security-relevant event disappears silently (contingent on the real m03 spine).

---

## 26. Operational risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Shared services unbuilt** — m03/m06/m08/m09 are `documented`; AUDIT/OUTBOX are in-memory stand-ins. Feedback cannot be SLA-driven, workflow-governed, notifying, or tamper-evident-audited without them. | **Critical** | Sequence prerequisite stages (m03, m06, at least core m08/m09) **before or with** m12; do not claim SLA/audit/notify capability on stand-ins. |
| R2 | **Stage 1D unmerged/uncertified** — the RBAC substrate is on a feature branch. | High | Merge + certify Stage 1D before any m12 implementation; record the true baseline SHA then. |
| R3 | Duplicate customer contact / over-contact | High | Campaign dedup + one-contact-per-campaign invariant + suppression lists. |
| R4 | PII leakage via events/audit/reports | High | Reference-only payloads; classified fields; permissioned drill-down. |
| R5 | SLA/escalation gaming (downgrade to dodge breach) | Medium | Downgrade requires higher role + reason + audit; re-arm on change. |
| R6 | Source-system data quality (bad refs, missing contact) | Medium | Validation + reconciliation + explicit failure reports; nothing silently dropped. |
| R7 | Closed-loop bypass (close without resolution) | High | Server-side lifecycle guards + maker-checker + required closure evidence. |
| R8 | Cross-module coupling to case/legal | Medium | Event-only referral contract; no FK across module boundary. |
| R9 | Tenant config sprawl / unsafe defaults | Medium | Platform-default policies; tenant overrides validated; fail-closed defaults. |

---

## 27. Deferred functionality

- Case/Legal execution (m13+), and the case→feedback return path (contract reserved, consumer later).
- AI-assisted classification, sentiment, routing, summarisation (later AI stages).
- Outbound telephony/SMS/email transport (delivered via m08 when built; Stage 2A records intent/outcome).
- Marketing/testimonial publishing (only a consent flag captured).
- Advanced analytics/BI export; predictive SLA risk.
- Customer self-service feedback portal (inbound channel) — future.

---

## 28. ADRs required (drafts — highest existing is ADR-020)

| ADR | Title | Decides |
|---|---|---|
| **ADR-021** | Feedback closed-loop domain & aggregate model | Root = FeedbackRecord; aggregate boundaries; event-only case boundary |
| **ADR-022** | Source-system ingestion & idempotency contract | Modes, dedup, `(source_system, source_reference)` idempotency, reconciliation, failure handling |
| **ADR-023** | Severity (S1–S4) & SLA policy model | Criteria, default clocks, reassessment/upgrade/downgrade controls, tenant configurability |
| **ADR-024** | Escalation ladder & governance | Levels (CSO→…→MD, Risk, Legal), triggers, maker-checker, mandatory notifications |
| **ADR-025** | Feedback→Case referral event contract | `feedback.referred_to_case` payload, consumer boundary, no cross-module FK |
| **ADR-026** | **Shared-service prerequisite sequencing** | m12 depends on m03/m06/m08/m09; defines what must exist before m12 implementation and what is honestly deferred |
| **ADR-027** | Campaign, sampling & contact-attempt model | Eligibility, one-contact-per-campaign, attempt outcomes, follow-up policy |
| **ADR-028** | Feedback tenant-configuration model | Mixed-scope reference tables (platform defaults + tenant overrides) for categories/severity/ladder/channels/calendars |

---

## 29. Recommended implementation sequence

The manifest itself makes m12 depend on m03/m06/m08/m09. Therefore Stage 2A cannot be a single self-contained implementation stage on today's platform. Recommended ordering (each its own certified sub-stage, one at a time per CLAUDE.md):

0. **Certify + merge Stage 1D** (prerequisite; not optional).
1. **m03-audit** — the real append-only, tamper-evident audit spine (replaces the in-memory stand-in). Everything downstream needs it for compliance claims.
2. **m06-workflow core** — status engine, transactional outbox + idempotency, then SLA timers + timeline. This is the backbone for "workflow-governed" and "SLA-driven." Replaces the in-memory outbox stand-in.
3. **m08-notify (core)** — notifications + escalation dispatch (in-app first; external channels as adapters).
4. **m09-docs (core)** — document/evidence service (can be minimal for Stage 2A: link + classify + version).
5. **m12-feedback** — intake → campaign → contact → capture → classify/severity → workflow → escalation → SLA → closure/reopen → reporting, consuming 1–4. Build in vertical slices (intake+dedup first, then contact/capture, then classify/severity+SLA, then negative-workflow+escalation, then closure/reopen+reports).
6. **m13-case** — consume `feedback.referred_to_case`.

If the business needs a *thin* Stage 2A sooner, an explicit **reduced-scope** option: build m12 intake→contact→capture→classify + positive/close and manual escalation **only**, on the stand-ins, with SLA/auto-escalation/tamper-evident-audit/notifications **explicitly deferred and labelled as debt** until m03/m06/m08 land. This must be a conscious, documented decision (ADR-026), not an implicit compromise — and it cannot be described as SLA-driven, auditable, or workflow-governed until those services are real.

---

## 30. Readiness verdict

**CONDITIONAL GO — for design and sequencing; NO-GO for immediate m12 implementation on the current platform.**

- The **business domain is well-understood and modellable**; the aggregate, lifecycle, severity, SLA, escalation, activity, event, permission, audit, API, and tenancy designs above are coherent and consistent with the certified platform conventions.
- **Blocking conditions before m12 implementation:**
  1. **Stage 1D merged and certified** (currently unmerged) — the RBAC substrate.
  2. **Shared services made real**: at minimum **m03-audit** and **m06-workflow (status/outbox/idempotency/SLA/timeline)**, plus core **m08-notify** and **m09-docs**, because m12's advertised properties (auditable, SLA-driven, workflow-governed, notifying, evidence-backed) are *defined by* those services and cannot be honestly delivered on in-memory stand-ins.
  3. **ADR-021…028 accepted** (or their decisions folded into fewer ADRs).
- **Recommended path:** proceed to draft ADR-021…028 and the m03/m06/m08/m09 → m12 → m13 sequence; do **not** open m12 source until (1) and (2) hold. A reduced-scope thin slice on stand-ins is possible **only** as an explicitly documented debt decision (ADR-026), never marketed as SLA/audit/workflow-complete.

---

### Appendix — platform conventions this design must honour (from CLAUDE.md and Stages 1A–1D)

- One authoritative implementation per shared service; consume via DI tokens/contracts — never duplicate audit, outbox, status, SLA, timeline, escalation, notification, or document services.
- Tenant isolation: RLS FORCE + `tenant_isolation`, composite `(tenant_id, id)` keys + composite FKs, always operate in tenant context.
- Single event path: the m06 transactional outbox (ADR-004); no second bus/outbox.
- Every mutating route: `@Endpoint({ permission, auditCode })`, permission (3-segment) + registered audit code (≥3-segment), audit written in-transaction.
- Maker-checker / SoD for closure and other controlled actions; reviewer ≠ actor.
- Decimal-safe money; UTC storage + tenant-timezone/business-calendar rendering for SLAs.
- Fail closed; AI advises, humans decide; no untested-integration "production-ready" claims.
- Each module ships: permissions (registry), events (contracts union), audit codes (registry), a PURE smoke suite, and a DB-integration spec.
```
