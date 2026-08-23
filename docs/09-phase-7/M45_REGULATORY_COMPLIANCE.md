# M45 — Regulatory & Compliance Operations (Phase-7 vertical)

> The **third** Stage-8 vertical. A management-visible Regulatory & Compliance **experience** over the existing
> horizontal platform — it does **not** recreate a GRC engine. **Status: `approved_for_build` (2026-08-23).**
> Per the per-module cadence (ADR-133), Claude proposes; the human owner's merge is the approval. This authorises
> implementation only — **not** production GO, not Stage-7 completion. Release stays gated on the Stage-7
> production-release gates + the M42 governed GO. Synthetic data only.

---

## 1. Why this vertical + the repository-truth constraint it exposed
Aptic is a regulated Kenyan credit institution, so a control/evidence-posture view is high management value, and
the **GRC control plane already exists** — **m41-security** owns `grc_control` + `grc_assessment` (tenant-scoped,
FORCE RLS), privacy classifications/records, and security incidents/DLP findings; **m42-certification** owns the
governed certification programmes + GO/CONDITIONAL_GO/NO_GO decisions; **m03** owns the audit spine; **m32** owns
analytics.

**Repository-truth finding (important):** unlike m20/m17 (which m43/m44 reused UI-first over rich GET APIs),
**m41 exposed essentially no read/list HTTP surface** — the GRC domain was write-only over HTTP (only
`GET /security/secrets` existed). The GRC READ **permissions** (`grc.control.read`, `privacy.policy.read`,
`security.dlp.read`) and the tables already existed, but no list endpoints did.

So this vertical required a **minimal, canonical completion of m41's read surface** — not a duplicate engine:
`GET /api/v1/grc/controls` and `GET /api/v1/grc/controls/:id/assessments`, permission-gated on the existing
`grc.control.read`, RLS-scoped (the caller runs inside `withTenant`), read-only (no audit). These read the
canonical `grc_control`/`grc_assessment` rows through the existing `SecurityRepository`/`GovernanceService`.

## 2. Reuse (no duplication — Phase-7 rule)
| Concern | Reused / owning module |
| --- | --- |
| Controls + append-only assessment evidence | **m41-security** GRC (`/api/v1/grc/controls`) — read surface completed here |
| Privacy classifications / records | **m41-security** privacy (write-only today — read is a follow-up) |
| Security incidents / DLP findings | **m41-security** security (write-only today — read is a follow-up) |
| Certification programmes + governed GO decision | **m42-certification** (`/api/v1/certification/programmes`) |
| Audit trail | **m03** |
| Analytics | **m32** |
| AuthN / RBAC (authoritative) | **m02** |
| Events / outbox | **m06** |

**No** second GRC/risk engine, tenant model, entitlement engine, outbox, or control plane is introduced.

## 3. First slice (this increment)
React screens in the existing shell, over the canonical GRC read surface:
- **Compliance dashboard** — controls tracked + latest-assessment posture (compliant / partial / non-compliant /
  not-assessed) + controls-by-framework, all API-backed. Shows control/evidence **state**, never a blanket
  "Aptic is compliant/certified" claim.
- **Control register** — filterable (by framework: Kenya DPA / ISO 27001 / SOC 2 / GDPR / internal) list with the
  latest assessment status per control.
- **Control detail** — control + append-only **assessment history**, plus one **canonical write**: *Record
  assessment* (m41 append-only evidence, permission-gated, tenant-scoped, audited). This records control/evidence
  state — it is **not** a certification/approval.

## 4. Regulatory presentation discipline
The UI distinguishes **control/evidence state** from a **claim of regulatory compliance**. It never displays
"CBK compliant" / "Certified" / "Approved" — only the canonical control/assessment state. Frameworks shown come
from the canonical `GRC_FRAMEWORKS` allowlist (`kenya_dpa`, `iso27001`, `soc2`, `gdpr`, `other`).

## 5. Exit criteria (to reach `implemented` — the same bar as every module)
Per CLAUDE.md + conformance, `implemented` requires **real, tested code in a dedicated package**:
`packages/m45-regulatory-compliance` (its own orchestration/tables as needed, permissions/events/audit codes,
PURE + DB tests), entitlement registration (6F), and an m42 certification entry. UI-first reuse alone does not
qualify — it is `approved_for_build`. See the composition-vertical ADR recommendation below.

## 6. Composition-vertical recommendation (M43/M44/M45)
M43/M44/M45 are **composition/experience verticals over existing domain engines**, not new engines. The current
`implemented` rule (a dedicated `packages/m4x-*` package must exist) would force **empty/duplicate packages** just
to satisfy a status label. **Recommendation: introduce a governed `composition_vertical` implementation model via
an ADR** — a UI/orchestration vertical may reach `implemented` on the strength of its declared canonical
dependencies, entitlement registration, its own thin orchestration/tests, and browser/API acceptance evidence,
**without** duplicating m17/m20/m21/m41 domain logic. Until that ADR is ratified, M43/M44/M45 correctly stay
`approved_for_build`. This is a **recommendation only**; it does not change conformance in this increment.

## 7. Boundaries
No production GO · no real customer data · no external purchase/setup · **no fabricated regulatory
certification** · no duplicate GRC engine · no bypass of M02 RBAC / M03 audit / tenant isolation. Release gated on
Stage-7 production-release gates + M42.
