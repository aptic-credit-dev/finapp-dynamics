-- ---------------------------------------------------------------------------------------------------
-- M18-legaldocs — enterprise legal documents & knowledge management (Stage 4.4).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No table
-- grants DELETE (knowledge records / templates / clauses withdraw/supersede/archive by status; ADR-010). Status
-- history, assignment history, authority treatments, approval history, notes and usage are append-only (INSERT +
-- SELECT only, granted in 0002). RLS FORCE + these access rules are the ethical-walls substrate.
--
-- Knowledge records, templates and clauses are PUBLISHABLE objects: draft -> under_review -> approved ->
-- published, with supersession creating a NEW version (published content is immutable, content_hash frozen at
-- publish; ADR-074). Practice areas, jurisdictions, legal topics, document types and tags are NOT hardcoded — they
-- are configurable per tenant via legaldoc_taxonomy. Privileged legal advice, confidential clause/opinion/analysis
-- text and drafting strategy are sensitive: stored under RLS, redacted in APIs, and never placed in events/audit
-- (ADR-076). m18 publishes legaldocs.lifecycle through the ONE outbox m06 owns; it never creates a second outbox.
-- Workflow/rules/escalation/notifications are reached through m06/m07/m08. m18 owns NO storage — document bytes
-- live in m09; m18 stores references only. Cross-module references (m09 documents, m14 matters, m16 litigation,
-- m17 recoveries) are OPAQUE ids on legaldoc_reference — m18 never reads those modules' tables (ADR-075). Maker-
-- checker: knowledge/template/clause/opinion approval requires approved_by <> submitted_by/author (DB CHECK). No
-- finance, no AI, no vector/semantic search, no production legal-research vendor ingestion.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('legaldocs.knowledge.read', 'm18-legaldocs', 'legaldoc_knowledge', false),
  ('legaldocs.knowledge.create', 'm18-legaldocs', 'legaldoc_knowledge', false),
  ('legaldocs.knowledge.update', 'm18-legaldocs', 'legaldoc_knowledge', false),
  ('legaldocs.knowledge.assign', 'm18-legaldocs', 'legaldoc_knowledge', false),
  ('legaldocs.knowledge.submit', 'm18-legaldocs', 'legaldoc_knowledge', false),
  ('legaldocs.knowledge.review', 'm18-legaldocs', 'legaldoc_knowledge', false),
  ('legaldocs.knowledge.approve', 'm18-legaldocs', 'legaldoc_knowledge', true),
  ('legaldocs.knowledge.publish', 'm18-legaldocs', 'legaldoc_knowledge', true),
  ('legaldocs.knowledge.supersede', 'm18-legaldocs', 'legaldoc_knowledge', true),
  ('legaldocs.knowledge.withdraw', 'm18-legaldocs', 'legaldoc_knowledge', true),
  ('legaldocs.knowledge.archive', 'm18-legaldocs', 'legaldoc_knowledge', true),
  ('legaldocs.knowledge.reopen', 'm18-legaldocs', 'legaldoc_knowledge', true),
  ('legaldocs.taxonomy.read', 'm18-legaldocs', 'legaldoc_taxonomy', false),
  ('legaldocs.taxonomy.manage', 'm18-legaldocs', 'legaldoc_taxonomy', true),
  ('legaldocs.authority.read', 'm18-legaldocs', 'legaldoc_authority', false),
  ('legaldocs.authority.manage', 'm18-legaldocs', 'legaldoc_authority', true),
  ('legaldocs.authority.treat', 'm18-legaldocs', 'legaldoc_authority', false),
  ('legaldocs.citation.manage', 'm18-legaldocs', 'legaldoc_citation', false),
  ('legaldocs.precedent.read', 'm18-legaldocs', 'legaldoc_precedent', false),
  ('legaldocs.precedent.manage', 'm18-legaldocs', 'legaldoc_precedent', false),
  ('legaldocs.opinion.read', 'm18-legaldocs', 'legaldoc_opinion', false),
  ('legaldocs.opinion.manage', 'm18-legaldocs', 'legaldoc_opinion', true),
  ('legaldocs.opinion.approve', 'm18-legaldocs', 'legaldoc_opinion', true),
  ('legaldocs.research.read', 'm18-legaldocs', 'legaldoc_research', false),
  ('legaldocs.research.manage', 'm18-legaldocs', 'legaldoc_research', false),
  ('legaldocs.template.read', 'm18-legaldocs', 'legaldoc_template', false),
  ('legaldocs.template.manage', 'm18-legaldocs', 'legaldoc_template', false),
  ('legaldocs.template.approve', 'm18-legaldocs', 'legaldoc_template', true),
  ('legaldocs.template.publish', 'm18-legaldocs', 'legaldoc_template', true),
  ('legaldocs.clause.read', 'm18-legaldocs', 'legaldoc_clause', false),
  ('legaldocs.clause.manage', 'm18-legaldocs', 'legaldoc_clause', false),
  ('legaldocs.clause.approve', 'm18-legaldocs', 'legaldoc_clause', true),
  ('legaldocs.clause.publish', 'm18-legaldocs', 'legaldoc_clause', true),
  ('legaldocs.reference.read', 'm18-legaldocs', 'legaldoc_reference', false),
  ('legaldocs.reference.manage', 'm18-legaldocs', 'legaldoc_reference', false),
  ('legaldocs.relationship.read', 'm18-legaldocs', 'legaldoc_relationship', false),
  ('legaldocs.relationship.manage', 'm18-legaldocs', 'legaldoc_relationship', false),
  ('legaldocs.review.read', 'm18-legaldocs', 'legaldoc_review', false),
  ('legaldocs.review.manage', 'm18-legaldocs', 'legaldoc_review', false),
  ('legaldocs.tag.manage', 'm18-legaldocs', 'legaldoc_tag', false),
  ('legaldocs.confidential.read', 'm18-legaldocs', 'legaldoc_knowledge', true),
  ('legaldocs.privileged.read', 'm18-legaldocs', 'legaldoc_note', true),
  ('legaldocs.privileged.create', 'm18-legaldocs', 'legaldoc_note', true),
  ('legaldocs.analytics.read', 'm18-legaldocs', 'legaldoc_analytics', false),
  ('legaldocs.analytics.export', 'm18-legaldocs', 'legaldoc_analytics', true),
  ('legaldocs.platform.administer', 'm18-legaldocs', 'legaldoc_engine', true);

