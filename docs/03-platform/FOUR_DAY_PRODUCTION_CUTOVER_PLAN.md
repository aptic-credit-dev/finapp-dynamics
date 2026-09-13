# Four-Day Controlled Production Cutover Plan

> Executable plan to move candidate `75660d8189c74e6bbe2063043d2fbae7924a5f2d` toward a controlled production
> launch. **This plan does not authorise deployment.** Day-4 cutover happens **only** if the mandatory gates are
> discharged/accepted and the authorised human **M42 GO/CONDITIONAL_GO** is recorded, and only after Patrick's
> explicit "APPROVED — EXECUTE PRODUCTION CUTOVER". Owners are the named governance roles; **no completion date is
> invented for any external party** — several gates depend on third-party engagement/purchase that may not fit a
> 4-day window (flagged as ⚠ external-dependent).

## Owners (from Stage-7 governance)

MD/CEO or delegated Stage-7 governance authority (final M42 decision) · COO/Operations (DR, load/chaos, backups,
monitoring, support, business ops acceptance) · CTO/Technology Lead (technical execution) · CFO (migration finance
sign-off) · Legal Officer (DPA/privacy/legal basis) · Head of Risk & Compliance (pentest accountable + residual-risk
register) · Auditor (independent assurance) · Business owner (pilot-tenant data acceptance). **Independence rule
(ADR-130):** executor ≠ independent assurer ≠ acceptance authority; no role certifies its own critical condition.

## Day 1 — Freeze, scope, provision, engage
- **Freeze the production candidate** at `75660d8` (this branch/PR); no further feature code (CTO).
- **Finalise the Day-1 module scope** per `PRODUCTION_DAY1_MODULE_SCOPE.md`; confirm the enabled set (M02, M03, M12, M13, M17 tested-maker, M22 decision-only, M39 admin, M41 secrets read-only) and disabled set via RBAC/entitlements (CTO + business owner).
- **Appoint owners** for every gate G1–G12 and confirm independence (MD/CEO).
- **Confirm Kenya-DPA-acceptable region** (Technology/Risk/Legal) — hard precondition for any real data (G6/G9).
- ⚠ **Engage the external penetration-test provider** under NDA/CoI (Head of Risk) — G1; external lead time.
- ⚠ **Provision production infrastructure** separate from staging: prod host, ufw deny-by-default, SSH pubkey-only, non-root deploy, reverse proxy + **production TLS/HSTS**, fresh PG16 DB/volumes (CTO) — G6.
- ⚠ **Provision separate/off-server encrypted backup** (Backblaze B2 write-only key) + WAL archiving/standby (CTO) — G8.
- ⚠ **Stand up the dedicated production OpenBao host**; deliver URL/CA/AppRole **out-of-band**; do not print/commit secrets (CTO + custody group) — G5.
- **Establish monitoring/alerting** (centralized logs/metrics + SLO-burn/backup-failure/replication-lag/auth-anomaly alerts) and **author the incident-response runbook** — G7 (authorable now).
- **Author the support/on-call roster + operational-handover runbook** — G11 (authorable now).

## Day 2 — Rehearse, migrate (sanitized), DR, load
- **Production-like rehearsal** on the provisioned prod stack with `NODE_ENV=production` guards active; verify health, cookies/CSRF/CORS fail-closed, module entitlements (CTO).
- ⚠ **Real-data migration rehearsal** on a non-prod copy using approved sanitized/representative first-tenant data (source named by management, OQ#14); reconcile control totals; rehearse rollback (CTO + CFO observe) — G4.
- ⚠ **Cross-host restore / DR exercise** to the standby + off-server B2; measure RTO/RPO vs OQ#13 (CTO; COO accepts) — G2/G8.
- ⚠ **Acceptance-grade load & chaos** on the dedicated host vs approved SLOs; capture the audit-hash-chain write-burst behaviour without weakening the control (CTO; COO accepts) — G3.
- **Triage and fix any critical/high findings** (smallest safe fix + regression; see `PRODUCTION_CUTOVER_RUNBOOK.md`).

## Day 3 — Accept, sign, rehearse rollback, prepare decision
- **Business-owner acceptance** of migrated pilot data + reconciliation (business owner) — G10.
- **Independent sign-offs:** pentest cleared + Auditor assurance (G1); DR/ops acceptance COO (G2/G3); CFO + Legal migration sign-off (G4/G9); Head of Risk residual-risk register.
- **Rollback rehearsal** (clone → checkout `DEPLOYED_SHA.prev` → `up -d --build`; DB snapshot restore path if the release migrates schema).
- **Cutover dry run** end-to-end on the prod stack (no real go-live).
- **Assemble the M42 decision pack** (`M42_PRODUCTION_DECISION_PACK.md`) with all evidence refs + sign-off forms.

## Day 4 — Human decision, conditional cutover
- **Human M42 decision** (MD/CEO or delegated authority) runs `evaluateCertificationDecision` from governed evidence → GO / CONDITIONAL_GO / NO_GO. **AI/automation never issue it.**
- **Production deployment ONLY IF authorised** and Patrick explicitly instructs "APPROVED — EXECUTE PRODUCTION CUTOVER": execute `PRODUCTION_CUTOVER_RUNBOOK.md` (SHA-pinned `75660d8`).
- **Post-deploy:** health/readiness, authenticated smoke for enabled Day-1 modules, module-entitlement verification, synthetic smoke transaction, audit-evidence capture.
- **Controlled user enablement** limited to the accepted Day-1 scope; **enhanced monitoring + rollback window** held open; CONDITIONAL_GO conditions tracked to expiry.

## Reality check on the four-day window
The four **release-blocking** gates (G1 external pentest, G2 cross-host DR, G4 real-data migration, G5 production
OpenBao) each depend on **external engagement, hardware/service purchase, or a named data source** and are **not
waivable** (ADR-133). If any is not genuinely discharged and independently accepted, the only governance-valid Day-4
outcomes are **CONDITIONAL_GO** (bounded residual conditions that do **not** include the four blockers) or **NO_GO**.
A controlled pilot is reachable **only after** the M42 human decision, never before. Do not compress or fabricate any
external party's timeline.
