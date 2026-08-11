# Stage 6D-3 — M35 Public APIs & Developer Portal — Certification

**Module:** `m35-devportal` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-11. **Sixth Stage-6 module certified.**
**ADR:** ADR-122 (governed API-gateway facade — never bypasses RBAC/tenancy; credentials = one-way hash XOR opaque `secretref:`, never plaintext; human/maker-checker controlled actions; consumes m34/m33/m39 by fail-closed contract; `devportal.*` closes GAP-4; `devportal_*` prefix).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #88 — merged → `main` `e9b3b1f` (m35 `approved_for_build`) |
| Implementation PR | #89 — closed, merged, merged_at `2026-08-11T11:02:05Z` |
| Reviewed implementation head | `5156e07` |
| Implementation merge SHA | `6a77000407ec9a17a285072f4c4a84685b6f676d` (single parent `e9b3b1f` = squash) |
| Tree equivalence | `git diff 5156e07 6a77000` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `6a77000407ec9a17a285072f4c4a84685b6f676d` |
| Certification branch | `cert/stage-6-m35-devportal` (from `6a77000`) |
| Implementation CI (reviewed head `5156e07`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |
| Implementation CI (merge commit `6a77000`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m35-devportal` · Stage 6D-3 · **Public APIs & Developer Portal** (developer applications, API credentials, published
API products, app subscriptions / public exposure) · **mvp:false** · a governed API-gateway **FACADE** — **not** a second
authorization path, **not** a secrets manager, **no** duplicate connector/marketplace/quota engine, **no** arbitrary code ·
**`/api/v1/developer`** · `devportal.*` permissions · audit prefix `DEVPORTAL_` · event family `devportal.lifecycle` · one m06
outbox · consumes **m34** (`ListingService.getListing`) + **m33** (`ConnectorService.getConnector`) through a fail-closed
`CatalogSourcePort` and **m39** quotas through a fail-closed `UsageQuotaPort` · uses the **`devportal_*`** table prefix
(`integration_*` is m23's, `connector_*` is m33's, `marketplace_*` is m34's) · **M39 quota + M41 secret backends deferred behind fail-closed ports**.

## C. Local certification gates (clean checkout on baseline `6a77000`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m35 adds none) |
| build | pass |
| smoke lane | 40 suites, **6747** assertions, 0 failures (m35-devportal 99 · conformance **3493**) |
| migration ordering + checksums (dry-run) | pass (`9ba0b3e322de`, `ed170a2387cc`) |
| fresh migration replay | **68** migrations applied (m35 = 2; no historical migration edited) |
| DB/API lane (fresh DB) | **83** specs, **2553** assertions, 0 failures |
| — `m35-devportal` DB spec | 36 |
| — `m35-services` DB spec | 27 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 DB lane, the merge commit's PG16 DB lane, and this cert PR's lanes are the authoritative PG16 evidence.

## D. Database — live catalogue evidence (m35-owned 9 devportal_* tables, non-owner application role)

9 tables · **9/9 RLS ENABLE · 9/9 FORCE · 9/9 `tenant_isolation`** · **5 composite tenant-safe FKs · 0 unsafe single-column
tenant FKs** · **0 DELETE grants** · 5 append-only ledgers (INSERT+SELECT: `devportal_product_scope`, `_review`,
`_credential_event`, `_history`, `_idempotency`) · 4 mutable aggregates (INSERT+SELECT+UPDATE: `devportal_app`,
`_api_product`, `_credential`, `_subscription`) · **26 governance CHECK constraints** · 4 version columns · **0 float** ·
**0 plaintext credential/secret-value columns** (a credential holds a one-way `secret_hash` (`sha256:` shape CHECK) XOR an
opaque `secret_ref` (`secretref:` shape CHECK); `material_ck` enforces exactly one) · **1 published-immutability trigger**
(`devportal_api_product`) · **1 outbox (m06 — m35 owns none)** · 8 `devportal.*` permissions (4 privileged, all 3-segment, no
wildcard) · 18 `DEVPORTAL_` audit codes · `devportal.lifecycle` (7 event types) · **68 total migrations**. reference_tables
reconciled **18 → 9** (documented in module-registry + implementation-manifest — the 18 was the full reference-implementation
baseline; this Stage-6D-3 core is the governed developer portal + gateway facade).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **Governed facade — never bypasses m02 RBAC / m01 tenancy** — a product exposes only ALLOW-LISTED operations, and every operation carries the m02 permission it requires (`devportal_product_scope.required_permission` NOT NULL + 3-segment CHECK; the service refuses a non-3-segment permission; validation fails closed if any operation lacks one). Public exposure resolves to a tenant + authenticated principal; the portal is not a second authorization path | **PASS** |
| **Credential material = one-way hash XOR opaque `secretref:` — no plaintext** — `devportal_credential_material_ck` enforces exactly one of `secret_hash` (`sha256:` shape) XOR `secret_ref` (`secretref:` shape); **0 plaintext/secret-value columns** (verified against the credential-value regex, excluding structural `_id`/`_ref`/`_hash`); a generated secret is returned to the caller ONCE and only the hash is persisted; real key mgmt deferred to M41 behind a fail-closed port | **PASS** |
| **Human-only controlled actions; AI cannot issue/approve** — credential issuance/rotation/revocation refuse a null/`system`/`ai`/`automation` actor (`evaluateCredentialActorGate` — AI never issues); product publication + subscription approval are maker-checker/SoD (`devportal_review`/`devportal_subscription_sod_ck` decider/approver ≠ requester, human; AI never approves); the requester cannot self-approve | **PASS** |
| **Product publication governance** — publication requires a passing validation (evidence_ck), an independent human approver, a PUBLIC product additionally requires the cross-tenant control-plane permission, and the source must be PUBLISHED upstream in m33/m34 (fail-closed `CatalogSourcePort`); a published product is IMMUTABLE (trigger; only → deprecated), one published per key | **PASS** |
| **Subscription / credential lifecycle controls** — subscription request → maker-checker approval → suspension; a PUBLIC subscription is gated by the m39 quota (fail closed while m39 is unbuilt); credential active → rotated → revoked with append-only evidence | **PASS** |
| **Consumes m34/m33/m39 by contract (no duplicate engine)** — a product references an m34 listing / m33 connector by OPAQUE `source_ref` resolved only through the fail-closed `CatalogSourcePort` (`CatalogSourceAdapter` wraps read-only `ListingService.getListing` / `ConnectorService.getConnector`); m35 source reads NO m33/m34 table; quotas come from m39 through the fail-closed `UsageQuotaPort` — m35 owns no connector/marketplace/quota engine | **PASS** |
| **Not a secrets manager (M30 seam / M41 boundary)** — credentials use the m30 `secretref:` seam or a one-way hash; 0 secret-value columns; M41 real resolution deferred behind a fail-closed port | **PASS** |
| **Fail-closed deferred services** — an unavailable upstream source, and the unbuilt m39 quota, both DENY (never guess): `UnavailableSourceCatalog`/`UnavailableUsageQuota`; the API module binds `UnavailableUsageQuota` so PUBLIC exposure fails closed until m39 is built | **PASS** |
| **Events / outbox** — `devportal.lifecycle` registered once (m35-owned, newest tail), 7 event types, privacy-safe payloads (ids/keys/statuses/reason codes only — never a secret, credential, config value or external payload); one m06 outbox (m35 owns none) | **PASS** |
| **Permissions** — `devportal.*`, 8 codes all 3-segment, 4 privileged (product.publish/credential.manage/subscription.manage/control.administer); no `devportal.admin`/wildcard; default deny | **PASS** |
| **Audit** — 18 `DEVPORTAL_*` codes, registry **848**, source↔registry parity; no secret/credential/config/external content in payloads | **PASS** |
| **Idempotency / concurrency** — `devportal_idempotency` unique key; version CAS rejects stale writes; idempotent register/issue/subscribe | **PASS** |
| **Tenancy / privacy** — FORCE RLS across apps/products/credentials/subscriptions; cross-tenant invisible; composite tenant-safe FKs; no plaintext secret persistence; bounded evidence | **PASS** |
| **No REST bypass / no arbitrary code** — every mutating `/api/v1/developer` route authorizes a `devportal.*` permission via `@Endpoint`; reads default-deny in-service; no eval/`Function`/`vm`/shell/`child_process`/network/`fetch` in source; no production provider egress | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 68) · tables 9 · FORCE RLS 9 · policies 9 · composite FKs 5 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 5 · mutable aggregates 4 · governance CHECKs 26 · version columns 4 · float 0 · plaintext secret columns 0
· immutability triggers 1 · permissions 8 (privileged 4) · audit codes 18 (registry 848) · event families 1
`devportal.lifecycle` (7 types) · outboxes 1 (m06) · routes: `/api/v1/developer` · smoke 6747/40 · conformance 3493 · DB/API
2553/83 (m35-devportal 36 · m35-services 27).

## Contamination — CLEAN

Only `packages/m35-devportal/*` + the `devportal.lifecycle` contracts family + `apps/api/src/devportal/*` + registries/
manifests/docs were added on the implementation branch. **m23/m28/m30/m31/m32/m33/m34 source untouched** (m33/m34 consumed by
contract, not modified; no `integration_*`/`connector_*`/`marketplace_*` collision — m35 uses `devportal_*`); no m36+/m39/m41
implementation; no second connector/marketplace/quota/secrets/RBAC/audit/outbox engine; no production network/provider
dependency; no arbitrary-code runner; no historical migration edited; no business-state mutation; no permission/RLS bypass.

## Documented limitations

- `mvp:false`. reference_tables reconciled **18 → 9** — the governed developer portal + gateway facade core.
- The m34/m33 catalog consumption, the M39 quota backend and the M41 secret backend are deterministic offline doubles /
  fail-closed ports; the real M39 and M41 drop in behind the ports unchanged.
- Webhooks/event-streaming (m36), integration governance/release (m37), SaaS/quotas (m39) and security/secrets (m41) are
  deferred (not this module).

## Report path

`docs/build/stages/STAGE_6_M35_DEVPORTAL_CERTIFICATION.md` (this file); implementation evidence lives in PR #89.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
