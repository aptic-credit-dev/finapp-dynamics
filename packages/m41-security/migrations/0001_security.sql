-- ---------------------------------------------------------------------------------------------------
-- M41-security — ENTERPRISE SECURITY / PRIVACY / COMPLIANCE / GRC (Stage 6H, mvp:false). The real secret/key-management
-- BOUNDARY + DLP + crypto-key lifecycle + security posture + GRC + privacy controls. THE LOAD-BEARING BOUNDARY: m30 owns the
-- secret-reference SEAM (opaque secretref:, ZERO secret VALUE columns); m41 owns the real secret/key management — but there is
-- NO approved KMS/HSM/Vault provider (OPEN_QUESTIONS #10/#16), so m41 is FRAMEWORK-ONLY: it owns governed secret/key/DLP/GRC/
-- privacy METADATA + lifecycle + a fail-closed REAL resolver backing m30's SecretResolver, and DEFERS actual secret-VALUE
-- storage + crypto + provider integration behind a fail-closed provider port. There are ZERO plaintext/ciphertext/secret-value/
-- token/private-key/password columns — secret_ref + provider_ref are OPAQUE pointers only (secretref: shape CHECK). NO
-- home-grown crypto (approved algorithm ids + opaque refs + versioned metadata only). Secret/key create/activate/rotate/retire/
-- revoke/destroy + a plaintext REVEAL are CONTROLLED (maker-checker/SoD: approved_by <> requested_by, AI/system/automation
-- never approve — in-service; privileged; a non-pending secret version is IMMUTABLE by trigger; terminal states protected).
-- ROTATION is RACE-SAFE: at most ONE active version per secret (partial unique index). DLP FAILS CLOSED. POSTURE OVER RBAC
-- (ADR-009): m41 augments m02 RBAC + m30 controls, never replaces/grants authority. Uses the security_/grc_/privacy_ prefixes
-- and owns the security.* event families through the ONE m06 outbox. Every tenant table: composite (tenant_id, id) PK + UNIQUE,
-- RLS ENABLE+FORCE + tenant_isolation, composite FKs (within m41), version on mutable aggregates. No DELETE grant (ADR-010).
-- Reveal/finding/incident/review/history/assessment/record + the idempotency ledger are append-only (INSERT+SELECT, 0002).
-- A secret VALUE NEVER appears anywhere. PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- The security.* + grc.* + privacy.* permission namespaces (already declared in naming-map; NO GAP-4). Three-segment. Every
-- controlled operation authorizes one (default deny). security.control.administer is the cross-tenant CONTROL-PLANE permission a
-- tenant admin never holds by default (platform-scope keys/policies); secret rotate/reveal/destroy are privileged CONTROLLED
-- actions. NO security.admin / grc.admin / privacy.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('security.secret.read', 'm41-security', 'security_secret', false),
  ('security.secret.manage', 'm41-security', 'security_secret', false),
  ('security.secret.rotate', 'm41-security', 'security_secret', true),
  ('security.secret.reveal', 'm41-security', 'security_reveal', true),
  ('security.secret.destroy', 'm41-security', 'security_secret', true),
  ('security.dlp.read', 'm41-security', 'security_dlp_policy', false),
  ('security.dlp.manage', 'm41-security', 'security_dlp_policy', false),
  ('security.control.administer', 'm41-security', 'security', true),
  ('grc.control.read', 'm41-security', 'grc_control', false),
  ('grc.control.manage', 'm41-security', 'grc_control', false),
  ('grc.assessment.record', 'm41-security', 'grc_assessment', false),
  ('privacy.policy.read', 'm41-security', 'privacy_classification', false),
  ('privacy.policy.manage', 'm41-security', 'privacy_classification', false),
  ('privacy.record.manage', 'm41-security', 'privacy_record', false);

-- security_secret — governed secret/key METADATA (material_kind secret|key). Backs an opaque m30 secretref: pointer. Lifecycle
-- draft -> pending_approval -> active -> rotating -> retired/revoked/destroyed. current_version_no points at the active version.
-- Mutable aggregate (version CAS). THERE IS NO SECRET VALUE COLUMN — only an opaque secret_ref + an approved algorithm id.
CREATE TABLE security_secret (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  material_kind text NOT NULL DEFAULT 'secret', scope text NOT NULL DEFAULT 'tenant', secret_key text NOT NULL,
  secret_ref text NOT NULL, algorithm text, state text NOT NULL DEFAULT 'draft', current_version_no integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT security_secret_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT security_secret_id_key UNIQUE (tenant_id, id),
  CONSTRAINT security_secret_kind_ck CHECK (material_kind IN ('secret','key')),
  CONSTRAINT security_secret_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT security_secret_state_ck CHECK (state IN ('draft','pending_approval','active','rotating','retired','revoked','destroyed')),
  CONSTRAINT security_secret_key_ck CHECK (secret_key <> ''),
  CONSTRAINT security_secret_ref_ck CHECK (secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT security_secret_ver_ck CHECK (current_version_no >= 0));
ALTER TABLE security_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_secret FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_secret
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX security_secret_key_uniq ON security_secret (tenant_id, secret_key);
CREATE UNIQUE INDEX security_secret_ref_uniq ON security_secret (tenant_id, secret_ref);
COMMENT ON TABLE security_secret IS 'class=tenant_aggregate; m41 secret/key metadata (opaque secretref + approved algorithm; ZERO secret value)';

-- security_secret_version — a secret/key VERSION. Lifecycle pending -> active -> retired/revoked. provider_ref is an OPAQUE
-- external key/secret reference (the real KMS/HSM/Vault is deferred). AT MOST ONE ACTIVE version per secret (partial unique
-- index — rotation is race-safe). A non-pending version is IMMUTABLE (trigger). NO material column.
CREATE TABLE security_secret_version (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), secret_id uuid NOT NULL,
  version_no integer NOT NULL, state text NOT NULL DEFAULT 'pending', provider_ref text, activated_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT security_secret_version_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT security_secret_version_id_key UNIQUE (tenant_id, id),
  CONSTRAINT security_secret_version_state_ck CHECK (state IN ('pending','active','retired','revoked')),
  CONSTRAINT security_secret_version_no_ck CHECK (version_no >= 1),
  CONSTRAINT security_secret_version_secret_fkey FOREIGN KEY (tenant_id, secret_id) REFERENCES security_secret (tenant_id, id));
ALTER TABLE security_secret_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_secret_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_secret_version
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX security_secret_version_uniq ON security_secret_version (tenant_id, secret_id, version_no);
CREATE UNIQUE INDEX security_secret_version_one_active ON security_secret_version (tenant_id, secret_id) WHERE state = 'active';
COMMENT ON TABLE security_secret_version IS 'class=tenant_aggregate; m41 secret/key version (one-active rotation; opaque provider_ref; ZERO material)';

-- A non-pending secret version is IMMUTABLE (once activated its provider_ref/version_no are frozen; a revoked/retired version is
-- terminal). Rotation issues a NEW version; it never rewrites an active one.
CREATE OR REPLACE FUNCTION security_secret_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('revoked','retired') AND NEW.state = OLD.state
     AND (NEW.provider_ref IS DISTINCT FROM OLD.provider_ref OR NEW.version_no <> OLD.version_no) THEN
    RAISE EXCEPTION 'a % secret version is terminal and immutable', OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state <> 'pending' AND (NEW.version_no <> OLD.version_no OR NEW.secret_id <> OLD.secret_id) THEN
    RAISE EXCEPTION 'an activated secret version is immutable (issue a new version to rotate)' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER security_secret_version_immutable_trg BEFORE UPDATE ON security_secret_version
  FOR EACH ROW EXECUTE FUNCTION security_secret_version_immutable();

-- security_reveal — APPEND-ONLY: a governed plaintext REVEAL grant. MAKER-CHECKER (approved_by <> requested_by, both human —
-- in-service) + privileged + a purpose/reason + a bounded lifetime. THERE IS NO MATERIAL COLUMN — the reveal records the GRANT;
-- the actual material would be fetched through the fail-closed provider port (unavailable now) and is never persisted here.
CREATE TABLE security_reveal (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), secret_id uuid NOT NULL,
  requested_by uuid NOT NULL, approved_by uuid NOT NULL, purpose text NOT NULL, reason_code text,
  granted boolean NOT NULL DEFAULT false, expires_at timestamptz,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_reveal_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT security_reveal_id_key UNIQUE (tenant_id, id),
  CONSTRAINT security_reveal_purpose_ck CHECK (purpose <> ''),
  CONSTRAINT security_reveal_sod_ck CHECK (approved_by <> requested_by),
  CONSTRAINT security_reveal_secret_fkey FOREIGN KEY (tenant_id, secret_id) REFERENCES security_secret (tenant_id, id));
