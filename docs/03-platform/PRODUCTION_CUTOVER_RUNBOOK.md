# Production Cutover Runbook (PREPARED — DO NOT EXECUTE)

> SHA-pinned production cutover procedure for `75660d8189c74e6bbe2063043d2fbae7924a5f2d`. **Do not execute any step
> until (a) the mandatory gates are discharged/accepted, (b) an authorised human has recorded the M42 GO/
> CONDITIONAL_GO in `M42_PRODUCTION_DECISION_PACK.md`, and (c) Patrick explicitly instructs "APPROVED — EXECUTE
> PRODUCTION CUTOVER".** A production `EFFECTIVE/GO` certificate must NOT exist until deployment succeeds AND the
> authorised M42 GO is recorded. Never copy `.env.staging`; never reuse staging DB/keys/cookies/accounts; never print
> or commit a production secret.
>
> **IN-PLACE PROMOTION VARIANT (MD decision, 2026-09-14).** Production is an **in-place promotion** of the existing
> host `169.58.194.151` (staging → sole production), not a fresh separate host. For the in-place-specific
> preconditions (fresh secrets, clean DB init, staging-secret rotation, synthetic-data removal, `NODE_ENV`
> flip, staging-banner removal, Cloudflare cache purge, and the read-only host audit), follow
> `INPLACE_STAGING_TO_PRODUCTION_PROMOTION_PLAN.md` **Phase 3** as the authoritative pre-cutover control set; it
> supplements — does not replace — the gate/M42 preconditions below. Production candidate SHA is now main `6cfa426`.
> DNS already targets the origin via Cloudflare, so cutover needs **no DNS change** — cache purge only.

## Pre-conditions (all must hold before Step 1)
- M42 decision recorded (GO or CONDITIONAL_GO) by the authorised authority; residual conditions listed if B.
- Gates G1–G11 discharged/accepted per the gate register (or bounded-accepted where governance permits; never the
  four release blockers).
- Production infra ready per `PRODUCTION_INFRASTRUCTURE_READINESS.md`: separate host, DNS, TLS/HSTS, ufw, SSH
  lockdown, non-root deploy, fresh PG16, off-server encrypted backup, OpenBao bound, monitoring/alerts live.
- Named **incident commander** and **rollback authority**; maintenance window agreed and communicated.

## Steps
1. **Preflight.** Confirm `main` == `75660d8`; on prod host `git clone --branch main --depth 1` then verify
   `git rev-parse HEAD == 75660d8189c74e6bbe2063043d2fbae7924a5f2d`. Confirm `.env.production` present (operator-set;
   `NODE_ENV=production`, `FINAPP_ALLOWED_ORIGINS`, `FINAPP_COOKIE_SECURE=true`, `FINAPP_COOKIE_SAMESITE`,
   `FINAPP_BOOTSTRAP_ADMIN_ACCOUNT`, `FINAPP_OPENBAO_*`, `DATABASE_URL`/roles) — never printed.
2. **Backup.** Take a fresh pre-cutover snapshot (base backup + WAL) to the off-server immutable destination; verify
   with `pg_verifybackup`; record snapshot id. This is the rollback restore point.
3. **Migration dry-run + status.** `npm run migrate -- --dry-run` → review ordered checksummed plan; confirm the
   candidate adds **no** unreviewed migration (D-M21-3 adds none; ledger should stay at the reviewed count).
4. **Maintenance communication.** Announce the window to stakeholders; enable maintenance page if applicable.
5. **Deploy.** `rsync` the verified source into the prod deploy path (exclude `.git`, `.env.production`; no
   `--delete`); write `DEPLOYED_SHA=75660d8…` (keep previous as `DEPLOYED_SHA.prev`); `docker compose -f
   deploy/staging/docker-compose.yml --env-file <prod env> up -d --build` (migrations run on api start).
6. **Health / readiness.** `GET /api/v1/health` → 200; container healthchecks healthy; DB reachable via the
   non-superuser app role; FORCE RLS active; validate script (production analogue) PASS.
7. **Login.** Authenticate a real production admin (operator-provisioned; **no** staging/seed accounts) via the
   bootstrap admin; confirm session cookie is Secure/HttpOnly/SameSite and CSRF enforced.
8. **Module entitlement verification.** Confirm the Day-1 scope: enabled modules reachable to entitled/authorized
   users; **disabled modules return 403 and are hidden from nav**; 401 for no session; the 3 verticals fail closed on
   both entitlement (nav) and RBAC (API).
9. **Synthetic smoke transaction.** Exercise one enabled-module maker action end-to-end (e.g., a Cases create, or a
   Feedback resolution) using **real but disposable** production-safe test data owned by the operator — **never
   synthetic staging data**; confirm success + audit event.
10. **Audit evidence.** Confirm the audit hash-chain is intact for the smoke actions; capture correlation ids.
11. **Monitoring.** Confirm logs/metrics flowing and alerts armed (SLO burn, backup failure, replication lag, auth
    anomalies); fire a test alert.
12. **Rollback thresholds.** Predefine triggers: failed health/readiness; auth/RLS/SoD regression; error-rate/p95
    breach vs SLO; audit-chain break; backup/replication failure. Any trigger → rollback authority decides.
13. **Rollback commands (if triggered).** `git checkout <DEPLOYED_SHA.prev>` in a fresh clone → rsync → `up -d
    --build`. **If the release migrated schema**, first restore the Step-2 pre-cutover snapshot (app-only rollback is
    safe only when no migration was applied). Verify health after rollback; communicate.
14. **Post-cutover certificate.** Only after a successful deploy AND a recorded M42 GO: produce
    `PRODUCTION_DEPLOY_CERTIFICATE.md` with deployed SHA, release id, prev release, UTC timestamp, host, all
    verification results, monitoring status, rollback readiness, and the recorded M42 decision reference. **This
    certificate must not exist as EFFECTIVE/GO before both conditions hold.**

## Governance
This runbook is inert until authorised. It weakens no RBAC/RLS/SoD/audit/encryption/backup/SSH/network control. M42
remains `NO_GO` until the human decision is recorded; Stage-7 G1–G4 unchanged. Production deployment occurs only on
Patrick's explicit "APPROVED — EXECUTE PRODUCTION CUTOVER".
