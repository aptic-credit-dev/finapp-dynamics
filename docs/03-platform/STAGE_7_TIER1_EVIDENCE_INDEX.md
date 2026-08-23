# Stage 7 — Tier-1 Evidence Index & Human-Action Closure Pack

> The single authoritative map of all Stage-7 **Tier-1** (engineering/AI, ADR-131, staging) evidence produced to
> date, plus exactly what management can do **now without any purchase**, and a definitive statement of the internal
> boundary. It **references canonical artifacts — it duplicates none**. It transitions no workstream, issues no GO,
> and certifies nothing (Tier-2 acceptance is human/external). Baseline: merged `main` `c29026c`.

---

## 1. Canonical Tier-1 evidence by workstream

### penetration_test (internal pre-assessment only — external test still required)
- `STAGE_7_TIER1_EVIDENCE.md` — internal automated security execution (SAST/dep+secret scan, dynamic DB/API lane).
- `STAGE_7_PENTEST_HANDOFF_AND_PREASSESSMENT.md`, `STAGE_7_PENTEST_HANDOFF.md`, `STAGE_7_PENTEST_READINESS.md` — RoE + pre-assessment.
- `STAGE_7_PENTEST_EXECUTION_PACK.md`, `STAGE_7_PENTEST_PROVIDER_BRIEF.md` — provider-ready packs (standalone brief sendable as-is).
- Live negative-authz matrix (401/403/403) in `STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md` + `STAGE_7_LOADCHAOS_MULTITENANT_EVIDENCE.md`.

### dr_failover_failback_drill (single-host proven; cross-host deferred)
- `STAGE_7_TIER1_DR_EVIDENCE.md` — DR executor + local drill (RTO/RPO local).
- `STAGE_7_LIVE_READINESS_VALIDATION.md` — real PG16 `pg_basebackup` + `pg_verifybackup` ("verified") + restore + WAL archiving.
- `STAGE_7_LOADCHAOS_MULTITENANT_EVIDENCE.md` §3 — API restart ~15.2 s + PG restart reconnect + post-chaos audit-chain `gapfree=true`.
- `STAGE_7_DR_PROVISIONING_READINESS.md` — measured primary → precise standby spec.
- Tooling: `deploy/dr/` (WAL/replication, pgBackRest→B2, standby-bootstrap, restore-pitr, failover, healthcheck).

### load_and_chaos_at_scale (pushed to the internal boundary)
- `STAGE_7_TIER1_LOADCHAOS_EVIDENCE.md`, `STAGE_7_CONTABO_FULLSTACK_EVIDENCE.md` — earlier load/chaos.
- `STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md` — authenticated DB-write load.
- `STAGE_7_CAPACITY_REMEDIATION.md` + `STAGE_7_CAPACITY_RETEST_EVIDENCE.md` + `STAGE_7_AUDIT_CHAIN_CONTENTION_ANALYSIS.md` — pool-knob + root-cause.
- `STAGE_7_LOADCHAOS_MULTITENANT_EVIDENCE.md` — **decisive**: platform-scoped writes serialize on ONE PLATFORM audit chain (multi-tenant does not relieve; reads meet SLO; audit control preserved).

