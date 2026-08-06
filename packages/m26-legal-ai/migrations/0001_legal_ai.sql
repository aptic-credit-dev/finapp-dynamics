-- ---------------------------------------------------------------------------------------------------
-- M26-legal-ai — GOVERNED Legal AI (Stage 5, mvp:false): human-reviewed, citation-backed AI SUGGESTIONS for the legal
-- domain (matters/cases from M14) — summaries, chronology, issue/obligation/deadline extraction, clause analysis,
-- evidence-gap detection and drafting assistance. LEGAL-ADVISORY ONLY: it never files, never reaches a legal
-- conclusion, never settles or enforces, never mutates a matter — a HUMAN legal reviewer decides. An AI inference is
-- NEVER a verified legal fact (fact_status is 'extracted' or 'inferred' only). THE GOVERNANCE INVARIANTS ARE
-- DB-ENFORCED: an analysis / a suggestion can only reach a decided state ('accepted'/'rejected'/'dismissed') with a
-- HUMAN reviewer (no autonomous action); an accepted citations-required analysis must have a citation; config can never
-- turn human review off and can never enable auto-apply. It REUSES the M24 governed AI pipeline BY CONTRACT (owns NO
-- provider/routing/DLP/prompt/vector engine, NO second outbox, NO new event family — M24 emits the ai.*_lifecycle
-- events). M14 matters + M09 documents + M24 request/output are referenced by OPAQUE uuid ONLY (no cross-module FK;
-- reads no m14/m09/m24 table; M14 stays the legal source of truth; citations hold a document REFERENCE + version/hash,
-- never content). Privileged/work-product material is behind the ethical wall (ai.privileged.read). Confidence is an
-- INTEGER basis-points score (0..10000); there is NO float and NO secret/credential column. Every tenant-scoped table:
-- composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs (within m26 only), version
-- on mutable aggregates. No DELETE grant (ADR-010). Findings, citations, evidence, reviews, histories and the
-- idempotency ledger are append-only (INSERT+SELECT, 0002). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('ai.legal.read', 'm26-legal-ai', 'legal_ai_analysis', false),
  ('ai.legal.analyze', 'm26-legal-ai', 'legal_ai_analysis', false),
  ('ai.legal.review', 'm26-legal-ai', 'legal_ai_analysis', true),
  ('ai.legal.configure', 'm26-legal-ai', 'legal_ai_config', true),
  ('ai.legal.export', 'm26-legal-ai', 'legal_ai_evidence', true),
  ('ai.privileged.read', 'm26-legal-ai', 'legal_ai_subject', true);

-- legal_ai_config — versioned config, one active per scope. Human review can never be turned off and auto-apply can
-- never be enabled (fail closed — legal AI is advisory only).
CREATE TABLE legal_ai_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft', require_human_review boolean NOT NULL DEFAULT true,
  auto_apply boolean NOT NULL DEFAULT false, min_confidence_bps integer NOT NULL DEFAULT 0, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_ai_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_config_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT legal_ai_config_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT legal_ai_config_review_ck CHECK (require_human_review = true),
  CONSTRAINT legal_ai_config_autoapply_ck CHECK (auto_apply = false),
  CONSTRAINT legal_ai_config_conf_ck CHECK (min_confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT legal_ai_config_optlock_ck CHECK (version >= 1));
