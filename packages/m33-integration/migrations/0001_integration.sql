-- ---------------------------------------------------------------------------------------------------
-- M33-integration — INTEGRATION FOUNDATION (Stage 6D-1, mvp:false): the GOVERNED platform integration foundation — a
-- connector SDK/registry (registered, governed capabilities), tenant connection management, and a FRAMEWORK-ONLY connector
-- runtime. HARD RULES ARE DB-ENFORCED: IT IS NOT A SECRETS MANAGER — a connection's secrets are stored ONLY as opaque
-- secretref: pointers (connection_secret.secret_ref, secretref: shape CHECK; the m30 seam); there is NO password/key/token/
-- credential VALUE column anywhere; real credential resolution is deferred to m41 behind a fail-closed port. IT IS NOT A
-- PRODUCTION RUNTIME — the connector runtime is a fail-closed abstraction (deterministic doubles; no production egress).
-- NO ARBITRARY CODE — the SDK exposes REGISTERED capabilities only. It uses the connector_* prefix (integration_* is owned
-- by m23-finance-integration). A published connector is IMMUTABLE (connector_definition_immutable trigger); connector
-- PUBLICATION is a controlled action (maker-checker/SoD: connector_review decided_by <> requested_by; a connector cannot be
-- published without a passing validation). m33 owns connector.lifecycle ONLY and emits through the ONE m06 outbox (no 2nd
-- outbox). Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite
-- FKs (within m33), version on mutable aggregates. No DELETE grant (ADR-010). Run-attempt/review/history + the idempotency
-- ledger are append-only (INSERT+SELECT, 0002). No float. PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- The integration.* permission namespace. Three-segment integration.<area>.<action>; every controlled connector/connection/
-- run operation authorizes one (default deny). integration.control.administer is the cross-tenant CONTROL-PLANE permission a
-- tenant admin never holds by default; connector publish + connection manage + run execute are privileged (publication +
-- external access are controlled actions). NO integration.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('integration.connector.read', 'm33-integration', 'connector_definition', false),
  ('integration.connector.author', 'm33-integration', 'connector_definition', false),
  ('integration.connector.publish', 'm33-integration', 'connector_definition', true),
  ('integration.capability.read', 'm33-integration', 'connector_capability', false),
  ('integration.connection.read', 'm33-integration', 'connection', false),
  ('integration.connection.manage', 'm33-integration', 'connection', true),
  ('integration.run.read', 'm33-integration', 'connector_run', false),
  ('integration.run.execute', 'm33-integration', 'connector_run', true),
  ('integration.control.administer', 'm33-integration', 'integration', true);

-- connector_definition — a REGISTERED connector type (the SDK entry). auth_kind is metadata (none/api_key/oauth2/basic).
-- Lifecycle draft -> validated -> review_pending -> published (maker-checker) -> deprecated; a published connector is
-- IMMUTABLE (trigger). One published per key.
CREATE TABLE connector_definition (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', connector_key text NOT NULL, name text NOT NULL, vendor text, category text NOT NULL DEFAULT 'custom',
  auth_kind text NOT NULL DEFAULT 'none', description text, state text NOT NULL DEFAULT 'draft', validation_passed boolean NOT NULL DEFAULT false,
  content_hash text NOT NULL, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT connector_definition_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT connector_definition_id_key UNIQUE (tenant_id, id),
  CONSTRAINT connector_definition_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT connector_definition_auth_ck CHECK (auth_kind IN ('none','api_key','oauth2','basic','secret_ref')),
  CONSTRAINT connector_definition_category_ck CHECK (category IN ('finance','crm','messaging','storage','analytics','custom')),
  CONSTRAINT connector_definition_state_ck CHECK (state IN ('draft','validated','review_pending','published','deprecated','rejected')),
  CONSTRAINT connector_definition_evidence_ck CHECK (state NOT IN ('validated','review_pending','published') OR validation_passed = true),
  CONSTRAINT connector_definition_optlock_ck CHECK (version >= 1));
