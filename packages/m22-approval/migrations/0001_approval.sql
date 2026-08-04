-- ---------------------------------------------------------------------------------------------------
-- M22-approval — the FINANCE APPROVAL WORKFLOW (Stage 3): maker-checker + Segregation of Duties. It is the ONE
-- lifecycle choke point for controlled finance actions (e.g. posting an m21 journal): one aggregate (approval_request)
-- with EXPLICIT valid transitions, transition reason codes, service-layer authorization, optimistic concurrency
-- (version CAS), idempotency, append-only status/decision history, audit, events, workflow + notification hooks,
-- deterministic (clock-driven) escalation, controlled cancellation + resubmission, and terminal-state protection.
-- The absolute controls are DB-enforced: a request's final approver is NEVER its requester (maker != checker / SoD);
-- an APPROVING decision's actor is never the request's maker; a delegate cannot delegate to self; a request cannot be
-- 'approved' without meeting its approval quorum and naming a final approver; escalation is single-fire per level and
-- depth-bounded; idempotency keys are unique (no duplicate request/decision). It NEVER approves on behalf of a human,
-- NEVER posts to a ledger (m21/m23 do, gated on the approval reference this module releases), and NEVER stands up a
-- second workflow / timer / notification engine — it reuses m06 (workflow + SLA + timers + the ONE outbox) and m08
-- (notifications) through OPAQUE references (workflow_ref / timer_ref / notification_ref). It owns NO journals (m21),
-- chart of accounts/periods (m19) or integration/posting (m23) — subject_ref / document_ref are OPAQUE ids, no FK.
-- Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite
-- FKs, a `version` column on mutable aggregates. No DELETE grant (ADR-010); records transition by status. Policy
-- steps, all *_history, decisions, assignments, sod checks, participants, escalations, timers, notifications, workflow
-- links, the idempotency ledger, notes, evidence, outcomes and overrides are append-only (INSERT+SELECT, 0002). Money
-- is INTEGER MINOR UNITS (bigint, never float — ADR-007). m22 publishes approval.lifecycle through the ONE m06 outbox.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('approvals.policy.read', 'm22-approval', 'approval_policy', false),
  ('approvals.policy.manage', 'm22-approval', 'approval_policy', true),
  ('approvals.policy.publish', 'm22-approval', 'approval_policy', true),
  ('approvals.config.read', 'm22-approval', 'approval_config', false),
  ('approvals.config.manage', 'm22-approval', 'approval_config', true),
  ('approvals.config.publish', 'm22-approval', 'approval_config', true),
  ('approvals.reason_code.read', 'm22-approval', 'approval_reason_code', false),
  ('approvals.reason_code.manage', 'm22-approval', 'approval_reason_code', true),
  ('approvals.request.read', 'm22-approval', 'approval_request', false),
  ('approvals.request.create', 'm22-approval', 'approval_request', false),
  ('approvals.request.submit', 'm22-approval', 'approval_request', false),
  ('approvals.request.cancel', 'm22-approval', 'approval_request', false),
  ('approvals.decision.approve', 'm22-approval', 'approval_decision', true),
  ('approvals.decision.reject', 'm22-approval', 'approval_decision', true),
  ('approvals.decision.return', 'm22-approval', 'approval_decision', false),
  ('approvals.decision.abstain', 'm22-approval', 'approval_decision', false),
  ('approvals.decision.escalate', 'm22-approval', 'approval_decision', true),
  ('approvals.decision.override', 'm22-approval', 'approval_override', true),
  ('approvals.delegation.read', 'm22-approval', 'approval_delegation', false),
  ('approvals.delegation.manage', 'm22-approval', 'approval_delegation', true),
  ('approvals.assignment.read', 'm22-approval', 'approval_assignment', false),
  ('approvals.escalation.manage', 'm22-approval', 'approval_escalation', true),
  ('approvals.note.add', 'm22-approval', 'approval_note', false),
  ('approvals.analytics.read', 'm22-approval', 'approval_analytics', false),
  ('approvals.platform.administer', 'm22-approval', 'approval_workflow', true);

