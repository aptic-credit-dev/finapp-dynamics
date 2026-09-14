# Production Infrastructure Readiness

> Evidence-backed audit of the intended production host/architecture for candidate
> `75660d8189c74e6bbe2063043d2fbae7924a5f2d`, without exposing any secret. Status legend: **PRESENT** (code/config
> in repo), **DEMONSTRATED** (proven on staging), **DESIGNED** (runbook/doc only), **NEEDS OPERATOR** (private
> action, not in repo). **No production environment, DB, secrets, DNS/TLS, or off-server backup exists yet.** Do not
> copy `.env.staging` to production; do not reuse any staging DB/keys/passwords/cookies/accounts.

## 0. UPDATE — In-place promotion decision + live hosting truth (MD, 2026-09-14)

The MD chose **in-place promotion** of the existing host `169.58.194.151` (staging → sole production); staging
ceases to exist after cutover. Full plan + read-only host audit + item classifications:
`INPLACE_STAGING_TO_PRODUCTION_PROMOTION_PLAN.md`. Production candidate now = main `6cfa426`.

| Hosting fact | Value | Basis / status |
|---|---|---|
| Registrar | HostAfrica Kenya | MD |
| DNS / proxy | Cloudflare (`dynamics.finappay.co.ke`) | MD; DNS already targets the origin (no DNS change at cutover — cache purge only) |
| Origin provider | **Contabo** | reverse DNS `vmi3515072.contaboserver.net` |
| **Physical DC region** | **OPEN — not proven** | host TZ `Europe/Berlin` **signals Germany/EU**; retrieve authoritative region from Contabo panel → Legal/Risk/CTO ruling before real data |
| Host spec | Ubuntu 24.04.4, **12 vCPU / 47 GiB RAM / 358 GB free** | read-only audit — ample for Day-1 |
| Live stack | api `127.0.0.1:3000` (healthy), web `:8080`, db `postgres:16.15` `127.0.0.1:5432`; only `:22` public | read-only audit |
| Deployed SHA on host | **`223fd1c`** (stale vs `6cfa426`) | MUST redeploy pinned candidate |
| Staging DB | `finapp_staging` 44 MB, **synthetic-only** (8 `stg_tenant_*`, emails `staging.local`/`synthetic.staging`) | → clean prod init, not G4 |
| Controls verified live | `finapp_app` super=false/bypassrls=false; **FORCE RLS 506/506**; `DATABASE_APP_ROLE` set | SAFE TO RETAIN |
| Must replace pre-cutover | `NODE_ENV=staging`→prod; `COOKIE_SECURE=false`→true; `ALLOWED_ORIGINS=localhost`→`https://dynamics.finappay.co.ke`; OpenBao unbound (`ADDR` empty); staging secrets rotated; 3 web files with "staging" banner | see promotion plan Phase 2/3 |

**Consequence recorded:** the production host **cannot be its own DR host** — G2 still needs a separate second host;
same-host backup/restore is not G2.

## A. Architecture, network, host

| Concern | Status | Evidence / action |
|---|---|---|
| Production hostname / DNS | DESIGNED / NEEDS OPERATOR | Commissioning Runbook Phase 6 ("Point production DNS; issue production TLS"). No DNS name committed; staging is IP-only. |
| TLS termination (443) | DESIGNED / NEEDS OPERATOR | Contabo runbook §1: HTTPS terminated at reverse proxy fronting 443; container publishes to loopback. Staging has **no** public 80/443. No cert config in repo. |
| Reverse proxy | PRESENT (staging, plaintext) | `deploy/staging/web-nginx.conf` serves SPA + same-origin `/api` proxy over HTTP:8080 — this is the SPA proxy, **not** a TLS terminator; prod needs a 443 terminator + HSTS. |
| Private bindings (api/web/db) | PRESENT + DEMONSTRATED | compose binds db `127.0.0.1:5432`, api `127.0.0.1:3000`, web `127.0.0.1:8080` (`deploy/staging/docker-compose.yml`); staging verified only `:22` public. |
| Firewall deny-by-default | DESIGNED + partly DEMONSTRATED | Contabo runbook §1 (ufw: allow SSH + 443 only). Staging shows only `:22` public. ufw ruleset is a host artefact — NEEDS OPERATOR on prod. |
| SSH pubkey-only lockdown | DEMONSTRATED (staging) | `sshd_config.d/00-hardening.conf`: root denied, password denied, pubkey only; re-proven in the D-M21-3 staging certificate. Replicate on prod host. |
| Non-root deploy + container user | PRESENT + DEMONSTRATED | API container runs `USER node` (`deploy/staging/Dockerfile`); deploy via non-root `deploy` OS user. |
| Separate prod host (not co-located) | DESIGNED / NEEDS OPERATOR | Contabo runbook §0/Phase 3: production host must be separate from staging. |

## B. Data layer

