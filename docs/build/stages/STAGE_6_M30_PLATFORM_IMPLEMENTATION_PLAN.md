# Stage 6A — M30 Platform Foundation — Implementation Plan

Ordered, reviewable units (as committed):

1. **Architecture / ADRs / ownership** — ADR-115 (GAP-5 feature-flag ownership + GAP-2 permission namespace), ADR-116 (secrets seam + events + no API); SHARED_SERVICE_OWNERSHIP.md rows (m30 canonical for metadata/config/feature-flags; secret references); stage docs + README.
2. **Migrations / domain** — `0001_platform.sql` (10 tables; RLS FORCE, tenant_isolation, secrets-seam + shape CHECKs, platform.* permission seed), `0002_grant_application_role.sql` (no DELETE; append-only ledgers INSERT+SELECT); pure `domain.ts` (scopes, value types, feature evaluation, absolute + config-value/secrets gates, secretref validation, reason codes).
3. **Contracts / emitter / ports / services** — `contracts/platform-events.ts` (platform.lifecycle declared + appended to the union tail), `emit.ts` (authorized platform.lifecycle emitter over the one m06 outbox), `ports.ts` (fail-closed SecretResolver + public read ports), `repository.ts`, services (metadata/config/feature/secret).
4. **Tests** — pure smoke, schema DB spec, services DB spec.
5. **Registries / manifest / docs** — permission-registry (platform.* namespace), audit-code-registry (11 PLATFORM_*, count 757->768), naming-map (GAP-2/GAP-5 resolved), module-registry (implemented; reference_tables reconciled 26->10), implementation-manifest.

## Key design decisions
- **All tables tenant-scoped FORCE-RLS with a `scope` discriminator** (mirroring m04-admin), avoiding new global tables and the associated ADR/RLS complexity; a `platform`-scope row is authorized by the control-plane permission.
- **The secret-reference seam stores zero values** — a secret-bearing config value holds an opaque `secretref:` XOR a plain value (DB CHECK); real resolution is a fail-closed port double; m41 plugs in later.
- **Feature flags are decoupled from authz** — evaluation returns only enabled/disabled and never short-circuits an authz check; absolute flags ignore tenant overrides.
- **reference_tables reconciled 26 -> 10** — the 26 was the full reference-implementation baseline; this Stage-6A foundation implements the governed core (documented in module-registry + completion report).
