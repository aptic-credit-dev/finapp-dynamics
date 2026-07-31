# Stage 3 — M20 GL Reconciliation — Architecture

**Module:** `m20-glrecon` (`@finapp/m20-glrecon`) · **API:** `/api/v1/gl-reconciliation` · **Permissions:**
`gl_reconciliation.*` · **Audit:** `GLRECON_*` · **Events:** `glrecon.lifecycle`. Decisions: ADR-085…090.

## Purpose & boundary

M20 reconciles **general-ledger balances + transactions against a source system**: it enforces the GL balance
invariant, deterministically matches GL lines against source records, manages reconciling items + exceptions,
certifies balances, and produces **DRAFT journal recommendations** for the journal engine (m21). It is a **downstream
consumer of the m19 finance foundation** (accounts, currencies referenced by **opaque id, no FK**) and **reuses the
`m15a-matching` engine** for line scoring.

It owns **none** of: chart of accounts (m19), bank reconciliation (m15), journals / postings / ledger balances (m21),
approval workflow (m22), finance integration / external connector (m23), payments / AR / AP / cash, or AI (m27). It
**never** posts a journal, writes to the general ledger, or approves anything (ADR-090; CLAUDE.md hard prohibitions).

## Database model (24 tables; 10 append-only; 0 DELETE grant)

- **Configuration:** `gl_recon_account` · `gl_ruleset` (versioned, one-active) · `gl_rule` · `gl_ruleset_history`†
- **Ingestion:** `gl_import` (per-account file-hash dedup) · `gl_import_error`† · `gl_balance`
  (**invariant CHECK**) · `gl_line` · `gl_source_import` · `gl_source_line`
- **Run + balance:** `gl_recon_run` · `gl_run_status_history`† · `gl_run_balance`† (**invariant CHECK**)
- **Matching:** `gl_match` (idempotency-keyed) · `gl_match_line`† · `gl_match_candidate`† (engine evidence)
- **Resolution:** `gl_reconciling_item` · `gl_exception` (open→under_review→resolved/waived) · `gl_manual_decision`†
- **Certification:** `gl_certification` (**override CHECK**) · `gl_certification_history`†
- **Handoff + record:** `gl_journal_recommendation` (**is_draft CHECK**) · `gl_run_summary`† · `gl_note`†

† append-only ledger (INSERT+SELECT only). Every table: RLS ENABLE+FORCE + `tenant_isolation`, composite
`(tenant_id,id)` PK + composite FKs, `version` on mutable aggregates. Money is `bigint` **minor units** — no float
column exists.

## The GL balance invariant (ADR-088)

`calculated closing = opening + debits − credits`, in integer minor units, enforced in **three** agreeing places:
the pure engine (`reconcileBalance`), a DB CHECK on `gl_balance`, and a DB CHECK on the append-only `gl_run_balance`.
A run computes the calculated closing, compares it to the expected/source closing, records the exact integer variance
+ a stable reason code, and raises a required `closing_balance_mismatch` exception when the variance exceeds the
ruleset tolerance.

## Reconciliation run lifecycle

`draft → running → review_required → completed` (`reopened`; or `failed`). Executing a run: (1) computes the balance
invariant + records evidence; (2) matches unmatched GL lines against unmatched source lines with the **reused m15a
engine**, recording explainable candidate evidence, auto-proposing exact/strong matches and raising an exception
otherwise; (3) advances to `review_required`. A run **cannot complete** while a required exception is open (fail
closed). Reopen is privileged.

## Matching (reused) & manual override

Line scoring / confidence bands / colour status / reason codes / `bestCandidate` / `classifyMatchType` / split-
balancing are **re-exported from `@finapp/m15a-matching`** — one matching implementation, never duplicated (ADR-087).
Manual match / grouped match is privileged, must balance exactly in minor units, and is recorded as append-only
`gl_manual_decision` evidence that never overwrites the engine's `gl_match_candidate` evidence (ADR-083).

## Certification & draft recommendations

A `gl_certification` snapshots calculated vs source balance, the exact variance, and open-exception / open-item
counts. Certifying over open blockers requires a **privileged override with a reason** (permission + non-empty reason
+ DB CHECK) recorded as a critical audit event (ADR-089). A `gl_journal_recommendation` is **draft by construction**
(`is_draft` CHECK) — m20 recommends a correcting debit/credit and hands it off to m21; it never posts or approves
(ADR-090).

## Shared services & contracts

Authorization (m02), audit (m03), workflow + the **single outbox** (m06) and the finance foundation (m19, opaque
refs) are reached **through kernel DI tokens / events / ports** — never by importing internals. m20 owns **no
outbox**; it publishes `glrecon.lifecycle` (33 event types, v1, classification `confidential`) onto m06's outbox.
Payloads carry ids, states, match types, confidence bands, scores, variances (minor units) and reason codes only —
never GL account numbers, raw source content or float.

## Naming (ADR-086)

The four axes are named independently: API `/api/v1/gl-reconciliation`; permission namespace `gl_reconciliation.*`
(35 codes, 11 privileged); event family `glrecon.lifecycle`; audit prefix `GLRECON_` (37 codes). All registered in
`manifests/` and enforced by CI conformance.
