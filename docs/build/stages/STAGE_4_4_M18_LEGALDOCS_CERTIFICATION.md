# Stage 4.4 — M18 Enterprise Legal Knowledge Management — Post-Merge Certification

**Verdict: CERTIFIED ON BRANCH.** The merged implementation of `m18-legaldocs` on `main` (`9bf1a0c`, PR #32) has
been re-verified from a clean checkout: every gate is green, the certification branch is byte-identical to the
reviewed head, all governance guarantees hold on a real PostgreSQL, and the module honours its boundaries. This
record + the manifest update are the only changes on the certification branch (evidence only — no feature work).
The certification PR is open and **not merged**.

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#32** |
| Reviewed implementation head | `2168d83065b2221191f8d9cbf9e4ed1060476c8d` |
| Implementation merge SHA (squash) | `9bf1a0ce69a7fe75deffedfd5d0d859b2cb05755` |
| Certified baseline SHA (main tested) | `9bf1a0ce69a7fe75deffedfd5d0d859b2cb05755` |
| Current `origin/main` | `9bf1a0ce69a7fe75deffedfd5d0d859b2cb05755` (= the merge commit) |
| Certification branch | `cert/stage-4-4-m18-legal-knowledge-management` (cut from merged main) |
| Parent baseline (pre-merge main) | `f3f053df94f5a9cc0ddb27a214a2c2c8427d0c1d` (governance PR #31) |
| Governance approval | PR **#31** flipped `m18-legaldocs` `documented` → `approved_for_build` → main `f3f053d`, rooted on certified Stage 4.3 main `5aec639` (cert PR #30) |
| PR #32 | `state: closed`, `merged: true`, `merged_at: 2026-07-29T07:39:52Z`, base `main` |
| Stage / dependencies | Stage 4 (Legal); deps m09/m14/m16/m17 all merged + certified on main |

## 2. Tree equivalence

`git diff feature/stage-4-4-m18-legal-knowledge-management 9bf1a0c` → **EMPTY** (0 lines). The certified tree is
byte-identical to the reviewed implementation head; the certification branch was cut from the merge SHA.

## 3. Local gate results (baseline `9bf1a0c`, clean checkout)

| Gate | Result |
| --- | --- |
| Build / typecheck (wiped `dist`) | ✅ `tsc --build` **exit 0** |
| Format check | ✅ `prettier --check .` clean |
| Lint | ✅ `eslint` **0 errors** (61 style warnings, matching the certified baseline pattern) |
| PURE smoke | ✅ **21 suites, 3995 assertions, 0 failures** (m18-legaldocs 74) |
| Conformance | ✅ **2116 assertions** (endpoint perms/audit codes vs registries, RLS convention over the new migrations, `registered_code_count` = len(codes) = 486, `legaldocs.lifecycle` family registration) |
| Migration dry-run | ✅ lists all 30 migrations incl. the two m18 files in dependency order (m18 last) |
| Migration replay (fresh) | ✅ **30 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **40 specs, 1301 assertions, 0 failures** (m18-legaldocs 41, m18-services 163, **api-legaldocs 22**) |

Local environment: PostgreSQL **15.2** throwaway; the authoritative PostgreSQL **16** CI is verified on the
certification PR (§14).

## 4. Database governance (live checks on the fresh certified schema)

20/20 legaldoc tables verified: RLS **ENABLE + FORCE** + a `tenant_isolation` policy (20/20), composite
`(tenant_id, id)` primary keys (20/20). **13** composite foreign keys, **0** single-column FKs. **44** CHECK
constraints incl. **4** maker-checker SoD CHECKs (`legaldoc_knowledge_sod_ck`, `legaldoc_template_sod_ck`,
`legaldoc_clause_sod_ck`, `legaldoc_opinion_sod_ck` — `approved_by <> submitted_by`/`author`), **2** self-edge
CHECKs (`legaldoc_relationship`, `legaldoc_clause_relation`), **13** optimistic-lock `version >= 1` CHECKs. **3**
one-published-per-code partial unique indexes (knowledge/template/clause) + the knowledge idempotency partial
unique index. **0 DELETE grants** for the app role on any legaldoc table; the **6** append-only ledgers
(`legaldoc_status_history`, `legaldoc_assignment_history`, `legaldoc_authority_treatment`, `legaldoc_note`,
`legaldoc_usage`, `legaldoc_approval_history`) have **0 UPDATE grant**. **46** permissions seeded (**19**
privileged). Exactly **one** outbox table exists (`workflow_event_outbox`) — **m18 owns no outbox**. No orphan
references: every association FK is composite `(tenant_id, id)`; the reference-composite-FK and self-edge negative
cases are proven in `m18-legaldocs.db-spec`.

## 5. Knowledge lifecycle, versioning, publishing (proven in `m18-services.db-spec`)

The shared **9-state PUBLISHABLE** machine (`draft → under_review → changes_requested → approved → published →
superseded/withdrawn → archived`, with `reopened`) is the single choke point for knowledge/template/clause. Proven:
create (+ idempotency returns the same record), draft edit bumps the optimistic-lock version, a **stale
expectedVersion is rejected** (single-winner CAS); submit → (jump-to-published rejected) → (self-approve rejected)
→ independent approve → publish (content_hash + publication_date frozen); a **published record is immutable** (edit
rejected); **supersession** creates `version_number + 1`, moves the prior to `superseded` with content unchanged,
and the successor becomes the new published head with its own frozen hash; withdraw → reopen → (archive-from-
reopened rejected) → re-withdraw → archive (terminal). One-published-per-code holds for knowledge and templates.

## 6. Authorities, treatments, citations, precedents, opinions, research

Authorities register with append-only case-law/statutory **treatments** (followed/distinguished/overruled/…),
invalid treatment rejected. Citations link a knowledge record to an authority. Precedents carry a SENSITIVE
holding. **Opinions are privileged and maker-checker**: the author cannot approve (rejected), an independent
approver succeeds; conclusion/recommendation are SENSITIVE. Research carries SENSITIVE findings and updates under
optimistic concurrency. All verified end-to-end.

## 7. Templates, clauses, classification, taxonomy, search

The clause library + document templates are versioned, maker-checker, immutable-after-publish, superseded (proven,
incl. clause self-relation rejected). Configurable **taxonomy** (practice area / jurisdiction / legal topic /
document type / tag) creates and retires by the `active` flag (no delete; retire-twice rejected). Tags are
one-active per kind+code with **soft-delete** (a removed tag frees its slot via the partial unique index and can be
re-added). **Search is keyword only** — no AI, embeddings, vector or semantic search.

## 8. Review dates & deadlines; retention / legal hold

Review/expiry/renewal deadlines are computed from an injected `Clock` — a `FixedClock` proves the deterministic due
instant; `expiry` is the high-risk deadline; timer dispatch/escalation delegate to m06/m08. **Retention schedules
and legal-hold are not repository-defined M18 requirements** (they appear in no m18 module spec, manifest
`testing_required`, or ADR); the review/expiry deadline surface satisfies the review-date obligation. Their absence
is a documented scope boundary, not a certification gap.

## 9. Cross-module references (document / matter / litigation / recovery)

`legaldoc_reference.target_id` is a plain `text` column (no FK to another module) typed by `ref_type`. The services
spec links **document (m09)**, **matter (m14)**, **litigation (m16)** and **recovery (m17)** references as opaque
ids and asserts all four are stored; the api spec links a document reference over HTTP. m18 **reads no other
module's tables** (every SQL table reference is `legaldoc_*`) and mutates nothing cross-module.

## 10. Workflow, rules, notifications, audit, events, outbox

Workflow (m06), rules (m07), escalation/notifications (m08) and documents (m09) are consumed through
events/contracts + ports only — no duplicate engines. **55** `LEGALDOC_` audit codes (all ≥ 3 segments) are written
through the m03 AUDIT port in the business transaction; every recorded audit code is a `LEGALDOC_` code. One event
family `legaldocs.lifecycle` (**36** types, v1) is published on the **single m06 outbox** (every event carries
`family = legaldocs.lifecycle`); `DOMAIN_EVENT_FAMILIES` = **15**.

## 11. Authorization, security, privacy, confidentiality, attorney privilege

Default-deny: every mutation `authz.require`s its three-segment `legaldocs.*` permission; over HTTP an anonymous
caller is **401**, an unprivileged caller with a forged `x-permissions` header is **403**, a self-approve is
**409**. **19** privileged permissions gate approval/publish/supersede/withdraw/archive/reopen/configuration +
confidential/privileged reads; there is no vague `legaldocs.admin`. Privileged legal advice, confidential
opinion/precedent/research/analysis text, drafting guidance and restricted note bodies are RLS-stored, **redacted
on read** unless the caller holds the dedicated privileged permission (`redactKnowledge` nulls the `abstract`;
opinion/precedent/research/note views redact via the API layer; list views never return privileged content); a
privileged/confidential read is itself audited. A **leak-scan** over every audit + event payload proves NONE of the
eight sensitive fields (abstract, opinion conclusion/recommendation, note body, clause/template guidance, precedent
holding, research findings) ever appears in an event or audit payload (attorney-privilege / ADR-076). Cross-tenant
isolation holds through the non-owner app role: another tenant reads/searches/lists none of this tenant's records
and cannot act on them (RLS → empty / 404 / rejection).

## 12. Idempotency & optimistic concurrency

Knowledge creation is idempotency-keyed (DB partial unique index; a repeated key returns the existing record, over
HTTP too). Mutable aggregates carry a `version` column; UPDATEs are single-winner CAS (`WHERE version =
$expected`) returning null on stale → conflict — proven by an explicit stale-write rejection.

## 13. Analytics

`legaldoc_usage` is an append-only analytics ledger with safe dimensions only (knowledge id + usage type + context
ref); usage recording is an audited endpoint (`LEGALDOC_USAGE_RECORDED`) whose payload never carries content;
`analytics.export` is a privileged permission. Verified end-to-end.

## 14. Authoritative CI (PostgreSQL 16)

Implementation PR #32 (head `2168d83`, merge `9bf1a0c`): **Smoke lane ✅ success** + **DB lane (PostgreSQL 16) ✅
success** on the full head SHA. The certification PR re-runs both lanes on the certification head — recorded green
before this record is considered final.

## 15. Repository-derived counts

| Item | Count |
| --- | --- |
| Migrations (m18 / replayed) | **2** / **30** |
| Tables | **20** |
| FORCE RLS tables | **20** |
| Append-only ledgers | **6** |
| Composite FKs (single-column) | **13** (**0**) |
| Permissions (privileged) | **46** (**19**) |
| Audit codes (m18) | **55** |
| Registered audit codes (total) | **486** |
| Event types (`legaldocs.lifecycle`) | **36** |
| Event families | **15** |
| Mutating routes / read routes | **48** / **21** |
| Lifecycle states | **9** |
| ADRs | **4** (ADR-073…076) |
| Smoke suites / assertions | **21** / **3995** |
| DB + API specs / assertions | **40** / **1301** |

## 16. Boundary certification

M09 owns enterprise document management (bytes); M14 owns legal matters; M16 owns litigation; M17 owns recovery;
**M18 owns legal knowledge only**. M18 does **not** own finance, accounting, ledger, payments, receivables,
reconciliation, AI, vector search, embeddings, court integrations, messaging, vendor management or portals — a
forbidden-domain scan of the m18 source/migrations/contracts is clean, and every SQL table reference is
`legaldoc_*`.

## 17. Contamination result

Only `m18-legaldocs` (+ its API wiring, registries, contracts family, tests, docs) is present. No M09/M14/M16/M17
duplication (opaque `text` references, no FK to other modules, no cross-module reads); no finance/GL/AR/payments/
reconciliation/accounting/AI/embeddings/vector-search/M19+ contamination; no historical migration edits; no
duplicated shared platform service; no second outbox; no duplicate audit table. On the certification branch the
only changes are this report + the manifest certification record.

## 18. Known limitations (deferred, documented — not defects)

- No AI / semantic / vector / embedding search — keyword only; AI-assisted research/drafting is a later stage.
- No document storage — bytes remain in M09; M18 stores references.
- No retention-schedule / legal-hold feature — not a repository-defined M18 requirement (review/expiry deadlines
  cover the deadline obligation).
- No finance / GL / AR / payments / reconciliation / accounting.
- No production court / legal-research vendor integration, no messaging providers, no external portals — deferred
  behind ports (Framework Only).

## Verdict

**CERTIFIED ON BRANCH.** All gates green from a clean checkout of merged `main`; tree byte-identical to the
reviewed head; governance, boundary, database, API, security, privacy, confidentiality, attorney-privilege,
concurrency, idempotency and analytics guarantees verified. The certification PR is open and **not merged**.
