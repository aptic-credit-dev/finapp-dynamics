# M43 — Treasury & Reconciliation (Phase-7 reference vertical)

> The first Stage-8 vertical (ADR-133). **Reference implementation** proving the Phase-7 pattern: it builds a
> management-visible Treasury & Reconciliation experience **on top of the existing horizontal platform**, reusing
> shared services and adding **no** second engine. Status: `approved_for_build` (management decision 2026-08-23).
> Release is gated on the Stage-7 production-release gates + the M42 governed GO (ADR-133). Synthetic data only.

---

## 1. Why this vertical first
Cleanest data + clearest internal demand, and the backend already exists: bank/GL reconciliation is implemented by
**m20-glrecon** (accounts, rulesets, GL/source imports, balances, runs, matches, exceptions, reconciling-items,
certifications) with **m15-recon**, **m19-finance**, and **m21-journal** primitives, exposed at
`/api/v1/gl-reconciliation`. So the vertical is **UI-first**: a React UI over the existing API, not a new engine.

## 2. Reuse (no duplication — Phase-7 rule)
| Concern | Reused service |
| --- | --- |
| Reconciliation engine, matching, exceptions | **m20-glrecon** (`/api/v1/gl-reconciliation/*`) |
| Bank statement / recon primitives | **m15-recon** |
| Finance / balances | **m19-finance** |
| Journals / adjustments (maker-checker, no auto-post) | **m21-journal** |
| AuthN / RBAC (authoritative) | **m02** (session cookie + CSRF; UI reflects, never re-implements) |
| Audit trail | **m03** |
| Events / outbox | **m06** (single outbox) |
| Certification before release | **m42** |

**No** second tenant model, entitlement engine, outbox, key store, or security control plane is introduced.

## 3. UI surface (apps/web — React + Vite + TS, OQ#17)
Authenticated shell (branding, role-aware sidebar, tenant selector, user menu, **STAGING/SYNTHETIC** banner) +:
- **Dashboard** — accounts, GL imports, balances, reconciliation status tiles.
- **Bank accounts** — accounts under reconciliation.
- **Reconciliation workspace** — imports/runs; match confidence rendered with **label + glyph + colour** (never
  colour alone): exact ✓ / probable ≈ / split ⧉ / unmatched ! / pending ?.
- **Exceptions**, **Reports** — planned follow-up surfaces (backend available).

The UI adds **no authorization logic**: every list/action is what the API returns; a 401/403 is surfaced, never
worked around. Adjustments post through **maker-checker journals server-side** — the UI never auto-posts.

## 4. Scope assessment (repository-truth-derived)
Covered by the reused backend today: bank accounts, statement/GL import, balances, reconciliation runs, exact +
probable/fuzzy matches, split/manual matches, unmatched items, exceptions (assign/resolve/waive), reconciling
items, certifications (maker-checker), audit trail, status. **This increment delivers**: the shell + dashboard +
accounts + reconciliation workspace wired to the real API + synthetic demo data + staging deployment. **Follow-up**:
exceptions/report/match-drawer/journal-adjustment screens; a dedicated m43 backend package (its own tables +
6F entitlement registration + m42 cert entry) if the vertical needs surface beyond the reused API.

## 5. What is NOT done (honesty)
- Not marked `implemented` — no dedicated m43 backend package/tables/tests exist yet (UI + reuse only).
- Not released — production release is gated (ADR-133 + M42).
- No real customer data — synthetic staging only.
