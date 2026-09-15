# M42 Final Decision Pack

> Human M42 production-decision pack for candidate `dad369e1be68304dbf6c54c1abd0b3796b1df0de`. **The formal M42
> status is `NO_GO` and remains so** until an authorised signatory (**Patrick Maina**, MD/CEO / Stage-7 governance
> authority) records a governance-valid decision after reviewing the evidence. **No AI, developer, provider, or
> technical owner may self-certify production GO.** Production GO is deny-by-default and DERIVED only by the human
> decision (ADR-129/130/131/132/133). A gate is **never** marked PASS from internal Tier-1 evidence alone.
>
> **Candidate advanced to `5b27a4a` (PR #198; docs-only over `dad369e` — product code unchanged, so the technical
> battery evidence remains valid). Intake status as of `5b27a4a`: no new external/human/infrastructure evidence
> received; the gate table below is unchanged — 0/12 PASS.**

## 1. Gate-by-gate evidence table

Status values: `PASS` · `FAIL` · `BLOCKED` · `REQUIRES_REVIEW` · `NOT_APPLICABLE — HUMAN APPROVED`.

| Gate | Evidence available | Independent acceptance | Status | Blocker |
|---|---|---|---|---|
| **G1** Independent pentest | Activation record + provider/auditor declarations authored; internal Tier-1 SAST/DAST prior. **0/13 pre-access conditions met; no external test.** | Auditor (Nganga) — none | **BLOCKED** | Signed declarations; isolated instance; external report + retest + Auditor attestation |
| **G2** Cross-host DR | Tier-1 single-host tooling only (not G2) | COO/Ops — none | **BLOCKED** | 2nd host (diff failure domain) + immutable B2 + cross-host restore drill |
| **G3** Load & chaos (acceptance-grade) | Tier-1 authenticated load on shared staging; SLOs approved | COO — none | **REQUIRES_REVIEW** | Dedicated-host acceptance-grade re-measure + COO acceptance |
| **G4** Real-data migration | Clean-init plan; synthetic-only audit; **proposed N/A** (pilot = Aptic Credit Limited) | CFO+Legal+business+Risk — none | **REQUIRES_REVIEW** | Human approval of N/A (or migration path); not AI-declarable |
| **G5** Production OpenBao | Adapter + prior live-binding (torn down); fail-closed default verified | via M42 GO — none | **BLOCKED** | Dedicated OpenBao host + custodians + URL/CA/AppRole; bind + verify |
| **G6** Prod infra + DNS/TLS | Region **EU confirmed** (Contabo panel); loopback bindings + SSH lockdown demonstrated; DNS via Cloudflare to origin | COO/Ops — none | **BLOCKED** | Prod 443 TLS/HSTS terminator; clean prod env; EU ruling (G9) |
| **G7** Monitoring / alerting / IR | Incident-response runbook + monitoring/alerting **plan** authored; nothing wired | COO/Ops — none | **REQUIRES_REVIEW** | Wire observability + firing alerts on prod host; COO/Ops accept |
| **G8** Backup / restore / rollback | Tier-1 single-host backup/verify tooling | COO/Ops — none | **BLOCKED** | Off-server immutable B2 + cross-host restore-verify |
| **G9** Data protection / EU cross-border | Public evidence pack + opaque-artefact register; **EU region confirmed** | Legal/Risk/CTO — none | **REQUIRES_REVIEW** | Concluded DPA/TOMs + 3 signed reviewer decisions; US-parent safeguards |
| **G10** Business-owner acceptance | Stage-8 functional UAT 6/6 (functionality, not pilot-data) | Business owner — none | **REQUIRES_REVIEW** | Aptic Credit Limited business-owner sign-off (tied to G4) |
| **G11** Support roster / handover | Support & handover doc authored (blank appointees) | COO/Ops — none | **REQUIRES_REVIEW** | Named roster + on-call + COO/Ops acceptance |
| **G12** M42 human decision | Engine deny-by-default proven; decision pack assembled | MD/CEO — none | **BLOCKED** | Human decision (this pack), after G1–G11 |

**Summary: 0 PASS · 5 BLOCKED (G1, G2, G5, G6, G8, G12 → 6) · REQUIRES_REVIEW (G3, G4, G7, G9, G10, G11).** Four
non-waivable release blockers remain open: **external pentest (G1), cross-host DR (G2), real-data migration (G4),
production OpenBao (part of G5)** — none satisfiable by internal evidence (ADR-133).

## 2. Technical recommendation

All mandatory Stage-7/M42 gates are **not** satisfied. The internal technical battery is green on `dad369e`
(smoke 51/8082/0; DB 99/3114/0 non-superuser; isolation 11/11; migrations 84 idempotent; secret scan clean), but
**Tier-1 green never constitutes a GO**. Technical recommendation: **do not issue EFFECTIVE/GO now.** The only
governance-valid near-term outcomes are **CONDITIONAL_GO** (iff governance conditions met **and** the four
release-blockers genuinely discharged + independently accepted — CONDITIONAL_GO cannot cover the four blockers) or
**NO_GO**.

## 3. Human decision (UNSIGNED — remains NO_GO)

> I have reviewed the gate evidence above. My decision for candidate `dad369e…` is:
>
> ☐ NO_GO ☐ CONDITIONAL_GO (conditions attached) ☐ EFFECTIVE / GO
>
> Conditions / residual-risk register reference: ____________________
>
> Authorised signatory (Patrick Maina, MD/CEO): ____________________  Signature: __________  Date: ________

**Until this is signed with a governance-valid decision, M42 = `NO_GO`.** A GO here is **not** a cutover instruction;
production cutover additionally requires the explicit `APPROVED — EXECUTE PRODUCTION CUTOVER`.

## Governance

Decision pack only. No self-certification. **M42 `NO_GO`; 0/12 gates PASS; Stage-7 G1–G4 unchanged; no deployment.**