ALTER TABLE legal_ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legal_ai_config_one_active ON legal_ai_config (tenant_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX legal_ai_config_idem ON legal_ai_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE legal_ai_config IS 'class=tenant_aggregate; m26 legal-AI config (human review always on, auto-apply always off)';

-- legal_ai_subject — the legal subject binding: an OPAQUE reference to an m14 matter/case (no FK). classification drives
-- M24 DLP/routing; privilege_classification is the ethical-wall boundary (privileged/work_product require ai.privileged.read).
CREATE TABLE legal_ai_subject (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_type text NOT NULL, matter_ref uuid NOT NULL, classification text NOT NULL DEFAULT 'confidential',
  privilege_classification text NOT NULL DEFAULT 'confidential', status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_ai_subject_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_subject_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_subject_type_ck CHECK (subject_type IN ('matter','case')),
  CONSTRAINT legal_ai_subject_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT legal_ai_subject_priv_ck CHECK (privilege_classification IN ('none','confidential','work_product','privileged')),
  CONSTRAINT legal_ai_subject_status_ck CHECK (status IN ('active','closed')),
  CONSTRAINT legal_ai_subject_optlock_ck CHECK (version >= 1));
ALTER TABLE legal_ai_subject ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_subject FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_subject
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legal_ai_subject_one ON legal_ai_subject (tenant_id, subject_type, matter_ref);
COMMENT ON TABLE legal_ai_subject IS 'class=tenant_aggregate; m26 legal subject binding (opaque m14 matter ref; privilege/ethical-wall)';

-- legal_ai_analysis — an AI analysis of a legal subject. WRAPS an m24 governed request->output (ai_request_ref /
-- ai_output_ref are OPAQUE m24 ids, no FK). THE NO-AUTONOMOUS-ACTION + CITATION invariants: it can only reach
-- accepted/rejected/dismissed with a HUMAN reviewer, and an accepted citations-required analysis has >= 1 citation.
CREATE TABLE legal_ai_analysis (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), subject_id uuid NOT NULL,
  analysis_kind text NOT NULL, ai_request_ref uuid, ai_output_ref uuid,
  status text NOT NULL DEFAULT 'requested', confidence_bps integer NOT NULL DEFAULT 0,
  citations_required boolean NOT NULL DEFAULT true, citation_count integer NOT NULL DEFAULT 0,
  summary_document_ref uuid, reviewed_by uuid, review_reason_code text, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_ai_analysis_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_analysis_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_analysis_kind_ck CHECK (analysis_kind IN ('matter_summary','case_summary','chronology','issue_extraction','obligation_extraction','deadline_extraction','clause_analysis','evidence_gap','precedent_suggestion','risk_suggestion','filing_preparation','draft_assistance','next_action_suggestion')),
  CONSTRAINT legal_ai_analysis_status_ck CHECK (status IN ('requested','review_pending','accepted','rejected','dismissed','failed')),
  CONSTRAINT legal_ai_analysis_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT legal_ai_analysis_citecount_ck CHECK (citation_count >= 0),
  -- NO AUTONOMOUS ACTION: only a HUMAN reviewer can decide an analysis.
  CONSTRAINT legal_ai_analysis_human_ck CHECK (status NOT IN ('accepted','rejected','dismissed') OR reviewed_by IS NOT NULL),
  -- CITATIONS WHERE REQUIRED: an accepted citations-required analysis has at least one citation.
  CONSTRAINT legal_ai_analysis_cite_ck CHECK (status <> 'accepted' OR citations_required = false OR citation_count > 0),
  CONSTRAINT legal_ai_analysis_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_ai_analysis_subject_fkey FOREIGN KEY (tenant_id, subject_id) REFERENCES legal_ai_subject (tenant_id, id));
ALTER TABLE legal_ai_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_analysis FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_analysis
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_ai_analysis_by_subject ON legal_ai_analysis (tenant_id, subject_id, status);
CREATE UNIQUE INDEX legal_ai_analysis_idem ON legal_ai_analysis (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE legal_ai_analysis IS 'class=tenant_aggregate; m26 legal analysis (wraps opaque m24 request/output; human-decided-only + citations CHECKs)';

-- legal_ai_analysis_history — append-only analysis lifecycle evidence.
CREATE TABLE legal_ai_analysis_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_ai_analysis_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_analysis_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_analysis_history_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES legal_ai_analysis (tenant_id, id));
ALTER TABLE legal_ai_analysis_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_analysis_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_analysis_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_ai_analysis_history_by_an ON legal_ai_analysis_history (tenant_id, analysis_id);
COMMENT ON TABLE legal_ai_analysis_history IS 'class=tenant_ledger_append_only; m26 analysis history';

