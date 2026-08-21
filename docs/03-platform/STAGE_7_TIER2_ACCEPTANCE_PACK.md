# Stage 7 — Tier-2 Acceptance Pack (single bounded acceptance index)

> One consolidated index of **what each human/external role must review and sign**, and — equally important —
> **what they are NOT being asked to certify**. It is a routing document over the existing evidence, not new
> evidence. **Claude/engineering signs nothing here and simulates no approval** (ADR-131). Roles and authorities
> are per the charter (`STAGE_7_HARDENING_GOVERNANCE.md` §1–§3) and ADR-130. Nothing in this pack transitions a
> workstream or issues a GO.

---

## 1. The rule that governs every row

Per ADR-131 and the charter: **Tier-1 automated execution (engineering/AI, staging) NEVER satisfies a Stage-7
condition or the production GO.** Each condition also requires **Tier-2 independent human/external acceptance**.
Execution, independent assurance, and acceptance are held by **distinct** roles (no self-certification;
requester ≠ certifier). A signature below attests only to that role's named scope — not to the whole programme.

## 2. Acceptance index

| Role | Reviews (evidence) | Signs / attests | Explicitly NOT asked to certify |
| --- | --- | --- | --- |
| **External pentest provider** (independent, under NDA + CoI) | `STAGE_7_PENTEST_HANDOFF.md` RoE; live staging (Contabo, synthetic, PG16, ≥2 tenants) | Independent pentest report; each finding CVSS-scored; **retest pass/fail** per remediation | Business acceptance, GO, or any internal test as a substitute for their own |
| **Auditor** (read-only assurance) | All Stage-7 evidence + pentest report + this pack | Independent assurance attestation; environment-readiness (with Risk); challenge of evidence integrity | Approving/executing any control; operational or finance acceptance; GO |
| **Head of Risk & Compliance** | Pentest outcome; residual-risk register; DR/load/migration assurance | Accountability for `penetration_test`; residual-risk acceptance; environment-readiness (with Auditor) | Executing the pentest; operational acceptance (COO's); finance/legal sign-off; GO |
| **COO + Operations** | `STAGE_7_TIER1_DR_EVIDENCE.md`; `STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md` + `STAGE_7_CAPACITY_REMEDIATION.md` (incl. the 32-conc write-burst signal + remediation) | **DR** operational acceptance (RTO≤15/RPO≤5); **load/chaos** operational acceptance vs OQ#13 SLOs | Security sign-off; finance/legal sign-off; the M42 GO itself (MD/CEO) |
| **CFO** (maker-checker; cannot self-approve) | Migration control totals + reconciliation report (`STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md` B) | **Finance sign-off** on the real-data migration reconciliation | Technical/security/DR acceptance; legal basis; GO |
| **Legal Officer** | Migration privacy/legal basis (Kenya DPA; OQ#6/#7); data-residency/region | **Legal sign-off** on the migration | Technical/finance/operational acceptance; GO |
| **Business owner** (pilot tenant) | Migrated data + reconciliation from the business view | **Business-owner sign-off** on migration data | Security/finance/legal/technical certification; GO |
| **MD / CEO** (or authorised Stage-7 authority) | The complete evidence + all sign-offs above + M42 decision preview | **Final programme acceptance**; authorises/issues the **M42 governed GO** | The individual technical/assurance attestations (held by the roles above) |

## 3. Per-workstream Tier-2 acceptance (what "done" means)

- **`penetration_test`** → independent external pentest + Auditor assurance; no open critical/BLOCKER; retest
  passed. Owner accountable: Head of Risk & Compliance. Sign-off: Stage-7 committee / MD-CEO.
- **`dr_failover_failback_drill`** → DR drill on the real PG16 stack within RTO≤15/RPO≤5; restore + failback +
  reconciliation pass; **COO + Operations** acceptance.
- **`load_and_chaos_at_scale`** → meets OQ#13 SLOs under load + chaos; bottlenecks remediated + retested (the
  write-burst signal decided); **COO** operational acceptance.
- **`real_data_migration_execution`** → approved source inventory (OQ#14); control totals reconcile; rollback
  rehearsed; **CFO + Legal + business-owner** sign-off; final acceptance MD-CEO / Stage-7 authority.

## 4. Then, and only then: the M42 governed GO

All four accepted → evidence + sign-offs assembled → a **human** issuer with
`platform_certification.control.administer` runs M42. The verdict is **DERIVED** by the decision engine (GO /
CONDITIONAL_GO / NO_GO); no caller can set it; AI/system/automation can never certify or issue it (ADR-012/129/130).

## 5. Boundary statement (non-negotiable)

Claude/engineering has produced the **evidence and this index only**. It does not sign, cannot sign, and simulates
no signature. Every attestation above is a human/external act. No workstream is transitioned by this pack; the
production readiness stays **CONDITIONAL_GO**; Stage 8 stays deferred.
