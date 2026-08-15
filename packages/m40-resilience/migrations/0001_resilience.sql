-- ---------------------------------------------------------------------------------------------------
-- M40-resilience — MOBILE / OFFLINE / OBSERVABILITY / BACKUP / BUSINESS CONTINUITY (Stage 6G, mvp:false). Owns mobile-device
-- registrations, the governed OFFLINE queue + sync evidence, OPERATIONAL observability signals, backup POLICIES + evidence,
-- restore/failover requests + evidence, and DR/BC plans + drill evidence. THE LOAD-BEARING RULE (DB-ENFORCED): a controlled
-- offline request reaches sync_state 'applied' ONLY when validated_online is true (resilience_offline_request_finalize_ck) —
-- an offline/mobile client may DRAFT/QUEUE but can NEVER FINALIZE a controlled action offline; finalization requires ONLINE
-- re-validation through the AUTHORITATIVE owner (m02 RBAC + m21/m22 approval + maker-checker/SoD + m37/m39); m40 orchestrates
-- and never manufactures an approval/consent/release nor auto-finalizes on reconnect; a stale/ambiguous sync FAILS CLOSED.
-- OBSERVABILITY is OPERATIONAL only (bounded health/latency signals) — NOT a second m32 analytics engine nor the m03 audit
-- spine. BACKUP/RESTORE/FAILOVER EXECUTION is FRAMEWORK-ONLY (a fail-closed port; no shell/dump/restore-command injection);
-- restore/failover is maker-checker (resilience_restore_request approved_by <> requested_by, SoD; a terminal decision is
-- IMMUTABLE by trigger). Backup/DR SCHEDULES are OPAQUE references composing m06/m38 — NO second scheduler. RTO/RPO are integer
-- seconds (NO float). Secret-bearing config is an opaque m30 secretref: pointer only (shape CHECK); NO secret VALUE column;
-- m41 deferred. Uses the resilience_ prefix and owns mobile.lifecycle + backup.lifecycle + dr.lifecycle ONLY, through the ONE
-- m06 outbox. Every tenant table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs
-- (within m40), version on mutable aggregates. No DELETE grant (ADR-010). Evidence/signal/review/history + the idempotency
-- ledger are append-only (INSERT+SELECT, 0002). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- The resilience.* permission namespace (GAP-4 resolved, ADR-127). Three-segment resilience.<area>.<action>. Every controlled
-- operation authorizes one (default deny). resilience.control.administer is the cross-tenant CONTROL-PLANE permission a tenant
-- admin never holds by default (platform-scope backup/DR policies); resilience.restore.approve is the privileged controlled
-- action (recovery execution). NO resilience.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('resilience.device.read', 'm40-resilience', 'resilience_device', false),
  ('resilience.device.manage', 'm40-resilience', 'resilience_device', false),
  ('resilience.offline.read', 'm40-resilience', 'resilience_offline_request', false),
  ('resilience.offline.sync', 'm40-resilience', 'resilience_offline_request', false),
  ('resilience.observability.read', 'm40-resilience', 'resilience_health_signal', false),
  ('resilience.backup.read', 'm40-resilience', 'resilience_backup_policy', false),
  ('resilience.backup.manage', 'm40-resilience', 'resilience_backup_policy', false),
  ('resilience.restore.request', 'm40-resilience', 'resilience_restore_request', false),
  ('resilience.restore.approve', 'm40-resilience', 'resilience_restore_request', true),
  ('resilience.dr.read', 'm40-resilience', 'resilience_dr_plan', false),
  ('resilience.dr.manage', 'm40-resilience', 'resilience_dr_plan', false),
  ('resilience.control.administer', 'm40-resilience', 'resilience', true);

-- resilience_device — a registered mobile device (bounded metadata ONLY; no biometrics, tokens or credentials). Lifecycle
-- pending -> registered -> revoked. Mutable aggregate (version CAS).
CREATE TABLE resilience_device (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_key text NOT NULL, platform text NOT NULL DEFAULT 'unknown', app_version text,
  actor_ref uuid, trust_state text NOT NULL DEFAULT 'pending', last_sync_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT resilience_device_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_device_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_device_trust_ck CHECK (trust_state IN ('pending','registered','revoked')),
  CONSTRAINT resilience_device_key_ck CHECK (device_key <> ''));
ALTER TABLE resilience_device ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_device FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_device
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX resilience_device_key_uniq ON resilience_device (tenant_id, device_key);
COMMENT ON TABLE resilience_device IS 'class=tenant_aggregate; m40 mobile device (bounded metadata; no secret/token/biometric)';

