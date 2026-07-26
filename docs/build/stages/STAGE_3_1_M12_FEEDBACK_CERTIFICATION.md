# Stage 3.1 — M12 Enterprise Feedback Management — Post-Merge Certification

**Date:** 2026-07-26
**Module:** `m12-feedback` (enterprise feedback-management platform: configurable source ingestion, the contact
queue, versioned questionnaires + SLA policies, the full feedback-record lifecycle, classification, assignment,
resolution, closure, deterministic SLA tracking, escalation, controlled M13 case handoff, duplicate/related
linking).
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch
`cert/stage-3-1-m12-feedback-management`; certification PR pending, not merged).

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#20** |
| Reviewed implementation head | `de604d5b1fb7f5281a3048fd19a94f8fb3d40433` |
| Implementation merge SHA (squash) | `f9f32dfb27a524ff9eb5385e2576866143d2236c` |
| Certified baseline SHA (main tested) | `f9f32dfb27a524ff9eb5385e2576866143d2236c` |
| Certification branch | `cert/stage-3-1-m12-feedback-management` (cut from merged main) |
| Parent baseline (pre-merge main) | `6aa474426b069182db5037b6c93ba5e305e2feba` (certified Stage 2.5, PR #19) |
| PR #20 | `state: closed`, `merged: true`, `merged_at: 2026-07-26T18:40:12Z` |

**Tree-equivalence:** PR #20 was **squash-merged** (`f9f32df` has a single parent `6aa4744`), so the reviewed
head is not a literal ancestor — ancestry is not required. `git diff de604d5 f9f32df` is **empty**: the merged
tree is **byte-identical** to the reviewed head across the entire repository. No unexpected files.

## 2. Scope certified (merge diff `6aa4744..f9f32df`)

ADR-052…056; the m12 architecture/readiness/plan/completion docs + this certification report;
`packages/m12-feedback` (domain, ports, migrations, repository, three services, emitter, permissions/audit codes,
tests); `packages/contracts/src/feedback-events.ts` + the `DomainEvent` union (8→**9** families) + the contracts
smoke; feedback permissions (37, registered **and seeded**); feedback audit codes (35); event-registry
`feedback.lifecycle` (GAP-1 closed) + naming-map flag; m12 migrations; `/api/v1/feedback` API (7 files under
`apps/api`) + `AppModule` wiring; m12 tests; build wiring (`tsconfig.json`); manifest Stage 3.1 block; the
assertion-count bump in `contracts`/`m02-identity` smoke.

**Exclusions (verified absent):** no m13/m14/m15/m19+/case/finance/reconciliation/AI implementation; no AI
sentiment/summarization; no call recording; no production SMS/email/CRM connector; no data warehouse; no
unrestricted CSV import; no real external adapters to ApticOne/AutoBonds/BimaPro/Imarisha (grep of the merge diff
returns nothing but registry/doc/port-comment lines). **No second outbox; no duplicate audit table; no second RBAC
engine; no second escalation engine; no M13 case table; no duplicate shared platform service.**

## 3. Local gate results (baseline `f9f32df`)

Environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative — see §12); Node **v22.14.0**;
connected via `DATABASE_APP_ROLE=finapp_app` (non-superuser, RLS enforced). Lint ran on a **wiped `dist`** (CI
lint-before-build order).

| Gate | Result |
| --- | --- |
| Format check | ✅ PASS |
| Lint (wiped dist) | ✅ **0 errors** (16 pre-existing non-blocking warnings only) |
| Build / typecheck | ✅ 0 type errors |
| PURE smoke | ✅ **16 suites, 2476 assertions, 0 failures** (m12-feedback 61) |
| Conformance | ✅ **976 assertions** (endpoint perms/audit + RLS convention + `registered_code_count`=len + GAP-1) |
| Migration replay (fresh) | ✅ **20 applied, 0 already-applied** (from an empty database), dependency order |
| DB integration + API specs | ✅ **25 specs, 703 assertions, 0 failures** (m12-feedback 27, m12-services 36, **api-feedback 14**) |

## 4. Database governance (live checks on `finapp_cert`)

- **RLS:** all **15** m12 tables report `relrowsecurity=t` AND `relforcerowsecurity=t` (15/15); each has a
  `tenant_isolation` policy (15/15). Composite `(tenant_id,id)` PKs; **11** composite tenant-safe FKs.
