-- ---------------------------------------------------------------------------------------------------
-- M30-platform — PLATFORM FOUNDATION (Stage 6A, mvp:false): the canonical owner of governed platform METADATA,
-- CONFIGURATION (typed definitions + values + history), FEATURE FLAGS (definitions + assignments + evaluation + history)
-- and the SECRET-REFERENCE SEAM (opaque secretref: pointers only). THE HARD RULES ARE DB-ENFORCED: M30 stores ZERO
-- secret VALUES — a secret-bearing config value carries ONLY an opaque secret_ref (secretref: shape CHECK), never a
-- value (platform_config_value_secret_ck: value_json and secret_ref are mutually exclusive); there is NO password/key/
-- token/credential VALUE column anywhere. A platform-ABSOLUTE feature/config cannot be weakened by a tenant override
-- (enforced in-service + a scope discriminator). A feature flag is NEVER an authorization substitute — RBAC (m02) stays
-- authoritative (evaluation is independent of authz; enforced in-service + tested). M30 CONSUMES the canonical platform
-- services (m01/m02/m03/m06) BY CONTRACT and owns NO second engine, NO second outbox (it emits platform.lifecycle
-- through the ONE m06 outbox). m04-admin is the admin CONSOLE that orchestrates over M30's public contracts (GAP-5,
-- ADR-115). Every tenant-scoped table (M30 mirrors m04-admin's all-tenant-scoped model; a platform-scope row carries
-- scope='platform' and is authorized by the platform permission): composite (tenant_id, id) PK + UNIQUE, RLS
-- ENABLE+FORCE + tenant_isolation, composite FKs (within m30), version on mutable aggregates. No DELETE grant (ADR-010).
-- Config/feature/secret-reference histories and the idempotency ledger are append-only (INSERT+SELECT, 0002). No float.
-- PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- GAP-2 resolution (ADR-115): the platform.* permission namespace. Three-segment platform.<area>.<action>; every
-- controlled config/flag/metadata/secret-seam operation authorizes one (default deny). Mirroring m04-admin's admin.*
-- split, platform.administer is the cross-tenant CONTROL-PLANE permission a tenant admin never holds by default;
-- manage/secret codes are privileged. There is NO platform.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('platform.metadata.read', 'm30-platform', 'platform_metadata', false),
  ('platform.metadata.manage', 'm30-platform', 'platform_metadata', true),
  ('platform.config.read', 'm30-platform', 'platform_config', false),
  ('platform.config.manage', 'm30-platform', 'platform_config', true),
  ('platform.feature.read', 'm30-platform', 'platform_feature', false),
  ('platform.feature.manage', 'm30-platform', 'platform_feature', true),
  ('platform.secret.read', 'm30-platform', 'platform_secret_reference', true),
  ('platform.secret.manage', 'm30-platform', 'platform_secret_reference', true),
  ('platform.control.administer', 'm30-platform', 'platform', true);

-- platform_metadata — governed platform-metadata catalog (a controlled category KEY -> bounded json value). NOT a
-- tenant/identity mirror (category is a controlled vocabulary). One active per (tenant, scope, meta_key).
CREATE TABLE platform_metadata (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', category text NOT NULL, meta_key text NOT NULL, value_json jsonb,
  status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT platform_metadata_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_metadata_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_metadata_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT platform_metadata_category_ck CHECK (category IN ('platform_info','capability','branding','locale','operational','custom')),
  CONSTRAINT platform_metadata_status_ck CHECK (status IN ('active','retired')),
  CONSTRAINT platform_metadata_optlock_ck CHECK (version >= 1));
