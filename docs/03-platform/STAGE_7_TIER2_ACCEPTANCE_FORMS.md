# Stage 7 — Tier-2 Acceptance Forms (human/external sign-off templates)

> Blank acceptance forms for the independent human/external roles. Each states what the role reviews, what it
> attests, and — explicitly — what it is **NOT** certifying. **Claude/engineering does not, and cannot, sign any of
> these** (ADR-130/131); they are completed by the named humans. Nothing here transitions a workstream or issues a
> GO. Authorities per the charter (`STAGE_7_HARDENING_GOVERNANCE.md`) and ADR-130.

Common fields on every form: **Signer name · Role · Date · Decision {ACCEPT / REJECT / ACCEPT-WITH-CONDITIONS} ·
Conditions · Evidence references reviewed · Signature.**

---

## Form 1 — Auditor (independent assurance)
- **Reviews:** all Stage-7 evidence + the external pentest report + the acceptance pack.
- **Attests:** independent assurance over evidence integrity; environment-readiness (jointly with Risk).
- **NOT certifying:** approval/execution of any control; operational or finance acceptance; the GO.
- Decision ___ · Conditions ___ · Evidence refs ___ · Name/Date/Signature ___

## Form 2 — Head of Risk & Compliance
- **Reviews:** pentest outcome; residual-risk register; DR/load/migration assurance.
- **Attests:** accountability for `penetration_test`; residual-risk acceptance; environment-readiness (with Auditor).
- **NOT certifying:** executing the pentest; operational acceptance (COO's); finance/legal sign-off; the GO.
- Decision ___ · Conditions ___ · Evidence refs ___ · Name/Date/Signature ___

## Form 3 — COO / Operations
- **Reviews:** `STAGE_7_TIER1_DR_EVIDENCE.md` + the real-stack DR drill; `STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md` +
  `STAGE_7_CAPACITY_RETEST_EVIDENCE.md` (incl. the audit-chain finding) re-measured on the production host.
- **Attests:** **DR** operational acceptance (RTO ≤ 15 / RPO ≤ 5, measured); **load/chaos** operational acceptance vs
  OQ#13 SLOs.
- **NOT certifying:** security sign-off; finance/legal sign-off; the M42 GO itself.
- Decision ___ · Conditions ___ · Evidence refs ___ · Name/Date/Signature ___

## Form 4 — CFO (maker-checker; cannot self-approve)
- **Reviews:** migration control totals + reconciliation report (`STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md`).
- **Attests:** **Finance sign-off** on the real-data migration reconciliation.
- **NOT certifying:** technical/security/DR acceptance; legal basis; the GO.
- Decision ___ · Conditions ___ · Evidence refs ___ · Name/Date/Signature ___

## Form 5 — Legal Officer
- **Reviews:** migration privacy/legal basis (Kenya DPA; OQ#6/#7); data-residency/region for OpenBao + standby + B2.
- **Attests:** **Legal sign-off** on the migration and data residency.
- **NOT certifying:** technical/finance/operational acceptance; the GO.
- Decision ___ · Conditions ___ · Evidence refs ___ · Name/Date/Signature ___

## Form 6 — Business Owner (pilot tenant)
- **Reviews:** migrated data + reconciliation from the business view.
- **Attests:** **Business-owner sign-off** that the migrated pilot data is correct.
- **NOT certifying:** security/finance/legal/technical certification; the GO.
- Decision ___ · Conditions ___ · Evidence refs ___ · Name/Date/Signature ___

## Form 7 — MD / CEO (or authorised Stage-7 authority)
- **Reviews:** the complete evidence + all sign-offs above + the M42 decision preview.
- **Attests:** **final programme acceptance**; authorises the **M42 governed GO** to be issued.
- **NOT certifying:** the individual technical/assurance attestations (held by the roles above).
- Decision ___ · Conditions ___ · Evidence refs ___ · Name/Date/Signature ___

---

## Rule (non-negotiable)
Execution, independent assurance, and acceptance are held by **distinct** roles (requester ≠ certifier; no
self-certification). The **M42 GO is DERIVED** by the decision engine only after all mandatory sign-offs exist; no
caller sets it and **AI/system/automation can never sign or issue it** (ADR-012/129/130/131). These forms are
templates only — completing them is a human act.
