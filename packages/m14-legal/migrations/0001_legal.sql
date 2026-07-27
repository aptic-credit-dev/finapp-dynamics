-- ---------------------------------------------------------------------------------------------------
-- M14-legal — enterprise legal matter management (Stage 4.1).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No table
-- grants DELETE (matters withdraw/close/archive by status; ADR-010). Status history, assignment history,
-- case-conversion evidence, counsel reports, outcomes and notes are append-only (INSERT + SELECT only, granted in
-- 0002); instructions, positions, opinions and settlements are controlled-update (accept/reject, supersession,
-- approval). RLS FORCE + these access rules are the ethical-walls substrate.
--
-- Matter types and SLA policies are versioned, immutable-after-publish `spec` JSON with one ACTIVE per code+scope
-- (ADR-061, mirrors m09/m13). Matter types, jurisdictions, courts/forums, statutes, firms and advocates are NOT
-- hardcoded — they are configurable per tenant. Legal positions/strategy, opinions, privileged notes, party
-- contacts and confidential settlement terms are sensitive: stored under RLS, redacted in APIs, and never placed
-- in events/audit (ADR-064). m14 publishes legal.lifecycle through the ONE outbox m06 owns; it never creates a
-- second outbox. Workflow/rules/escalation/notifications/documents are reached through m06/m07/m08/m09. Costs,
-- exposure and enforcement store finance + court REFERENCES only — no ledger, posting, payment, tax or
-- reconciliation (ADR-063). Litigation/recovery/legal-docs internals are m16/m17/m18: NOT owned here. Legal AI is
-- m26: NOT implemented here. The M13 -> M14 conversion is idempotent (one matter per source case).
-- ---------------------------------------------------------------------------------------------------

