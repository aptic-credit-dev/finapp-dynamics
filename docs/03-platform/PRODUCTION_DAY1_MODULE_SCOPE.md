# Production Day-1 Module Exposure Matrix

> **STAGING-VERIFIED PLANNING ARTEFACT — NOT A PRODUCTION GO.** Defines the controlled Day-1 module scope for the
> production candidate `75660d8189c74e6bbe2063043d2fbae7924a5f2d`. Day-1 exposure is limited to modules with
> accepted evidence; incomplete or external-dependent functionality is disabled through the **existing** RBAC and
> entitlement controls — **no new feature-flag framework is introduced**. M42 remains `NO_GO`; Stage-7 G1–G4
> unchanged. This document does not authorise deployment.

## 1. How disablement works (verified, no code change required)

Two existing, server-authoritative mechanisms gate every module. Both are configuration/data, not code:

1. **RBAC (universal kill-switch).** Enforcement is `authz.require(ctx, permission)` **inside each service**
   (`packages/m02-rbac/src/rbac-authz.ts:30-36`), default-deny (`can()` returns false for any unheld permission,
   `rbac-authz.ts:24-28`). `ctx.permissions` is resolved server-side from persistent role assignments per request
   (`packages/m02-identity/src/actor-context.ts:47-69`) — never client-supplied; an `x-permissions` header cannot
   grant authority. Later modules' permissions are **not** auto-granted to any role, so the default posture is
   **"module off until a role carrying its permissions is granted."** Unheld → **HTTP 403
   `Missing required permission: <perm>.`**; no session → **HTTP 401**.
2. **Entitlements (ADR-135), UI-only, three verticals only.** Web nav groups **Treasury**
   (`treasury_reconciliation`), **Recovery** (`debt_recovery`), **Compliance** (`regulatory_compliance`) are hidden
   unless the tenant is entitled (`apps/web/src/app.tsx:17323-17327`, `groupAvailable` `:17469-17491`). Entitlements
   are granted only by activating a subscription/override (`packages/m39-saas/src/subscription.service.ts`); **no
   default seed grants them**. **Important limitation:** the entitlement check is **client-nav only** — the vertical
   APIs (`/recovery`, `/gl-reconciliation`, `/reconciliation`, `/grc`, `/privacy`) enforce **RBAC only**
   (`evaluateAccess` exists at `packages/m39-saas/src/entitlement.service.ts:82` but is **never called by a
   controller**). **To fully close a vertical you must withhold BOTH the entitlement (nav) AND the underlying RBAC
   permissions (API 403).**

**Conclusion:** every module can be isolated on Day-1 without any code change by controlling role grants (and, for
the 3 verticals, entitlements). **No module is a launch blocker on isolation grounds.** The nav additionally
fail-closes: an unavailable group is filtered out and its routes redirect to Dashboard (`app.tsx:17494-17510`).

## 2. Day-1 exposure matrix (evidence-verified — not copied)

Evidence base: `FINAL_DAY1_BROWSER_ACCEPTANCE_REPORT.md`, `DAY1_ACCEPTANCE_CLOSURE_REPORT.md`,
`DAY1_LAUNCH_BLOCKER_REGISTER.md`, and the D-M21-3 staging certificate.

