# Stage 3 — M21 Journal Engine: Completion Report

**Module:** `m21-journal` · **Branch:** `feature/stage-3-m21-journal` · **Baseline:** governance PR #43 merge
`88b0549` on `main` (m21 `approved_for_build`). **Status:** implemented on branch (implementation PR open;
**not** merged, **not** certified). **ADRs:** ADR-091 … ADR-096.

## Scope delivered (draft-first MVP)

Recommendation intake (m20 handoff / AI / ops, idempotent) → accept/dismiss → convert into a **balanced** draft
journal; direct draft creation + line management; deterministic, explainable validation (reason codes); the draft
lifecycle up to **submit-for-approval**; approval-gated **posting-request preparation** + posting-result evidence.
**No approval, no external posting, no auto-post, no closed-period posting, no duplicate posting** — enforced in
the engine, the services and the database.

## Database metrics (verified on a real PostgreSQL)

| Metric | Value |
| --- | --- |
| Tables | 18 |
| RLS ENABLE + FORCE | 18 |
| `tenant_isolation` policies | 18 |
| Append-only ledgers | 10 |
| Composite FKs | 16 |
| Single-column tenant FKs | 0 |
| CHECK constraints | 43 |
| Float (`real`/`double precision`) money columns | 0 |
| `bigint` `*_minor` money columns | 11 |
| DELETE grants (application role) | 0 |

## Contract / permission / event metrics

| Metric | Value |
| --- | --- |
| Permissions (`journals.*`, 3-segment) | 27 (9 privileged) |
| Audit codes (`JOURNAL_`) | 23 |
| Event families | 2 — `journal.lifecycle`, `posting_request.lifecycle` |
| Event types | 22 (16 + 6; posting deferred) |
| Lifecycle state machines | 5 (recommendation, draft, spec, posting request, posting result) |
| Validation reason codes | 13 (deterministic, machine-readable) |

## API metrics (`/api/v1/journals`)

| Metric | Value |
| --- | --- |
| Mutating routes (each `@Endpoint` = permission + audit code) | 22 |
| Read routes (permission enforced in-service) | 14 |
| Approval routes | 0 (m21 never approves) |
| External-post routes | 0 (m21 never posts) |

## Quality gates (all green locally)

`format:check` ✓ · `lint` ✓ (0 errors) · `build` ✓ · `test:smoke` ✓ (25 suites, 4816 assertions incl.
conformance 2656, m21 smoke 80) · `migrate --dry-run` / `migrate` ✓ (38 migrations, m21 applies clean) ·
`test:db` ✓ (52 specs, 1673 assertions, 0 failed) — of which **m21-journal 44**, **m21-services 28**,
**api-journals 14**.

Verified behaviours: balanced journals (debits == credits, minor units); balanced-before-advance; deterministic
validation + reason codes; closed-period rejection; maker ≠ checker (SoD); no duplicate posting; idempotent
intake + config create; optimistic concurrency; immutable append-only history; data minimisation (no raw
narrative in events/audit); cross-tenant isolation (RLS → 404); 401/403/404/409 HTTP semantics; header cannot
grant permission.

> Note: CI runs the DB lane on **PostgreSQL 16**; the local verification above used PostgreSQL 15.2 (the only
> engine available on the build host). The migrations + specs use no version-specific features.

## Boundary verdict

No M22 approval workflow, M23 finance integration, M33 posting push, bank/GL reconciliation, payments/AR/AP/cash,
AI, or external ERP/core connector implemented. No historical migration edited; no second outbox; no direct
external posting; no fabricated approval; no float money; no ownership leakage from m19/m20.

## Remaining manual action

Merge the M21 implementation PR, then run post-merge M21 certification.