-- Seed m14's permissions into the global permission catalogue (owned by m02). No vague `legal.admin`; sensitive
-- reads + approvals + configuration are individually privileged (ADR-061).
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('legal.matter.read', 'm14-legal', 'legal_matter', false),
  ('legal.matter.create', 'm14-legal', 'legal_matter', false),
  ('legal.matter.update', 'm14-legal', 'legal_matter', false),
  ('legal.matter.open', 'm14-legal', 'legal_matter', false),
  ('legal.matter.assign', 'm14-legal', 'legal_matter', false),
  ('legal.matter.reassign', 'm14-legal', 'legal_matter', false),
  ('legal.matter.resolve', 'm14-legal', 'legal_matter', false),
  ('legal.matter.close', 'm14-legal', 'legal_matter', false),
  ('legal.matter.reopen', 'm14-legal', 'legal_matter', true),
  ('legal.matter.archive', 'm14-legal', 'legal_matter', true),
  ('legal.conversion.accept', 'm14-legal', 'legal_case_conversion', false),
  ('legal.matter_type.read', 'm14-legal', 'legal_matter_type', false),
  ('legal.matter_type.manage', 'm14-legal', 'legal_matter_type', true),
  ('legal.sla_policy.read', 'm14-legal', 'legal_sla_policy', false),
  ('legal.sla_policy.manage', 'm14-legal', 'legal_sla_policy', true),
  ('legal.jurisdiction.read', 'm14-legal', 'legal_jurisdiction', false),
  ('legal.jurisdiction.manage', 'm14-legal', 'legal_jurisdiction', true),
  ('legal.instruction.read', 'm14-legal', 'legal_instruction', false),
  ('legal.instruction.create', 'm14-legal', 'legal_instruction', false),
  ('legal.instruction.accept', 'm14-legal', 'legal_instruction', true),
  ('legal.instruction.reject', 'm14-legal', 'legal_instruction', true),
  ('legal.party.read', 'm14-legal', 'legal_party', false),
  ('legal.party.manage', 'm14-legal', 'legal_party', false),
  ('legal.party_contact.read', 'm14-legal', 'legal_party', true),
  ('legal.activity.read', 'm14-legal', 'legal_activity', false),
  ('legal.activity.create', 'm14-legal', 'legal_activity', false),
  ('legal.activity.complete', 'm14-legal', 'legal_activity', false),
  ('legal.task.read', 'm14-legal', 'legal_task', false),
  ('legal.task.manage', 'm14-legal', 'legal_task', false),
  ('legal.pleading.read', 'm14-legal', 'legal_pleading', false),
  ('legal.pleading.manage', 'm14-legal', 'legal_pleading', false),
  ('legal.document.read', 'm14-legal', 'legal_pleading', false),
  ('legal.document.link', 'm14-legal', 'legal_pleading', false),
  ('legal.court_event.read', 'm14-legal', 'legal_court_event', false),
  ('legal.court_event.manage', 'm14-legal', 'legal_court_event', false),
  ('legal.deadline.read', 'm14-legal', 'legal_deadline', false),
  ('legal.deadline.manage', 'm14-legal', 'legal_deadline', false),
  ('legal.issue.read', 'm14-legal', 'legal_issue', false),
  ('legal.issue.manage', 'm14-legal', 'legal_issue', false),
  ('legal.position.read', 'm14-legal', 'legal_position', true),
  ('legal.position.manage', 'm14-legal', 'legal_position', true),
  ('legal.opinion.read', 'm14-legal', 'legal_opinion', false),
  ('legal.opinion.manage', 'm14-legal', 'legal_opinion', true),
  ('legal.research.read', 'm14-legal', 'legal_research_reference', false),
  ('legal.research.manage', 'm14-legal', 'legal_research_reference', false),
  ('legal.external_counsel.read', 'm14-legal', 'legal_external_counsel', false),
  ('legal.external_counsel.manage', 'm14-legal', 'legal_external_counsel', true),
  ('legal.counsel_report.read', 'm14-legal', 'legal_counsel_report', false),
  ('legal.counsel_report.manage', 'm14-legal', 'legal_counsel_report', false),
  ('legal.settlement.read', 'm14-legal', 'legal_settlement', false),
  ('legal.settlement.submit', 'm14-legal', 'legal_settlement', false),
  ('legal.settlement.approve', 'm14-legal', 'legal_settlement', true),
  ('legal.judgment.read', 'm14-legal', 'legal_outcome', false),
  ('legal.judgment.manage', 'm14-legal', 'legal_outcome', true),
  ('legal.appeal.read', 'm14-legal', 'legal_matter', false),
  ('legal.appeal.manage', 'm14-legal', 'legal_matter', true),
  ('legal.enforcement.read', 'm14-legal', 'legal_matter', false),
  ('legal.enforcement.manage', 'm14-legal', 'legal_matter', true),
  ('legal.cost.read', 'm14-legal', 'legal_cost_reference', false),
  ('legal.cost.manage', 'm14-legal', 'legal_cost_reference', true),
  ('legal.exposure.read', 'm14-legal', 'legal_matter', false),
  ('legal.exposure.manage', 'm14-legal', 'legal_matter', true),
  ('legal.confidential.read', 'm14-legal', 'legal_matter', true),
  ('legal.privileged.read', 'm14-legal', 'legal_note', true),
  ('legal.privileged.create', 'm14-legal', 'legal_note', true),
  ('legal.relationship.read', 'm14-legal', 'legal_relationship', false),
  ('legal.relationship.manage', 'm14-legal', 'legal_relationship', false),
  ('legal.analytics.read', 'm14-legal', 'legal_analytics', false),
  ('legal.analytics.export', 'm14-legal', 'legal_analytics', true),
  ('legal.platform.administer', 'm14-legal', 'legal_engine', true);

-- legal_matter_type — versioned, immutable-after-publish matter-type spec (one ACTIVE per code+scope).
CREATE TABLE legal_matter_type (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT legal_matter_type_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_matter_type_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_matter_type_ver_key UNIQUE (tenant_id, code, scope, version_number),
  CONSTRAINT legal_matter_type_scope_ck CHECK (scope IN ('tenant','platform')),
  CONSTRAINT legal_matter_type_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT legal_matter_type_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT legal_matter_type_optlock_ck CHECK (version >= 1));
