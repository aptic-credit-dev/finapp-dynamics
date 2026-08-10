-- ---------------------------------------------------------------------------------------------------
-- M31-studio — STUDIO (Stage 6B, mvp:false): the DESIGN-TIME authoring layer for Workflow/BPM, Rules and reusable
-- Forms. IT IS NOT A SECOND RUNTIME ENGINE. m06 stays the canonical workflow engine (workflow_definition/_version +
-- execution), m07 the canonical rules engine (rule_set/_version + evaluation); a validated+approved Studio design BINDS
-- to their public authoring contracts and m31 stores ONLY an OPAQUE binding tuple (definitionId/ruleSetId, versionId,
-- versionNumber, code, contentHash) — there is NO workflow_definition/rule_set table here, no runtime state, no engine.
-- Forms are governed as artifacts (kind='form') whose immutable published version carries a DECLARATIVE schema; m31
-- owns reusable FORM DEFINITIONS only — FORM DEFINITION != BUSINESS RECORD (no submitted form data is stored here).
-- HARD RULES ARE DB-ENFORCED: a published artifact version is IMMUTABLE (studio_artifact_version_immutable trigger);
-- publishing is a CONTROLLED ACTION with maker-checker/SoD (studio_review: an approved/rejected decision needs a decider
-- and decided_by <> requested_by); a design cannot reach validated/review/published without a passing validation
-- (studio_artifact_version_evidence_ck). A secret-bearing design value carries ONLY an opaque secretref: pointer
-- (secretref: shape CHECK); there is NO password/key/token/credential VALUE column anywhere; no float. Every tenant-scoped
-- table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs (within m31), version
-- on mutable aggregates. No DELETE grant (ADR-010). Dependency/binding/validation/review/history + the idempotency ledger
-- are append-only (INSERT+SELECT, 0002). m31 emits studio.lifecycle through the ONE m06 outbox (no second outbox).
-- PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- GAP M31-3 resolution (ADR-118): the studio.* permission namespace. Three-segment studio.<area>.<action>; every
-- controlled authoring/validate/publish/bind operation authorizes one (default deny). Mirroring platform.*/admin.*,
-- studio.control.administer is the cross-tenant CONTROL-PLANE permission a tenant admin never holds by default;
-- manage/publish/archive/binding codes are privileged. Publish/archive/bind are privileged CONTROLLED actions. There is
-- NO studio.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('studio.project.read', 'm31-studio', 'studio_project', false),
  ('studio.project.manage', 'm31-studio', 'studio_project', true),
  ('studio.artifact.read', 'm31-studio', 'studio_artifact', false),
  ('studio.artifact.author', 'm31-studio', 'studio_artifact', false),
  ('studio.artifact.validate', 'm31-studio', 'studio_artifact', false),
  ('studio.artifact.publish', 'm31-studio', 'studio_artifact', true),
  ('studio.artifact.archive', 'm31-studio', 'studio_artifact', true),
  ('studio.binding.manage', 'm31-studio', 'studio_binding', true),
  ('studio.control.administer', 'm31-studio', 'studio', true);

-- studio_project — a design workspace/project grouping artifacts. One active per (tenant, scope, project_key).
CREATE TABLE studio_project (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', project_key text NOT NULL, name text NOT NULL, description text,
  status text NOT NULL DEFAULT 'active', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT studio_project_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT studio_project_id_key UNIQUE (tenant_id, id),
  CONSTRAINT studio_project_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT studio_project_status_ck CHECK (status IN ('active','archived')),
  CONSTRAINT studio_project_optlock_ck CHECK (version >= 1));
ALTER TABLE studio_project ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_project FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_project
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX studio_project_one_active ON studio_project (tenant_id, scope, project_key) WHERE status = 'active';
CREATE UNIQUE INDEX studio_project_idem ON studio_project (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE studio_project IS 'class=tenant_aggregate; m31 design workspace/project';

-- studio_artifact — a design artifact HEADER (kind workflow|rule|form). Its versions carry the design + lifecycle.
-- latest_version tracks the newest draft version; published_version tracks the currently published one (if any).
CREATE TABLE studio_artifact (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), project_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'tenant', kind text NOT NULL, artifact_key text NOT NULL, name text NOT NULL, description text,
  status text NOT NULL DEFAULT 'active', latest_version integer NOT NULL DEFAULT 0, published_version integer,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT studio_artifact_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT studio_artifact_id_key UNIQUE (tenant_id, id),
  CONSTRAINT studio_artifact_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT studio_artifact_kind_ck CHECK (kind IN ('workflow','rule','form')),
  CONSTRAINT studio_artifact_status_ck CHECK (status IN ('active','archived')),
  CONSTRAINT studio_artifact_optlock_ck CHECK (version >= 1),
  CONSTRAINT studio_artifact_latest_ck CHECK (latest_version >= 0),
  CONSTRAINT studio_artifact_project_fkey FOREIGN KEY (tenant_id, project_id) REFERENCES studio_project (tenant_id, id));