-- legaldoc_taxonomy — configurable classification (practice area / jurisdiction / legal topic / document type /
-- tag). VALUES are tenant data; non-destructively retired via `active`. One active per (tenant, kind, code).
CREATE TABLE legaldoc_taxonomy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL, code text NOT NULL, label text NOT NULL, parent_code text, jurisdiction text, description text,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legaldoc_taxonomy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_taxonomy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_taxonomy_kind_ck CHECK (kind IN ('practice_area','jurisdiction','legal_topic','document_type','tag')),
  CONSTRAINT legaldoc_taxonomy_optlock_ck CHECK (version >= 1));
ALTER TABLE legaldoc_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_taxonomy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_taxonomy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legaldoc_taxonomy_one_active ON legaldoc_taxonomy (tenant_id, kind, code) WHERE active;

-- legaldoc_knowledge — the core legal knowledge record. PUBLISHABLE lifecycle; versioned via supersession.
-- SENSITIVE `abstract` (legal analysis). Maker-checker: approved_by <> submitted_by.
CREATE TABLE legaldoc_knowledge (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  knowledge_number text NOT NULL, knowledge_code text NOT NULL, version_number integer NOT NULL DEFAULT 1,
  knowledge_type text NOT NULL, title text NOT NULL, summary text, abstract text,
  practice_area text, jurisdiction text, authority_level text, confidentiality text NOT NULL DEFAULT 'confidential',
  privileged boolean NOT NULL DEFAULT false, privilege_level text NOT NULL DEFAULT 'none', risk_level text,
  source text, source_reference text, owner uuid, reviewer uuid, approver uuid,
  publication_date date, effective_date date, review_date date, expiry_date date,
  status text NOT NULL DEFAULT 'draft', supersedes_id uuid, superseded_by_id uuid,
  submitted_by uuid, submitted_at timestamptz, approved_by uuid, approved_at timestamptz, published_at timestamptz,
  content_hash text, escalation_ref uuid, workflow_instance_ref uuid,
  correlation_id uuid NOT NULL, causation_id uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legaldoc_knowledge_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_knowledge_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_knowledge_number_key UNIQUE (tenant_id, knowledge_number),
  CONSTRAINT legaldoc_knowledge_ver_key UNIQUE (tenant_id, knowledge_code, version_number),
  CONSTRAINT legaldoc_knowledge_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legaldoc_knowledge_priv_ck CHECK (privilege_level IN ('none','work_product','attorney_client','litigation_privilege')),
  CONSTRAINT legaldoc_knowledge_status_ck CHECK (status IN ('draft','under_review','changes_requested','approved','published','superseded','withdrawn','archived','reopened')),
  CONSTRAINT legaldoc_knowledge_sod_ck CHECK (approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by),
  CONSTRAINT legaldoc_knowledge_optlock_ck CHECK (version >= 1));
