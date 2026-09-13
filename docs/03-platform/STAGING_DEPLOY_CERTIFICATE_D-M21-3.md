# Staging Deployment Certificate — D-M21-3 (journal entity-reference validation)

> **STAGING ONLY — NOT PRODUCTION.** Certifies a staging deployment of the merged `main` build containing the
> D-M21-3 fix. It is **not** a production GO, not a Tier-2 acceptance, and does not alter M42 or the Stage-7
> external-assurance gates. Synthetic data only; no real customer PII; no production credentials.

## 1. Release identity

| Field | Value |
|---|---|
| Source `main` SHA (synchronized, `--ff-only`) | `223fd1c8b024e791cb86dc6e15440f023a53474a` |
| Contains | PR #190 — `fix(api/m21): validate journal entity references` + `docs(day1): close D-M21-3 robustness finding` |
| Deployed release / artifact identifier | `/opt/aptic-dynamics/DEPLOYED_SHA` = `223fd1c…`; Docker images `finapp-stage7-staging-api` (rebuilt) + `finapp-stage7-staging-web`; web bundle `/assets/index-CupKzR4o.js` |
| UTC deployment timestamp | `2026-09-13T13:01:27Z` (marker); stack rebuilt + verified immediately after |
| Previous release identifier (rollback target) | `59a894dc4248567611a8ac5baac622f7b7cbf890` (`deployed_at=2026-09-02T10:18:43Z`), preserved in `/opt/aptic-dynamics/DEPLOYED_SHA.prev` |
| Staging host / environment | `169.58.194.151`, path `/opt/aptic-dynamics`, `NODE_ENV=staging`; PostgreSQL 16 + Node API + web nginx (docker compose) |
| Deployed-SHA == synchronized-main-SHA | **YES** (`223fd1c` == `223fd1c`) |

> Note: staging already carried `223fd1c` from an earlier deployment this session; this run re-executed the
> documented deploy mechanism against a fresh SHA-verified clone and re-affirmed the running build. The last
> **distinct** prior release was `59a894dc`, which remains the meaningful rollback target.

## 2. Deployment method (authoritative runbook — no improvised commands)

Followed `docs/03-platform/STAGE_7_CONTABO_DEPLOYMENT_RUNBOOK.md` + `deploy/staging/README.md`:

1. Local `git checkout main && git pull --ff-only origin main` → `223fd1c`; clean worktree.
2. On host: `git clone --branch main --depth 1` to `/tmp`; **verified `git rev-parse HEAD == 223fd1c`** before proceeding.
3. `rsync -a --exclude='.git' --exclude='deploy/staging/.env.staging'` into `/opt/aptic-dynamics` (no `--delete`; `.env.staging`, `backups/`, `deploy.log`, and the `DEPLOYED_SHA.prev` rollback marker preserved).
4. Wrote `DEPLOYED_SHA` marker.
5. Documented deploy command: `docker compose -f deploy/staging/docker-compose.yml --env-file deploy/staging/.env.staging up -d --build` (api runs `npm run migrate` on start).
6. Documented preflight/readiness: `deploy/staging/validate-staging.mjs`.

No manual or unreviewed migration was applied. The D-M21-3 change adds **no migration** (repo = 84 migrations; the two fix commits touch none; ledger stays 84).

## 3. Preflight & migration status

| Check | Result |
|---|---|
| `validate-staging.mjs` — `postgres_is_16` | **PASS** (160015) |
| `migrations_applied` | **PASS** (84 applied) |
| `app_role_nonprivileged` (super=false, bypassrls=false → genuine RLS) | **PASS** |
| `force_rls_active` | **PASS** (506 FORCE-RLS tables) |
| `two_plus_tenants` | **PASS** (8 synthetic tenants) |
| `connectors_non_production` | **PASS** (0 connector env) |
| `no_production_secrets` | **PASS** (0 prod-secret env; 0 secret-value columns) |
| Migration status clean / no unreviewed migration | **PASS** (ledger 84 = repo 84; no partial markers) |
| Target is staging (not production) | **PASS** (`NODE_ENV=staging`) |
| SSH config validated before any reload | **PASS** (drop-in lockdown intact; sshd **not** reloaded — deploy only recreates Docker containers) |

