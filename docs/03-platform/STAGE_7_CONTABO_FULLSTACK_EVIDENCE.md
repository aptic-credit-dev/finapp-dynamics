# STAGE-7 CONTABO FULL-STACK TECHNICAL EVIDENCE — FUTURE PRODUCTION HOST / CURRENTLY STAGING

> Tier-1 automated execution on the approved **Contabo** host (ADR-131). **NOT** Tier-2 independent acceptance,
> **NOT** a production GO. The four Stage-7 workstreams remain `requires_review`; production readiness remains
> `CONDITIONAL_GO`. Treat the host as **`STAGING NOW → CLEAN PRODUCTION COMMISSIONING LATER`** (§ Future production).
> No passwords, private keys, tokens, or customer data appear here (or were committed anywhere).

## Host & capacity verdict

| Field | Value |
| --- | --- |
| Host / IP | `vmi3515072` / `169.58.194.151` (SSH port 22, key-based) |
| Server type / location | Cloud VPS 12 (2026) / Hub Europe |
| OS / kernel | Ubuntu 24.04.4 LTS / 6.8 |
| **vCPU (measured)** | **12** (AMD EPYC) |
| **RAM (measured)** | **47 GiB** |
| **Disk (measured)** | **400 GB SSD** (non-rotational), 385 GB free |
| Clean-host check | Only default `ubuntu` user; no nginx/apache/PostgreSQL/MySQL/Docker pre-existing; only ports 22 + loopback DNS; `/opt`,`/srv`,`/var/www`,`/root` empty → **clean, dedicated** |

**Capacity verdict: `HOST SUITABLE FOR INITIAL PRODUCTION`** — 12 vCPU / 47 GiB / 400 GB SSD comfortably covers
PostgreSQL 16 + the API + Docker + a reverse proxy + Vault + logs/metrics + backups for staging, the first pilot,
and initial production. (Observed staging idle usage: API ~60 MiB, DB ~70 MiB of 47 GiB.)

## Hardening

- **Firewall:** `ufw` active, **deny-by-default incoming**, **SSH 22 allowed first** (never locked out); PostgreSQL
  and the API are **not** published beyond `127.0.0.1` (compose binds loopback only).
- **Docker Engine 29.7.2 + Compose v5.5.0** installed and enabled.
- **unattended-upgrades** installed (automatic security updates).
- **Key-based SSH** proven (`BatchMode`); password rotation recommended (the initial root password was exposed in
  chat and must be rotated; consider disabling password auth).

## Deployment

- **Deployed SHA:** `fb63f3c` (merged `origin/main`), delivered via `git archive` (no GitHub creds on the host).
- Stack: `deploy/staging/docker-compose.yml` → **`postgres:16`** + the API (multi-stage non-root image); migrations
  run on API start.
- **PostgreSQL 16.15** confirmed; **82 migrations** applied; synthetic bootstrap: **2 tenants, 2 identities, 1
  `platform_admin` grant**; **no production data / no production connector credentials**.

## Validation (all PASS — real PG16)

`postgres_is_16` (160015) · `migrations_applied` 82 · `app_role_nonprivileged` (`finapp_app`: super=false,
bypassrls=false — NOBYPASSRLS non-owner) · `force_rls_active` **506** · `two_plus_tenants` 2 ·
`connectors_non_production` (0) · `no_production_secrets` (0 secret-value columns) · **`http_health` GET
/api/v1/health → 200**. `critical_failures=0`. (Cross-tenant auth/RBAC/isolation correctness is proven by the DB/API
integration lane; see limitations.)

## DR drill (full PG16, 0 critical failures)

backup (`staging-backup:bc88e513…`, checksum verified) → clean recovery target → in-process schema migrate (82) →
restore (5 rows) → migrations 82/82 → FORCE-RLS 506/506 → reconcile (tenants 2/2, identities 2/2, grants 1/1) →
**failover (app health = 200 during recovery)** → failback (source unchanged).

