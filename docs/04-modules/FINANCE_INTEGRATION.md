# M23 — Finance Integration Foundation (Framework Only / POST-MVP)

**Module:** `m23-finance-integration` · **Stage:** 3 (Finance, last module) · **MVP:** false · **Status:** implemented
**API:** none · **Permissions:** none · **Events:** none · **Audit:** `FIN_` (`FIN_INTEGRATION_`, shared with m19)
**Tables:** 8 FORCE-RLS (5 append-only) · **ADRs:** ADR-101, ADR-102 (with ADR-096)

## Purpose

M23 is the **finance integration foundation**: it takes the output of the governed finance pipeline — an m21 posting
request that an m22 approval has released — and records its **integration execution** toward an external destination
(ERP / core banking / accounting / ledger). It is **Framework Only / POST-MVP**: no production connector exists, so
**dispatch never calls out** — it records intent and evidence only (ADR-096/101). AI and automation never post; M23
never approves and never posts. Posting to a real core system is switched on later, behind the `DispatchPort`, once
proven against a real system with confirmed contracts.

Repository truth (naming-map) is authoritative and preserved: M23 has **no API surface, no permission namespace and no
event family**, and it **owns no outbox**. It is an internal foundation library that other modules (a future full M23,
or m33) build on; the RBAC-gated API + event family are deferred to the proven-integration phase.

## The lifecycle (Framework-Only)

```
prepared ──▶ ready ──▶ dispatched ──▶ acknowledged        (terminal success)
   │           ▲            │
 cancel      retry        failed ──▶ retryable ──▶ exhausted   (bounded)
   ▼                         └────────────────────▶ cancelled
cancelled
```

- **Dispatch never calls out** — the only `DispatchPort` adapter (`FrameworkOnlyDispatch`) performs no external
  request; it returns a Framework-Only marker and the execution records a `dispatched` **attempt** as evidence.
- **Bounded retry** — a failure schedules a retry (`retryable → ready`) while attempts remain, else exhausts. Depth is
  DB-bounded (`attempt_count <= max_attempts <= 10`) and the backoff is deterministic (no jitter).
- **No direct status mutation** — every transition goes through a service that consults the pure state machine, writes
  append-only history, CAS-guards the write (optimistic concurrency / stale-version rejection) and audits it.

## Governance + security

| Control | How |
| --- | --- |
| No dispatch without approval | DB CHECK: `dispatched`/`acknowledged` require an m22 `approval_ref`; the service re-checks via the dispatch gate |
| Destination allow-list | `integration_config.enforce_allowlist` can never be disabled (CHECK); the gate requires `allowlisted` + enabled |
| Secret storage | a `secretref:` **reference** only (format CHECK); **zero** credential/secret value column (ADR-102) |
| SSRF / TLS / signing | not applicable in the MVP — there is **no endpoint column and no network call** |
| Idempotency | `integration_idempotency` unique per key; executions idempotency-keyed (no duplicate action) |
| Bounded retry / failure evidence | attempt/max CHECKs; `exhausted` terminal; `external_reference` records ack/failure |
| No monetary transformation | `amount_minor` is opaque `bigint` evidence, never computed; no float column (ADR-007) |
| Audit | every controlled mutation records a `FIN_INTEGRATION_` code through the m03 `AUDIT` port |
| Tenant isolation | all 8 tables RLS FORCE + `tenant_isolation`; composite keys/FKs |
| Connector ownership | platform-vs-tenant connector ownership is deferred with the real connector (Framework Only) |

## Boundaries

Owns governed integration **execution + evidence** only. NEVER: journal creation/validation or posting requests
(m21); approval policy/decisions (m22); GL/bank reconciliation (m20/m15); chart of accounts (m19); payments/AR/AP/cash
management/treasury; a generic integration-platform duplication (that is m33); AI (m27); a direct secret; a second
outbox; a second workflow engine. m19–m22 are referenced by **opaque id** (no table reads); **m33** (Integration
Foundation, phase 6) is an unbuilt dependency, deferred behind the `DispatchPort`.

## Divergence note

`module-registry.yaml` carried a `reference_tables: 3` placeholder (M23 was never spec'd). The actual Framework-Only
foundation is **8 tables**; the count is synchronised and the divergence recorded in ADR-101. The naming-map's empty
API/permission/event namespaces are intentionally preserved — no unproven surface is claimed.