-- approval_policy — a versioned approval policy (one active per subject_type+scope). Immutable-after-publish; change =
-- a new version. Carries the maker-checker quorum (required_approvals), the SoD mode and whether escalation is enabled.
CREATE TABLE approval_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_type text NOT NULL DEFAULT 'journal_posting', scope text NOT NULL DEFAULT 'default',
  version_number integer NOT NULL DEFAULT 1, name text, status text NOT NULL DEFAULT 'draft',
  required_approvals integer NOT NULL DEFAULT 1, min_levels integer NOT NULL DEFAULT 1,
  sod_mode text NOT NULL DEFAULT 'strict', escalation_enabled boolean NOT NULL DEFAULT true,
  threshold_minor bigint NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT approval_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_policy_ver_key UNIQUE (tenant_id, subject_type, scope, version_number),
  CONSTRAINT approval_policy_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT approval_policy_sod_ck CHECK (sod_mode IN ('strict','relaxed')),
  CONSTRAINT approval_policy_quorum_ck CHECK (required_approvals >= 1),
  CONSTRAINT approval_policy_levels_ck CHECK (min_levels >= 1),
  CONSTRAINT approval_policy_threshold_ck CHECK (threshold_minor >= 0),
  CONSTRAINT approval_policy_optlock_ck CHECK (version >= 1));
ALTER TABLE approval_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX approval_policy_one_active ON approval_policy (tenant_id, subject_type, scope) WHERE status = 'active';
COMMENT ON TABLE approval_policy IS 'class=tenant_aggregate; m22 approval policy (versioned, immutable-after-publish)';

-- approval_policy_step — append-only ordered steps of a policy version (part of the immutable spec). Each step names
-- the level, the required permission to act, the SoD constraint applied and the escalation timeout/target/mode.
CREATE TABLE approval_policy_step (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), policy_id uuid NOT NULL,
  level integer NOT NULL, required_permission text, sod_constraint text NOT NULL DEFAULT 'maker_checker',
  escalation_after_seconds integer, escalation_target uuid, escalation_mode text NOT NULL DEFAULT 'notify_only',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT approval_policy_step_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_policy_step_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_policy_step_level_key UNIQUE (tenant_id, policy_id, level),
  CONSTRAINT approval_policy_step_level_ck CHECK (level >= 1),
  CONSTRAINT approval_policy_step_mode_ck CHECK (escalation_mode IN ('notify_only','reassign')),
  CONSTRAINT approval_policy_step_sod_ck CHECK (sod_constraint IN ('maker_checker','preparer_checker','delegate_maker','single_approver')),
  CONSTRAINT approval_policy_step_esc_ck CHECK (escalation_after_seconds IS NULL OR escalation_after_seconds > 0),
  CONSTRAINT approval_policy_step_policy_fkey FOREIGN KEY (tenant_id, policy_id) REFERENCES approval_policy (tenant_id, id));
ALTER TABLE approval_policy_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policy_step FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_policy_step
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_policy_step_by_policy ON approval_policy_step (tenant_id, policy_id, level);
COMMENT ON TABLE approval_policy_step IS 'class=tenant_ledger_append_only; m22 policy step (immutable spec)';

-- approval_policy_history — append-only policy lifecycle evidence.
CREATE TABLE approval_policy_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), policy_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_policy_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_policy_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_policy_history_policy_fkey FOREIGN KEY (tenant_id, policy_id) REFERENCES approval_policy (tenant_id, id));
ALTER TABLE approval_policy_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policy_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_policy_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_policy_history_by_policy ON approval_policy_history (tenant_id, policy_id);
COMMENT ON TABLE approval_policy_history IS 'class=tenant_ledger_append_only; m22 policy history';

