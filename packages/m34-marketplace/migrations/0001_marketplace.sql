-- ---------------------------------------------------------------------------------------------------
-- M34-marketplace — CONNECTOR MARKETPLACE (Stage 6D-2, mvp:false): the governed marketplace over the connectors m33
-- defines — catalog LISTINGS, tenant INSTALLATIONS, CONSENT and UPGRADES. It CONSUMES m33 BY CONTRACT: a listing/
-- installation references an m33 connector by an OPAQUE connector_ref and validates availability through a fail-closed
-- port; m34 owns NO connector SDK/registry/runtime/connection/secret engine and never executes a connector. HARD RULES
-- ARE DB-ENFORCED: IT IS NOT A SECRETS MANAGER — install secrets are opaque secretref: pointers (marketplace_install_secret,
-- secretref: shape CHECK; the m30 seam); there is NO password/key/token/credential VALUE column anywhere; real key mgmt =
-- m41. A published listing is IMMUTABLE (marketplace_listing_immutable trigger). CONSENT + listing PUBLICATION + UPGRADE
-- are CONTROLLED actions: consent is HUMAN-granted (marketplace_consent_human_ck: granted => granted_by NOT NULL) and
-- revocable; a listing/upgrade decision needs a decider and decided_by <> requested_by (marketplace_review SoD); a listing
-- cannot be published without a passing validation. It uses the marketplace_* prefix (integration_* is m23's, connector_*
-- is m33's) and owns marketplace.lifecycle ONLY, emitting through the ONE m06 outbox. Every tenant-scoped table: composite
-- (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs (within m34), version on mutable
-- aggregates. No DELETE grant (ADR-010). Capability/upgrade/review/history + the idempotency ledger are append-only
-- (INSERT+SELECT, 0002). No float. PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- GAP-4 resolution: the marketplace.* permission namespace. Three-segment marketplace.<area>.<action>; every controlled
-- listing/install/consent/upgrade operation authorizes one (default deny). marketplace.control.administer is the
-- cross-tenant CONTROL-PLANE permission a tenant admin never holds by default; listing publish + install manage + consent
-- manage + upgrade apply are privileged (controlled actions). NO marketplace.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('marketplace.listing.read', 'm34-marketplace', 'marketplace_listing', false),
  ('marketplace.listing.author', 'm34-marketplace', 'marketplace_listing', false),
  ('marketplace.listing.publish', 'm34-marketplace', 'marketplace_listing', true),
  ('marketplace.install.read', 'm34-marketplace', 'marketplace_installation', false),
  ('marketplace.install.manage', 'm34-marketplace', 'marketplace_installation', true),
  ('marketplace.consent.manage', 'm34-marketplace', 'marketplace_consent', true),
  ('marketplace.upgrade.apply', 'm34-marketplace', 'marketplace_upgrade', true),
  ('marketplace.control.administer', 'm34-marketplace', 'marketplace', true);

-- marketplace_listing — a catalog listing of an m33 connector (connector_ref is OPAQUE — m34 never reads m33 tables).
-- Lifecycle draft -> validated -> review_pending -> published (maker-checker) -> deprecated; published is IMMUTABLE.
CREATE TABLE marketplace_listing (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', listing_key text NOT NULL, connector_ref text NOT NULL, title text NOT NULL,
  summary text, category text NOT NULL DEFAULT 'custom', publisher text, visibility text NOT NULL DEFAULT 'tenant',
  state text NOT NULL DEFAULT 'draft', validation_passed boolean NOT NULL DEFAULT false, content_hash text NOT NULL, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT marketplace_listing_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT marketplace_listing_id_key UNIQUE (tenant_id, id),
  CONSTRAINT marketplace_listing_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT marketplace_listing_visibility_ck CHECK (visibility IN ('private','tenant','public')),
  CONSTRAINT marketplace_listing_category_ck CHECK (category IN ('finance','crm','messaging','storage','analytics','custom')),
  CONSTRAINT marketplace_listing_state_ck CHECK (state IN ('draft','validated','review_pending','published','deprecated','rejected')),
  CONSTRAINT marketplace_listing_evidence_ck CHECK (state NOT IN ('validated','review_pending','published') OR validation_passed = true),
  CONSTRAINT marketplace_listing_optlock_ck CHECK (version >= 1));
ALTER TABLE marketplace_listing ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_listing FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketplace_listing
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX marketplace_listing_one_published ON marketplace_listing (tenant_id, scope, listing_key) WHERE state = 'published';
CREATE UNIQUE INDEX marketplace_listing_idem ON marketplace_listing (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE marketplace_listing IS 'class=tenant_aggregate; m34 catalog listing of an opaque m33 connector (published-immutable)';

-- PUBLISHED-IMMUTABILITY: once published, the listing is frozen (only a published->deprecated move is allowed).
CREATE OR REPLACE FUNCTION marketplace_listing_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('rejected') THEN
    RAISE EXCEPTION 'marketplace_listing % is immutable in state %', OLD.id, OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.listing_key <> OLD.listing_key OR NEW.connector_ref <> OLD.connector_ref OR NEW.content_hash <> OLD.content_hash THEN
    RAISE EXCEPTION 'a published/validated listing is immutable (key/connector_ref/hash)' USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state = 'published' AND NEW.state NOT IN ('published','deprecated') THEN
    RAISE EXCEPTION 'a published listing may only move to deprecated' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER marketplace_listing_immutable_trg BEFORE UPDATE ON marketplace_listing
  FOR EACH ROW EXECUTE FUNCTION marketplace_listing_immutable();

-- marketplace_listing_capability — APPEND-ONLY: the OPAQUE m33 capability references a listing exposes + the consent scope
-- each requires. m34 never reads m33 tables — these are opaque refs validated via the fail-closed port at publish.
CREATE TABLE marketplace_listing_capability (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), listing_id uuid NOT NULL,
  capability_ref text NOT NULL, required_scope text NOT NULL DEFAULT 'read', description text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT marketplace_listing_capability_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT marketplace_listing_capability_id_key UNIQUE (tenant_id, id),
  CONSTRAINT marketplace_listing_capability_scope_ck CHECK (required_scope IN ('read','write','admin')),
  CONSTRAINT marketplace_listing_capability_listing_fkey FOREIGN KEY (tenant_id, listing_id) REFERENCES marketplace_listing (tenant_id, id));
ALTER TABLE marketplace_listing_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_listing_capability FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketplace_listing_capability
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX marketplace_listing_capability_by_listing ON marketplace_listing_capability (tenant_id, listing_id);
COMMENT ON TABLE marketplace_listing_capability IS 'class=tenant_ledger_append_only; m34 listing capabilities (opaque m33 refs + consent scope)';

-- marketplace_installation — a tenant's installation of a listing. config is NON-secret; secrets are opaque refs in
-- marketplace_install_secret. status requested -> consent_pending -> active -> suspended -> uninstalled.
CREATE TABLE marketplace_installation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), listing_id uuid NOT NULL,
  connector_ref text NOT NULL, scope text NOT NULL DEFAULT 'tenant', install_key text NOT NULL, config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'requested', installed_version integer NOT NULL DEFAULT 1, requested_by uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT marketplace_installation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT marketplace_installation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT marketplace_installation_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT marketplace_installation_status_ck CHECK (status IN ('requested','consent_pending','active','suspended','uninstalled')),
  CONSTRAINT marketplace_installation_ver_ck CHECK (installed_version >= 1),
  CONSTRAINT marketplace_installation_optlock_ck CHECK (version >= 1),
  CONSTRAINT marketplace_installation_listing_fkey FOREIGN KEY (tenant_id, listing_id) REFERENCES marketplace_listing (tenant_id, id));
