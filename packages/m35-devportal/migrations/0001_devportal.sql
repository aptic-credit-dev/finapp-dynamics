-- ---------------------------------------------------------------------------------------------------
-- M35-devportal — PUBLIC APIs & DEVELOPER PORTAL (Stage 6D-3, mvp:false): the governed developer portal + API-gateway
-- FACADE over the platform — developer APPLICATIONS, API CREDENTIALS, published API PRODUCTS and app SUBSCRIPTIONS (public
-- exposure). HARD RULES ARE DB-ENFORCED. THE FACADE RULE: an API product exposes only ALLOW-LISTED operations and every
-- exposed operation carries the m02 permission it requires (devportal_product_scope.required_permission NOT NULL) — public
-- exposure never bypasses m02 RBAC or m01 tenancy. THE SECRET RULE: an API credential persists NO plaintext — it is a
-- one-way sha256: hash XOR an opaque secretref: pointer (the m30 seam); there is NO password/api_key/token/credential VALUE
-- column anywhere; real key mgmt = m41. A published product is IMMUTABLE (devportal_api_product_immutable trigger). CONTROLLED
-- actions: PRODUCT PUBLICATION + SUBSCRIPTION APPROVAL are maker-checker (devportal_review decided_by <> requested_by, SoD;
-- AI never approves — enforced in-service); CREDENTIAL issuance/rotation/revocation are HUMAN-governed (in-service). It uses
-- the devportal_* prefix (integration_* is m23's, connector_* is m33's, marketplace_* is m34's) and owns devportal.lifecycle
-- ONLY, emitting through the ONE m06 outbox. Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS
-- ENABLE+FORCE + tenant_isolation, composite FKs (within m35), version on mutable aggregates. No DELETE grant (ADR-010).
-- Scope/review/credential_event/history + the idempotency ledger are append-only (INSERT+SELECT, 0002). No float. PostgreSQL 16.
-- ---------------------------------------------------------------------------------------------------

-- GAP-4 resolution: the devportal.* permission namespace. Three-segment devportal.<area>.<action>; every controlled app/
-- product/credential/subscription operation authorizes one (default deny). devportal.control.administer is the cross-tenant
-- CONTROL-PLANE permission a tenant admin never holds by default; PUBLIC exposure of a product requires it. product publish +
-- credential manage + subscription manage are privileged (controlled actions). NO devportal.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('devportal.app.read', 'm35-devportal', 'devportal_app', false),
  ('devportal.app.manage', 'm35-devportal', 'devportal_app', false),
  ('devportal.product.read', 'm35-devportal', 'devportal_api_product', false),
  ('devportal.product.author', 'm35-devportal', 'devportal_api_product', false),
  ('devportal.product.publish', 'm35-devportal', 'devportal_api_product', true),
  ('devportal.credential.manage', 'm35-devportal', 'devportal_credential', true),
  ('devportal.subscription.manage', 'm35-devportal', 'devportal_subscription', true),
  ('devportal.control.administer', 'm35-devportal', 'devportal', true);

-- devportal_app — a registered developer application (the client that consumes the platform's public APIs).
CREATE TABLE devportal_app (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', app_key text NOT NULL, name text NOT NULL, description text,
  homepage_url text, owner_ref text, status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT devportal_app_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT devportal_app_id_key UNIQUE (tenant_id, id),
  CONSTRAINT devportal_app_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT devportal_app_status_ck CHECK (status IN ('active','suspended','revoked')),
  CONSTRAINT devportal_app_optlock_ck CHECK (version >= 1));
ALTER TABLE devportal_app ENABLE ROW LEVEL SECURITY;
ALTER TABLE devportal_app FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devportal_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX devportal_app_one_key ON devportal_app (tenant_id, scope, app_key) WHERE status <> 'revoked';
CREATE UNIQUE INDEX devportal_app_idem ON devportal_app (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE devportal_app IS 'class=tenant_aggregate; m35 registered developer application';

-- devportal_api_product — a published API product (a governed, ALLOW-LISTED bundle of exposed operations over an internal
-- API, an m33 connector or an m34 marketplace listing — source_ref is OPAQUE; m35 never reads an m33/m34 table). Lifecycle
-- draft -> validated -> review_pending -> published (maker-checker) -> deprecated; published is IMMUTABLE.
CREATE TABLE devportal_api_product (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', product_key text NOT NULL, title text NOT NULL, summary text,
  category text NOT NULL DEFAULT 'custom', visibility text NOT NULL DEFAULT 'tenant',
  source_kind text NOT NULL DEFAULT 'internal', source_ref text,
  state text NOT NULL DEFAULT 'draft', validation_passed boolean NOT NULL DEFAULT false, content_hash text NOT NULL,
  idempotency_key text, version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT devportal_api_product_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT devportal_api_product_id_key UNIQUE (tenant_id, id),
  CONSTRAINT devportal_api_product_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT devportal_api_product_visibility_ck CHECK (visibility IN ('private','tenant','public')),
  CONSTRAINT devportal_api_product_category_ck CHECK (category IN ('data','integration','workflow','finance','custom')),
  CONSTRAINT devportal_api_product_source_ck CHECK (source_kind IN ('internal','connector','marketplace')),
  CONSTRAINT devportal_api_product_source_ref_ck CHECK (source_kind = 'internal' OR source_ref IS NOT NULL),
  CONSTRAINT devportal_api_product_state_ck CHECK (state IN ('draft','validated','review_pending','published','deprecated','rejected')),
  CONSTRAINT devportal_api_product_evidence_ck CHECK (state NOT IN ('validated','review_pending','published') OR validation_passed = true),
  CONSTRAINT devportal_api_product_optlock_ck CHECK (version >= 1));
ALTER TABLE devportal_api_product ENABLE ROW LEVEL SECURITY;
ALTER TABLE devportal_api_product FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devportal_api_product
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX devportal_api_product_one_published ON devportal_api_product (tenant_id, scope, product_key) WHERE state = 'published';
CREATE UNIQUE INDEX devportal_api_product_idem ON devportal_api_product (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE devportal_api_product IS 'class=tenant_aggregate; m35 published API product (governed facade, published-immutable)';

-- PUBLISHED-IMMUTABILITY: once published, the product is frozen (only a published->deprecated move is allowed); key/source/
-- hash can never change once past draft; a rejected product is terminal.
CREATE OR REPLACE FUNCTION devportal_api_product_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('rejected') THEN
    RAISE EXCEPTION 'devportal_api_product % is immutable in state %', OLD.id, OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.product_key <> OLD.product_key OR NEW.source_kind <> OLD.source_kind
     OR COALESCE(NEW.source_ref,'') <> COALESCE(OLD.source_ref,'') OR NEW.content_hash <> OLD.content_hash THEN
    RAISE EXCEPTION 'a published/validated product is immutable (key/source/hash)' USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state = 'published' AND NEW.state NOT IN ('published','deprecated') THEN
    RAISE EXCEPTION 'a published product may only move to deprecated' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER devportal_api_product_immutable_trg BEFORE UPDATE ON devportal_api_product
  FOR EACH ROW EXECUTE FUNCTION devportal_api_product_immutable();

-- devportal_product_scope — APPEND-ONLY: the ALLOW-LISTED operations a product exposes + the m02 permission each REQUIRES.
-- THE FACADE RULE: required_permission is NOT NULL — the portal never exposes an operation without the RBAC permission that
-- guards it. operation_ref is an OPAQUE descriptor (an internal route, or an m33/m34 capability reference).
CREATE TABLE devportal_product_scope (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), product_id uuid NOT NULL,
  operation_ref text NOT NULL, required_permission text NOT NULL, description text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT devportal_product_scope_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT devportal_product_scope_id_key UNIQUE (tenant_id, id),
  CONSTRAINT devportal_product_scope_perm_ck CHECK (required_permission <> '' AND array_length(string_to_array(required_permission,'.'),1) = 3),
  CONSTRAINT devportal_product_scope_product_fkey FOREIGN KEY (tenant_id, product_id) REFERENCES devportal_api_product (tenant_id, id));
ALTER TABLE devportal_product_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE devportal_product_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devportal_product_scope
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX devportal_product_scope_by_product ON devportal_product_scope (tenant_id, product_id);
COMMENT ON TABLE devportal_product_scope IS 'class=tenant_ledger_append_only; m35 allow-listed exposed operations + required m02 permission';

-- devportal_credential — THE SECRET SEAM: an API credential for an app. It persists NO plaintext — EXACTLY ONE of a one-way
-- secret_hash (sha256: shape) XOR an opaque secret_ref (secretref: shape, the m30 seam). key_id is the PUBLIC identifier.
-- Lifecycle active -> rotated -> revoked. Real key mgmt = m41.
CREATE TABLE devportal_credential (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), app_id uuid NOT NULL,
  key_id text NOT NULL, purpose text NOT NULL DEFAULT 'api', secret_hash text, secret_ref text,
  status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT devportal_credential_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT devportal_credential_id_key UNIQUE (tenant_id, id),
  CONSTRAINT devportal_credential_status_ck CHECK (status IN ('active','rotated','revoked')),
  -- NO PLAINTEXT: exactly one of a one-way hash XOR an opaque reference.
  CONSTRAINT devportal_credential_material_ck CHECK ((secret_hash IS NOT NULL) <> (secret_ref IS NOT NULL)),
  CONSTRAINT devportal_credential_hash_shape_ck CHECK (secret_hash IS NULL OR secret_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT devportal_credential_ref_shape_ck CHECK (secret_ref IS NULL OR secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT devportal_credential_optlock_ck CHECK (version >= 1),
  CONSTRAINT devportal_credential_app_fkey FOREIGN KEY (tenant_id, app_id) REFERENCES devportal_app (tenant_id, id));
ALTER TABLE devportal_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE devportal_credential FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devportal_credential
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX devportal_credential_key ON devportal_credential (tenant_id, key_id);
CREATE UNIQUE INDEX devportal_credential_one_active ON devportal_credential (tenant_id, app_id, purpose) WHERE status = 'active';
COMMENT ON TABLE devportal_credential IS 'class=tenant_aggregate; m35 API credential (one-way hash XOR opaque secretref; zero plaintext)';

-- devportal_subscription — an app's SUBSCRIPTION to a published product (the public-exposure grant). status requested ->
-- active (maker-checker approval) -> suspended -> revoked. A controlled action (in-service SoD + m39 quota for public).
CREATE TABLE devportal_subscription (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), app_id uuid NOT NULL, product_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'requested', requested_by uuid, approved_by uuid, reason_code text, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT devportal_subscription_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT devportal_subscription_id_key UNIQUE (tenant_id, id),
  CONSTRAINT devportal_subscription_status_ck CHECK (status IN ('requested','active','suspended','revoked')),
  CONSTRAINT devportal_subscription_sod_ck CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT devportal_subscription_optlock_ck CHECK (version >= 1),
  CONSTRAINT devportal_subscription_app_fkey FOREIGN KEY (tenant_id, app_id) REFERENCES devportal_app (tenant_id, id),
  CONSTRAINT devportal_subscription_product_fkey FOREIGN KEY (tenant_id, product_id) REFERENCES devportal_api_product (tenant_id, id));
ALTER TABLE devportal_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE devportal_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devportal_subscription
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX devportal_subscription_one_open ON devportal_subscription (tenant_id, app_id, product_id) WHERE status IN ('requested','active');
COMMENT ON TABLE devportal_subscription IS 'class=tenant_aggregate; m35 app subscription to a product (maker-checker public-exposure grant)';

-- devportal_review — APPEND-ONLY maker-checker ledger for product publication + subscription approval. A decision needs a
-- decider and the decider can never be the requester (SoD). AI never approves (isHumanActor in-service).
CREATE TABLE devportal_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, kind text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid, reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devportal_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT devportal_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT devportal_review_target_ck CHECK (target_type IN ('product','subscription')),
  CONSTRAINT devportal_review_kind_ck CHECK (kind IN ('requested','approved','rejected')),
  CONSTRAINT devportal_review_decider_ck CHECK (kind = 'requested' OR decided_by IS NOT NULL),
  CONSTRAINT devportal_review_sod_ck CHECK (decided_by IS NULL OR decided_by <> requested_by));
ALTER TABLE devportal_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE devportal_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devportal_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX devportal_review_by_target ON devportal_review (tenant_id, target_type, target_id);
COMMENT ON TABLE devportal_review IS 'class=tenant_ledger_append_only; m35 maker-checker product/subscription decisions';

-- devportal_credential_event — APPEND-ONLY evidence of credential issuance/rotation/revocation (HUMAN-governed, in-service).
-- Carries NO secret value/reference content — only the credential id, the event and the human who performed it.
CREATE TABLE devportal_credential_event (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), credential_id uuid NOT NULL,
  event text NOT NULL, by_user uuid, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devportal_credential_event_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT devportal_credential_event_id_key UNIQUE (tenant_id, id),
  CONSTRAINT devportal_credential_event_kind_ck CHECK (event IN ('issued','rotated','revoked')),
  CONSTRAINT devportal_credential_event_cred_fkey FOREIGN KEY (tenant_id, credential_id) REFERENCES devportal_credential (tenant_id, id));
ALTER TABLE devportal_credential_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE devportal_credential_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devportal_credential_event
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX devportal_credential_event_by_cred ON devportal_credential_event (tenant_id, credential_id);
COMMENT ON TABLE devportal_credential_event IS 'class=tenant_ledger_append_only; m35 credential issuance/rotation/revocation evidence (no secret)';

-- devportal_history — APPEND-ONLY status/transition evidence (app|product|credential|subscription).
CREATE TABLE devportal_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devportal_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT devportal_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT devportal_history_target_ck CHECK (target_type IN ('app','product','credential','subscription')));
ALTER TABLE devportal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE devportal_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devportal_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX devportal_history_by_target ON devportal_history (tenant_id, target_type, target_id);
COMMENT ON TABLE devportal_history IS 'class=tenant_ledger_append_only; m35 app/product/credential/subscription history';

-- devportal_idempotency — APPEND-ONLY idempotency ledger (no duplicate register/publish/issue/subscribe).
CREATE TABLE devportal_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, target_type text, target_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT devportal_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT devportal_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT devportal_idempotency_key_uk UNIQUE (tenant_id, idempotency_key));
ALTER TABLE devportal_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE devportal_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devportal_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE devportal_idempotency IS 'class=tenant_ledger_append_only; m35 idempotency ledger (no duplicate devportal mutation)';
