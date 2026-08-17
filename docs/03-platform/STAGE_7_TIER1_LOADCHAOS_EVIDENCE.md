# Stage 7 — Tier-1 Automated Load/Chaos Execution Evidence

> **`TIER-1 AUTOMATED LOAD/CHAOS EXECUTION — NON-PRODUCTION — NOT OPERATIONAL ACCEPTANCE.`**
> Under ADR-131 (ACCEPTED). Tier-1 automated execution + evidence. NOT approved SLOs, NOT COO/Operations
> acceptance, NOT independent assurance, NOT production readiness/GO. `load_and_chaos_at_scale` remains
> `requires_review`; production readiness remains `CONDITIONAL_GO`.
> **`ACCEPTANCE AGAINST SLO: PENDING OQ#13 / HUMAN-APPROVED SLO TARGETS`** — no SLO PASS/FAIL is computed.

## Execution target (honest)

- Assessed commit `4ecb42f` (merged main; branch adds only `deploy/staging/*` + this evidence).
- **The real Nest API was booted locally** (`node apps/api/dist/src/main.js`, `NODE_ENV=staging`) against a fresh
  migrated + synthetic-seeded **local PostgreSQL 15.2** — `/api/v1/health` served `{"status":"ok"}` (HTTP 200).
- **Not** the Docker `postgres:16` staging stack — **Docker daemon is down** on this box; the harness targeted the
  local API at `http://127.0.0.1:3010`. Runtime stated honestly: PG **15.2**, not PG16.
- No production, no external providers, synthetic data only, loopback target only.

## Load results (`load-harness.mjs`)

Endpoints: `/api/v1/health` (unauth → 200) and `/api/v1/platform-certification/programmes` (protected, unauth →
**401**). The 401s are the **RBAC/auth guard correctly denying unauthenticated access** — a security-positive, not a
server error. **No 5xx** occurred in any scenario.

| Scenario | Concurrency | Requests | Throughput (rps) | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 2 | 742 | 370.6 | 4.1 | 5.9 | 16.3 | 267.0 |
| ramp | 8 | 1375 | 456.4 | 15.3 | 33.2 | 45.8 | 57.2 |
| sustained | 12 | 1959 | 485.7 | 21.0 | 46.1 | 67.5 | 105.3 |
| burst | 40 | 601 | 287.3 | 139.4 | 222.7 | 252.5 | 255.1 |
| multi_tenant | 12 (2 tenants) | 1336 | 442.8 | 25.1 | 45.5 | 55.4 | 63.7 |

Status distribution across scenarios: `200` (health) + `401` (protected/unauth); **0×5xx**. Observation: throughput
~450–486 rps at 12 concurrency with p95 ~46 ms; latency degrades gracefully under a 40-concurrency burst (p95
~223 ms) with no errors introduced.

## Chaos results (`chaos-harness.mjs`) — controlled, reversible, non-destructive

| Scenario | Result |
| --- | --- |
| malformed_traffic | 50 malformed-JSON POSTs → **all 400** (graceful reject); **no 5xx**; health OK after |
| burst_spike | 60-concurrency burst → all 200; p95 ~211 ms during; **recovery 4 ms**; health OK after (3.7 ms) |
| connection_exhaustion | 120-concurrency → 1141 req all 200; p99 ~381 ms; max ~413 ms; **recovery 5 ms** |
| dependency_timeout | 1 ms client-timeout → 360 client aborts; **server did not crash**; health OK after |

The API remained healthy (`/api/v1/health` → 200) after every chaos scenario. No data was destroyed; all scenarios
were bounded and reversible.

## Recovery measurements

Detected recovery (health returns 200) after burst = **4 ms**, after connection-exhaustion = **5 ms**. Data
integrity: synthetic control totals unchanged (no mutation performed by load/chaos). Tenant-isolation posture:
FORCE-RLS unchanged.

## Findings / remediation / retest

- **No 5xx server errors** under any load or chaos scenario; **no crash**; graceful `400` on malformed input;
  consistent `401` auth enforcement under load. **No engineering defect surfaced → no remediation required → no
  retest needed.**

## Limitations (honest — strict)

- Target was the **local booted API against PG 15.2**, **not** the Docker PG16 staging stack (Docker daemon down).
- **Authenticated DB-touching load was not exercised** — no loginable credentials are seeded (protected endpoints
  return `401` before touching the DB), so the load stressed the HTTP/auth/routing layer + the unauthenticated
  health path, not deep DB-write throughput. That requires seeded login accounts + a running staging stack.
- **API process-restart and DB-restart chaos were NOT executed** — the Windows PID capture for the process kill did
  not resolve, so those scenarios did not run and are **not** claimed. The traffic-based chaos (malformed / burst /
  exhaustion / timeout) did run.
- No approved SLO exists (OQ#13); metrics are observed only, with **no PASS/FAIL**.

## Evidence metadata

- Environment: local API `http://127.0.0.1:3010`, PG 15.2 (`finapp_stg`), synthetic seed (2 tenants, 2 identities).
- Tools: `deploy/staging/load-harness.mjs`, `chaos-harness.mjs`; safety self-test `loadchaos-selftest.mjs` (19/19).
- No raw credentials/customer data committed; recorded as an **opaque reference** for M42 — never operational
  acceptance.

## Remaining Tier-2 gates (unchanged)
Approved SLO targets (OQ#13) · operational acceptance (COO) · independent assurance · the full staging-stack run on
a Docker-enabled PG16 target with authenticated DB-write workloads + process/DB-restart chaos · production GO (M42).