ALTER TABLE studio_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_artifact
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX studio_artifact_one_active ON studio_artifact (tenant_id, scope, kind, artifact_key) WHERE status = 'active';
CREATE UNIQUE INDEX studio_artifact_idem ON studio_artifact (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE studio_artifact IS 'class=tenant_aggregate; m31 design artifact header (workflow|rule|form)';

-- studio_artifact_version — a design SNAPSHOT. The declarative design lives in `spec` jsonb (a workflow graph, a rule
-- set, or a form schema — never executable code). state advances draft -> validating -> validated -> review_pending ->
-- published; a published/superseded/archived version is IMMUTABLE (trigger). validation_passed gates validated+ states
-- (evidence_ck). content_hash freezes the spec. NO secret VALUE column — a secret-bearing design value lives inside the
-- declarative spec as a secretref: pointer, screened by the service; there is no value column here.
CREATE TABLE studio_artifact_version (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), artifact_id uuid NOT NULL,
  version_no integer NOT NULL, state text NOT NULL DEFAULT 'draft', spec jsonb NOT NULL,
  content_hash text NOT NULL, validation_passed boolean NOT NULL DEFAULT false, notes text,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT studio_artifact_version_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT studio_artifact_version_id_key UNIQUE (tenant_id, id),
  CONSTRAINT studio_artifact_version_state_ck CHECK (state IN ('draft','validating','validated','review_pending','published','superseded','rejected','archived')),
  CONSTRAINT studio_artifact_version_optlock_ck CHECK (version >= 1),
  CONSTRAINT studio_artifact_version_no_ck CHECK (version_no >= 1),
  -- a design cannot reach validated/review/published without a passing validation (validation failure blocks publication).
  CONSTRAINT studio_artifact_version_evidence_ck CHECK (state NOT IN ('validated','review_pending','published') OR validation_passed = true),
  CONSTRAINT studio_artifact_version_artifact_fkey FOREIGN KEY (tenant_id, artifact_id) REFERENCES studio_artifact (tenant_id, id));
ALTER TABLE studio_artifact_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_artifact_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_artifact_version
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX studio_artifact_version_no_uk ON studio_artifact_version (tenant_id, artifact_id, version_no);
CREATE UNIQUE INDEX studio_artifact_version_one_published ON studio_artifact_version (tenant_id, artifact_id) WHERE state = 'published';
CREATE UNIQUE INDEX studio_artifact_version_idem ON studio_artifact_version (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE studio_artifact_version IS 'class=tenant_aggregate; m31 design version snapshot (declarative spec; published-immutable)';

-- PUBLISHED-IMMUTABILITY: once a version reaches a terminal design state it can never be mutated; and spec/content_hash/
-- version_no/artifact_id are frozen at insert for every version. Binds all roles (SECURITY DEFINER not needed — it is a
-- constraint trigger on the table). This is the DB proof that a published design version is immutable (T).
CREATE OR REPLACE FUNCTION studio_artifact_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('published','superseded','archived') THEN
    RAISE EXCEPTION 'studio_artifact_version % is immutable in state %', OLD.id, OLD.state
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.spec::text <> OLD.spec::text OR NEW.content_hash <> OLD.content_hash
     OR NEW.version_no <> OLD.version_no OR NEW.artifact_id <> OLD.artifact_id THEN
    RAISE EXCEPTION 'studio_artifact_version spec/content_hash/version_no/artifact_id are immutable once written'
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER studio_artifact_version_immutable_trg BEFORE UPDATE ON studio_artifact_version
  FOR EACH ROW EXECUTE FUNCTION studio_artifact_version_immutable();

-- studio_dependency — APPEND-ONLY: a version's declared dependencies on OTHER Studio artifacts + opaque integration
-- capability references. Used to validate unpublished-dependency versions, circular dependencies and (deferred) m33
-- connector capabilities. capability_ref is an OPAQUE reference only (m33 unbuilt) — never a connector, credential or URL.
CREATE TABLE studio_dependency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), artifact_version_id uuid NOT NULL,
  depends_on_artifact_id uuid, depends_on_kind text, required_min_version integer, capability_ref text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT studio_dependency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT studio_dependency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT studio_dependency_kind_ck CHECK (depends_on_kind IS NULL OR depends_on_kind IN ('workflow','rule','form')),
  -- a dependency is EITHER on another artifact OR an opaque integration capability reference.
  CONSTRAINT studio_dependency_target_ck CHECK (depends_on_artifact_id IS NOT NULL OR capability_ref IS NOT NULL),
  CONSTRAINT studio_dependency_version_fkey FOREIGN KEY (tenant_id, artifact_version_id) REFERENCES studio_artifact_version (tenant_id, id),
  CONSTRAINT studio_dependency_on_fkey FOREIGN KEY (tenant_id, depends_on_artifact_id) REFERENCES studio_artifact (tenant_id, id));
