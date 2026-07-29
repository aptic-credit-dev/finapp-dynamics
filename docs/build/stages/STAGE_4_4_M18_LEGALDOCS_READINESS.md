# Stage 4.4 — M18 Enterprise Legal Knowledge Management — Readiness

**Verdict: GO** (built on the certified Stage 4.3 baseline; all dependencies merged + certified on main; M18
approved for build once m14 + m16 + m17 are certified — was `documented`).

## Dependencies available

- **kernel** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02-identity** — real RBAC (`RbacAuthz`) + the `permissions` catalogue m18 seeds into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port). ✅
- **m06-workflow** — owns the single outbox; m18 publishes `legaldocs.lifecycle` through it; review/approval/
  publication orchestration, the business calendar and review/expiry timer dispatch delegate here. ✅
- **m07-rules** — consumes typed knowledge facts (type, practice area, jurisdiction, authority level) for
  classification/routing via a recorded `ruleEvaluationId` (declarative delegation); rules never mutate a knowledge
  record. ✅
- **m08-escalation** — notifications + review/expiry escalation reused through events/contracts (no second
  escalation engine). ✅
- **m09-docs** — document bytes live here; templates, clauses, opinions, research and knowledge attach content by
  reference (no bytes) through events/contracts. ✅
- **m14-matters / m16-litigation / m17-recovery** — referenced by **opaque id** only (`legaldoc_reference`); m18
  never reads their tables. ✅
- Test harness, migrate tool (m18-legaldocs in `module-order`), conformance. ✅

## The cross-module reference boundary

M18 references m09 documents, m14 matters, m16 litigation proceedings and m17 recoveries through **opaque ids** on
`legaldoc_reference` — `ref_type` (`document` / `matter` / `litigation` / `recovery` / `authority` / `precedent` /
`external`) records which module the `target_id` belongs to, and the tenant guarantees isolation via RLS. **m18
never reads those modules' tables** and performs no cross-module mutation; it imposes no lifecycle coupling and owns
no document storage (bytes live in m09; m18 stores references only). A knowledge record therefore cites the source
matter/proceeding/recovery/document without reaching into another module's private schema.

## Taxonomy configuration & search boundary

Practice areas, jurisdictions, legal topics, document types and tags are **configurable per-tenant data** via
`legaldoc_taxonomy` (one active per kind+code, non-destructively retired via `active`); the knowledge/authority/
clause vocabularies are governed control lists. Nothing is Kenya-specific in core logic. Retrieval is deterministic
**keyword + configurable-taxonomy filtering only** — there is **NO AI, NO vector/embedding index, NO semantic
search** and **NO production legal-research vendor ingestion** (an external intake adapter normalizes to safe fields
+ a payload hash behind a port, deterministic double only).

## Versioning & immutability

Knowledge records, templates and clauses are **versioned**; publishing **freezes** the content (content_hash frozen
at publish), there is exactly **one published version per code** (partial unique index), and a change is a **NEW
version created via supersession**, never an in-place edit of published content. Published/superseded/withdrawn/
archived content is frozen; the `legaldoc_relationship` `supersedes` edge and `supersedes_id`/`superseded_by_id`
link the version chain.

## Integration seams

- **workflow (m06)** — review/approval/publication gates, the business calendar + the single outbox.
- **rules (m07)** — classification/routing via `ruleEvaluationId`; rules never mutate a knowledge record.
- **escalation/notifications (m08)** — reused through events; review/expiry escalation, no second engine.
- **documents (m09)** — templates, clauses, opinions, research + knowledge attach content **by reference only**; no
  bytes, no storage references in API responses.

## Security & privacy boundaries

- Privileged legal advice, confidential clause/opinion/analysis text, drafting strategy and restricted notes are
  SENSITIVE: stored under RLS, REDACTED on read unless the caller holds the dedicated privileged `legaldocs.*`
  permission, and never placed in events or audit payloads — which carry ids, states, dates, reason codes and safe
  analytics dimensions only (ADR-076).
- Every endpoint enforces its three-segment `legaldocs.*` RBAC permission; the **19** privileged permissions
  (approve / publish / supersede / withdraw / archive / reopen / taxonomy-manage / authority-manage / opinion-manage
  / opinion-approve / template-approve / template-publish / clause-approve / clause-publish / confidential-read /
  privileged-read / privileged-create / analytics-export / platform) are default-deny; no wildcard, **no vague
  `legaldocs.admin`**.
- Maker-checker on knowledge / template / clause / opinion approval: the submitter/author cannot be the approver
  (segregation of duties), enforced in the service AND the DB CHECKs `legaldoc_knowledge_sod_ck` /
  `legaldoc_template_sod_ck` / `legaldoc_clause_sod_ck` / `legaldoc_opinion_sod_ck` (`approved_by <> submitted_by` /
  `approved_by <> author`).
- Ethical walls are enforced by RLS FORCE + the dedicated privileged permissions, not a broad administrative role.

## Determinism & port abstraction

Review, expiry, renewal and authority-review deadline math is deterministic via an injected `Clock` port — no
ambient `Date.now`, no ambient calendar; the same record + rule always yields the same due instant and overdue
state (`expiry` is the highest-risk review deadline and clearly distinguishable). Knowledge-number allocation and
controlled actions are idempotent: the idempotency key is unique per tenant, and re-submission returns the existing
record rather than a duplicate.

## Assumptions

- No production calendar/notification/SMS/email provider is configured → deterministic `Clock` doubles only; real
  providers deferred behind existing ports, no secrets.
- Knowledge classification, practice area, jurisdiction and authority level are human/rule-driven fields — not AI
  outputs; there is no AI in this module.
- Legal-research vendor feeds and document bytes are owned by other systems → configurable declarative references;
  document content lives in m09 and is attached by reference only.

## Exclusions (verified out of scope, Framework-Only where deferred)

No document storage (M09 owns the bytes); no matter/case engine (M14), litigation proceeding engine (M16) or
recovery/enforcement engine (M17) — those are referenced by opaque id only; no finance foundation / general ledger /
accounts receivable / cash application / payment / reconciliation / accounting write-off; **no AI / vector search /
embeddings / semantic search**; no production court or legal-research vendor integration; no telephony / email/SMS;
no external portals; no later modules.

## Implementation gates

format · lint (wiped dist) · build · smoke · conformance · migrations (dry-run + fresh replay) · DB specs ·
API specs · RLS · permissions · audit · events · outbox · immutability/one-published · idempotency (knowledge
number) · concurrency · append-only · maker-checker/SoD · redaction · security negatives · clock/review/expiry-
determinism · cross-module-opacity · contamination. PostgreSQL 16 CI is authoritative.

## Deferred provider integrations

Production notification channels (SMS/email), a real calendar/business-day source behind the `Clock`, any legal-
research vendor feed behind the `KnowledgeIntakeAdapter` port, and any external portal — all behind existing ports/
contracts; a standing review/expiry/escalation sweeper worker (timer dispatch delegates to m06/m08).
