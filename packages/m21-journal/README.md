# m21-journal — Journal Engine (draft-first MVP)

Turns m20 GL-reconciliation DRAFT recommendations (and operational inputs) into **balanced, decimal-safe
journal drafts** (debits == credits in integer minor units), runs **deterministic, explainable validation**,
manages the draft lifecycle up to **submit-for-approval**, and **prepares** approval-gated posting requests +
records posting-result evidence. It **never approves** (m22 owns maker-checker + SoD), **never posts** to a
ledger/ERP/core system (m23/m33, post-MVP), **never auto-posts**, **never posts into a closed/locked period**,
and **never duplicate-posts**.

|                  |                                                          |
| ---------------- | -------------------------------------------------------- |
| Module code      | `m21-journal`                                            |
| Build stage      | 3 (Finance) — `docs/07-engineering/BUILD_SEQUENCE.md`    |
| API prefix       | `/api/v1/journals`                                        |
| Permissions      | `journals.*` (27; 9 privileged)                           |
| Audit prefix     | `JOURNAL_` (23 codes)                                     |
| Event families   | `journal.lifecycle` (16), `posting_request.lifecycle` (6, deferred) |
| Tables           | 18 FORCE-RLS (10 append-only); no DELETE grant           |
| ADRs             | ADR-091 … ADR-096                                         |

## What it owns (18 tables)

- **Reference/config** — `journal_type` (versioned, one active), `journal_config` (versioned,
  immutable-after-publish, one active per scope, idempotency-keyed), `journal_reason_code` (configurable
  validation reason-code registry).
- **Recommendation intake** — `journal_recommendation` (+ append-only `journal_recommendation_line`,
  `journal_recommendation_history`). Idempotent per m20 `handoff_ref`.
- **Draft journal** — `journal_draft` (balanced-before-advance), `journal_line` (active/removed; no DELETE),
  append-only `journal_status_history`, `journal_draft_balance` (balance evidence), `journal_note`.
- **Validation** — append-only `journal_validation` + `journal_validation_finding` (machine-readable reason
  codes).
- **Posting (draft-first; deferred)** — `posting_request` (approval-gated), append-only
  `posting_request_history`, `posting_result` (evidence), append-only `posting_result_history`,
  `posting_idempotency` (no-duplicate-post ledger).

## Invariants (DB-enforced)

- **Decimal-safe money** — every amount is `bigint` minor units; **no float** anywhere (ADR-007). Row types
  project `*_minor::text` and carry money as **strings**.
- **Balanced before advance** — a draft can only leave `draft` when `total_debits_minor = total_credits_minor`
  (CHECK); `is_balanced = (debits = credits)` (CHECK); balance evidence `balanced = (debits = credits)` (CHECK).
- **No posting without approval** — a `posting_request` cannot leave `prepared` without an opaque m22
  `approval_ref` (CHECK).
- **No closed-period posting** — a request cannot become postable while the m19 period is not open (CHECK, ADR-078).
- **Maker ≠ checker (SoD)** — `approved_by <> requested_by` (CHECK) + service-level fail-closed check.
- **No duplicate posting** — unique `posting_idempotency` ledger + terminal `succeeded` state.
- **Tenant isolation** — RLS ENABLE+FORCE + `tenant_isolation` + composite keys/FKs on every table.

## Boundaries

Owns **no** chart of accounts / fiscal periods (m19), GL reconciliation (m20), approval workflow (m22),
integration/posting push (m23/m33) or AI (m27). m19/m20/m22 are referenced by **opaque id — no foreign key**.
Every `journal.lifecycle` / `posting_request.lifecycle` event flows through the **single m06 outbox** (m21 owns
no outbox).

## Shared services consumed

`DB`, `AUDIT` (m03), `AUTHZ` (m02), `OUTBOX` (m06) via kernel DI tokens; m07 rules, m19 finance foundation and
m20 recommendation handoff via events / opaque references.

## Tests

- `test/m21-journal.smoke.ts` — PURE (vocab, lifecycles, the deterministic validation + balance engine, reason
  codes, no-float, permission/audit shape).
- `test/m21-journal.db-spec.ts` — governance (RLS+FORCE, no DELETE, append-only, no-float/bigint, the
  balanced-before-advance + posting-control CHECKs, one-active, composite FKs, single outbox, permission seed).
- `test/m21-services.db-spec.ts` — services end-to-end (idempotent intake → convert → draft → validate → submit
  → approval-gated posting with SoD → posting-result → no-duplicate → concurrency → data minimisation →
  cross-tenant).
- `apps/api/test/api-journals.db-spec.ts` — HTTP (`/api/v1/journals`): 401/403/404/409, idempotency, no
  approve/post route, tenant isolation.

Run: `npm run test:smoke` (incl. conformance) and `npm run test:db` (needs `DATABASE_URL`).
