# Production-Exit GO-Gate Register

> Live register of the mandatory gates between the staging-verified build and a production GO, reconciled against
> ADR-129/130/131/132/133, the M42 decision engine, and the Stage-7 governance/evidence packs. **No internal test
> marks a gate that requires independent/human acceptance as complete.** M42 is currently **deny-by-default NO_GO**
> (recorded platform posture `CONDITIONAL_GO`); this register does not change it.

## 0. Governing rules (quoted authority)

- **Production GO is deny-by-default and DERIVED only by the M42 human decision** (ADR-129/012;
  `ARCHITECTURE_DECISION_REGISTER.md:1053`). "**Executing an activity is NEVER, by itself, a production GO**"
  (ADR-130, `:1070`). "**AI/system/automation NEVER approve a progression, execute a hardening activity, or certify
  a Stage-7 condition**" (ADR-130, `:1066`).
- **Two-tier (ADR-131, `:1074-1095`):** Tier-1 automated execution produces bounded *evidence* only; **"Tier-1 NEVER
  satisfies the Stage-7 condition or production GO on its own; the condition and GO require Tier-2"** (independent/
  human acceptance). Automation may not "fabricate external independence" or "issue GO or CONDITIONAL_GO".
- **Four core gates are RELEASE-BLOCKING and NOT waivable (ADR-133, `:1128`):** external pentest, cross-host DR,
  permanent OpenBao infrastructure, real-data migration — "not satisfied or waived" by any internal evidence.
- **Risk-acceptance vehicle:** the M42 human decision may issue **CONDITIONAL_GO** with bounded, owned, time-bound
  residual conditions + a Head-of-Risk residual-risk register — **but not covering the four release-blocking gates**.
- **A controlled pilot** (Commissioning Runbook Phase 13) is only reachable **after** the M42 human decision
  (Phase 12 = "point of no return") — there is **no** documented path to a pilot on Tier-1 evidence alone.

## 1. Gate register

Legend: **PASS / FAIL / BLOCKED / REQUIRES_HUMAN_ACCEPTANCE**. "Exec now" = executable now by engineer/automation.
"Human accept mandatory" = Tier-2/independent acceptance required. "Risk-accept permitted" = governance allows
signed risk acceptance instead of full proof.

### G1 — Independent penetration test
- **Requirement:** ADR-131 `:1081` — independent EXTERNAL pentest cleared (no release-blocking finding) + Auditor assurance.
- **Evidence:** Tier-1 internal SAST/DAST/dep+secret scan complete, 0 prod vulns (`STAGE_7_TIER1_COMPLETION_VERIFICATION.md:36`); provider brief/RoE authored (`STAGE_7_PENTEST_*`). **No external provider engaged.**
- **Status: BLOCKED.** Owner: Head of Risk & Compliance (accountable), external provider (executor), Auditor (assurance). Missing: engage provider, test staging, clear+retest. Exec now: **No**. Human accept mandatory: **Yes**. Risk-accept permitted: **No** (release-blocking, ADR-133). Proof: independent report + retest + Auditor attestation → opaque refs into M42.

### G2 — Cross-host disaster-recovery drill
- **Requirement:** ADR-131 `:1082` — independent DR assurance + COO/Ops acceptance; RTO/RPO within target; restore+failback+reconcile.
- **Evidence:** Tier-1 **single-host** drill PASS (RTO 125 ms/RPO 0 s local; `STAGE_7_TIER1_DR_EVIDENCE.md`); DR tooling validated vs real staging PG16. **No 2nd host / off-server target.**
- **Status: BLOCKED.** Owner: COO (accept), CTO (execute), Auditor/Risk (assure). Missing: 2nd VPS (different DC) + Backblaze B2, streaming replication, real-stack failover/failback. Exec now: **No** (needs standby+B2). Human accept mandatory: **Yes**. Risk-accept permitted: **No** (release-blocking). Proof: DR evidence pack → M42.