| Metric | Observed | Approved target (OQ#13) | Meets? |
| --- | --- | --- | --- |
| RTO | **96 ms** (backup 38 + restore 58) | ≤ 15 min | ✅ observed |
| RPO | **0 s** (exact logical restore of deterministic synthetic data) | ≤ 5 min | ✅ observed |

_Tier-1 measurement only — independent DR assurance + COO acceptance remain Tier-2._

## Load (real PG16 API; generator in a separate container)

| Scenario | Conc | rps | p50 | p95 | p99 | max | 5xx |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 2 | 243 | 6.6 | 16.2 | 31.7 | 91 | 0 |
| ramp | 8 | 673 | 10.9 | 21.7 | 32.6 | 59 | 0 |
| sustained | 12 | 958 | 10.5 | 26.8 | 50.7 | 108 | 0 |
| burst | 40 | 1032 | 31.8 | 78.7 | 116.2 | 186 | 0 |
| multi_tenant | 12 (2 tenants) | 957 | 10.3 | 27.6 | 48.3 | 68 | 0 |

The `401`s in the status mix are the **RBAC/auth guard** correctly denying the unauthenticated protected endpoint
(a security-positive), not server errors. **0×5xx** across all scenarios.

| SLO (OQ#13) | Observed | Meets? |
| --- | --- | --- |
| Availability ≥ 99.9% | health 200 throughout | ✅ observed |
| p95 ≤ 200 ms | ≤ 79 ms | ✅ observed |
| p99 ≤ 500 ms | ≤ 116 ms | ✅ observed |
| Platform error rate ≤ 0.5% (excl. expected 4xx) | 0×5xx | ✅ observed |

_Observed metrics meet the approved SLOs; **operational acceptance is COO/Ops (Tier-2), not claimed here.**_

## Chaos (controlled, non-destructive)

| Scenario | Result |
| --- | --- |
| malformed_traffic | 50 malformed POSTs → all **400**, no 5xx, health OK after |
| burst_spike | 60-conc → all 200, p95 ~103 ms, **recovery 4 ms** |
| connection_exhaustion | 120-conc, 3167 req all 200, p99 ~309 ms, **recovery 5 ms** |
| dependency_timeout | 1 ms client-timeout → aborts, **server did not crash**, health OK |
| **API restart** | `docker compose restart api` → **health recovered in ~2.7 s** |
| **DB restart** | `docker compose restart db` → liveness stayed 200; **DB reconnect ~0.57 s**; post-restart DB ops PASS |

## Backups

- `backups/backup.sh`: `pg_dump -Fc` → **2.0 MB** dump + **SHA-256 (verified OK)** + **restore-verify into a
  throwaway DB (2 tenants restored)**; retention 7; **daily cron 02:30**.
- **Off-server / logically-separated backup copy: NOT yet configured** — a **pre-production commissioning
  requirement** (not claimed as existing; this alone does not prove production DR).

## Observability

Application logs (2423 lines, route map captured) · **audit spine (m03) tables present** · container metrics
(`docker stats`) · DB metrics (`pg_stat_activity`, 6 conns, PG16.15) · restart/health visibility (`docker inspect`:
restarts=0, health=healthy). Signals are available; a **centralized log/metric/alert aggregator** is a
production-commissioning follow-up (provider-neutral).

## Vault / secrets

**Vault NOT deployed** — M41 stays **fail-closed** (`SecretProviderPort` unavailable). **0 secret-value columns**;
the only secret (staging PostgreSQL password) is a generated value held in `deploy/staging/.env.staging` on the host
(`chmod 600`) — **never printed, never committed, never in a DB column or app log**. Remaining action: deploy the
approved self-hosted Vault-compatible backend and implement the `SecretProviderPort` adapter before production.

## Limitations / deviations

- **Authenticated DB-write load was not executed** — the synthetic bootstrap seeds tenants + identities but **not
  loginable credentials** (argon2 accounts), so the load exercised the HTTP/routing/**auth-guard** layer + the
  DB-free health path, not authenticated write throughput. Auth/RBAC/write **correctness** is proven by the DB/API
  integration lane (`api-auth`/`api-identity`/`api-rbac`); production-scale authenticated-write **throughput** is a
  follow-up (seed login accounts).
- Off-server backup/DR destination and a centralized observability aggregator are pre-production follow-ups.
- All metrics are Tier-1 observations; no Tier-2 acceptance is implied.

## Future production commissioning (must NOT be a mere `NODE_ENV` flip)

Before this host becomes production: remove all synthetic staging data; fresh production DB/volumes; fresh
production secrets via Vault; production TLS/domain + reverse proxy on 443; production firewall validation;
**off-server backup + DR verification**; approved **real migration** (OQ#14) with CFO/Legal/business sign-off; and
the **M42 governed GO**. See `STAGE_7_CONTABO_DEPLOYMENT_RUNBOOK.md` §5.

## Remaining Tier-2 gates (unchanged)

Independent external pentest + Auditor assurance · independent DR assurance + COO/Operations acceptance · authenticated-write
load acceptance · real migration source (OQ#14) + CFO/Legal/business sign-off · Vault + off-server DR · **M42
governed production GO**.
