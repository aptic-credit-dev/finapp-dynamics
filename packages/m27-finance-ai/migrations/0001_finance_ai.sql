-- ---------------------------------------------------------------------------------------------------
-- M27-finance-ai — GOVERNED Finance AI (Stage 5, mvp:partial): human-reviewed, EXPLAINABLE AI SUGGESTIONS for
-- reconciliation and finance (bank recon from M15/M15a, GL recon from M20) — match suggestions, exception
-- classification, anomaly detection, risk flagging and journal-recommendation drafting. IT NEVER AUTO-POSTS, never
-- approves, never auto-matches, never auto-reconciles, never closes an exception and never mutates a finance record —
-- a HUMAN decides and the owning finance module (M15/M21) executes. A suggestion is NEVER a confirmed accounting fact.
-- THE GOVERNANCE INVARIANTS ARE DB-ENFORCED: an analysis / a suggestion can only reach a decided state
-- ('accepted'/'rejected'/'dismissed') with a HUMAN reviewer (no autonomous action); an accepted suggestion requiring
-- explainability must carry at least one matched feature (no unexplained match accepted); config can never turn human
-- review off, never enable auto-post and never enable auto-match. It REUSES the M24 governed AI pipeline BY CONTRACT
-- (owns NO provider/routing/DLP/prompt/vector engine, NO second outbox, NO new event family — M24 emits the
-- ai.*_lifecycle events). M15/M20/M24 subjects are referenced by OPAQUE uuid ONLY (no cross-module FK; reads no
-- m15/m20/m24 table; matching stays owned by M15a, GL recon by M20). Confidence is an INTEGER basis-points score
-- (0..10000); money is bigint MINOR UNITS (never float, ADR-007); there is NO float and NO secret/credential column.
-- Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs
-- (within m27 only), version on mutable aggregates. No DELETE grant (ADR-010). Analyses/suggestions/features/evidence/
-- reviews/classifications/histories/model-results and the idempotency ledger are append-only where appropriate
-- (INSERT+SELECT, 0002). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('ai.finance.read', 'm27-finance-ai', 'finance_ai_analysis', false),
  ('ai.finance.analyze', 'm27-finance-ai', 'finance_ai_analysis', false),
  ('ai.finance.review', 'm27-finance-ai', 'finance_ai_analysis', true),
  ('ai.finance.configure', 'm27-finance-ai', 'finance_ai_config', true),
  ('ai.finance.export', 'm27-finance-ai', 'finance_ai_evidence', true);

-- finance_ai_config — versioned config, one active per scope. Human review can never be turned off; auto-post and
-- auto-match can never be enabled (fail closed — finance AI is advisory only, NO auto-post).
CREATE TABLE finance_ai_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft', require_human_review boolean NOT NULL DEFAULT true,
  auto_post boolean NOT NULL DEFAULT false, auto_match boolean NOT NULL DEFAULT false,
  min_confidence_bps integer NOT NULL DEFAULT 0, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_ai_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_config_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT finance_ai_config_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT finance_ai_config_review_ck CHECK (require_human_review = true),
  CONSTRAINT finance_ai_config_autopost_ck CHECK (auto_post = false),
  CONSTRAINT finance_ai_config_automatch_ck CHECK (auto_match = false),
  CONSTRAINT finance_ai_config_conf_ck CHECK (min_confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT finance_ai_config_optlock_ck CHECK (version >= 1));
ALTER TABLE finance_ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX finance_ai_config_one_active ON finance_ai_config (tenant_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX finance_ai_config_idem ON finance_ai_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE finance_ai_config IS 'class=tenant_aggregate; m27 finance-AI config (human review on, auto-post + auto-match off)';

-- finance_ai_subject — the reconciliation subject binding: an OPAQUE reference to an M15 bank-recon or M20 GL-recon run
-- (no FK). classification drives M24 DLP/routing.
CREATE TABLE finance_ai_subject (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_type text NOT NULL, subject_ref uuid NOT NULL, classification text NOT NULL DEFAULT 'confidential',
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_ai_subject_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_subject_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_subject_type_ck CHECK (subject_type IN ('bank_recon','gl_recon')),
  CONSTRAINT finance_ai_subject_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT finance_ai_subject_status_ck CHECK (status IN ('active','closed')),
  CONSTRAINT finance_ai_subject_optlock_ck CHECK (version >= 1));
ALTER TABLE finance_ai_subject ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_subject FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_subject
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX finance_ai_subject_one ON finance_ai_subject (tenant_id, subject_type, subject_ref);
COMMENT ON TABLE finance_ai_subject IS 'class=tenant_aggregate; m27 recon subject binding (opaque m15/m20 ref, no FK)';

-- finance_ai_analysis — an AI analysis of a recon subject. WRAPS an M24 governed request->output (ai_request_ref /
-- ai_output_ref are OPAQUE m24 ids, no FK). THE NO-AUTONOMOUS-ACTION invariant: only a HUMAN reviewer can decide it.
CREATE TABLE finance_ai_analysis (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), subject_id uuid NOT NULL,
  analysis_kind text NOT NULL, ai_request_ref uuid, ai_output_ref uuid,
  status text NOT NULL DEFAULT 'requested', confidence_bps integer NOT NULL DEFAULT 0,
  reviewed_by uuid, review_reason_code text, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_ai_analysis_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_analysis_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_analysis_kind_ck CHECK (analysis_kind IN ('match_suggestion','exception_classification','anomaly_detection','risk_flagging','journal_recommendation','transaction_classification')),
  CONSTRAINT finance_ai_analysis_status_ck CHECK (status IN ('requested','review_pending','accepted','rejected','dismissed','failed')),
  CONSTRAINT finance_ai_analysis_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT finance_ai_analysis_human_ck CHECK (status NOT IN ('accepted','rejected','dismissed') OR reviewed_by IS NOT NULL),
  CONSTRAINT finance_ai_analysis_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_ai_analysis_subject_fkey FOREIGN KEY (tenant_id, subject_id) REFERENCES finance_ai_subject (tenant_id, id));
