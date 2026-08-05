-- ---------------------------------------------------------------------------------------------------
-- M25-operational-ai — GOVERNED Operational AI (Stage 5, MVP): human-reviewed AI SUGGESTIONS for Feedback (m12) and
-- Case (m13) — summaries, sentiment, complaint/feedback classification, root-cause hints, suggested activities and
-- routing/escalation recommendations. It RECOMMENDS ONLY: it never closes, escalates, reassigns or resolves a
-- controlled feedback/case item on its own — a HUMAN decides and a human acts (through m12/m13's own controlled
-- endpoints). THE GOVERNANCE INVARIANTS ARE DB-ENFORCED: an analysis or a suggestion can only reach a decided state
-- ('accepted'/'rejected'/'dismissed') with a HUMAN reviewer (no autonomous action); config can never turn human review
-- off and can never enable auto-apply. It REUSES the M24 governed AI gateway/request->output->human-review pipeline BY
-- CONTRACT — it owns NO provider, NO routing, NO DLP, NO prompt/vector engine, NO second outbox and NO new event
-- family (M24 emits the ai.*_lifecycle events). Feedback/case/document/M24-request/M24-output are referenced by OPAQUE
-- uuid ONLY (no cross-module FK; m25 reads no m12/m13/m24 table). Confidence is an INTEGER basis-points score
-- (0..10000); there is NO float and NO secret column. Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE,
-- RLS ENABLE+FORCE + tenant_isolation, composite FKs (within m25 only), version on mutable aggregates. No DELETE grant
-- (ADR-010). Histories, evidence, reviews and the idempotency ledger are append-only (INSERT+SELECT, 0002).
-- PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('ai.operational.read', 'm25-operational-ai', 'ops_ai_analysis', false),
  ('ai.operational.analyze', 'm25-operational-ai', 'ops_ai_analysis', false),
  ('ai.operational.review', 'm25-operational-ai', 'ops_ai_analysis', true),
  ('ai.operational.configure', 'm25-operational-ai', 'ops_ai_config', true),
  ('ai.suggestion.read', 'm25-operational-ai', 'ops_ai_suggestion', false),
  ('ai.suggestion.create', 'm25-operational-ai', 'ops_ai_suggestion', false),
  ('ai.suggestion.decide', 'm25-operational-ai', 'ops_ai_suggestion', true);

-- ops_ai_config — versioned operational-AI config, one active per scope. Human review can never be turned off and
-- auto-apply can never be enabled (fail closed — M25 recommends only).
CREATE TABLE ops_ai_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft', require_human_review boolean NOT NULL DEFAULT true,
  auto_apply boolean NOT NULL DEFAULT false, min_confidence_bps integer NOT NULL DEFAULT 0, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ops_ai_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ops_ai_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ops_ai_config_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT ops_ai_config_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT ops_ai_config_review_ck CHECK (require_human_review = true),
  CONSTRAINT ops_ai_config_autoapply_ck CHECK (auto_apply = false),
  CONSTRAINT ops_ai_config_conf_ck CHECK (min_confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT ops_ai_config_optlock_ck CHECK (version >= 1));
