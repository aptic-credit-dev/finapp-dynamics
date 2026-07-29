# Stage 4.4 — M18 Enterprise Legal Knowledge Management — Completion Report

**Module:** `m18-legaldocs` · **Package:** `@finapp/m18-legaldocs` · **Branch:**
`feature/stage-4-4-m18-legal-knowledge-management` · **Baseline:** governance-approved main
`f3f053df94f5a9cc0ddb27a214a2c2c8427d0c1d` (PR #31). **Status:** implemented on branch; all local gates green,
**not merged** (M18 was approved for build via governance PR #31 — previously `documented`); the implementation PR +
post-merge certification are the next steps.

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified-pending** = to be observed green on the authoritative PostgreSQL 16 CI lane · **not yet
merged** · **deferred** = documented, out of scope.

## What was built

A generic, multi-tenant **enterprise legal knowledge platform** — legal knowledge as a first-class, governed
corpus: legal knowledge records (memos, practice notes, guidance, checklists, interpretations, advisories,
playbooks, standard positions), legal authorities + citations + case-law/statutory treatments, precedents,
**privileged legal opinions** (maker-checker), research notes, versioned document **templates** and a **clause
library** (maker-checker, immutable-after-publish), a configurable taxonomy/classification, keyword search,
supersession-based versioning, review/expiry deadlines, and cross-module references. Nothing is jurisdiction-
specific: practice areas, jurisdictions, legal topics, document types and tags are **configurable data**, never
hardcoded. It is **not** a document store (M09 owns bytes; M18 stores references), a matter-lifecycle engine (M14),
a litigation engine (M16), a recovery engine (M17), a finance/GL/AR/payment/reconciliation engine, or an
AI/semantic/vector-search tool. Search is **keyword only**.

- **PURE domain** (`src/domain/`): limits + governed vocab; the shared **9-state PUBLISHABLE** state machine (one
  choke point for knowledge/template/clause); deterministic clock-driven review/expiry deadline math; knowledge and
  clause relationship rules.
- **Clock port** (`ports.ts`): review/expiry deadline math is deterministic via an injected `Clock` (`SystemClock`
  + `FixedClock`) — no ambient `Date.now`; timer dispatch + escalation delegate to m06/m08. Workflow (m06), rules
  (m07), escalation/notifications (m08) and documents (m09) are reached **through events/contracts + ports only**.
  Cross-module references (m09 documents, m14 matters, m16 litigation, m17 recoveries) are carried as **opaque
  ids** on a `CrossModuleRef` — m18 never reads those modules' tables and mutates nothing cross-module.
- **Persistence** (`0001`/`0002`, **20 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs, **NO DELETE grant anywhere**): `legaldoc_taxonomy` (configurable, one-active
  per kind+code), `legaldoc_knowledge` (core aggregate; SENSITIVE `abstract`; 9-state PUBLISHABLE lifecycle;
  versioned via supersession; one published per code; the `legaldoc_knowledge_sod_ck` DB CHECK; idempotency-keyed),
  `legaldoc_status_history`, `legaldoc_assignment_history`, `legaldoc_authority`, `legaldoc_authority_treatment`
  (append-only treatments), `legaldoc_precedent` (SENSITIVE holding), `legaldoc_opinion` (PRIVILEGED; the
  `legaldoc_opinion_sod_ck` DB CHECK `approved_by <> author`), `legaldoc_research` (SENSITIVE findings),
  `legaldoc_template` (versioned, immutable-after-publish, one-published, `legaldoc_template_sod_ck`),
  `legaldoc_clause` (versioned clause library, immutable-after-publish, one-published, `legaldoc_clause_sod_ck`),
  `legaldoc_clause_relation` (self-edge CHECK; active-unique), `legaldoc_reference` (OPAQUE cross-module ids),
  `legaldoc_relationship` (self-edge CHECK; active-unique), `legaldoc_review` (deterministic review/expiry
  deadlines), `legaldoc_tag` (one-active per kind+code; soft-delete, no DELETE), `legaldoc_citation`,
  `legaldoc_note` (append-only; confidential/privileged/strategy), `legaldoc_usage` (append-only analytics),
  `legaldoc_approval_history` (append-only maker-checker evidence). **6 append-only ledgers**
  (`legaldoc_status_history`, `legaldoc_assignment_history`, `legaldoc_authority_treatment`, `legaldoc_note`,
  `legaldoc_usage`, `legaldoc_approval_history`) are INSERT+SELECT only.
- **Services**: `CatalogService` (taxonomy, authorities + append-only treatments, precedents, opinions with
  maker-checker approval, research), `KnowledgeService` (the core knowledge record: full lifecycle + versioning/
  supersession + references/relationships/tags/citations/notes/reviews/usage + redaction), `LibraryService`
  (templates + clauses: versioned, maker-checker, immutable-after-publish, supersession + clause relations). One
  `M18Emitter` writes audit (m03) + events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/legaldocs`): taxonomy, authorities/treatments, precedents, opinions (register + approve),
  research; knowledge create/update/assign/classify + the full lifecycle + references/relationships/tags/citations/
  notes/reviews/usage + keyword search + analytics; templates + clauses (create/submit/approve/publish/withdraw/
  supersede) + clause relations, across three controllers. Every mutating route declares a permission (default
  deny) and an audit code; sensitive fields redacted in views.

## Scope

| Fact | Value |
|---|---|
| Source added | `packages/m18-legaldocs` (domain, ports, repository, emit, 3 services) + `apps/api/src/legaldocs` (views + 3 controllers + module) + registries/contracts/tests/docs |
| Migrations | **2** for m18 (`0001`, `0002`); **30** total replayed in the repo, m18 last |
| Tables created | **20** |
| Permissions added | **46** (`legaldocs.*` three-segment; **19** privileged incl. approve/publish/supersede/withdraw/archive/reopen/taxonomy-manage/authority-manage/opinion-manage+approve/template-approve+publish/clause-approve+publish/confidential-read/privileged-read+create/analytics-export/platform) — seeded |
| Audit codes added | **55** (`LEGALDOC_*` SCREAMING_SNAKE, all ≥ 3 segments); `registered_code_count` **431 → 486** |
| Events added | **ONE** family — `legaldocs.lifecycle` (**36** event types, version 1); contracts `DomainEvent` union / `DOMAIN_EVENT_FAMILIES` **14 → 15** families |
| Services / controllers | **3** services (Catalog / Knowledge / Library); **3** controllers (catalog, knowledge, library) |
| Routes | **48** mutating routes (each `@Endpoint` permission + audit code) + **21** read routes |
| Lifecycle | **9** PUBLISHABLE states (`draft`, `under_review`, `changes_requested`, `approved`, `published`, `superseded`, `withdrawn`, `archived`, `reopened`) shared by knowledge/template/clause; single choke point; append-only `legaldoc_status_history` evidence; `archived` is terminal; published content immutable |
| ADRs | ADR-073…076 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **20** tables; composite `(tenant_id,id)` keys + **13** composite FKs (0 single-column); asserted through the non-owner app role (`finapp_app`). |
| Authorization | Default-deny; every mutation `authz.require`s its three-segment `legaldocs.*` permission; a header cannot grant authority (proven over HTTP → 403). **19** privileged permissions gate approval/publish/supersede/withdraw/archive/reopen/configuration + confidential/privileged reads; there is no vague `legaldocs.admin`. |
| Sensitivity / redaction | Privileged legal advice, confidential opinion/precedent/research/analysis text, drafting guidance and restricted note bodies are stored under RLS, REDACTED on read unless the caller holds the dedicated privileged permission; reading un-redacted confidential/privileged data is itself audited (`LEGALDOC_CONFIDENTIAL_ACCESSED` / `LEGALDOC_PRIVILEGED_ACCESSED`); a leak-scan proves NONE of it ever appears in any event or audit payload (ADR-076). |
| Maker-checker / SoD | Knowledge/template/clause/opinion approval requires submitter/author ≠ approver, enforced in-service AND by the DB CHECKs `legaldoc_knowledge_sod_ck` / `legaldoc_template_sod_ck` / `legaldoc_clause_sod_ck` / `legaldoc_opinion_sod_ck`; self-approve → 409, an independent approver succeeds (proven in services + HTTP specs). |
| Immutability / versioning | Published knowledge/templates/clauses are immutable — `content_hash` frozen at publish, one published per code; a change is a **new version via supersession** (`version_number + 1`, prior → `superseded` with unchanged content) (ADR-074). |
| Configurable taxonomy | Practice areas, jurisdictions, legal topics, document types and tags are per-tenant configuration in `legaldoc_taxonomy` (one active per kind+code; retire by flag, no delete) — nothing jurisdiction-specific in core (ADR-073). |
| Deterministic review / expiry | Review/expiry deadlines computed from an injected `Clock` — no ambient `Date.now`; a `FixedClock` proves the deterministic due instant; `expiry` is the high-risk deadline; timer dispatch/escalation delegate to m06/m08 (ADR-074). |
| No storage duplication | M18 owns **no document bytes** — those live in M09; `legaldoc_reference` stores only opaque references (ADR-075). |
| Cross-module references | m09 documents / m14 matters / m16 litigation / m17 recoveries are referenced by **opaque id** typed by `ref_type` (a plain `text` column, no FK to other modules); m18 **reads no other module's tables** and performs no cross-module mutation (ADR-075). |
| No AI / no vector search | Search is keyword only — no AI, embeddings, semantic or vector search, no production legal-research vendor ingestion (ADR-073). |
| Append-only evidence | The 6 ledgers INSERT+SELECT only (0 UPDATE grant); NO DELETE on any m18 table (tags soft-delete via `active`). |
| Idempotency | DB-enforced on the knowledge idempotency key (partial unique index); conflict → the existing record. |
| Optimistic concurrency | Mutable aggregates carry a `version` column; UPDATEs are single-winner CAS (`WHERE version = $expected`), a stale write → conflict (proven in the services spec). |
| Single outbox | m18 owns no outbox; publishes `legaldocs.lifecycle` through m06's outbox (only `workflow_event_outbox` exists). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean (**exit 0**). **Lint:** `eslint` **0 errors** (**61** style warnings, matching the
  certified baseline pattern). **Format:** `prettier --check .` clean.
- **Smoke lane (tested locally):** **21 suites, 3995 assertions, 0 failed** — including `m18-legaldocs` (**74**),
  `conformance` (**2116**, validating every `@Endpoint` permission + audit code against the registries, the RLS
  convention over the new migrations, `registered_code_count` = len(codes) = **486**, and the newly-registered
  `legaldocs.lifecycle` family), and `migrate` (**26**).
- **Migrations (tested locally):** **30** in dependency order, applied on a fresh PostgreSQL from an empty database
  (fresh replay); m18 last.
- **DB + API lane (tested locally, real PostgreSQL 15.2, roles `finapp_app` + `finapp_owner`):** **40 specs, 1301
  assertions, 0 failed** — `m18-legaldocs.db-spec` (**41** governance), `m18-services.db-spec` (**163** end-to-end),
  `api-legaldocs.db-spec` (**22** HTTP end-to-end), and the whole prior baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **CI-verified-pending** at the
  time of writing.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**.

## Live DB governance verified

20/20 legaldoc tables RLS ENABLE+FORCE + `tenant_isolation` + composite `(tenant_id,id)` PK; **0 DELETE grants**
for the app role; the 6 append-only ledgers have **0 UPDATE grant**; **13** composite FKs (0 single-column); **46**
permissions seeded (**19** privileged); knowledge-number + idempotency-key uniqueness; one-published-per-code for
knowledge/template/clause (3 partial unique indexes); the 4 maker-checker SoD CHECKs
(`legaldoc_knowledge_sod_ck` / `legaldoc_template_sod_ck` / `legaldoc_clause_sod_ck` / `legaldoc_opinion_sod_ck`);
the 2 self-edge CHECKs (`legaldoc_relationship` / `legaldoc_clause_relation`); tag soft-delete frees its slot via
the partial unique index; only `workflow_event_outbox` exists (**m18 owns no outbox**).

## Limitations (deferred, documented — not defects)

- **No AI / no semantic or vector search / no embeddings** — search is keyword only; classification is human/rule-
  driven (m07). AI-assisted legal research/summarisation/drafting is a later stage; AI never reaches a legal
  conclusion.
- **No document storage** — document bytes remain in M09; M18 stores references only (ADR-075).
- **No M14 matter lifecycle, no M16 litigation, no M17 recovery** — those are referenced by opaque id only; M18
  reads none of their tables and mutates nothing cross-module.
- **No finance / general ledger / accounts receivable / payments / reconciliation / accounting** — out of scope.
- **No production court / legal-research vendor integration, no external portals** — deferred behind ports
  (Framework Only).

## Spec divergence (recorded)

Two mutating routes with no pre-existing semantic audit code — adding a note and recording a usage event — were
given the new registered codes `LEGALDOC_NOTE_ADDED` and `LEGALDOC_USAGE_RECORDED` (bringing the m18 set to 55) so
that every mutating route is a genuinely audited endpoint while the note/usage **content** still never enters any
audit or event payload (ADR-076). `legaldoc_tag` gained an `active` flag so tag removal is a soft delete (no
DELETE grant anywhere) whose partial unique index frees the slot for re-adding. Opinion/precedent/research read
redaction lives in the API view layer (`apps/api/src/legaldocs/views.ts`); the package exports a service-level
`redactKnowledge` for the knowledge `abstract`, and the services spec proves opinion/precedent/research text never
leaks into audit/event payloads. The scope decisions (20 tables; legal knowledge as a first-class corpus; the
configurable taxonomy; immutable-after-publish versioning; opaque cross-module references; keyword-only search;
privilege/confidentiality never in events/audit) are captured in **ADR-073…076** and this report.

## Scope discipline (contamination)

Only `m18-legaldocs` (+ its API wiring, registries, contracts family, tests, docs) was built. No M09 document-
storage duplication, no M14 matter-lifecycle duplication, no M16 litigation duplication, no M17 recovery
duplication; every SQL table reference is `legaldoc_*` and cross-module references are opaque `text` ids with no
foreign key to other modules. No finance, general-ledger, accounts-receivable, payment, reconciliation,
accounting, AI, embeddings, vector/semantic search, or later-module (M19+) implementation. No historical migration
was edited. No shared platform service was duplicated; no second outbox; no duplicate audit table; no second RBAC
or escalation engine. The manifest change is confined to the m18 block (plus finalising the M17 certification
record now that cert PR #30 is merged). The implementation is on the branch; it is **not merged** — the PR + post-
merge PostgreSQL 16 certification are the next steps.