-- approval_config — versioned approval-engine config, immutable-after-publish (one active per scope), idempotency-keyed.
CREATE TABLE approval_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft', enforce_sod boolean NOT NULL DEFAULT true,
  max_escalation_depth integer NOT NULL DEFAULT 10, content_hash text, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT approval_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_config_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT approval_config_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT approval_config_depth_ck CHECK (max_escalation_depth BETWEEN 1 AND 20),
  -- enforce_sod can never be turned off — Segregation of Duties always applies to controlled actions (CLAUDE.md).
  CONSTRAINT approval_config_sod_ck CHECK (enforce_sod = true),
  CONSTRAINT approval_config_optlock_ck CHECK (version >= 1));
ALTER TABLE approval_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX approval_config_one_active ON approval_config (tenant_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX approval_config_idem ON approval_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE approval_config IS 'class=tenant_aggregate; m22 approval-engine config (versioned, immutable-after-publish)';

-- approval_reason_code — configurable registry of deterministic transition/decision reason codes (explainable).
CREATE TABLE approval_reason_code (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, category text NOT NULL DEFAULT 'lifecycle', severity text NOT NULL DEFAULT 'error',
  description text, active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT approval_reason_code_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_reason_code_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_reason_code_code_key UNIQUE (tenant_id, code),
  CONSTRAINT approval_reason_code_cat_ck CHECK (category IN ('sod','authorization','lifecycle','concurrency','escalation','quorum')),
  CONSTRAINT approval_reason_code_sev_ck CHECK (severity IN ('error','warning','info')),
  CONSTRAINT approval_reason_code_optlock_ck CHECK (version >= 1));
ALTER TABLE approval_reason_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_reason_code FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_reason_code
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE approval_reason_code IS 'class=tenant_reference; m22 transition/decision reason-code registry';

-- approval_request — THE aggregate + lifecycle choke point. Approves a controlled action identified by (subject_type,
-- subject_ref) — an OPAQUE id in the owning module (e.g. an m21 posting-request id; no FK). THE SoD INVARIANTS are
-- DB-enforced: the final approver is NEVER the requester (maker != checker); a request can only be 'approved' once its
-- approval quorum is met AND a final approver is named. Money threshold is bigint minor units — never float (ADR-007).
CREATE TABLE approval_request (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_type text NOT NULL DEFAULT 'journal_posting', subject_ref uuid, policy_id uuid, scope text NOT NULL DEFAULT 'default',
  title text, amount_minor bigint NOT NULL DEFAULT 0, currency_ref uuid,
  requested_by uuid, prepared_by uuid, current_level integer NOT NULL DEFAULT 1,
  required_approvals integer NOT NULL DEFAULT 1, approvals_count integer NOT NULL DEFAULT 0,
  final_approver uuid, status text NOT NULL DEFAULT 'draft', escalation_depth integer NOT NULL DEFAULT 0,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT approval_request_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_request_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_request_status_ck CHECK (status IN ('draft','pending','escalated','returned','approved','rejected','cancelled')),
  CONSTRAINT approval_request_quorum_ck CHECK (required_approvals >= 1),
  CONSTRAINT approval_request_count_ck CHECK (approvals_count >= 0),
  CONSTRAINT approval_request_amount_ck CHECK (amount_minor >= 0),
  CONSTRAINT approval_request_depth_ck CHECK (escalation_depth >= 0 AND escalation_depth <= 20),
  -- MAKER != CHECKER (SoD): the final approver is never the requester (ADR-007, CLAUDE.md).
  CONSTRAINT approval_request_sod_ck CHECK (final_approver IS NULL OR requested_by IS NULL OR final_approver <> requested_by),
  -- NO APPROVAL WITHOUT QUORUM: a request can only be 'approved' once its quorum is met and a final approver is named.
  CONSTRAINT approval_request_approved_ck CHECK (status <> 'approved' OR (final_approver IS NOT NULL AND approvals_count >= required_approvals)),
  CONSTRAINT approval_request_optlock_ck CHECK (version >= 1),
  CONSTRAINT approval_request_policy_fkey FOREIGN KEY (tenant_id, policy_id) REFERENCES approval_policy (tenant_id, id));
ALTER TABLE approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_request
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX approval_request_idem ON approval_request (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX approval_request_by_status ON approval_request (tenant_id, status);
CREATE INDEX approval_request_by_subject ON approval_request (tenant_id, subject_type, subject_ref);
COMMENT ON TABLE approval_request IS 'class=tenant_aggregate; m22 approval request (the maker-checker + SoD choke point)';

-- approval_request_step — a per-request instantiated step (from the policy steps). Transitions by status; the actor
-- who decided a step is recorded for SoD evidence. Mutable sub-aggregate (version CAS).
CREATE TABLE approval_request_step (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  level integer NOT NULL, required_permission text, sod_constraint text NOT NULL DEFAULT 'maker_checker',
  status text NOT NULL DEFAULT 'pending', decided_by uuid, decided_reason_code text, escalation_target uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT approval_request_step_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_request_step_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_request_step_level_key UNIQUE (tenant_id, request_id, level),
  CONSTRAINT approval_request_step_status_ck CHECK (status IN ('pending','approved','rejected','skipped','escalated')),
  CONSTRAINT approval_request_step_level_ck CHECK (level >= 1),
  CONSTRAINT approval_request_step_optlock_ck CHECK (version >= 1),
  CONSTRAINT approval_request_step_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_request_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_request_step FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_request_step
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_request_step_by_req ON approval_request_step (tenant_id, request_id, level);
COMMENT ON TABLE approval_request_step IS 'class=tenant_aggregate; m22 per-request approval step';

-- approval_decision — THE append-only decision ledger (approve/reject/return/abstain/escalate/cancel/override_*). The
-- SoD invariant is DB-enforced here too: for an APPROVING decision the actor is never the request's maker (denormalised
-- `maker` copied at insert so a single-row CHECK can enforce it, mirroring m21's posting_request approver/requester).
CREATE TABLE approval_decision (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL, step_id uuid,
  level integer NOT NULL DEFAULT 1, decision text NOT NULL, actor uuid NOT NULL, maker uuid, on_behalf_of uuid,
  reason_code text, reason text, is_final boolean NOT NULL DEFAULT false,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_decision_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_decision_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_decision_kind_ck CHECK (decision IN ('approve','reject','return','abstain','escalate','cancel','override_request','override_approve','override_reject')),
  -- MAKER != CHECKER (SoD): an approving actor is never the request's maker (fail closed).
  CONSTRAINT approval_decision_sod_ck CHECK (decision NOT IN ('approve','override_approve') OR maker IS NULL OR actor <> maker),
  CONSTRAINT approval_decision_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id),
  CONSTRAINT approval_decision_step_fkey FOREIGN KEY (tenant_id, step_id) REFERENCES approval_request_step (tenant_id, id));
ALTER TABLE approval_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_decision
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_decision_by_req ON approval_decision (tenant_id, request_id);
COMMENT ON TABLE approval_decision IS 'class=tenant_ledger_append_only; m22 decision ledger (maker != checker CHECK)';

-- approval_status_history — append-only request lifecycle evidence.
CREATE TABLE approval_status_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_status_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_status_history_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_status_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_status_history_by_req ON approval_status_history (tenant_id, request_id);
COMMENT ON TABLE approval_status_history IS 'class=tenant_ledger_append_only; m22 request status history';

-- approval_step_history — append-only per-step lifecycle evidence.
CREATE TABLE approval_step_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), step_id uuid NOT NULL, request_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_step_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_step_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_step_history_step_fkey FOREIGN KEY (tenant_id, step_id) REFERENCES approval_request_step (tenant_id, id),
  CONSTRAINT approval_step_history_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_step_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_step_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_step_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_step_history_by_step ON approval_step_history (tenant_id, step_id);
COMMENT ON TABLE approval_step_history IS 'class=tenant_ledger_append_only; m22 step status history';

-- approval_assignment — append-only assignment/candidate evidence (who was assigned or is a candidate for a step, and
-- whether via a delegation). Records the eligibility trail SoD is evaluated against.
CREATE TABLE approval_assignment (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL, step_id uuid,
  level integer NOT NULL DEFAULT 1, assignee_ref uuid NOT NULL, assignment_type text NOT NULL DEFAULT 'candidate',
  source_delegation_id uuid, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_assignment_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_assignment_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_assignment_type_ck CHECK (assignment_type IN ('candidate','assigned','delegated')),
  CONSTRAINT approval_assignment_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_assignment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_assignment_by_req ON approval_assignment (tenant_id, request_id, level);
COMMENT ON TABLE approval_assignment IS 'class=tenant_ledger_append_only; m22 assignment/candidate evidence';

-- approval_delegation — a delegation grant: delegator hands checker authority to a delegate for a subject_type+scope
-- within a window. A delegate can NEVER be the delegator (DB CHECK), and a delegated approver still cannot launder SoD
-- (enforced in the decision path). Mutable aggregate (status active/revoked/expired; version CAS).
CREATE TABLE approval_delegation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  delegator uuid NOT NULL, delegate uuid NOT NULL, subject_type text NOT NULL DEFAULT 'journal_posting',
  scope text NOT NULL DEFAULT 'default', status text NOT NULL DEFAULT 'active',
  starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, reason text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT approval_delegation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_delegation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_delegation_status_ck CHECK (status IN ('active','revoked','expired')),
  -- A delegate can never be the delegator (a self-delegation would launder nothing but confuse the SoD trail).
  CONSTRAINT approval_delegation_self_ck CHECK (delegate <> delegator),
  CONSTRAINT approval_delegation_window_ck CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT approval_delegation_optlock_ck CHECK (version >= 1));
ALTER TABLE approval_delegation ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_delegation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_delegation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_delegation_by_delegate ON approval_delegation (tenant_id, delegate, status);
COMMENT ON TABLE approval_delegation IS 'class=tenant_aggregate; m22 delegation grant (delegate != delegator CHECK)';

-- approval_delegation_history — append-only delegation lifecycle evidence.
CREATE TABLE approval_delegation_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), delegation_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_delegation_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_delegation_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_delegation_history_del_fkey FOREIGN KEY (tenant_id, delegation_id) REFERENCES approval_delegation (tenant_id, id));
ALTER TABLE approval_delegation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_delegation_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_delegation_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_delegation_history_by_del ON approval_delegation_history (tenant_id, delegation_id);
COMMENT ON TABLE approval_delegation_history IS 'class=tenant_ledger_append_only; m22 delegation history';