### G3 — Acceptance-grade load & chaos test
- **Requirement:** ADR-131 `:1083` — operational acceptance (COO) + approved SLOs (OQ#13: p95≤200ms/p99≤500ms/err≤0.5%).
- **Evidence:** SLOs **APPROVED** (manifest `:3059`); Tier-1 authenticated multi-tenant load/chaos on shared staging (`STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md`). Finding: reads meet SLOs; a 32-conc write-burst exceeds p95 due to the m03 audit hash-chain advisory-lock serialisation (a correctness control — **not** to be weakened). Shared-VPS numbers **not acceptance-grade**.
- **Status: REQUIRES_HUMAN_ACCEPTANCE** (+ partial BLOCKED). Owner: CTO (execute), COO (accept). Missing: dedicated-host acceptance-grade re-measure; capacity/audit-scope decision. Exec now: **Partial**. Human accept mandatory: **Yes**. Risk-accept permitted: **Planning-only** (ADR-133 accepted Tier-1 for pilot *planning*, "subject to a final acceptance-grade re-measurement on the dedicated production host before the production GO"). Proof: load/chaos pack + COO acceptance → M42.

### G4 — Real-data migration rehearsal / execution
- **Requirement:** ADR-131 `:1084` — real-data migration with CFO + Legal sign-off (OQ#14); control totals reconcile; rollback rehearsed. Manifest `requires: [finance_signoff, legal_signoff]`.
- **Evidence:** Tier-1 **synthetic** rehearsal+rollback complete, bigint-exact, reconciled (`STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md`). **Real first-tenant source undetermined (OQ#14).**
- **Status: BLOCKED** + REQUIRES_HUMAN_ACCEPTANCE. Owner: COO (accountable), CTO (technical), CFO (finance), Legal Officer (legal), MD/CEO (final). Independence: CFO ≠ migration executor (ADR-130 `:1068`). Missing: name pilot tenant+source, rehearse on non-prod copy, reconcile, sign. Exec now: **No**. Human accept mandatory: **Yes**. Risk-accept permitted: **No** (release-blocking). Proof: migration pack + CFO/Legal/business sign-offs → M42.

### G5 — Production secrets / key custody (OpenBao, ADR-128/132)
- **Requirement:** ADR-132 `:1097-1117` — approved product OpenBao; production binding gated on the M42 GO; zero secret-value columns.
- **Evidence:** Adapter implemented+unit-tested (`packages/m41-security/src/providers/openbao.ts`); **live binding validated** against real OpenBao 2.6.2 (Raft+TLS) co-located on staging then torn down — full fail-closed matrix + snapshot/restore PASS (`STAGE_7_OPENBAO_LIVE_BINDING_EVIDENCE.md`). **No dedicated production OpenBao host/credentials.** M41 default = fail-closed `UnavailableSecretProvider`.
- **Status: BLOCKED.** Owner: Eng (deploy/adapter), custody = Platform-Security + COO/Ops + Risk (Shamir 5/3), binding acceptance = M42 GO. Missing: provision dedicated OpenBao host, deliver URL/CA/AppRole out-of-band, bind at commissioning. Exec now: **Yes once host+creds exist** (automation ready). Human accept mandatory: **Yes** (via M42 GO). Risk-accept permitted: **No** (release-blocking). Proof: live-binding evidence + zero-secret-value re-check → M42.

### G6 — Production infrastructure + DNS/TLS
- **Requirement:** Commissioning Runbook Phase 3/6 — clean prod host separate from staging; DNS pointed; production TLS; reverse proxy on 443; `NODE_ENV=production` guards; Kenya-DPA-acceptable region confirmed (OQ#16 precondition).
- **Evidence:** Contabo hosting decision APPROVED (separate staging+prod); PG16 stack proven on staging; loopback-only bindings + SSH lockdown demonstrated. **Clean prod host, DNS, public TLS, region ruling outstanding.**
- **Status: BLOCKED.** Owner: Eng (provision), COO/Ops (env-readiness accept), Technology/Risk/Legal (region ruling). Exec now: **Yes** for provisioning mechanics; region is a human/legal decision. Human accept mandatory: **Yes**. Risk-accept permitted: **Region — No** (hard precondition before real data). Proof: commissioning Phase 3/6/7 evidence + COO/Ops sign-off.

### G7 — Monitoring / alerting / incident response
- **Requirement:** Commissioning Runbook Phase 9 — centralized logs/metrics/traces + alerting (SLO burn, backup failure, replication lag, auth anomalies) wired and firing test alerts; incident/rollback runbook.
- **Evidence:** Explicitly a **pre-production follow-up** (`STAGE_7_CONTABO_FULLSTACK_EVIDENCE.md:123`). **No wired monitoring/alerting evidence; no incident-response runbook exists.**
- **Status: FAIL / gap.** Owner: COO/Ops (accept), Eng (wire). Missing: stand up observability + alerts on prod host; author incident-response runbook. Exec now: **Yes** (authorable/wireable once prod host exists). Human accept mandatory: **Yes** (COO/Ops). Risk-accept permitted: operational item, no named waiver. Proof: Phase 9 test-alert evidence + IR runbook accepted by COO/Ops. **(Genuine repo gap.)**

### G8 — Backup / restore / rollback
- **Requirement:** Commissioning Runbook Phase 8 — WAL archiving (`archive_timeout≤60s`) + standby and/or immutable object-store push (write-only creds); restore-verify. Off-server immutable copy (Backblaze B2 WORM).
- **Evidence:** Single-host backup/restore/WAL/checksum tooling validated vs real staging PG16 (pg_basebackup + pg_verifybackup PASS); migration rollback rehearsed. **Off-server destination (B2) not purchased → off-server push BLOCKED**; on-host `pg_dump` gives ~24h RPO.
- **Status: BLOCKED.** Owner: Eng (wire), COO/Ops (accept). Missing: purchase B2 (write-only key) + region, wire WAL archive + immutable push + standby, restore-verify. Exec now: **Yes once B2+key exist**. Human accept mandatory: **Yes**. Risk-accept permitted: **No** (part of release-blocking DR). Proof: off-server restore-verify + DR pack → M42.

### G9 — Data protection / privacy / legal approval
- **Requirement:** Kenya-DPA region confirmed; legal basis/residency approved; Legal Officer sign-off independent of technical execution (ADR-130 `:1068`).
- **Evidence:** Platform privacy design proven (opaque subject refs, no PII columns). **Legal appointee TBD; DPA region ruling pending (OQ#6/#7).**
- **Status: BLOCKED + REQUIRES_HUMAN_ACCEPTANCE.** Owner: Legal Officer; Technology/Risk/Legal (region). Exec now: **No** (legal decision). Human accept mandatory: **Yes**. Risk-accept permitted: **No** (hard precondition). Proof: Legal sign-off form + region ruling → M42.

### G10 — Business-owner module acceptance
- **Requirement:** Business owner reviews migrated pilot data + reconciliation and signs.
- **Evidence:** Stage-8 functional UAT 6/6 PASS at freeze (functionality acceptance, **not** production/pilot-data acceptance). Production business sign-off pending; depends on G4.
- **Status: REQUIRES_HUMAN_ACCEPTANCE** (blocked behind G4). Owner: business owner (pilot tenant). Exec now: **No**. Human accept mandatory: **Yes**. Risk-accept permitted: tied to release-blocking G4. Proof: business sign-off form → M42.

### G11 — Support roster / operational handover
- **Requirement:** Support model & SLOs (OQ#13) — on-call roster + operational handover.
- **Evidence:** SLO *targets* approved; **no support-roster / on-call / operational-handover artefact exists.**
- **Status: FAIL / gap.** Owner: COO/Ops. Missing: author support/on-call roster + handover runbook; COO/Ops accept. Exec now: **Yes** (authorable now). Human accept mandatory: **Yes** (COO/Ops). Risk-accept permitted: operational item, no named waiver. Proof: roster+handover accepted by COO/Ops. **(Genuine repo gap.)**

### G12 — M42 human production decision
- **Requirement:** Production GO deny-by-default, DERIVED by `evaluateCertificationDecision`, issued only by a human with `platform_certification.control.administer`; never by AI/automation.
- **Evidence:** Engine certified-on-branch, deny-by-default proven; **no production GO issued; posture CONDITIONAL_GO; effective NO_GO.**
- **Status: BLOCKED** (requires G1–G11 closed/accepted) → then REQUIRES_HUMAN_ACCEPTANCE. Owner: MD/CEO or delegated Stage-7 governance authority. Exec now: **No** (never AI). Human accept mandatory: **Yes** (this is the terminal act). Risk-accept permitted: **Yes — this is the CONDITIONAL_GO mechanism** (bounded residual conditions only; not the four release-blocking gates). Proof: immutable `certification_decision` + `certification_closure`.

## 2. Summary

| # | Gate | Status | Exec now | Human accept mandatory | Risk-accept permitted | Owner |
|---|------|--------|----------|------------------------|-----------------------|-------|
| G1 | Independent pentest | BLOCKED | No | Yes | No | Risk/Compliance · Auditor · MD/CEO |
| G2 | Cross-host DR | BLOCKED | No | Yes | No | COO + Ops |
| G3 | Load & chaos (acceptance-grade) | REQUIRES_HUMAN_ACCEPTANCE | Partial | Yes | Planning-only | COO |
| G4 | Real-data migration | BLOCKED | No | Yes | No | CFO + Legal + business; MD/CEO |
| G5 | Secrets/key custody (OpenBao) | BLOCKED | Yes (once host+creds) | Yes | No | Mgmt via M42 GO |
| G6 | Prod infra + DNS/TLS | BLOCKED | Yes (mechanics) | Yes | Region: No | COO/Ops; Legal/Risk |
| G7 | Monitoring/alerting/IR | FAIL/gap | Yes | Yes | operational | COO/Ops |
| G8 | Backup/restore/rollback | BLOCKED | Yes (once B2 key) | Yes | No | COO/Ops |
| G9 | Data protection/legal | BLOCKED / REQUIRES_HUMAN | No | Yes | No | Legal Officer |
| G10 | Business-owner acceptance | REQUIRES_HUMAN_ACCEPTANCE | No | Yes | No | Business owner |
| G11 | Support roster/handover | FAIL/gap | Yes | Yes | operational | COO/Ops |
| G12 | M42 human decision | BLOCKED (deny-by-default NO_GO) | No (never AI) | Yes | Yes (CONDITIONAL_GO vehicle) | MD/CEO / Stage-7 authority |

**Genuine repository gaps (authorable now, no external dependency):** G7 incident-response runbook + wired
monitoring; G11 support-roster/operational-handover. Every other open gate is blocked on an external purchase,
external engagement, a named data source, or a human sign-off — not on missing engineering.

**Net:** 0 of 12 gates are PASS today. 4 are non-waivable release blockers (G1/G2/G4 + the OpenBao part of G5).
The formal M42 decision is **NO_GO** and can only be changed by the authorised human governance body.
