# Database Schema Catalogue

PostgreSQL 16. ~898 tables in the reference baseline; 886 tenant-scoped with RLS FORCE + `tenant_isolation`
policies + composite `(tenant_id, id)` keys + composite FKs; 12 legitimately global.

## Conventions (mandatory)
- Composite `(tenant_id, id)` UNIQUE + composite foreign keys `(tenant_id, parent_id)`.
- `COMMENT ON TABLE x IS 'class=...'` on every table.
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation ... USING (tenant_id = current_setting('app.tenant_id')::uuid)` on every tenant-scoped table.
- Decimal-safe money (minor units / exact decimal), never float. Timestamps UTC.
- Soft-delete via status + `removed_at`/`removed_by` (never `deleted_at`/`deleted_by`).
- Idempotency keys on high-risk actions; immutable histories for audit/evidence/decisions.

## Global (non-FORCE) tables — the enumerated exception
m01: tenants, subsidiaries, subscription_plans, tenant_subscriptions, usage_meters (tenancy control plane).
m03: audit_code_registry, chain_anchors, partitioned audit_logs (audit spine). m02: login_attempts (pre-auth).
m06: entity_type_registry (global reference). No tenant business table lacks FORCE.

## Per-module table counts (reference baseline)
See `PROJECT_INDEX.md` for the full table. Largest owners: m41-security (79), m39-saas (72), m18-legaldocs (49),
m38-automation (44), m42-certification (43), m32-analytics (42), m33-integration (38), m17-recovery (38),
m36-events (34), m16-litigation (31).

## Migration ordering
A single ordered migration runner applies module migrations in dependency order (m01 → … → m42). The authoritative
`tenants` table lives in m01 and is referenced, never duplicated.