ALTER TABLE legaldoc_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_knowledge FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_knowledge
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legaldoc_knowledge_idem_key ON legaldoc_knowledge (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX legaldoc_knowledge_one_published ON legaldoc_knowledge (tenant_id, knowledge_code) WHERE status = 'published';
CREATE INDEX legaldoc_knowledge_search ON legaldoc_knowledge (tenant_id, status, knowledge_type);
CREATE INDEX legaldoc_knowledge_area ON legaldoc_knowledge (tenant_id, practice_area, jurisdiction);

-- legaldoc_status_history — append-only lifecycle transition evidence.
CREATE TABLE legaldoc_status_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), knowledge_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legaldoc_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_status_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_status_history_kn_fkey FOREIGN KEY (tenant_id, knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id));
ALTER TABLE legaldoc_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_status_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_status_history_by_kn ON legaldoc_status_history (tenant_id, knowledge_id);

-- legaldoc_assignment_history — append-only owner/reviewer/approver assignment evidence.
CREATE TABLE legaldoc_assignment_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), knowledge_id uuid NOT NULL,
  kind text NOT NULL, ref uuid, reason text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legaldoc_assignment_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_assignment_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_assignment_history_kn_fkey FOREIGN KEY (tenant_id, knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id));
ALTER TABLE legaldoc_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_assignment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_assignment_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_assignment_history_by_kn ON legaldoc_assignment_history (tenant_id, knowledge_id);

-- legaldoc_authority — a legal authority / citation (statute, case law, regulation, opinion, ...).
CREATE TABLE legaldoc_authority (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  authority_type text NOT NULL, title text NOT NULL, citation text, jurisdiction text, issuing_body text, court text,
  decision_date date, effective_date date, authority_level text, status text NOT NULL DEFAULT 'active',
  treatment text, relevance text, source_reference text, document_ref uuid, notes text,
  confidentiality text NOT NULL DEFAULT 'standard',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legaldoc_authority_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_authority_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_authority_type_ck CHECK (authority_type IN ('statute','regulation','regulatory_circular','case_law','constitutional_provision','policy','internal_opinion','external_opinion','contractual_authority','standard_reference')),
  CONSTRAINT legaldoc_authority_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legaldoc_authority_optlock_ck CHECK (version >= 1));
ALTER TABLE legaldoc_authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_authority FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_authority
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_authority_search ON legaldoc_authority (tenant_id, authority_type, jurisdiction);

-- legaldoc_authority_treatment — append-only treatment history (followed / distinguished / overruled / ...).
CREATE TABLE legaldoc_authority_treatment (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), authority_id uuid NOT NULL,
  treatment text NOT NULL, by_authority_ref uuid, treated_by uuid, note text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legaldoc_authority_treatment_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_authority_treatment_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_authority_treatment_ck CHECK (treatment IN ('followed','applied','distinguished','overruled','repealed','amended','superseded','persuasive','binding')),
  CONSTRAINT legaldoc_authority_treatment_auth_fkey FOREIGN KEY (tenant_id, authority_id) REFERENCES legaldoc_authority (tenant_id, id));
ALTER TABLE legaldoc_authority_treatment ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_authority_treatment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_authority_treatment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_authority_treatment_by_auth ON legaldoc_authority_treatment (tenant_id, authority_id);

