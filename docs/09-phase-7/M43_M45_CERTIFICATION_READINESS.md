# M43 / M44 / M45 — Composition-Vertical Certification Readiness

> Certification **enablement + readiness** for the three `implemented` composition verticals (ADR-135), base
> merged main `0ffdc5e` (PR #149). This package registers the internal certification prerequisites (6F
> entitlement declaration + M42 evidence/assessment inputs) and records the readiness verdict per vertical.
>
> **Independence boundary (ADR-129/ADR-012):** the M42 **certified decision** and its **independent human
> sign-off** (a signer who did not assess the domain) are a **human governance act**. This AI agent **built**
> these verticals — it is the *requester* and therefore **cannot self-certify or self-sign**. So this package
> advances certification to **READY** (evidence complete, entitlement declared, assessment inputs recorded);
> the `certified` status is deliberately **not** set here. It awaits the human sign-off / M42 governed decision.
>
> **This is NOT:** a production GO · the M42 governed GO decision · CBK/ODPC or any regulator certification ·
> completion of the Stage-7 production-release gates (external pentest, cross-host DR, permanent OpenBao,
> real-data migration — all still outstanding). Release stays deny-by-default behind those + the M42 decision.

---

## 1. Certification model (from repository truth)
- **6F entitlement (m39-saas):** `saas_plan → saas_plan_version → saas_plan_entitlement` (attached via
  `POST /saas/versions/:id/entitlements`, published). An entitlement names a **commercial/product surface**; it
  does **not** replace M02 RBAC. *Repository truth:* the m43/m44/m45 UIs currently gate on **M02 RBAC**, not on
  entitlements — entitlement **enforcement wiring** (hiding a module when its entitlement is absent) is a
  declared follow-up; this package registers the entitlement **declaration** + permission map, and RBAC
  continues to decide actual access (already proven).
- **M42 certification:** `programme → domain×aspect assessments → evidence → readiness → independent sign-offs →
  governed decision`. The **decision + sign-off are human** (ADR-129 independence). This package records the
  **evidence/assessment inputs** (opaque references to the acceptance annotations), not the decision.
- **`certified_on_branch`** (Stage-6 precedent) is an **evidence** status that in Stage-6 was accompanied by the
  m42 assessment + a sign-off. Because the sign-off must be an independent human, it is **not** self-set here.

## 2. Entitlement declarations + permission maps
Each entitlement composes existing canonical permissions; **RBAC still decides** what the actor may do
(entitlement gates the *commercial surface's existence*, RBAC gates *actions*).

### M43 `treasury_reconciliation`
| UI capability | Canonical permission (owning module) |
| --- | --- |
| View accounts / runs / matches / exceptions / reports | `gl_reconciliation.*.read` (m20) |
| Propose adjustment (maker-checker, no post) | `journals.draft.create/edit/submit`, `journals.line.manage`, `journals.validation.run` (m21) — **no** `journals.posting_request.*` |

### M44 `debt_recovery`
| UI capability | Canonical permission (owning module) |
| --- | --- |
| View recovery cases / dashboard / detail | `recovery.case.read`, `recovery.analytics.read`, `recovery.arrangement.read`, `recovery.demand.read` (m17) |
| Record activity | `recovery.case.update` (m17) |
| Legal / litigation context | m14/m16 via recovery source-link ids (read) |

### M45 `regulatory_compliance`
| UI capability | Canonical permission (owning module) |
| --- | --- |
| View control register + assessment history | `grc.control.read` (m41) |
| Record assessment (append-only evidence) | `grc.control.manage` / `grc.assessment.record` (m41) |

**Boundary proof (from acceptance):** in every vertical, an authenticated actor **without** the permission is
denied **403** by M02 regardless of any entitlement (M43/M44/M45 restricted-user acceptance). No wildcard
entitlement or permission was introduced. Entitlements are tenant-scoped (m39 `saas_*` tables are tenant-scoped).

## 3. M42 evidence mapping (opaque references — not restated)
| Vertical | Acceptance evidence (annotation) | Canonical write boundary |
| --- | --- | --- |
| M43 | `stage8_recon_ui_depth_2026_08_23` (PR #143) + tenant-switcher `stage8_tenant_switcher_2026_08_23` | M21 maker-checker; proposer holds **0** posting perms (403) |
| M44 | `m44_operational_depth_2026_08_23` (PR #147) | m17 `recovery.case.update`; audited `RECOVERY_NOTE_CREATED` |
| M45 | `m45_regulatory_compliance_2026_08_23` (PR #148) | m41 append-only assessment; audited `GRC_ASSESSMENT_RECORDED` |

## 4. Certification-dimension assessment (evidence-backed only)
| Aspect | M43 | M44 | M45 |
| --- | --- | --- | --- |
| Architecture / dependency integrity (composition, no duplicate engine) | ✓ | ✓ | ✓ |
| Tenancy / FORCE-RLS (proven live) | ✓ | ✓ | ✓ (grc_control) |
| RBAC (M02, 403 proven) | ✓ | ✓ | ✓ |
| Audit (M03, hash-chained) | ✓ | ✓ | ✓ |
| Workflow / SoD | ✓ (maker-checker, no self-post) | ✓ (activity audited) | ✓ (append-only evidence) |
| API contracts (canonical only) | ✓ | ✓ | ✓ (+ minimal m41 read completion) |
| Staging browser/API acceptance | ✓ | ✓ | ✓ |
| Commercial entitlement (declared) | ✓ | ✓ | ✓ |
| **Independent human sign-off + M42 governed decision** | **PENDING (human)** | **PENDING (human)** | **PENDING (human)** |
| Production-release conditions (Stage-7 external) | OUTSTANDING | OUTSTANDING | OUTSTANDING |

## 5. Contamination check ✅
No duplicate domain engines; no Stage-7 status change; no M46; no production data; no external provider setup;
no production entitlements (synthetic/demo only); no weakening of M02/M03/RLS; no changes to earlier certified
modules beyond the authorised m41 read-surface completion (ADR-135, already merged).

## 6. Verdict (per vertical)
- **M43 Treasury & Reconciliation — READY for certification.** All evidence dimensions satisfied; entitlement
  declared. Remaining: independent human sign-off + M42 governed decision.
- **M44 Debt Recovery & Enforcement — READY for certification.** Same posture. Limitation: direct m14/m16 legal
  screens are a documented follow-up (legal/litigation represented via recovery status/stage).
- **M45 Regulatory & Compliance — READY for certification.** Same posture. Limitation: privacy/security-incident
  read surfaces (m41 write-only there) are a documented follow-up; UI shows control/evidence state, never a
  regulator-compliance claim.

**None is `certified` here** — that is the human governance act (independent sign-off + M42 decision), and
production release remains gated on the Stage-7 production-release gates.
