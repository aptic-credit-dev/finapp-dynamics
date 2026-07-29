# Stage 4.4 — M18 Enterprise Legal Knowledge Management — Architecture

**Module:** `m18-legaldocs` · **Package:** `@finapp/m18-legaldocs` · **Branch:**
`feature/stage-4-4-m18-legal-knowledge-management` · **Baseline:** certified Stage 4.3 main (`m17-recovery`). **ADRs:**
ADR-073…076. (M18 was previously `documented`; it is approved for build once m14 + m16 + m17 are certified.)

## Purpose & boundary

One generic, multi-tenant **enterprise legal knowledge platform** for the legal knowledge a practice accumulates —
legal knowledge records, legal authorities + citations + treatments, precedents, legal opinions (privileged),
research notes, document templates and a clause library, a configurable legal taxonomy, governed versioning,
review/expiry deadlines and safe cross-module references — a governed draft → review → approve → publish →
supersede engine with keyword search, maker-checker approval, review/expiry deadline control, evidence and audit.
It is **not** a document-storage engine (M09 owns the bytes), a matter/case engine (M14), a litigation proceeding
engine (M16), a recovery/enforcement engine (M17), a general ledger or any finance/accounting/AR/payment/
reconciliation engine, an AI / vector-search / embedding / semantic-search tool, a production court or legal-
research vendor integration, or an external portal (see Exclusions). M18 owns full **legal knowledge**; it
**references** m09/m14/m16/m17 objects by opaque id only and reads none of their tables. Nothing is Kenya-specific:
practice areas, jurisdictions, legal topics, document types and tags are **configurable data**, never hardcoded. It
consumes shared services via kernel tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and owns no shared service.

## Shape (mirrors m07/m08/m09/m12/m13/m14/m16/m17)

- **PURE domain** — one shared PUBLISHABLE state machine (the 9-state lifecycle below, single choke point
  `checkPublishableTransition`) for knowledge / template / clause; the governed control vocabularies (record /
  knowledge / authority / clause / source / taxonomy / review / reference / note kinds, authority/privilege/
  confidentiality/risk levels + treatments); deterministic clock/date-driven review/expiry deadline math; relation
  + clause-relation validation returning machine-readable reasons; fail-closed hard limits. No I/O; exhaustively
  unit-tested.
- **Clock port** — review, expiry, renewal and authority-review deadline math is deterministic via an injected
  `Clock` (`SystemClock`/`FixedClock`); no ambient `Date.now`, no ambient calendar. `expiry` deadlines are the
  highest-risk review deadline and clearly distinguishable (`isExpiry` / `isExpirySafe`, ADR-074). Business-calendar
  expansion delegates to m06's calendar through a port; overdue/review dispatch + escalation delegate to m06/m08 —
  m18 builds no timer engine.
- **20 tables** — configurable `legaldoc_taxonomy` (one-active per kind+code); the `legaldoc_knowledge` core
  aggregate (SENSITIVE `abstract`; 9-state lifecycle; one-published per code; versioned via supersession);
  append-only `legaldoc_status_history` + `legaldoc_assignment_history`; `legaldoc_authority` + append-only
  `legaldoc_authority_treatment`; `legaldoc_precedent` (SENSITIVE `holding`); `legaldoc_opinion` (PRIVILEGED,
  maker-checker SoD CHECK `approved_by <> author`); `legaldoc_research` (SENSITIVE `findings`); `legaldoc_template`
  + `legaldoc_clause` (versioned, immutable-after-publish, one-published per code, maker-checker SoD CHECK
  `approved_by <> submitted_by`); `legaldoc_clause_relation` (dependency/conflict graph, self-edge rejected);
  `legaldoc_reference` (OPAQUE cross-module id + `ref_type`); `legaldoc_relationship` (knowledge-to-knowledge,
  self-edge rejected, active-unique); `legaldoc_review` (deterministic overdue); `legaldoc_tag`; `legaldoc_citation`;
  append-only `legaldoc_note` (confidential/privileged/strategy gated); append-only `legaldoc_usage` (safe
  dimensions); append-only `legaldoc_approval_history` (maker-checker evidence). All composite `(tenant_id,id)`, RLS
  ENABLE+FORCE + `tenant_isolation`, no-DELETE, the 6 append-only ledgers INSERT+SELECT only.
- **Services** — Catalog / Knowledge / Library, each permissioned + transactional, audit + outbox in the business
  tx via one `M18Emitter`.
- **API** `/api/v1/legaldocs` — taxonomy, authorities + treatments + citations, precedents, opinions
  (maker-checker), research, the knowledge lifecycle (create → assign → submit → review → approve → publish →
  supersede → withdraw → archive → reopen), references, relationships, tags, reviews, notes, usage, templates +
  clauses (maker-checker) + clause relations, keyword search, analytics.

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| Configurable taxonomy + governed vocabularies | practice areas, jurisdictions, legal topics, document types and tags are **configurable per-tenant data** via `legaldoc_taxonomy` (one-active per kind+code); the knowledge/authority/clause vocabularies are governed control lists — nothing jurisdiction-specific is baked into the core; retrieval is deterministic **keyword + taxonomy filtering only** — NO AI, NO vector/embedding index, NO semantic search, NO production legal-research vendor ingestion | 073 |
| Immutable-after-publish versioning + deterministic deadlines | knowledge, templates and clauses are versioned; publishing **freezes** the content (content_hash frozen at publish), there is **one published version per code** (partial unique index), and a change is a **NEW version via supersession**, never an in-place edit; review/expiry/renewal deadline math is a **PURE function** of a supplied `Clock` (no ambient `Date.now`), `expiry` treated as high-risk + distinguishable | 074 |
| Opaque cross-module references | m18 references m09 documents, m14 matters, m16 litigation and m17 recoveries through **OPAQUE ids** (`legaldoc_reference.ref_type` + `target_id`) — it **never reads those modules' tables** and performs **no cross-module mutation**; it owns **no document storage** (bytes live in m09), imposing no lifecycle coupling | 075 |
| Privilege/confidentiality + controls | privileged legal advice, confidential clause/opinion/analysis text, drafting strategy and restricted notes stored under RLS, **REDACTED on read** behind dedicated privileged permissions, and **NEVER** in events/audit/logs/analytics/search snippets; ethical walls via RLS FORCE + dedicated privileged permissions (no vague admin perm); maker-checker on knowledge/template/clause/opinion approval (approver ≠ submitter/author, DB CHECKs) | 076 |

## Integration (reuse, no duplicate engines)

m06 workflow orchestrates review/approval/publication gates and owns the single outbox; m07 rules consume typed
knowledge facts (type, practice area, jurisdiction, authority level — never privileged advice or confidential
analysis text) for classification/routing via a recorded `ruleEvaluationId` — rules never mutate a knowledge
record; m08 sends notifications and drives review/expiry escalation (no second escalation engine); m09 documents
hold the bytes — templates, clauses, opinions, research and knowledge attach content **by reference** (no bytes).
All through events/contracts and ports, never by importing their internals. A notification/escalation failure never
mutates a published knowledge record or an approved template/clause. M18 **references** m09/m14/m16/m17 objects
through **opaque ids on `legaldoc_reference`** (`ref_type` records the owning module) — **m18 never reads those
modules' tables** and mutates nothing cross-module; it owns no storage. The one family `legaldocs.lifecycle` (36
event types, version 1) flows through the single m06 outbox (contracts `DOMAIN_EVENT_FAMILIES` grows 14 → 15).