ALTER TABLE connector_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector_definition
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX connector_definition_one_published ON connector_definition (tenant_id, scope, connector_key) WHERE state = 'published';
CREATE UNIQUE INDEX connector_definition_idem ON connector_definition (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE connector_definition IS 'class=tenant_aggregate; m33 registered connector type (SDK; published-immutable)';

-- PUBLISHED-IMMUTABILITY: once published, the connector definition is frozen (only a published->deprecated move is allowed;
-- rejected is terminal). A change requires a new definition version.
CREATE OR REPLACE FUNCTION connector_definition_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('rejected') THEN
    RAISE EXCEPTION 'connector_definition % is immutable in state %', OLD.id, OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.connector_key <> OLD.connector_key OR NEW.auth_kind <> OLD.auth_kind OR NEW.content_hash <> OLD.content_hash THEN
    RAISE EXCEPTION 'a published/validated connector definition is immutable (key/auth_kind/hash)' USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state = 'published' AND NEW.state NOT IN ('published','deprecated') THEN
    RAISE EXCEPTION 'a published connector may only move to deprecated' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER connector_definition_immutable_trg BEFORE UPDATE ON connector_definition
  FOR EACH ROW EXECUTE FUNCTION connector_definition_immutable();

-- connector_capability — a REGISTERED, governed capability of a connector (the catalog m31's IntegrationCapabilityCatalogPort
-- resolves). direction inbound/outbound; kind read/action. NO arbitrary code — a capability is a declarative descriptor +
-- bounded schema, never an executable.
CREATE TABLE connector_capability (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), connector_id uuid NOT NULL,
  capability_key text NOT NULL, name text NOT NULL, direction text NOT NULL DEFAULT 'outbound', kind text NOT NULL DEFAULT 'read',
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT connector_capability_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT connector_capability_id_key UNIQUE (tenant_id, id),
  CONSTRAINT connector_capability_dir_ck CHECK (direction IN ('inbound','outbound')),
  CONSTRAINT connector_capability_kind_ck CHECK (kind IN ('read','action')),
  CONSTRAINT connector_capability_status_ck CHECK (status IN ('active','retired')),
  CONSTRAINT connector_capability_optlock_ck CHECK (version >= 1),
  CONSTRAINT connector_capability_conn_fkey FOREIGN KEY (tenant_id, connector_id) REFERENCES connector_definition (tenant_id, id));
ALTER TABLE connector_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_capability FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector_capability
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX connector_capability_key ON connector_capability (tenant_id, connector_id, capability_key);
CREATE INDEX connector_capability_by_connector ON connector_capability (tenant_id, connector_id);
COMMENT ON TABLE connector_capability IS 'class=tenant_aggregate; m33 registered governed capability (the m31 catalog resolves)';

-- connection — a tenant's configured connection to a connector. config is NON-secret jsonb; secrets live ONLY as opaque
-- secretref: pointers in connection_secret (never here). One active per key.
CREATE TABLE connection (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), connector_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'tenant', connection_key text NOT NULL, name text NOT NULL, config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT connection_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT connection_id_key UNIQUE (tenant_id, id),
  CONSTRAINT connection_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT connection_status_ck CHECK (status IN ('draft','active','disabled','error')),
  CONSTRAINT connection_optlock_ck CHECK (version >= 1),
  CONSTRAINT connection_connector_fkey FOREIGN KEY (tenant_id, connector_id) REFERENCES connector_definition (tenant_id, id));
