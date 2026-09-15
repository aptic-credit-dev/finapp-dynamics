# Production Gate Execution Report

> Execution report for the Production-Exit gate programme on frozen candidate
> `dad369e1be68304dbf6c54c1abd0b3796b1df0de` (PR #197 merged; clean worktree; D-M21-3 fixed; M42 `NO_GO`; 0/12 gates
> PASS at start). This task performed every action executable **safely now** and assembled the outstanding
> human/external evidence. **No production deployment; no DNS change; no real data.** No gate is marked PASS from
> internal Tier-1 evidence alone.

## 1. Technical validation battery (executed on `dad369e`)

Product code is identical to the last green battery (intervening PRs #193–#197 are docs-only; the only non-doc diff
is the isolation-probe test itself). Re-run for current-SHA evidence:

| Lane | Command | Result |
|---|---|---|
| Dependency integrity | `npm ls --workspaces --depth=0` | **PASS** (exit 0) |
| Formatting | `prettier --check docs/03-platform/*.md` | **PASS** |
| Lint | `eslint .` | **PASS — 0 errors** (68 pre-existing warn advisories) |
| Backend typecheck/build | `tsc --build` | **PASS** (exit 0) |
| Web typecheck + Vite build | `tsc --noEmit` + `vite build` | **PASS** (exit 0) |
| Smoke (PURE) | `npm run test:smoke` | **PASS — 51 suites, 8082 assertions, 0 failed** |
| Migration apply | `npm run migrate` | **PASS — 84 applied** |
| Migration idempotent re-run | `npm run migrate` | **PASS — 0 applied, 84 up to date** |
| Full DB integration (non-superuser `finapp_app`, fresh DB) | `DATABASE_APP_ROLE=finapp_app npm run test:db` | **PASS — 99 specs, 3114 assertions, 0 failed** |
| Day-1 module isolation probe | `day1-isolation.db-spec.ts` (in DB lane) | **PASS — 11 assertions, 0 failed** |
| RBAC / entitlement negative + auth fail-closed | isolation probe + module specs (in DB lane) | **PASS** (401 anon; 403 unheld; entitled:false) |
| Tenant / RLS isolation | `rls-convention` (26) + cross-tenant assertions across specs | **PASS** |
| Audit-chain validation | m03 audit + module specs (smoke + DB lanes) | **PASS** |
| Secret / sensitive-data scan | tracked-file scan | **PASS — clean** (only `.env.example` tracked) |
| Backup/restore (G2 resources) | — | **NOT EXECUTED** — no 2nd host / B2 |
| OpenBao live tests (G5 resources) | — | **NOT EXECUTED** — no dedicated host (m41-openbao smoke 21 passed; live binding needs host) |

**"Not executed" is never reported as PASS.** The two blank lanes are blocked on operator-supplied infrastructure.

## 2. Workstream status (evidence classification)

| Workstream | Completed evidence | Human pending | External pending | Technical PASS | Independent acceptance | Formal gate status |
|---|---|---|---|---|---|---|
| **G1 pentest** | activation record + declarations authored; 0/13 conditions met | provider + auditor signatures; Muchina/Maina approvals | Alex Maunda engagement; external report + retest | n/a (Tier-1 SAST/DAST prior) | Auditor (Nganga) — pending | **BLOCKED** (`G1_PENTEST_EXECUTION_EVIDENCE.md`) |
| **EU hosting ruling** | public evidence pack; opaque-artefact register | 3 reviewer decisions | Contabo DPA/TOMs/subprocessors/certs | n/a | Mwangi/Muchina/Maina — pending | **REQUIRES_REVIEW** (`EU_HOSTING_FINAL_RULING_EVIDENCE.md`) |
| **G2/G8 DR** | Tier-1 single-host tooling only | — | 2nd host + B2 + creds | n/a | COO/Ops — pending | **BLOCKED** (`CROSS_HOST_DR_EXECUTION_EVIDENCE.md`) |
| **G5 OpenBao** | adapter + prior live-binding (torn down); fail-closed default | custodians | dedicated host + URL/CA/AppRole | fail-closed verified | via M42 GO | **BLOCKED** (`PRODUCTION_OPENBAO_BINDING_EVIDENCE.md`) |
| **G4 migration** | clean-init plan; synthetic-only audit; proposed N/A | CFO+Legal+business+Risk approval | — (no real data) | clean-init controls green | pending | **REQUIRES_REVIEW** (`G4_MIGRATION_OR_NA_DETERMINATION.md`) |
| **Cutover config (Phase D)** | preflight checklist prepared (not activated) | — | prod host/OpenBao/TLS | isolation preflight green (synthetic) | — | **PREPARED — NOT ACTIVATED** |

## 3. What changed in this task

Authored: `G1_PENTEST_EXECUTION_EVIDENCE.md`, `EU_HOSTING_FINAL_RULING_EVIDENCE.md`,
`CROSS_HOST_DR_EXECUTION_EVIDENCE.md`, `PRODUCTION_OPENBAO_BINDING_EVIDENCE.md`,
`G4_MIGRATION_OR_NA_DETERMINATION.md`, `PRODUCTION_CUTOVER_PREFLIGHT_CHECKLIST.md`, this report, and the updated
`M42_FINAL_DECISION_PACK.md`. Ran the full technical battery (all green). **No code changed; no infra changed; no
deployment; no DNS; no real data; M42 `NO_GO`.**

## Governance

Execution report only. **0/12 gates PASS; four non-waivable blockers open (G1/G2/G4 + OpenBao part of G5); EU ruling
pending; M42 `NO_GO`.** Production cutover requires all gates accepted, M42 changed by Patrick Maina, and his explicit
`APPROVED — EXECUTE PRODUCTION CUTOVER`.