ALTER TABLE finance_ai_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_analysis FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_analysis
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_ai_analysis_by_subject ON finance_ai_analysis (tenant_id, subject_id, status);
CREATE UNIQUE INDEX finance_ai_analysis_idem ON finance_ai_analysis (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE finance_ai_analysis IS 'class=tenant_aggregate; m27 finance analysis (wraps opaque m24 request/output; human-decided-only CHECK)';

-- finance_ai_analysis_history — append-only analysis lifecycle evidence.
CREATE TABLE finance_ai_analysis_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_ai_analysis_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_analysis_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_analysis_history_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES finance_ai_analysis (tenant_id, id));
ALTER TABLE finance_ai_analysis_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_analysis_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_analysis_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_ai_analysis_history_by_an ON finance_ai_analysis_history (tenant_id, analysis_id);
COMMENT ON TABLE finance_ai_analysis_history IS 'class=tenant_ledger_append_only; m27 analysis history';

-- finance_ai_model_result — append-only M24 output scoring result summary for an analysis (opaque m24 output ref;
-- score/anomaly flag). Never raw model output.
CREATE TABLE finance_ai_model_result (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  ai_output_ref uuid, score_bps integer NOT NULL DEFAULT 0, anomaly boolean NOT NULL DEFAULT false, method_ref uuid,
  by_user uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_ai_model_result_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_model_result_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_model_result_score_ck CHECK (score_bps BETWEEN 0 AND 10000),
  CONSTRAINT finance_ai_model_result_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES finance_ai_analysis (tenant_id, id));
ALTER TABLE finance_ai_model_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_model_result FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_model_result
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_ai_model_result_by_an ON finance_ai_model_result (tenant_id, analysis_id);
COMMENT ON TABLE finance_ai_model_result IS 'class=tenant_ledger_append_only; m27 model result summary (opaque m24 output ref)';

-- finance_ai_exception_classification — append-only classification of a recon exception (opaque m15/m20 exception ref).
CREATE TABLE finance_ai_exception_classification (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  exception_ref uuid, category text NOT NULL, confidence_bps integer NOT NULL DEFAULT 0, reason_code text,
  by_user uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_ai_exception_classification_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_exception_classification_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_exception_classification_cat_ck CHECK (category IN ('unmatched','timing_difference','fee_or_charge','duplicate','fx_difference','missing_entry','other')),
  CONSTRAINT finance_ai_exception_classification_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT finance_ai_exception_classification_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES finance_ai_analysis (tenant_id, id));
ALTER TABLE finance_ai_exception_classification ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_exception_classification FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_exception_classification
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_ai_exception_classification_by_an ON finance_ai_exception_classification (tenant_id, analysis_id);
COMMENT ON TABLE finance_ai_exception_classification IS 'class=tenant_ledger_append_only; m27 exception classification';

-- finance_ai_suggestion — an EXPLAINABLE match/candidate suggestion derived from an ACCEPTED analysis. ADVISORY ONLY:
-- a suggestion can only be decided by a HUMAN, an accepted (explainability-required) suggestion has >= 1 matched
-- feature (no unexplained match accepted), and M27 NEVER auto-matches/auto-posts. amount_minor is bigint minor units
-- (never float); source/target/matching_method are OPAQUE refs (no FK). A suggestion is never a confirmed accounting fact.
CREATE TABLE finance_ai_suggestion (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  suggestion_type text NOT NULL, source_ref uuid, target_ref uuid, matching_method_ref uuid,
  amount_minor bigint, currency text, status text NOT NULL DEFAULT 'suggested', confidence_bps integer NOT NULL DEFAULT 0,
  explainability_required boolean NOT NULL DEFAULT true, feature_count integer NOT NULL DEFAULT 0,
  decided_by uuid, decision_reason_code text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_ai_suggestion_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_suggestion_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_suggestion_type_ck CHECK (suggestion_type IN ('exact_reference_match','amount_date_match','fuzzy_reference_match','split_match','duplicate_candidate','timing_difference','fee_or_charge','reversal_candidate','transfer_pair','journal_adjustment_candidate','unresolved_exception','anomaly_flag')),
  CONSTRAINT finance_ai_suggestion_status_ck CHECK (status IN ('suggested','accepted','rejected','dismissed')),
  CONSTRAINT finance_ai_suggestion_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT finance_ai_suggestion_featcount_ck CHECK (feature_count >= 0),
  -- ADVISORY ONLY: only a HUMAN can decide a suggestion (a person chooses to act; m27 never matches/posts).
  CONSTRAINT finance_ai_suggestion_human_ck CHECK (status NOT IN ('accepted','rejected','dismissed') OR decided_by IS NOT NULL),
  -- EXPLAINABLE MATCHES: an accepted explainability-required suggestion has at least one matched feature.
  CONSTRAINT finance_ai_suggestion_explain_ck CHECK (status <> 'accepted' OR explainability_required = false OR feature_count > 0),
  CONSTRAINT finance_ai_suggestion_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_ai_suggestion_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES finance_ai_analysis (tenant_id, id));
