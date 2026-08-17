# Stage 7 — Contabo Staging/Production Deployment Runbook

> Operationalizes the approved OQ#16 direction (management decision 2026-08-17): **Contabo**, kept **portable /
> containerized** (no technical lock-in). Contabo is treated as a plain Linux host running Docker — the same
> `deploy/staging/` assets deploy anywhere. **Executed by Claude/engineering ONCE server access is provided.** This
> runbook is not a Tier-2 acceptance and issues no production GO; independent/human acceptance (Risk/Auditor/COO/
> CFO/Legal + M42) remains required.

## 0. Prerequisites (management/ops to provide)

- A Contabo Linux host (staging) with **Docker Engine + docker compose** installed, and SSH access (key-based).
- A **separate** Contabo host for production (do not co-locate staging + production).
- A Contabo **region/location** confirmed by Technology/Risk/Legal as acceptable under Kenya DPA **before any
  production data** (staging uses synthetic data only).
- (Later) an approved Vault-compatible secrets deployment (OQ#10/ADR-128) before real secrets.

## 1. Host hardening (before deploying the app)

- **Firewall — deny by default** (e.g. `ufw`): allow only SSH (restricted source IP/VPN) and 443 (production).
  Do **not** expose PostgreSQL (5432) publicly — the compose file already binds it to `127.0.0.1` only.
- **SSH:** key-based only (`PasswordAuthentication no`, `PermitRootLogin no`); restrict to approved IPs/VPN.
- **TLS:** terminate HTTPS for production app traffic (reverse proxy / Caddy / nginx with a valid cert); the
  container publishes to loopback and the proxy fronts 443.
- **OS:** unattended security updates; non-root service user; time sync.

## 2. Deploy the containerized stack

```
git clone <repo> && cd finapp-dynamics
cp deploy/staging/env.staging.example deploy/staging/.env.staging     # set LOCAL-only values; NEVER commit
#   NODE_ENV=staging (staging host) — production host sets NODE_ENV=production (fail-closed CORS/secret guards ON)
docker compose -f deploy/staging/docker-compose.yml --env-file deploy/staging/.env.staging up -d --build
#   migrations run on API container start (npm run migrate); PostgreSQL 16 image is postgres:16
```

## 3. Seed + validate (staging only)

```
STAGING_DR_EXECUTOR_ENABLED=0 node deploy/staging/bootstrap-synthetic.mjs      # 2 synthetic tenants + identities
node deploy/staging/validate-staging.mjs                                       # PG16 gate PASSES here (real PG16)
API_BASE_URL=http://127.0.0.1:3000 node deploy/staging/validate-staging.mjs    # HTTP health check
```

Expected on PG16: `postgres_is_16` PASS, `app_role_nonprivileged` PASS (NOBYPASSRLS non-owner), `force_rls_active`
PASS, `two_plus_tenants` PASS, `connectors_non_production` PASS, `no_production_secrets` PASS.

## 4. Run the full-stack Tier-1 evidence (staging)

Once the stack is up, Claude/engineering runs and records evidence (authorized by ADR-131; still Tier-1):

- **DR drill on PG16** with app-level failover health:
  `STAGING_DR_EXECUTOR_ENABLED=1 DR_SOURCE_URL=<staging pg> API_BASE_URL=http://127.0.0.1:3000 node --experimental-strip-types --conditions=source deploy/staging/dr-drill.mjs`
- **Authenticated DB-write load** + multi-tenant concurrency (seed login accounts first): `deploy/staging/load-harness.mjs` against the running API.
- **Chaos:** `deploy/staging/chaos-harness.mjs` + orchestrated **API restart** and **DB restart/recovery** on the host.
- Acceptance is measured against the **approved SLO/RTO/RPO** (OQ#13): availability ≥99.9%, p95 ≤200 ms, p99 ≤500 ms,
  error rate ≤0.5%, RTO ≤15 min, RPO ≤5 min. Claude reports PASS/observed vs target; **COO/Ops accept** (Tier-2).

## 5. Backups & DR (production)

- **Automated PostgreSQL backups** (logical `pg_dump` on a schedule and/or WAL archiving) + periodic **server/volume
  snapshots**; retention per policy.
- **≥1 backup copy logically separated** from the production server (different Contabo storage/host or off-host).
- DR: a recovery target able to restore + fail over within **RTO ≤15 min / RPO ≤5 min**; rehearse with the DR drill
  tooling before relying on it.

## 6. Observability

- Centralized **application + audit logs**, infrastructure **metrics**, and **alerting** (portable stack, e.g.
  container logs → a log store; Prometheus-style metrics + alertmanager). No vendor lock-in required.

## 7. Secrets (OQ#10 / ADR-128)

- Deploy the approved **self-hosted Vault-compatible** backend, isolated from the app.
- Implement the **`SecretProviderPort` adapter** (M41) that reads secrets from Vault — **zero plaintext secret
  columns**, least-privilege app identity, audit + rotation, encrypted storage, Vault backup/DR. Claude implements
  the adapter **once the Vault deployment is approved and available**; until then M41 stays framework-only.

## 8. Portability principle

Contabo is the host; the **application, PostgreSQL config, compose/deploy scripts, backup jobs, and infra config
must remain portable** to another provider. Nothing here hardcodes a Contabo-only API or a proprietary managed
service.

## 9. What this runbook does NOT do

It does not constitute Tier-2 acceptance, independent DR/security assurance, CFO/Legal/business sign-off, or a
production GO. Those remain human/external, converging on the **M42 governed decision**. Claude never self-certifies.