-- approval_sod_check — append-only Segregation-of-Duties evaluation evidence. Every checked relationship (maker vs
-- checker, preparer vs checker, delegate vs maker, single approver) records its verdict + reason code — a BLOCKED
-- controlled action never disappears silently (fail closed, CLAUDE.md).
CREATE TABLE approval_sod_check (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL, decision_id uuid,
  actor uuid NOT NULL, maker uuid, rule text NOT NULL, verdict text NOT NULL, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_sod_check_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_sod_check_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_sod_check_rule_ck CHECK (rule IN ('maker_checker','preparer_checker','delegate_maker','single_approver')),
  CONSTRAINT approval_sod_check_verdict_ck CHECK (verdict IN ('allowed','blocked')),
  CONSTRAINT approval_sod_check_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_sod_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_sod_check FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_sod_check
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_sod_check_by_req ON approval_sod_check (tenant_id, request_id);
COMMENT ON TABLE approval_sod_check IS 'class=tenant_ledger_append_only; m22 SoD evaluation evidence';

-- approval_participant — append-only distinct participant ledger. Records each actor's role on a request (maker /
-- preparer / checker / approver / delegate / escalation_target). UNIQUE per (request, actor, role): the immutable basis
-- for cross-role SoD checks (e.g. a preparer cannot later be the required checker).
CREATE TABLE approval_participant (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  actor uuid NOT NULL, role text NOT NULL, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_participant_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_participant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_participant_uk UNIQUE (tenant_id, request_id, actor, role),
  CONSTRAINT approval_participant_role_ck CHECK (role IN ('maker','preparer','checker','approver','delegate','escalation_target')),
  CONSTRAINT approval_participant_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_participant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_participant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_participant_by_req ON approval_participant (tenant_id, request_id);
COMMENT ON TABLE approval_participant IS 'class=tenant_ledger_append_only; m22 distinct participant ledger';

-- approval_escalation — append-only escalation-event ledger. Single-fire per (request, step, to_level) and
-- depth-bounded (no runaway escalation). Reuses m06 SLA/timers via an opaque timer_ref; notify-only vs reassignment
-- is recorded. m22 builds NO second timer engine.
CREATE TABLE approval_escalation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL, step_id uuid,
  from_level integer NOT NULL DEFAULT 1, to_level integer NOT NULL, target_ref uuid, mode text NOT NULL DEFAULT 'notify_only',
  depth integer NOT NULL DEFAULT 1, timer_ref uuid, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_escalation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_escalation_id_key UNIQUE (tenant_id, id),
  -- SINGLE-FIRE: an escalation to a given level for a step fires at most once (no duplicate escalation). NULLS NOT
  -- DISTINCT so a request-level escalation (step_id IS NULL) still collides — a standard UNIQUE lets NULLs through.
  CONSTRAINT approval_escalation_once_key UNIQUE NULLS NOT DISTINCT (tenant_id, request_id, step_id, to_level),
  CONSTRAINT approval_escalation_mode_ck CHECK (mode IN ('notify_only','reassign')),
  -- BOUNDED DEPTH: escalation depth can never exceed the platform maximum.
  CONSTRAINT approval_escalation_depth_ck CHECK (depth >= 1 AND depth <= 20),
  CONSTRAINT approval_escalation_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_escalation ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_escalation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_escalation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_escalation_by_req ON approval_escalation (tenant_id, request_id);
COMMENT ON TABLE approval_escalation IS 'class=tenant_ledger_append_only; m22 escalation ledger (single-fire, depth-bounded)';

-- approval_timer — append-only evidence of an m06 SLA timer registered for a step deadline (opaque timer_ref). m22
-- builds NO timer engine — it records the reference and whether the timer has fired. Deterministic (clock-driven).
CREATE TABLE approval_timer (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL, step_id uuid,
  timer_ref uuid, purpose text NOT NULL DEFAULT 'escalation', deadline_at timestamptz, fired boolean NOT NULL DEFAULT false,
  by_user uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_timer_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_timer_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_timer_purpose_ck CHECK (purpose IN ('escalation','sla','reminder')),
  CONSTRAINT approval_timer_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_timer ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_timer FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_timer
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_timer_by_req ON approval_timer (tenant_id, request_id);
COMMENT ON TABLE approval_timer IS 'class=tenant_ledger_append_only; m22 m06 SLA-timer link evidence';

-- approval_notification — append-only evidence of an m08 notification dispatched via the notify hook (opaque
-- notification_ref). m22 builds NO notification engine — it records the reference, channel and recipient.
CREATE TABLE approval_notification (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  notification_ref uuid, channel text NOT NULL DEFAULT 'inapp', template_key text, recipient_ref uuid, event_type text,
  by_user uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_notification_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_notification_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_notification_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_notification FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_notification
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_notification_by_req ON approval_notification (tenant_id, request_id);
COMMENT ON TABLE approval_notification IS 'class=tenant_ledger_append_only; m22 m08 notification-dispatch evidence';

-- approval_workflow_link — append-only evidence linking a request to an m06 workflow instance (opaque workflow_ref).
-- The workflow hook: m22 drives the request lifecycle and records the m06 instance it is bound to; it owns no workflow
-- engine.
CREATE TABLE approval_workflow_link (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  workflow_ref uuid, workflow_family text, note text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_workflow_link_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_workflow_link_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_workflow_link_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_workflow_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_workflow_link FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_workflow_link
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_workflow_link_by_req ON approval_workflow_link (tenant_id, request_id);
COMMENT ON TABLE approval_workflow_link IS 'class=tenant_ledger_append_only; m22 m06 workflow-instance link';

-- approval_idempotency — append-only idempotency/command ledger. THE "no duplicate request/decision" guarantee: an
-- idempotency key is unique per tenant, so a retried create/decision command is a safe no-op, never a double action.
CREATE TABLE approval_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, purpose text NOT NULL DEFAULT 'request', request_id uuid, decision_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT approval_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_idempotency_key_uk UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT approval_idempotency_purpose_ck CHECK (purpose IN ('request','decision')),
  CONSTRAINT approval_idempotency_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE approval_idempotency IS 'class=tenant_ledger_append_only; m22 idempotency ledger (no duplicate action)';

-- approval_note — append-only note / evidence annotation on a request.
CREATE TABLE approval_note (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general', content text NOT NULL, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_note_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_note_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_note_type_ck CHECK (note_type IN ('general','review','decision','escalation','override')),
  CONSTRAINT approval_note_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_note FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_note_by_req ON approval_note (tenant_id, request_id);
COMMENT ON TABLE approval_note IS 'class=tenant_ledger_append_only; m22 note';

-- approval_evidence — append-only evidence attachments referencing an m09 document (opaque document_ref, no FK).
CREATE TABLE approval_evidence (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  evidence_type text NOT NULL DEFAULT 'attachment', document_ref uuid, description text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_evidence_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_evidence_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_evidence_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_evidence_by_req ON approval_evidence (tenant_id, request_id);
COMMENT ON TABLE approval_evidence IS 'class=tenant_ledger_append_only; m22 evidence (m09 document refs)';

-- approval_outcome — append-only TERMINAL outcome evidence + the RELEASED approval reference. When a request reaches a
-- terminal state this records the outcome, the final approver and (for approvals) the approval reference downstream
-- modules (m21/m23) gate posting on. The `released` flag marks that the controlled action has been authorised to run.
CREATE TABLE approval_outcome (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  outcome text NOT NULL, subject_type text NOT NULL DEFAULT 'journal_posting', subject_ref uuid,
  final_approver uuid, released boolean NOT NULL DEFAULT false, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_outcome_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_outcome_id_key UNIQUE (tenant_id, id),
  -- one terminal outcome per request (the release is recorded exactly once).
  CONSTRAINT approval_outcome_req_uk UNIQUE (tenant_id, request_id),
  CONSTRAINT approval_outcome_kind_ck CHECK (outcome IN ('approved','rejected','cancelled','returned')),
  -- a RELEASED outcome must be an approval that names its final approver (nothing is released without an approver).
  CONSTRAINT approval_outcome_release_ck CHECK (released = false OR (outcome = 'approved' AND final_approver IS NOT NULL)),
  CONSTRAINT approval_outcome_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_outcome FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_outcome
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_outcome_by_req ON approval_outcome (tenant_id, request_id);
COMMENT ON TABLE approval_outcome IS 'class=tenant_ledger_append_only; m22 terminal outcome + released approval reference';

-- approval_override — append-only override-action ledger (override_request / override_approve / override_reject). An
-- override is a privileged, justified act; SoD STILL applies (the actor is never the maker, DB CHECK) — an override
-- cannot launder maker-checker.
CREATE TABLE approval_override (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL, decision_id uuid,
  override_type text NOT NULL, actor uuid NOT NULL, maker uuid, justification text NOT NULL, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_override_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT approval_override_id_key UNIQUE (tenant_id, id),
  CONSTRAINT approval_override_type_ck CHECK (override_type IN ('override_request','override_approve','override_reject')),
  -- SoD applies to overrides too: an overriding actor is never the request's maker (fail closed).
  CONSTRAINT approval_override_sod_ck CHECK (maker IS NULL OR actor <> maker),
  CONSTRAINT approval_override_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES approval_request (tenant_id, id));
ALTER TABLE approval_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_override FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_override
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX approval_override_by_req ON approval_override (tenant_id, request_id);
COMMENT ON TABLE approval_override IS 'class=tenant_ledger_append_only; m22 override ledger (SoD still applies)';