ALTER TABLE studio_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_dependency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_dependency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX studio_dependency_by_version ON studio_dependency (tenant_id, artifact_version_id);
COMMENT ON TABLE studio_dependency IS 'class=tenant_ledger_append_only; m31 declared design dependencies + opaque capability refs';

-- studio_validation_result — APPEND-ONLY: machine-readable validation outcome for a version. findings is a bounded array
-- of {code, severity, ref} objects (reason codes, never spec content). passed=false blocks publication.
CREATE TABLE studio_validation_result (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), artifact_version_id uuid NOT NULL,
  passed boolean NOT NULL, finding_count integer NOT NULL DEFAULT 0, findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT studio_validation_result_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT studio_validation_result_id_key UNIQUE (tenant_id, id),
  CONSTRAINT studio_validation_result_count_ck CHECK (finding_count >= 0),
  CONSTRAINT studio_validation_result_version_fkey FOREIGN KEY (tenant_id, artifact_version_id) REFERENCES studio_artifact_version (tenant_id, id));
ALTER TABLE studio_validation_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_validation_result FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_validation_result
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX studio_validation_result_by_version ON studio_validation_result (tenant_id, artifact_version_id);
COMMENT ON TABLE studio_validation_result IS 'class=tenant_ledger_append_only; m31 machine-readable validation outcomes';

-- studio_review — APPEND-ONLY maker-checker ledger. A 'requested' row records the requester; an 'approved'/'rejected'
-- decision records the decider and MUST differ from the requester (SoD). AI never approves (isHumanActor in-service).
CREATE TABLE studio_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), artifact_version_id uuid NOT NULL,
  kind text NOT NULL, requested_by uuid NOT NULL, decided_by uuid, reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT studio_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT studio_review_kind_ck CHECK (kind IN ('requested','approved','rejected')),
  -- an approved/rejected DECISION requires a decider; a 'requested' row has none.
  CONSTRAINT studio_review_decider_ck CHECK (kind = 'requested' OR decided_by IS NOT NULL),
  -- SEGREGATION OF DUTIES: a decider can never be the requester (author != approver).
  CONSTRAINT studio_review_sod_ck CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT studio_review_version_fkey FOREIGN KEY (tenant_id, artifact_version_id) REFERENCES studio_artifact_version (tenant_id, id));
ALTER TABLE studio_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX studio_review_by_version ON studio_review (tenant_id, artifact_version_id);
COMMENT ON TABLE studio_review IS 'class=tenant_ledger_append_only; m31 maker-checker review/publication decisions';

-- studio_binding — APPEND-ONLY: the OPAQUE binding created at publish, pointing at the canonical m06/m07 published
-- definition (or 'none' for a form). It holds ONLY the opaque tuple (target_definition_id/version_id/version_no/code/
-- content_hash) — m31 owns NO workflow_definition/rule_set table and reads none. capability_ref is an opaque m33 ref.
CREATE TABLE studio_binding (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), artifact_version_id uuid NOT NULL,
  target_engine text NOT NULL, target_definition_id uuid, target_version_id uuid, target_version_no integer,
  target_code text, content_hash text, capability_ref text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT studio_binding_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT studio_binding_id_key UNIQUE (tenant_id, id),
  CONSTRAINT studio_binding_engine_ck CHECK (target_engine IN ('workflow','rule','none')),
  -- a workflow/rule binding must carry the opaque canonical definition/version ids; a form binds to nothing external.
  CONSTRAINT studio_binding_target_ck CHECK (
    (target_engine = 'none' AND target_definition_id IS NULL)
    OR (target_engine IN ('workflow','rule') AND target_definition_id IS NOT NULL AND target_version_id IS NOT NULL)),
  CONSTRAINT studio_binding_version_fkey FOREIGN KEY (tenant_id, artifact_version_id) REFERENCES studio_artifact_version (tenant_id, id));
ALTER TABLE studio_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_binding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX studio_binding_by_version ON studio_binding (tenant_id, artifact_version_id);
COMMENT ON TABLE studio_binding IS 'class=tenant_ledger_append_only; m31 opaque binding to canonical m06/m07 published definitions';

-- studio_artifact_history — APPEND-ONLY status/transition evidence (project|artifact|version).
CREATE TABLE studio_artifact_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_artifact_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT studio_artifact_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT studio_artifact_history_target_ck CHECK (target_type IN ('project','artifact','version')));
ALTER TABLE studio_artifact_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_artifact_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_artifact_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX studio_artifact_history_by_target ON studio_artifact_history (tenant_id, target_type, target_id);
COMMENT ON TABLE studio_artifact_history IS 'class=tenant_ledger_append_only; m31 design status/transition history';

-- studio_idempotency — APPEND-ONLY idempotency ledger (no duplicate publish/version/binding).
CREATE TABLE studio_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, target_type text, target_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT studio_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT studio_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT studio_idempotency_key_uk UNIQUE (tenant_id, idempotency_key));
ALTER TABLE studio_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE studio_idempotency IS 'class=tenant_ledger_append_only; m31 idempotency ledger (no duplicate design mutation)';
