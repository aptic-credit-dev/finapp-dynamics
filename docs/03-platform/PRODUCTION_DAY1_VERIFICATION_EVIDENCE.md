# Production Day-1 Technical Verification Evidence

> Executed technical-verification battery for the frozen production candidate
> `b26d4675fafc9b55b616f41319f191e9f6fb6269` (PR #192 merged; `origin/main` == this SHA — no later code commit).
> All lanes below were run locally on this candidate. **No production host was provisioned, no application was
> started against production, no real data was used.** M42 remains `NO_GO`; Stage-7 G1–G4 unchanged.
>
> DB lanes ran against a throwaway PostgreSQL cluster with the application connecting under the **non-superuser
> `finapp_app` role** (`SET LOCAL ROLE finapp_app`, `NOBYPASSRLS`) — exactly the production posture.

## 1. Battery results (exact counts)

| # | Lane | Command | Result | Detail |
|---|---|---|---|---|
| 1 | Dependency integrity | `npm ls --workspaces --depth=0` | **PASS** | workspace dependency tree resolves; exit 0 |
| 2 | Formatting | `prettier --check .` | **PASS** | all files conform (1 new file formatted before check) |
| 3 | Lint | `eslint .` | **PASS (0 errors)** | 0 errors, 68 warnings — all pre-existing `no-unnecessary-condition` advisories (warn-level, not introduced here) |
| 4 | Backend typecheck / build | `tsc --build` | **PASS** | exit 0 (includes the new `.db-spec.ts` under `apps/api/tsconfig.json`) |
| 5 | Web typecheck | `tsc --noEmit -p apps/web/tsconfig.json` | **PASS** | exit 0 |
| 6 | Production build | `tsc --build` | **PASS** | exit 0 |
| 7 | Vite build | `vite build` (web) | **PASS** | 32 modules; `index.js` 564.95 kB (gzip 134.87 kB); chunk-size advisory only |
| 8 | Smoke (PURE) | `npm run test:smoke` | **PASS** | **51 suites, 8082 assertions, 0 failed** |
| 9 | Migration apply | `npm run migrate` | **PASS** | **84 applied, 0 errors** |
| 10 | Migration-status (idempotency) | `npm run migrate` (re-run) | **PASS** | **0 applied, 84 already up to date** |
| 11 | Full DB integration (non-superuser role, fresh DB) | `DATABASE_APP_ROLE=finapp_app npm run test:db` | **PASS** | **99 specs, 3114 assertions, 0 failed** |
| 12 | Day-1 entitlement/isolation suite | `day1-isolation.db-spec.ts` (in lane 11) | **PASS** | **11 assertions, 0 failed** (see §2) |
| 13 | RBAC / RLS / SoD | `rls-convention` + all module specs (in lane 11) | **PASS** | `rls-convention` 26 assertions; maker-checker proven in feedback/recovery/journals specs |
| 14 | Audit-chain integrity | m03 audit + module specs (in lanes 8/11) | **PASS** | audit-hash-chain specs green in both lanes |
| 15 | Security / secret scan | web-asset scan (`api-releases-webscan` smoke) + working-tree grep | **PASS** | no keys/tokens/credential values; only `.env.example` template tracked; doc matches are env-var *names*, not values |
| 16 | TLS / security headers | — | **N/A — OPERATOR REQUIRED** | no production 443 terminator yet; must be added at the prod reverse proxy (readiness item 6/36) |
| 17 | Monitoring test | — | **N/A — OPERATOR REQUIRED** | no monitoring wired; plan authored (`PRODUCTION_MONITORING_ALERTING_PLAN.md`) |
| 18 | Backup / restore (authorized scope) | single-host tooling (prior staging evidence) | **PARTIAL** | single-host `pg_basebackup`+`pg_verifybackup` validated on staging; off-server immutable (B2) **BLOCKED** — not purchased |

**Net:** every internally-executable lane is green. Lanes 16–18 are gated on operator provisioning (prod host, monitoring
wiring, Backblaze B2), not on missing engineering.

## 2. Day-1 isolation probe — what was proven (lane 12)

Spec: `apps/api/test/day1-isolation-probe.db-spec.ts`. Boots the real `AppModule`, drives HTTP as real
logged-in actors, and runs against the **non-superuser `finapp_app` role**. All 11 assertions passed:

1. **No session → 401** — `GET /journals/drafts` anonymous → 401 (authority requires a real session).
2. **Enabled module reachable** — an actor whose only grant is `cases.case.read` → `GET /cases` → **200**.
3. **Disabled modules 403 (no accidental inheritance)** — that same enabled-scope actor:
   - `GET /journals/drafts` (M21) → **403**
   - `GET /litigation/proceedings/{id}/filings` (M16) → **403**
   - `GET /analytics/datasets` (M32) → **403**
4. **No implicit bypass — authority is a database fact** — the same actor re-sending
   `x-permissions: journals.draft.read journals.draft.create` **and** a forged `x-actor-id` still gets **403**.
   Client-supplied headers grant nothing; `can()` is default-deny and keys only off persisted grants.
5. **Positive control** — a *different* actor granted `journals.draft.read` reaches the identical route
   `GET /journals/drafts` → **200**, proving the 403s above are the missing grant, not a broken route.
   (Corollary: the seeded `platform_admin` role holds *every* permission by explicit grant — not a bypass — so
   Day-1 isolation is achieved by **withholding** disabled-module grants, i.e. not assigning that super-role.)
6. **Vertical entitlement OFF by default** — a fresh tenant with no subscription:
   `GET /saas/entitlements/check?capabilityKey=debt_recovery` → `entitled:false`. (Confirms the entitlement
   engine's default-deny; `evaluateAccess` is never wired to a controller, so verticals need BOTH the
   entitlement withheld *and* their RBAC withheld — as the scope matrix already states.)
7. **Tenant isolation at the API** — an actor scoped to tenant A that re-sends `x-tenant-id: B` is **refused**
   (status ≥ 400) and **no cross-tenant rows** are ever returned.

**Conclusion: Day-1 module isolation is enforced by the existing RBAC + entitlement + tenant controls, with no
code change and no new feature flag. Isolation is NOT a launch blocker.**

## 3. Verification note — RLS engages exactly under the non-superuser role (negative control)

A first DB-lane run was performed with `DATABASE_URL` set but **`DATABASE_APP_ROLE` unset**. In that run the
booted API connected as the superuser `postgres` and, per `apps/api/src/platform.module.ts:62-65`, constructed
`PgDb` **without** an app role — so it never issued `SET LOCAL ROLE finapp_app`. Cross-tenant reads then
succeeded (superusers bypass RLS by definition). Re-running with `DATABASE_APP_ROLE=finapp_app` — the production
configuration — made every cross-tenant assertion pass.

This is **not a defect**; it is a clean negative control. It demonstrates that (a) tenant isolation depends on the
application running under the intended non-superuser role, which production does, and (b) the platform module
correctly refuses to assume a role unless one is configured. **Production/operational control:** the production
app must run with `DATABASE_APP_ROLE=finapp_app` and must never connect as a superuser or `BYPASSRLS` role — this
belongs on the environment-readiness checklist and is verified by the DB-readiness of the non-superuser role.

## 4. Environment note

Executed on PostgreSQL 15.2 binaries locally for the DB lane (fresh throwaway cluster, `-E UTF8 --locale=C`,
non-superuser `finapp_app` app role). Production targets **PostgreSQL 16** on a dedicated host (readiness item 11,
`OPERATOR REQUIRED`). The schema, RLS policies, and role model are version-portable and were exercised identically;
the acceptance-grade re-measurement on the dedicated production host (gate G3) remains a Stage-7 requirement.

## Governance

Planning/verification only. No production deployment; no real data; M42 `NO_GO`; Stage-7 G1–G4 unchanged.