ALTER TABLE platform_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_metadata FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_metadata
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX platform_metadata_one_active ON platform_metadata (tenant_id, scope, meta_key) WHERE status = 'active';
CREATE UNIQUE INDEX platform_metadata_idem ON platform_metadata (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE platform_metadata IS 'class=tenant_aggregate; m30 governed platform metadata (controlled categories; not a tenant/identity mirror)';

-- platform_config_definition — a governed configuration KEY definition (typed; scope; whether it is secret-bearing;
-- whether it is a platform-ABSOLUTE control a tenant cannot override). One active per (tenant, scope, config_key).
CREATE TABLE platform_config_definition (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', config_key text NOT NULL, value_type text NOT NULL DEFAULT 'text',
  secret_bearing boolean NOT NULL DEFAULT false, is_absolute boolean NOT NULL DEFAULT false, required boolean NOT NULL DEFAULT false,
  description text, status text NOT NULL DEFAULT 'draft', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT platform_config_definition_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_config_definition_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_config_definition_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT platform_config_definition_type_ck CHECK (value_type IN ('text','number','boolean','json','secret_ref')),
  CONSTRAINT platform_config_definition_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT platform_config_definition_optlock_ck CHECK (version >= 1));
ALTER TABLE platform_config_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_config_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_config_definition
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX platform_config_definition_one_active ON platform_config_definition (tenant_id, scope, config_key) WHERE status = 'active';
CREATE UNIQUE INDEX platform_config_definition_idem ON platform_config_definition (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE platform_config_definition IS 'class=tenant_aggregate; m30 governed config-key definition (typed; secret-bearing; platform-absolute)';

-- platform_config_value — the VALUE for a config definition. THE SECRETS SEAM: a plain value is jsonb (value_json); a
-- secret-bearing value carries ONLY an opaque secret_ref (secretref: shape) — NEVER a secret value. The two are mutually
-- exclusive (platform_config_value_secret_ck). No password/key/token/credential VALUE column exists.
CREATE TABLE platform_config_value (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), definition_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'tenant', value_json jsonb, secret_ref text, status text NOT NULL DEFAULT 'active',
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT platform_config_value_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_config_value_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_config_value_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT platform_config_value_status_ck CHECK (status IN ('active','superseded')),
  -- SECRETS SEAM: a value is EITHER a plain json value OR an opaque secret reference, never both (no secret value stored).
  CONSTRAINT platform_config_value_secret_ck CHECK (value_json IS NULL OR secret_ref IS NULL),
  -- an opaque secret reference must match the repository secretref: shape (m24 convention) — a POINTER, never a value.
  CONSTRAINT platform_config_value_ref_shape_ck CHECK (secret_ref IS NULL OR secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT platform_config_value_optlock_ck CHECK (version >= 1),
  CONSTRAINT platform_config_value_def_fkey FOREIGN KEY (tenant_id, definition_id) REFERENCES platform_config_definition (tenant_id, id));
ALTER TABLE platform_config_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_config_value FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_config_value
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX platform_config_value_one_active ON platform_config_value (tenant_id, definition_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX platform_config_value_idem ON platform_config_value (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE platform_config_value IS 'class=tenant_aggregate; m30 config value (plain json OR opaque secret_ref, mutually exclusive; zero secret values)';

-- platform_config_history — append-only config-change evidence (definition or value).
CREATE TABLE platform_config_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_config_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_config_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_config_history_target_ck CHECK (target_type IN ('definition','value')));
ALTER TABLE platform_config_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_config_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_config_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX platform_config_history_by_target ON platform_config_history (tenant_id, target_type, target_id);
COMMENT ON TABLE platform_config_history IS 'class=tenant_ledger_append_only; m30 config change history';

-- platform_feature_definition — a FEATURE FLAG definition. default_enabled is the base state; is_absolute marks a
-- platform control a tenant assignment can NEVER weaken. A flag is NEVER an authorization substitute (RBAC stays
-- authoritative). One active per (tenant, scope, feature_key).
CREATE TABLE platform_feature_definition (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', feature_key text NOT NULL, description text,
  default_enabled boolean NOT NULL DEFAULT false, is_absolute boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT platform_feature_definition_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_feature_definition_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_feature_definition_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT platform_feature_definition_status_ck CHECK (status IN ('draft','active','retired')),
  CONSTRAINT platform_feature_definition_optlock_ck CHECK (version >= 1));
ALTER TABLE platform_feature_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_feature_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_feature_definition
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX platform_feature_definition_one_active ON platform_feature_definition (tenant_id, scope, feature_key) WHERE status = 'active';
CREATE UNIQUE INDEX platform_feature_definition_idem ON platform_feature_definition (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE platform_feature_definition IS 'class=tenant_aggregate; m30 feature-flag definition (default/absolute; never an authz substitute)';

-- platform_feature_assignment — a feature OVERRIDE for a definition. A tenant assignment can never weaken an ABSOLUTE
-- flag (enforced in-service before insert). enabled is the assigned effective state.
CREATE TABLE platform_feature_assignment (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), definition_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'tenant', enabled boolean NOT NULL DEFAULT false, reason_code text, status text NOT NULL DEFAULT 'active',
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT platform_feature_assignment_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_feature_assignment_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_feature_assignment_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT platform_feature_assignment_status_ck CHECK (status IN ('active','superseded')),
  CONSTRAINT platform_feature_assignment_optlock_ck CHECK (version >= 1),
  CONSTRAINT platform_feature_assignment_def_fkey FOREIGN KEY (tenant_id, definition_id) REFERENCES platform_feature_definition (tenant_id, id));
ALTER TABLE platform_feature_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_feature_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_feature_assignment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX platform_feature_assignment_one_active ON platform_feature_assignment (tenant_id, definition_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX platform_feature_assignment_idem ON platform_feature_assignment (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE platform_feature_assignment IS 'class=tenant_aggregate; m30 feature override (cannot weaken an absolute flag)';

-- platform_feature_history — append-only feature-change evidence.
CREATE TABLE platform_feature_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_feature_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_feature_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_feature_history_target_ck CHECK (target_type IN ('definition','assignment')));
ALTER TABLE platform_feature_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_feature_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_feature_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX platform_feature_history_by_target ON platform_feature_history (tenant_id, target_type, target_id);
COMMENT ON TABLE platform_feature_history IS 'class=tenant_ledger_append_only; m30 feature change history';

-- platform_secret_reference — the SECRET-REFERENCE SEAM: governance metadata for an OPAQUE secretref: pointer (purpose,
-- scope, lifecycle). THERE IS NO SECRET VALUE COLUMN — real secret/key management is m41-security (ADR-116). The
-- reference must match the secretref: shape.
CREATE TABLE platform_secret_reference (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', ref_key text NOT NULL, secret_ref text NOT NULL, purpose text,
  status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT platform_secret_reference_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_secret_reference_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_secret_reference_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT platform_secret_reference_status_ck CHECK (status IN ('active','rotated','revoked')),
  -- OPAQUE POINTER ONLY: the reference matches the secretref: shape; there is no secret value stored anywhere.
  CONSTRAINT platform_secret_reference_shape_ck CHECK (secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT platform_secret_reference_optlock_ck CHECK (version >= 1));
ALTER TABLE platform_secret_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_secret_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_secret_reference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX platform_secret_reference_one_active ON platform_secret_reference (tenant_id, scope, ref_key) WHERE status = 'active';
CREATE UNIQUE INDEX platform_secret_reference_idem ON platform_secret_reference (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE platform_secret_reference IS 'class=tenant_aggregate; m30 secret-reference SEAM (opaque secretref: pointer; ZERO secret values; real key mgmt = m41)';

-- platform_secret_reference_history — append-only secret-reference lifecycle evidence (never any secret value).
CREATE TABLE platform_secret_reference_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), reference_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_secret_reference_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_secret_reference_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_secret_reference_history_ref_fkey FOREIGN KEY (tenant_id, reference_id) REFERENCES platform_secret_reference (tenant_id, id));
ALTER TABLE platform_secret_reference_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_secret_reference_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_secret_reference_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX platform_secret_reference_history_by_ref ON platform_secret_reference_history (tenant_id, reference_id);
COMMENT ON TABLE platform_secret_reference_history IS 'class=tenant_ledger_append_only; m30 secret-reference history (no secret value)';

-- platform_idempotency — append-only idempotency ledger. THE "no duplicate platform mutation" guarantee.
CREATE TABLE platform_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, target_type text, target_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT platform_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT platform_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT platform_idempotency_key_uk UNIQUE (tenant_id, idempotency_key));
ALTER TABLE platform_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE platform_idempotency IS 'class=tenant_ledger_append_only; m30 idempotency ledger (no duplicate platform mutation)';
