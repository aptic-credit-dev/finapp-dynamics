# Stage 7 — Management Decision & Acceptance Pack (no-cost, human-only)

> The single actionable pack of the **no-purchase, human-only** decisions Aptic management can take **now** to
> advance Stage-7, using only the existing canonical evidence. It contains **decision/sign-off forms + evidence
> references only** — it **duplicates no technical evidence** (see `STAGE_7_TIER1_EVIDENCE_INDEX.md` for the map of
> all 39 Stage-7 artifacts). **Claude/engineering signs nothing here, fabricates no approval, and issues no GO.**
> Completing any form below is a **human** act. Nothing in this pack transitions a workstream or issues a GO.
> Baseline: merged `main` `7bd0677`.

---

## 0. How to use this pack
Each decision states: **decision required · responsible role · evidence to review · exact sign-off wording · effect
of approval · what remains outstanding.** These decisions cost nothing and require no external supplier — they clear
the internal governance backlog so that, when infrastructure is later purchased, the project is not still waiting on
people.

## 1. COO / Operations decision (load/chaos evidence position) — NOT a production GO
- **Decision required:** the COO/Ops position on the current load/chaos evidence.
- **Evidence to review:** `STAGE_7_LOADCHAOS_MULTITENANT_EVIDENCE.md`, `STAGE_7_CAPACITY_RETEST_EVIDENCE.md`,
  `STAGE_7_AUDIT_CHAIN_CONTENTION_ANALYSIS.md`.
- **Facts (from the evidence, unaltered):** reads meet OQ#13 (`multi_tenant_read` p95 178 ms); **platform-scoped
  writes exceed p95 ≤ 200 ms** (394–637 ms) under high-concurrency bursts; cause = the **preserved PLATFORM
  audit hash-chain serialization** (one tamper-evident chain — a control, **not** recommended for weakening);
  **zero errors** observed; the numbers are **shared-host, not final acceptance-grade** production measurements.
- **Choose ONE (exact wording):**
  - ☐ **"COO/Ops ACCEPTS the current Tier-1 technical load/chaos evidence for PILOT PLANNING, subject to a final
    dedicated-production-host re-measurement against OQ#13 before the production GO. This is not a production GO."**
  - ☐ **"COO/Ops REQUIRES further remediation before pilot planning proceeds (specify)."**
- **Effect of approval (option 1):** pilot planning may proceed on the technical evidence; the load workstream's
  operational-acceptance path is provisionally open, still pending the final host re-measure + formal acceptance.
- **Remains outstanding:** acceptance-grade re-measure on the dedicated production host (needs that host — a
  purchase); formal COO operational acceptance of `load_and_chaos_at_scale` and (separately) DR.
- **Signer / role / date / signature:** ______

## 2. Head of Risk & Compliance decision (residual risk)
- **Decision required:** which residual Stage-7 risks are **accepted for continued pre-production/pilot
  preparation**, and which remain **release-blocking**.
- **Evidence to review:** `STAGE_7_TIER1_EVIDENCE_INDEX.md`; audit-chain trade-off (`…AUDIT_CHAIN_CONTENTION_ANALYSIS.md`);
  deferred-items posture (`…PROCUREMENT_AND_ACTIVATION_PLAN.md`, `…DR_PROVISIONING_READINESS.md`,
  `…OPENBAO_LIVE_BINDING_EVIDENCE.md`).
- **Risks to rule on:** (a) platform-write throughput ceiling (audit-chain serialization); (b) **deferred external
  pentest**; (c) **deferred cross-host DR**; (d) **deferred permanent OpenBao**; (e) current fail-closed controls;
  (f) **no real data loaded**.
- **Record (exact wording):** **"Head of Risk & Compliance records the residual risks ACCEPTED for continued
  pre-production/pilot preparation [list], and the risks that remain RELEASE-BLOCKING [list — must include the
  independent external pentest, cross-host DR acceptance, and any unremediated critical finding]. This does not mark
  any external control as completed."**
- **Effect:** a governed residual-risk register for pre-production; release-blocking items are explicit.
- **Remains outstanding:** the release-blocking items themselves (external pentest, cross-host DR, etc.).
- **Signer / role / date / signature:** ______

## 3. Auditor review (Tier-1 evidence assurance — scope-limited)
- **Decision required:** Auditor confirmation of Tier-1 evidence **completeness, traceability, and consistency**, and
  that `STAGE_7_TIER1_EVIDENCE_INDEX.md` **adequately maps** the Stage-7 Tier-1 work.
- **Evidence to review:** the evidence index + the canonical artifacts it references.
- **Confirm ONLY (exact wording):** **"The Auditor confirms the Stage-7 Tier-1 evidence is complete, traceable, and
  internally consistent, and that the canonical evidence index adequately maps it. The Auditor does NOT certify the
  external penetration test, cross-host DR, real-data migration, or the M42 production GO."**
- **Effect:** independent assurance over the **Tier-1 evidence body** (not over external controls).
- **Remains outstanding:** all Tier-2 external assurances.
- **Signer / role / date / signature:** ______

