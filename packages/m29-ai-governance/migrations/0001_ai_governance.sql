-- ---------------------------------------------------------------------------------------------------
-- M29-ai-governance — AI GOVERNANCE & RELEASE (Stage 5, mvp:false): the enterprise oversight layer for the AI lifecycle.
-- It governs AI USE CASES + POLICIES and the human-approved RELEASE of M24 assets (model/prompt/provider/policy/use-case
-- versions) with release gates, evaluation EVIDENCE, controlled exceptions/WAIVERS, and suspension/withdrawal decisions.
-- THE LOAD-BEARING RULE IS DB-ENFORCED: AI NEVER APPROVES ITS OWN RELEASE — a release/waiver can only be approved by a
-- HUMAN who is not the proposer (ai_governance_release_human_ck: approved_by NOT NULL for approved/released;
-- ai_governance_release_sod_ck: approved_by <> proposed_by), a non-waiver release cannot be approved without a passing
-- evaluation (ai_governance_release_evidence_ck), and a policy can never disable human approval or evaluation
-- (ai_governance_policy_human_ck / _eval_ck) and can never blanket-allow a restricted provider
-- (ai_governance_policy_restricted_ck). A governed use case can never permit an AI-executed controlled action
-- (ai_governance_use_case_noaction_ck). M29 references M24 assets by OPAQUE uuid ONLY (no cross-module FK; reads no
-- m24/business table; calls no provider; stores no credential/secret; holds no prompt/output content). It EMITS the
-- ai.governance_lifecycle event (family declared+owned by M24) into the ONE m06 outbox as an authorized emitter — NO
-- second family, NO second outbox. Confidence/accuracy are INTEGER basis points (0..10000); no float; no secret column.
-- Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs
-- (within m29 only), version on mutable aggregates. No DELETE grant (ADR-010). Evaluations, decisions, histories and the
-- idempotency ledger are append-only (INSERT+SELECT, 0002). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- M29 permissions: SHARED ai.* namespace. ai.governance.read + ai.governance.manage are already registered/seeded by
-- m24; m29 adds 3 NEW privileged codes for the human checker (approve), the exception authority (override) and evidence
-- export. There is NO ai.admin bypass; every service authorizes independently (default deny). The maker (manage) and the
-- checker (approve) are distinct permissions AND a row-level SoD CHECK enforces proposer != approver regardless.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('ai.governance.approve', 'm29-ai-governance', 'ai_governance_release', true),
  ('ai.governance.override', 'm29-ai-governance', 'ai_governance_waiver', true),
  ('ai.governance.export', 'm29-ai-governance', 'ai_governance_evaluation', true);

-- ai_governance_policy — versioned governance policy, one active per scope. Human approval + evaluation can never be
-- turned off; a restricted provider can never be blanket-allowed (fail closed — governance is human-decided).
CREATE TABLE ai_governance_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft',
  require_human_approval boolean NOT NULL DEFAULT true, require_evaluation boolean NOT NULL DEFAULT true,
  allow_restricted_provider boolean NOT NULL DEFAULT false, min_confidence_bps integer NOT NULL DEFAULT 0,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_governance_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_governance_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_governance_policy_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT ai_governance_policy_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT ai_governance_policy_human_ck CHECK (require_human_approval = true),
  CONSTRAINT ai_governance_policy_eval_ck CHECK (require_evaluation = true),
  CONSTRAINT ai_governance_policy_restricted_ck CHECK (allow_restricted_provider = false),
  CONSTRAINT ai_governance_policy_conf_ck CHECK (min_confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT ai_governance_policy_optlock_ck CHECK (version >= 1));
