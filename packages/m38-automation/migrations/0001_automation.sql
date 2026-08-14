-- ---------------------------------------------------------------------------------------------------
-- M38-automation — SCHEDULER / AUTOMATION / EXTENSION FRAMEWORK (Stage 6E, mvp:false): a governed ORCHESTRATION layer —
-- automation DEFINITIONS whose steps reference REGISTERED CAPABILITIES (opaque refs + the m02 permission each requires),
-- recurring SCHEDULES, append-only execution EVIDENCE, and a governed EXTENSION framework (extension points, trust tiers,
-- isolation). THE LOAD-BEARING BOUNDARY: m06 owns THE durable timer + the workflow runtime + THE outbox — m38 owns NO second
-- timer/scheduler/workflow engine; it owns the schedule/automation definitions + evidence and COMPOSES m06's timer per
-- occurrence (via port). HARD RULES ARE DB-ENFORCED. THE CAPABILITY RULE: an automation step + an extension point carry the
-- m02 permission they require (required_permission NOT NULL + 3-segment) — automation never bypasses RBAC and stores NO raw
-- executable code. THE ACTIVATION RULE: activating an automation / publishing an extension is maker-checker (automation_review
-- decided_by <> requested_by, SoD; a passing validation; AI never approves — in-service). A published extension + an active
-- automation are IMMUTABLE (triggers). THE SECRET RULE: a step's secret-bearing config is an opaque secretref: pointer
-- (automation_step.config_secret_ref shape CHECK; the m30 seam); there is NO secret VALUE column; real key mgmt = m41. It uses
-- the automation_ and extension_ prefixes and owns automation.lifecycle + extension.lifecycle ONLY, emitting through the ONE
-- m06 outbox. Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite
-- FKs (within m38), version on mutable aggregates. No DELETE grant (ADR-010). Step/run/review/point/history + the idempotency
-- ledger are append-only (INSERT+SELECT, 0002). No float (intervals/epochs are integer/bigint). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- The automation.* + extensions.* permission namespaces (already declared in naming-map; no GAP-4). Three-segment. Every
-- controlled automation/schedule/run/extension operation authorizes one (default deny). automation.control.administer is the
-- cross-tenant CONTROL-PLANE permission a tenant admin never holds by default; automation.job.activate + extensions.registry.
-- publish are privileged (controlled actions). NO automation.admin / extensions.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('automation.job.read', 'm38-automation', 'automation_definition', false),
  ('automation.job.manage', 'm38-automation', 'automation_definition', false),
  ('automation.job.activate', 'm38-automation', 'automation_definition', true),
  ('automation.execution.read', 'm38-automation', 'automation_run', false),
  ('automation.control.administer', 'm38-automation', 'automation', true),
  ('extensions.registry.read', 'm38-automation', 'extension_definition', false),
  ('extensions.registry.manage', 'm38-automation', 'extension_definition', false),
  ('extensions.registry.publish', 'm38-automation', 'extension_definition', true),
  ('extensions.install.manage', 'm38-automation', 'extension_installation', false);

-- automation_definition — an automation (trigger schedule/event/manual). Lifecycle draft -> review_pending -> active
-- (maker-checker) -> suspended -> archived; an active automation is IMMUTABLE (key/hash), archived is terminal.
CREATE TABLE automation_definition (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', automation_key text NOT NULL, name text NOT NULL, trigger_kind text NOT NULL DEFAULT 'schedule',
  state text NOT NULL DEFAULT 'draft', validation_passed boolean NOT NULL DEFAULT false, content_hash text NOT NULL, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT automation_definition_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT automation_definition_id_key UNIQUE (tenant_id, id),
  CONSTRAINT automation_definition_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT automation_definition_trigger_ck CHECK (trigger_kind IN ('schedule','event','manual')),
  CONSTRAINT automation_definition_state_ck CHECK (state IN ('draft','review_pending','active','suspended','archived')),
  CONSTRAINT automation_definition_evidence_ck CHECK (state NOT IN ('review_pending','active') OR validation_passed = true),
  CONSTRAINT automation_definition_optlock_ck CHECK (version >= 1));