-- legaldoc_precedent — a precedent record. `holding` is SENSITIVE legal analysis.
CREATE TABLE legaldoc_precedent (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL, summary text, court text, decision_date date, holding text, principle text, jurisdiction text,
  document_ref uuid, related_authority uuid, status text NOT NULL DEFAULT 'active', confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legaldoc_precedent_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_precedent_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_precedent_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legaldoc_precedent_optlock_ck CHECK (version >= 1));
ALTER TABLE legaldoc_precedent ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_precedent FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_precedent
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_precedent_by_jur ON legaldoc_precedent (tenant_id, jurisdiction);

-- legaldoc_opinion — a legal opinion. PRIVILEGED: conclusion/recommendation are SENSITIVE. Maker-checker approval.
CREATE TABLE legaldoc_opinion (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL, question text, conclusion text, risk_rating text, recommendation text, jurisdiction text,
  author uuid, approval_status text NOT NULL DEFAULT 'draft', approved_by uuid, approved_at timestamptz,
  document_ref uuid, related_matter uuid, confidentiality text NOT NULL DEFAULT 'privileged',
  privilege_level text NOT NULL DEFAULT 'attorney_client',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legaldoc_opinion_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_opinion_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_opinion_approval_ck CHECK (approval_status IN ('draft','approved','rejected')),
  CONSTRAINT legaldoc_opinion_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legaldoc_opinion_priv_ck CHECK (privilege_level IN ('none','work_product','attorney_client','litigation_privilege')),
  CONSTRAINT legaldoc_opinion_sod_ck CHECK (approved_by IS NULL OR author IS NULL OR approved_by <> author),
  CONSTRAINT legaldoc_opinion_optlock_ck CHECK (version >= 1));
ALTER TABLE legaldoc_opinion ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_opinion FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_opinion
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_opinion_by_matter ON legaldoc_opinion (tenant_id, related_matter);

-- legaldoc_research — a research note / memorandum. `findings` is SENSITIVE.
CREATE TABLE legaldoc_research (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL, question text, findings text, author uuid, jurisdiction text, practice_area text,
  document_ref uuid, status text NOT NULL DEFAULT 'draft', confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legaldoc_research_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_research_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_research_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legaldoc_research_optlock_ck CHECK (version >= 1));
ALTER TABLE legaldoc_research ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_research FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_research
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_research_by_area ON legaldoc_research (tenant_id, practice_area);

-- legaldoc_template — a versioned, immutable-after-publish document template (content in m09). Maker-checker.
CREATE TABLE legaldoc_template (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_code text NOT NULL, version_number integer NOT NULL DEFAULT 1, category text, title text NOT NULL,
  description text, jurisdiction text, practice_area text, content_ref uuid, guidance text,
  status text NOT NULL DEFAULT 'draft', content_hash text, submitted_by uuid, submitted_at timestamptz,
  approved_by uuid, approved_at timestamptz, published_at timestamptz, supersedes_id uuid, superseded_by_id uuid,
  confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legaldoc_template_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_template_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_template_ver_key UNIQUE (tenant_id, template_code, version_number),
  CONSTRAINT legaldoc_template_status_ck CHECK (status IN ('draft','under_review','changes_requested','approved','published','superseded','withdrawn','archived','reopened')),
  CONSTRAINT legaldoc_template_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legaldoc_template_sod_ck CHECK (approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by),
  CONSTRAINT legaldoc_template_optlock_ck CHECK (version >= 1));
ALTER TABLE legaldoc_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_template FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_template
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legaldoc_template_one_published ON legaldoc_template (tenant_id, template_code) WHERE status = 'published';
CREATE INDEX legaldoc_template_by_cat ON legaldoc_template (tenant_id, category);

-- legaldoc_clause — a versioned, immutable-after-publish clause (content in m09). Maker-checker.
CREATE TABLE legaldoc_clause (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  clause_code text NOT NULL, version_number integer NOT NULL DEFAULT 1, clause_kind text NOT NULL DEFAULT 'approved',
  title text NOT NULL, category text, jurisdiction text, practice_area text, guidance text, content_ref uuid,
  status text NOT NULL DEFAULT 'draft', content_hash text, submitted_by uuid, submitted_at timestamptz,
  approved_by uuid, approved_at timestamptz, published_at timestamptz, supersedes_id uuid, superseded_by_id uuid,
  confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legaldoc_clause_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_clause_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_clause_ver_key UNIQUE (tenant_id, clause_code, version_number),
  CONSTRAINT legaldoc_clause_kind_ck CHECK (clause_kind IN ('approved','alternative','fallback','prohibited','jurisdiction_specific','practice_area')),
  CONSTRAINT legaldoc_clause_status_ck CHECK (status IN ('draft','under_review','changes_requested','approved','published','superseded','withdrawn','archived','reopened')),
  CONSTRAINT legaldoc_clause_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legaldoc_clause_sod_ck CHECK (approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by),
  CONSTRAINT legaldoc_clause_optlock_ck CHECK (version >= 1));
