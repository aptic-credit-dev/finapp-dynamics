# M44 — Debt Recovery & Enforcement (Phase-7 vertical — PROPOSED)

> The **second** Stage-8 vertical, proposed as the successor to the m43 Treasury & Reconciliation reference
> vertical. Same Phase-7 pattern: a management-visible experience **on top of the existing horizontal platform**,
> reusing shared services and adding **no** second engine.
>
> **Status: `documented` (PROPOSED 2026-08-23).** Per the per-module governance cadence (ADR-133), a governance
> PR flips `documented → approved_for_build` before implementation; **Claude proposes, the human owner's merge is
> the approval.** This document does not itself approve build. Release remains gated on the Stage-7
> production-release gates + the M42 governed GO. Synthetic data only.

---

## 1. Why this vertical next
Aptic is a credit/collections business, so **debt recovery & enforcement is core internal demand** — and, exactly
like reconciliation, **the backend already exists**. Across the platform there are **~241 existing HTTP routes**
directly relevant to recovery, all canonical:

- **m17-recovery** — recovery cases/plans/actions (`/api/v1/recovery/*`, ~79 routes)
- **m14-legal** — legal instructions/matters (`/api/v1/legal/*`, ~79 routes)
- **m16-litigation** — litigation lifecycle (`/api/v1/litigation/*`, ~83 routes)

with **m13-case** (case spine), **m19-finance** (balances/amounts), and **m21-journal** (adjustments,
maker-checker) as primitives. So this vertical is **UI-first**: a React UI over the existing APIs, not a new
engine — the same low-risk, high-visibility approach that made m43 demo-ready quickly.

Ranking of the indicative portfolio (`VERTICAL_PORTFOLIO.md`) against business value × existing-module reuse ×
synthetic-demoability × zero external cost × time-to-visible-staging:

| Vertical | Existing reusable API surface | Business fit (credit co.) | Verdict |
| --- | --- | --- | --- |
| **Debt Recovery & Enforcement** | **recovery + legal + litigation (~241 routes)** | **core** | **1st — recommended** |
| Lending Operations | case has **0 HTTP routes** → needs backend wiring | core | later (more build) |
| Regulatory & Compliance | GRC/reporting/audit exist | high | candidate |
| Bonds & Guarantees | legal/finance | medium | later |
| Insurance Operations | feedback/case/finance | lower (not credit-core) | later |
| Customer Experience | feedback/AI/analytics | supporting | later |

## 2. Reuse (no duplication — Phase-7 rule)
| Concern | Reused service |
| --- | --- |
| Recovery cases / plans / actions | **m17-recovery** (`/api/v1/recovery/*`) |
| Legal instructions / matters | **m14-legal** (`/api/v1/legal/*`) |
| Litigation lifecycle | **m16-litigation** (`/api/v1/litigation/*`) |
| Case spine | **m13-case** |
| Finance / balances / amounts | **m19-finance** |
| Adjustments / journals (maker-checker, no auto-post) | **m21-journal** |
| AuthN / RBAC (authoritative) | **m02** (session cookie + CSRF; UI reflects, never re-implements) |
| Audit trail | **m03** |
| Events / outbox | **m06** (single outbox) |
| Certification before release | **m42** |

**No** second tenant model, recovery engine, entitlement engine, outbox, key store, or security control plane is
introduced. The governed tenant switcher (ADR-134) and all M02/M03/RLS/maker-checker controls apply unchanged.

## 3. UI surface (apps/web — React + Vite + TS, OQ#17)
Reuse the existing shell (governed tenant switcher, RBAC-reflecting, label+glyph+colour status pills). Proposed
first-slice screens, all read-first over existing APIs:
- **Recovery dashboard** — synthetic counts (open recovery cases, active plans, actions due, legal referrals).
- **Recovery cases** — list + detail over `/api/v1/recovery/*` (status, balance owed, plan, next action).
- **Legal / litigation** — referred matters over `/api/v1/legal/*` and `/api/v1/litigation/*`.
- **Adjustments** — reuse the canonical M21 **Propose adjustment** flow (maker-checker, PENDING APPROVAL, no
  direct posting) already built for m43.

## 4. First implementation slice (after `approved_for_build`)
1. Confirm the exact recovery/legal/litigation read endpoints + response envelopes (as m43 did for gl-reconciliation).
2. Add API-client methods + read-only screens (dashboard + cases list/detail), reusing `useRows`/`asRows`/pills.
3. Seed synthetic recovery data via canonical APIs / a staging-only seed (no real data).
4. Deploy to the existing staging VPS; run browser/API acceptance (login → tenant switch → recovery dashboard →
   case detail → legal/litigation → RBAC denial → tenant isolation).

## 5. Exit criteria (to reach `implemented` — same bar as every module)
Per CLAUDE.md + the manifest, `implemented` requires **real, tested code in a dedicated package**: a
`packages/m44-debt-recovery` package (its own tables/orchestration as needed, permissions in the identity seed,
events in the contracts union, audit codes in the registry, a PURE smoke suite + a DB-integration spec),
entitlement registration (6F), and an m42 certification entry. **UI-first reuse alone does not qualify for
`implemented`** — it qualifies for `approved_for_build` build progress, exactly as m43 does today.

## 6. Boundaries
No production GO · no real customer data · no external purchase/setup · no duplicate backend engine · no bypass of
M02 RBAC / M03 audit / tenant isolation / maker-checker. Release gated on Stage-7 production-release gates + M42.
