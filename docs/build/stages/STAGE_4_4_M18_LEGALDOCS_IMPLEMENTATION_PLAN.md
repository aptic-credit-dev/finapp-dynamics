# Stage 4.4 — M18 Enterprise Legal Knowledge Management — Implementation Plan

Grounded in the m07/m08/m09/m12/m13/m14/m16/m17 pattern. Built on `feature/stage-4-4-m18-legal-knowledge-management` from the
certified Stage 4.3 baseline (`m17-recovery`); M18 approved for build once m14 + m16 + m17 are certified (was
`documented`). Counts below are **approximate** targets, finalized in the completion report.

## Sequence (planned)

1. **contracts** — one family `legaldocs.lifecycle` (~36 event types, version 1); wired into the `DomainEvent`
   union + `DOMAIN_EVENT_FAMILIES` (14 → 15); contracts smoke bumped one family. Payloads carry ids, states, dates,
   reason codes + safe analytics dimensions only — never privileged advice or confidential text.
2. **package skeleton + vocabularies** — `packages/m18-legaldocs` (package.json, tsconfig, root + apps/api refs);
   ~46 `legaldocs.*` permissions (granular, no wildcard, no vague `legaldocs.admin`; ~19 privileged — approve /
   publish / supersede / withdraw / archive / reopen / taxonomy-manage / authority-manage / opinion-manage /
   opinion-approve / template-approve / template-publish / clause-approve / clause-publish / confidential-read /
   privileged-read / privileged-create / analytics-export / platform); ~55 `LEGALDOC_*` audit codes.
3. **PURE domain** — limits + vocab (record types, knowledge types, authority types + treatments, clause kinds,
   authority/privilege/confidentiality/risk levels, source types, taxonomy kinds, review types, reference types,
   note types); the one shared PUBLISHABLE lifecycle (the 9 states below) with the single choke point
   `checkPublishableTransition`; deterministic clock-driven review/expiry/renewal/authority-review deadline math
   (`expiry` high-risk + distinguishable); relationship + clause-relation rules (self/duplicate rejected);
   content-hash util; deterministic knowledge-number formatting.
4. **clock port** — `Clock` (`SystemClock` + `FixedClock`) so review/expiry/deadline math is deterministic; no
   ambient `Date.now`, no ambient calendar — deterministic doubles only; the `CrossModuleRef` (opaque id + module
   type) + `KnowledgeIntakeAdapter` seam for external intake (normalized safe fields + a payload hash).
5. **migrations** — `0001_legaldocs.sql` (~20 tables, RLS ENABLE+FORCE, composite keys/FKs, configurable
   `legaldoc_taxonomy` one-active per kind+code, one-published-per-code partial unique indexes on knowledge /
   template / clause, immutable-after-publish content_hash, append-only status / assignment / authority-treatment /
   note / usage / approval-history ledgers, maker-checker SoD CHECKs on knowledge / template / clause / opinion,
   opaque `legaldoc_reference`, self-edge CHECKs on relationships + clause relations, permission seed) and
   `0002_grant_application_role.sql` (NO DELETE anywhere; the 6 append-only ledgers INSERT+SELECT only).
6. **repository + emit + errors** — all SQL (optimistic-lock CAS on `version`, one-published partial-unique
   enforcement, immutable-after-publish guards, append-only inserts); `M18Emitter` (audit m03 + m06 outbox in the
   business tx).
7. **services** — Catalog (configurable taxonomy, authorities + treatments, precedents, opinions maker-checker,
   research), Knowledge (the knowledge lifecycle incl. create → assign → submit → review → approve → publish →
   supersede → withdraw → archive → reopen, versioning/supersession, references, relationships, tags, citations,
   notes, reviews, usage), Library (templates + the clause library — versioned, immutable-after-publish,
   maker-checker + clause relations); index.
8. **API** — `apps/api/src/legaldocs` (views with redaction + controllers under `/api/v1/legaldocs` + module
   binding the Framework-Only clock port; mutating endpoints + reads + keyword search); wired into `AppModule`. No
   document bytes and no storage references in responses.
9. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true` for
   `legaldocs.lifecycle`; manifest m18 → implemented + `certification_4_4`; finalize `certification_4_3`.
10. **tests** — smoke (domain), db-spec (governance), services-db-spec (end-to-end + concurrency + maker-checker +
    immutability/one-published + deterministic review/expiry overdue + cross-module opacity + redaction), api-spec
    (HTTP + redaction).
11. **docs** — README, architecture/readiness/plan/completion, ADR-073…076.

## Publishable lifecycle states

`draft` → `under_review` → (`changes_requested` / `approved` → `published`) → `superseded` / `withdrawn` →
`archived`, with `reopened`. One shared 9-state machine (`draft`, `under_review`, `changes_requested`, `approved`,
`published`, `superseded`, `withdrawn`, `archived`, `reopened`) drives knowledge records, templates and clauses
through the single choke point `checkPublishableTransition`. Transitions are explicit and each carries preserved
transition evidence in the append-only `legaldoc_status_history`. Published content is **immutable** — a change is a
NEW version via supersession, never an in-place edit. `archived` is terminal; a withdrawn record is reopenable.

## Design choices

- **~20 tables** (the enterprise scope — the configurable taxonomy, the knowledge core aggregate with its status +
  assignment ledgers, authorities + treatments, precedents, opinions, research, templates + clauses + clause
  relations, opaque references, knowledge relationships, reviews, tags, citations, notes, usage, and the shared
  maker-checker approval-history ledger — justifies ~20; documented in ADR-074/075).
- Practice areas, jurisdictions, legal topics, document types and tags are **configurable per-tenant data** via
  `legaldoc_taxonomy`; the knowledge/authority/clause vocabularies are governed control lists; nothing
  jurisdiction-specific is baked into core; retrieval is deterministic **keyword + taxonomy filtering only** — NO
  AI, NO vector/embedding index, NO semantic search, NO legal-research vendor ingestion (ADR-073).
- Knowledge / template / clause are **versioned, immutable-after-publish** (content_hash frozen at publish,
  one-published per code, change = new version via supersession); review/expiry deadline math is **deterministic**
  via an injected `Clock` port (no ambient `Date.now`, ADR-074); `expiry` deadlines are high-risk + distinguishable;
  timer dispatch + escalation delegate to m06/m08.
- Maker-checker on knowledge / template / clause / opinion approval (submitter/author ≠ approver, service + DB
  CHECKs `legaldoc_knowledge_sod_ck` / `legaldoc_template_sod_ck` / `legaldoc_clause_sod_ck` /
  `legaldoc_opinion_sod_ck`); optimistic concurrency (`version` + `WHERE version=$expected`); idempotency on the
  knowledge number via a unique index — re-submission returns the existing record (ADR-074).
- Privileged legal advice, confidential clause/opinion/analysis text, drafting strategy and restricted notes are
  sensitive: redacted on read behind dedicated privileged `legaldocs.*` permissions, never in events/audit/logs/
  analytics/search snippets; ethical walls via RLS FORCE + dedicated privileged permissions (ADR-076).
- **Cross-module references** are OPAQUE ids on `legaldoc_reference` (m09 documents, m14 matters, m16 litigation,
  m17 recoveries by id only); m18 **never reads those modules' tables** and performs no cross-module mutation; it
  owns **no document storage** — bytes live in m09, m18 stores references only (ADR-075). Real calendar/notification
  providers and any legal-research vendor feed are deferred behind existing ports (documented).

## Verification

Every gate to be actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Approximate
counts (~46 permissions, ~55 audit codes, ~36 event types, ~20 tables, 9 states) confirmed in the completion
report.
