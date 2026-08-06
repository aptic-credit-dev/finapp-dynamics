# Stage 5 — M26 Legal AI — Certification (CERTIFIED ON BRANCH)

**Module:** `m26-legal-ai` · **Verdict:** **CERTIFIED WITH DOCUMENTED LIMITATIONS (governed, mvp:false)** · **Date:** 2026-08-06
**Certification branch:** `cert/stage-5-m26-legal-ai` (cut from merged `main` `cbb8356`)

## A. Implementation-merge provenance (verified, not assumed)

| | |
| --- | --- |
| Governance PR | **#61** — merged; governance merge SHA `96bc00db0f63356fc981b809361b4a122b6925d1` (main after approve) |
| Implementation PR | **#62** — `state=closed`, `merged=true`, `merged_at=2026-08-06T06:15:13Z`, base `main` |
| Reviewed implementation head | `fccbf8c8bd87ed979cc1699b0baf6859f0b377c0` |
| Implementation merge SHA | `cbb8356c215eb15d35223d27ca285f0a0d6e3661` (1 parent `96bc00d`) |
| Current origin/main | `cbb8356c215eb15d35223d27ca285f0a0d6e3661` (contains the merge) |
| Tree equivalence | **EMPTY** — `git diff fccbf8c cbb8356` is empty (byte-identical) |
| Implementation CI (reviewed head `fccbf8c`) | Smoke **success** + DB **success** (PostgreSQL 16) |
| CI on main push (`cbb8356`) | Smoke **success** + DB **success** (PostgreSQL 16) |
| Contamination | **CLEAN** — merge scope `96bc00d..cbb8356` is M26-only |

## S. Certification gates re-executed on the cert branch (merged main, clean/wiped-dist)

- **Format:** `npm run format:check` — clean.
- **Lint:** `npm run lint` (wiped-dist) — **0 errors** (68 pre-existing baseline warnings; M26 adds none).
- **Build:** `npm run build` — green.
- **Smoke lane:** 31 suites, **5609 assertions, 0 failures** (m26 smoke **71**; conformance **3072** validating the 6 new `ai.*` permissions, 14 `AI_LEGAL_` audit codes and audit total 719).
- **Migration ordering/checksums + fresh replay:** `npm run migrate` — **50 applied** on a fresh database in dependency order (m26 last); no historical migration edit.
- **DB lane** (real PostgreSQL, non-owner app role via `SET ROLE`, `DATABASE_APP_ROLE=finapp_app`, fresh DB): **64 specs, 2029 assertions, 0 failures** — `m26-legal-ai` (**33**) + `m26-services` (**24**) + every `api-*` spec green.

## C/D. Repository scope + live-DB evidence (direct queries)

Repository truth: module `m26-legal-ai`, capability **Legal AI**, Stage 5, **mvp:false**; **no HTTP API**
(`api_prefixes: []`); **shared** `ai.*` permission namespace; **shared** `AI_` audit prefix; **no new event
family** (reuses m24 `ai.request/output/governance_lifecycle`); consumes M24 + M14 by contract; M09 document
references; advisory only; no autonomous legal action.

- **11/11** `legal_ai_*` tables (RLS ENABLE + FORCE + `tenant_isolation`); composite `(tenant_id, id)` keys +
  composite FKs; **0** unsafe single-column tenant FKs.
- **0** DELETE grants; **0** UPDATE on the 7 append-only ledgers; **4** version columns (the 4 mutable aggregates).
- **0** float columns; `confidence_bps` **integer**; **0** secret/credential columns.
- Governance CHECKs present: `legal_ai_analysis_human_ck`, `legal_ai_suggestion_human_ck` (no autonomous action),
  `legal_ai_analysis_cite_ck` (citation-required), `legal_ai_finding_factstatus_ck` (fact vs inference — no
  "verified"), `legal_ai_config_review_ck` / `legal_ai_config_autoapply_ck` (human review on / auto-apply off),
  `legal_ai_subject_priv_ck` (privilege classification).
- **6** `ai.legal.*` / `ai.privileged.read` permissions seeded (registry/source parity); single m06 outbox.

## Certification-area verdicts

