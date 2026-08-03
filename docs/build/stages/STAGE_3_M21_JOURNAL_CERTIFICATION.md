# Stage 3 — M21 Journal & Posting Engine: Certification (CERTIFIED ON BRANCH)

**Module:** `m21-journal` · **Capability:** Journal & Posting Engine — draft-first MVP · **Mode:** post-merge
certification (evidence only; no runtime source changed).

## Provenance

| Item | Value |
| --- | --- |
| Governance PR | #43 — merge SHA `88b0549` (m21 `documented → approved_for_build`) |
| Implementation PR | #44 — **closed, merged=true**, merged_at `2026-08-03T11:35:20Z` |
| Reviewed implementation head | `1d276eb` (`1d276ebaea06eef70739d2e67a269c62db183506`) |
| Implementation merge SHA | **`fb74356`** (`fb743563b1815e1d6d55ece9b815990498bff1f8`; squash, parent `88b0549`) |
| Tree equivalence | `git diff 1d276eb fb74356` → **EMPTY** (reviewed tree == merged tree) |
| Current `origin/main` | `fb74356` (contains the implementation merge) |
| Implementation CI (head `1d276eb`) | Smoke lane **success** · PostgreSQL 16 DB lane **success** |
| Certification baseline | `fb74356` |
| Certification branch | `cert/stage-3-m21-journal` |

Because PR #44 was squash-merged, the reviewed feature commits are not ancestors of `main`; certification relies
on **full-tree equivalence** (empty diff), which holds.

## Local certification gates (all green)

Re-executed from a clean checkout on a throwaway **PostgreSQL 15.2** cluster (the only engine available on the
build host; CI runs PostgreSQL 16 — the migrations and specs use no version-specific features), role
`finapp_app`:

| Gate | Result |
| --- | --- |
| format:check | ✓ all files Prettier-clean |
| lint | ✓ 0 errors (67 warnings, consistent with the rest of the repo) |
| build (`tsc --build` from clean) | ✓ |
| smoke lane | ✓ 25 suites / **4816** assertions (conformance **2656**, m21 smoke 80) |
| migrate --dry-run (ordering/checksums) | ✓ 38 migrations in dependency order |
| migrate (fresh replay from empty DB) | ✓ 38 applied |
| DB/API lane | ✓ 52 specs / **1673** assertions / 0 failed |
| — m21-journal (governance) | 44 assertions |
| — m21-services | 28 assertions |
| — api-journals (HTTP) | 14 assertions |

## Live database governance (fresh cert DB)

| Metric | Value |
| --- | --- |
| M21 tables | 18 |
| RLS ENABLE / FORCE | 18 / 18 |
| `tenant_isolation` policies | 18 |
| Composite tenant FKs | 16 |
| Unsafe single-column tenant FKs | 0 |
| CHECK constraints | 43 |
| Float (`real`/`double precision`) money columns | 0 |
| `bigint` `*_minor` money columns | 11 |
| DELETE grants (application role) | 0 |
| Append-only ledgers | 10 (0 UPDATE grants) |
| `version` columns (mutable aggregates) | 8 |
| Permissions seeded (`journals.*`) | 27 (9 privileged) |
| Outboxes in schema | 1 — `workflow_event_outbox` (m21 owns none) |

**Corrected invariant re-verified:** an empty `journal_draft` inserts with `total_debits_minor = 0`,
`total_credits_minor = 0`, `is_balanced = true` (0 = 0 is arithmetically balanced, satisfying the
`is_balanced = (debits = credits)` CHECK); it still cannot advance because deterministic validation raises
`no_lines`. Balanced-before-advance (`status='draft' OR debits=credits`), posting-request approval /
closed-period / SoD (`approved_by <> requested_by`) CHECKs and the unique `posting_idempotency` ledger all hold.

## Contract / permission / event metrics

| Metric | Value |
| --- | --- |
| `journals.*` permissions | 27 (9 privileged) — 3-segment; no `journals.admin`, no approve/post permission |
| `JOURNAL_` audit codes | 23 · registered audit-code total **608** (= actual count) |
| `journal.lifecycle` event types | 16 |
| `posting_request.lifecycle` event types | 6 (posting deferred) |
| Total registered event families | 20 (tail = `posting_request.lifecycle`) |
| API `/api/v1/journals` mutating routes | 22 (each `@Endpoint` = permission + audit code) |
| API read routes | 14 |
| Approval routes / external-post routes | 0 / 0 |
| Lifecycle state machines | 5 |
| Deterministic validation reason codes | 13 |

## Verdicts

- **Accounting invariant** — PASS: debits == credits before advancement, exact integer minor units, no float
  (three enforcing layers: pure engine, service, DB CHECK).
- **M20 intake** — PASS: governed handoff, idempotent per `handoff_ref`, opaque refs, no reads of m20 tables,
  atomic state+audit+event.
- **Journal lifecycle** — PASS: controlled service choke points; advancement/closed/locked-period guards;
  stale-version rejection; append-only history.
- **Closed/locked-period control** — PASS (validation + DB CHECK on posting).
- **Duplicate-post prevention** — PASS (unique idempotency ledger + terminal `succeeded`).
- **Posting-request control** — PASS: prepared only from submitted drafts; approval-gated; no external posting.
- **Maker-checker (SoD)** — PASS (`approved_by <> requested_by` CHECK + service fail-closed).
- **Posting-result evidence** — PASS (append-only history; idempotent recording).
- **Tenancy / RLS** — PASS: FORCE RLS, non-owner role, cross-tenant read/write denied (→ 404).
- **Permissions** — PASS: default deny, seeded, endpoint + service enforcement, header cannot self-grant.
- **Audit** — PASS: registered codes, same-transaction, privacy-safe payloads.
- **Events / outbox** — PASS: both families registered, single m06 outbox, atomic, no foreign families claimed.
- **API** — PASS: 401/403/404/409, idempotency, concurrency, exact minor-unit strings, no approve/post API.
- **Idempotency / concurrency** — PASS (unique constraints, idempotency keys, optimistic CAS, transition guards).
- **M22 boundary** — PASS: no approval workflow; approval referenced by opaque id only.
- **M23/M33 boundary** — PASS: no integration / external posting / ERP connector.
- **Contamination** — PASS: no bank/GL reconciliation, payments/AR/AP/cash, AI, or unrelated module; no second
  outbox/audit/workflow/document engine; no historical migration edited; no FK into m19/m20/m22.
- **CI** — implementation CI green (PG16, both lanes); certification CI recorded on the certification PR.

## Limitations (documented, by design)

No M22 approvals; no M23 integration; no M33 external posting push; no bank/GL reconciliation; no
payments/AR/AP/cash/treasury; no AI. Posting request/result tables + `posting_request.lifecycle` exist so the
downstream contract is expressible and the controls are testable, but **no external connector is invoked** —
external posting is **Framework Only** until proven against real systems (ADR-096).

## Final verdict

**CERTIFIED ON BRANCH** — `cert/stage-3-m21-journal` @ baseline `fb74356`. Certification merge SHA: pending
(certification PR not merged).
