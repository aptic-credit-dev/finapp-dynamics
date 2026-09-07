# Stage 7 — Remaining Assurance Execution Plan (Four Gates)

> Planning artifact only. It **executes no gate**, changes **no** workstream status, appoints **no** provider,
> touches **no** production/data/infra, and does **not** alter the **M42 = NO_GO** decision. It is a map over
> the **existing** authoritative packs/runbooks — it links, it does not duplicate. Base: `main`
> `f85d6141995bfebfd6db6e00707f1cfa03151750` (B11 SSH lockdown merged, PR #177).

Governing rules: **ADR-130** (operational-programme lifecycle) and **ADR-131** (Tier-1 automated execution vs
Tier-2 independent acceptance) — `docs/01-architecture/ARCHITECTURE_DECISION_REGISTER.md`. Charter:
`docs/03-platform/STAGE_7_HARDENING_GOVERNANCE.md`. Master evidence map:
`docs/03-platform/STAGE_7_TIER1_EVIDENCE_INDEX.md`. Objective transition read:
`docs/03-platform/STAGE_7_WORKSTREAM_STATUS_TRANSITION.md`.

---

## 1. Executive status

Stage-7 hardening is a **governed operational programme** (ADR-130), not a software build. Its four exit
conditions each require **evidence** plus **independent Tier-2 human/external acceptance** — never internal
automation alone. **Internal (Tier-1) engineering is largely exhausted**: security pre-assessment, single-host DR
mechanics on real PG16, authenticated multi-tenant load/chaos with root-cause, and a synthetic migration
rehearsal are all done and evidenced (see the index). Every remaining blocker is one of: **external
purchase/provider**, **human acceptance/decision**, or **real data/source** — none is internal code.

All four workstreams remain **`requires_review`** and MUST stay so until a **human** Stage-7 governance authority
transitions them (ADR-130). Production readiness stays **`CONDITIONAL_GO`**; the production GO is deny-by-default
and is derived only through the **M42** governed decision (ADR-129) once every condition is closed/accepted.
**M42 remains NO_GO.** This plan does not claim production readiness.

Approved thresholds referenced throughout (OQ#13): **p95 ≤ 200 ms, p99 ≤ 500 ms, error rate ≤ 0.5%**;
**RTO ≤ 15 min, RPO ≤ 5 min**.

## 2. Four-gate readiness matrix

| Gate | Status (unchanged) | Tier-1 evidence exists | Missing for PASS | Hard blocker | Claude can execute? | Independent party mandatory | Accountable owner |
|---|---|---|---|---|---|---|---|
| **G1 Independent penetration test** | `requires_review` | Yes — internal pre-assessment clean (`STAGE_7_TIER1_EVIDENCE.md`); RoE + provider packs ready | External report, CVSS→M42 severities, remediation + **passed retest**, Auditor assurance | No external provider engaged; no representative env provisioned | **Partial** (Tier-1 done; external black-box test cannot be self-run) | **Yes** — external provider; internal test is never the independent pentest (ADR-131) | Head of Risk & Compliance |
| **G2 Cross-host DR drill** | `requires_review` | Yes — single-host drill (RTO 309 ms/RPO 0) + real PG16 `pg_basebackup`/`pg_verifybackup`/restore/WAL (`STAGE_7_TIER1_DR_EVIDENCE.md`, `STAGE_7_LIVE_READINESS_VALIDATION.md`) | Cross-host replication + real failover/failback within RTO≤15/RPO≤5, immutable off-provider (B2 WORM) push+restore, reconciliation, COO acceptance | **2nd Contabo standby VPS + Backblaze B2 not supplied** | **Partial** (mechanics proven; cross-host needs purchased infra) | **Yes** — COO+Operations acceptance; Auditor/Risk assurance | COO |
| **G3 Acceptance-grade load & chaos** | `requires_review` (entry moved to `approved_for_execution` per ADR-133) | Yes — authenticated multi-tenant load+chaos, root-caused write-burst ceiling (`STAGE_7_LOADCHAOS_MULTITENANT_EVIDENCE.md`, `STAGE_7_CAPACITY_RETEST_EVIDENCE.md`) | Acceptance-grade per-workload SLO on a **dedicated host**, write-burst remediation **re-tested**, COO acceptance | Shared-VPS variance (not acceptance-grade); open p95 write-burst breach on the single PLATFORM audit chain | **Partial** (staging runs done; acceptance-grade needs dedicated host + a design decision) | **Yes** — COO operational acceptance | CTO / Technology Lead |
| **G4 Real-data migration rehearsal** | `requires_review` (`requires: finance_signoff, legal_signoff`) | Yes — synthetic rehearsal, reconcile + rollback + idempotency PASS (`STAGE_7_TIER1_MIGRATION_EVIDENCE.md`); intake/acceptance checklists staged | Real source inventory, real extract rehearsal + reconciliation + rollback, **CFO+Legal+business sign-off**, MD-CEO acceptance | **Entry gate unmet** — OQ#14 pilot tenant + real source **TBD**; no real source exists in repo truth | **No** (beyond synthetic; fails entry gate — no real source may be invented) | **Yes** — CFO (≠ executor) + Legal Officer + business owner + MD | COO |

Owners/RACI per `STAGE_7_HARDENING_GOVERNANCE.md` §5 (roles) and §7 (per-gate criteria).

## 3. Recommended execution order

Ordered by **shortest path to acceptable evidence given external lead time**, running the long-lead human/purchase
decisions **in parallel from T0** (they are not code and do not block each other):

1. **G1 Penetration test** — highest security value; representative env may be VPN/bastion (internet exposure not
   mandatory); provider engagement is the **longest external lead** → start provider appointment first.
2. **G3 Load & chaos** — entry gate materially met (ADR-133); most advanceable internally; needs a dedicated host
   for acceptance-grade numbers **and** a capacity/audit-chain design decision (ADR-track).
3. **G2 Cross-host DR drill** — mechanics proven; gated on **infra purchase** (standby VPS + B2) + Legal residency
   ruling; execute once infra exists.
4. **G4 Real-data migration** — longest **human/data** dependency chain (entry gate unmet: OQ#14 + CFO/Legal
   appointments); begin the pilot-tenant/source **naming** decision at T0 in parallel, execute last.

## 4. Dependencies and owners

| Gate | Accountable | Execution | Independent assurance | Acceptance authority | Non-repo dependency |
|---|---|---|---|---|---|
| G1 | Head of Risk & Compliance | Independent external provider | Auditor | Stage-7 committee / MD-CEO | Provider engagement + NDA; representative env |
| G2 | COO | CTO / Technology Lead | Auditor / Risk & Compliance | COO + Operations | 2nd Contabo VPS; Backblaze B2 (Object Lock); DPA residency ruling |
| G3 | CTO / Technology Lead | CTO / Technology Lead | Auditor / Risk & Compliance | COO | Dedicated production host; audit-chain `scope_key` decision |
| G4 | COO | CTO / Technology Lead | Risk & Compliance / Auditor | CFO + Legal + business + MD-CEO | Named pilot tenant + real source (OQ#14); DPA legal basis |

For every gate the **executor ≠ independent assurer ≠ acceptance authority** (ADR-130 §independence).

## 5. Evidence required for PASS (per gate)

- **G1:** external pentest report; findings classified to M42 severities; remediation evidence; **passed retest**;
  Auditor assurance statement; committee/MD-CEO sign-off. Exit: no unresolved critical/high without accepted
  residual risk + retest passed (`STAGE_7_HARDENING_GOVERNANCE.md` §7).
- **G2:** cross-host failover + failback within **RTO ≤ 15 min / RPO ≤ 5 min**; immutable off-provider
  backup push + verified restore; post-failover integrity/reconciliation (audit chain `gapfree=true`); COO +
  Operations acceptance.
- **G3:** reproducible per-workload SLO run on a dedicated host meeting **p95 ≤ 200 ms / p99 ≤ 500 ms /
  err ≤ 0.5%**; full chaos suite; write-burst ceiling remediated **and re-tested**; COO operational acceptance.
- **G4:** real-source control totals reconcile; rollback rehearsed on real extract; idempotency proven;
  **CFO + Legal + business** sign-off; MD-CEO/Stage-7 final acceptance (acceptance checklist B in
  `STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md`).

No evidence in this repo may be manufactured; opaque evidence refs only.

## 6. Safe test environments

- **Staging (existing):** Contabo shared VPS `169.58.194.151` (`vmi3515072`), PG16, app services bound
  `127.0.0.1` only, SSH-locked (B11 CLOSED). Suitable for **G1 representative testing** and **G3 staging runs**;
  **not** acceptance-grade for G3 SLO numbers (shared-VPS variance).
- **Dedicated production-parity host (to purchase):** required for **G3 acceptance-grade** SLO measurement.
- **Standby VPS + Backblaze B2 (to purchase):** required for **G2 cross-host** failover/failback + WORM backup.
- **Sandbox schema `stage7_migration`:** the only write target of the migration framework (**G4** rehearsal).
- All harnesses are **fail-closed**: refuse `NODE_ENV=production`, pg-library only, no shell/dump/restore
  injection, run-scoped reversible (`STAGE_7_TIER1_DR_EVIDENCE.md`, `STAGE_7_TIER1_MIGRATION_EVIDENCE.md`).

## 7. Production-data restrictions

- **Synthetic / non-personal data only** by default (Kenya DPA; OQ#6/#7). G1/G2/G3 use synthetic tenants.
- **No live customer data** in G1/G2/G3 under any circumstance.
- **G4 real source data** may be used **only** on a non-production copy, under a documented **Kenya-DPA legal
  basis** (Legal Officer) and **after** CFO/Legal/business appointment — never against live production, never with
  live-prod-write extraction.
- Secret material stays behind the opaque `secretref:` seam / fail-closed `SecretProviderPort` (ADR-128); zero
  secret-value handling in any gate.

## 8. Rollback and stop conditions

- **Harness-level:** every executor auto-refuses production and is run-scoped/reversible; DR/migration rollback is
  built in and already proven in Tier-1.
- **Stop immediately and do not progress** if: any **critical/high** pentest finding is open without accepted
  residual risk (G1); **RTO/RPO exceeded** or post-failover reconciliation shows any audit-chain gap (G2); an SLO
  threshold is breached and un-remediated, or a correctness control (the audit hash-chain) would have to be
  weakened for throughput (G3 — **prohibited**); **control totals fail to reconcile** or rollback does not fully
  restore (G4).
- **Governance stop:** absent the required Tier-2 acceptance, a gate never advances past `evidence_complete`
  (ADR-130). No stop condition is ever resolved by an AI decision.

## 9. Proposed calendar / sequence (relative, no invented dates)

Windows are **relative** (T0 = the governance authority ratifies owners/RACI and moves the programme to
`approved_for_execution`). No absolute dates are asserted.

| Window | Parallel human/purchase track | Parallel technical track (Tier-1, within an approved workstream) |
|---|---|---|
| **T0** | Ratify owners/RACI; appoint pen-test provider (NDA); name pilot tenant + source (OQ#14); approve infra purchases | Freeze representative-env spec; confirm all four harness self-tests green |
| **T0 → external lead** | Provider onboarding; procure standby VPS + B2; procure dedicated host | Stand up representative pentest env (G1); refresh G3 staging baseline |
| **Mid** | Pentest execution (external) → findings | G3 acceptance-grade runs on dedicated host; remediation + retest |
| **Mid → late** | COO/Ops accept G2/G3; Auditor assurance | Cross-host DR drill (G2) once infra live; migration rehearsal on real copy (G4) once source named |
| **Late** | CFO/Legal/business + MD-CEO sign-offs (G4); committee sign-off (G1) | Evidence packages assembled (opaque refs) |
| **Gate close** | Each gate → `evidence_complete` → Tier-2 acceptance → `conditionally_closed` | — |
| **Programme close** | **M42 governed decision** converts CONDITIONAL_GO once all four closed/accepted | — |

## 10. GO/NO-GO decision structure

Deny-by-default (ADR-129/ADR-130):

1. Each workstream: `requires_review → approved_for_execution` (human) → `in_execution` → `evidence_complete`
   (Tier-1 evidence recorded) → **Tier-2 independent acceptance** → `conditionally_closed` → `closed`.
2. A gate reaching `evidence_complete` is **not** a GO and **not** acceptance.
3. Production GO is issued **only** by the **M42 governed decision** once **all four** conditions are
   closed/accepted; **M42 remains NO_GO** until then.
4. **AI/automation never** approve a progression, certify a condition, or issue GO/CONDITIONAL_GO (ADR-130 line
   1066; ADR-131). Claude may only **propose** a transition via a governance PR; the **human owner's merge is the
   approval act**.

## 11. Exact next human decision

The Stage-7 governance authority (**MD-CEO or delegated committee**) ratifies **owners/RACI** and, as the single
highest-leverage act (longest external lead time), **appoints and engages the independent external penetration-test
provider** (engagement + NDA + conflict-of-interest declaration) — recorded by merging a governance PR. In the
same governance step, **name the pilot tenant + real migration source (OQ#14)** and **approve the infra
purchases** (standby VPS + B2 for G2; dedicated host for G3) so the purchase/lead clocks start in parallel.

## 12. Exact next technical action

**No gate execution.** The next safe, Claude-executable action is a **readiness reconfirmation only**: verify the
four harnesses are still green via the existing self-test lane (already part of `npm run test:smoke` —
`deploy/staging/{loadchaos-selftest,auth-load-selftest,dr-selftest,migration-selftest}.mjs`) and finalize the
**representative pentest-environment provisioning spec** (`STAGE_7_PENTEST_READINESS.md` §1) so it is ready to
stand up the moment the human decision in §11 lands. Standing up the environment, engaging the provider, and
running any gate all wait on §11.

## 13. Provider handoff checklist — independent pen test (G1)

Reuse (do not recreate): `STAGE_7_PENTEST_PROVIDER_BRIEF.md` (sendable as-is), `STAGE_7_PENTEST_EXECUTION_PACK.md`,
`STAGE_7_PENTEST_HANDOFF.md`, `STAGE_7_PENTEST_READINESS.md`, `STAGE_7_TIER1_EVIDENCE.md` (pre-assessment).

- [ ] Provider engaged; NDA + conflict-of-interest declaration signed
- [ ] Persons appointed to Accountable / Remediation / Assurance / Acceptance roles
- [ ] Representative env provisioned (prod-parity app + PG16, RLS FORCE, real auth/RBAC, ≥2 tenants, connectors mocked)
- [ ] Scope approved (in/out — DoS excluded; infra/KMS/live-connectors out) per readiness §4
- [ ] Severity methodology (CVSS → M42 severities) approved
- [ ] Test window + controlled access channel approved (VPN/bastion; no internet mandatory)
- [ ] Evidence storage path defined (opaque refs)
- [ ] Remediation + **retest** workflow agreed
- [ ] Synthetic/non-personal data only confirmed (no real secrets, no live data)

## 14. DR-drill runbook readiness checklist (G2)

Reuse: `deploy/dr/` (`backup.sh`, `failover.sh`, `restore-pitr.sh`, `standby-bootstrap.sh`, `dr-healthcheck.sh`,
`pgbackrest.conf.example`, `postgresql.replication.conf.example`), `deploy/staging/{dr-drill,dr-selftest,backup-executor}.mjs`;
docs `STAGE_7_TIER1_DR_EVIDENCE.md`, `STAGE_7_LIVE_READINESS_VALIDATION.md`, `STAGE_7_DR_PROVISIONING_READINESS.md`,
`STAGE_7_OFFSERVER_DR_ARCHITECTURE_DECISION.md`.

- [ ] Standby VPS provisioned (≈12 vCPU / 48 GB / ≥~387 GB, Ubuntu 24.04, PG 16.x, separate failure domain)
- [ ] Backblaze B2 bucket with Object Lock (WORM); write-only app key + separate read key
- [ ] Kenya-DPA residency ruling for standby + object-store region (Legal/Risk/Tech)
- [ ] Streaming replication configured; standby bootstrapped
- [ ] Failover + **failback** rehearsed within **RTO ≤ 15 min / RPO ≤ 5 min**
- [ ] Immutable off-provider backup push + **verified restore** (`pg_verifybackup`)
- [ ] Post-failover reconciliation: audit chain `gapfree=true`; app health/auth/tenant-isolation verified
- [ ] COO + Operations acceptance recorded; Auditor/Risk assurance

## 15. Load/chaos-test readiness checklist (G3)

Reuse: `deploy/staging/{load-harness,auth-load-harness,chaos-harness,loadchaos-selftest,auth-load-selftest}.mjs`;
docs `STAGE_7_LOADCHAOS_MULTITENANT_EVIDENCE.md`, `STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md`,
`STAGE_7_CAPACITY_RETEST_EVIDENCE.md`, `STAGE_7_AUDIT_CHAIN_CONTENTION_ANALYSIS.md`.

- [ ] Dedicated production-parity host provisioned (quiet, not shared-VPS)
- [ ] SLO targets confirmed (OQ#13: p95 ≤ 200 ms / p99 ≤ 500 ms / err ≤ 0.5%)
- [ ] Realistic per-tenant business-write workload scripted (beyond round-robin reads)
- [ ] Audit hash-chain `scope_key` granularity decision taken (m03-owner / ADR-track) — **without weakening the control**
- [ ] Write-burst ceiling remediation applied + **re-tested** to SLO
- [ ] Full chaos suite executed; restart recovery clean; audit chain `gapfree=true`
- [ ] Reproducible acceptance-grade run recorded; COO operational acceptance

## 16. Migration-rehearsal readiness checklist (G4)

Reuse: `deploy/staging/{migration-mapping,migration-framework,migration-rehearse,migration-fixtures,migration-selftest}.mjs`;
docs `STAGE_7_TIER1_MIGRATION_EVIDENCE.md`, `STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md` (intake checklist A + acceptance checklist B).

- [ ] Pilot tenant named (COO/OQ#12); source system(s) named (COO/business — OQ#14)
- [ ] Kenya-DPA legal basis for using the real source documented (Legal Officer)
- [ ] Non-production copy/extract of the real source available (no live-prod-write extraction)
- [ ] Field mapping validated against the real schema; data-quality assessment done
- [ ] Control totals reconcile on the real extract; idempotency proven
- [ ] Rollback rehearsed on the real extract; full restore verified
- [ ] CFO sign-off (≠ migration executor), Legal sign-off, business-owner sign-off
- [ ] MD-CEO / Stage-7 committee final acceptance

---

### Guardrails preserved

- **M42 = NO_GO** — unchanged. This plan issues no GO and claims no production readiness.
- All four workstreams remain **`requires_review`**; no status changed.
- No provider appointed/contacted; no penetration, chaos, DR, or migration test executed; no live data used.
- No application code, database, migrations, secrets, or infrastructure altered.
- Frozen business baseline and B11 CLOSED status preserved.
