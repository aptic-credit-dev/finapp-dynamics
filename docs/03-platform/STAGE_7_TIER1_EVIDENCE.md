# Stage 7 — Tier-1 Automated Execution Evidence (ADR-131)

**Authority:** ADR-131 is **ACCEPTED** on `main` (via the merge of PR #116 → `d16000f`). This authorises engineering/
AI agents to perform **Tier-1** automated hardening execution in an approved non-production/staging environment and
record evidence. **Tier-1 does NOT satisfy Tier-2 independent acceptance or the production GO.** No workstream is
transitioned by this document; all four remain `requires_review`; production readiness remains `CONDITIONAL_GO`.

> **TIER-1 INTERNAL AUTOMATED SECURITY EXECUTION — NOT THE INDEPENDENT EXTERNAL PENTEST.**

Assessed baseline: `main` `d16000f` (this branch is tree-equivalent plus these docs). Local PostgreSQL **15.2**
throwaway; **authoritative CI = PostgreSQL 16**.

## Increment scope (smallest safe sequence)

This first increment delivers **Phase 2 — internal automated security execution** (runnable and validated here) and
records the ADR-131 acceptance. The other phases are **deferred to their own focused increments** (rationale below),
per "begin … in the smallest safe sequence" and to keep each new subsystem independently reviewable on a certified
platform.

| Phase | This increment |
| --- | --- |
| 2 — internal automated security execution | **DONE** (below) |
| 1 — provider-neutral staging container stack | **DEFERRED** — own increment (Docker/compose/seed/validation; needs a validated app-boot + running Docker; not shipped unvalidated) |
| 3 — staging DR executor adapter (ADR-127 carve-out) | **DEFERRED** — a new adapter subsystem behind `BackupExecutorPort`; own increment + review |
| 4 — load/chaos harness | **DEFERRED** — new tooling + a running staging target; own increment |
| 5 — synthetic migration framework | **DEFERRED** — new subsystem; own increment |

## Phase 2 — Internal automated security execution

### Static (code-level)
| Check | Result |
| --- | --- |
| Dependency audit (`npm audit --omit=dev`) | **0 vulnerabilities** (all severities) |
| Secret scan (source) | no hardcoded secret/token/key literals; secrets are opaque `secretref:` only |
| Dangerous-API scan | no `eval`/`child_process`/`spawn`/`new Function` in product source (the one `m31` hit is a regex that *detects* `child_process`) |
| Query construction | parameterized values (`$1`); `m02-rbac orgNodeExists ${table}` is a hardcoded 3-way whitelist — not injectable |

### Dynamic (app running against PostgreSQL under FORCE RLS as the non-owner `finapp_app` role, NOBYPASSRLS)
Executed the full DB/API integration lane against a fresh migrated database (82 migrations applied, 0 errors):
**97 specs / 2938 assertions / 0 failed.** The security-relevant coverage exercised and passing:

| Attack class | Evidence (passing specs) |
| --- | --- |
| Authentication / session | `api-auth` (37), `m02-auth` (32) |
| RBAC / privilege boundaries | `api-rbac` (20), `m02-rbac` (12) |
| Tenant isolation + cross-tenant **non-disclosure (404-not-403)** | `api-identity` (78), `rls-convention` (26) — another tenant sees 0 rows; a real other-tenant record reads as 404 |
| Actor/identity resolution | `m02-identity` (44), `m02-actor-resolution` (37) |
| Maker-checker / SoD bypass attempts | `m21-journal` (44), `m22`/approval, `m41-security` (31), `m42-certification` (35), `m42-services` (25) — self-approval / AI-certify refused |
| Audit integrity / no leakage | `m03-audit` (24) |
| Reconciliation/journal controls | `m15-recon` (36), `m20-glrecon` (48), `api-journals` (14), `api-reconciliation` (11), `api-gl-reconciliation` (14) |

**No internally detected release-blocking finding.** This corroborates the controls certified across M01–M42; no
remediation was required, and (to preserve certification) no certified source was modified.

### Limitations of this Tier-1 execution (honest)
- It is **static + integration-level dynamic** testing, not a full black-box external pentest against a deployed,
  internet-adjacent instance. Attack classes best exercised against a live deployed environment (runtime SSRF,
  header/config hardening, live business-logic abuse at HTTP scale, IDOR at the edge) require the Phase-1 staging
  deployment and the **independent external provider** — both still pending.
- Local DB is PostgreSQL 15.2; PG16 is authoritative (CI green).

## Evidence metadata
- Baseline SHA: `d16000f`; env: local throwaway PG 15.2 (`finapp_app` NOBYPASSRLS); tool: repo `test:db` lane +
  `npm audit`; result: 97 specs / 2938 assertions / 0 fail; migrations: 82 applied / 0 err. No secrets/customer data
  committed. For M42, this is recorded as an **opaque reference** to a Tier-1 pre-assessment — never the independent
  external pentest.

## Status — Tier-1 vs Tier-2

**`TIER-1 (security) COMPLETE — TIER-2 INDEPENDENT ACCEPTANCE PENDING.`** The `penetration_test` workstream stays
`requires_review`; its production-GO condition still requires the **independent external penetration test cleared +
Auditor assurance** (Tier-2), executed against a provisioned staging environment. No workstream moves to
`conditionally_closed`/`closed`; no GO is issued.

## Remaining Tier-2 human/external gates (unchanged)
Independent external pentest + Auditor assurance · independent DR assurance + COO/Operations acceptance · operational
acceptance + approved SLOs (OQ#13) · real-data migration + CFO + Legal sign-off (OQ#14) · governed production GO (M42).
