# @finapp/m30-platform — Platform Foundation (Stage 6A, mvp:false)

The first Stage-6 module — the horizontal **platform foundation** every domain reuses. The **canonical owner** of
governed platform **metadata**, **configuration** (typed definitions + values + history), **feature flags** (definitions
+ assignments + deterministic evaluation + history) and the **secret-reference seam** (opaque `secretref:` pointers).

## Hard rules

- **A feature flag is NEVER an authorization substitute.** RBAC (m02) stays authoritative — a flag can never grant a
  permission RBAC denies (`RBAC DENY + FEATURE ENABLED = DENY`, tested). Evaluation is independent of authz.
- **A platform-ABSOLUTE control can never be weakened by a tenant override** (`evaluateAbsoluteAssignmentGate` →
  `PLATFORM_FEATURE_OVERRIDE_BLOCKED`; absolute flags evaluate to their platform default regardless of assignment).
- **Zero secret values.** M30 owns the secret-reference **seam** only: opaque `secretref:` pointers (shape-checked), with
  **no password/key/token/credential VALUE column** anywhere (DB-proven). A secret-bearing config value carries a
  reference XOR a plain value (`platform_config_value_secret_ck`). Real secret/key management is **m41-security**, behind
  a fail-closed `SecretResolver` port (deterministic double only — no production adapter, no network).
- **Platform vs tenant.** A `platform`-scoped (control-plane) mutation requires `platform.control.administer`, which a
  tenant admin never holds by default. Request-supplied identifiers create no authority.

## Ownership (GAP-5, ADR-115)

Feature flags were **never implemented** anywhere; `m04-admin` is an **orchestration-only** admin console with no flag
engine. **M30 is the canonical owner** of the one feature-flag engine (+ platform metadata/config/secret-reference seam);
`m04-admin` **consumes** M30 by contract. No duplicate engine.

## What it owns

- **10 tables**: `platform_metadata`, `platform_config_definition`, `platform_config_value`, `platform_feature_definition`,
  `platform_feature_assignment`, `platform_secret_reference` (mutable aggregates) + `platform_config_history`,
  `platform_feature_history`, `platform_secret_reference_history`, `platform_idempotency` (append-only). All tenant-scoped
  FORCE-RLS + `tenant_isolation` (a platform-scope row carries `scope='platform'`), composite PK/FKs, no DELETE grant,
  no float, **no secret value column**.
- **9 permissions** in the new `platform.*` namespace (GAP-2, ADR-115): `platform.metadata/config/feature.read|manage`,
  `platform.secret.read|manage`, `platform.control.administer`. 6 privileged.
- **11 audit codes** under `PLATFORM_`.
- **`platform.lifecycle` event family** (declared in contracts; published through the one m06 outbox — no second outbox).

## What it does NOT own / do

- No REST API (`api_prefixes: []` — internal governed library, ADR-116); `m04-admin` orchestrates over M30's contracts.
- No secrets/key management (m41), no second RBAC/audit/workflow/outbox/feature-flag engine, no production provider, no network.

## Tests

- `test/m30-platform.smoke.ts` — PURE: scopes, feature evaluation, absolute-control + secrets-seam gates, secretref validation, permissions, audit codes.
- `test/m30-platform.db-spec.ts` — schema/governance (RLS/FORCE, grants, CHECKs incl. secrets-seam + shape, **zero secret-value columns**, isolation).
- `test/m30-services.db-spec.ts` — end-to-end: config (plain + secret-bearing → reference only; raw secret refused), features (absolute not overridable; **flag never bypasses RBAC**), platform-scope requires control-plane permission, secret references, idempotency, cross-tenant.

See ADR-115, ADR-116 and `docs/build/stages/STAGE_6_M30_PLATFORM_*`.