-- resilience_offline_request — THE GOVERNED OFFLINE QUEUE. A client drafts/queues an intended operation referencing a
-- REGISTERED capability + the m02 permission it requires + an OPAQUE payload reference (NOT a raw business payload). controlled
-- = the operation is a controlled action (post/approve/release/consent/commercial/config/secret). THE LOAD-BEARING INVARIANT:
-- sync_state can only become 'applied' when validated_online is true (finalize_ck) — a controlled action can NEVER be finalized
-- offline; the authoritative downstream reference is recorded only after online re-validation by the owning module. Mutable.
CREATE TABLE resilience_offline_request (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), device_id uuid NOT NULL,
  request_key text NOT NULL, capability_ref text NOT NULL, required_permission text NOT NULL,
  controlled boolean NOT NULL DEFAULT false, payload_ref text, config_secret_ref text,
  sync_state text NOT NULL DEFAULT 'queued', validated_online boolean NOT NULL DEFAULT false,
  retry_count integer NOT NULL DEFAULT 0, expires_at timestamptz, downstream_ref text, reason_code text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT resilience_offline_request_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_offline_request_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_offline_request_state_ck CHECK (sync_state IN ('queued','validating','applied','rejected','expired')),
  CONSTRAINT resilience_offline_request_perm_ck CHECK (required_permission <> '' AND array_length(string_to_array(required_permission,'.'),1) = 3),
  CONSTRAINT resilience_offline_request_secret_ck CHECK (config_secret_ref IS NULL OR config_secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT resilience_offline_request_retry_ck CHECK (retry_count >= 0),
  -- THE OFFLINE FINALIZATION BLOCK: a request is 'applied' ONLY after online re-validation (never finalized offline).
  CONSTRAINT resilience_offline_request_finalize_ck CHECK (sync_state <> 'applied' OR validated_online),
  CONSTRAINT resilience_offline_request_device_fkey FOREIGN KEY (tenant_id, device_id) REFERENCES resilience_device (tenant_id, id));
ALTER TABLE resilience_offline_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_offline_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_offline_request
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX resilience_offline_request_key_uniq ON resilience_offline_request (tenant_id, request_key);
COMMENT ON TABLE resilience_offline_request IS 'class=tenant_aggregate; m40 offline queue (applied requires validated_online — no offline finalization of controlled actions)';

-- resilience_offline_evidence — APPEND-ONLY: a sync attempt's outcome (validated online, applied, rejected). Bounded.
CREATE TABLE resilience_offline_evidence (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  outcome text NOT NULL, validated_by uuid, downstream_ref text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resilience_offline_evidence_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_offline_evidence_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_offline_evidence_outcome_ck CHECK (outcome IN ('validated','applied','rejected','expired')),
  CONSTRAINT resilience_offline_evidence_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES resilience_offline_request (tenant_id, id));
ALTER TABLE resilience_offline_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_offline_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_offline_evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- resilience_check — an OPERATIONAL observability check definition (what component/signal to watch). Mutable (enabled/disabled).
CREATE TABLE resilience_check (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  check_key text NOT NULL, component text NOT NULL, signal_kind text NOT NULL DEFAULT 'health', enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT resilience_check_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_check_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_check_kind_ck CHECK (signal_kind IN ('health','latency','dependency','backup_freshness','sync_health')),
  CONSTRAINT resilience_check_key_ck CHECK (check_key <> '' AND component <> ''));
ALTER TABLE resilience_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_check FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_check
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX resilience_check_key_uniq ON resilience_check (tenant_id, check_key);

-- resilience_health_signal — APPEND-ONLY OPERATIONAL signal (bounded: component/state/latency/result — NO raw log/payload/PII).
CREATE TABLE resilience_health_signal (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), check_id uuid,
  component text NOT NULL, signal_kind text NOT NULL DEFAULT 'health', state text NOT NULL,
  latency_ms bigint, result_code text, evidence_ref text, occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resilience_health_signal_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_health_signal_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_health_signal_state_ck CHECK (state IN ('ok','degraded','down','unknown')),
  CONSTRAINT resilience_health_signal_latency_ck CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT resilience_health_signal_component_ck CHECK (component <> ''));
ALTER TABLE resilience_health_signal ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_health_signal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_health_signal
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX resilience_health_signal_comp ON resilience_health_signal (tenant_id, component, occurred_at);