ALTER TABLE finance_ai_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_suggestion FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_suggestion
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_ai_suggestion_by_an ON finance_ai_suggestion (tenant_id, analysis_id, status);
COMMENT ON TABLE finance_ai_suggestion IS 'class=tenant_aggregate; m27 explainable suggestion (advisory only; human-decided + explainability CHECKs; bigint minor units)';

-- finance_ai_suggestion_history — append-only suggestion lifecycle evidence.
CREATE TABLE finance_ai_suggestion_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), suggestion_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_ai_suggestion_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_suggestion_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_suggestion_history_sg_fkey FOREIGN KEY (tenant_id, suggestion_id) REFERENCES finance_ai_suggestion (tenant_id, id));
ALTER TABLE finance_ai_suggestion_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_suggestion_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_suggestion_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_ai_suggestion_history_by_sg ON finance_ai_suggestion_history (tenant_id, suggestion_id);
COMMENT ON TABLE finance_ai_suggestion_history IS 'class=tenant_ledger_append_only; m27 suggestion history';

-- finance_ai_feature — append-only matched feature explaining a suggestion (explainability). weight is basis points.
CREATE TABLE finance_ai_feature (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), suggestion_id uuid NOT NULL,
  feature_type text NOT NULL, weight_bps integer NOT NULL DEFAULT 0, reason_code text,
  by_user uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_ai_feature_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_feature_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_feature_type_ck CHECK (feature_type IN ('reference','amount','date','counterparty','narrative','pattern')),
  CONSTRAINT finance_ai_feature_weight_ck CHECK (weight_bps BETWEEN 0 AND 10000),
  CONSTRAINT finance_ai_feature_sg_fkey FOREIGN KEY (tenant_id, suggestion_id) REFERENCES finance_ai_suggestion (tenant_id, id));
ALTER TABLE finance_ai_feature ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_feature FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_feature
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_ai_feature_by_sg ON finance_ai_feature (tenant_id, suggestion_id);
COMMENT ON TABLE finance_ai_feature IS 'class=tenant_ledger_append_only; m27 matched feature (explainability)';

-- finance_ai_evidence — append-only supporting evidence link for an analysis or a suggestion (opaque m15/m20/m09 ref).
-- Never raw bank-statement or ledger content.
CREATE TABLE finance_ai_evidence (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, source_type text NOT NULL DEFAULT 'bank_line', source_ref uuid,
  span text, confidence_bps integer NOT NULL DEFAULT 0, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_ai_evidence_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_evidence_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_evidence_target_ck CHECK (target_type IN ('analysis','suggestion')),
  CONSTRAINT finance_ai_evidence_source_ck CHECK (source_type IN ('bank_line','gl_line','statement','journal','document')),
  CONSTRAINT finance_ai_evidence_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000));
ALTER TABLE finance_ai_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_ai_evidence_by_target ON finance_ai_evidence (tenant_id, target_type, target_id);
COMMENT ON TABLE finance_ai_evidence IS 'class=tenant_ledger_append_only; m27 evidence (opaque m15/m20/m09 ref; never content)';

-- finance_ai_review — append-only HUMAN review decision evidence on an analysis or a suggestion (human accountability).
CREATE TABLE finance_ai_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, reviewer uuid NOT NULL, decision text NOT NULL,
  reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_ai_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_review_target_ck CHECK (target_type IN ('analysis','suggestion')),
  CONSTRAINT finance_ai_review_decision_ck CHECK (decision IN ('accept','reject','dismiss')));
ALTER TABLE finance_ai_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_ai_review_by_target ON finance_ai_review (tenant_id, target_type, target_id);
COMMENT ON TABLE finance_ai_review IS 'class=tenant_ledger_append_only; m27 human review (human accountability; no auto-post)';

-- finance_ai_idempotency — append-only idempotency ledger. THE "no duplicate finance analysis" guarantee: unique per tenant+key.
CREATE TABLE finance_ai_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, analysis_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT finance_ai_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_ai_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_ai_idempotency_key_uk UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT finance_ai_idempotency_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES finance_ai_analysis (tenant_id, id));
ALTER TABLE finance_ai_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ai_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_ai_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE finance_ai_idempotency IS 'class=tenant_ledger_append_only; m27 idempotency ledger (no duplicate analysis)';