ALTER TABLE legaldoc_clause ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_clause FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_clause
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legaldoc_clause_one_published ON legaldoc_clause (tenant_id, clause_code) WHERE status = 'published';
CREATE INDEX legaldoc_clause_by_kind ON legaldoc_clause (tenant_id, clause_kind, category);

-- legaldoc_clause_relation — clause dependency / conflict graph (composite FK to clause; self-edge rejected).
CREATE TABLE legaldoc_clause_relation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_clause_id uuid NOT NULL, to_clause_id uuid NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legaldoc_clause_relation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_clause_relation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_clause_relation_kind_ck CHECK (kind IN ('depends_on','conflicts_with','alternative_to','fallback_for')),
  CONSTRAINT legaldoc_clause_relation_noself_ck CHECK (from_clause_id <> to_clause_id),
  CONSTRAINT legaldoc_clause_relation_optlock_ck CHECK (version >= 1),
  CONSTRAINT legaldoc_clause_relation_from_fkey FOREIGN KEY (tenant_id, from_clause_id) REFERENCES legaldoc_clause (tenant_id, id),
  CONSTRAINT legaldoc_clause_relation_to_fkey FOREIGN KEY (tenant_id, to_clause_id) REFERENCES legaldoc_clause (tenant_id, id));
ALTER TABLE legaldoc_clause_relation ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_clause_relation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_clause_relation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legaldoc_clause_relation_active_key ON legaldoc_clause_relation (tenant_id, from_clause_id, to_clause_id, kind) WHERE status = 'active';

-- legaldoc_reference — an OPAQUE cross-module / document reference from a knowledge record. m18 never reads the
-- target module's tables; `ref_type` records which module the target id belongs to (ADR-075).
CREATE TABLE legaldoc_reference (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), knowledge_id uuid NOT NULL,
  ref_type text NOT NULL, target_id text NOT NULL, label text, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legaldoc_reference_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_reference_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_reference_type_ck CHECK (ref_type IN ('document','matter','litigation','recovery','authority','precedent','external')),
  CONSTRAINT legaldoc_reference_optlock_ck CHECK (version >= 1),
  CONSTRAINT legaldoc_reference_kn_fkey FOREIGN KEY (tenant_id, knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id));
ALTER TABLE legaldoc_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_reference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_reference_by_kn ON legaldoc_reference (tenant_id, knowledge_id);
CREATE INDEX legaldoc_reference_by_target ON legaldoc_reference (tenant_id, ref_type, target_id);

-- legaldoc_relationship — knowledge-to-knowledge relationship (composite FK; self-edge rejected; active-unique).
CREATE TABLE legaldoc_relationship (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_knowledge_id uuid NOT NULL, to_knowledge_id uuid NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legaldoc_relationship_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_relationship_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_relationship_kind_ck CHECK (kind IN ('supersedes','related_to','cites','derived_from','duplicate_of','contradicts','refines')),
  CONSTRAINT legaldoc_relationship_noself_ck CHECK (from_knowledge_id <> to_knowledge_id),
  CONSTRAINT legaldoc_relationship_optlock_ck CHECK (version >= 1),
  CONSTRAINT legaldoc_relationship_from_fkey FOREIGN KEY (tenant_id, from_knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id),
  CONSTRAINT legaldoc_relationship_to_fkey FOREIGN KEY (tenant_id, to_knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id));
ALTER TABLE legaldoc_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_relationship FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_relationship
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legaldoc_relationship_active_key ON legaldoc_relationship (tenant_id, from_knowledge_id, to_knowledge_id, kind) WHERE status = 'active';