-- resilience_backup_policy — a backup policy: an OPAQUE schedule reference (composes m06/m38 — m40 runs no scheduler), integer
-- RTO/RPO seconds + retention days (NO float), an opaque target reference + an opaque secretref for backup credentials. Mutable.
CREATE TABLE resilience_backup_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', policy_key text NOT NULL, target_ref text NOT NULL,
  schedule_ref text, rto_seconds integer, rpo_seconds integer, retention_days integer, config_secret_ref text,
  state text NOT NULL DEFAULT 'draft', version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT resilience_backup_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_backup_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_backup_policy_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT resilience_backup_policy_state_ck CHECK (state IN ('draft','active','retired')),
  CONSTRAINT resilience_backup_policy_key_ck CHECK (policy_key <> '' AND target_ref <> ''),
  CONSTRAINT resilience_backup_policy_rto_ck CHECK (rto_seconds IS NULL OR rto_seconds >= 0),
  CONSTRAINT resilience_backup_policy_rpo_ck CHECK (rpo_seconds IS NULL OR rpo_seconds >= 0),
  CONSTRAINT resilience_backup_policy_ret_ck CHECK (retention_days IS NULL OR retention_days >= 0),
  CONSTRAINT resilience_backup_policy_secret_ck CHECK (config_secret_ref IS NULL OR config_secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'));
ALTER TABLE resilience_backup_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_backup_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_backup_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX resilience_backup_policy_key_uniq ON resilience_backup_policy (tenant_id, policy_key);
COMMENT ON TABLE resilience_backup_policy IS 'class=tenant_aggregate; m40 backup policy (opaque schedule ref composes m06/m38; framework-only execution; integer RTO/RPO)';

-- resilience_backup_run — APPEND-ONLY backup evidence (bounded metadata: run/schedule/target refs, result, size, checksum ref;
-- NO raw backup data, NO secret). result 'blocked' = the fail-closed executor is unavailable (framework-only).
CREATE TABLE resilience_backup_run (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), policy_id uuid NOT NULL,
  run_key text NOT NULL, schedule_ref text, started_at timestamptz, completed_at timestamptz,
  result text NOT NULL, size_bytes bigint, checksum_ref text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT resilience_backup_run_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_backup_run_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_backup_run_result_ck CHECK (result IN ('succeeded','failed','blocked')),
  CONSTRAINT resilience_backup_run_size_ck CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT resilience_backup_run_key_ck CHECK (run_key <> ''),
  CONSTRAINT resilience_backup_run_policy_fkey FOREIGN KEY (tenant_id, policy_id) REFERENCES resilience_backup_policy (tenant_id, id));
ALTER TABLE resilience_backup_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_backup_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_backup_run
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX resilience_backup_run_key_uniq ON resilience_backup_run (tenant_id, policy_id, run_key);

-- resilience_restore_request — a RESTORE/FAILOVER request. MAKER-CHECKER: approved_by <> requested_by (SoD) + a human approver
-- (in-service); privileged (resilience.restore.approve). EXECUTION is framework-only (a fail-closed port; 'executed' only after
-- the executor ran; 'blocked' when unavailable). A terminal (executed/rejected) decision is IMMUTABLE (trigger). Mutable.
CREATE TABLE resilience_restore_request (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_key text NOT NULL, kind text NOT NULL DEFAULT 'restore', target_ref text NOT NULL, backup_ref text,
  state text NOT NULL DEFAULT 'draft', requested_by uuid, approved_by uuid, reason_code text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT resilience_restore_request_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_restore_request_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_restore_request_kind_ck CHECK (kind IN ('restore','failover')),
  CONSTRAINT resilience_restore_request_state_ck CHECK (state IN ('draft','review_pending','approved','executed','rejected','blocked')),
  CONSTRAINT resilience_restore_request_key_ck CHECK (request_key <> '' AND target_ref <> ''),
  CONSTRAINT resilience_restore_request_sod_ck CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT resilience_restore_request_approve_ck CHECK (state NOT IN ('approved','executed') OR approved_by IS NOT NULL));
ALTER TABLE resilience_restore_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_restore_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_restore_request
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX resilience_restore_request_key_uniq ON resilience_restore_request (tenant_id, request_key);