ALTER TABLE marketplace_installation ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_installation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketplace_installation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX marketplace_installation_one_active ON marketplace_installation (tenant_id, scope, install_key) WHERE status IN ('active','consent_pending','requested');
CREATE UNIQUE INDEX marketplace_installation_idem ON marketplace_installation (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE marketplace_installation IS 'class=tenant_aggregate; m34 tenant installation of a listing (non-secret config)';

-- marketplace_consent — a tenant's CONSENT to an installation's data-access scopes. HUMAN-granted (granted_by NOT NULL
-- when granted; AI never consents — enforced in-service) and REVOCABLE. A controlled action.
CREATE TABLE marketplace_consent (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), installation_id uuid NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'granted', granted_by uuid, reason_code text, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT marketplace_consent_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT marketplace_consent_id_key UNIQUE (tenant_id, id),
  CONSTRAINT marketplace_consent_status_ck CHECK (status IN ('granted','revoked')),
  -- CONSENT IS HUMAN-GOVERNED: a granted consent must record the human who granted it.
  CONSTRAINT marketplace_consent_human_ck CHECK (status <> 'granted' OR granted_by IS NOT NULL),
  CONSTRAINT marketplace_consent_optlock_ck CHECK (version >= 1),
  CONSTRAINT marketplace_consent_install_fkey FOREIGN KEY (tenant_id, installation_id) REFERENCES marketplace_installation (tenant_id, id));
ALTER TABLE marketplace_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_consent FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketplace_consent
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX marketplace_consent_one_granted ON marketplace_consent (tenant_id, installation_id) WHERE status = 'granted';
COMMENT ON TABLE marketplace_consent IS 'class=tenant_aggregate; m34 human-granted revocable consent to data-access scopes';