ALTER TABLE automation_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_definition
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX automation_definition_one_key ON automation_definition (tenant_id, scope, automation_key) WHERE state <> 'archived';
CREATE UNIQUE INDEX automation_definition_idem ON automation_definition (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE automation_definition IS 'class=tenant_aggregate; m38 automation definition (active-immutable, orchestrates registered capabilities)';

CREATE OR REPLACE FUNCTION automation_definition_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('archived') THEN
    RAISE EXCEPTION 'automation_definition % is terminal in state %', OLD.id, OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.automation_key <> OLD.automation_key OR (OLD.state <> 'draft' AND NEW.content_hash <> OLD.content_hash) THEN
    RAISE EXCEPTION 'an active automation is immutable (key/hash) — suspend to edit' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER automation_definition_immutable_trg BEFORE UPDATE ON automation_definition
  FOR EACH ROW EXECUTE FUNCTION automation_definition_immutable();

-- automation_step — APPEND-ONLY: an ordered step referencing a REGISTERED capability (opaque capability_ref) + the m02
-- permission it REQUIRES (the facade rule) + an OPTIONAL opaque input reference + an OPTIONAL secretref config pointer. NO
-- raw executable code / arbitrary URL.
CREATE TABLE automation_step (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), automation_id uuid NOT NULL,
  step_no integer NOT NULL, capability_ref text NOT NULL, required_permission text NOT NULL, input_ref text, config_secret_ref text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT automation_step_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT automation_step_id_key UNIQUE (tenant_id, id),
  CONSTRAINT automation_step_no_ck CHECK (step_no >= 1),
  CONSTRAINT automation_step_perm_ck CHECK (required_permission <> '' AND array_length(string_to_array(required_permission,'.'),1) = 3),
  CONSTRAINT automation_step_secret_ref_ck CHECK (config_secret_ref IS NULL OR config_secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT automation_step_automation_fkey FOREIGN KEY (tenant_id, automation_id) REFERENCES automation_definition (tenant_id, id));
ALTER TABLE automation_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_step FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_step
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX automation_step_uniq ON automation_step (tenant_id, automation_id, step_no);
COMMENT ON TABLE automation_step IS 'class=tenant_ledger_append_only; m38 automation step (registered capability ref + required m02 permission; no code)';

-- automation_schedule — a recurring schedule for an automation. Recurrence is a GOVERNED expression (validated in-service);
-- next_run_at is a bigint epoch (no float); the durable wake-up is composed from m06 by port. Bounded frequency/retry/timeout.
CREATE TABLE automation_schedule (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), automation_id uuid NOT NULL,
  schedule_key text NOT NULL, recurrence text NOT NULL, timezone text NOT NULL DEFAULT 'UTC',
  starts_at timestamptz, ends_at timestamptz, min_interval_seconds integer NOT NULL DEFAULT 60,
  concurrency_policy text NOT NULL DEFAULT 'forbid', missed_run_policy text NOT NULL DEFAULT 'skip',
  max_retries integer NOT NULL DEFAULT 0, timeout_seconds integer NOT NULL DEFAULT 300, next_run_at bigint,
  status text NOT NULL DEFAULT 'active', version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT automation_schedule_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT automation_schedule_id_key UNIQUE (tenant_id, id),
  CONSTRAINT automation_schedule_status_ck CHECK (status IN ('active','suspended')),
  CONSTRAINT automation_schedule_conc_ck CHECK (concurrency_policy IN ('allow','forbid','replace')),
  CONSTRAINT automation_schedule_missed_ck CHECK (missed_run_policy IN ('skip','run_once')),
  CONSTRAINT automation_schedule_freq_ck CHECK (min_interval_seconds >= 60),
  CONSTRAINT automation_schedule_retry_ck CHECK (max_retries >= 0 AND max_retries <= 8),
  CONSTRAINT automation_schedule_timeout_ck CHECK (timeout_seconds >= 1),
  CONSTRAINT automation_schedule_optlock_ck CHECK (version >= 1),
  CONSTRAINT automation_schedule_automation_fkey FOREIGN KEY (tenant_id, automation_id) REFERENCES automation_definition (tenant_id, id));