| Module | Verified evidence | Day-1 treatment | Enforcement to apply (grant / withhold) | Fail-closed proof |
|---|---|---|---|---|
| **M02 Identity + RBAC** | ACCEPTED (browser+backend) | **ENABLED** (core dependency) | Grant `identity.*` / `rbac.*` to admins only | 403 without perm; nav `ADMIN_READ_PERMS` |
| **M03 Audit** | Read-only by design | **ENABLED — authorized audit users only** | Grant `audit.event.view/.search/.export`, `audit.integrity.verify` to auditor role only | 403 on `/audit`; no general nav surface |
| **M12 Feedback** | ACCEPTED (SoD resolution) | **ENABLED** | Grant `feedback.*` to CS roles | 403; nav `CS_READ_PERMS` |
| **M13 Cases** | ACCEPTED (full SoD) | **ENABLED** | Grant `cases.*` to case roles | 403; nav `LEGAL_READ_PERMS` |
| **M17 Recovery** | ACCEPTED for **tested maker scope** (create / owner-assign+eligibility / exposure-edit / lifecycle) | **ENABLED — tested maker scope only** | Grant `debt_recovery` entitlement **and** the tested `recovery.*` maker perms; **withhold** enforcement/negotiation perms not yet accepted | Nav hidden if entitlement absent (`app.tsx:17325`); API 403 on unheld `recovery.*` |
| **M22 Approvals** | Approval-**decision** SoD ACCEPTED; delegation incomplete | **ENABLED — decision scope only** (safely separable) | Grant `approvals.request.read` + `approvals.decision.*`; **withhold** `approvals.delegation.*` and policy-manage | 403 on delegation routes; nav on `approvals.request.read` |
| **M39 Plans/Subscriptions** | Backend + web ready (entitlement engine) | **ENABLED — admin-only** (needed to manage entitlements) | Grant `saas.*` to platform admins only | 403; nav `ADMIN_READ_PERMS` |
| **M41 Secrets (console)** | Read-only console + governed lifecycle web-ready | **ENABLED — read-only for security auditors**; lifecycle stays fail-closed (no bound provider) | Grant `security.secret.read` to security-auditor role; lifecycle writes fail closed until OpenBao bound (Gate 5) | 403 on unheld perms; provider `secret_provider_unavailable` |
| **M14 Legal Matters** | PARTIALLY ACCEPTED | **DISABLED** | Do not grant `legal.*` | Legal nav item hidden; API 403 |
| **M16 Litigation** | PARTIALLY ACCEPTED | **DISABLED** | Do not grant `litigation.*` | nav hidden; API 403 |
| **M18 Legal Documents** | Browser incomplete | **DISABLED** | Do not grant `legaldocs.*` | nav hidden; API 403 |
| **M19 Finance** | PARTIALLY ACCEPTED (entity create only) | **DISABLED** (optionally read-only admin for period/entity setup) | Do not grant `finance.*` (or grant only `finance.*.read` to a finance-admin for setup) | Finance nav hidden; API 403 |
| **M20 Reconciliation** | Browser incomplete / data-blocked | **DISABLED** | Withhold `gl_reconciliation.*` + recon perms **and** the `treasury_reconciliation` entitlement | Treasury nav hidden; API 403 |
| **M21 Journals** | PARTIALLY ACCEPTED (maker; posting-authorize unaccepted); D-M21-3 fixed | **DISABLED until posting-authorize acceptance** | Do not grant `journals.*` | hidden from Finance nav; API 403 |
| **M08 Notify** | Supporting; external delivery framework-only | **DISABLED** Day-1 (optional inbox read-only later) | Do not grant `notifications.*` | Notifications nav hidden; API 403 |
| **M09 Documents** | Metadata only; byte upload/download **external-unavailable**; **cross-vertical leak risk** | **DISABLED** Day-1 | Do not grant `documents.*` | Documents nav hidden; API 403 |
| **M28 Executive AI / Copilot** | Read-only; RLS+policy-masked; AI cannot mutate | **DISABLED** Day-1 (optional read-only for execs later) | Do not grant `ai.copilot.*` | Executive nav hidden; API 403 |
| **M32 Analytics / Reporting** | Governed read-only; reports may reference disabled datasets | **DISABLED** Day-1 | Do not grant `analytics.*` | Reporting nav hidden; API 403 |
| **M41 GRC + Privacy (Compliance vertical)** | Not accepted for Day-1 | **DISABLED** | Withhold `grc.*`/`privacy.*` **and** the `regulatory_compliance` entitlement | Compliance nav hidden; API 403 |

## 3. Cross-module leak vectors to close alongside the disables

- **M09 Documents** links to Legal/Recovery/Finance/Compliance entities via `documents.document.read` — kept
  **disabled** Day-1 so disabled verticals' documents are not reachable.
- **M22 Approvals** holds other modules' approval requests — decision scope is enabled, but because Journals/Finance
  are disabled, the request volume is limited to enabled makers; delegation stays withheld.
- **M08 Notify** delivers security/legal-category notifications regardless of user preference
  (`app.tsx:17311-17313`) — disabled Day-1 to avoid referencing disabled-module entities.
- **M28/M32** read cross-domain data but are **RLS + policy/entitlement-masked**; kept disabled Day-1 to minimise
  exposure surface.
- **The 3 entitlement verticals (Recovery/Treasury/Compliance):** withhold **both** entitlement and RBAC — an
  entitlement revoke alone is UI-only and would leave the API reachable.

## 4. Enabled vs disabled — Day-1 summary

- **ENABLED:** M02 (Identity/RBAC, admin), M03 (Audit, auditors), M12 (Feedback), M13 (Cases), M17 (Recovery —
  tested maker scope), M22 (Approvals — decision only), M39 (Plans/Subs — admin), M41 Secrets console (read-only).
- **DISABLED:** M08, M09, M14, M16, M18, M19, M20, M21, M28, M32, M41 GRC/Privacy.
- **Isolation method:** existing RBAC role grants (+ entitlement for the 3 verticals). No code change. Proof for
  every disabled module: nav hidden **and** API 403 for unheld permissions; 401 for no session.

## 5. Governance

No new global feature-flag framework introduced. RBAC/RLS/SoD/audit unchanged and unweakened. This scope is a
**precondition input** to the M42 decision pack, not an authorisation. M42 remains `NO_GO`; Stage-7 G1–G4 unchanged.