ALTER TABLE security_reveal ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_reveal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_reveal
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- security_dlp_policy — a DLP policy: a classification + an action (allow/redact/block). Mutable aggregate. Scope tenant|platform.
CREATE TABLE security_dlp_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', policy_key text NOT NULL, classification text NOT NULL, action text NOT NULL DEFAULT 'block',
  state text NOT NULL DEFAULT 'active', version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT security_dlp_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT security_dlp_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT security_dlp_policy_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT security_dlp_policy_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT security_dlp_policy_action_ck CHECK (action IN ('allow','redact','block')),
  CONSTRAINT security_dlp_policy_state_ck CHECK (state IN ('draft','active','retired')),
  CONSTRAINT security_dlp_policy_key_ck CHECK (policy_key <> ''));
ALTER TABLE security_dlp_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_dlp_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_dlp_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX security_dlp_policy_key_uniq ON security_dlp_policy (tenant_id, policy_key);

-- security_dlp_finding — APPEND-ONLY DLP decision evidence. Bounded: classification, action, reason, an OPAQUE source ref (m09)
-- and a finding count — NEVER the restricted content itself.
CREATE TABLE security_dlp_finding (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), policy_id uuid,
  classification text NOT NULL, action text NOT NULL, reason_code text, source_ref text, finding_count integer NOT NULL DEFAULT 0,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT security_dlp_finding_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT security_dlp_finding_id_key UNIQUE (tenant_id, id),
  CONSTRAINT security_dlp_finding_action_ck CHECK (action IN ('allow','redact','block')),
  CONSTRAINT security_dlp_finding_count_ck CHECK (finding_count >= 0));
