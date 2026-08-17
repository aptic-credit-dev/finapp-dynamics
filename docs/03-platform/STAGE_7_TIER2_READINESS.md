# Stage 7 — Tier-2 Readiness Package (decision packages + environment requirement)

> Governance/readiness documentation. This makes **no** external/human attestation and **no** production GO. It
> does **not** transition any workstream (all four remain `requires_review`), does **not** change `CONDITIONAL_GO`,
> and marks every proposed value **PROPOSED — HUMAN APPROVAL REQUIRED**. Baseline: `origin/main = e4f535f`.

Its purpose is to convert the remaining Tier-2 blockers into exact, owner-assignable decisions/actions so Stage-7
closure can proceed. Tier-1 technical work is consolidated (`STAGE_7_TIER1_COMPLETION_VERIFICATION.md`).

---

## 1. Docker / PG16 staging execution — status & requirement

**Docker daemon is DOWN on the current machine** (`dockerDesktopLinuxEngine` pipe not found), so the merged
`deploy/staging/` stack (PostgreSQL 16 + API) was **NOT booted**. This is reported, not worked around; no PG16
staging result is claimed. The DB-level Tier-1 executions already ran against **local PG 15.2** (see the Tier-1
evidence docs).

**Exact requirement to run the full stack:** a host with a **running Docker Engine** (Docker Desktop started, or a
Linux host with `dockerd`) able to pull `postgres:16` and build the API image.

**Deterministic run command** (once Docker is up):

```
cp deploy/staging/env.staging.example deploy/staging/.env.staging   # set LOCAL-only values
docker compose -f deploy/staging/docker-compose.yml --env-file deploy/staging/.env.staging up -d --build
STAGING_DR_EXECUTOR_ENABLED=0 node deploy/staging/bootstrap-synthetic.mjs   # DATABASE_URL -> staging PG
node deploy/staging/validate-staging.mjs                                    # PG16 gate should PASS here
API_BASE_URL=http://127.0.0.1:3000 node deploy/staging/validate-staging.mjs # exercises HTTP health
```

**Operator readiness checklist (fill on execution):**

- [ ] Docker Engine running; `postgres:16` pulled; API image built
- [ ] `validate-staging.mjs`: PG16 gate **PASS**, `finapp_app` NOBYPASSRLS non-owner, FORCE RLS, ≥2 tenants, no prod secrets
- [ ] `GET /api/v1/health` = 200; authenticated login flow exercised; cross-tenant isolation (404-not-403) confirmed
- [ ] Environment readiness attested by **Head of Risk & Compliance + Auditor** (Tier-2)

## 2. DR + load/chaos completion on PG16 — status

Deferred until the Docker/PG16 stack is up. The tooling exists and is validated at DB level:

| Item | Done (Tier-1, local) | Pending (needs PG16 stack) |
| --- | --- | --- |
| DR drill | backup→restore→reconcile→failover/failback on local PG (RTO 125 ms, RPO 0 s) | app-level health/auth/isolation during failover; PG16 run |
| Load | ~450–486 rps @12 conc, p95 ~46 ms, 0×5xx (local API) | **authenticated DB-write** + multi-tenant authenticated concurrency on PG16 |
| Chaos | malformed→400, burst/exhaustion recovery 4–5 ms, timeout no-crash | **API process restart**, **DB restart/recovery** on the managed stack |

None of these is independent DR assurance / COO acceptance.

## 3. OQ #13 — SLO / RTO / RPO proposal (PROPOSED — HUMAN APPROVAL REQUIRED)

Derived from **observed** Tier-1 metrics (local PG 15.2; the measured facts). The **targets are proposals only**.

