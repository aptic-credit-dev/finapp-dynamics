# Stage-7 Provider-Neutral Staging Environment (NON-PRODUCTION)

**Purpose:** a repeatable, provider-neutral, **non-production** representative environment for Stage-7 **Tier-1**
automated execution (ADR-131) — internal automated security testing, and (in later increments) DR rehearsal,
load/chaos, and synthetic migration rehearsal. **It is not production, carries no real data or credentials, and its
readiness is not an independent (Tier-2) acceptance.**

Authority: ADR-131 (ACCEPTED) authorises Tier-1 automated execution in an **approved non-production/staging**
environment. This stack is that target. It does **not** transition any workstream and does **not** change
`CONDITIONAL_GO`.

## What it is (and deliberately is not)

- **Services:** exactly two — **PostgreSQL 16** and the **Node API** (`apps/api`). The application depends only on
  `pg` (no Redis, object storage, or message broker), so nothing else is provisioned.
- **Provider-neutral:** plain Docker Compose. **No AWS/Azure/GCP** or any production provider is named or required.
- **Fail-closed by architecture:** external connectors run through fail-closed framework-only ports
  (`ConnectorRuntimePort` etc.) — an unavailable runtime is durably BLOCKED, never a live call. Secrets are opaque
  `secretref:` only behind a fail-closed `SecretProviderPort` (M41 framework-only). No live M-Pesa/bank/ERP calls,
  no real secret material.
- **Synthetic only:** synthetic tenants + data; **no real customer PII**, **no production credentials**.

## Files

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | PG16 + API services; DB port bound to `127.0.0.1` only; non-root; healthchecks |
| `Dockerfile` | Multi-stage build of `apps/api` → non-root Node runtime |
| `env.staging.example` | All required env vars as **placeholders** (copy to `.env.staging`; never commit real values) |
| `bootstrap-synthetic.mjs` | Idempotent, staging-guarded seed: 2 synthetic tenants + 2 identities (1 privileged `platform_admin`, 1 unprivileged) |
| `validate-staging.mjs` | Deterministic readiness validation; exits non-zero on any critical failure |

## Run (in a Docker-enabled environment)

```
cp deploy/staging/env.staging.example deploy/staging/.env.staging   # then edit local-only values
docker compose -f deploy/staging/docker-compose.yml --env-file deploy/staging/.env.staging up -d --build
# migrations run on the api container start (npm run migrate); then:
node deploy/staging/bootstrap-synthetic.mjs      # DATABASE_URL points at the staging PG (owner/superuser for seeding)
node deploy/staging/validate-staging.mjs         # DATABASE_URL app-role reachable; optional API_BASE_URL for HTTP checks
```

## Security defaults (fail-closed)

- No hardcoded passwords in any committed file — `env.staging.example` holds placeholders only.
- The DB container publishes `5432` to **`127.0.0.1` only** (not `0.0.0.0`).
- The API container runs as a **non-root** user.
- No privileged containers; no host network.
- `NODE_ENV=staging` (not production); the app's production fail-closed CORS/secret guards remain intact.
- The **seed** connects with an elevated (owner/superuser) role; the **app** connects with the non-owner
  `finapp_app` role (`NOBYPASSRLS`) — RLS is exercised as in production.

## Two-tier reminder (ADR-131)

This environment enables **Tier-1** automated execution and evidence. **Tier-2 independent acceptance**
(environment readiness signed by Head of Risk & Compliance + Auditor; the independent external pentest; DR/ops
acceptance; Finance/Legal migration sign-off) and the **production GO** remain human/external and are **not**
satisfied here.
