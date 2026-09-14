# Production Environment Readiness Result (Day-1 Execution)

> Redacted PRESENT / MISSING / OPERATOR-REQUIRED result for the production environment, candidate
> `b26d4675fafc9b55b616f41319f191e9f6fb6269`. **No production host was provisioned and no application was started.**
> Legend: **PRESENT** = in-repo code/config or demonstrated on staging; **MISSING** = designed but not built;
> **OPERATOR REQUIRED** = a private operator action (purchase, secret, DNS, sign-off) that cannot be performed from
> the repo. No secret is printed; `.env.staging` was not copied; no DNS/production change was made.

| # | Item | Result | Note |
|---|---|---|---|
| 1 | Separate production host/environment | OPERATOR REQUIRED | Contabo prod host, separate from staging (runbook Phase 3). Not provisioned. |
| 2 | Kenya-DPA-acceptable hosting-region record | OPERATOR REQUIRED | Region ruling by Technology/Risk/Legal (OQ#16). Hard precondition before real data. |
| 3 | Production hostname | OPERATOR REQUIRED | No prod DNS name committed; staging is IP-only. |
| 4 | DNS cutover plan with reduced TTL | PRESENT (plan) / OPERATOR REQUIRED (execution) | Plan in cutover runbook; TTL reduction + cutover is an operator DNS action — not performed. |
| 5 | TLS certificate + renewal | OPERATOR REQUIRED | Public 443 cert + auto-renew at the reverse proxy; none in repo. |
| 6 | Reverse proxy | PARTIAL / OPERATOR REQUIRED | Staging nginx proxies SPA+`/api` over HTTP:8080 (plaintext); a prod 443 terminator with HSTS is required. |
| 7 | Firewall (deny-by-default) | OPERATOR REQUIRED | ufw allow SSH+443 only; host artefact, replicate on prod. |
| 8 | SSH key-only lockdown | PRESENT (staging pattern) / OPERATOR REQUIRED (prod host) | `sshd_config.d/00-hardening.conf` root+password denied, pubkey-only — replicate on prod. |
| 9 | Non-root deploy account | PRESENT | API container `USER node`; deploy via non-root `deploy` user. |
| 10 | API/web/DB loopback-private bindings | PRESENT + DEMONSTRATED | compose binds all three to `127.0.0.1`; staging verified only `:22` public. |
| 11 | PostgreSQL 16 | PRESENT (image) / OPERATOR REQUIRED (prod DB) | `postgres:16`; fresh prod DB/volumes needed. |
| 12 | Non-superuser application role | PRESENT + DEMONSTRATED | `finapp_app` NOBYPASSRLS via per-txn `SET LOCAL ROLE`; staging PASS. |
| 13 | FORCE RLS | PRESENT + DEMONSTRATED | 506 FORCE-RLS tables on staging. |
| 14 | Persistent encrypted storage | MISSING / OPERATOR REQUIRED | At-rest/backup encryption (R3) not configured; default volume. |
| 15 | Separate immutable backup destination | MISSING / OPERATOR REQUIRED | Off-server Backblaze B2 (WORM) + write-only key not purchased; on-host `pg_dump` only (~24h RPO). |
| 16 | Retention policy | PRESENT (design) / OPERATOR REQUIRED | On-host cron retention 7d designed; WORM retention needs B2. |
| 17 | Monitoring + alert routes | MISSING (authored plan) / OPERATOR REQUIRED | Plan authored (`PRODUCTION_MONITORING_ALERTING_PLAN.md`); nothing wired/firing. |
| 18 | Incident-response process | PRESENT (authored) | `PRODUCTION_INCIDENT_RESPONSE_RUNBOOK.md` authored (roles = blank appointees). |
| 19 | Log rotation | OPERATOR REQUIRED | Host/container log rotation to configure on prod. |
| 20 | Rate limiting | PARTIAL / OPERATOR REQUIRED | Only auth-attempt lockout in-app; no generic HTTP limiter — add at reverse proxy. |
| 21 | Secure cookies | PRESENT (fail-closed) | `FINAPP_COOKIE_SECURE` forced true in prod; HttpOnly; SameSite. |
| 22 | CORS/CSRF/origin config | PRESENT (fail-closed) | `FINAPP_ALLOWED_ORIGINS` (prod boot fails if empty; no wildcard); double-submit CSRF. |
| 23 | Production OpenBao | MISSING / OPERATOR REQUIRED | Adapter present + live-binding validated then torn down; dedicated prod host + out-of-band creds required. |
| 24 | Out-of-band secret custody | OPERATOR REQUIRED | Shamir 5/3 custody model designed; key ceremony is an operator action. |
| 25 | SHA-pinned release + rollback artifact | PRESENT + DEMONSTRATED | `DEPLOYED_SHA`/`.prev` marker pattern; rollback = checkout prev → up -d --build (app-only safe if no migration). |
| — | Security headers (HSTS/CSP) | MISSING | No HSTS/CSP/helmet in-app; must be added at the prod TLS proxy. |
| — | DB-readiness probe | MISSING | `/api/v1/health` is liveness-only (`stage:0`); add a DB-readiness probe for orchestration. |

**Summary:** PRESENT/demonstrated = app-security guards, non-root, loopback bindings, non-superuser role + FORCE RLS,
SHA-pin/rollback pattern, incident-response doc. MISSING (build) = encrypted storage, off-server immutable backup,
wired monitoring/alerting, HSTS/CSP, DB-readiness probe. OPERATOR REQUIRED = prod host, region ruling, DNS, TLS,
firewall, prod DB, OpenBao host + secret custody, log rotation, reverse-proxy rate limiting.

**Boundaries honoured:** no staging secrets/keys/cookies/DB/accounts reused; `.env.staging` not copied; no production
credentials printed; no DNS change; application not started; no real customer data used. M42 `NO_GO`; Stage-7 G1–G4
unchanged.
