# Stage 3 — M21 Journal Engine: Architecture (draft-first MVP)

**Module:** `m21-journal` · **Stage:** 3 (Finance) · **Branch:** `feature/stage-3-m21-journal` ·
**Baseline:** governance PR #43 merge `88b0549` on `main` (m21 `approved_for_build`). **ADRs:** ADR-091 … ADR-096.

## 1. Purpose & boundary

M21 is the **journal engine**. It converts reconciliation/operational outcomes into **balanced, decimal-safe
journal drafts** (debits == credits, integer minor units), validates them deterministically, and carries them up
to **submit-for-approval**. It **prepares** approval-gated posting requests and records posting-result evidence,
but the MVP is **draft-first**: it never approves, never pushes to a core system, never auto-posts.

| Concern | Owner |
| --- | --- |
| Chart of accounts, fiscal periods (open/closed/locked), currencies | **m19** (opaque refs, no FK) |
| GL reconciliation + DRAFT recommendation handoff | **m20** (event + opaque `handoff_ref`) |
| Journal drafts, lines, validation, posting requests/results | **m21 (this module)** |
| Approval workflow (maker-checker + SoD) | **m22** (opaque `approval_ref`) |
| Posting push to core banking/accounting (ERP) | **m23/m33** (POST-MVP) |

M21 reads **no** other module's tables. It publishes through the **single m06 outbox**.

## 2. Data model (18 FORCE-RLS tables) — ADR-091

Reference/config: `journal_type`, `journal_config`, `journal_reason_code`. Recommendation intake:
`journal_recommendation` (+ append-only `journal_recommendation_line`, `journal_recommendation_history`). Draft:
`journal_draft`, `journal_line` (+ append-only `journal_status_history`, `journal_draft_balance`,
`journal_note`). Validation: append-only `journal_validation`, `journal_validation_finding`. Posting:
`posting_request` (+ append-only `posting_request_history`), `posting_result` (+ append-only
`posting_result_history`), append-only `posting_idempotency`. **Ten append-only ledgers; no DELETE grant.**

Every tenant table: composite `(tenant_id, id)` PK + UNIQUE, RLS ENABLE+FORCE, `tenant_isolation` policy,
composite FKs, `version` on mutable aggregates.

## 3. Accounting invariants — ADR-092 / ADR-095

Enforced in the **pure engine**, in the **service**, and at the **database** (three layers that must agree):

- **Decimal-safe** — `bigint` minor units; no `real`/`double precision` anywhere; money crosses the wire as a
  string (`*_minor::text`).
- **Balanced before advance** — `journal_draft` CHECK `status='draft' OR total_debits_minor =
  total_credits_minor`; `is_balanced = (debits = credits)`; `journal_draft_balance.balanced = (debits = credits)`.
- **No posting without approval** — `posting_request` CHECK `status IN ('prepared','cancelled') OR approval_ref
  IS NOT NULL`.
- **No closed-period posting** — `posting_request` CHECK `status NOT IN ('ready','submitted','succeeded') OR
  period_status = 'open'` (m19 period gate, ADR-078).
- **Maker ≠ checker (SoD)** — `posting_request` CHECK `approved_by IS NULL OR approved_by <> requested_by`.
- **No duplicate posting** — unique `posting_idempotency (tenant_id, idempotency_key)` + terminal `succeeded`.
- **No autopost** — no route/permission/code path lets AI or automation approve or post.

## 4. Lifecycles

- **Recommendation:** `proposed → accepted → converted` | `dismissed`.
- **Draft:** `draft → validated → submitted → posted` | `withdrawn` (edit reverts `validated → draft`).
- **Type/config:** `draft → active → superseded → retired` (config immutable-after-publish, one active/scope).
- **Posting request:** `prepared → ready → submitted → succeeded/failed` (+ `cancelled`; `failed → ready` retry).
- **Posting result:** `pending → succeeded/failed`.

## 5. Validation engine (deterministic, explainable) — ADR-092

`validateDraft(draft)` returns a reproducible `ValidationResult` whose findings each carry one machine-readable
reason code: `balanced`, `unbalanced`, `single_sided`, `no_lines`, `non_positive_amount`, `float_amount`,
`currency_mismatch`, `unknown_account`, `missing_entity`, `closed_period`, `locked_period`, `duplicate_posting`.
No ambient clock, no randomness, no I/O — the same input always yields the same output, recorded append-only in
`journal_validation` + `journal_validation_finding` + `journal_draft_balance`.

## 6. Naming (ADR-093) & handoff (ADR-094)

`/api/v1/journals` · `journals.*` (27; 9 privileged) · `JOURNAL_` (23 audit codes) · `journal.lifecycle` (16) +
`posting_request.lifecycle` (6, deferred). Recommendation intake is **idempotent per m20 `handoff_ref`**; m21
copies the recommendation into its own tables under its own controls (opaque refs, no FK).

## 7. Posting deferral (ADR-096)

Posting request/result tables, state machines and `posting_request.lifecycle` exist so the downstream contract
is expressible and the controls are testable, but **no external connector is invoked** — external posting is
**Framework Only** until proven against real systems (m23/m33, POST-MVP).