-- legal_ai_finding — append-only extracted/inferred finding on an analysis. fact_status is 'extracted' or 'inferred'
-- ONLY — an AI inference is NEVER a verified legal fact (a human verifies via review).
CREATE TABLE legal_ai_finding (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  finding_type text NOT NULL, fact_status text NOT NULL DEFAULT 'inferred', source text NOT NULL DEFAULT 'ai',
  confidence_bps integer NOT NULL DEFAULT 0, limitations text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_ai_finding_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_finding_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_finding_type_ck CHECK (finding_type IN ('extracted_fact','inferred_issue','legal_suggestion','procedural_suggestion','drafting_suggestion','risk_flag','evidence_gap')),
  -- FACT vs INFERENCE: never a "verified" legal fact.
  CONSTRAINT legal_ai_finding_factstatus_ck CHECK (fact_status IN ('extracted','inferred')),
  CONSTRAINT legal_ai_finding_source_ck CHECK (source IN ('ai')),
  CONSTRAINT legal_ai_finding_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT legal_ai_finding_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES legal_ai_analysis (tenant_id, id));
ALTER TABLE legal_ai_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_finding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_finding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_ai_finding_by_an ON legal_ai_finding (tenant_id, analysis_id);
COMMENT ON TABLE legal_ai_finding IS 'class=tenant_ledger_append_only; m26 finding (extracted/inferred, never verified)';

-- legal_ai_citation — append-only source citation for an analysis (m09 document REFERENCE + version/hash + bounded
-- location). NEVER document content; no cross-matter (the citation belongs to the analysis' subject, enforced in-service).
CREATE TABLE legal_ai_citation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  source_type text NOT NULL DEFAULT 'document', document_ref uuid, document_version integer, document_hash text,
  page integer, section text, paragraph_ref text, evidence_classification text NOT NULL DEFAULT 'supporting',
  confidence_bps integer NOT NULL DEFAULT 0, retrieved_at timestamptz, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_ai_citation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_citation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_citation_source_ck CHECK (source_type IN ('document','matter_record','precedent')),
  CONSTRAINT legal_ai_citation_evclass_ck CHECK (evidence_classification IN ('primary','secondary','supporting')),
  CONSTRAINT legal_ai_citation_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT legal_ai_citation_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES legal_ai_analysis (tenant_id, id));
ALTER TABLE legal_ai_citation ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_citation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_citation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_ai_citation_by_an ON legal_ai_citation (tenant_id, analysis_id);
COMMENT ON TABLE legal_ai_citation IS 'class=tenant_ledger_append_only; m26 citation (m09 doc ref + version/hash + bounded location; never content)';

-- legal_ai_suggestion — a suggested legal action (procedural/drafting/risk/next_action/precedent/evidence_gap) derived
-- from an ACCEPTED analysis. ADVISORY ONLY: a suggestion can only be decided by a HUMAN — M26 NEVER files/settles/
-- enforces/mutates a matter. recommended_ref / rationale_document_ref are OPAQUE (no FK).
CREATE TABLE legal_ai_suggestion (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL,
  suggestion_type text NOT NULL, recommended_ref uuid, rationale_document_ref uuid,
  status text NOT NULL DEFAULT 'suggested', confidence_bps integer NOT NULL DEFAULT 0,
  decided_by uuid, decision_reason_code text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_ai_suggestion_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_suggestion_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_suggestion_type_ck CHECK (suggestion_type IN ('procedural','drafting','risk','next_action','precedent','evidence_gap')),
  CONSTRAINT legal_ai_suggestion_status_ck CHECK (status IN ('suggested','accepted','rejected','dismissed')),
  CONSTRAINT legal_ai_suggestion_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  -- ADVISORY ONLY: only a HUMAN can decide a suggestion (a person chooses to act; m26 never acts).
  CONSTRAINT legal_ai_suggestion_human_ck CHECK (status NOT IN ('accepted','rejected','dismissed') OR decided_by IS NOT NULL),
  CONSTRAINT legal_ai_suggestion_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_ai_suggestion_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES legal_ai_analysis (tenant_id, id));