### real_data_migration_execution (synthetic rehearsal only; entry gate unmet)
- `STAGE_7_TIER1_MIGRATION_EVIDENCE.md` — synthetic rehearsal + rollback + reconciliation.
- `STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md` — intake/acceptance checklists (OQ#14 source TBD).

### Secrets / OpenBao (adapter + live binding proven; permanent host deferred)
- `STAGE_7_VAULT_DECISION_PACKAGE.md`, `STAGE_7_OPENBAO_PRODUCTION_ARCHITECTURE.md`, `STAGE_7_M41_OPENBAO_ADAPTER_PLAN.md`.
- `STAGE_7_OPENBAO_LIVE_BINDING_EVIDENCE.md` — adapter proven vs real OpenBao 2.6.2 (fail-closed matrix + snapshot/restore).
- `STAGE_7_OPENBAO_CUSTODY_MODEL.md`; `deploy/openbao/` (compose, config, policy, `provision.sh`, `setup.sh`).

### Environment / commissioning / governance / decisions
- `STAGE_7_TIER1_STAGING_EVIDENCE.md`, `STAGE_7_CONTABO_DEPLOYMENT_RUNBOOK.md`, `STAGE_7_TIER1_COMPLETION_VERIFICATION.md`.
- `STAGE_7_PRODUCTION_COMMISSIONING_RUNBOOK.md`, `STAGE_7_PRODUCTION_COMMISSIONING_DEPENDENCY_MATRIX.md`.
- `STAGE_7_INFRA_PROVISIONING_SPEC.md`, `STAGE_7_PROCUREMENT_AND_ACTIVATION_PLAN.md`, `STAGE_7_MANAGEMENT_PURCHASE_SHEET.md`.
- `STAGE_7_OFFSERVER_BACKUP_DR_DECISION_PACKAGE.md`, `STAGE_7_OFFSERVER_DR_ARCHITECTURE_DECISION.md`.
- Governance: `STAGE_7_HARDENING_GOVERNANCE.md`, `STAGE_7_WORKSTREAM_STATUS_TRANSITION.md`, ADR-127/128/129/130/131/132.
- Tier-2 (human): `STAGE_7_TIER2_ACCEPTANCE_PACK.md`, `STAGE_7_TIER2_ACCEPTANCE_FORMS.md`, `STAGE_7_TIER2_READINESS.md`.

## 2. Host hardening executed this increment (safe, reversible)
- **Security updates applied** on the Contabo host: pending security packages **5 → 0**; services stayed healthy (api 200). `reboot-required=yes` → a reboot to activate kernel patches is a **commissioning-window** action (not done mid-session).
- **Restart policy hardened**: staging containers were `restart: no` (would NOT survive the pending reboot). Applied `--restart=unless-stopped` **live** to both containers and fixed `deploy/staging/docker-compose.yml` (`unless-stopped` + bounded json-file logging).
- **Verified OK (unchanged):** ufw active (only :22 public); api+db bound `127.0.0.1` only; PG loopback-only; no privileged containers; api runs as non-root `node`; docker daemon local-socket only (no TCP); `.env.staging` perms `600`; time synchronized; log rotation active.
- **Not changed (documented commissioning items, lockout/disruption risk):** SSH `PasswordAuthentication`/`PermitRootLogin` → key-only (key auth verified working; change belongs in the governed commissioning window with assured console rollback); the reboot to activate kernel updates.

## 3. Human actions possible NOW (no purchase, no external provider)
| Action | Owner | Blocked on? |
| --- | --- | --- |
| Review Tier-1 evidence (this index) + record independent assurance | Auditor | **nothing — can start now** |
| Review residual-risk posture (capacity single-chain ceiling, single-host DR, secrets deferred) | Head of Risk | nothing — now |
| Review load/chaos evidence + decide on the platform-write SLO position (accept / require remediation) | COO/Ops | nothing — now (numbers are staging, not acceptance-grade) |
| Name the **pilot tenant + source system** (OQ#14) | MD/Business | nothing — a business decision (no purchase) |
| Appoint **CFO / Legal / business-owner** migration signers | MD | nothing — now |
| Appoint the **independent pentest provider** (engagement/NDA — pre-purchase decision) | Risk/MD | nothing to decide now (execution needs the provider) |
| Approve the **SSH hardening + reboot** for the commissioning window | Ops/Tech | nothing — a decision + scheduled window |
| Approve **pilot scope/window** | MD/COO | nothing — now |

## 4. Blocker classification (definitive)
- **Human-only (no purchase, actionable now):** Auditor/Risk/COO evidence review; SLO position; pilot tenant/source **naming**; CFO/Legal/business **appointment**; pentest provider **appointment**; SSH-hardening + reboot **approval**; pilot scope/window.
- **External-supply only (purchase/provider):** 2nd Contabo standby VPS; Backblaze B2; dedicated OpenBao VPS; the independent pentest **execution**.
- **External + human:** cross-host DR drill (needs standby+B2) then **COO acceptance**; acceptance-grade SLO re-measure (needs dedicated prod host) then **COO acceptance**.
- **Real-data/source + human:** real-data migration (needs OQ#14 source) then **CFO+Legal+business** sign-off.

## 5. Workstream transition eligibility (repository criteria)
All four remain **`requires_review`**. Per ADR-130, a lifecycle transition is a **human governance act** (a governance PR merged by the authority), and each workstream's exit needs Tier-2 human/external acceptance. **No transition is objectively permitted on internal evidence alone** — Tier-1 completion ≠ Tier-2 acceptance. (An entry-status move `requires_review → approved_for_execution` for the near-ready workstreams is available to the governance authority but is theirs to make, not automation's.)

## 6. Final internal boundary (definitive)
Stage-7 internal engineering is **effectively exhausted**. Every remaining exit criterion is (a) an **external purchase/provider**, (b) a **human acceptance/decision**, or (c) **real data/source** — none is internal engineering. The one internal measurement that would still add value — **acceptance-grade, reproducible SLO numbers** — is blocked by shared-VPS variance and requires the **dedicated production host** (a purchase). **No further internal code/config engineering would add material value** beyond the safe hardening in §2. CONDITIONAL_GO unchanged; no GO; no Tier-2 self-certification; Stage 8 deferred.
