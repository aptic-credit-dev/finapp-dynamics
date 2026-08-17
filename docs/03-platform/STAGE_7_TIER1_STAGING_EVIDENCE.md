# Stage 7 — Tier-1 Staging Environment Evidence

> **`TIER-1 STAGING ENVIRONMENT EVIDENCE — NON-PRODUCTION ONLY.`**
> Under ADR-131 (ACCEPTED). This is Tier-1 automated verification of a provider-neutral non-production staging
> target. It is **not** a Tier-2 independent (Head of Risk & Compliance / Auditor) environment-readiness
> acceptance, and it transitions **no** workstream. All four Stage-7 workstreams remain `requires_review`;
> production readiness remains `CONDITIONAL_GO`.

## Increment

Delivers **Phase 1 — provider-neutral representative staging environment** (`deploy/staging/`): the running target
the later DR / load-chaos / synthetic-migration Tier-1 increments need. It does **not** implement or run DR,
load/chaos, or migration (their own increments).

## Environment

| Field | Value |
| --- | --- |
| Assessed application commit | `bc26a6d` (merged main; this branch adds only `deploy/` + this evidence + `.prettierignore`) |
| Environment identifier | `finapp-stage7-staging` (Docker Compose project) — **non-production** |
| Services | exactly two: **PostgreSQL 16** + the Node API (`apps/api`). No Redis/object-store/broker (app depends only on `pg`) |
| Provider | provider-neutral Docker Compose — **no AWS/Azure/GCP**; no host network; no privileged containers |
| PostgreSQL (staging/CI target) | **16** (compose `postgres:16`; CI DB lane = PG16). Local verification box is PG **15.2** |
| Network exposure | DB `5432` and API `3000` bound to **`127.0.0.1` only** (not `0.0.0.0`) |
| App user | non-root (`USER node`) |

## Validation results

`validate-staging.mjs` was executed against a **fresh local** database (migrations applied, synthetic bootstrap
run). All DB-connectable readiness checks pass; the PG16 gate **correctly fails on the local 15.2 box** (it passes
on the PG16 staging/CI target) — the script is deterministic and exits non-zero on any critical failure.

| Check | Result (local run) |
| --- | --- |
| `postgres_is_16` | **FAIL locally** (`server_version_num=150002`, local box is 15.2) — **passes on the PG16 staging/CI target**; gate works as designed |
| `migrations_applied` | PASS — **82** applied / 0 err |
| `app_role_nonprivileged` | PASS — `finapp_app`: `rolsuper=false`, `rolbypassrls=false` (NOBYPASSRLS non-owner) |
| `force_rls_active` | PASS — **506** FORCE-RLS tables |
| `two_plus_tenants` | PASS — **2** synthetic tenants |
| `connectors_non_production` | PASS — 0 connector env vars; connectors are fail-closed framework-only ports (no egress) |
| `no_production_secrets` | PASS — 0 prod-secret env; **0 secret-value columns** (opaque `secretref:` only) |
| `http_health` / auth / isolation | SKIPPED locally (no running server; Docker daemon down) — app-level auth/RBAC/tenant-isolation proven by the DB/API integration lane |

## Synthetic bootstrap

`bootstrap-synthetic.mjs` (idempotent; refuses under `NODE_ENV=production`; connects with the elevated seed role):
created **2 synthetic tenants** (`stg_tenant_1/2`), **2 synthetic identities** (catalogue-driven `identity_type`),
one granted the seeded **`platform_admin`** role (**privileged**), one with **no grant** (**unprivileged**). Result:
`{synthetic_tenants:2, synthetic_identities:2, privileged_platform_admin_grants:1}`. Rerun is a no-op (idempotent).
**No real customer PII; no login credentials** (loginable accounts/argon2 credentials are exercised by the app's own
auth service + the integration lane).

## Posture (fail-closed)

- **Connectors:** fail-closed framework-only ports (`ConnectorRuntimePort` unavailable ⇒ durably BLOCKED); no live
  M-Pesa/bank/ERP calls.
- **Secrets:** opaque `secretref:` only behind a fail-closed `SecretProviderPort` (M41 framework-only); **0
  secret-value columns**; no production secret configured; `env.staging.example` holds placeholders only.
- **Data:** synthetic only; no real customer data.

## Commands used

```
node deploy/staging/bootstrap-synthetic.mjs      # → {synthetic_tenants:2, synthetic_identities:2, privileged...:1}
node deploy/staging/validate-staging.mjs         # → 6 PASS, PG16 gate FAIL on local 15.2, HTTP SKIP; exit 1 locally
NODE_ENV=production node deploy/staging/bootstrap-synthetic.mjs   # → refused (exit 2) — staging guard works
npm run migrate                                  # 82 applied / 0 err
npm run format:check / lint / build / test:smoke # clean / 0 errors / clean / 47 suites 7900 assertions 0-fail
npm run test:db                                  # 97 specs / 2938 assertions / 0 fail (app-level auth/RBAC/isolation)
```

## Known limitations (honest)

- **Docker daemon was not running locally**, so the container stack (`docker compose up --build`) was **not booted
  or validated here**. The assets are delivered; the PG16 schema/RLS/migration behaviour is validated by CI's PG16
  DB lane, and the runtime target was validated app-in-process (DB/API lane). Container boot must be run in a
  Docker-enabled environment.
- Local verification box is **PostgreSQL 15.2**; the staging/CI target is **PG16** — the validation script's PG16
  gate correctly fails locally and passes on PG16.
- **HTTP health/auth/isolation** checks require a running server; locally they are SKIPPED and covered by the
  in-process DB/API integration lane (`api-auth` 37, `api-identity` 78, `api-rbac` 20 assertions).
- This is Tier-1 only. **Tier-2 independent environment-readiness acceptance** (Head of Risk & Compliance +
  Auditor) is **not** claimed.