| Concern | Status | Evidence / action |
|---|---|---|
| Production PostgreSQL 16 | DESIGNED / NEEDS OPERATOR | Image `postgres:16`; staging validated `160015`. Prod = fresh PG16 DB/volumes, no staging/synthetic rows. |
| Non-superuser app role | PRESENT + DEMONSTRATED | App connects as superuser only to `SET LOCAL ROLE finapp_app` per transaction (`packages/kernel/src/pg-db.ts`); role `NOBYPASSRLS`, non-owner; staging PASS (super=false, bypassrls=false). Migrations run as superuser at container start. |
| FORCE RLS | PRESENT + DEMONSTRATED | 506 FORCE-RLS tables on staging; tenant GUC `app.tenant_id` set transaction-locally; system escape only via `withSystem`. |
| Persistent encrypted storage | NEEDS OPERATOR | At-rest/backup encryption is requirement R3 (`STAGE_7_OFFSERVER_BACKUP_DR_DECISION_PACKAGE.md`); not configured — default Docker volume. |
| Off-server backup destination | DESIGNED / NEEDS OPERATOR (**not configured**) | On-host `pg_dump` only (host script, ~24h RPO). Immutable Backblaze B2 (WORM/Object-Lock) is a purchase + write-only key; off-server push BLOCKED. |
| Retention / RPO / RTO | DESIGNED | RPO ≤5 min, RTO ≤15 min, availability ≥99.9% (OQ#13). Daily pg_dump alone ≈24h RPO → must add WAL archiving/standby (not built). |
| Tested restore | DEMONSTRATED (synthetic, Tier-1) | DR drill backs up → restores → reconciles; executor is fail-closed and **refuses production** (`NODE_ENV!=production`, 3-table whitelist). Not the production backup path. |

## C. Application security controls (env var names + code paths)

Production fail-closed gate: `apps/api/src/auth/config.ts` (`loadAuthConfig`), invoked at boot `apps/api/src/main.ts`.

| Control | Env var(s) | Status | Note |
|---|---|---|---|
| Cookie Secure | `FINAPP_COOKIE_SECURE` | PRESENT (fail-closed) | Prod forces `true`; boot throws if disabled. |
| Cookie SameSite | `FINAPP_COOKIE_SAMESITE` | PRESENT | Default `Lax`; `None` requires Secure. |
| Cookie HttpOnly | (hardcoded) | PRESENT | session + refresh HttpOnly; refresh path-scoped; `finapp_csrf` deliberately non-HttpOnly (double-submit). |
| CSRF | (double-submit) | PRESENT | Global middleware; state-changing + session-bearing requests must echo `x-csrf-token`; 403 on failure. |
| CORS / origin allowlist | `FINAPP_ALLOWED_ORIGINS` | PRESENT (fail-closed) | Prod refuses to boot if empty; credentialed, no wildcard. |
| Rate limiting | (constants) | **PARTIAL / GAP** | Only auth-attempt lockout/throttle (account 10/15min, IP 50/15min). **No generic HTTP rate limiter** — would rely on the (not-yet-configured) reverse proxy. |
| Security headers | — | **PARTIAL / GAP** | Staging nginx sets X-Frame-Options/X-Content-Type-Options/Referrer-Policy. **No HSTS, no CSP, no helmet** in the API — prod TLS proxy must add HSTS/CSP. |
| Secret injection | `FINAPP_OPENBAO_*` (7 vars) | DESIGNED / fail-closed default | All blank by default → M41 stays `UnavailableSecretProvider`. Prod binding = commissioning Phase 5 with a real OpenBao host (Gate 5). Zero secret-value columns invariant asserted by `validate-staging.mjs`. |
| Environment separation | `NODE_ENV` | PRESENT | Seeds/DR/migration tools refuse `NODE_ENV=production`; staging image pins `NODE_ENV=staging`. |
| Health / readiness | — | **PARTIAL / GAP** | Only liveness `GET /api/v1/health` (`stage:0`); **no DB-touching readiness probe** — orchestration/LB readiness gating not available out of the box. |

## D. Deploy / rollback mechanics (SHA-pinned)

Documented + demonstrated (D-M21-3 staging certificate):
1. Local `git checkout main && git pull --ff-only origin main` → target SHA; clean worktree.
2. Host `git clone --branch main --depth 1` to `/tmp`; **verify `git rev-parse HEAD == <SHA>`** before proceeding.
3. `rsync -a --exclude='.git' --exclude='deploy/staging/.env.staging'` into the deploy path (no `--delete`; preserves env/backups/marker).
4. Write `DEPLOYED_SHA` marker (previous kept as `DEPLOYED_SHA.prev`).
5. `docker compose … --env-file <prod env> up -d --build` — API runs `npm run migrate` at start (ordered, checksummed, idempotent, advisory-locked; `-- --dry-run` prints the plan).
6. Preflight `validate-staging.mjs` (production analogue).
**Rollback:** clone → checkout `DEPLOYED_SHA.prev` → rsync → `up -d --build`. App-only rollback is safe **only when the release adds no migration**; a schema-migrating release needs the pre-migration DB snapshot (Phase 11 requirement — not yet configured for prod).

## E. Demonstrated on staging vs requires operator's private production action

- **Demonstrated (staging, synthetic):** loopback bindings; SSH pubkey-only; non-root container; PG16 + `finapp_app` NOBYPASSRLS + 506 FORCE-RLS + zero secret-value columns; fail-closed cookie/CSRF/CORS/env guards; SHA-pinned deploy + idempotent migrations + liveness health + rollback marker; synthetic DR + migration rehearsal.
- **NEEDS OPERATOR (not present — do not assume):** production host (separate), DNS name, public TLS cert + 443 proxy with **HSTS/CSP**, ufw rules; fresh prod PG16 DB/volumes + at-rest encryption; **off-server immutable backup (B2) + WAL archiving/standby**; production OpenBao host + out-of-band secrets binding the M41 adapter; `NODE_ENV=production` + populated `FINAPP_ALLOWED_ORIGINS`/`FINAPP_COOKIE_SECURE`/`FINAPP_COOKIE_SAMESITE`/`FINAPP_BOOTSTRAP_ADMIN_ACCOUNT`; centralized monitoring/alerting; generic rate limiting at the proxy; a DB-readiness probe if orchestration requires one.

## F. Prohibitions (restated)

Do **not** copy `.env.staging` into production; do **not** reuse the staging database, keys, passwords, cookies,
encryption keys, or seeded accounts; do **not** create production users/credentials without the operator's private
action; never print or commit a production secret. RBAC/RLS/SoD/audit/encryption/backup/SSH/network controls must
not be weakened.
