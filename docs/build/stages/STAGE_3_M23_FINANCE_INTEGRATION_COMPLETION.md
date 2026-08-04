# Stage 3 — M23 Finance Integration — Completion (Framework Only / POST-MVP)

**Module:** `m23-finance-integration` · **Branch:** `feature/stage-3-m23-finance-integration` · **Date:** 2026-08-04
**Capability:** Finance integration foundation — governed integration execution + evidence (Framework Only)

## What shipped

A **Framework-Only / POST-MVP** finance-integration foundation. It records the governed integration execution of
already-approved posting intents (opaque m21/m22 references) against a configured destination, with a Framework-Only
lifecycle, bounded retry, append-only evidence and an idempotency ledger. **Dispatch never calls out** (no connector;
ADR-096/101). It never approves, never posts, and reaches no external system.

- **8 FORCE-RLS tables** (3 mutable aggregates + 5 append-only ledgers); composite keys/FKs; no DELETE grant.
  Migrations `0001_finance_integration.sql`, `0002_grant_application_role.sql`.
- **Pure domain**: vocabulary + reason codes (`domain/vocab.ts`), destination + execution + spec state machines
  (`domain/lifecycles.ts`), and a pure engine (`engine.ts`) — bounded deterministic retry, secret-reference
  validation, and the Framework-Only dispatch gate.
- **Ports**: `Clock` + `DispatchPort` with the **only** adapter `FrameworkOnlyDispatch`, which performs **no**
  external request.
- **Two services** (`DestinationService`, `ExecutionService`) — audited via m03 (`FIN_INTEGRATION_` codes), no authz
  (no permission namespace), no events (no outbox).
- **12 `FIN_INTEGRATION_` audit codes** registered (`registered_code_count` 631 → 643); `FIN_` prefix shared with m19
  (ADR-079, non-colliding).
- **No API, no permission namespace, no event family, no outbox** — naming-map authoritative and preserved.
- **ADR-101, ADR-102** recorded; module doc + this completion doc + README.

## Repository-truth divergence (recorded)

- `module-registry.yaml` `reference_tables` **3 → 8** (the 3 was an unspecified placeholder; actual is 8). ADR-101.
- The prompt anticipated `/api/v1/finance-integrations` + `finance_integration.*` + `FININT_` +
  `finance_integration.lifecycle`; the **repository declares none of these**, so none were created — M23 is an
  internal Framework-Only library with the shared `FIN_` audit prefix.

## Verification

- **Build:** `npm run build` — green (whole solution).
- **Lint:** `npm run lint` — **0 errors**.
- **Format:** `npm run format:check` — clean.
- **Smoke lane:** 27 suites, **5071 assertions**, 0 failures (m23 smoke 51, conformance 2782).
- **DB lane (PostgreSQL 15.2 throwaway, non-owner role, fresh DB):** **56 specs, 1808 assertions, 0 failures**,
  including **`m23-finance-integration` db-spec (28)** and **`m23-services` db-spec (24)**.

### Live DB governance

8/8 tables RLS FORCE + `tenant_isolation`; 0 DELETE grants; 0 UPDATE on the 5 append-only ledgers; 0 float columns;
`amount_minor` is `bigint`; **0 credential/secret value columns** (only the `secret_reference` pointer); secret-reference
format CHECK rejects inline secrets; no-dispatch-without-approval CHECK; bounded-retry CHECKs; one enabled destination
per system_code+scope; allow-list cannot be disabled; unique idempotency ledger; single outbox (m06) — m23 owns none.

## Known limitations

- **Framework Only** — no production connector; `dispatch` records intent and never calls an external system. TLS,
  request signing, replay protection, SSRF prevention, health monitoring and platform-vs-tenant connector ownership
  arrive with the real connector (deferred behind `DispatchPort`), which needs the (unbuilt, phase-6) **m33**
  Integration Foundation.
- **No API / permission / event surface** — M23 is an internal foundation library; the RBAC-gated API + event family
  are deferred to the proven-integration phase (would be introduced via an ADR closing the naming GAP, as m19 did).
- Local HTTP RLS is exercised via `SET ROLE` to the non-owner role; PostgreSQL 16 CI is authoritative.

## Remaining manual action

Merge the M23 implementation PR, then run post-merge M23 certification.