ALTER TABLE ai_governance_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_governance_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_governance_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX ai_governance_policy_one_active ON ai_governance_policy (tenant_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX ai_governance_policy_idem ON ai_governance_policy (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE ai_governance_policy IS 'class=tenant_aggregate; m29 governance policy (human approval + evaluation always on; no restricted-provider blanket allow)';

-- ai_governance_use_case — a governed AI use case: which module/domain uses AI for what, at what risk/classification,
-- with which OPAQUE m24 provider/model/prompt refs, and whether human review + citations are required. A governed use
-- case can NEVER permit an AI-executed controlled action.
CREATE TABLE ai_governance_use_case (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  module_ref text NOT NULL, purpose text, classification text NOT NULL DEFAULT 'internal', risk_tier text NOT NULL DEFAULT 'medium',
  provider_ref uuid, model_ref uuid, prompt_ref uuid,
  human_review_required boolean NOT NULL DEFAULT true, citation_required boolean NOT NULL DEFAULT false,
  controlled_action_prohibited boolean NOT NULL DEFAULT true, deployment_status text NOT NULL DEFAULT 'proposed',
  owner uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_governance_use_case_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_governance_use_case_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_governance_use_case_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT ai_governance_use_case_risk_ck CHECK (risk_tier IN ('low','medium','high','critical')),
  CONSTRAINT ai_governance_use_case_deploy_ck CHECK (deployment_status IN ('proposed','approved','deployed','suspended','retired')),
  CONSTRAINT ai_governance_use_case_noaction_ck CHECK (controlled_action_prohibited = true),
  CONSTRAINT ai_governance_use_case_optlock_ck CHECK (version >= 1));
ALTER TABLE ai_governance_use_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_governance_use_case FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_governance_use_case
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_governance_use_case_by_module ON ai_governance_use_case (tenant_id, module_ref, deployment_status);
CREATE UNIQUE INDEX ai_governance_use_case_idem ON ai_governance_use_case (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE ai_governance_use_case IS 'class=tenant_aggregate; m29 governed AI use case (opaque m24 refs; no AI-executed controlled action)';

-- ai_governance_release — a RELEASE proposal for an M24 asset version (model/prompt/provider/policy/use-case) OR a
-- controlled WAIVER exception (subject_kind='waiver_exception'). THE NO-AI-SELF-APPROVAL invariant: only a HUMAN who is
-- not the proposer can approve/release it (human_ck + sod_ck); a non-waiver release cannot be approved without a passing
-- evaluation (evidence_ck). Lifecycle:
--   draft -> assessment -> evaluation_pending -> review_pending -> approved -> released
--                                                 review_pending -> rejected ; approved/released -> suspended|withdrawn|superseded
CREATE TABLE ai_governance_release (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), use_case_id uuid,
  subject_kind text NOT NULL, subject_ref uuid, risk_tier text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'draft', evaluation_passed boolean NOT NULL DEFAULT false,
  proposed_by uuid NOT NULL, approved_by uuid, decision_reason_code text, reason text,
  provider_restricted boolean NOT NULL DEFAULT false, expires_at timestamptz, compensating_control_ref uuid,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_governance_release_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_governance_release_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_governance_release_kind_ck CHECK (subject_kind IN ('model_version','prompt_version','provider_config','policy_version','use_case','waiver_exception')),
  CONSTRAINT ai_governance_release_risk_ck CHECK (risk_tier IN ('low','medium','high','critical')),
  CONSTRAINT ai_governance_release_status_ck CHECK (status IN ('draft','assessment','evaluation_pending','review_pending','approved','released','rejected','suspended','withdrawn','superseded')),
  -- NO AI SELF-APPROVAL: an approved/released release must carry a HUMAN approver...
  CONSTRAINT ai_governance_release_human_ck CHECK (status NOT IN ('approved','released') OR approved_by IS NOT NULL),
  -- ...who is NOT the proposer (maker != checker / proposer != approver).
  CONSTRAINT ai_governance_release_sod_ck CHECK (approved_by IS NULL OR approved_by <> proposed_by),
  -- EVIDENCE GATE: a non-waiver release cannot be approved/released without a passing evaluation.
  CONSTRAINT ai_governance_release_evidence_ck CHECK (subject_kind = 'waiver_exception' OR status NOT IN ('approved','released') OR evaluation_passed = true),
  CONSTRAINT ai_governance_release_optlock_ck CHECK (version >= 1),
  CONSTRAINT ai_governance_release_uc_fkey FOREIGN KEY (tenant_id, use_case_id) REFERENCES ai_governance_use_case (tenant_id, id));
ALTER TABLE ai_governance_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_governance_release FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_governance_release
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_governance_release_by_uc ON ai_governance_release (tenant_id, use_case_id, status);
CREATE INDEX ai_governance_release_by_kind ON ai_governance_release (tenant_id, subject_kind, status);
CREATE UNIQUE INDEX ai_governance_release_idem ON ai_governance_release (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE ai_governance_release IS 'class=tenant_aggregate; m29 release/waiver (human-approver + proposer!=approver + evidence CHECKs; opaque m24 refs)';

-- ai_governance_evaluation — APPEND-ONLY evaluation EVIDENCE for a release (opaque test/eval + model/prompt/provider
-- refs; dlp/safety/citation results; accuracy basis points; pass flag). No "passed" without a recorded evaluation.
CREATE TABLE ai_governance_evaluation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), release_id uuid NOT NULL,
  eval_ref uuid, model_ref uuid, prompt_ref uuid, provider_ref uuid, classification text NOT NULL DEFAULT 'internal',
  dlp_result text NOT NULL DEFAULT 'na', safety_result text NOT NULL DEFAULT 'na', citation_result text NOT NULL DEFAULT 'na',
  accuracy_bps integer NOT NULL DEFAULT 0, passed boolean NOT NULL DEFAULT false, reason_code text,
  by_user uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_governance_evaluation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_governance_evaluation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_governance_evaluation_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT ai_governance_evaluation_dlp_ck CHECK (dlp_result IN ('pass','block','na')),
  CONSTRAINT ai_governance_evaluation_safety_ck CHECK (safety_result IN ('pass','fail','na')),
  CONSTRAINT ai_governance_evaluation_cite_ck CHECK (citation_result IN ('pass','fail','na')),
  CONSTRAINT ai_governance_evaluation_acc_ck CHECK (accuracy_bps BETWEEN 0 AND 10000),
  CONSTRAINT ai_governance_evaluation_rel_fkey FOREIGN KEY (tenant_id, release_id) REFERENCES ai_governance_release (tenant_id, id));
ALTER TABLE ai_governance_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_governance_evaluation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_governance_evaluation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_governance_evaluation_by_rel ON ai_governance_evaluation (tenant_id, release_id);
COMMENT ON TABLE ai_governance_evaluation IS 'class=tenant_ledger_append_only; m29 evaluation evidence (opaque refs; no passed without evidence)';

-- ai_governance_decision — APPEND-ONLY HUMAN governance decision evidence (approve/reject/release/suspend/withdraw on a
-- release; approve/reject on a waiver). decider is a HUMAN (NOT NULL). Human accountability; AI never decides.
CREATE TABLE ai_governance_decision (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, decision text NOT NULL, decider uuid NOT NULL,
  reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_governance_decision_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_governance_decision_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_governance_decision_target_ck CHECK (target_type IN ('release','waiver','use_case')),
  CONSTRAINT ai_governance_decision_decision_ck CHECK (decision IN ('approve','reject','release','suspend','withdraw')));
ALTER TABLE ai_governance_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_governance_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_governance_decision
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_governance_decision_by_target ON ai_governance_decision (tenant_id, target_type, target_id);
COMMENT ON TABLE ai_governance_decision IS 'class=tenant_ledger_append_only; m29 human governance decision (decider NOT NULL; AI never decides)';

-- ai_governance_history — APPEND-ONLY lifecycle history for a release / use case / waiver / policy.
CREATE TABLE ai_governance_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_governance_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_governance_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_governance_history_target_ck CHECK (target_type IN ('release','use_case','waiver','policy')));
ALTER TABLE ai_governance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_governance_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_governance_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_governance_history_by_target ON ai_governance_history (tenant_id, target_type, target_id);
COMMENT ON TABLE ai_governance_history IS 'class=tenant_ledger_append_only; m29 governance lifecycle history';

-- ai_governance_idempotency — APPEND-ONLY idempotency ledger. THE "no duplicate release proposal / decision" guarantee.
CREATE TABLE ai_governance_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, release_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT ai_governance_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_governance_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_governance_idempotency_key_uk UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ai_governance_idempotency_rel_fkey FOREIGN KEY (tenant_id, release_id) REFERENCES ai_governance_release (tenant_id, id));
ALTER TABLE ai_governance_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_governance_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_governance_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE ai_governance_idempotency IS 'class=tenant_ledger_append_only; m29 idempotency ledger (no duplicate release/decision)';
