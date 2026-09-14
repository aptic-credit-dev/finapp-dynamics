# In-Place Staging→Production Promotion Plan

> **PLAN ONLY — NOT A PRODUCTION GO / NOT A CUTOVER AUTHORIZATION.** Documents the controlled in-place promotion of
> the existing host `169.58.194.151` (currently Stage-7 staging) to the sole production environment, per the MD/CEO
> infrastructure decision (`PRODUCTION_MANAGEMENT_AUTHORIZATION_RECORD.md`). Production candidate =
> `6cfa426a46da51273674949367f4a02f1e8c15a6` (main; Day-1 evidence + isolation probe merged via PR #193).
> **No deployment, no DNS change, no `NODE_ENV` change, no secret rotation, no data removal has been performed.**
> M42 remains `NO_GO`; Stage-7 G1–G4 unchanged; no gate is marked PASS.
>
> The host audit below was collected **read-only** over the certified `deploy` SSH path (no mutation; env printed by
> **name only**; no secret value or credential hash printed). `deploy` has `sudo` but no non-interactive TTY, so
> root-owned artefacts (ufw, `ss`, compose/`.env` files, backups, TLS files) are marked **REQUIRES OPERATOR
> EVIDENCE** with the exact command to run.

## Governing consequence of choosing in-place promotion (must be read first)

1. **The production host is the former staging host — it therefore CANNOT be its own DR host.** A genuinely
   separate second host (different failure domain) remains mandatory for **G2**. Same-host backup/restore is **not**
   G2 and must never be represented as such.
2. **A separate staging environment ceases to exist after cutover.** There is then no non-production parity host
   for future change validation — a standing operational risk to record and own.
3. **Host hardware is reused, so the environment must be REBUILT, not copied:** fresh production-only secrets,
   clean production database initialization, rotation/revocation of every staging secret and session, and removal
   of all synthetic/demo data. The "no staging secret/data reuse" boundary is satisfied by *rebuild*, not by the
   hardware being new.

---

## PHASE 1 — Hosting truth (recorded separately; residency NOT inferred)

| Fact | Value | Evidence / basis | Status |
|---|---|---|---|
| Domain registrar | **HostAfrica Kenya** | MD decision | Recorded |
| DNS / proxy | **Cloudflare** (proxies `dynamics.finappay.co.ke`) | MD decision | Recorded |
| Origin / server provider | **Contabo** | reverse DNS `169.58.194.151 → vmi3515072.contaboserver.net` (provider signal) | Recorded |
| **Region** | **EU REGION CONFIRMED** — exact country/datacenter NOT displayed | Contabo panel (operator evidence): instance `vmi3515072`, IP `169.58.194.151`, product `Cloud VPS 12`, status `Running`, **Region = EU** (corroborates host TZ `Europe/Berlin`) | **EU CONFIRMED; cross-border LEGAL/RISK ruling PENDING** |
| **Kenya hosting / data residency** | **NO — origin is outside Kenya (EU)** | EU-region confirmed | **Cross-border transfer assessment REQUIRED** |
| Backup-storage region (B2) | not set | Backblaze B2 approved; region unchosen | OPEN |
| Proposed 2nd DR-host region | not named | G2 host outstanding | OPEN |
| OpenBao-host region | not named | G5 host outstanding | OPEN |

**Kenya-DPA hosting-region ruling: EU REGION CONFIRMED — EXACT COUNTRY/DATACENTER NOT DISPLAYED — CROSS-BORDER
LEGAL/RISK RULING PENDING.** Authoritative Contabo panel evidence confirms **Region = EU** (instance `vmi3515072`,
`Cloud VPS 12`, Running), corroborating the `Europe/Berlin` timezone. The origin is therefore **outside Kenya**, so
hosting Kenyan personal/financial data is a **cross-border transfer** under the Kenya Data Protection Act. **EU
hosting is NOT automatically compliant.** The exact country/datacenter is not shown in the panel and does not by
itself settle lawful basis or safeguards. A formal ruling by Legal (Reuben Mwangi) + Head of Risk (Njeri Muchina) +
CTO (Kelvin Maina) is **required before any real data** — see `PRODUCTION_HOSTING_REGION_RULING_RECORD.md` (12
required confirmations; APPROVED-WITH-CONDITIONS wording; sign-offs blank). This ruling is **not** an M42 GO.

Evidence classification: provider EU-region confirmation **PASS**; exact country/datacenter **NOT SHOWN**; Kenya
hosting/residency **NO (outside Kenya)**; cross-border assessment **REQUIRED**; Legal approval **PENDING**; Risk
approval **PENDING**; production authorization **NOT GRANTED**; **M42 NO_GO**.

---

## PHASE 2 — In-place promotion audit (evidence-based; read-only)

Host: Ubuntu 24.04.4 LTS (kernel 6.8.0-139), **12 vCPU, 47 GiB RAM (≈45 GiB free), 387 GB disk (8% used,
≈358 GB free)**. Compose project `finapp-stage7-staging`, working dir `/opt/aptic-dynamics/deploy/staging`.

| # | Item | Observed (read-only) | Classification |
|---|---|---|---|
| 1 | Services / containers | `…-api-1` (127.0.0.1:3000, healthy), `…-web-1` (127.0.0.1:8080), `…-db-1` `postgres:16.15` (127.0.0.1:5432, healthy) | Engine/topology **SAFE TO RETAIN**; project name **MUST REPLACE** (drop `staging`) |
| 2 | Deployed SHA | **`223fd1c…`** (deployed 2026-09-13) — **stale** vs prod candidate `6cfa426` | **MUST REPLACE** (redeploy SHA-pinned candidate) |
| 3 | DB version / ledger | PostgreSQL **16.15**; `schema_migrations = 84` (matches repo) | **SAFE TO RETAIN** (engine); ledger re-applied clean on prod DB |
| 4 | DB size / data | `finapp_staging` **44 MB**; tenants **8** (all `stg_tenant_1..8` [bank/active]); identities **1410** (1356 service, 52 internal_person, 2 contractor); user_accounts **54**; roles **54**; role_assignments **52**; audit_events **2377** | **MUST REMOVE** (synthetic; clean prod init — see Phase 5) |
| 5 | Synthetic/demo users & data | email domains only `staging.local`, `synthetic.staging`, and blank (service identities) — **no real domains** | **MUST REMOVE**; record deletion evidence |
| 6 | Env variables (names only) | `DATABASE_URL, DATABASE_APP_ROLE, DATABASE_OWNER_ROLE, DATABASE_POOL_MAX, API_PORT, NODE_ENV, FINAPP_ALLOWED_ORIGINS, FINAPP_COOKIE_SECURE, FINAPP_COOKIE_SAMESITE, FINAPP_OPENBAO_ADDR, FINAPP_OPENBAO_AUTH_METHOD, FINAPP_OPENBAO_CA_CERT_PEM, FINAPP_OPENBAO_ROLE_ID, FINAPP_OPENBAO_SECRET_ID, FINAPP_OPENBAO_TIMEOUT_MS, FINAPP_OPENBAO_TRANSIT_KEY_PREFIX, FINAPP_OPENBAO_TRANSIT_MOUNT` | see rows 7–9 |
| 7 | `NODE_ENV` | **`staging`** | **MUST REPLACE** → `production` |
| 8 | Cookie / CORS | `FINAPP_COOKIE_SECURE=false`, `FINAPP_COOKIE_SAMESITE=Lax`, `FINAPP_ALLOWED_ORIGINS=http://localhost:3000` | **MUST REPLACE** → Secure=`true`, origins=`https://dynamics.finappay.co.ke` |
| 9 | Secrets (staging) | `DATABASE_URL`, DB password, OpenBao `ROLE_ID`/`SECRET_ID`/`CA_CERT_PEM` (values **not** printed) | **MUST REPLACE** (new prod-only) + **rotate/revoke** staging |
| 10 | OpenBao binding | `FINAPP_OPENBAO_ADDR=` **empty** → **no vault bound**; M41 = fail-closed `UnavailableSecretProvider` | **REQUIRES OPERATOR** (dedicated prod OpenBao, G5) |
| 11 | App DB role | `finapp_app` **super=false, bypassrls=false**; owner `finapp_owner` | **SAFE TO RETAIN** (correct least-privilege) |
| 12 | FORCE RLS | **506 tables** RLS-enabled **and** forced (506/506) | **SAFE TO RETAIN** (control intact) |
| 13 | TLS / origin cert | no public 443 (see row 15); prod 443 terminator + cert not present | **REQUIRES OPERATOR** |
| 14 | Reverse proxy | web container 127.0.0.1:8080 (plaintext); no prod 443/HSTS terminator | **MUST REPLACE / OPERATOR** |
| 15 | Public listeners | external probe: **only `:22` open**; `80/443/3000/5432/8080` filtered → Cloudflare cannot currently reach an origin 443 | **REQUIRES OPERATOR** (prod 443 origin path) |
| 16 | Staging banners/labels | web build: **3 files** reference "staging"; compose project name carries `staging` | **MUST REMOVE / REPLACE** |
| 17 | Volumes | anonymous docker volumes present (data + pg) | **MUST REMOVE** (synthetic pg volume) / retain engine |
| 18 | Backups | root-owned; not readable read-only | **REQUIRES OPERATOR EVIDENCE**: `sudo ls -lt <backups>`; confirm last good backup |
| 19 | Firewall (ufw) | root-owned; external probe consistent with SSH-only exposure | **REQUIRES OPERATOR EVIDENCE**: `sudo ufw status numbered` |
| 20 | Listeners (host) | `ss` needs sudo | **REQUIRES OPERATOR EVIDENCE**: `sudo ss -tlnp` |
| 21 | Logs / monitoring | container stdout only; no wired monitoring/alerting | **REQUIRES OPERATOR** (G7) |
| 22 | Capacity | 12 vCPU / 47 GiB / 358 GB free, 8% disk | **SAFE TO RETAIN** — ample for Day-1 |
| 23 | Rollback artifacts | in-container SHA marker present (`223fd1c`, `deployed_at`); on-disk `DEPLOYED_SHA(.prev)` root-owned | Pattern **SAFE**; pre-cutover bundle **MUST CREATE** (Phase 3) |
| 24 | Staging hostname deps / callbacks | app origins point at `localhost:3000`; no external callback host observed in env names | **MUST REPLACE** (prod origins) |

---

## PHASE 3 — Mandatory in-place cutover controls (SHA-pinned; pre-cutover gate)

SHA-pinned to `6cfa426`. **Every item below is a precondition; none is executed by this plan.** Ordered so that a
recoverable backup exists **before** anything destructive.

1. **Full encrypted DB backup** of `finapp_staging` (even though discarded) — `pg_dump` + client-side encryption.
2. **Off-server upload** to **immutable Backblaze B2** (write-only key, WORM/object-lock).
3. **Verified restore onto a DIFFERENT host** (proves the backup + doubles as the start of G2 topology).
4. **VPS/provider snapshot** (Contabo panel snapshot) where supported.
5. **Record current deployed SHA + container image digests** (`223fd1c`; `docker image inspect --format '{{.Id}}'`).
6. **Separate rollback bundle** (compose + image digests + pre-cutover encrypted DB dump) stored off-host.
7. **Production OpenBao available** (dedicated host, G5) — bound and health-checked; M41 fail-closed until then.
8. **New production-only secrets generated privately** (DB password, OpenBao AppRole, cookie/session keys) — entered
   out-of-band by the operator; **Claude generates none**.
9. **Rotate/revoke all staging secrets + sessions** (old DB creds, OpenBao AppRole, any issued cookies/JWT keys).
10. **Remove all demo/synthetic login credentials** (the 54 staging accounts) — none carried into production.
11. **Explicit decision on synthetic/demo business data** — default: **discard** (clean init, Phase 5).
12. **`NODE_ENV=production`.**
13. **App/DB role = non-superuser `finapp_app`** (already true; re-verify post-rebuild).
14. **FORCE RLS active** (506/506 today; re-verify post-init).
15. **Production cookie/CORS/CSRF/origin config** — Secure cookies; `FINAPP_ALLOWED_ORIGINS=https://dynamics.finappay.co.ke`; double-submit CSRF.
16. **Production hostname `dynamics.finappay.co.ke`** wired at the 443 terminator.
17. **Remove staging banner + staging-only connectors** (the 3 web files; project rename).
18. **External integrations remain disabled** unless separately approved.
19. **Day-1 RBAC roles carry only approved-module permissions** (Phase 4 preflight).
20. **Disabled modules remain nav-hidden + API-403** (Phase 4 preflight).
21. **Monitoring + alert routes operational** (G7).
22. **Incident commander (Cynthia Njambi) + rollback authority (Dolly Kawira) available** during cutover.
23. **Maintenance notice + user communication approved** (templates in `PRODUCTION_DAY1_OPERATIONS.md`).

---

## PHASE 4 — Day-1 production scope + machine-verifiable preflight

**Enabled:** M02, M03 (auditors), M12, M13, M17 (tested maker), M22 (approval-decision), M39 (admin), M41 Secrets
(read-only). **Disabled by permission + entitlement:** M08, M09, M14, M16, M18, M19, M20, M21, M28, M32, M22
delegation, M41 GRC/Privacy/Compliance vertical, all unaccepted sub-flows, all unapproved external connectors.

**Machine-verifiable preflight = the merged isolation probe** `apps/api/test/day1-isolation-probe.db-spec.ts`
(on main via PR #193; **11/11 assertions pass** under the non-superuser `finapp_app` role). It proves every Phase-4
requirement and must be re-run green against the production stack at cutover:

| Required proof | Automated check (probe assertion) |
|---|---|
| Enabled module APIs reachable by authorized roles | `cases.case.read` → `GET /cases` → 200; `journals.draft.read` positive control → 200 |
| Disabled navigation absent | nav fail-closed (`app.tsx` group filter) + API-403 corollary below |
| Disabled API calls → 403 | `GET /journals/drafts`, `/litigation/.../filings`, `/analytics/datasets` → 403 |
| No platform-admin implicit bypass | `x-permissions` + forged `x-actor-id` grant nothing → 403 (authority is a DB fact) |
| Vertical entitlements withheld | `GET /saas/entitlements/check?debt_recovery` → `entitled:false` |
| Tenant isolation | actor A + `x-tenant-id:B` refused (≥400), no cross-tenant rows |
| Unauthenticated → 401 | anonymous `GET /journals/drafts` → 401 |

At cutover the operator runs, against the production DB (non-superuser role):
`DATABASE_APP_ROLE=finapp_app DATABASE_URL=<prod> npm run test:db` — the probe must report **0 failed**, plus a
production role-grant audit confirming Day-1 roles hold only approved-module permissions.

---

## PHASE 5 — Promotion data plan (staging data classification)

**Determination (read-only evidence): the staging DB contains ONLY synthetic data.** All 8 tenants are
`stg_tenant_1..8`; all email domains are `staging.local` / `synthetic.staging`; 1356/1410 identities are service
identities. **No real or mixed data detected.** → **Clean-production initialization path (NOT G4):**

- **Do not promote the synthetic DB.** Initialize a fresh production database (empty; 84 migrations applied clean).
- **Do not copy** synthetic credentials or sessions into production.
- **Retain only approved reference/configuration data** (global reference registries / permission catalogue seeded
  by migrations — no tenant business rows).
- **Create the production tenant + first administrator via a private operator procedure** (bootstrap admin). **Claude
  creates no password**; the operator sets it out-of-band.
- **Record deletion evidence** for the discarded synthetic DB (pre-removal encrypted dump ref + row-count snapshot +
  drop confirmation).

**If a later re-inspection finds any real or mixed data: STOP.** Inventory without exposing PII; require Legal/DPO +
CFO + business-owner authorization; route through the **G4** migration/control-total process. Do not silently
promote a database of unknown provenance.

---

## PHASE 6 — Availability & rollback (in-place)

- **Staging becomes unavailable after cutover** — this host is the only environment afterward; there is no parallel
  staging to fall back to for testing.
- **Expected maintenance window:** ~**60–120 min** (rebuild env + clean DB init + deploy pinned `6cfa426` + preflight
  + smoke), plus a **30-min stabilization** watch. Confirmed by the operator against the cutover runbook.
- **Rollback decision deadline:** a fixed T+`<n>` min checkpoint (recommend T+90 min) at which the rollback authority
  (Dolly Kawira) decides go/hold/rollback.
- **Automatic rollback triggers:** health not 200 after deploy; preflight probe any-fail; auth/login broken; audit
  hash-chain break; SLO breach beyond agreed bounds; data-integrity check fail.
- **Rollback restores** the previous **application SHA `223fd1c`** (image digest bundle) and the **pre-cutover DB
  snapshot** — from the Phase-3 bundle, on this host or the restore host.
- **DNS:** Cloudflare already targets the origin; **no DNS change is required for cutover** — only a **Cloudflare cache
  purge** (and confirm proxy/SSL mode) once the origin 443 path is live. Rollback needs no DNS change either.
- **Prohibition:** **no rollback may discard committed production transactions** without an approved reconciliation
  procedure. Once real production writes exist, "roll back the database" requires CFO/Legal-approved reconciliation,
  not a blind snapshot restore.

---

## PHASE 7 — Remaining non-waivable gates (this decision closes NONE of them)

- **G1 independent pentest** — still required (external provider, retest, Auditor).
- **G2 cross-host DR** — still required; **the existing host cannot be its own DR host**; a genuinely separate second
  host (different failure domain) + off-server immutable restore is mandatory. **Same-server backup/restore is NOT G2.**
- **G4 real-data migration** — **N/A for Day-1 clean init** (synthetic-only staging discarded), but any real first
  tenant still requires the **G4** process (CFO + Legal sign-off) or a **formal recorded N/A** decision by CFO/Legal.
- **G5 dedicated production OpenBao** — still required; OpenBao topology must follow the governance requirement
  (dedicated host, out-of-band custody). Co-locating OpenBao on the app host does **not** satisfy G5.
- **M42 human decision** — production cannot be labelled GO until the gates are accepted and the MD issues
  *"APPROVED — EXECUTE PRODUCTION CUTOVER."*

## Governance

Plan only. No deployment; no DNS change; no `NODE_ENV` change; no secret rotation; no data removal. Host audit was
strictly read-only; no secret value or credential hash was printed. **M42 `NO_GO`; Stage-7 G1–G4 unchanged; no gate
marked PASS.**
