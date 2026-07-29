# m18-legaldocs — Enterprise legal knowledge management (Stage 4.4)

A **generic, configurable, multi-tenant enterprise legal knowledge platform** — legal knowledge records, legal
authorities + citations + treatments, precedents, legal opinions (privileged, maker-checker), research notes,
document templates and a clause library (versioned, immutable-after-publish, maker-checker), a configurable
taxonomy (practice area / jurisdiction / legal topic / document type / tag), governed versioning via supersession,
review/expiry deadlines, and safe cross-module references — with a governed publishable lifecycle, keyword search,
maker-checker approval, privilege/confidentiality controls, evidence and audit. Nothing is Kenya-specific:
**practice areas, jurisdictions, legal topics, document types and tags are configurable data**, never hardcoded.
**Not** a finance/ledger, a matter or case engine (m14), a litigation proceeding engine (m16), a recovery engine
(m17), a document-storage engine (m09), an AI/vector/semantic-search tool, or an external portal. M18 owns
**legal knowledge**; it references m09 documents, m14 matters, m16 litigation and m17 recoveries by **opaque id**
only and reads none of their tables.

## Layers

- **PURE domain** (`src/domain/`): one shared PUBLISHABLE state machine (9-state lifecycle, single choke point
  `checkPublishableTransition`) for knowledge / template / clause; the governed control vocabularies (record types,
  knowledge types, authority types + treatments, clause kinds, authority/privilege/confidentiality/risk levels,
  source types, taxonomy kinds, review types, reference types, note types); deterministic clock-driven review /
  expiry / renewal deadline math (`computeReviewDueMs` / `reviewState`; `expiry` treated as high-risk and clearly
  distinguishable, ADR-074); relationship + clause-relation validation (self/duplicate edges rejected); the shared
  vocabulary + fail-closed hard limits. Plus deterministic `knowledge-number` formatting and a content-hash util.
- **Ports** (`ports.ts`): a `Clock` (review/expiry/deadline math takes it — no ambient `Date.now`, ADR-074), a
  `CrossModuleRef` (an OPAQUE `refType` + `targetId` — m18 never reads the target module's tables, ADR-075) and a
  `KnowledgeIntakeAdapter` (external systems normalize to safe fields + a payload hash). Deterministic test doubles
  only (`SystemClock` / `FixedClock`) — no production legal-research vendor integration, no secrets.
- **Persistence** (`migrations/0001_legaldocs.sql`, **20 tables**, all RLS ENABLE+FORCE + `tenant_isolation`,
  composite `(tenant_id,id)` keys + composite FKs): `legaldoc_taxonomy` (configurable classification, one-active per
  kind+code), `legaldoc_knowledge` (core aggregate; SENSITIVE `abstract`; 9-state lifecycle; one-published per code;
  maker-checker SoD CHECK), `legaldoc_status_history` + `legaldoc_assignment_history` (append-only),
  `legaldoc_authority` + `legaldoc_authority_treatment` (append-only), `legaldoc_precedent` (SENSITIVE `holding`),
  `legaldoc_opinion` (PRIVILEGED; maker-checker SoD CHECK `approved_by <> author`), `legaldoc_research` (SENSITIVE
  `findings`), `legaldoc_template` + `legaldoc_clause` (versioned, immutable-after-publish, one-published per code,
  maker-checker SoD CHECK), `legaldoc_clause_relation` (dependency/conflict graph; self-edge rejected),
  `legaldoc_reference` (OPAQUE cross-module id + `ref_type`, ADR-075), `legaldoc_relationship` (knowledge-to-
  knowledge; self-edge rejected; active-unique), `legaldoc_review` (deterministic overdue), `legaldoc_tag`,
  `legaldoc_citation`, `legaldoc_note` (append-only; confidential/privileged/strategy gated), `legaldoc_usage`
  (append-only, safe dimensions) and `legaldoc_approval_history` (append-only maker-checker evidence). `0002`:
  NO DELETE anywhere; the **6 append-only ledgers** (`legaldoc_status_history`, `legaldoc_assignment_history`,
  `legaldoc_authority_treatment`, `legaldoc_note`, `legaldoc_usage`, `legaldoc_approval_history`) are INSERT+SELECT
  only.
- **Services**: `CatalogService` (configurable taxonomy, authorities + treatments, precedents, opinions
  maker-checker, research), `KnowledgeService` (the knowledge lifecycle + versioning/supersession, references,
  relationships, tags, citations, notes, reviews, usage), `LibraryService` (document templates + the clause
  library — versioned, immutable-after-publish, maker-checker + clause relations). One `M18Emitter` writes audit
  (m03) + events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/legaldocs`): audited mutating routes + reads across the catalog, knowledge and library
  surfaces. Every mutating route is an audited `@Endpoint` with a permission enforced server-side (default deny);
  views **redact** privileged legal advice, confidential clause/opinion/analysis text, drafting strategy and
  restricted notes. No document bytes and no storage references leak in API responses.

## Governance

Tenant isolation (RLS FORCE on all 20 tables), default-deny authorization (**46** `legaldocs.*` permissions,
seeded — **19** privileged, ADR-076), audit via the m03 port (**53** `LEGALDOC_` codes, no duplicate audit table),
the single m06 outbox for `legaldocs.lifecycle` (**36** event types), one-published-per-code + immutable-after-
publish versioning (content_hash frozen at publish; change = new version via supersession, ADR-074), optimistic
concurrency on every mutation, **maker-checker segregation of duties** on knowledge / template / clause / opinion
approval (approver ≠ submitter/author, enforced in the service AND the DB CHECKs `legaldoc_knowledge_sod_ck` /
`legaldoc_template_sod_ck` / `legaldoc_clause_sod_ck` / `legaldoc_opinion_sod_ck`), and **legal privilege/
confidentiality minimization** — privileged legal advice, confidential clause/opinion/analysis text, drafting
strategy and restricted notes are RLS-stored, redacted on read behind dedicated privileged permissions, and never
in events/audit/logs/analytics/search snippets (ADR-076).

## Reuse (no duplicate engines)

Workflow (m06), rules (m07), escalation + notifications (m08) and documents (m09) are reused **through
events/contracts and ports**, never by importing their internals. Review/expiry/deadline math is deterministic via
a `Clock` port; overdue/review dispatch and escalation are delegated to m06/m08 — m18 builds no timer engine.
Business-calendar expansion is delegated to m06's calendar through a port, not reimplemented. M18 owns **NO
storage** — document bytes live in m09; m18 stores references only. Cross-module references (m09 documents, m14
matters, m16 litigation, m17 recoveries) are **OPAQUE ids** typed by `ref_type` — m18 **never reads those modules'
tables** and mutates nothing cross-module (ADR-075). There is **NO AI, NO vector/embedding index and NO semantic
search** — retrieval is deterministic keyword + configurable-taxonomy filtering only (ADR-073).

## Tests

`test/m18-legaldocs.smoke.ts` (PURE domain — the publishable machine, deterministic review/expiry math, vocab +
limits, relationship rules), `test/m18-legaldocs.db-spec.ts` (RLS / grants / append-only / immutability / one-
published / SoD / constraints / isolation), `test/m18-services.db-spec.ts` (end-to-end incl. versioning/
supersession, maker-checker on knowledge/template/clause/opinion, deterministic review overdue, references,
redaction, cross-tenant) and `apps/api/test/api-legaldocs.db-spec.ts` (HTTP end-to-end + redaction). Smoke:
`npm run test:smoke`; DB lane: `npm run test:db` against a real PostgreSQL (CI is PostgreSQL 16, authoritative).
ADR-073…076.