ALTER TABLE ops_ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ai_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_ai_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX ops_ai_config_one_active ON ops_ai_config (tenant_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX ops_ai_config_idem ON ops_ai_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE ops_ai_config IS 'class=tenant_aggregate; m25 operational-AI config (human review always on, auto-apply always off)';

-- ops_ai_subject — the operational subject binding: an OPAQUE reference to an m12 feedback or m13 case (no FK — read no
-- other module's table). classification drives m24 DLP/routing when an analysis is requested.
CREATE TABLE ops_ai_subject (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_type text NOT NULL, subject_ref uuid NOT NULL, classification text NOT NULL DEFAULT 'internal',
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ops_ai_subject_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ops_ai_subject_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ops_ai_subject_type_ck CHECK (subject_type IN ('feedback','case')),
  CONSTRAINT ops_ai_subject_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT ops_ai_subject_status_ck CHECK (status IN ('active','closed')),
  CONSTRAINT ops_ai_subject_optlock_ck CHECK (version >= 1));
ALTER TABLE ops_ai_subject ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ai_subject FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_ai_subject
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX ops_ai_subject_one ON ops_ai_subject (tenant_id, subject_type, subject_ref);
COMMENT ON TABLE ops_ai_subject IS 'class=tenant_aggregate; m25 operational subject binding (opaque m12/m13 ref, no FK)';

-- ops_ai_analysis — an AI analysis of a subject. It WRAPS an m24 governed request->output (ai_request_ref / ai_output_ref
-- are OPAQUE m24 ids, no FK). sentiment_label / category are SUGGESTED values a human confirms on review. THE
-- NO-AUTONOMOUS-ACTION INVARIANT: it can only reach accepted/rejected/dismissed with a HUMAN reviewer.
CREATE TABLE ops_ai_analysis (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), subject_id uuid NOT NULL,
  analysis_kind text NOT NULL, ai_request_ref uuid, ai_output_ref uuid,
  status text NOT NULL DEFAULT 'requested', confidence_bps integer NOT NULL DEFAULT 0,
  sentiment_label text, category text, summary_document_ref uuid, reviewed_by uuid, review_reason_code text,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ops_ai_analysis_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ops_ai_analysis_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ops_ai_analysis_kind_ck CHECK (analysis_kind IN ('summary','sentiment','classification','root_cause','routing')),
  CONSTRAINT ops_ai_analysis_status_ck CHECK (status IN ('requested','review_pending','accepted','rejected','dismissed','failed')),
  CONSTRAINT ops_ai_analysis_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT ops_ai_analysis_sentiment_ck CHECK (sentiment_label IS NULL OR sentiment_label IN ('positive','neutral','negative','mixed')),
  -- NO AUTONOMOUS ACTION: an analysis can only be decided (accepted/rejected/dismissed) by a HUMAN reviewer.
  CONSTRAINT ops_ai_analysis_human_ck CHECK (status NOT IN ('accepted','rejected','dismissed') OR reviewed_by IS NOT NULL),
  CONSTRAINT ops_ai_analysis_optlock_ck CHECK (version >= 1),
  CONSTRAINT ops_ai_analysis_subject_fkey FOREIGN KEY (tenant_id, subject_id) REFERENCES ops_ai_subject (tenant_id, id));
ALTER TABLE ops_ai_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ai_analysis FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_ai_analysis
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ops_ai_analysis_by_subject ON ops_ai_analysis (tenant_id, subject_id, status);
CREATE UNIQUE INDEX ops_ai_analysis_idem ON ops_ai_analysis (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE ops_ai_analysis IS 'class=tenant_aggregate; m25 AI analysis (wraps opaque m24 request/output; human-decided-only CHECK)';

-- ops_ai_analysis_history — append-only analysis lifecycle evidence.
CREATE TABLE ops_ai_analysis_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_ai_analysis_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ops_ai_analysis_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ops_ai_analysis_history_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES ops_ai_analysis (tenant_id, id));
ALTER TABLE ops_ai_analysis_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ai_analysis_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_ai_analysis_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ops_ai_analysis_history_by_an ON ops_ai_analysis_history (tenant_id, analysis_id);
COMMENT ON TABLE ops_ai_analysis_history IS 'class=tenant_ledger_append_only; m25 analysis history';

-- ops_ai_suggestion — a suggested operational action (activity/routing/escalation/reassignment) derived from an
-- ACCEPTED analysis. recommended_ref / rationale_document_ref are OPAQUE (no FK). THE RECOMMENDS-ONLY INVARIANT: a
-- suggestion can only be decided (accepted/rejected/dismissed) by a HUMAN — M25 NEVER applies it to m12/m13.
CREATE TABLE ops_ai_suggestion (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  suggestion_type text NOT NULL, recommended_ref uuid, rationale_document_ref uuid,
  status text NOT NULL DEFAULT 'suggested', confidence_bps integer NOT NULL DEFAULT 0,
  decided_by uuid, decision_reason_code text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ops_ai_suggestion_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ops_ai_suggestion_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ops_ai_suggestion_type_ck CHECK (suggestion_type IN ('activity','routing','escalation','reassignment')),
  CONSTRAINT ops_ai_suggestion_status_ck CHECK (status IN ('suggested','accepted','rejected','dismissed')),
  CONSTRAINT ops_ai_suggestion_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  -- RECOMMENDS ONLY: a suggestion can only be decided by a HUMAN (a person chooses to act; m25 never acts).
  CONSTRAINT ops_ai_suggestion_human_ck CHECK (status NOT IN ('accepted','rejected','dismissed') OR decided_by IS NOT NULL),
  CONSTRAINT ops_ai_suggestion_optlock_ck CHECK (version >= 1),
  CONSTRAINT ops_ai_suggestion_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES ops_ai_analysis (tenant_id, id));
ALTER TABLE ops_ai_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ai_suggestion FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_ai_suggestion
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ops_ai_suggestion_by_an ON ops_ai_suggestion (tenant_id, analysis_id, status);
COMMENT ON TABLE ops_ai_suggestion IS 'class=tenant_aggregate; m25 operational suggestion (recommends only; human-decided-only CHECK)';

-- ops_ai_suggestion_history — append-only suggestion lifecycle evidence.
CREATE TABLE ops_ai_suggestion_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), suggestion_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_ai_suggestion_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ops_ai_suggestion_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ops_ai_suggestion_history_sg_fkey FOREIGN KEY (tenant_id, suggestion_id) REFERENCES ops_ai_suggestion (tenant_id, id));
ALTER TABLE ops_ai_suggestion_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ai_suggestion_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_ai_suggestion_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ops_ai_suggestion_history_by_sg ON ops_ai_suggestion_history (tenant_id, suggestion_id);
COMMENT ON TABLE ops_ai_suggestion_history IS 'class=tenant_ledger_append_only; m25 suggestion history';

