# Stage 7 — Hardening (CONDITIONAL-GO Conditions) — Governance Charter

**Status:** governance setup (documentation only). Stage 7 remains `requires_review` in
`manifests/implementation-manifest.yaml`. **No hardening test, deployment, infrastructure change, or migration is
authorised by this document.**

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
| Technology / remediation owner | **CTO / Technology Lead** | **PROPOSED — not in USER_ROLES.md; needs ratification** |
| Risk & Compliance assurance owner | **Head of Risk & Compliance** | **PROPOSED — not in USER_ROLES.md; Auditor is the nearest existing independent-assurance role; needs ratification** |

> The two PROPOSED roles must be ratified (or mapped onto an existing role) by the Stage-7 governance authority
> before they can carry accountability. Until then they are placeholders.

---

## 1. OPEN_QUESTION #9 — Stage-7 condition ownership (proposed resolution)

Proposed accountability, reconciled to repository roles, preserving maker-checker/independence
(**no role executes and certifies its own critical condition**):

| Condition | Accountable (owns outcome) | Execution owner | Independent assurance | Acceptance / sign-off |
| --- | --- | --- | --- | --- |
| `penetration_test` | Head of Risk & Compliance *(proposed)* | **Independent qualified external penetration-testing provider** | Auditor | Stage-7 governance committee / MD-CEO |
| `dr_failover_failback_drill` | COO | CTO / Technology Lead *(proposed)* | Auditor / Risk & Compliance *(proposed)* | COO + Operations (business-continuity validation) |
| `load_and_chaos_at_scale` | CTO / Technology Lead *(proposed)* | CTO / Technology Lead *(proposed)* | Auditor / Risk & Compliance *(proposed)* | COO (operational acceptance) |

Independence note: for `penetration_test` the executor is an **external** party and the technical remediation owner
(CTO/Technology Lead) is distinct from the accountable assurance owner and the acceptance authority — the tester
never accepts its own result. For DR and load/chaos the execution owner (Technology) is distinct from the assurance
(Auditor/Risk) and acceptance (COO) roles.

## 2. OPEN_QUESTION #14 — migration governance (proposed resolution)

| Aspect | Proposed role |
| --- | --- |
| Accountable | COO |
| Migration technical owner | CTO / Technology Lead *(proposed)* |
| Data/business reconciliation owner | relevant business/system owner (e.g. Finance Officer / Operations Officer per data domain) |
| Finance sign-off | **CFO** (maker-checker; cannot self-approve) |
| Legal sign-off | **Legal Officer** |
| Risk / Compliance assurance | Head of Risk & Compliance *(proposed)* / Auditor |
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

- **penetration_test** | Head of Risk & Compliance *(proposed)* | independent external provider | Auditor | §5.1 evidence package | no unresolved critical/high finding without accepted residual-risk; retest passed | Stage-7 committee / MD-CEO | **BLOCKER (production GO)** | test environment; hosting/infra decision (OQ #16); connector posture
- **dr_failover_failback_drill** | COO | CTO / Technology Lead *(proposed)* | Auditor / Risk & Compliance *(proposed)* | §5.2 evidence package | RTO/RPO within target; restore + failback + reconciliation pass | COO + Operations | **BLOCKER (production GO)** | real backup/restore executor binding (ADR-127); infra target (OQ #16)
- **load_and_chaos_at_scale** | CTO / Technology Lead *(proposed)* | CTO / Technology Lead *(proposed)* | Auditor / Risk & Compliance *(proposed)* | §5.3 evidence package | meets defined SLOs under load + chaos; bottlenecks remediated + retested | COO (operational acceptance) | **BLOCKER (production GO)** | SLO targets (OQ #13); infra target (OQ #16)
- **real_data_migration_execution** | COO | CTO / Technology Lead *(proposed)* | Head of Risk & Compliance *(proposed)* / Auditor | §5.4 evidence package | control totals reconcile; rollback rehearsed; Finance + Legal + business sign-off | MD-CEO / Stage-7 authority | **BLOCKER (production GO)** | approved source inventory (OQ #14 — **TBD**); CFO + Legal Officer sign-off

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

### 7.1 Entry gate (all must hold before the applicable Stage-7 activity begins)
- [x] Stage 6 formally closed on `main` (M30–M42 certified-on-branch; M42 closure recorded)
- [ ] Condition owners assigned **and PROPOSED roles ratified** (§1, §2)
- [ ] Test environment(s) identified (per activity)
- [ ] Required infrastructure/provider decisions resolved sufficiently for the applicable test (OQ #16, #10)
- [ ] Evidence templates approved (§5)
- [ ] Migration **source inventory identified** before migration work (OQ #14 — **TBD**)
- [ ] Finance/Legal migration sign-off authorities identified (CFO, Legal Officer — proposed; needs appointment)

### 7.2 Exit gate / production GO — **deny-by-default**
- Executing a test does **not** convert `CONDITIONAL_GO` to `GO`.
- Production GO requires the M42 governance model: all mandatory evidence present, all blocking findings and
  conditions closed/accepted through governed sign-off (requester ≠ certifier; independent human sign-off;
  AI/system/automation never certify), and an issued GO/CONDITIONAL-GO decision (ADR-012).
- Any unresolved BLOCKER condition ⇒ not GO.

---

## 8. Governance-schema gap (Step 8 finding)

The manifest status vocabulary contains **no status for approving an operational/hardening programme to commence**.
The only "approved" status is `approved_for_build`, which is **module-build-oriented** and — per the transition
instruction — must **not** be applied to an operational programme. No `approved_for_execution` or equivalent exists
anywhere in `manifests/*.yaml`.

**Therefore the Stage-7 `requires_review → (approved)` transition cannot be recorded without inventing a status.**
Rather than invent one, this is reported as a **governance-schema gap** for the Stage-7 governance authority to
resolve — likely via an ADR that introduces an explicit operational-programme approval status (e.g. distinct from
`approved_for_build`) and defines its entry criteria. Until that decision is made, Stage 7 stays `requires_review`.

---

## 9. Position

- Stage 6: **formally closed on main**; production readiness **`CONDITIONAL_GO`**.
- Stage 7: **governance scaffolding recorded; not yet approved to commence.**
- Stage 8 ("Phase 7 — Vertical business solutions"): `deferred`, must not begin.

Ratification of the proposed roles, resolution of OQ #14 (real migration sources) / OQ #16 / OQ #10 / OQ #4, and a
decision on the operational-programme approval status (§8) are the outstanding prerequisites.