## 4. Post-deployment verification

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | Deployed SHA == main SHA | `223fd1c` | **PASS** |
| 2 | API + web services active | up/healthy | **PASS** (api healthy; web up; db healthy — data preserved) |
| 3 | Health / readiness | `GET /api/v1/health` 200; validate PASS | **PASS** (200; `critical_failures=0`) |
| 4 | Staging web loads (normal URL — nginx `127.0.0.1:8080` via SSH tunnel) | 200 + app HTML | **PASS** (200; `<title>Aptic Dynamics — Staging</title>`; bundle `index-CupKzR4o.js`) |
| 5 | Unauthenticated protected API | 401 | **PASS** (`POST /journals/drafts` no-auth → 401) |
| 6 | **D-M21-3** — authenticated malformed `entityRef` | bounded **400** | **PASS** (`{"…/validation","status":400,"detail":"Invalid entityRef.","correlationId":…}`) |
| 7 | 400 exposes no SQL/PG/stack/query detail | RFC-problem shape only | **PASS** (type/title/status/detail/correlationId only) |
| 8 | Valid M21 journal-draft behavior intact (synthetic) | valid uuid → 201 | **PASS** (201, draft created) |
| 9 | RBAC denial fail-closed | persona lacking perm → 403 | **PASS** (`stg_security_auditor` → 403 `Missing required permission: journals.draft.create.`) |
| 10 | Logs: no new startup/runtime errors | clean | **PASS** (no `unhandled`/`22P02`/uuid-syntax/FATAL since redeploy — malformed 400s short-circuit before the DB) |
| 11 | SSH lockdown effective | root denied; password denied; pubkey only | **PASS** (`sshd_config.d/00-hardening.conf`; empirically pubkey-only, BatchMode succeeds with no password prompt; sshd not reloaded) |
| 12 | Only intended public listeners | only SSH `:22` public | **PASS** (`0.0.0.0:22`,`[::]:22`; app/db/web loopback; `:53` local resolver) |
| 13 | App/DB behind private bindings / proxy | loopback-only | **PASS** (api `127.0.0.1:3000`, db `127.0.0.1:5432`, web `127.0.0.1:8080`; staging reached via SSH tunnel; no public 80/443 for staging) |

**Authentication** for checks 6–9 used existing synthetic personas in tenant T1 (`ac1fd32d-0929-4729-9b50-b57ec5b5286b`):
`stg_treasury_maker` (holds `journals.draft.create`) and `stg_security_auditor` (does not). The demo password was
sourced server-side from `/home/deploy/.staging_demo_pw` and was never printed, logged, or passed on a command line.

## 5. Log review

API and web container logs since the redeploy contain **no new startup or runtime errors**. Notably, the malformed
`entityRef`/`periodRef` requests produced **no** `[unhandled]` / `22P02` / `invalid input syntax for type uuid`
entries — confirming the fix rejects malformed input at the request boundary before it reaches PostgreSQL
(pre-fix, these requests logged an unhandled `22P02`).

## 6. Rollback readiness

Rollback was **not executed** — all mandatory checks passed. Readiness is in place: the previous release
`59a894dc` is recorded in `DEPLOYED_SHA.prev`; the documented rollback is clone→checkout `59a894dc`→rsync→
`docker compose … up -d --build`. The `db` volume is unchanged, so an app-only rollback needs no data restore.

## 7. Remaining browser-incomplete / partial modules (unchanged by this deployment)

Per `FINAL_DAY1_BROWSER_ACCEPTANCE_REPORT.md` + `DAY1_ACCEPTANCE_CLOSURE_REPORT.md`:
browser-**ACCEPTED**: M02, M12, M13, M17 (maker). **PARTIALLY ACCEPTED**: M14, M16, M19 (maker proven;
checker/sub-steps pending), **M21** (maker path; D-M21-1/2/3 fixed — browser acceptance still incomplete, so M21
is **not** promoted to fully ACCEPTED). **Browser-incomplete / blocked**: M18, M20 (recon-account seeding),
M22 delegation grant (client anomaly; approval-decision SoD accepted). This deployment closes the D-M21-3
robustness gap only and changes none of these acceptance statuses.

## 8. Governance (unchanged)

- **STAGING ONLY — NOT PRODUCTION.** No production deployment, no production data, no DNS change, no production-infra change.
- **M42 remains `NO_GO`.** **Stage-7 G1–G4 remain unchanged.** No production certificate; no production-readiness claim.
- **TECHNICAL MODULE CONDITIONAL GO** unchanged. M21 remains PARTIALLY ACCEPTED.
- No RBAC/RLS/tenant-isolation/audit/SoD/accounting-control weakening; no schema/permission/audit-code/migration change.