-- ops_ai_evidence — append-only source citation for an analysis or a suggestion (opaque feedback_answer / case_activity
-- / m09 document ref + span). "with citations". target is polymorphic (analysis|suggestion) — no FK.
CREATE TABLE ops_ai_evidence (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, source_type text NOT NULL, source_ref uuid, span text,
  confidence_bps integer NOT NULL DEFAULT 0, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_ai_evidence_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ops_ai_evidence_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ops_ai_evidence_target_ck CHECK (target_type IN ('analysis','suggestion')),
  CONSTRAINT ops_ai_evidence_source_ck CHECK (source_type IN ('feedback_answer','case_activity','document')),
  CONSTRAINT ops_ai_evidence_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000));
ALTER TABLE ops_ai_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ai_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_ai_evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ops_ai_evidence_by_target ON ops_ai_evidence (tenant_id, target_type, target_id);
COMMENT ON TABLE ops_ai_evidence IS 'class=tenant_ledger_append_only; m25 evidence/citation (opaque m12/m13/m09 ref + span)';

-- ops_ai_review — append-only HUMAN decision evidence on an analysis or a suggestion (human accountability). A person
-- decides; M25 recommends only.
CREATE TABLE ops_ai_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, reviewer uuid NOT NULL, decision text NOT NULL,
  reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_ai_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ops_ai_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ops_ai_review_target_ck CHECK (target_type IN ('analysis','suggestion')),
  CONSTRAINT ops_ai_review_decision_ck CHECK (decision IN ('accept','reject','dismiss')));
ALTER TABLE ops_ai_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ai_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_ai_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ops_ai_review_by_target ON ops_ai_review (tenant_id, target_type, target_id);
COMMENT ON TABLE ops_ai_review IS 'class=tenant_ledger_append_only; m25 human review (human accountability)';

-- ops_ai_idempotency — append-only idempotency ledger. THE "no duplicate analysis" guarantee: unique per tenant+key.
CREATE TABLE ops_ai_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, analysis_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT ops_ai_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ops_ai_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ops_ai_idempotency_key_uk UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ops_ai_idempotency_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES ops_ai_analysis (tenant_id, id));
ALTER TABLE ops_ai_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ai_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_ai_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE ops_ai_idempotency IS 'class=tenant_ledger_append_only; m25 idempotency ledger (no duplicate analysis)';