ALTER TABLE connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connection
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX connection_one_active ON connection (tenant_id, scope, connection_key) WHERE status = 'active';
CREATE UNIQUE INDEX connection_idem ON connection (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE connection IS 'class=tenant_aggregate; m33 tenant connection (non-secret config; secrets are opaque refs only)';

-- connection_secret — THE SECRET SEAM: a named secret a connection needs, stored ONLY as an opaque secretref: pointer (m30
-- seam). There is NO secret VALUE column — a raw secret is rejected (secret_ref ~ secretref: shape). Real resolution = m41.
CREATE TABLE connection_secret (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), connection_id uuid NOT NULL,
  purpose text NOT NULL, secret_ref text NOT NULL, status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT connection_secret_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT connection_secret_id_key UNIQUE (tenant_id, id),
  CONSTRAINT connection_secret_status_ck CHECK (status IN ('active','rotated','revoked')),
  -- THE SEAM: a secret reference must match the opaque secretref: shape (m24/m30 convention) — a POINTER, never a value.
  CONSTRAINT connection_secret_ref_shape_ck CHECK (secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT connection_secret_optlock_ck CHECK (version >= 1),
  CONSTRAINT connection_secret_conn_fkey FOREIGN KEY (tenant_id, connection_id) REFERENCES connection (tenant_id, id));
ALTER TABLE connection_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_secret FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connection_secret
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX connection_secret_one_active ON connection_secret (tenant_id, connection_id, purpose) WHERE status = 'active';
COMMENT ON TABLE connection_secret IS 'class=tenant_aggregate; m33 opaque secret REFERENCE (secretref: pointer only; zero secret values)';

-- connector_run — a GOVERNED connector execution (FRAMEWORK-ONLY: the runtime is fail-closed; no production egress). It
-- records the request + outcome; row_count is a count, never data. Idempotent.
CREATE TABLE connector_run (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), connection_id uuid NOT NULL, capability_id uuid NOT NULL,
  direction text NOT NULL DEFAULT 'outbound', status text NOT NULL DEFAULT 'requested', row_count integer, reason_code text,
  runtime_kind text NOT NULL DEFAULT 'framework', idempotency_key text,
  started_at timestamptz, finished_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT connector_run_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT connector_run_id_key UNIQUE (tenant_id, id),
  CONSTRAINT connector_run_dir_ck CHECK (direction IN ('inbound','outbound')),
  CONSTRAINT connector_run_status_ck CHECK (status IN ('requested','running','succeeded','failed','blocked')),
  CONSTRAINT connector_run_rows_ck CHECK (row_count IS NULL OR row_count >= 0),
  CONSTRAINT connector_run_optlock_ck CHECK (version >= 1),
  CONSTRAINT connector_run_conn_fkey FOREIGN KEY (tenant_id, connection_id) REFERENCES connection (tenant_id, id),
  CONSTRAINT connector_run_cap_fkey FOREIGN KEY (tenant_id, capability_id) REFERENCES connector_capability (tenant_id, id));
ALTER TABLE connector_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector_run
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX connector_run_idem ON connector_run (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX connector_run_by_connection ON connector_run (tenant_id, connection_id);
COMMENT ON TABLE connector_run IS 'class=tenant_aggregate; m33 governed connector run (framework-only, fail-closed; row_count not data)';

-- connector_run_attempt — APPEND-ONLY attempts/retries of a run.
CREATE TABLE connector_run_attempt (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1, status text NOT NULL, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT connector_run_attempt_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT connector_run_attempt_id_key UNIQUE (tenant_id, id),
  CONSTRAINT connector_run_attempt_no_ck CHECK (attempt_no >= 1),
  CONSTRAINT connector_run_attempt_status_ck CHECK (status IN ('running','succeeded','failed','blocked')),
  CONSTRAINT connector_run_attempt_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES connector_run (tenant_id, id));
ALTER TABLE connector_run_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_run_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector_run_attempt
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX connector_run_attempt_by_run ON connector_run_attempt (tenant_id, run_id);
COMMENT ON TABLE connector_run_attempt IS 'class=tenant_ledger_append_only; m33 connector run attempts';

-- connector_review — APPEND-ONLY maker-checker ledger for connector publication. A decision needs a decider and the decider
-- can never be the requester (SoD). AI never approves (isHumanActor in-service).
CREATE TABLE connector_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, kind text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid, reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connector_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT connector_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT connector_review_target_ck CHECK (target_type IN ('connector')),
  CONSTRAINT connector_review_kind_ck CHECK (kind IN ('requested','approved','rejected')),
  CONSTRAINT connector_review_decider_ck CHECK (kind = 'requested' OR decided_by IS NOT NULL),
  CONSTRAINT connector_review_sod_ck CHECK (decided_by IS NULL OR decided_by <> requested_by));
ALTER TABLE connector_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX connector_review_by_target ON connector_review (tenant_id, target_type, target_id);
COMMENT ON TABLE connector_review IS 'class=tenant_ledger_append_only; m33 maker-checker connector publication decisions';

-- connector_history — APPEND-ONLY status/transition evidence (connector|connection|run).
CREATE TABLE connector_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connector_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT connector_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT connector_history_target_ck CHECK (target_type IN ('connector','capability','connection','connection_secret','run')));
ALTER TABLE connector_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX connector_history_by_target ON connector_history (tenant_id, target_type, target_id);
COMMENT ON TABLE connector_history IS 'class=tenant_ledger_append_only; m33 connector/connection/run status history';

-- connector_idempotency — APPEND-ONLY idempotency ledger (no duplicate publish/connection/run).
CREATE TABLE connector_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, target_type text, target_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT connector_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT connector_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT connector_idempotency_key_uk UNIQUE (tenant_id, idempotency_key));
ALTER TABLE connector_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE connector_idempotency IS 'class=tenant_ledger_append_only; m33 idempotency ledger (no duplicate integration mutation)';
