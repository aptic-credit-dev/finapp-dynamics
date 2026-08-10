# Stage 6D-1 — M33 Integration Foundation — Certification

**Module:** `m33-integration` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-10. **Fourth Stage-6 module certified.**
**ADR:** ADR-120 (framework-only runtime; not a secrets manager; `connector_*` prefix; registered capabilities; M31 port).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #82 — merged → `main` `ab01b7c123b07f8bd98355bf8b4397fdf6028307` (m33 `approved_for_build`) |
| Implementation PR | #83 — closed, merged, merged_at `2026-08-10T10:16:07Z` |
| Reviewed implementation head | `4659c57` |
| Implementation merge SHA | `8f506ca00b4e7785f389bf81c14ccfd92c4d4037` (single parent `ab01b7c` = squash) |
| Tree equivalence | `git diff 4659c57 8f506ca` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `8f506ca00b4e7785f389bf81c14ccfd92c4d4037` |
| Certification branch | `cert/stage-6-m33-integration` (from `8f506ca`) |
| Implementation CI (reviewed head `4659c57`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m33-integration` · Stage 6D-1 · **Integration Foundation** (connector SDK/registry, connection management,
FRAMEWORK-ONLY connector runtime) · **mvp:false** · **not a production runtime, not a secrets manager, no arbitrary
code** · **`/api/v1/integration`** · `integration.*` permissions · audit prefix `INTEGRATION_` · event family
`connector.lifecycle` · one m06 outbox · implements **M31's `IntegrationCapabilityCatalogPort`** · uses the **`connector_*`**
table prefix (m23-finance-integration keeps `integration_*`) · **M41 real secrets deferred behind a fail-closed port**.

## C. Local certification gates (clean checkout on baseline `8f506ca`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m33 adds none) |
| build | pass |
| smoke lane | 38 suites, **6452** assertions, 0 failures (m33-integration 80 · conformance **3386**) |
| migration ordering + checksums (dry-run) | pass (`345c103b17ec`, `3665e0db1a29`) |
| fresh migration replay | **64** migrations applied (m33 = 2; no historical migration edited) |
| DB/API lane (fresh DB) | **79** specs, **2439** assertions, 0 failures |
| — `m33-integration` DB spec | 31 |
| — `m33-services` DB spec | 19 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 DB lane + this cert PR's lanes are the authoritative PG16 evidence.

## D. Database — live catalogue evidence (m33-owned 9 connector_* tables, non-owner application role)

9 tables · **9/9 RLS ENABLE · 9/9 FORCE · 9/9 `tenant_isolation`** · **6 composite tenant-safe FKs · 0 unsafe single-column
tenant FKs** · **0 DELETE grants** · 4 append-only ledgers (INSERT+SELECT) · **27 governance CHECK constraints** · 5 version
columns · **0 float** · **0 secret-value columns** (`connection_secret.secret_ref` is a `text` opaque pointer with a
`secretref:`-shape CHECK) · **1 published-immutability trigger** (`connector_definition`) · **1 outbox (m06 — m33 owns
none)** · 9 `integration.*` permissions (4 privileged, all 3-segment) · 15 `INTEGRATION_` audit codes · `connector.lifecycle`
(6 event types) · **64 total migrations**. reference_tables reconciled **38 → 9** (documented in module-registry +
implementation-manifest + completion evidence — the 38 was the full reference-implementation baseline; this Stage-6D-1 core
is the governed framework-only foundation).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **Framework-only runtime / no production egress** — `ConnectorRuntimePort` is a fail-closed abstraction (`FrameworkConnectorRuntime` deterministic double + `UnavailableConnectorRuntime`); a run against an unavailable runtime is durably BLOCKED (services DB spec); no network/provider call in source | **PASS** |
| **Not a secrets manager (M30 seam / M41 boundary)** — a connection stores secrets only as opaque `secretref:` pointers (`connection_secret_ref_shape_ck`); a connection config is screened for raw secret values (fail closed); **0 secret-value columns**; real resolution deferred to M41 behind a fail-closed port | **PASS** |
| **M23 boundary — no `integration_*` collision** — m33 uses the `connector_*` prefix; the 7 `integration_*` tables remain m23-finance-integration's; m23 source untouched (`git diff` since governance = empty) | **PASS** |
| **No arbitrary code** — the SDK exposes registered declarative capabilities only; no eval/`Function`/`vm`/shell/network/direct-DB-access in source; no approval/SoD bypass | **PASS** |
| **M31 `IntegrationCapabilityCatalogPort`** — `M33IntegrationCapabilityCatalog implements` it; a capability reference is available iff it maps to a PUBLISHED connector's active capability (fail closed); m31 source unchanged | **PASS** |
| **Maker-checker / SoD / immutability** — connector publication requires a human approver ≠ requester (`connector_review_sod_ck` + `_decider_ck`), a passing validation (`evidence_ck`), and a published connector is immutable (trigger; only → deprecated); AI never approves | **PASS** |
| **Events / outbox** — `connector.lifecycle` registered once (m33-owned, newest tail), 6 event types, privacy-safe payloads (ids/keys/counts/reason codes only); one m06 outbox (m33 owns none) | **PASS** |
| **Permissions** — `integration.*`, 9 codes all 3-segment, 4 privileged (publish/connection.manage/run.execute/control.administer); no `integration.admin`/wildcard; default deny | **PASS** |
| **Audit** — 15 `INTEGRATION_*` codes, registry **814**, source↔registry parity; no config/secret/external content in payloads | **PASS** |
| **Idempotency / concurrency** — idempotency ledger unique key; version CAS rejects stale writes; one published connector per key | **PASS** |
| **Tenancy / privacy** — FORCE RLS; cross-tenant invisible; composite tenant-safe FKs; no secret persistence; bounded evidence | **PASS** |
| **No REST bypass** — every mutating `/api/v1/integration` route authorizes an `integration.*` permission via `@Endpoint`; reads default-deny in-service | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 64) · tables 9 · FORCE RLS 9 · policies 9 · composite FKs 6 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 4 · governance CHECKs 27 · version columns 5 · float 0 · secret-value columns 0 · immutability triggers 1
· permissions 9 (privileged 4) · audit codes 15 (registry 814) · event families 1 `connector.lifecycle` (6 types) · outboxes 1
(m06) · routes: `/api/v1/integration` · smoke 6452/38 · conformance 3386 · DB/API 2439/79 (m33-integration 31 · m33-services 19).

## Contamination — CLEAN

Only `packages/m33-integration/*` + the `connector.lifecycle` contracts family + `apps/api/src/integration/*` + registries/
manifests/docs were added on the implementation branch. **m23-finance-integration untouched** (no `integration_*` collision —
m33 uses `connector_*`); m28/m30/m31/m32 source untouched (M31 port implemented, not modified); no m34+ or m41 implementation;
no second outbox/scheduler/notification/RBAC/audit engine; no production network/provider dependency; no arbitrary-code
runner; no historical migration edited; no business-state mutation; no permission/RLS bypass.

## Documented limitations

- `mvp:false`. reference_tables reconciled **38 → 9** — the governed framework-only foundation.
- The connector runtime + the M41 secret backend are deterministic offline doubles / fail-closed ports; real connector
  runtimes and the real M41 drop in behind the ports unchanged.
- Marketplace (m34), webhooks/event-streaming (m36) and integration governance/release (m37) are deferred (not this module).

## Report path

`docs/build/stages/STAGE_6_M33_INTEGRATION_CERTIFICATION.md` (this file); implementation evidence lives in PR #83.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
