# Stage 6A — M30 Platform Foundation — Architecture

**Module:** `m30-platform` · **Stage:** 6A (first Stage-6 module) · **MVP:** false · **Branch:** `feature/stage-6-m30-platform`
**Spec:** `docs/03-platform/ENTERPRISE_PLATFORM_PHASE_6.md` · **ADRs:** ADR-115 (GAP-5/GAP-2), ADR-116 (secrets seam / events / no API).

## 1. Purpose
The horizontal platform foundation: canonical owner of governed platform metadata, configuration, feature flags and the
secret-reference seam. Consumed by every domain and by the m04-admin console.

## 2. Hard rules
| Rule | Enforcement |
|------|-------------|
| Feature flag is NEVER an authz substitute | evaluation independent of authz; `isFeatureEnabled` authorizes only `platform.feature.read`; RBAC (m02) authoritative — RBAC DENY + FEATURE ENABLED = DENY (tested) |
| Absolute control not overridable | `evaluateAbsoluteAssignmentGate` (assignment refused, `PLATFORM_FEATURE_OVERRIDE_BLOCKED`) + `evaluateFeature` (absolute ignores tenant override) |
| Zero secret values | secret-reference seam only; `platform_config_value_secret_ck` (value XOR ref); `*_ref_shape_ck` (secretref: shape); DB-proven 0 secret-value columns; real key mgmt = m41 behind `SecretResolver` port |
| Platform vs tenant | `scope='platform'` mutation requires `platform.control.administer` (tenant admin never holds it) |

## 3. Ownership (GAP-5 resolved, ADR-115)
Feature flags were never implemented; m04-admin is orchestration-only (no flag engine). M30 is the canonical owner of the
feature-flag engine + platform metadata/config/secret-reference seam; m04-admin consumes M30 by contract. No duplicate engine.

## 4. Data model (10 tables, all tenant-scoped FORCE-RLS + tenant_isolation)
Mutable aggregates (versioned): `platform_metadata`, `platform_config_definition`, `platform_config_value`,
`platform_feature_definition`, `platform_feature_assignment`, `platform_secret_reference`. Append-only ledgers:
`platform_config_history`, `platform_feature_history`, `platform_secret_reference_history`, `platform_idempotency`.
Composite (tenant_id,id) PK/FKs; no DELETE grant; no float; no secret VALUE column; a `scope` discriminator +
control-plane permission model the platform-vs-tenant boundary (mirroring m04-admin's proven all-tenant-scoped pattern).

## 5. Contracts
- Permissions: new `platform.*` namespace (GAP-2, ADR-115) — 9 codes, 6 privileged; `platform.control.administer` is the control-plane permission.
- Audit: 11 `PLATFORM_*` codes.
- Events: declares + owns `platform.lifecycle` (contracts + event-registry) via the one m06 outbox. No second outbox/family beyond it.
- API: none (`api_prefixes: []`, ADR-116) — internal library; m04-admin orchestrates over M30's public service ports.

## 6. Services / ports
`PlatformMetadataService`, `PlatformConfigService` (impl `PlatformConfigResolvePort`), `PlatformFeatureService` (impl
`PlatformFeatureEvaluatePort`), `PlatformSecretReferenceService` (uses the fail-closed `SecretResolver` port). Consumers
use the read ports (opaque ids; secret-bearing config yields the opaque reference only). Consumes m01/m02/m03/m06 by contract.