ALTER TABLE legal_ai_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_suggestion FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_suggestion
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_ai_suggestion_by_an ON legal_ai_suggestion (tenant_id, analysis_id, status);
COMMENT ON TABLE legal_ai_suggestion IS 'class=tenant_aggregate; m26 legal suggestion (advisory only; human-decided-only CHECK)';

-- legal_ai_suggestion_history — append-only suggestion lifecycle evidence.
CREATE TABLE legal_ai_suggestion_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), suggestion_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_ai_suggestion_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_suggestion_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_suggestion_history_sg_fkey FOREIGN KEY (tenant_id, suggestion_id) REFERENCES legal_ai_suggestion (tenant_id, id));
ALTER TABLE legal_ai_suggestion_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_suggestion_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_suggestion_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_ai_suggestion_history_by_sg ON legal_ai_suggestion_history (tenant_id, suggestion_id);
COMMENT ON TABLE legal_ai_suggestion_history IS 'class=tenant_ledger_append_only; m26 suggestion history';

-- legal_ai_review — append-only HUMAN legal-review decision evidence on an analysis or a suggestion (human
-- accountability). A person decides; M26 recommends only.
CREATE TABLE legal_ai_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, reviewer uuid NOT NULL, decision text NOT NULL,
  reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_ai_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_review_target_ck CHECK (target_type IN ('analysis','suggestion')),
  CONSTRAINT legal_ai_review_decision_ck CHECK (decision IN ('accept','reject','dismiss')));
ALTER TABLE legal_ai_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_ai_review_by_target ON legal_ai_review (tenant_id, target_type, target_id);
COMMENT ON TABLE legal_ai_review IS 'class=tenant_ledger_append_only; m26 human legal review (human accountability)';

-- legal_ai_evidence — append-only supporting evidence link for an analysis or a suggestion (opaque m09 document /
-- matter-record reference + bounded location). Never content.
CREATE TABLE legal_ai_evidence (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, source_type text NOT NULL DEFAULT 'document', source_ref uuid,
  evidence_classification text NOT NULL DEFAULT 'supporting', span text, confidence_bps integer NOT NULL DEFAULT 0,
  by_user uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_ai_evidence_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_evidence_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_evidence_target_ck CHECK (target_type IN ('analysis','suggestion')),
  CONSTRAINT legal_ai_evidence_source_ck CHECK (source_type IN ('document','matter_record','precedent')),
  CONSTRAINT legal_ai_evidence_evclass_ck CHECK (evidence_classification IN ('primary','secondary','supporting')),
  CONSTRAINT legal_ai_evidence_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000));
ALTER TABLE legal_ai_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_ai_evidence_by_target ON legal_ai_evidence (tenant_id, target_type, target_id);
COMMENT ON TABLE legal_ai_evidence IS 'class=tenant_ledger_append_only; m26 evidence (opaque m09/matter ref; never content)';

-- legal_ai_idempotency — append-only idempotency ledger. THE "no duplicate legal analysis" guarantee: unique per tenant+key.
CREATE TABLE legal_ai_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, analysis_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_ai_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_ai_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_ai_idempotency_key_uk UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT legal_ai_idempotency_an_fkey FOREIGN KEY (tenant_id, analysis_id) REFERENCES legal_ai_analysis (tenant_id, id));
ALTER TABLE legal_ai_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_ai_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_ai_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE legal_ai_idempotency IS 'class=tenant_ledger_append_only; m26 idempotency ledger (no duplicate analysis)';
