# M42 Production Decision Pack

> **This pack does not decide anything.** It assembles evidence for the authorised human governance body to record an
> M42 production decision. Until an authorised signatory signs below, the formal M42 status **remains `NO_GO`**
> (deny-by-default; the verdict is DERIVED by `evaluateCertificationDecision` and can never be caller-set). AI/system/
> automation never issue or infer this decision. **Technical recommendation ≠ formal production authorization.**

## 1. Candidate under decision
- Source build: `main` @ `75660d8189c74e6bbe2063043d2fbae7924a5f2d` (D-M21-3 fix included; staging-verified).
- Day-1 scope: `PRODUCTION_DAY1_MODULE_SCOPE.md`. Gate status: `PRODUCTION_EXIT_GATE_REGISTER.md`. Infra:
  `PRODUCTION_INFRASTRUCTURE_READINESS.md`. Plan: `FOUR_DAY_PRODUCTION_CUTOVER_PLAN.md`. Runbook:
  `PRODUCTION_CUTOVER_RUNBOOK.md`.

## 2. Current formal status (unchanged by this pack)
**M42 = `NO_GO` (deny-by-default).** Recorded platform posture = `CONDITIONAL_GO` pending Stage-7 live-infra
hardening. **0 of 12** production-exit gates are PASS today; four are non-waivable release blockers.

## 3. Technical recommendation (advisory only)
The **software build is technically deployable** (all internal lanes green — see the readiness report). The Day-1
module scope is enforceable via existing RBAC/entitlements with fail-closed proof. **However, the mandatory
Stage-7/M42 gates are not satisfied**, so the technical recommendation is: **do not issue EFFECTIVE/GO now.** The
only governance-valid near-term outcomes are **CONDITIONAL_GO** (if and only if governance's conditions are met and
the four release blockers are genuinely discharged + independently accepted) or **NO_GO**.

## 4. The only three permitted outcomes

### Outcome A — EFFECTIVE / GO
Permitted **only** when **all** mandatory gates G1–G12 are PASS/accepted and the authorised signatories approve.
Not available today (gates open).

### Outcome B — CONTROLLED PILOT / CONDITIONAL_GO
Governance (ADR-129) permits the M42 human decision to issue **CONDITIONAL_GO** with bounded, owned, time-bound
residual conditions plus a Head-of-Risk residual-risk register. **Hard limits (ADR-133):** the four release-blocking
gates — **G1 independent pentest, G2 cross-host DR, G4 real-data migration, G5 production OpenBao** — **cannot** be
carried as residual conditions or waived; they must be genuinely discharged first. A controlled pilot (Commissioning
Runbook Phase 13) is reachable **only after** this decision is issued. If chosen, this outcome must specify:
- named pilot users / tenant; accepted modules only (per the Day-1 scope); incomplete modules disabled;
- transaction/data limits; monitoring + rollback triggers; expiry/review date;
- residual-risk acceptance signed by the authorised humans (below).

### Outcome C — NO_GO
Any mandatory non-waivable gate remains unmet. **This is the current state.**

## 5. Gate evidence summary (detail in the gate register)
G1 pentest BLOCKED (external) · G2 cross-host DR BLOCKED (external) · G3 load/chaos REQUIRES_HUMAN_ACCEPTANCE ·
G4 real-data migration BLOCKED (external) · G5 OpenBao BLOCKED (external host) · G6 infra+DNS/TLS BLOCKED ·
G7 monitoring/IR FAIL-gap · G8 backup/restore BLOCKED (off-server) · G9 legal/DPA BLOCKED · G10 business acceptance
REQUIRES_HUMAN_ACCEPTANCE · G11 support roster FAIL-gap · G12 M42 human decision BLOCKED (deny-by-default).

## 6. Decision record (to be completed by authorised humans — do not pre-fill)

**Selected outcome (circle one):**  ☐ A EFFECTIVE/GO   ☐ B CONTROLLED PILOT/CONDITIONAL_GO   ☐ C NO_GO

If Outcome B, residual conditions (bounded, owned, time-bound) and expiry: ______________________________

| Role | Name | Authorises | Signature | Date (UTC) |
|---|---|---|---|---|
| MD / CEO (or delegated Stage-7 governance authority) | | Issues the M42 governed production decision | | |
| COO / Operations | | DR, load/chaos, backup, monitoring, support operational acceptance | | |
| CTO / Technology owner | | Technical execution & readiness attestation | | |
| Head of Risk & Compliance | | Pentest accountable; residual-risk register acceptance | | |
| Auditor (independent) | | Independent assurance | | |
| Data Protection / Legal Officer | | DPA / legal basis / residency approval | | |
| CFO | | Real-data migration finance sign-off | | |
| Business owner(s) | | Migrated pilot-data / module acceptance | | |

**Distinction:** a technical recommendation in §3 is advisory; **production authorization exists only once the MD/CEO
(or delegated authority) records the decision above and the M42 engine has been run by that human.** No signature is
inferred from testing, staging evidence, or this document.

## 7. Governance
This pack changes nothing. M42 remains `NO_GO` until signed. Stage-7 G1–G4 unchanged. No production deployment
occurs on the basis of this document.
