# Stage 6D-2 — M34 Connector Marketplace — Certification

**Module:** `m34-marketplace` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-11. **Fifth Stage-6 module certified.**
**ADR:** ADR-121 (marketplace over m33 by contract; consent human-governed; secretref-only install secrets; GAP-4 resolved; `marketplace_*` prefix).

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #85 — merged → `main` `fa7f1ce` (m34 `approved_for_build`) |
| Implementation PR | #86 — closed, merged, merged_at `2026-08-10T13:53:05Z` |
| Reviewed implementation head | `e7e578d` |
| Implementation merge SHA | `597ca2ee6719fca898a1009391b4e9b560074c63` (single parent `fa7f1ce` = squash) |
| Tree equivalence | `git diff e7e578d 597ca2ee` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `597ca2ee6719fca898a1009391b4e9b560074c63` |
| Certification branch | `cert/stage-6-m34-marketplace` (from `597ca2ee`) |
| Implementation CI (reviewed head `e7e578d`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |
| Implementation CI (merge commit `597ca2e`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m34-marketplace` · Stage 6D-2 · **Connector Marketplace** (catalog listings, tenant installations, consent and
upgrades over the connectors m33 defines) · **mvp:false** · **consumes m33 by contract — not a duplicate connector engine,
not a secrets manager, no arbitrary code** · **`/api/v1/connectors`** · `marketplace.*` permissions · audit prefix
`MARKETPLACE_` · event family `marketplace.lifecycle` · one m06 outbox · consumes **m33's `ConnectorService` through a
fail-closed `ConnectorRegistryPort`** · uses the **`marketplace_*`** table prefix (m23 keeps `integration_*`, m33 keeps
`connector_*`) · **M41 real secrets deferred behind a fail-closed port**.

## C. Local certification gates (clean checkout on baseline `597ca2ee`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| generated-output cleanup (`tsc --build --clean`) | done |
| format:check | pass |
| lint | **0 errors** (68 pre-existing baseline warnings; m34 adds none) |
| build | pass |
| smoke lane | 39 suites, **6590** assertions, 0 failures (m34-marketplace 85 · conformance **3437**) |
| migration ordering + checksums (dry-run) | pass (`6b04db6183fe`, `e169538f397f`) |
| fresh migration replay | **66** migrations applied (m34 = 2; no historical migration edited) |
| DB/API lane (fresh DB) | **81** specs, **2490** assertions, 0 failures |
| — `m34-marketplace` DB spec | 32 |
| — `m34-services` DB spec | 19 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 DB lane, the merge commit's PG16 DB lane, and this cert PR's lanes are the authoritative PG16 evidence.

## D. Database — live catalogue evidence (m34-owned 9 marketplace_* tables, non-owner application role)

9 tables · **9/9 RLS ENABLE · 9/9 FORCE · 9/9 `tenant_isolation`** · **5 composite tenant-safe FKs · 0 unsafe single-column
tenant FKs** · **0 DELETE grants** · 5 append-only ledgers (INSERT+SELECT: `marketplace_listing_capability`, `_upgrade`,
`_review`, `_history`, `_idempotency`) · 4 mutable aggregates (INSERT+SELECT+UPDATE: `marketplace_listing`, `_installation`,
`_consent`, `_install_secret`) · **24 governance CHECK constraints** · 4 version columns · **0 float** · **0 secret-value
columns** (`marketplace_install_secret.secret_ref` is a `text` opaque pointer with a `secretref:`-shape CHECK) · **1
published-immutability trigger** (`marketplace_listing`) · **1 outbox (m06 — m34 owns none)** · 8 `marketplace.*` permissions
(5 privileged, all 3-segment, no wildcard) · 16 `MARKETPLACE_` audit codes · `marketplace.lifecycle` (7 event types) ·
**66 total migrations**. reference_tables reconciled **25 → 9** (documented in module-registry + implementation-manifest —
the 25 was the full reference-implementation baseline; this Stage-6D-2 core is the governed marketplace over m33 connectors).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **Consumes m33 by contract — no duplicate connector engine** — a listing/installation references an m33 connector by an OPAQUE `connector_ref`, resolved only through the fail-closed `ConnectorRegistryPort` (`M33ConnectorRegistryAdapter` wraps m33 `ConnectorService.getConnector`, read-only; available iff the connector is `published`); m34 source reads NO `connector_*` table and executes NO connector | **PASS** |
| **Human-only consent** — `evaluateConsentGate` refuses a null/`system`/`ai`/`automation` grantor (`isHumanActor`); DB `marketplace_consent_human_ck` (granted ⇒ granted_by NOT NULL); the services DB spec proves AI can never consent | **PASS** |
| **Consent revocation withdraws access** — `revokeConsent` suspends the installation (`active` → `suspended`); proven end-to-end in the services DB spec | **PASS** |
| **Publication + upgrade are maker-checker/SoD; AI cannot approve** — listing publication requires a human approver ≠ requester (`marketplace_review_sod_ck` + `_decider_ck`), a passing validation (`evidence_ck`), and a connector PUBLISHED in m33 (fail closed); an upgrade requires a human approver ≠ the install requester + active consent; the requester cannot self-approve; AI is refused | **PASS** |
| **Not a secrets manager (M30 seam / M41 boundary)** — install secrets are opaque `secretref:` pointers (`marketplace_install_secret_ref_shape_ck`); an install config is screened for raw secret values (`screenInstallConfig`, fail closed); **0 secret-value columns**; real resolution deferred to M41 behind a fail-closed port | **PASS** |
| **Published-listing immutability** — a published listing is immutable (trigger; only → deprecated); one published listing per key (`marketplace_listing_one_published`); proven in the DB spec | **PASS** |
| **No arbitrary code / egress** — no eval/`Function`/`vm`/shell/`child_process`/network/`fetch` in m34 source; no production provider execution; no direct DB access to other modules' tables | **PASS** |
| **GAP-4 resolved — `marketplace.*` namespace** — 8 codes, all 3-segment, 5 privileged (`listing.publish`, `consent.manage`, `install.manage`, `upgrade.apply`, `control.administer`); no `marketplace.admin`/wildcard; default deny | **PASS** |
| **M23 / M33 boundary — no prefix collision** — m34 uses `marketplace_`; the `integration_*` tables remain m23's, `connector_*` remain m33's; m23/m28/m30/m31/m32/m33 source untouched | **PASS** |
| **Events / outbox** — `marketplace.lifecycle` registered once (m34-owned, newest tail), 7 event types, privacy-safe payloads (ids/keys/category/opaque connector_ref/version/status/reason codes only); one m06 outbox (m34 owns none) | **PASS** |
| **Audit** — 16 `MARKETPLACE_*` codes, registry **830**, source↔registry parity; no config/secret/external content in payloads | **PASS** |
| **Idempotency / concurrency** — `marketplace_idempotency` unique key; version CAS rejects stale writes; idempotent install/upgrade | **PASS** |
| **Tenancy / privacy** — FORCE RLS across listings/installations/consents/upgrades; cross-tenant invisible; composite tenant-safe FKs; no secret persistence; bounded evidence | **PASS** |
| **No REST bypass** — every mutating `/api/v1/connectors` route authorizes a `marketplace.*` permission via `@Endpoint`; reads default-deny in-service | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 66) · tables 9 · FORCE RLS 9 · policies 9 · composite FKs 5 · unsafe tenant FKs 0 · DELETE grants 0 ·
append-only ledgers 5 · mutable aggregates 4 · governance CHECKs 24 · version columns 4 · float 0 · secret-value columns 0 ·
immutability triggers 1 · permissions 8 (privileged 5) · audit codes 16 (registry 830) · event families 1
`marketplace.lifecycle` (7 types) · outboxes 1 (m06) · routes: `/api/v1/connectors` · smoke 6590/39 · conformance 3437 ·
DB/API 2490/81 (m34-marketplace 32 · m34-services 19).

## Contamination — CLEAN

Only `packages/m34-marketplace/*` + the `marketplace.lifecycle` contracts family + `apps/api/src/marketplace/*` + registries/
manifests/docs were added on the implementation branch. **m23-finance-integration untouched** (no `integration_*` collision —
m34 uses `marketplace_`); **m33-integration consumed by contract, not modified** (no `connector_*` collision; no duplicate
connector SDK/registry/runtime/connection/secret engine); m28/m30/m31/m32 source untouched; no m35+ or m41 implementation;
no second outbox/scheduler/notification/RBAC/audit engine; no production network/provider dependency; no arbitrary-code
runner; no historical migration edited; no business-state mutation; no permission/RLS bypass.

## Documented limitations

- `mvp:false`. reference_tables reconciled **25 → 9** — the governed marketplace core over m33 connectors.
- The m33 connector-registry consumption + the M41 secret backend are deterministic offline doubles / fail-closed ports;
  the real m33 `ConnectorService` and the real M41 drop in behind the ports unchanged.
- Developer portal (m35), webhooks/event-streaming (m36) and integration governance/release (m37) are deferred (not this
  module).

## Report path

`docs/build/stages/STAGE_6_M34_MARKETPLACE_CERTIFICATION.md` (this file); implementation evidence lives in PR #86.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