## 4. OQ#14 management decision (nominate the pilot migration case — structure only)
- **Decision required:** nominate the future pilot migration case's **ownership + scope** (no real credentials/data
  yet — this resolves the decision/ownership so engineering is ready when external execution resumes).
- **Evidence/context:** `STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md`, `STAGE_7_TIER1_MIGRATION_EVIDENCE.md`.
- **Record (fill in):** pilot **tenant / business unit** ____; **source system** ____; **business owner** ____;
  **Finance reconciliation owner (CFO delegate)** ____; **Legal/privacy reviewer** ____; **approx. record volumes**
  ____; **intended pilot window** ____.
- **Effect:** the migration entry-gate **ownership** (OQ#14) is resolved; the technical rehearsal mapping can be
  prepared once the source access is later provided.
- **Remains outstanding:** the actual source access/extract + real-data rehearsal (external/data — later); the
  sign-offs in §5.
- **Signer / role / date / signature:** ______

## 5. CFO / Legal / business-owner future sign-offs (migration rehearsal — templates)
> Reference: full role forms in `STAGE_7_TIER2_ACCEPTANCE_FORMS.md` (Forms 4/5/6). Restated here as the migration
> decision wording; **not to be signed until the rehearsal + reconciliation evidence exists.**
- **CFO:** **"CFO signs off that the migration control totals and reconciliation are financially correct."** —
  prerequisite: reconciliation report from the rehearsal.
- **Legal:** **"Legal confirms lawful data handling, data-residency, and authority for the migration."** —
  prerequisite: privacy/basis pack + confirmed region.
- **Business owner:** **"Business owner confirms operational completeness/fitness of the migrated pilot data."** —
  prerequisite: business-view reconciliation.
- **Remains outstanding:** the rehearsal + real-data migration (deferred).

## 6. Commissioning approval (authorise later execution — not evidence of execution)
- **Decision required:** management authorisation to execute the already-identified commissioning-window actions
  **when scheduled** (they are not executed now).
- **Evidence/context:** `STAGE_7_PRODUCTION_COMMISSIONING_RUNBOOK.md`, `STAGE_7_LOADCHAOS_MULTITENANT_EVIDENCE.md` §4
  (host review), `STAGE_7_TIER1_EVIDENCE_INDEX.md` §2 (hardening).
- **Approve (exact wording):** **"Management authorises the commissioning-window execution of: (1) a controlled
  reboot to activate the applied security updates; (2) SSH key-only hardening (disable password auth, restrict root
  login) with confirmed console/rollback access first; (3) post-reboot application + PostgreSQL 16 validation. This
  authorises later execution; it is not evidence that execution occurred."**
- **Effect:** engineering may perform these during the governed window (with rollback access assured first).
- **Remains outstanding:** the actual scheduled execution + its evidence.
- **Signer / role / date / signature:** ______

## 7. Lifecycle-movement analysis (ADR-130 — human governance act; automation performs none)
A workstream item moves `requires_review → approved_for_execution` only by a **human governance-authority decision**
(a governance PR merged by the MD/CEO or delegated Stage-7 committee), and **only** if its charter §7.2 entry gate is
met. `approved_for_execution` **authorises commencement, not completion** (exit/closure needs Tier-2 acceptance,
which is deferred). On the repository's own criteria, **without any purchase**:

| Workstream | Entry gate (charter §7.2) | Human move possible now (no purchase)? |
| --- | --- | --- |
| `load_and_chaos_at_scale` | env (Contabo) + SLO targets (OQ#13) + evidence template — **met** | **Yes** — the authority may move `requires_review → approved_for_execution` (Tier-1 already produced under ADR-131). Prereq: a governance PR by the authority. |
| `penetration_test` | test env exists + RoE authored; provider engagement pending | **Partially** — entry-status move is defensible (authorises commencement); actual test still needs the external provider. Authority's call. |
| `dr_failover_failback_drill` | off-server destination **not** yet approved/available (external) | **No** — entry gate not fully met (needs the standby/off-server = purchase). |
| `real_data_migration_execution` | OQ#14 source **TBD** | **No** — entry gate unmet; §4 nomination resolves ownership but not the source access. |

**Exact authority + transition (if the authority elects):** MD/CEO or delegated Stage-7 governance committee, via a
governance-only PR, may set `load_and_chaos_at_scale` (and, at its discretion, `penetration_test`)
`requires_review → approved_for_execution`. **Prerequisites:** the §1–§3 human reviews recorded; the governance PR
authored + merged by the authority. **Automation (Claude) performs no transition and fabricates no approval** —
this analysis only identifies what the human authority may do.

## 8. What remains outstanding after all of the above (still deferred — external)
2nd Contabo standby VPS; Backblaze B2; dedicated OpenBao VPS; **independent external pentest execution**; cross-host
DR drill + acceptance-grade SLO re-measure (need the hosts); real-data migration (needs OQ#14 source access). These
are **preserved as outstanding, not waived.** CONDITIONAL_GO unchanged; no GO; Stage 8 deferred.