| Dimension | Observed (Tier-1, local) | **PROPOSED target — HUMAN APPROVAL REQUIRED** |
| --- | --- | --- |
| API availability | health 200 throughout chaos | **≥ 99.9%** |
| p95 latency (read/auth mix) | ~46 ms @12 conc | **≤ 200 ms** |
| p99 latency | ~67 ms sustained | **≤ 500 ms** |
| Error rate (excl. intended 401/403) | 0×5xx | **≤ 0.5%** |
| RTO (staging DR) | measured 125 ms (synthetic) | **≤ 15 min** (production DR) |
| RPO | measured 0 s (synthetic exact) | **≤ 5 min** (production) |
| Peak/load assumptions | synthetic 12–120 conc | **defined per pilot tenant volume (OQ#14)** |

> Claude does **not** approve these. They require Risk/COO/Technology approval. Only the observed values are facts.

## 4. OQ #16 — hosting/infra decision package (provider-neutral)

| Area | Minimum decision (provider-neutral) | Value |
| --- | --- | --- |
| Environment model | staging + production, non-prod isolated | TBD |
| Compute | container runtime (compose today; orchestration TBD) | TBD |
| PostgreSQL | **16**, managed or self-hosted, non-owner app role + FORCE RLS | TBD |
| Network / access | private, controlled/allow-listed; no wildcard credentialed CORS | TBD |
| Backups | WAL + periodic snapshot; retention | TBD |
| Observability | app + audit logs, metrics, alerting | TBD |
| Secrets | via the OQ#10 backend (`SecretProviderPort`); no plaintext | TBD |
| Data residency | Kenya (OQ#6 default) unless approved otherwise | TBD |
| DR topology | primary + recovery; approved RTO/RPO (OQ#13) | TBD |

**Cloud/provider (AWS/Azure/GCP/…) NOT chosen here** — human decision.

## 5. OQ #10 — KMS/HSM/Vault decision package (provider-neutral requirements)

Encryption + key management (approved algorithms; envelope encryption) · access control (least privilege, per-tenant
scoping) · **rotation** (versioned, race-safe — M41 already supports) · auditability (every reveal audited, no secret
in logs) · availability + DR of the key backend · data residency · **integration with the M41 `SecretProviderPort`**
(the fail-closed seam already exists; a real provider drops in). **Provider selection pending human approval**
(ADR-128); M41 stays framework-only until then.

## 6. OQ #4 — connector production-readiness matrix

For every connector (current status: Framework/Sandbox). **No production credentials created.**

| Connector | Current | Credential req'd | Prod endpoint req'd | Owner | Validation needed | Blocker to pilot/GO |
| --- | --- | --- | --- | --- | --- | --- |
| ERPNext (accounting/ERP) | Framework/Sandbox | Yes | Yes | TBD | sandbox→prod contract test | if in pilot scope |
| ApticOne (core lending) | Framework/Sandbox | Yes | Yes | TBD | contract test | likely pilot-critical |
| Imarisha (source system) | Framework/Sandbox | Yes | Yes | TBD | extract validation | if a migration source (OQ#14) |
| AutoBonds / BimaPro | Framework/Sandbox | Yes | Yes | TBD | contract test | if in pilot scope |
| ApticPay / M-Pesa (payments) | Framework/Sandbox | Yes | Yes | TBD | payment sandbox cert | pilot-critical if payments in scope |
| Email / SMS / WhatsApp | Framework/Sandbox | Yes | Yes | TBD | delivery test | notifications in pilot |
| Bank statement / Google/M365 | Framework | Maybe | Maybe | TBD | ingestion/identity test | scope-dependent |

Connectors stay **fail-closed framework-only** until credentials + a certification pass exist (OQ#4).

## 7. OQ #14 — first-tenant migration-source template (fields management must fill)

**All real-source fields remain `TBD` (no real source invented).**

| Field | Value |
| --- | --- |
| Source system(s) | **TBD** |
| Business owner | **TBD** (role: business/system owner) |
| Record counts (by domain) | **TBD** |
| Data domains | **TBD** |
| Extraction method | **TBD** |
| Mapping owner | CTO/Technology Lead |
| Privacy / legal basis | **TBD** (Kenya DPA; OQ#6/#7) |
| Reconciliation owner | **TBD** |
| Finance sign-off authority | CFO |
| Legal sign-off authority | Legal Officer |
| Pilot tenant | **TBD** (OQ#12) |

`real_data_migration_execution` cannot commence until this is approved (manifest `requires: [finance_signoff, legal_signoff]`).

## 8. Consolidated Tier-2 readiness matrix

| Blocker | Current state | Completed (Claude/eng) | Remaining human/external action | Owner role | Evidence required | Unlocks |
| --- | --- | --- | --- | --- | --- | --- |
| Docker/PG16 staging | Docker down here | stack assets + run command + checklist | provide a Docker host; boot + attest readiness | CTO/Tech + Risk/Auditor | env readiness cert | all live workstreams |
| Authenticated DB-write load + restart chaos | tooling ready | harnesses + self-tests | run on PG16 with seeded login accounts | CTO/Tech | load/chaos evidence | load_and_chaos |
| Independent external pentest | not engaged | pre-assessment + handoff pack + RoE/scope | engage provider; NDA/CoI; execute | Head of Risk & Compliance | pentest report + retest | penetration_test |
| Approved RTO/RPO + SLOs (OQ#13) | proposed | proposal from observed metrics | approve targets | Risk/COO/Tech | signed SLO/RTO/RPO | DR + load_and_chaos |
| Independent DR assurance + COO acceptance | not done | DR drill evidence | full-stack drill + accept | COO + Auditor | DR acceptance | dr_failover |
| Hosting/infra (OQ#16) | open | provider-neutral package | choose target | MD/COO/Tech | hosting decision record | environment |
| KMS/HSM/Vault (OQ#10) | framework-only | requirements + `SecretProviderPort` seam | approve provider; bind | Platform/Security | provider + binding evidence | secrets/prod GO |
| Connector prod credentials (OQ#4) | sandbox | readiness matrix | issue creds; prod validation | providers + Tech | connector cert | pilot connectors |
| Real migration source (OQ#14) | TBD | source template | fill + approve source + pilot tenant | COO + CFO + Legal | approved source inventory | real_data_migration |
| Real migration + sign-offs | not run | synthetic rehearsal + rollback | execute with CFO/Legal/business sign-off | COO/CFO/Legal | migration acceptance | real_data_migration |
| Pilot monitoring window | not started | — | run pilot, no open critical defect | COO | pilot report | Phase-7 entry |
| M42 governed production GO | CONDITIONAL_GO | Stage-6 closure + evidence refs | issue GO from accepted evidence | M42 certifier(s) | GO decision | Stage-7 closure |

**Classes:** ENVIRONMENT (Docker/PG16, hosting), EXTERNAL (pentest, providers, connector creds, KMS), HUMAN
APPROVAL (RTO/RPO, SLOs, DR/ops/Finance/Legal/business sign-offs, source), PRODUCTION-GO (real migration, pilot,
M42 GO).

## Conclusion

Everything technically producible in-repo for Tier-2 readiness is prepared; the remaining closure depends on a
Docker-enabled PG16 environment, external assurance, and human governance approvals — converging on the M42 governed
production GO. No workstream is transition-eligible; nothing here is a Tier-2 attestation or a GO.