-- legaldoc_review — a periodic review / expiry / renewal deadline for a knowledge record. Deterministic overdue.
CREATE TABLE legaldoc_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), knowledge_id uuid NOT NULL,
  review_type text NOT NULL, start_at timestamptz, due_at timestamptz NOT NULL, rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  warn_window_ms bigint, status text NOT NULL DEFAULT 'open', completed_at timestamptz, completed_by uuid, outcome text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legaldoc_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_review_type_ck CHECK (review_type IN ('periodic_review','expiry','renewal','authority_review','publication_review')),
  CONSTRAINT legaldoc_review_status_ck CHECK (status IN ('open','completed','overdue','waived','cancelled')),
  CONSTRAINT legaldoc_review_optlock_ck CHECK (version >= 1),
  CONSTRAINT legaldoc_review_kn_fkey FOREIGN KEY (tenant_id, knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id));
ALTER TABLE legaldoc_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_review_by_kn ON legaldoc_review (tenant_id, knowledge_id);

-- legaldoc_tag — a taxonomy tag assignment on a knowledge record (one ACTIVE per knowledge+kind+code). Removal is
-- a soft delete (active=false) — 0002 grants no DELETE anywhere (ADR-010); the partial unique index frees the
-- (kind,code) slot on removal so the same tag can later be re-added.
CREATE TABLE legaldoc_tag (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), knowledge_id uuid NOT NULL,
  taxonomy_kind text NOT NULL, taxonomy_code text NOT NULL, label text, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legaldoc_tag_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_tag_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_tag_kn_fkey FOREIGN KEY (tenant_id, knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id));
ALTER TABLE legaldoc_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_tag FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_tag
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legaldoc_tag_key ON legaldoc_tag (tenant_id, knowledge_id, taxonomy_kind, taxonomy_code) WHERE active;

-- legaldoc_citation — a citation from a knowledge record to a legal authority (pinpoint reference).
CREATE TABLE legaldoc_citation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), knowledge_id uuid NOT NULL,
  authority_ref uuid, external_citation text, pinpoint text, note text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legaldoc_citation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_citation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_citation_optlock_ck CHECK (version >= 1),
  CONSTRAINT legaldoc_citation_kn_fkey FOREIGN KEY (tenant_id, knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id));
ALTER TABLE legaldoc_citation ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_citation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_citation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_citation_by_kn ON legaldoc_citation (tenant_id, knowledge_id);

-- legaldoc_note — append-only knowledge note; confidential/privileged/strategy require privilege.
CREATE TABLE legaldoc_note (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), knowledge_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general', headline text, content text NOT NULL,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legaldoc_note_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_note_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_note_type_ck CHECK (note_type IN ('general','confidential','privileged','strategy','review','management')),
  CONSTRAINT legaldoc_note_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legaldoc_note_kn_fkey FOREIGN KEY (tenant_id, knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id));
ALTER TABLE legaldoc_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_note FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_note_by_kn ON legaldoc_note (tenant_id, knowledge_id);

-- legaldoc_usage — append-only usage / quality-review analytics event for a knowledge record (safe dimensions).
CREATE TABLE legaldoc_usage (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), knowledge_id uuid NOT NULL,
  usage_type text NOT NULL, actor_ref uuid, context_ref text, note text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legaldoc_usage_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_usage_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_usage_kn_fkey FOREIGN KEY (tenant_id, knowledge_id) REFERENCES legaldoc_knowledge (tenant_id, id));
ALTER TABLE legaldoc_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_usage
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_usage_by_kn ON legaldoc_usage (tenant_id, knowledge_id);

-- legaldoc_approval_history — append-only maker-checker approval evidence across knowledge / template / clause /
-- opinion (entity_type + entity_id; submit / approve / reject / publish / withdraw / supersede).
CREATE TABLE legaldoc_approval_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_type text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL, decision text, by_user uuid, note text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legaldoc_approval_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legaldoc_approval_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legaldoc_approval_history_entity_ck CHECK (entity_type IN ('knowledge','template','clause','opinion')));
ALTER TABLE legaldoc_approval_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE legaldoc_approval_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legaldoc_approval_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legaldoc_approval_history_by_entity ON legaldoc_approval_history (tenant_id, entity_type, entity_id);