- **E. M24 handoff** — PASS. M26 consumes M24 only via `AiGatewayPort` (`M24AiGateway` wraps `RequestService`/
  `ReviewService`); holds opaque request/output ids; never selects providers, reads M24 tables, accesses secrets or
  bypasses DLP; duplicate handoff is idempotent; a blocked/rejected M24 request leaves the analysis durably `failed`
  (proven in `m26-services`); deterministic doubles only; no production provider; no external network.
- **F. M14 boundary** — PASS. Opaque `matter_ref`; reads no M14 table; never mutates matter state; cannot create/
  alter hearings, deadlines, decisions, settlements, costs, instructions, outcomes, enforcement, closure or filing
  state; all output is advisory evidence.
- **M09 citation boundary** — PASS. Citations hold an M09 document reference + version/hash + bounded location
  (page/section/paragraph) + evidence classification; never content; M09 stays the document source of truth.
- **G. Privilege / confidentiality / ethical walls** — PASS. Privileged/work-product require `ai.privileged.read`
  (`evaluateEthicalWall`, fail closed); privileged reads audited (`AI_LEGAL_PRIVILEGED_READ`); privilege preserved;
  confidential/restricted material obeys M24 DLP; blocked requests produce durable refusal evidence; no privileged
  narrative in audit/events.
- **H. Human review / no-autonomous-action** — PASS (3 layers: pure `evaluateReviewGate` → services → DB CHECKs).
  AI cannot accept its own suggestion, conclude, file, close, alter a deadline, verify evidence, approve a document,
  settle, admit liability, instruct counsel or commence enforcement; confidence never becomes authority; acceptance
  requires a human actor; an accept requires M24 output approval.
- **I. Confidence / citations** — PASS. Integer basis points, bounded 0..10000, no float, preserved from M24;
  required-citation analyses cannot be accepted without a citation; citations use M09 references with version/hash +
  bounded location.
- **J. Findings / suggestions** — PASS. Finding types + `fact_status` (`extracted`/`inferred`, never verified);
  every finding/suggestion preserves type/source/confidence/limitations/review-state; reviews append-only; an
  accepted suggestion never mutates M14.
- **K. Permissions** — PASS. 6 shared `ai.*` codes (4 privileged), default deny, per-service authorization,
  privileged read separately protected, no universal bypass, headers cannot self-grant.
- **L. Audit** — PASS. 14 `AI_LEGAL_*` codes, audit total 719, unique + registered; controlled mutations, blocked
  analyses, privileged reads and suggestion reviews all audited in-transaction; payloads carry safe ids/states/
  reason codes/opaque refs only — no legal text, prompt/output, privileged narrative, document content, contacts or
  secrets.
- **M. Events / outbox** — PASS. No new event family; reuses m24 `ai.*_lifecycle`; single m06 outbox; privacy-safe
  payloads.
- **N. API absence** — PASS (documented design state). `api_prefixes: []`; no controller, no HTTP route, no
  accidental exposure; certification adds none.
- **O. Idempotency / concurrency** — PASS. Idempotent analysis request; unique idempotency ledger; no duplicate M24
  handoff; optimistic version CAS (stale rejected); single-winner completion/review; append-only histories
  consistent.
- **P. Tenancy / privacy** — PASS. Cross-tenant reads/writes denied (RLS FORCE); safe errors; no raw document
  content duplicated; no prompt/output in audit/events; no secret/contact/privileged-note leakage; no cross-matter
  inference; no ethical-wall bypass.
- **Q. Contamination** — **CLEAN.** No M24/M14/M09 duplication or table access; no M16/M17/M18, M27–M29 or M41; no
  production provider; no external network; no court filing/conclusion/settlement/enforcement/counsel instruction;
  no new event family; no second outbox; no historical migration edit. M24/M14/M09 unmodified.

## R. Documented limitations (truthful, non-blocking)

No HTTP API (naming-map assigns none); deterministic generation via M24's test double (ADR-105); no production
model/provider; no production M41 DLP; no RAG/vector retrieval; no precedent-search engine; `mvp:false`; advisory
only.

## PostgreSQL 16 compatibility

Authoritative: the PostgreSQL 16 CI DB lane is **success** on both the reviewed head `fccbf8c` and the main push
`cbb8356`. Local re-verification used a PostgreSQL 15.2 throwaway; all DDL is PG16-compatible.

## Final verdict

**CERTIFIED ON BRANCH.**

## Remaining manual action
Merge the M26 certification PR, then begin governance verification for the next repository-approved Stage 5 module.