ALTER TABLE legal_matter_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_matter_type FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_matter_type
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legal_matter_type_one_active ON legal_matter_type (tenant_id, code, scope) WHERE status = 'ACTIVE';

-- legal_sla_policy — versioned, immutable-after-publish SLA policy spec (one ACTIVE per code+scope).
CREATE TABLE legal_sla_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT legal_sla_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_sla_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_sla_policy_ver_key UNIQUE (tenant_id, code, scope, version_number),
  CONSTRAINT legal_sla_policy_scope_ck CHECK (scope IN ('tenant','platform')),
  CONSTRAINT legal_sla_policy_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT legal_sla_policy_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT legal_sla_policy_optlock_ck CHECK (version >= 1));
ALTER TABLE legal_sla_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_sla_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_sla_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legal_sla_policy_one_active ON legal_sla_policy (tenant_id, code, scope) WHERE status = 'ACTIVE';

-- legal_jurisdiction — configurable jurisdiction / court / tribunal / forum reference (mutable config). No Kenyan
-- forum is hardcoded; jurisdictions + forums are configured per tenant (G7).
CREATE TABLE legal_jurisdiction (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, name text NOT NULL, kind text NOT NULL DEFAULT 'court', country text, hierarchy text,
  parent_code text, station text, active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_jurisdiction_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_jurisdiction_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_jurisdiction_code_key UNIQUE (tenant_id, code),
  CONSTRAINT legal_jurisdiction_kind_ck CHECK (kind IN ('jurisdiction','court','tribunal','arbitration','mediation','regulatory','internal_disciplinary')),
  CONSTRAINT legal_jurisdiction_optlock_ck CHECK (version >= 1));
ALTER TABLE legal_jurisdiction ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_jurisdiction FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_jurisdiction
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- legal_matter — the core aggregate. Court/appeal/enforcement/exposure dimensions are inline; the 25-state
-- lifecycle is CHECK-constrained. Legal description + privileged references are sensitive.
CREATE TABLE legal_matter (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  matter_number text NOT NULL, matter_type_code text NOT NULL, matter_type_version integer,
  source text NOT NULL DEFAULT 'direct_instruction', source_case_id uuid, source_reference text, originating_module text,
  title text NOT NULL, summary text, legal_description text,
  jurisdiction text, forum text, station text, external_case_number text, court_reference text,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  legal_risk text, priority text NOT NULL DEFAULT 'normal',
  claim_amount_minor bigint, exposure_amount_minor bigint, currency text, cause_of_action text, relief_sought text,
  current_owner uuid, legal_team text, business_owner uuid, branch text, department text,
  workflow_instance_ref uuid, sla_policy_code text, escalation_ref uuid,
  status text NOT NULL DEFAULT 'draft', current_stage text,
  legal_hold boolean NOT NULL DEFAULT false, business_owner_informed boolean NOT NULL DEFAULT false,
  limitation_at timestamptz,
  appeal_status text, appeal_forum text, appeal_deadline timestamptz,
  enforcement_stage text NOT NULL DEFAULT 'none', enforcement_recovered_minor bigint,
  resolution_summary text, closure_summary text, final_outcome text, residual_risk text,
  opened_at timestamptz, filed_at timestamptz, served_at timestamptz, resolved_at timestamptz, closed_at timestamptz,
  reopened_at timestamptz, archived_at timestamptz,
  correlation_id uuid NOT NULL, causation_id uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_matter_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_matter_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_matter_number_key UNIQUE (tenant_id, matter_number),
  CONSTRAINT legal_matter_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_matter_priority_ck CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT legal_matter_status_ck CHECK (status IN ('draft','instructed','opened','legal_review','awaiting_information',
    'pre_action','negotiation','mediation','arbitration','filed','awaiting_service','active_litigation','hearing',
    'judgment_pending','judgment_entered','appeal_pending','on_appeal','settlement_pending','settled','enforcement',
    'resolved','closed','reopened','withdrawn','archived')),
  CONSTRAINT legal_matter_optlock_ck CHECK (version >= 1));
