# Stage 7 — Hardening (CONDITIONAL-GO Conditions) — Governance Charter

**Status:** governance setup (documentation only). With ADR-130 and the ratified owners, all STAGE-ENTRY blockers
are resolved and this charter **proposes** Stage 7 move `requires_review → approved_for_execution` in
`manifests/implementation-manifest.yaml` (the human governance authority's PR merge is the approval act).
**`approved_for_execution` authorises no hardening activity** — each workstream is gated by §7.2 and production GO
stays deny-by-default via M42. **No penetration test, DR drill, load/chaos run, migration, production-provider
binding, or Stage-8 work is authorised by this document.**

Stage 7 is the **production hardening / operational-assurance programme** that discharges the CONDITIONAL-GO
conditions issued by M42 (ADR-129, ADR-012). It is **not a software module** — there is no `m43+`, no package, no
migration, no API/permission/audit/event surface. Repository truth: `manifests/implementation-manifest.yaml`
`stage: 7` (`status: requires_review`, `priority: P0_for_GA`, `mvp: false`, `depends_on_stage: 6`) with four
declared items. This charter records the accountability structure, evidence requirements, dependency register, and
entry/exit gates so a human Stage-7 governance authority can review and ratify them.

**Production readiness remains `CONDITIONAL_GO`. This charter does not change it.**

---

## 0. Role reconciliation (repository truth)

Roles below are reconciled against `docs/02-product/USER_ROLES.md` and `docs/00-executive/PRODUCT_VISION.md`.
Durable **roles** are used, never named individuals.

| Governance role (this charter) | Repository-authoritative role | Status |
| --- | --- | --- |
| Executive Sponsor / ultimate escalation | **MD / CEO** (USER_ROLES.md) | EXISTS |
| Stage-7 Programme Owner | **COO** (operational oversight, escalations) | EXISTS |
| Finance sign-off authority | **CFO** (finance oversight; maker-checker, cannot self-approve) | EXISTS |
| Legal sign-off authority | **Legal Officer** (privilege + ethical walls) | EXISTS |
| Business-continuity / operational acceptance | **Operations Officer / COO** | EXISTS |
| Independent assurance / read-only challenge | **Auditor** (read-only across audit/evidence, no mutation) | EXISTS |
| Technology / remediation owner | **CTO / Technology Lead** | **RATIFIED (ADR-130)** — added to `USER_ROLES.md` as a platform/governance-scope role |
| Risk & Compliance assurance owner | **Head of Risk & Compliance** | **RATIFIED (ADR-130)** — added to `USER_ROLES.md` as a platform/governance-scope role; Auditor remains the independent read-only assurance role |

> The two roles are ratified per **ADR-130** as programme-governance (organizational accountability) roles and
> recorded in `docs/02-product/USER_ROLES.md` (platform/governance scope, not tenant business approvers). Actual
> appointment of a person to each role remains a human governance act.

---

## 1. OPEN_QUESTION #9 — Stage-7 condition ownership (authoritative — ADR-130)

Accountability reconciled to the (now ratified) role catalogue, preserving maker-checker/independence
(**no role executes and certifies its own critical condition**):

| Condition | Accountable (owns outcome) | Execution owner | Independent assurance | Acceptance / sign-off |
| --- | --- | --- | --- | --- |
| `penetration_test` | Head of Risk & Compliance *(ratified — ADR-130)* | **Independent qualified external penetration-testing provider** | Auditor | Stage-7 governance committee / MD-CEO |
| `dr_failover_failback_drill` | COO | CTO / Technology Lead *(ratified — ADR-130)* | Auditor / Risk & Compliance *(ratified — ADR-130)* | COO + Operations (business-continuity validation) |
| `load_and_chaos_at_scale` | CTO / Technology Lead *(ratified — ADR-130)* | CTO / Technology Lead *(ratified — ADR-130)* | Auditor / Risk & Compliance *(ratified — ADR-130)* | COO (operational acceptance) |

Independence note: for `penetration_test` the executor is an **external** party and the technical remediation owner
(CTO/Technology Lead) is distinct from the accountable assurance owner and the acceptance authority — the tester
never accepts its own result. For DR and load/chaos the execution owner (Technology) is distinct from the assurance
(Auditor/Risk) and acceptance (COO) roles.

## 2. OPEN_QUESTION #14 — migration governance (authoritative roles — ADR-130; sources remain TBD)

| Aspect | Proposed role |
| --- | --- |
| Accountable | COO |
| Migration technical owner | CTO / Technology Lead *(ratified — ADR-130)* |
| Data/business reconciliation owner | relevant business/system owner (e.g. Finance Officer / Operations Officer per data domain) |
| Finance sign-off | **CFO** (maker-checker; cannot self-approve) |
| Legal sign-off | **Legal Officer** |
| Risk / Compliance assurance | Head of Risk & Compliance *(ratified — ADR-130)* / Auditor |
| Final programme acceptance | MD / CEO or authorised Stage-7 governance authority |

### Candidate migration-source classification (repository truth)

Per OQ #14, the **real** first-tenant source systems are undetermined. No system is confirmed as a migration
source in the repository.

| Candidate system | Classification | Evidence |
| --- | --- | --- |
| ERPNext, ApticOne, AutoBonds, BimaPro, ApticPay, M-Pesa, messaging gateways | **Integration-only source** (connector, Framework/Sandbox) | OQ #4; `docs/06-data-and-contracts/INTEGRATION_CATALOGUE.md` |
| Imarisha | **Integration-only source** (labelled "Source system", Framework/Sandbox — a connector, not a confirmed migration source) | `INTEGRATION_CATALOGUE.md:16` |
| Core banking / accounting / ERP (journal posting targets) | **Integration-only source** (POST-MVP, Framework Only; m23/m33) | ADR-095; `docs/04-modules/FINANCE_INTEGRATION.md`; `docs/04-modules/JOURNAL_ENGINE.md` |
| Reference / master-data source | **None established** | — |
| **Actual first-tenant migration source systems + record volumes** | **NOT YET DETERMINED (TBD)** | OQ #14 (unresolved) |

> No source may be treated as a confirmed migration source until repository evidence (an approved source inventory)
> establishes it. The real first-tenant sources remain **TBD** and are a hard entry prerequisite for
> `real_data_migration_execution`.

---

## 3. Stage-7 governance matrix (RACI + independence)

`condition | accountable | execution | independent assurance | evidence required | acceptance criteria | sign-off authority | blocking severity | dependencies`

- **penetration_test** | Head of Risk & Compliance *(ratified — ADR-130)* | independent external provider | Auditor | §5.1 evidence package | no unresolved critical/high finding without accepted residual-risk; retest passed | Stage-7 committee / MD-CEO | **BLOCKER (production GO)** | test environment; hosting/infra decision (OQ #16); connector posture
- **dr_failover_failback_drill** | COO | CTO / Technology Lead *(ratified — ADR-130)* | Auditor / Risk & Compliance *(ratified — ADR-130)* | §5.2 evidence package | RTO/RPO within target; restore + failback + reconciliation pass | COO + Operations | **BLOCKER (production GO)** | real backup/restore executor binding (ADR-127); infra target (OQ #16)
- **load_and_chaos_at_scale** | CTO / Technology Lead *(ratified — ADR-130)* | CTO / Technology Lead *(ratified — ADR-130)* | Auditor / Risk & Compliance *(ratified — ADR-130)* | §5.3 evidence package | meets defined SLOs under load + chaos; bottlenecks remediated + retested | COO (operational acceptance) | **BLOCKER (production GO)** | SLO targets (OQ #13); infra target (OQ #16)
- **real_data_migration_execution** | COO | CTO / Technology Lead *(ratified — ADR-130)* | Head of Risk & Compliance *(ratified — ADR-130)* / Auditor | §5.4 evidence package | control totals reconcile; rollback rehearsed; Finance + Legal + business sign-off | MD-CEO / Stage-7 authority | **BLOCKER (production GO)** | approved source inventory (OQ #14 — **TBD**); CFO + Legal Officer sign-off

**Independence principle (enforced):** no person/team independently executes and certifies its own critical
hardening condition. Execution, independent assurance, and acceptance are held by distinct roles; the M42
maker-checker/SoD model (requester ≠ certifier; independent human sign-off; AI/system/automation never certify)
governs how each condition's evidence is accepted into the certification programme.

---

## 4. (reserved — see §5 evidence requirements)

## 5. Evidence requirements (minimum packages)

### 5.1 Penetration test
Agreed scope · environment · methodology · independent test report · vulnerability classification · remediation
evidence · retest evidence · residual-risk acceptance · final security sign-off.

### 5.2 DR / failover / failback
Approved drill plan · backup verification · restore evidence · failover timestamps · measured RTO/RPO · failback
evidence · integrity/reconciliation checks · incident/deviation log · lessons learned · corrective-action plan ·
approval.

### 5.3 Load / chaos at scale
Workload model · target volumes · baseline · latency/throughput/error metrics · resource utilisation · failure-
injection scenarios · recovery behaviour · bottlenecks · remediation/retest · acceptance against defined SLOs.

### 5.4 Real-data migration
Approved source inventory · mapping specification · data-quality assessment · rehearsal evidence · control totals ·
exception register · reconciliation · rollback plan and rehearsal · privacy/security controls · Finance sign-off ·
Legal sign-off · business-owner sign-off · final migration acceptance.

> Each evidence package is recorded against the corresponding M42 certification programme condition as bounded
> metadata + **opaque evidence references** (M42 stores no raw report bodies, secrets, or customer payloads).

---

## 6. Stage-7 dependency / readiness register

These are **not** added to the four canonical Stage-7 conditions; they are prerequisites/parallel dependencies.

| Dependency | Classification | Repository reference |
| --- | --- | --- |
| Approved KMS/HSM/Vault strategy + binding M41's real `SecretProviderPort` | **Prerequisite to production GO** + build-time hardening | ADR-128; OQ #10/#16 |
| Real backup/restore executor binding for M40 (`BackupExecutorPort`) | **Prerequisite to `dr_failover_failback_drill`** + build-time hardening | ADR-127 |
| Production connector/provider credentials + production validation | Operational configuration; **prerequisite to connector production GO** | OQ #4 |
| Observability / alert validation | Operational configuration (validate before/with DR + load) | M40 resilience (operational observability) |
| M42 `waived`-assessment-cell linkage hardening | **Build-time hardening; deferrable/non-blocking** | `STAGE_6_M42_CERTIFICATION.md` (documented limitation) |
| Hosting & infra target (cloud/orchestration/IaC) | **Prerequisite to pentest env, DR executor, secret provider** | OQ #16 |
| Data residency / compliance targets | Prerequisite/constraint on all live-infra activity | OQ #6, OQ #7 |
| Support model & SLOs | Prerequisite to `load_and_chaos_at_scale` acceptance criteria | OQ #13 |

---

## 7. Entry and exit gates

### 7.1 STAGE-ENTRY gate — `requires_review → approved_for_execution` (ADR-130; governance-readiness only)
- [x] Stage 6 formally closed on `main` (M30–M42 certified-on-branch; M42 closure recorded)
- [x] Operational-programme status model exists (ADR-130 + conformance LEGEND)
- [x] Accountable owners / RACI ratified against the role catalogue (§1, §2; `USER_ROLES.md`)
- [x] Independence / maker-checker model defined (§3)
- [x] Deny-by-default exit/GO gate defined (§7.3)

All four governance-readiness STAGE-ENTRY blockers are resolved ⇒ Stage 7 may move to `approved_for_execution`
(the human governance authority's PR merge is the approval act). This does **not** authorise any hardening activity
to run — each workstream is gated by §7.2.

### 7.2 WORKSTREAM-ENTRY gate (per workstream, before that activity may begin)
- [ ] Test environment(s) identified for the activity
- [ ] Required infrastructure/provider decision resolved for the activity (hosting/infra OQ #16; KMS/HSM/Vault OQ #10)
- [ ] Evidence template approved (§5)
- [ ] **Migration only:** approved **source inventory** (OQ #14 — **TBD**) + appointed Finance (CFO) & Legal (Legal Officer) sign-off authorities
- [ ] Connector-dependent activity only: production credentials (OQ #4)
- [ ] Load/chaos only: agreed SLO targets (OQ #13)

### 7.3 Exit gate / production GO — **deny-by-default**
- Executing a test does **not** convert `CONDITIONAL_GO` to `GO`.
- Production GO requires the M42 governance model: all mandatory evidence present, all blocking findings and
  conditions closed/accepted through governed sign-off (requester ≠ certifier; independent human sign-off;
  AI/system/automation never certify), and an issued GO/CONDITIONAL-GO decision (ADR-012).
- Any unresolved BLOCKER condition ⇒ not GO.

---

## 8. Governance-schema gap — RESOLVED (ADR-130)

The prior gap (no operational-programme approval status; `approved_for_build` is module-only) is **resolved by
ADR-130**, which defines the operational-programme lifecycle `requires_review → approved_for_execution →
in_execution → evidence_complete → conditionally_closed → closed` and registers it in the conformance status
LEGEND (`tools/conformance/test/conformance.smoke.ts`). `approved_for_build` is never reused for an operational
programme.

## 8a. Blocker classification

| Item | Classification |
| --- | --- |
| Operational-programme status model (ADR-130 + LEGEND) | **STAGE-ENTRY** — resolved |
| Ratified owners / RACI (role catalogue) | **STAGE-ENTRY** — resolved |
| Independence / maker-checker model | **STAGE-ENTRY** — resolved |
| Deny-by-default exit/GO gate | **STAGE-ENTRY** — resolved |
| Hosting / infra target (OQ #16) | **WORKSTREAM-ENTRY** (all live-infra workstreams) |
| Test environments | **WORKSTREAM-ENTRY** (per activity) |
| KMS/HSM/Vault strategy + `SecretProviderPort` (OQ #10; ADR-128) | **WORKSTREAM-ENTRY** + **BUILD-TIME HARDENING** |
| Backup/restore executor binding (ADR-127) | **WORKSTREAM-ENTRY** (DR drill) + **BUILD-TIME HARDENING** |
| Connector production credentials (OQ #4) | **WORKSTREAM-ENTRY** (connector-dependent) |
| SLO targets (OQ #13) | **WORKSTREAM-ENTRY** (load/chaos acceptance) |
| Real migration **source inventory** (OQ #14 — **TBD**) | **WORKSTREAM-ENTRY** (`real_data_migration_execution`) |
| Finance (CFO) / Legal (Legal Officer) sign-off appointment | **WORKSTREAM-ENTRY** (migration) |
| All four conditions' evidence + M42 governed acceptance | **PRODUCTION-GO** |
| M42 `waived`-assessment-cell linkage hardening | **BUILD-TIME HARDENING** (deferrable, non-blocking) |
| Stage 8 "Phase 7 — Vertical business solutions" | **INFORMATIONAL** (deferred) |

**All STAGE-ENTRY blockers are resolved.** No STAGE-ENTRY blocker remains; the rest are WORKSTREAM-ENTRY,
PRODUCTION-GO, BUILD-TIME, or INFORMATIONAL and must not globally block the Stage.

---

## 9. Position

- Stage 6: **formally closed on main**; production readiness **`CONDITIONAL_GO`** (unchanged by this charter).
- Stage 7: **STAGE-ENTRY blockers resolved ⇒ proposed `requires_review → approved_for_execution`** (human
  governance-authority merge is the approval act). No hardening activity is authorised; each workstream is gated by
  §7.2; production GO stays deny-by-default via M42.
- Stage 8 ("Phase 7 — Vertical business solutions"): `deferred`, must not begin.

Outstanding items are WORKSTREAM-ENTRY / PRODUCTION-GO / BUILD-TIME (§8a), not Stage-entry: real migration sources
(OQ #14 — TBD), hosting/infra (OQ #16), KMS/HSM/Vault (OQ #10), connector credentials (OQ #4), SLO targets
(OQ #13), and the person-appointments to the ratified roles.
