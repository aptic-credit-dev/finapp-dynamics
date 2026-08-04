# m23-finance-integration — Finance Integration Foundation (Framework Only / POST-MVP)

Records the **governed integration execution** of already-approved posting intents (opaque m21 posting-request + m22
approval references) against a configured external **destination**, with a Framework-Only lifecycle, **bounded** retry,
append-only evidence and an idempotency ledger. Because **no production connector exists**, **dispatch never calls
out** — it records intent only (ADR-096/101). It **never approves, never posts**, and reaches no external system.

|                  |                                                          |
| ---------------- | -------------------------------------------------------- |
| Module code      | `m23-finance-integration`                                |
| Build stage      | 3 (Finance) — last module                                |
| MVP              | false (POST-MVP; Framework Only)                         |
| API prefix       | **none** (no HTTP surface — internal library)            |
| Permissions      | **none** (no permission namespace)                       |
| Event family     | **none** (publishes no events; owns no outbox)           |
| Audit prefix     | `FIN_` (`FIN_INTEGRATION_` codes; shared with m19, ADR-079) |
| Tables           | 8 FORCE-RLS (5 append-only); no DELETE grant             |
| ADRs             | ADR-101, ADR-102 (and ADR-096)                           |

## What it owns (8 tables)

- **Destination** — `integration_destination` (versioned, one **enabled** per system_code+scope; holds a
  `secretref:` **pointer**, never a secret) + append-only `integration_destination_history`.
- **Config** — `integration_config` (versioned, immutable-after-publish, idempotency-keyed; bounded retry defaults;
  allow-list always on).
- **Execution** — `integration_execution` (the governed execution aggregate; opaque m21/m22 refs; `bigint` minor-unit
  evidence; no-dispatch-without-approval + bounded-retry CHECKs) + append-only `integration_execution_history`.
- **Evidence** — append-only `integration_attempt` (`framework_only` always true), `external_reference` (ack /
  failure / correlation mappings), `integration_idempotency` (unique per key).

## Invariants (DB-enforced)

- **No dispatch without approval** — an execution can only reach `dispatched`/`acknowledged` with an m22 `approval_ref`.
- **Bounded retry** — `attempt_count <= max_attempts`, `max_attempts BETWEEN 1 AND 10`, attempt numbers bounded.
- **Framework only** — every attempt row is `framework_only = true`; the only dispatch adapter makes no external call.
- **Secret references only** — `secret_reference` matches `^secretref:…` (format CHECK); there is **zero**
  credential/secret value column (ADR-102).
- **No float / no monetary transformation** — `amount_minor` is `bigint` opaque evidence, never computed.
- **No duplicate action** — `integration_idempotency` unique per key; executions idempotency-keyed.
- **One enabled destination** per (system_code, scope); the allow-list can never be disabled.
- Every table: composite `(tenant_id, id)` keys, RLS **FORCE** + `tenant_isolation`, composite FKs, `version` on the 3
  mutable aggregates. **No DELETE** grant; 5 ledgers are INSERT+SELECT only. **No second outbox** (m23 owns none).

## Boundary

Owns governed integration **execution + evidence** only. NEVER approves (m22), posts/creates journals or
posting-requests (m21), reconciles (m20/m15), owns a chart of accounts (m19), or touches payments/AR/AP/treasury/AI
(m27). No API surface, no permission namespace, no event family, no second workflow/timer/notification engine. m19–m22
are referenced by **opaque id**; m33 (Integration Foundation) is an unbuilt dependency — a real connector is deferred
behind the `DispatchPort` until proven.

## Tests

`test/m23-finance-integration.smoke.ts` (PURE: lifecycles, bounded retry, secret-reference validation, dispatch gate,
audit codes); `test/m23-finance-integration.db-spec.ts` (governance: RLS, no-DELETE, append-only, no float, zero secret
columns, secret-reference CHECK, no-dispatch-without-approval, bounded retry, idempotency, one-enabled destination,
composite FKs, single outbox); `test/m23-services.db-spec.ts` (end-to-end Framework-Only lifecycle — dispatch never
calls out, bounded retry to exhaustion, idempotency, optimistic concurrency, data minimisation, cross-tenant RLS).