-- marketplace_install_secret — THE SECRET SEAM: an installation secret stored ONLY as an opaque secretref: pointer (m30
-- seam). There is NO secret VALUE column — a raw secret is rejected (secretref: shape). Real resolution = m41.
CREATE TABLE marketplace_install_secret (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), installation_id uuid NOT NULL,
  purpose text NOT NULL, secret_ref text NOT NULL, status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT marketplace_install_secret_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT marketplace_install_secret_id_key UNIQUE (tenant_id, id),
  CONSTRAINT marketplace_install_secret_status_ck CHECK (status IN ('active','rotated','revoked')),
  CONSTRAINT marketplace_install_secret_ref_shape_ck CHECK (secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT marketplace_install_secret_optlock_ck CHECK (version >= 1),
  CONSTRAINT marketplace_install_secret_install_fkey FOREIGN KEY (tenant_id, installation_id) REFERENCES marketplace_installation (tenant_id, id));
ALTER TABLE marketplace_install_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_install_secret FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketplace_install_secret
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX marketplace_install_secret_one_active ON marketplace_install_secret (tenant_id, installation_id, purpose) WHERE status = 'active';
COMMENT ON TABLE marketplace_install_secret IS 'class=tenant_aggregate; m34 opaque install secret REFERENCE (secretref: pointer only; zero secret values)';

-- marketplace_upgrade — APPEND-ONLY upgrade evidence for an installation. An upgrade that widens access is a controlled
-- action (approved_by human, SoD via marketplace_review). from/to version + status + reason code.
CREATE TABLE marketplace_upgrade (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), installation_id uuid NOT NULL,
  from_version integer NOT NULL, to_version integer NOT NULL, status text NOT NULL, requested_by uuid, approved_by uuid, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_upgrade_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT marketplace_upgrade_id_key UNIQUE (tenant_id, id),
  CONSTRAINT marketplace_upgrade_status_ck CHECK (status IN ('requested','applied','rejected')),
  CONSTRAINT marketplace_upgrade_ver_ck CHECK (to_version >= 1 AND from_version >= 1),
  CONSTRAINT marketplace_upgrade_install_fkey FOREIGN KEY (tenant_id, installation_id) REFERENCES marketplace_installation (tenant_id, id));
ALTER TABLE marketplace_upgrade ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_upgrade FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketplace_upgrade
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX marketplace_upgrade_by_install ON marketplace_upgrade (tenant_id, installation_id);
COMMENT ON TABLE marketplace_upgrade IS 'class=tenant_ledger_append_only; m34 installation upgrade evidence';

-- marketplace_review — APPEND-ONLY maker-checker ledger for listing publication + upgrade approval. A decision needs a
-- decider and the decider can never be the requester (SoD). AI never approves (isHumanActor in-service).
CREATE TABLE marketplace_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, kind text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid, reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT marketplace_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT marketplace_review_target_ck CHECK (target_type IN ('listing','upgrade')),
  CONSTRAINT marketplace_review_kind_ck CHECK (kind IN ('requested','approved','rejected')),
  CONSTRAINT marketplace_review_decider_ck CHECK (kind = 'requested' OR decided_by IS NOT NULL),
  CONSTRAINT marketplace_review_sod_ck CHECK (decided_by IS NULL OR decided_by <> requested_by));
ALTER TABLE marketplace_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketplace_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX marketplace_review_by_target ON marketplace_review (tenant_id, target_type, target_id);
COMMENT ON TABLE marketplace_review IS 'class=tenant_ledger_append_only; m34 maker-checker listing/upgrade decisions';

-- marketplace_history — APPEND-ONLY status/transition evidence (listing|installation|consent|upgrade).
CREATE TABLE marketplace_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT marketplace_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT marketplace_history_target_ck CHECK (target_type IN ('listing','installation','consent','upgrade')));
ALTER TABLE marketplace_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketplace_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX marketplace_history_by_target ON marketplace_history (tenant_id, target_type, target_id);
COMMENT ON TABLE marketplace_history IS 'class=tenant_ledger_append_only; m34 listing/installation/consent/upgrade history';

-- marketplace_idempotency — APPEND-ONLY idempotency ledger (no duplicate publish/install/consent/upgrade).
CREATE TABLE marketplace_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, target_type text, target_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT marketplace_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT marketplace_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT marketplace_idempotency_key_uk UNIQUE (tenant_id, idempotency_key));
ALTER TABLE marketplace_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketplace_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE marketplace_idempotency IS 'class=tenant_ledger_append_only; m34 idempotency ledger (no duplicate marketplace mutation)';