ALTER TABLE automation_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_schedule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_schedule
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX automation_schedule_one_active ON automation_schedule (tenant_id, automation_id, schedule_key) WHERE status = 'active';
COMMENT ON TABLE automation_schedule IS 'class=tenant_aggregate; m38 recurring schedule (governed recurrence; composes m06 timer)';

-- automation_run — APPEND-ONLY execution EVIDENCE. status succeeded/failed/blocked/skipped. Idempotent: at most one
-- 'succeeded' per (automation, run_key). Carries NO downstream payload — only an OPAQUE downstream reference + reason code.
CREATE TABLE automation_run (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), automation_id uuid NOT NULL, schedule_id uuid,
  run_key text NOT NULL, attempt_no integer NOT NULL DEFAULT 1, status text NOT NULL, scheduled_at timestamptz,
  started_at timestamptz, completed_at timestamptz, reason_code text, downstream_ref text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT automation_run_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT automation_run_id_key UNIQUE (tenant_id, id),
  CONSTRAINT automation_run_status_ck CHECK (status IN ('succeeded','failed','blocked','skipped')),
  CONSTRAINT automation_run_attempt_ck CHECK (attempt_no >= 1),
  CONSTRAINT automation_run_automation_fkey FOREIGN KEY (tenant_id, automation_id) REFERENCES automation_definition (tenant_id, id));
ALTER TABLE automation_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_run
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX automation_run_one_succeeded ON automation_run (tenant_id, automation_id, run_key) WHERE status = 'succeeded';
CREATE INDEX automation_run_by_automation ON automation_run (tenant_id, automation_id);
COMMENT ON TABLE automation_run IS 'class=tenant_ledger_append_only; m38 automation execution evidence (idempotent; opaque downstream ref)';

-- automation_review — APPEND-ONLY maker-checker ledger for automation activation + extension publication. A decision needs a
-- decider and the decider can never be the requester (SoD). AI never approves (isHumanActor in-service).
CREATE TABLE automation_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, kind text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid, reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT automation_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT automation_review_target_ck CHECK (target_type IN ('automation','extension')),
  CONSTRAINT automation_review_kind_ck CHECK (kind IN ('requested','approved','rejected')),
  CONSTRAINT automation_review_decider_ck CHECK (kind = 'requested' OR decided_by IS NOT NULL),
  CONSTRAINT automation_review_sod_ck CHECK (decided_by IS NULL OR decided_by <> requested_by));
ALTER TABLE automation_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX automation_review_by_target ON automation_review (tenant_id, target_type, target_id);
COMMENT ON TABLE automation_review IS 'class=tenant_ledger_append_only; m38 maker-checker automation/extension decisions';

-- automation_history — APPEND-ONLY status/transition evidence (automation|schedule|run|extension|installation).
CREATE TABLE automation_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT automation_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT automation_history_target_ck CHECK (target_type IN ('automation','schedule','run','extension','installation')));
ALTER TABLE automation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX automation_history_by_target ON automation_history (tenant_id, target_type, target_id);
COMMENT ON TABLE automation_history IS 'class=tenant_ledger_append_only; m38 automation/schedule/run/extension history';

-- automation_idempotency — APPEND-ONLY idempotency ledger (no duplicate define/activate/run/publish/install).
CREATE TABLE automation_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, target_type text, target_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT automation_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT automation_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT automation_idempotency_key_uk UNIQUE (tenant_id, idempotency_key));
ALTER TABLE automation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE automation_idempotency IS 'class=tenant_ledger_append_only; m38 idempotency ledger (no duplicate automation mutation)';

