# Stage 6F — M39 Commercial SaaS — Certification

**Module:** `m39-saas` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-14. **Tenth Stage-6 module certified; first Stage-6F module.**
**ADR:** ADR-126 (canonical owner of commercial plan/subscription/entitlement/quota/usage/billing state; access = RBAC ∧ entitlement ∧ feature stack — an entitlement is never an authorization substitute; race-safe quota + append-only idempotent usage; published plan versions immutable + human maker-checker publish/lifecycle/override; pricing metadata only — no journal/GL/payment, billing provider deferred behind a fail-closed port; `saas.*` closes GAP-2 with `/api/v1/saas`; GAP-6 resolved; `saas_` prefix).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #100 — merged → `main` `238071d` (m39 `approved_for_build`) |
| Implementation PR | #101 — closed, merged, merged_at `2026-08-14T13:07:35Z` |
| Reviewed implementation head | `103ff2d` |
| Implementation merge SHA | `f8b3233621476527199fc1db4264e423c9434d76` (single parent `238071d` = squash) |
| Tree equivalence | `git diff 103ff2d f8b3233` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `f8b3233621476527199fc1db4264e423c9434d76` |
| Certification branch | `cert/stage-6-m39-saas` (from `f8b3233`) |
| Implementation CI (reviewed head `103ff2d`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |
| Post-merge CI (`f8b3233`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m39-saas` · Stage 6F · **Commercial SaaS** (the canonical owner of commercial plan/subscription/entitlement/quota/
usage/billing state) · **mvp:false** · **`/api/v1/saas`** · `saas.*` permissions · audit prefix **`SAAS_`** · event families
**`subscription.lifecycle` + `usage.lifecycle` + `billing.lifecycle`** · one m06 outbox · M39 owns plans/versions, subscriptions,
entitlements, quotas, usage metering and billing-cycle metadata · **M39 does NOT own RBAC (m02), feature flags (m30), finance
posting/GL (m19/m21), payments or accounting** — those are consumed by contract or governed elsewhere · uses the **`saas_`**
table prefix (no collision with any prior module) · `reference_tables` **72 → 13** governed core.

## C. Local certification gates (clean checkout on baseline `f8b3233`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| format:check | pass (all matched files use Prettier code style) |
| lint | **0 errors** (68 pre-existing baseline warnings; m39 adds none) |
| build (`tsc --build`) | pass |
| smoke lane | 44 suites, **7378** assertions, 0 failures (m39-saas **110** · conformance **3729**) |
| fresh migration replay | **76** migrations applied (m39 = 2; no historical migration edited) |
| — m39 checksums | `0001_saas.sql` `bfe91ffd37a4` · `0002_grant_application_role.sql` `536be282cfe4` |
| DB/API lane (fresh DB) | **91** specs, **2775** assertions, 0 failures |
| — `m39-saas` DB spec | 33 |
| — `m39-services` DB spec | 27 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 lanes on the reviewed head `103ff2d`, the post-merge lanes on `f8b3233`, and this cert PR's lanes are the
authoritative PG16 evidence. A DB re-run against a **non-fresh** DB trips the known identity/auth pollution specs (login/session
uniqueness) — not an M39 defect; the fresh-DB run is 91/2775/0-fail.

## D. Database — live catalogue evidence (m39-owned 13 saas_ tables, non-owner application role)

13 tables · **13/13 RLS ENABLE + FORCE · 13/13 `tenant_isolation`** · **6 composite tenant-safe FKs · 0 unsafe single-column
tenant FKs** · **0 DELETE grants** · 8 append-only ledgers (INSERT+SELECT, **0 UPDATE**: `saas_plan_entitlement`,
`saas_quota_policy`, `saas_entitlement_assignment`, `saas_override`, `saas_usage_event`, `saas_review`, `saas_history`,
`saas_idempotency`) · 5 mutable aggregates (INSERT+SELECT+UPDATE: `saas_plan`, `saas_plan_version`, `saas_subscription`,
`saas_quota_period`, `saas_billing_cycle`) · **37 governance CHECK constraints** · 5 version columns · **0 float** (money is
bigint minor units) · **0 secret-value columns** · **1 immutability trigger** (`saas_plan_version_immutable_trg`) · **1 outbox
(m06 `workflow_event_outbox` — m39 owns none)** · 12 `saas.*` permissions (**4 privileged**, all 3-segment, no wildcard) · 22
`SAAS_` audit codes · `subscription/usage/billing.lifecycle` (8 event types) · **76 total migrations**. reference_tables
reconciled **72 → 13** (documented — the 72 was the full reference baseline, the largest 6-series; this Stage-6F core is the
governed commercial-SaaS layer).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **The access stack (RBAC ∧ ENTITLEMENT ∧ FEATURE) — load-bearing** — `evaluateEffectiveAccess`: any deny denies. The DB truth table is proven in the services spec: RBAC deny + entitlement allow + feature on ⇒ DENY (rbac_denied); RBAC allow + entitlement deny ⇒ DENY (entitlement_denied); RBAC allow + entitlement allow + feature off ⇒ DENY (feature_denied); a platform-absolute block ⇒ DENY even when all three allow; all allow ⇒ ALLOW. An entitlement never grants a permission RBAC denies, never bypasses RBAC, never weakens an m30 absolute control; a tenant cannot manufacture entitlement via request input (the entitlement leg reads the DB assignment, the RBAC leg reads the resolved permission set). The m30 feature leg is consulted through a fail-closed `FeatureControlPort` (default `UnavailableFeatureControl` ⇒ not enabled ⇒ deny) | **PASS** |
| **Race-safe quota (mandatory)** — the reservation is a single atomic conditional UPDATE (`reserved_qty + $qty <= limit_hard`) + version CAS, backed by a `reserved_qty <= limit_hard` CHECK; the concurrent test (limit 3, five concurrent ×1) admits **exactly 3** — no check-then-increment race, no oversubscription; a rejected reservation records no usage (tx rolls back); successful usage + reservation + evidence are transactional; retries do not double-count | **PASS** |
| **Usage idempotency** — `saas_usage_event` has a UNIQUE `(tenant_id, idempotency_key)` index (DB-enforced); a duplicate source event is counted **once** (insert returns null on conflict → no re-reserve, deterministic result); an over-quota event creates no usage evidence; the ledger is append-only (INSERT+SELECT); quantity is bounded (`quantity > 0` CHECK); the period key is deterministic | **PASS** |
| **Plan/version governance + immutability** — a **published** plan version is IMMUTABLE (`saas_plan_version_immutable_trg` — a published→draft revert and a price change are both rejected, proven live); a subscription binds an explicit plan/version; no silent retroactive commercial mutation; a new version is the only way to change terms | **PASS** |
| **Plan publication / maker-checker** — publishing is privileged (`saas.plan.publish`) + maker-checker/SoD: requester ≠ approver, a HUMAN approver (`isHumanActor` rejects null/blank/`system`/`ai`/`automation`), a passing validation required; self-approval + AI approval are refused (proven); stale-version writes rejected (CAS); the published state is immutable; publication is audited | **PASS** |
| **Subscription lifecycle** — governed transitions only (`isSubscriptionTransitionAllowed`; draft/trial/active/grace/suspended/cancelled/expired; terminal states protected); activation derives entitlements; plan change requires a published version; suspend/cancel proven; a `system`/`ai`/`automation` actor can never drive a lifecycle change (`isHumanActor` guard); one live subscription per tenant (partial unique index) | **PASS** |
| **Entitlement assignment / overrides** — entitlements derive from the bound plan version (append-only, on activation); an override is privileged (`saas.override.administer`) + maker-checker/SoD (approver ≠ requester, human) + bounded validity + reason (append-only `saas_override` with a `approved_by <> requested_by` CHECK); a tenant admin cannot self-grant beyond plan (the control-plane/override permission is required); AI/system cannot approve | **PASS** |
| **Money / finance boundary** — money is bigint minor units + an explicit 3-letter currency (`saas_plan_version_currency_ck`); **0 float columns**; no negative money (`base_amount_minor >= 0`). M39 source imports no m19/m21/m22 finance module and executes no journal/GL/payment/AR-AP — it owns pricing METADATA only (finance consumed by contract). The billing provider is a fail-closed `BillingProviderPort` (default collects nothing); no production billing network/provider | **PASS** |
| **Billing lifecycle** — `billing.lifecycle` events describe commercial billing-cycle METADATA only (cycle id/subscription/status + bounded amount/currency + reason codes); no fake accounting/payment events; `provider_ref` is an opaque external reference (no credential/secret); no payment execution | **PASS** |
| **GAP-6 ownership** — m01 owns tenant identity/lifecycle; m39 owns commercial subscription/entitlement/quota/usage. m01 never acquired a subscription/entitlement/usage table (0 such migration); no duplicate subscription/entitlement engine (documentation-only conflict resolved, ADR-126) | **PASS** |
| **M35 quota-port boundary** — m39 exposes the read-only quota check (`EntitlementQuotaService.checkQuota` → `{allowed, reasonCode}`, tenant-scoped, deterministic reason codes, no cross-tenant lookup) that m35-devportal's `UsageQuotaPort` consumes; **m35 source is untouched** and its default binding remains fail-closed (`UnavailableUsageQuota` ⇒ deny). The composition-root adapter is documented as **deferred** pending the `appRef → capability` mapping — an intentional fail-closed boundary, not a defect | **PASS** |
| **Permissions** — `saas.*`, 12 codes all 3-segment, 4 privileged (`plan.publish`, `subscription.manage`, `override.administer`, `control.administer`); no `saas.admin`/wildcard; default deny; platform-scope plans/overrides require `saas.control.administer`; API `@Endpoint` + in-service authorization both enforce | **PASS** |
| **Audit** — `SAAS_`, 22 codes; source↔registry parity **22/22**; `registered_code_count` **923** = len(codes); no code carries another module's prefix; payloads carry ids/keys/versions/units/bounded amounts/reason codes only — no secret/credential/raw body/PII | **PASS** |
| **Events / outbox** — `subscription.lifecycle` (4) + `usage.lifecycle` (2) + `billing.lifecycle` (2) = 8 types, registered once (m39-owned, newest tail), privacy-safe payloads; one m06 outbox (m39 owns none); no fake finance/payment events | **PASS** |
| **Tenancy / privacy** — 13/13 FORCE RLS; tenant A cannot read tenant B subscription/usage (proven); cross-tenant capability binding impossible; a tenant cannot create platform-scope plans without the control-plane permission; usage evidence is minimal (tenant/meter/quantity/period/source-ref/idempotency key — no raw payloads/credentials/secrets) | **PASS** |
| **No REST bypass** — every mutating `/api/v1/saas` route authorizes a `saas.*` permission + carries an auditCode via `@Endpoint` (**17 guarded routes** across 2 controllers: 6 + 11); no route executes a finance posting or payment; reads default-deny in-service | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 76) · tables 13 · FORCE RLS 13 · policies 13 · composite FKs 6 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 8 (0 UPDATE) · mutable aggregates 5 · governance CHECKs 37 · version columns 5 · float 0 · secret-value
columns 0 · immutability triggers 1 · permissions 12 (privileged 4) · audit codes 22 (registry 923) · event families 3
(`subscription/usage/billing.lifecycle`, 8 types) · outboxes 1 (m06) · routes `/api/v1/saas` (17 guarded) · smoke 7378/44 ·
conformance 3729 · DB/API 2775/91 (m39-saas 33 · m39-services 27).

## Contamination — CLEAN

Only `packages/m39-saas/*` + the `subscription/usage/billing.lifecycle` contracts families + `apps/api/src/saas/*` + the
contracts event wiring + the `m02-identity` family-count smoke assertion + registries/manifests/docs + root/api `tsconfig.json`
+ `package-lock.json` were added on the implementation branch. **m01–m38 source untouched** (m02 RBAC, m30 feature flags and
m19/m21 finance consumed by contract, not read/modified; the m06 outbox consumed by contract — m39 owns no outbox; no
`workflow_*`/`connector_*`/`marketplace_*`/`devportal_*`/`webhook_*`/`govrelease_*`/`automation_*` prefix collision — m39 uses
`saas_*`); no m40+/m41 implementation; no second tenancy/RBAC/feature/analytics/quota/outbox engine; no finance ledger/posting
engine; no billing provider/network; no secret manager; no historical migration edited; no permission/RLS bypass.

## Documented limitations

- `mvp:false`. reference_tables reconciled **72 → 13** — the governed commercial-SaaS core.
- The m30 feature leg and the billing provider are fail-closed ports (default deny / collect-nothing); the real m30 feature
  engine and the real (M41-era) billing provider drop in behind the ports unchanged. `requires_review` [billing_provider,
  plan_taxonomy] was resolved to its OPEN_QUESTIONS #2/#3 confirmed defaults (internal billing model + a minimal internal pilot
  plan; a real provider + the commercial catalogue precede external GA).
- The **M35 → M39 composition-root adapter is deferred** pending the `appRef → capability` mapping decision; m35 stays
  fail-closed (`UnavailableUsageQuota` ⇒ deny) until it is wired — an intentional, honest boundary.
- Resilience (m40), security/secrets (m41) and certification (m42) are deferred (not this module). M39 is a HARD dependency of
  m41 and m42.

## Report path

`docs/build/stages/STAGE_6_M39_SAAS_CERTIFICATION.md` (this file); implementation evidence lives in PR #101.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