- **Grants:** **0 DELETE** grants to `finapp_app` on any m12 table; the three ledgers `feedback_answer`,
  `feedback_contact_attempt`, `feedback_assignment_history` grant exactly `INSERT, SELECT` (**0 UPDATE** — append
  only). Mutable/status-transitioned tables get SELECT/INSERT/UPDATE.
- **Constraints/indexes:** one-active (`feedback_questionnaire_one_active`, `feedback_sla_policy_one_active`);
  idempotency (`feedback_source_transaction_idem_key`, `feedback_record_idem_key`, `feedback_case_handoff_idem_key`);
  single-winner queue claim (compare-and-set on `status='open' AND assigned_officer IS NULL`); the pending
  handoff uniqueness (`feedback_case_handoff_pending`); relationship active-uniqueness
  (`feedback_relationship_active_key`); a lifecycle status `CHECK` on `feedback_record`.
- **Optimistic concurrency:** **11** m12 tables carry a `version` column (the three append-only ledgers and the
  ingestion row correctly do not). Every mutating repository UPDATE is guarded `WHERE ... AND version = $expected`.
- **No hidden superuser dependency:** the DB lane runs as the non-owner `finapp_app`; RLS is enforced, not
  bypassed.

## 5. Feedback domain (§8)

Proven end-to-end in `m12-services` + `api-feedback`: idempotent ingestion → single-winner contact-queue claim →
contact attempts (append-only) → record creation (idempotent) → **capture** with deterministic **CSAT** (4/5 →
`80.00`, normalized 0–100) and **NPS** (kept 0–10, promoter category) → classification (sentiment + severity) →
assignment (with append-only history) → resolution → customer confirmation → **rule-gated closure** → reopen and
`converted_to_case` branches. Questionnaires + SLA policies are versioned, immutable-after-publish specs
(content-hash frozen at publish, one ACTIVE per code). Closure eligibility returns machine-readable reason codes
(a bare complaint is refused; a fully-worked complaint closes; a positive compliment closes under light criteria).
Duplicate/related linking is deterministic and rejects self-relation. Analytics are bounded aggregate counts over
safe dimensions (product/branch/department/sentiment/severity/category/status) inside tenant context.

## 6. Maker-checker segregation of duties (§8)

Resolution approval is **maker≠checker**: the submitter cannot approve their own resolution (proven — the
submitter's approve attempt returns 409 in both the services spec and over HTTP; an independent approver resolves
the feedback). The approval path is optimistic-lock guarded and returns the current version so the subsequent
confirmation/closure cannot silently no-op.

## 7. Deterministic SLA (§ADR-054)

SLA due dates and warn/breach state are **PURE functions** of a policy spec, an injected `Clock` (epoch ms), and
accumulated paused duration — no ambient `Date.now`. Proven with a `FixedClock` in `m12-services`: a fresh SLA is
neither warned nor breached; advancing the clock past the resolution window **breaches deterministically**; pause
and resume adjust the effective elapsed time. m12 builds **no timer engine**; dispatch/escalation is delegated to
m06/m08.

## 8. Privacy & data minimization (§10, ADR-055)

- **Redaction:** the feedback view returns the real `customerContact` only to a caller holding
  `feedback.customer_contact.read`; otherwise it is `[redacted]` (proven over HTTP — a reader without the
  permission sees `[redacted]`; a privileged caller sees the value, and the access is itself audited via
  `FEEDBACK_CONTACT_ACCESSED`). The confidential internal response is exposed only to callers who may submit
  responses.
- **No sensitive data in the spine:** `feedback.lifecycle` events are `classification: 'confidential'` and their
  payloads carry identifiers, statuses, reason codes and safe analytics dimensions **only** — the emitter contains
  **no** customer-contact, narrative, confidential-response or notification-destination field (the sole textual
  match is the docblock documenting the exclusion). Audit `detail` likewise carries ids/states/reason codes only.
- **Tenant + analytics isolation:** cross-tenant reads return nothing (RLS, proven in `m12-feedback`,
  `m12-services` and `api-feedback`); analytics aggregates run inside tenant context.

## 9. Authorization, audit, events & outbox (§27-30)