-- extension_definition — a registered extension (trust tier + isolation level). Lifecycle draft -> review_pending ->
-- published (maker-checker) -> deprecated; published is IMMUTABLE. NO executable package/code column.
CREATE TABLE extension_definition (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', extension_key text NOT NULL, name text NOT NULL, publisher text,
  trust_tier text NOT NULL DEFAULT 'untrusted', isolation_level text NOT NULL DEFAULT 'sandboxed',
  state text NOT NULL DEFAULT 'draft', validation_passed boolean NOT NULL DEFAULT false, content_hash text NOT NULL, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT extension_definition_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT extension_definition_id_key UNIQUE (tenant_id, id),
  CONSTRAINT extension_definition_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT extension_definition_trust_ck CHECK (trust_tier IN ('untrusted','verified','certified')),
  CONSTRAINT extension_definition_isolation_ck CHECK (isolation_level IN ('none','sandboxed','isolated')),
  CONSTRAINT extension_definition_state_ck CHECK (state IN ('draft','review_pending','published','deprecated','rejected')),
  CONSTRAINT extension_definition_evidence_ck CHECK (state NOT IN ('review_pending','published') OR validation_passed = true),
  CONSTRAINT extension_definition_optlock_ck CHECK (version >= 1));
ALTER TABLE extension_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON extension_definition
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX extension_definition_one_published ON extension_definition (tenant_id, scope, extension_key) WHERE state = 'published';
CREATE UNIQUE INDEX extension_definition_idem ON extension_definition (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE extension_definition IS 'class=tenant_aggregate; m38 registered extension (trust tier + isolation; published-immutable)';

CREATE OR REPLACE FUNCTION extension_definition_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('rejected') THEN
    RAISE EXCEPTION 'extension_definition % is immutable in state %', OLD.id, OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.extension_key <> OLD.extension_key OR (OLD.state <> 'draft' AND NEW.content_hash <> OLD.content_hash) THEN
    RAISE EXCEPTION 'a published extension is immutable (key/hash)' USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state = 'published' AND NEW.state NOT IN ('published','deprecated') THEN
    RAISE EXCEPTION 'a published extension may only move to deprecated' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER extension_definition_immutable_trg BEFORE UPDATE ON extension_definition
  FOR EACH ROW EXECUTE FUNCTION extension_definition_immutable();

-- extension_point — APPEND-ONLY: the registered extension points an extension declares + the m02 permission each requires
-- (the facade rule). capability_ref is an OPAQUE registered capability. NO executable code.
CREATE TABLE extension_point (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), extension_id uuid NOT NULL,
  point_key text NOT NULL, capability_ref text NOT NULL, required_permission text NOT NULL, description text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT extension_point_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT extension_point_id_key UNIQUE (tenant_id, id),
  CONSTRAINT extension_point_perm_ck CHECK (required_permission <> '' AND array_length(string_to_array(required_permission,'.'),1) = 3),
  CONSTRAINT extension_point_ext_fkey FOREIGN KEY (tenant_id, extension_id) REFERENCES extension_definition (tenant_id, id));
ALTER TABLE extension_point ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_point FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON extension_point
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX extension_point_uniq ON extension_point (tenant_id, extension_id, point_key);
COMMENT ON TABLE extension_point IS 'class=tenant_ledger_append_only; m38 extension point (registered capability + required m02 permission)';

-- extension_installation — a tenant's enablement of a PUBLISHED extension. status enabled -> disabled. A controlled tenant action.
CREATE TABLE extension_installation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), extension_id uuid NOT NULL,
  install_key text NOT NULL, status text NOT NULL DEFAULT 'enabled', idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT extension_installation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT extension_installation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT extension_installation_status_ck CHECK (status IN ('enabled','disabled')),
  CONSTRAINT extension_installation_optlock_ck CHECK (version >= 1),
  CONSTRAINT extension_installation_ext_fkey FOREIGN KEY (tenant_id, extension_id) REFERENCES extension_definition (tenant_id, id));
ALTER TABLE extension_installation ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_installation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON extension_installation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX extension_installation_one_enabled ON extension_installation (tenant_id, extension_id, install_key) WHERE status = 'enabled';
COMMENT ON TABLE extension_installation IS 'class=tenant_aggregate; m38 tenant extension installation/enablement';