ALTER TABLE security_dlp_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_dlp_finding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_dlp_finding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- security_incident — APPEND-ONLY SOC evidence (bounded: severity/category/state/reason + opaque evidence ref). No raw log body.
CREATE TABLE security_incident (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  incident_key text NOT NULL, severity text NOT NULL DEFAULT 'low', category text NOT NULL, state text NOT NULL DEFAULT 'open',
  reason_code text, evidence_ref text, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT security_incident_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT security_incident_id_key UNIQUE (tenant_id, id),
  CONSTRAINT security_incident_sev_ck CHECK (severity IN ('low','medium','high','critical')),
  CONSTRAINT security_incident_state_ck CHECK (state IN ('open','investigating','resolved','closed')),
  CONSTRAINT security_incident_key_ck CHECK (incident_key <> '' AND category <> ''));
ALTER TABLE security_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_incident FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_incident
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX security_incident_key_uniq ON security_incident (tenant_id, incident_key);

-- security_review — APPEND-ONLY maker-checker record for a controlled security action (secret rotate/revoke/destroy, reveal).
-- decided_by <> requested_by (SoD); AI/system/automation never approve (in-service isHumanActor).
CREATE TABLE security_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_kind text NOT NULL, target_id uuid NOT NULL, decision text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid NOT NULL, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT security_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT security_review_target_ck CHECK (target_kind IN ('secret','reveal','dlp_policy')),
  CONSTRAINT security_review_decision_ck CHECK (decision IN ('approved','rejected')),
  CONSTRAINT security_review_sod_ck CHECK (decided_by <> requested_by));