- **Authorization:** **37** `feedback.*` permissions, **seeded** (**17** privileged, including
  `feedback.customer_contact.read` and `feedback.platform.administer`); every mutating route declares its
  3-segment permission (`@Endpoint`), enforced server-side (default deny). Proven over HTTP: an `x-permissions`
  header cannot self-grant (403); an anonymous caller is refused (401).
- **Audit:** **35** `FEEDBACK_*` codes via the m03 `AUDIT` port (no duplicate audit table);
  `registered_code_count` 178→**213** = len(codes) (conformance-enforced); payloads carry ids/states/reason codes
  only — no contact, narrative, confidential response, or destination.
- **Events / contracts:** `feedback.lifecycle`, **24** event types (version 1), owned by m12, registered in
  event-registry + naming-map (GAP-1 closed), and in the contracts `DomainEvent` union (8→**9** families).
- **Outbox:** m12 owns **no** outbox — the only `%outbox%` table is m06's `workflow_event_outbox`. m12 publishes
  through it in the caller's transaction (atomic, no dual-write, no second delivery path). ADR-004.

## 10. Integration & the M13 boundary (§9)

m12 reuses **m06 workflow, m07 rules, m08 escalation + notifications, m09 documents through events/contracts
only** — no import of their internals, no import cycle. Escalation records a reference and **publishes an event**
(reusing m08); it builds no second escalation engine. **Case handoff to M13** (which does not exist) is a
**controlled seam only**: a pending `feedback_case_handoff` row (idempotent) + a versioned `CaseHandoffRequested`
event + a port. There is **no case table owned by m12** and no hidden M13 implementation; completion (when M13
later creates the case) transitions the feedback to `converted_to_case` (proven in `m12-services`). No additional
m06/m07/m08/m09 functionality was implemented during certification.

## 11. Authoritative CI (PostgreSQL 16)

Implementation PR **#20**, head `de604d5`, run on `pull_request` — **Smoke lane + DB lane both `success`** on
`postgres:16`. Post-merge push to main `f9f32df` — **Smoke lane + DB lane both `success`**. The merged tree is
byte-identical to the reviewed head, so the PG16 evidence transfers to the certified baseline. The local PG15.2
run independently re-confirms every gate.

## 12. Repository-derived counts (§11)

| Item | Count |
| --- | --- |
| Files changed vs Stage 2.5 baseline (excl. build output) | **49** (+7089 / −49) |
| Migrations (m12) | **2** (20 total in the repo) |
| Tables | **15** |
| Permissions (`feedback.*`) | **37** (17 privileged) |
| Audit codes (`FEEDBACK_*`) | **35** (`registered_code_count` → 213) |
| Event types (`feedback.lifecycle`) | **24** |
| API endpoints | **33** mutating (all audited `@Endpoint`) + **10** reads |
| Smoke suites / assertions | **16** / **2476** (m12 61, conformance 976) |
| DB specs / assertions | **25** / **703** (m12-feedback 27, m12-services 36, api-feedback 14) |
| ADRs | **5** (ADR-052…056) |

## 13. Documented limitations (deferred, not defects — each verified)

- **No AI sentiment/summarization** — sentiment, severity, classification and root-cause are human- or
  rule-driven fields (complex decisioning delegated to m07 via a recorded `ruleEvaluationId`), not AI (ADR-053).
- **No real external source/CRM/SMS/email adapters** — ingestion + notification channels are ports with
  deterministic doubles; no ApticOne/AutoBonds/BimaPro/Imarisha integration, no provider, no secrets committed
  (Framework Only).
- **No call recording, no data warehouse, no unrestricted CSV import** — out of scope by design.
- **No always-running SLA dispatcher/timer worker** — SLA breach/warn is evaluated deterministically on demand;
  timer dispatch + escalation delivery are delegated to m06/m08.
- **M13 case management is a boundary only** — a pending handoff record + a versioned event + a port; no case
  table, no M13 internals (ADR-056).

None weakens any architecture, RLS, authorization, audit, maker-checker, immutability, SLA, privacy, or test
guarantee.

## 14. Verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** The M12 enterprise feedback-management module is implemented on
`main` (`f9f32df`), byte-identical to the reviewed PR #20 head, with all certification gates executed and green
locally and both authoritative PG16 CI lanes green. Certification is recorded on branch
`cert/stage-3-1-m12-feedback-management`; the certification PR is pending and **not merged**. No later module
(m13+) was touched.
