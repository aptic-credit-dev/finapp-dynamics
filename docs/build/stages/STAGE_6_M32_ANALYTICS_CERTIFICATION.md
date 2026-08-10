# Stage 6C — M32 Reporting & Analytics Builder — Certification

**Module:** `m32-analytics` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-10. **Third Stage-6 module certified.**
**ADR:** ADR-119 (governed derived/read analytics; no arbitrary SQL; entitlement intersection; M28 port; m10 subsumed).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #79 — merged → `main` `a27be3a9ace6fdf3e12b6782b3b866676e2cdb83` (m32 `approved_for_build`) |
| Implementation PR | #80 — closed, merged, merged_at `2026-08-10T08:05:41Z` |
| Reviewed implementation head | `d8b0d08` |
| Implementation merge SHA | `3680779f4c7e2a0537e2092cff57d0974a6ebccf` (single parent `a27be3a` = squash) |
| Tree equivalence | `git diff d8b0d08 3680779` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `3680779f4c7e2a0537e2092cff57d0974a6ebccf` |
| Certification branch | `cert/stage-6-m32-analytics` (from `3680779`) |
| Implementation CI (reviewed head `d8b0d08`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m32-analytics` · Stage 6C · **Reporting & Analytics Builder** · **mvp:false** · a **GOVERNED, DERIVED/READ** analytics
layer (semantic datasets, metrics/KPIs, reports, dashboards, exports, scheduled-report metadata) · **not a source of truth,
no business mutation** · **`/api/v1/analytics`** · `analytics.*` permissions · audit prefix `ANALYTICS_` · event family
`analytics.lifecycle` · one m06 outbox · **implements the M28 `ExecutiveAnalyticsPort`** (ADR-112) · **m33/m41 deferred behind
a fail-closed port**.

## C. Local certification gates (clean checkout on baseline `3680779`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m32 adds none) |
| build | pass |
| smoke lane | 37 suites, **6319** assertions, 0 failures (m32-analytics 99 · conformance **3335**) |
| migration ordering + checksums (dry-run) | pass (`72bb48492348`, `cd3cb91b14aa`) |
| fresh migration replay | **62** migrations applied (m32 = 2; no historical migration edited) |
| DB/API lane | **77** specs, **2389** assertions, 0 failures |
| — `m32-analytics` DB spec | 34 |
| — `m32-services` DB spec | 23 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 DB lane + this cert PR's lanes are the authoritative PG16 evidence.

## D. Database — live catalogue evidence (m32-owned 11 tables, non-owner application role)

11 tables · **11/11 RLS ENABLE · 11/11 FORCE · 11/11 `tenant_isolation`** · **7 composite tenant-safe FKs · 0 unsafe
single-column tenant FKs** · **0 DELETE grants** · 5 append-only ledgers (INSERT+SELECT) · **43 governance CHECK constraints**
· 6 version columns · **0 float** (money is `bigint` minor units + exact `numeric` + integer bps) · **0 secret-value columns**
· **2 published-immutability triggers** (metric + report) · **1 outbox (m06 — m32 owns none)** · 12 `analytics.*` permissions
(6 privileged, all 3-segment) · 17 `ANALYTICS_` audit codes · `analytics.lifecycle` (7 event types) · **62 total migrations**.
reference_tables reconciled **42 → 11** (documented in module-registry + implementation-manifest + completion report — the 42
was the full reference-implementation baseline; this Stage-6C core is the governed derived/read layer over the source modules).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **Governed semantic query (no arbitrary SQL)** — `compileMetricQuery` accepts only whitelisted dimensions/measures/operators + scalar-bound values → structured plan → fixed parameterized SELECT; unknown dim/measure/operator or non-scalar value fails closed (smoke + DB proven) | **PASS** |
| **RLS + entitlement intersection** — every tenant table FORCE-RLS; `evaluateEntitlement` requires ALL required entitlements at sufficient scope/sensitivity; a caller missing an entitlement gets no aggregate (no hidden-count leak, no cross-tenant inference) | **PASS** |
| **Mandatory lineage / citation integrity** — every query/materialization/export writes `analytics_lineage` (source module, dataset, metric version, window, filters, classification); the M28 evidence is citation-bearing and carries no value | **PASS** |
| **Governed exports** — privileged (`analytics.export.create`), FILTER-BEFORE-EXPORT (runs the entitlement-gated query first), bounded, audited, bytes behind an opaque m09 `docref:`; default-deny without the permission | **PASS** |
| **Money safety** — `bigint` minor / exact `numeric` decimal / integer bps, explicit currency; a money metric must declare a currency (`currency_ck`); **0 float**; measures projected `::text` | **PASS** |
| **Maker-checker / immutability** — metric/report publication requires a human approver ≠ requester (`analytics_review` SoD + decider CHECKs), a passing validation (`evidence_ck`), and a published definition is immutable (triggers; only → superseded); AI never approves | **PASS** |
| **M28 boundary** — `M32ExecutiveAnalyticsAdapter implements ExecutiveAnalyticsPort` (read-only, bounded, entitlement-filtered, citation-bearing, no values); M28 remains the downstream consumer; M28 source untouched (merge diff touches no m28 file); no duplicated executive-analytics engine | **PASS** |
| **M10 boundary** — m32 is the canonical reporting/analytics builder; m10-report subsumed (SHARED_SERVICE_OWNERSHIP + ADR-119); no second reporting engine | **PASS** |
| **M04 boundary** — m32 owns analytics dashboards; m04 `admin_saved_view` (console filter presets) untouched; no second saved-view engine | **PASS** |
| **M06 / M08 reuse** — scheduled reports hold opaque m06 timer + m08 notify references (m32 owns no scheduler/timer/notify engine); one m06 outbox (m32 owns none) | **PASS** |
| **Idempotency / concurrency** — idempotency ledger unique key; version CAS rejects stale writes; one published metric/report per key (partial unique indexes) | **PASS** |
| **Permissions** — `analytics.*`, 12 codes all 3-segment, 6 privileged; `analytics.control.administer` control-plane; no `analytics.admin`/wildcard; default deny; request headers create no authority | **PASS** |
| **Audit / events** — 17 `ANALYTICS_*` codes, registry **799**, source↔registry parity; `analytics.lifecycle` (7 types) via the one m06 outbox; payloads carry ids/keys/kinds/versions/row counts/reason codes only — no metric value/report body/source data/secret | **PASS** |
| **Tenancy / privacy** — FORCE RLS; cross-tenant invisible; no secret-value persistence; bounded evidence | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 62) · tables 11 · FORCE RLS 11 · policies 11 · composite FKs 7 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 5 · governance CHECKs 43 · version columns 6 · float 0 · secret-value columns 0 · immutability triggers 2 ·
permissions 12 (privileged 6) · audit codes 17 (registry 799) · event families 1 `analytics.lifecycle` (7 types) · outboxes 1
(m06) · smoke 6319/37 · conformance 3335 · DB/API 2389/77 (m32-analytics 34 · m32-services 23).

## E. M32ExecutiveAnalyticsAdapter — documented limitation (unchanged, verified)

The implementation exports `M32ExecutiveAnalyticsAdapter` (the real M28 `ExecutiveAnalyticsPort` implementation) and provides
it in the analytics module, but the **copilot module has NOT been rewired** to consume it — the deterministic fixture analytics
port is retained there to avoid an M28 regression. This certification **did not change** that state: the merge diff touches no
`packages/m28-executive-ai/**` file and no `M32ExecutiveAnalyticsAdapter` reference exists in `apps/api/src/copilot/**`. The
certified M28 boundary is therefore intact. **Known limitation (still applicable):** swapping the fixture for the real adapter in
the copilot module is a follow-up the port was designed for; the port contract is proven satisfied by the m32-services DB spec.

## Contamination — CLEAN

Only `packages/m32-analytics/*` + the `analytics.lifecycle` contracts family + `apps/api/src/analytics/*` + registries/manifests/
docs were added on the implementation branch. No m24–m31 regression (m28 source untouched); no m33+ or m41 implementation; no
second reporting/query/scheduler/notification/RBAC/audit engine; no second outbox; no duplicate saved-view store; no production
network/provider dependency; no business-state mutation; no permission/RLS bypass; no historical migration edited.

## Documented limitations

- `mvp:false`. reference_tables reconciled **42 → 11** (documented) — the governed derived/read core over the source modules.
- The materialization SOURCE + m33 integration are deterministic offline doubles / a fail-closed `MaterializationSourcePort`; real
  source adapters and the real m33/m41 drop in behind the port unchanged.
- `M32ExecutiveAnalyticsAdapter` provided/exported but not yet swapped into the copilot module (fixture retained) — see §E.

## Report path

`docs/build/stages/STAGE_6_M32_ANALYTICS_CERTIFICATION.md` (this file); implementation completion evidence lives in PR #80.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