-- A terminal restore/failover decision is IMMUTABLE (executed/rejected frozen; approval fields never rewritten).
CREATE OR REPLACE FUNCTION resilience_restore_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('executed','rejected') THEN
    RAISE EXCEPTION 'a % restore/failover request is terminal and immutable', OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.approved_by IS NOT NULL AND NEW.approved_by <> OLD.approved_by THEN
    RAISE EXCEPTION 'the approver of a restore/failover request is immutable once set' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER resilience_restore_immutable_trg BEFORE UPDATE ON resilience_restore_request
  FOR EACH ROW EXECUTE FUNCTION resilience_restore_immutable();

-- resilience_dr_plan — a DR/BC plan (integer RTO/RPO seconds; NO float). Lifecycle draft -> active -> retired; one active plan
-- per (tenant, scope). Mutable aggregate.
CREATE TABLE resilience_dr_plan (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', plan_key text NOT NULL, rto_seconds integer, rpo_seconds integer,
  state text NOT NULL DEFAULT 'draft', version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT resilience_dr_plan_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_dr_plan_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_dr_plan_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT resilience_dr_plan_state_ck CHECK (state IN ('draft','active','retired')),
  CONSTRAINT resilience_dr_plan_key_ck CHECK (plan_key <> ''),
  CONSTRAINT resilience_dr_plan_rto_ck CHECK (rto_seconds IS NULL OR rto_seconds >= 0),
  CONSTRAINT resilience_dr_plan_rpo_ck CHECK (rpo_seconds IS NULL OR rpo_seconds >= 0));
ALTER TABLE resilience_dr_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_dr_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_dr_plan
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX resilience_dr_plan_key_uniq ON resilience_dr_plan (tenant_id, plan_key);
CREATE UNIQUE INDEX resilience_dr_plan_one_active ON resilience_dr_plan (tenant_id, scope) WHERE state = 'active';

-- resilience_dr_test — APPEND-ONLY DR drill evidence (integer measured recovery seconds; SoD requested_by <> approved_by).
CREATE TABLE resilience_dr_test (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), plan_id uuid NOT NULL,
  test_key text NOT NULL, scenario text, requested_by uuid, approved_by uuid, started_at timestamptz, completed_at timestamptz,
  measured_recovery_seconds integer, outcome text NOT NULL, reason_code text, evidence_ref text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resilience_dr_test_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_dr_test_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_dr_test_outcome_ck CHECK (outcome IN ('passed','failed','inconclusive')),
  CONSTRAINT resilience_dr_test_key_ck CHECK (test_key <> ''),
  CONSTRAINT resilience_dr_test_rec_ck CHECK (measured_recovery_seconds IS NULL OR measured_recovery_seconds >= 0),
  CONSTRAINT resilience_dr_test_sod_ck CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT resilience_dr_test_plan_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES resilience_dr_plan (tenant_id, id));
ALTER TABLE resilience_dr_test ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_dr_test FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_dr_test
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- resilience_review — APPEND-ONLY maker-checker record for a controlled resilience action (restore/failover/dr-test).
-- decided_by <> requested_by (SoD); AI/system/automation never approve (in-service isHumanActor).
CREATE TABLE resilience_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_kind text NOT NULL, target_id uuid NOT NULL, decision text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid NOT NULL, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resilience_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_review_target_ck CHECK (target_kind IN ('restore','dr_test')),
  CONSTRAINT resilience_review_decision_ck CHECK (decision IN ('approved','rejected')),
  CONSTRAINT resilience_review_sod_ck CHECK (decided_by <> requested_by));
ALTER TABLE resilience_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- resilience_history — APPEND-ONLY lifecycle evidence for a device/offline/backup/restore/dr transition.
CREATE TABLE resilience_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL, subject_id uuid NOT NULL, from_state text, to_state text NOT NULL, reason_code text,
  actor uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resilience_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_history_subject_ck CHECK (subject_kind IN ('device','offline_request','backup_policy','restore_request','dr_plan')),
  CONSTRAINT resilience_history_to_ck CHECK (to_state <> ''));
ALTER TABLE resilience_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX resilience_history_subject ON resilience_history (tenant_id, subject_kind, subject_id, created_at);

-- resilience_idempotency — APPEND-ONLY: a resilience command's idempotency key (safe retry). UNIQUE per tenant.
CREATE TABLE resilience_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, operation text NOT NULL, result_ref uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT resilience_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT resilience_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT resilience_idempotency_key_ck CHECK (idempotency_key <> ''));
ALTER TABLE resilience_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resilience_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX resilience_idempotency_key_uniq ON resilience_idempotency (tenant_id, idempotency_key);