ALTER TABLE legal_matter ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_matter FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_matter
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legal_matter_idem_key ON legal_matter (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX legal_matter_search ON legal_matter (tenant_id, status, matter_type_code);
CREATE INDEX legal_matter_owner ON legal_matter (tenant_id, current_owner);

-- legal_case_conversion — idempotency ledger for M13 case.converted_to_matter: exactly one matter per case (G2/G39).
CREATE TABLE legal_case_conversion (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_case_id uuid NOT NULL, matter_id uuid NOT NULL,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_case_conversion_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_case_conversion_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_case_conversion_case_key UNIQUE (tenant_id, source_case_id),
  CONSTRAINT legal_case_conversion_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_case_conversion ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_conversion FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_case_conversion
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- legal_matter_status_history — append-only transition evidence (G4).
CREATE TABLE legal_matter_status_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text,
  changed_by uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_matter_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_matter_status_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_matter_status_history_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_matter_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_matter_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_matter_status_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- legal_assignment_history — append-only assignment/reassignment evidence (G3).
CREATE TABLE legal_assignment_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  assigned_to_kind text NOT NULL, assigned_to_ref text NOT NULL, assigned_by uuid, reason text, rule_eval_id text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_assignment_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_assignment_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_assignment_history_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_assignment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_assignment_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- legal_instruction — formal legal instructions (G5). Append-only after acceptance; corrections via supersession.
CREATE TABLE legal_instruction (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  instruction_type text, instructing_department text, instructing_officer uuid, instruction_date date,
  summary text, scope text, desired_outcome text, urgency text, subject_reference text, required_action text,
  information_gaps text, responsible_officer uuid, acceptance_status text NOT NULL DEFAULT 'pending',
  accepted_by uuid, accepted_at timestamptz, rejection_reason text, clarification_requested text,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false, superseded_by uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_instruction_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_instruction_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_instruction_status_ck CHECK (acceptance_status IN ('pending','accepted','rejected','superseded')),
  CONSTRAINT legal_instruction_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_instruction_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_instruction_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_instruction ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_instruction FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_instruction
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_instruction_by_matter ON legal_instruction (tenant_id, matter_id);

-- legal_party — a party to the matter (G6). References a master record; contact detail is SENSITIVE.
CREATE TABLE legal_party (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  party_role text NOT NULL, entity_ref text, display_label text, representation_status text, advocate_ref text,
  law_firm_ref text, contact_ref text, authority text, confidentiality text NOT NULL DEFAULT 'standard',
  service_status text, relationship text, active boolean NOT NULL DEFAULT true, active_from timestamptz, active_to timestamptz,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_party_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_party_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_party_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_party_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_party_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_party FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_party
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_party_by_matter ON legal_party (tenant_id, matter_id);

-- legal_activity — legal activities (G13), incl. correspondence (letter/notice/email via subtype + direction).
-- Structured headline + free-text; full pleadings/correspondence live in m09 (document_refs are references only).
CREATE TABLE legal_activity (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  activity_type text NOT NULL, headline text NOT NULL, description text, occurred_at timestamptz, due_at timestamptz,
  assigned_to uuid, participants jsonb, direction text, party_ref uuid, status text NOT NULL DEFAULT 'open', outcome text,
  source text, confidentiality text NOT NULL DEFAULT 'standard', privileged boolean NOT NULL DEFAULT false,
  document_refs jsonb, task_ref uuid, court_event_ref uuid, issue_ref uuid, response_required boolean NOT NULL DEFAULT false,
  completed_at timestamptz, completed_by uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_activity_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_activity_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_activity_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_activity_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_activity_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_activity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_activity_by_matter ON legal_activity (tenant_id, matter_id);

-- legal_task — legal tasks (G14). Orchestration delegated to m06 (workflow_task_ref); m14 owns no workflow engine.
CREATE TABLE legal_task (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  task_type text NOT NULL, headline text NOT NULL, description text, owner uuid, team text, due_at timestamptz,
  priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'open', mandatory boolean NOT NULL DEFAULT false,
  completion_criteria text, depends_on uuid, workflow_task_ref uuid, escalation_policy_code text, document_refs jsonb,
  completed_at timestamptz, completed_by uuid, outcome text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_task_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_task_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_task_priority_ck CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT legal_task_status_ck CHECK (status IN ('open','in_progress','blocked','completed','cancelled')),
  CONSTRAINT legal_task_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_task_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_task FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_task
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_task_by_matter ON legal_task (tenant_id, matter_id);

-- legal_issue — legal issues / causes of action (G9). Citations + summaries only; no copyrighted texts.
CREATE TABLE legal_issue (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  issue_code text, category text, statement text NOT NULL, cause_of_action text, defence text, legal_basis_reference text,
  affected_party uuid, risk text, mandatory boolean NOT NULL DEFAULT false, position text, outcome text,
  status text NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_issue_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_issue_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_issue_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_issue_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_issue FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_issue
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_issue_by_matter ON legal_issue (tenant_id, matter_id);

-- legal_position — PRIVILEGED legal position + strategy (G10). Append-only via supersession; never in events/audit.
CREATE TABLE legal_position (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  position text, strategy text, strengths text, weaknesses text, exposure_summary text, recommended_approach text,
  alternative_options text, settlement_posture text, evidentiary_gaps text, procedural_risks text, limitation_risks text,
  counsel_recommendations text, reviewer uuid, approval_status text NOT NULL DEFAULT 'draft', effective_date date,
  superseded_by uuid, privileged boolean NOT NULL DEFAULT true, confidentiality text NOT NULL DEFAULT 'privileged',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_position_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_position_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_position_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_position_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_position FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_position
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_position_by_matter ON legal_position (tenant_id, matter_id);

-- legal_opinion — structured legal opinions (G11); full content in m09. Append-only; safe summary only.
CREATE TABLE legal_opinion (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  opinion_type text, question_presented text, summary_conclusion text, risk_rating text, recommendation text,
  author uuid, reviewer uuid, issue_date date, privileged boolean NOT NULL DEFAULT true,
  confidentiality text NOT NULL DEFAULT 'privileged', document_ref uuid, superseded boolean NOT NULL DEFAULT false,
  related_issue uuid, approval_status text NOT NULL DEFAULT 'draft',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_opinion_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_opinion_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_opinion_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_opinion_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_opinion ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_opinion FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_opinion
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_opinion_by_matter ON legal_opinion (tenant_id, matter_id);

-- legal_research_reference — statutes/cases/precedents (G12). Citations + summaries only; no copyrighted text.
CREATE TABLE legal_research_reference (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  reference_type text NOT NULL, citation text, title text, jurisdiction text, source text, relevance_summary text,
  related_issue uuid, document_ref uuid, verified boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_research_reference_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_research_reference_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_research_reference_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_research_reference_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_research_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_research_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_research_reference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_research_by_matter ON legal_research_reference (tenant_id, matter_id);

-- legal_pleading — pleading/filing metadata linked to m09 documents (G15). No bytes stored here.
CREATE TABLE legal_pleading (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  document_role text NOT NULL, document_ref uuid, draft_version integer, filing_status text NOT NULL DEFAULT 'draft',
  filing_date date, service_status text, service_date date, court_stamp_reference text, filed_by uuid, approved_by uuid,
  related_court_event uuid, related_issue uuid, privileged boolean NOT NULL DEFAULT false,
  confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_pleading_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_pleading_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_pleading_status_ck CHECK (filing_status IN ('draft','ready','filed','served','rejected','withdrawn')),
  CONSTRAINT legal_pleading_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_pleading_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_pleading_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_pleading ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_pleading FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_pleading
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_pleading_by_matter ON legal_pleading (tenant_id, matter_id);

-- legal_court_event — the court diary (G16). Calendar dispatch delegated to m06/m08; no production calendar.
CREATE TABLE legal_court_event (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  event_type text NOT NULL, title text, scheduled_at timestamptz, forum text, venue text, virtual_link_ref text,
  presiding_ref text, attendance_requirement text, attendees jsonb, preparation_tasks jsonb, document_refs jsonb,
  outcome text, order_direction text, next_action text, next_at timestamptz, status text NOT NULL DEFAULT 'scheduled',
  adjournment_reason text, cancellation_reason text, completed_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_court_event_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_court_event_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_court_event_type_ck CHECK (event_type IN ('mention','hearing','ruling','judgment','mediation','arbitration','settlement_conference','case_management_conference','directions','filing_deadline','service_deadline','appeal_deadline','regulatory_appearance')),
  CONSTRAINT legal_court_event_status_ck CHECK (status IN ('scheduled','adjourned','completed','cancelled')),
  CONSTRAINT legal_court_event_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_court_event_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_court_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_court_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_court_event
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_court_event_by_matter ON legal_court_event (tenant_id, matter_id);

-- legal_deadline — legal deadlines + LIMITATION (G17). Due dates computed deterministically (ADR-062).
CREATE TABLE legal_deadline (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  deadline_type text NOT NULL, source text, authority text, start_at timestamptz, due_at timestamptz NOT NULL,
  calculation_rule text, status text NOT NULL DEFAULT 'open', completed_at timestamptz, breached_at timestamptz,
  extension_to timestamptz, extension_reason text, extension_authority uuid, waived boolean NOT NULL DEFAULT false,
  waiver_authority uuid, linked_task uuid, linked_activity uuid, linked_court_event uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_deadline_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_deadline_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_deadline_type_ck CHECK (deadline_type IN ('filing','service','response','submissions','witness_statement','hearing_bundle','ruling','judgment','appeal','limitation','compliance','settlement','enforcement','regulatory','internal_instruction')),
  CONSTRAINT legal_deadline_status_ck CHECK (status IN ('open','completed','breached','waived','extended','cancelled')),
  CONSTRAINT legal_deadline_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_deadline_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_deadline ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_deadline FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_deadline
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_deadline_by_matter ON legal_deadline (tenant_id, matter_id);

-- legal_external_counsel — external counsel management (G23). References only; no bank details, no AP.
CREATE TABLE legal_external_counsel (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  law_firm_ref text, advocate_ref text, instruction_date date, instruction_scope text, engagement_reference text,
  fee_arrangement_reference text, reporting_frequency text, next_report_due date, status text NOT NULL DEFAULT 'instructed',
  internal_owner uuid, last_update_summary text, last_update_date date, performance_notes text,
  conflicts_confirmation_reference text, termination_date date,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_external_counsel_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_external_counsel_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_external_counsel_status_ck CHECK (status IN ('instructed','active','reporting','terminated')),
  CONSTRAINT legal_external_counsel_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_external_counsel_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_external_counsel ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_external_counsel FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_external_counsel
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_external_counsel_by_matter ON legal_external_counsel (tenant_id, matter_id);

-- legal_counsel_report — periodic counsel reports (G24). Append-only; full report in m09.
CREATE TABLE legal_counsel_report (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL, counsel_id uuid,
  reporting_period text, status_summary text, action_taken text, next_action text, risks text, court_dates text,
  documents_filed text, required_client_action text, costs_reference text, report_date date, author uuid, reviewer uuid,
  document_ref uuid, confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_counsel_report_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_counsel_report_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_counsel_report_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_counsel_report_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_counsel_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_counsel_report FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_counsel_report
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_counsel_report_by_matter ON legal_counsel_report (tenant_id, matter_id);

-- legal_cost_reference — legal cost REFERENCES only (G25). No GL, AP, posting, payment, tax or reconciliation.
CREATE TABLE legal_cost_reference (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  cost_type text, description text, amount_minor bigint, currency text, incurred_date date, external_counsel_ref uuid,
  invoice_reference text, approval_status text NOT NULL DEFAULT 'recorded', payment_reference text,
  recoverable boolean NOT NULL DEFAULT false, taxed_costs boolean NOT NULL DEFAULT false, budget_reference text, document_ref uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_cost_reference_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_cost_reference_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_cost_reference_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_cost_reference_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_cost_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_cost_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_cost_reference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_cost_by_matter ON legal_cost_reference (tenant_id, matter_id);

-- legal_settlement — legal settlements (G27). Confidential terms SENSITIVE. No payment execution; maker-checker.
CREATE TABLE legal_settlement (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  proposal text, counterproposal text, monetary_terms text, confidential_terms text, amount_minor bigint, currency text,
  non_monetary_terms text, settlement_authority text, approval_status text NOT NULL DEFAULT 'proposed', proposed_by uuid,
  approved_by uuid, approved_at timestamptz, effective_date date, confidentiality text NOT NULL DEFAULT 'confidential',
  settlement_document_ref uuid, payment_reference text, performance_status text, breach_status text, consent_order_reference text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT legal_settlement_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_settlement_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_settlement_approval_ck CHECK (approval_status IN ('proposed','approved','rejected')),
  CONSTRAINT legal_settlement_sod_ck CHECK (approved_by IS NULL OR approved_by <> proposed_by),
  CONSTRAINT legal_settlement_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_settlement_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_settlement_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_settlement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_settlement
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_settlement_by_matter ON legal_settlement (tenant_id, matter_id);

-- legal_outcome — judgment / ruling / award (G28). Append-only; full judgment in m09.
CREATE TABLE legal_outcome (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  outcome_type text NOT NULL, outcome_date date, summary text, amount_awarded_minor bigint, currency text,
  costs_awarded_minor bigint, orders text, compliance_requirements text, document_ref uuid, appealable boolean NOT NULL DEFAULT false,
  appeal_deadline date, responsible_officer uuid, status text NOT NULL DEFAULT 'recorded',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_outcome_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_outcome_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_outcome_type_ck CHECK (outcome_type IN ('ruling','interim_order','final_judgment','award','consent','dismissal','withdrawal','settlement','regulatory_determination')),
  CONSTRAINT legal_outcome_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_outcome FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_outcome
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_outcome_by_matter ON legal_outcome (tenant_id, matter_id);

-- legal_note — structured notes (G32). confidential/privileged/counsel/strategy content restricted by permission
-- and never emitted in events/audit (ADR-064). Append-only.
CREATE TABLE legal_note (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), matter_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general', headline text, content text NOT NULL, author uuid,
  privileged boolean NOT NULL DEFAULT false, confidentiality text NOT NULL DEFAULT 'standard',
  related_issue uuid, related_activity uuid, related_document uuid, superseded boolean NOT NULL DEFAULT false,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_note_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_note_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_note_type_ck CHECK (note_type IN ('general','confidential','privileged','counsel','strategy','management')),
  CONSTRAINT legal_note_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT legal_note_matter_fkey FOREIGN KEY (tenant_id, matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_note FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX legal_note_by_matter ON legal_note (tenant_id, matter_id);

-- legal_relationship — typed, tenant-scoped matter-to-matter links (G33). Self-edge rejected; active-unique.
CREATE TABLE legal_relationship (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_matter_id uuid NOT NULL, to_matter_id uuid NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT legal_relationship_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_relationship_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_relationship_kind_ck CHECK (kind IN ('converted_from_case','related_to','parent_of','child_of','appeal_of','enforcement_of','consolidated_with','precedent_for','duplicate_of','counterclaim_of','regulatory_referral_of')),
  CONSTRAINT legal_relationship_noself_ck CHECK (from_matter_id <> to_matter_id),
  CONSTRAINT legal_relationship_optlock_ck CHECK (version >= 1),
  CONSTRAINT legal_relationship_from_fkey FOREIGN KEY (tenant_id, from_matter_id) REFERENCES legal_matter (tenant_id, id),
  CONSTRAINT legal_relationship_to_fkey FOREIGN KEY (tenant_id, to_matter_id) REFERENCES legal_matter (tenant_id, id));
ALTER TABLE legal_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_relationship FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_relationship
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX legal_relationship_active_key ON legal_relationship (tenant_id, from_matter_id, to_matter_id, kind) WHERE status = 'active';
