# Stage 7 — Production Commissioning Dependency Matrix (the one critical path)

> One definitive matrix of every requirement between merged `main` (`00909cb`) and the **M42 governed production
> GO**, with the single technical owner, the human/external acceptance owner, current state, evidence, and the exact
> next action. Its purpose is to collapse the remaining work into **one critical path**, not to add another readiness
> narrative. **Claude/engineering signs nothing here and issues no GO** (ADR-131/132). Statuses are
> repository-authoritative; nothing is transitioned by this document.

---

## 1. Legend

- **Blocking Production?** — is this on the path to the M42 GO? (Yes = must be closed/accepted first.)
- **Technical Owner** — who does the engineering (Claude/eng under ADR-131, staging only).
- **Human/External Owner** — who independently accepts/signs (Tier-2; never Claude).

## 2. Matrix

| # | Requirement | Current State | Technical Owner | Human/External Owner | Evidence | Blocking Prod? | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **PG16 stack** | ✅ Running on Contabo staging (16.15), merged `main`, 82 migrations, healthy | Eng | COO/Ops (env readiness) | `STAGE_7_CONTABO_FULLSTACK_EVIDENCE.md`, `…CAPACITY_RETEST_EVIDENCE.md` | Yes (met in staging) | Re-provision as **clean production** (commissioning runbook) |
| 2 | **OpenBao product decision** | ✅ Selected = OpenBao | — | **Management** (owner merge = decision) | **ADR-132** | Yes | Merge this PR = ratify; then provision a staging instance |
| 3 | **OpenBao staging instance** | ❌ Not deployed (no instance/creds) | Eng (deploy) | — | `…OPENBAO_PRODUCTION_ARCHITECTURE.md` | Yes | **Purchase/provision** host + deliver URL/CA/AppRole out-of-band |
| 4 | **M41 `SecretProviderPort` → OpenBao adapter** | ⏸ Specified, **not implemented** (blocked on #3) | Eng (ADR-131, staging) | — | `…M41_OPENBAO_ADAPTER_PLAN.md` | Yes | Implement + test in staging **once #3 exists**; prove fail-closed→available + zero-secret-value |
| 5 | **Off-server backup (immutable PITR)** | ❌ On-host `pg_dump` only; off-server BLOCKED | Eng (wire WAL/pgBackRest) | COO/Ops | `…OFFSERVER_DR_ARCHITECTURE_DECISION.md` | Yes | **Purchase** Backblaze B2 (write-only key) + confirm DPA region; then wire WAL archive + immutable push |
| 6 | **Warm standby (RTO)** | ❌ Not provisioned (single primary) | Eng (replication) | COO/Ops | same as #5 | Yes | **Purchase** 2nd Contabo VPS in a different DC/region; set up streaming replication |
| 7 | **RTO ≤ 15 / RPO ≤ 5 targets** | ✅ Approved (OQ#13, 2026-08-17) | — | COO/Ops (approved) | manifest `tier2_management_decisions_2026_08_17` | Yes | Prove by DR drill on real stack (#8) |
| 8 | **DR failover/failback drill (real PG16)** | ⏳ Framework + local drill done; real-stack + off-server pending #5/#6 | Eng (ADR-131 staging) | Independent DR assurance + **COO/Ops** | `STAGE_7_TIER1_DR_EVIDENCE.md` | Yes | Run drill on standby + off-server; measure RTO/RPO; COO accepts |
| 9 | **Load / SLO (incl. write-burst)** | ⚠️ Retest done; **pool hypothesis disproven**; burst breach = **audit-chain advisory-lock contention**, not pool; VPS variance | Eng (measure) | **COO/Ops** (SLO acceptance) | `…CAPACITY_RETEST_EVIDENCE.md` | Yes | Decide capacity/audit-scope (ADR-track) + re-measure on **dedicated prod host**; COO accepts against OQ#13 |
| 10 | **External penetration test** | ❌ Not engaged; handoff RoE authored | — (Claude does NOT conduct) | **Independent external provider** + Auditor | `STAGE_7_PENTEST_HANDOFF.md` | Yes | Engage provider (NDA/CoI); test the staging stack; clear findings + retest |
| 11 | **Real-data migration source (OQ#14)** | ❌ Pilot tenant + source **TBD** (entry gate unmet) | Eng (mapping once named) | Business owner | `STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md` | Yes | Management **names** pilot tenant + source system |
| 12 | **CFO sign-off (migration reconciliation)** | ❌ Pending (appointee TBD) | — | **CFO** (maker-checker) | migration reconciliation pack | Yes | Appoint CFO authority; sign after rehearsal reconciles |
| 13 | **Legal sign-off (DPA / basis / residency)** | ❌ Pending (appointee TBD) | — | **Legal Officer** | privacy/basis pack | Yes | Appoint Legal authority; confirm DPA region for #5/#6; sign |
| 14 | **Business-owner acceptance (pilot data)** | ❌ Pending | — | **Business owner** | reconciliation from business view | Yes | Sign migrated pilot data |
| 15 | **Pilot monitoring window** | ❌ Not started | Eng (run/monitor) | COO/Ops | pilot evidence | Yes | Run bounded pilot; hold CONDITIONAL_GO conditions open until discharged |
| 16 | **M42 governed production GO** | ❌ Deny-by-default; not issued | — (never AI) | **MD/CEO** (or Stage-7 authority) | M42 decision record (DERIVED) | Yes | Human issuer runs M42 after 1–15 closed/accepted |

## 3. The single critical path (dependency order)

```
 Ratify ADR-132 (#2, this PR merge)
        │
        ├─▶ Purchase & provision:  OpenBao staging instance (#3) ─▶ M41 adapter impl+test in staging (#4)
        │                          Backblaze B2 write-only key + DPA region (#5) ┐
        │                          2nd Contabo VPS, different DC (#6) ───────────┤─▶ DR drill on real stack (#8) ─▶ COO accepts
        │                                                                        │
        ├─▶ Capacity/audit-scope decision (#9) + re-measure on dedicated prod host ─▶ COO accepts SLO (OQ#13)
        │
        ├─▶ Engage external pentest (#10) ─▶ clear + retest ─▶ Auditor assurance
        │
        └─▶ Name pilot tenant + source (#11) ─▶ migration rehearsal reconciles ─▶ CFO (#12) + Legal (#13) + business (#14) sign
                                                                                     │
   ── all of the above ──▶ clean production commissioning (runbook) ──▶ pilot window (#15) ──▶ M42 GO (#16, human)
```

**Parallelizable now (independent):** #3+#4 (secrets), #5+#6 (DR infra), #10 (pentest engagement), #11 (name the
source). **Serial gates:** #8 needs #5/#6; #12–14 need #11; #16 needs 1–15 closed/accepted.

## 4. What is purely "purchase / human" vs "engineering-executable now"

- **Purchase / human decision (not codeable):** OpenBao instance host, Backblaze B2 + key, 2nd Contabo VPS, DPA
  region ruling, pentest engagement, pilot source naming, all Tier-2 sign-offs, M42 GO.
- **Engineering-executable the moment its input exists:** OpenBao deploy (#3), adapter impl (#4, needs #3), WAL/
  standby wiring (#5/#6, needs the purchases), DR drill (#8), capacity re-measure (#9), migration mapping (#11).

## 5. Boundary

Nothing here transitions a workstream or issues a GO. Production readiness stays **CONDITIONAL_GO**; the four
workstreams stay `requires_review`; Stage 8 stays deferred. Every Tier-2 acceptance and the M42 GO are human/external.