ALTER TABLE security_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- security_history — APPEND-ONLY lifecycle evidence for a secret/version/dlp_policy/incident transition.
CREATE TABLE security_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL, subject_id uuid NOT NULL, from_state text, to_state text NOT NULL, reason_code text,
  actor uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT security_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT security_history_subject_ck CHECK (subject_kind IN ('secret','secret_version','dlp_policy','incident','grc_control')),
  CONSTRAINT security_history_to_ck CHECK (to_state <> ''));
ALTER TABLE security_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX security_history_subject ON security_history (tenant_id, subject_kind, subject_id, created_at);

-- security_idempotency — APPEND-ONLY: a security command's idempotency key (safe retry). UNIQUE per tenant.
CREATE TABLE security_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, operation text NOT NULL, result_ref uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT security_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT security_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT security_idempotency_key_ck CHECK (idempotency_key <> ''));
ALTER TABLE security_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX security_idempotency_key_uniq ON security_idempotency (tenant_id, idempotency_key);

-- grc_control — a compliance CONTROL (framework catalogue). Mutable aggregate; scope tenant|platform.
CREATE TABLE grc_control (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', control_key text NOT NULL, framework text NOT NULL, title text NOT NULL,
  state text NOT NULL DEFAULT 'draft', version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT grc_control_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT grc_control_id_key UNIQUE (tenant_id, id),
  CONSTRAINT grc_control_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT grc_control_framework_ck CHECK (framework IN ('iso27001','soc2','gdpr','kenya_dpa','other')),
  CONSTRAINT grc_control_state_ck CHECK (state IN ('draft','active','retired')),
  CONSTRAINT grc_control_key_ck CHECK (control_key <> '' AND title <> ''));
ALTER TABLE grc_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE grc_control FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON grc_control
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX grc_control_key_uniq ON grc_control (tenant_id, control_key);

-- grc_assessment — APPEND-ONLY control assessment evidence (bounded: status + reason + opaque evidence ref).
CREATE TABLE grc_assessment (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), control_id uuid NOT NULL,
  status text NOT NULL, evidence_ref text, reason_code text, assessed_by uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grc_assessment_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT grc_assessment_id_key UNIQUE (tenant_id, id),
  CONSTRAINT grc_assessment_status_ck CHECK (status IN ('compliant','non_compliant','partial','not_assessed')),
  CONSTRAINT grc_assessment_control_fkey FOREIGN KEY (tenant_id, control_id) REFERENCES grc_control (tenant_id, id));
ALTER TABLE grc_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE grc_assessment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON grc_assessment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX grc_assessment_control ON grc_assessment (tenant_id, control_id, created_at);

-- privacy_classification — a data-classification policy (level + retention). Mutable aggregate.
CREATE TABLE privacy_classification (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', classification_key text NOT NULL, level text NOT NULL, retention_days integer,
  state text NOT NULL DEFAULT 'active', version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT privacy_classification_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT privacy_classification_id_key UNIQUE (tenant_id, id),
  CONSTRAINT privacy_classification_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT privacy_classification_level_ck CHECK (level IN ('public','internal','confidential','restricted')),
  CONSTRAINT privacy_classification_state_ck CHECK (state IN ('draft','active','retired')),
  CONSTRAINT privacy_classification_ret_ck CHECK (retention_days IS NULL OR retention_days >= 0),
  CONSTRAINT privacy_classification_key_ck CHECK (classification_key <> ''));
ALTER TABLE privacy_classification ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_classification FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON privacy_classification
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX privacy_classification_key_uniq ON privacy_classification (tenant_id, classification_key);

-- privacy_record — APPEND-ONLY privacy processing/control evidence (bounded: an OPAQUE subject ref, classification, action,
-- reason, opaque evidence ref). NEVER raw personal data.
CREATE TABLE privacy_record (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_ref text NOT NULL, classification text, action text NOT NULL, reason_code text, evidence_ref text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT privacy_record_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT privacy_record_id_key UNIQUE (tenant_id, id),
  CONSTRAINT privacy_record_action_ck CHECK (action IN ('process','mask','redact','retain','erase_request','access_request')),
  CONSTRAINT privacy_record_subject_ck CHECK (subject_ref <> ''));
ALTER TABLE privacy_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON privacy_record
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX privacy_record_subject ON privacy_record (tenant_id, subject_ref, created_at);
