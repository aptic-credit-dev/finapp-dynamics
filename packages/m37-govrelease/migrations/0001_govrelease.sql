-- ---------------------------------------------------------------------------------------------------
-- M37-govrelease — INTEGRATION GOVERNANCE / QA / RELEASE (Stage 6D-5, mvp:false): the governed promotion of an integration
-- ARTIFACT (an m33 connector, an m34 marketplace listing, an m35 API product, an m36 webhook/stream) through QA GATES to a
-- RELEASED state, per target ENVIRONMENT. m37 RECORDS + GOVERNS the release DECISION + QA evidence; it EXECUTES no release
-- (the runtime stays with the owning module). It CONSUMES m33/m34/m35/m36 BY CONTRACT (opaque artifact_kind + artifact_ref;
-- releasability checked via a fail-closed port) and reads no other module's table. HARD RULES ARE DB-ENFORCED. THE QA RULE:
-- a release cannot enter review/released without a passing validation (govrelease_release_evidence_ck: state in
-- (review_pending, released) => qa_passed). THE APPROVAL RULE: a release decision needs a decider and decided_by <>
-- requested_by (govrelease_review SoD; AI never approves — in-service). A RELEASED record is IMMUTABLE
-- (govrelease_release_immutable trigger; only released -> rolled_back). THE SECRET RULE: a release signature/attestation is
-- an opaque secretref: pointer (govrelease_evidence.signature_ref shape CHECK; the m30 seam); there is NO secret VALUE column
-- anywhere; real key mgmt = m41. It uses the govrelease_* prefix (integration_* is m23's, connector_* is m33's, marketplace_*
-- is m34's, devportal_* is m35's, webhook_/eventstream_/events_ are m36's) and owns govrelease.lifecycle ONLY, emitting
-- through the ONE m06 outbox. Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE +
-- tenant_isolation, composite FKs (within m37), version on mutable aggregates. No DELETE grant (ADR-010). Check/review/
-- evidence/history + the idempotency ledger are append-only (INSERT+SELECT, 0002). No float. PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- GAP-4 resolution: the govrelease.* permission namespace. Three-segment govrelease.<area>.<action>; every controlled
-- artifact/environment/release/gate operation authorizes one (default deny). govrelease.control.administer is the cross-tenant
-- CONTROL-PLANE permission a tenant admin never holds by default; release approve + release execute (rollback) are privileged
-- (controlled actions). NO govrelease.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('govrelease.artifact.read', 'm37-govrelease', 'govrelease_artifact', false),
  ('govrelease.artifact.manage', 'm37-govrelease', 'govrelease_artifact', false),
  ('govrelease.release.read', 'm37-govrelease', 'govrelease_release', false),
  ('govrelease.release.author', 'm37-govrelease', 'govrelease_release', false),
  ('govrelease.gate.manage', 'm37-govrelease', 'govrelease_gate', false),
  ('govrelease.release.approve', 'm37-govrelease', 'govrelease_release', true),
  ('govrelease.release.execute', 'm37-govrelease', 'govrelease_release', true),
  ('govrelease.control.administer', 'm37-govrelease', 'govrelease', true);

-- govrelease_artifact — a governed integration artifact under release management (artifact_ref is OPAQUE — m37 never reads
-- the owning module's table). status active -> retired.
CREATE TABLE govrelease_artifact (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', artifact_key text NOT NULL, artifact_kind text NOT NULL, artifact_ref text NOT NULL,
  name text NOT NULL, status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT govrelease_artifact_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT govrelease_artifact_id_key UNIQUE (tenant_id, id),
  CONSTRAINT govrelease_artifact_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT govrelease_artifact_kind_ck CHECK (artifact_kind IN ('connector','marketplace','devportal','webhook','eventstream','internal')),
  CONSTRAINT govrelease_artifact_status_ck CHECK (status IN ('active','retired')),
  CONSTRAINT govrelease_artifact_optlock_ck CHECK (version >= 1));
ALTER TABLE govrelease_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE govrelease_artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON govrelease_artifact
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX govrelease_artifact_one_key ON govrelease_artifact (tenant_id, scope, artifact_key) WHERE status <> 'retired';
CREATE UNIQUE INDEX govrelease_artifact_idem ON govrelease_artifact (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE govrelease_artifact IS 'class=tenant_aggregate; m37 governed integration artifact (opaque owner ref)';

-- govrelease_environment — a target environment for promotion (tier ordering; requires_approval). status active -> retired.
CREATE TABLE govrelease_environment (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', env_key text NOT NULL, tier integer NOT NULL DEFAULT 0,
  requires_approval boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT govrelease_environment_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT govrelease_environment_id_key UNIQUE (tenant_id, id),
  CONSTRAINT govrelease_environment_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT govrelease_environment_status_ck CHECK (status IN ('active','retired')),
  CONSTRAINT govrelease_environment_tier_ck CHECK (tier >= 0),
  CONSTRAINT govrelease_environment_optlock_ck CHECK (version >= 1));
ALTER TABLE govrelease_environment ENABLE ROW LEVEL SECURITY;
ALTER TABLE govrelease_environment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON govrelease_environment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX govrelease_environment_one_key ON govrelease_environment (tenant_id, scope, env_key) WHERE status <> 'retired';
CREATE UNIQUE INDEX govrelease_environment_idem ON govrelease_environment (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE govrelease_environment IS 'class=tenant_aggregate; m37 target promotion environment';

-- govrelease_release — a release/promotion of an artifact to an environment. Lifecycle draft -> qa_pending -> qa_passed ->
-- review_pending -> released (maker-checker) -> rolled_back; released is IMMUTABLE. Cannot enter review/released without a
-- passing validation (evidence_ck).
CREATE TABLE govrelease_release (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), artifact_id uuid NOT NULL, environment_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'tenant', release_key text NOT NULL, from_version integer, to_version integer NOT NULL,
  state text NOT NULL DEFAULT 'draft', qa_passed boolean NOT NULL DEFAULT false, requested_by uuid, content_hash text NOT NULL,
  idempotency_key text, version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT govrelease_release_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT govrelease_release_id_key UNIQUE (tenant_id, id),
  CONSTRAINT govrelease_release_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT govrelease_release_state_ck CHECK (state IN ('draft','qa_pending','qa_passed','review_pending','released','rejected','rolled_back')),
  CONSTRAINT govrelease_release_evidence_ck CHECK (state NOT IN ('review_pending','released') OR qa_passed = true),
  CONSTRAINT govrelease_release_ver_ck CHECK (to_version >= 1 AND (from_version IS NULL OR from_version >= 1)),
  CONSTRAINT govrelease_release_optlock_ck CHECK (version >= 1),
  CONSTRAINT govrelease_release_artifact_fkey FOREIGN KEY (tenant_id, artifact_id) REFERENCES govrelease_artifact (tenant_id, id),
  CONSTRAINT govrelease_release_env_fkey FOREIGN KEY (tenant_id, environment_id) REFERENCES govrelease_environment (tenant_id, id));
ALTER TABLE govrelease_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE govrelease_release FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON govrelease_release
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX govrelease_release_one_released ON govrelease_release (tenant_id, artifact_id, environment_id) WHERE state = 'released';
CREATE UNIQUE INDEX govrelease_release_idem ON govrelease_release (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE govrelease_release IS 'class=tenant_aggregate; m37 release/promotion of an artifact to an environment (released-immutable)';

-- RELEASED-IMMUTABILITY: a rejected release is terminal; key/artifact/env/hash are frozen once past draft; a released record
-- may only move to rolled_back.
CREATE OR REPLACE FUNCTION govrelease_release_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('rejected') THEN
    RAISE EXCEPTION 'govrelease_release % is immutable in state %', OLD.id, OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.release_key <> OLD.release_key OR NEW.artifact_id <> OLD.artifact_id OR NEW.environment_id <> OLD.environment_id
     OR NEW.to_version <> OLD.to_version OR NEW.content_hash <> OLD.content_hash THEN
    RAISE EXCEPTION 'a release identity (key/artifact/environment/version/hash) is immutable' USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state = 'released' AND NEW.state NOT IN ('released','rolled_back') THEN
    RAISE EXCEPTION 'a released record may only move to rolled_back' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER govrelease_release_immutable_trg BEFORE UPDATE ON govrelease_release
  FOR EACH ROW EXECUTE FUNCTION govrelease_release_immutable();

-- govrelease_gate — a required QA gate for a release. status pending -> passed/failed/waived (driven by append-only checks).
CREATE TABLE govrelease_gate (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), release_id uuid NOT NULL,
  gate_key text NOT NULL, kind text NOT NULL DEFAULT 'quality', required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending', version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT govrelease_gate_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT govrelease_gate_id_key UNIQUE (tenant_id, id),
  CONSTRAINT govrelease_gate_status_ck CHECK (status IN ('pending','passed','failed','waived')),
  CONSTRAINT govrelease_gate_optlock_ck CHECK (version >= 1),
  CONSTRAINT govrelease_gate_release_fkey FOREIGN KEY (tenant_id, release_id) REFERENCES govrelease_release (tenant_id, id));
ALTER TABLE govrelease_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE govrelease_gate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON govrelease_gate
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX govrelease_gate_uniq ON govrelease_gate (tenant_id, release_id, gate_key);
COMMENT ON TABLE govrelease_gate IS 'class=tenant_aggregate; m37 required QA gate for a release';

-- govrelease_check — APPEND-ONLY QA check RESULT/evidence for a gate. status passed/failed. Carries NO report body/secret.
CREATE TABLE govrelease_check (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), gate_id uuid NOT NULL, release_id uuid NOT NULL,
  check_kind text NOT NULL, status text NOT NULL, evidence_ref text, detail text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT govrelease_check_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT govrelease_check_id_key UNIQUE (tenant_id, id),
  CONSTRAINT govrelease_check_status_ck CHECK (status IN ('passed','failed')),
  CONSTRAINT govrelease_check_gate_fkey FOREIGN KEY (tenant_id, gate_id) REFERENCES govrelease_gate (tenant_id, id));
ALTER TABLE govrelease_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE govrelease_check FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON govrelease_check
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX govrelease_check_by_gate ON govrelease_check (tenant_id, gate_id);
COMMENT ON TABLE govrelease_check IS 'class=tenant_ledger_append_only; m37 QA check result evidence (no report body/secret)';

-- govrelease_review — APPEND-ONLY maker-checker ledger for release approval. A decision needs a decider and the decider can
-- never be the requester (SoD). AI never approves (isHumanActor in-service).
CREATE TABLE govrelease_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, kind text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid, reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT govrelease_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT govrelease_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT govrelease_review_target_ck CHECK (target_type IN ('release')),
  CONSTRAINT govrelease_review_kind_ck CHECK (kind IN ('requested','approved','rejected')),
  CONSTRAINT govrelease_review_decider_ck CHECK (kind = 'requested' OR decided_by IS NOT NULL),
  CONSTRAINT govrelease_review_sod_ck CHECK (decided_by IS NULL OR decided_by <> requested_by));
ALTER TABLE govrelease_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE govrelease_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON govrelease_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX govrelease_review_by_target ON govrelease_review (tenant_id, target_type, target_id);
COMMENT ON TABLE govrelease_review IS 'class=tenant_ledger_append_only; m37 maker-checker release decisions';

-- govrelease_evidence — APPEND-ONLY release evidence (a QA report/attestation reference + an optional SIGNATURE as an OPAQUE
-- secretref: pointer, the m30 seam). THERE IS NO signature VALUE column — only a reference.
CREATE TABLE govrelease_evidence (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), release_id uuid NOT NULL,
  evidence_kind text NOT NULL, evidence_ref text, signature_ref text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT govrelease_evidence_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT govrelease_evidence_id_key UNIQUE (tenant_id, id),
  CONSTRAINT govrelease_evidence_sig_shape_ck CHECK (signature_ref IS NULL OR signature_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT govrelease_evidence_release_fkey FOREIGN KEY (tenant_id, release_id) REFERENCES govrelease_release (tenant_id, id));
ALTER TABLE govrelease_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE govrelease_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON govrelease_evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX govrelease_evidence_by_release ON govrelease_evidence (tenant_id, release_id);
COMMENT ON TABLE govrelease_evidence IS 'class=tenant_ledger_append_only; m37 release evidence (opaque report ref + secretref signature only)';

-- govrelease_history — APPEND-ONLY status/transition evidence (artifact|environment|release|gate).
CREATE TABLE govrelease_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT govrelease_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT govrelease_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT govrelease_history_target_ck CHECK (target_type IN ('artifact','environment','release','gate')));
ALTER TABLE govrelease_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE govrelease_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON govrelease_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX govrelease_history_by_target ON govrelease_history (tenant_id, target_type, target_id);
COMMENT ON TABLE govrelease_history IS 'class=tenant_ledger_append_only; m37 artifact/environment/release/gate history';

-- govrelease_idempotency — APPEND-ONLY idempotency ledger (no duplicate register/request/approve/rollback).
CREATE TABLE govrelease_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, target_type text, target_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT govrelease_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT govrelease_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT govrelease_idempotency_key_uk UNIQUE (tenant_id, idempotency_key));
ALTER TABLE govrelease_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE govrelease_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON govrelease_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE govrelease_idempotency IS 'class=tenant_ledger_append_only; m37 idempotency ledger (no duplicate govrelease mutation)';
