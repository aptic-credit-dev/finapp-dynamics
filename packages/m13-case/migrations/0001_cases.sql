-- ---------------------------------------------------------------------------------------------------
-- M13-case — enterprise case management (Stage 3.2).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No table
-- grants DELETE (cases cancel/close/archive by status; ADR-010). Status history, assignment history, findings,
-- notes and handoff-intake evidence are append-only (INSERT + SELECT only, granted in 0002).
--
-- Case types and SLA policies are versioned, immutable-after-publish `spec` JSON with one ACTIVE per code+scope
-- (ADR-057, mirrors m09/m12). Case types, categories, party roles and legal jurisdictions/references are NOT
-- hardcoded — they are configurable per tenant. Party contacts, privileged notes, correspondence bodies and
-- confidential settlement terms are sensitive: stored under RLS, redacted in APIs, and never placed in
-- events/audit (ADR-060). m13 publishes case.lifecycle + case.converted_to_matter through the ONE outbox m06
-- owns; it never creates a second outbox. Workflow/rules/escalation/notifications/documents/feedback-handoff are
-- reached through m06/m07/m08/m09/m12. Settlement + recovery store finance REFERENCES only — no ledger, no
-- posting, no payment (ADR-059). Legal MATTERS are m14: m13 emits case.converted_to_matter, it does not own them.
-- ---------------------------------------------------------------------------------------------------

-- Seed m13's permissions into the global permission catalogue (owned by m02). No vague `cases.admin`; sensitive
-- reads + approvals + configuration are individually privileged (ADR-057).
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('cases.case.read', 'm13-case', 'case_record', false),
  ('cases.case.create', 'm13-case', 'case_record', false),
  ('cases.case.update', 'm13-case', 'case_record', false),
  ('cases.case.open', 'm13-case', 'case_record', false),
  ('cases.case.assign', 'm13-case', 'case_record', false),
  ('cases.case.reassign', 'm13-case', 'case_record', false),
  ('cases.case.triage', 'm13-case', 'case_record', false),
  ('cases.case.resolve', 'm13-case', 'case_record', false),
  ('cases.case.close', 'm13-case', 'case_record', false),
  ('cases.case.reopen', 'm13-case', 'case_record', true),
  ('cases.case.archive', 'm13-case', 'case_record', true),
  ('cases.handoff.accept', 'm13-case', 'case_handoff_intake', false),
  ('cases.intake.create', 'm13-case', 'case_record', false),
  ('cases.type.read', 'm13-case', 'case_type', false),
  ('cases.type.manage', 'm13-case', 'case_type', true),
  ('cases.sla_policy.read', 'm13-case', 'case_sla_policy', false),
  ('cases.sla_policy.manage', 'm13-case', 'case_sla_policy', true),
  ('cases.party.read', 'm13-case', 'case_party', false),
  ('cases.party.manage', 'm13-case', 'case_party', false),
  ('cases.party_contact.read', 'm13-case', 'case_party', true),
  ('cases.activity.read', 'm13-case', 'case_activity', false),
  ('cases.activity.create', 'm13-case', 'case_activity', false),
  ('cases.activity.complete', 'm13-case', 'case_activity', false),
  ('cases.task.read', 'm13-case', 'case_task', false),
  ('cases.task.manage', 'm13-case', 'case_task', false),
  ('cases.document.read', 'm13-case', 'case_document', false),
  ('cases.document.link', 'm13-case', 'case_document', false),
  ('cases.evidence.read', 'm13-case', 'case_evidence', false),
  ('cases.evidence.manage', 'm13-case', 'case_evidence', false),
  ('cases.evidence.verify', 'm13-case', 'case_evidence', true),
  ('cases.investigation.read', 'm13-case', 'case_investigation', false),
  ('cases.investigation.manage', 'm13-case', 'case_investigation', false),
  ('cases.finding.read', 'm13-case', 'case_finding', false),
  ('cases.finding.manage', 'm13-case', 'case_finding', false),
  ('cases.legal.read', 'm13-case', 'case_record', false),
  ('cases.legal.manage', 'm13-case', 'case_record', true),
  ('cases.hearing.read', 'm13-case', 'case_hearing', false),
  ('cases.hearing.manage', 'm13-case', 'case_hearing', false),
  ('cases.deadline.read', 'm13-case', 'case_deadline', false),
  ('cases.deadline.manage', 'm13-case', 'case_deadline', false),
  ('cases.decision.read', 'm13-case', 'case_decision', false),
  ('cases.decision.submit', 'm13-case', 'case_decision', false),
  ('cases.decision.approve', 'm13-case', 'case_decision', true),
  ('cases.settlement.read', 'm13-case', 'case_settlement', false),
  ('cases.settlement.manage', 'm13-case', 'case_settlement', false),
  ('cases.settlement.approve', 'm13-case', 'case_settlement', true),
  ('cases.recovery.read', 'm13-case', 'case_record', false),
  ('cases.recovery.manage', 'm13-case', 'case_record', true),
  ('cases.confidential.read', 'm13-case', 'case_record', true),
  ('cases.privileged_notes.read', 'm13-case', 'case_note', true),
  ('cases.privileged_notes.create', 'm13-case', 'case_note', true),
  ('cases.relationship.read', 'm13-case', 'case_relationship', false),
  ('cases.relationship.manage', 'm13-case', 'case_relationship', false),
  ('cases.analytics.read', 'm13-case', 'case_analytics', false),
  ('cases.analytics.export', 'm13-case', 'case_analytics', true),
  ('cases.platform.administer', 'm13-case', 'case_engine', true);

-- case_type — versioned, immutable-after-publish case-type spec (one ACTIVE per code+scope). Declarative config.
CREATE TABLE case_type (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT case_type_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_type_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_type_ver_key UNIQUE (tenant_id, code, scope, version_number),
  CONSTRAINT case_type_scope_ck CHECK (scope IN ('tenant','platform')),
  CONSTRAINT case_type_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT case_type_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT case_type_optlock_ck CHECK (version >= 1));
ALTER TABLE case_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_type FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_type
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX case_type_one_active ON case_type (tenant_id, code, scope) WHERE status = 'ACTIVE';

-- case_sla_policy — versioned, immutable-after-publish SLA policy spec (one ACTIVE per code+scope).
CREATE TABLE case_sla_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT case_sla_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_sla_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_sla_policy_ver_key UNIQUE (tenant_id, code, scope, version_number),
  CONSTRAINT case_sla_policy_scope_ck CHECK (scope IN ('tenant','platform')),
  CONSTRAINT case_sla_policy_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT case_sla_policy_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT case_sla_policy_optlock_ck CHECK (version >= 1));
ALTER TABLE case_sla_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_sla_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_sla_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX case_sla_policy_one_active ON case_sla_policy (tenant_id, code, scope) WHERE status = 'ACTIVE';

-- case_record — the core aggregate. Legal + recovery analytics dimensions are inline (legal_*/recovery_*); full
-- legal MATTERS live in m14 (m13 emits case.converted_to_matter). subject_ref/customer_contact-style detail is a
-- reference, never a duplicated master record. The 18-state lifecycle is CHECK-constrained.
CREATE TABLE case_record (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_number text NOT NULL, case_type_code text NOT NULL, case_type_version integer,
  title text NOT NULL, summary text, description text,
  source text NOT NULL DEFAULT 'manual', originating_module text, originating_entity_type text,
  originating_entity_id uuid, originating_feedback_id uuid,
  customer_ref text, subject_ref text, product_ref text, transaction_ref text,
  classification text, confidentiality text NOT NULL DEFAULT 'standard',
  severity text, priority text NOT NULL DEFAULT 'normal', risk_rating text,
  current_owner uuid, responsible_team text, branch text, department text,
  workflow_instance_ref uuid, sla_policy_code text, escalation_ref uuid,
  status text NOT NULL DEFAULT 'draft', current_stage text,
  legal_status text, court_reference text, limitation_at timestamptz,
  recovery_state text NOT NULL DEFAULT 'none', recovery_claimed_minor bigint, recovery_recovered_minor bigint, recovery_currency text,
  legal_hold boolean NOT NULL DEFAULT false, subject_informed boolean NOT NULL DEFAULT false,
  triage_status text, resolution_summary text, closure_summary text, residual_risk text,
  opened_at timestamptz, assigned_at timestamptz, resolved_at timestamptz, closed_at timestamptz,
  reopened_at timestamptz, archived_at timestamptz,
  correlation_id uuid NOT NULL, causation_id uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT case_record_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_record_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_record_number_key UNIQUE (tenant_id, case_number),
  CONSTRAINT case_record_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT case_record_priority_ck CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT case_record_status_ck CHECK (status IN ('draft','opened','triage','assigned','under_review',
    'investigation','awaiting_information','awaiting_internal_action','awaiting_external_action','hearing_scheduled',
    'in_litigation','under_recovery','decision_pending','resolved','closed','reopened','cancelled','archived')),
  CONSTRAINT case_record_optlock_ck CHECK (version >= 1));
ALTER TABLE case_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_record
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX case_record_idem_key ON case_record (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX case_record_search ON case_record (tenant_id, status, case_type_code);
CREATE INDEX case_record_owner ON case_record (tenant_id, current_owner);

-- case_handoff_intake — idempotency ledger for M12 handoff consumption: exactly one case per handoff (F4/F36).
CREATE TABLE case_handoff_intake (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  handoff_id uuid NOT NULL, feedback_id uuid, case_id uuid NOT NULL,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT case_handoff_intake_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_handoff_intake_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_handoff_intake_handoff_key UNIQUE (tenant_id, handoff_id),
  CONSTRAINT case_handoff_intake_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_handoff_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_handoff_intake FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_handoff_intake
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- case_status_history — append-only transition evidence (F3).
CREATE TABLE case_status_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text,
  changed_by uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_status_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_status_history_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_status_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- case_assignment_history — append-only assignment/reassignment/delegation evidence (F6).
CREATE TABLE case_assignment_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  assigned_to_kind text NOT NULL, assigned_to_ref text NOT NULL, assigned_by uuid, reason text,
  delegation boolean NOT NULL DEFAULT false, rule_eval_id text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_assignment_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_assignment_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_assignment_history_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_assignment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_assignment_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- case_party — a party attached to the case (F7). References a master record; contact detail is SENSITIVE.
CREATE TABLE case_party (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  party_type text NOT NULL, role text, entity_ref text, display_label text, contact_ref text,
  representation text, confidentiality text NOT NULL DEFAULT 'standard',
  relationship text, consent_authority text, active boolean NOT NULL DEFAULT true,
  active_from timestamptz, active_to timestamptz,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT case_party_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_party_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_party_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT case_party_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_party_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_party FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_party
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_party_by_case ON case_party (tenant_id, case_id);

-- case_activity — generic case activities (F8), including correspondence (letter/email/notice via subtype +
-- direction). Structured headline + free-text description (may hold text extracted from court docs); full
-- documents live in m09 (document_refs are references only).
CREATE TABLE case_activity (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  activity_type text NOT NULL, headline text NOT NULL, description text, occurred_at timestamptz,
  due_at timestamptz, assigned_to uuid, participants jsonb, direction text, party_ref uuid,
  status text NOT NULL DEFAULT 'open', outcome text, source text, confidentiality text NOT NULL DEFAULT 'standard',
  document_refs jsonb, task_ref uuid, hearing_ref uuid, response_required boolean NOT NULL DEFAULT false,
  completed_at timestamptz, completed_by uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT case_activity_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_activity_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_activity_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT case_activity_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_activity_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_activity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_activity_by_case ON case_activity (tenant_id, case_id);

-- case_task — case tasks (F9). Orchestration delegated to m06 (workflow_task_ref); m13 owns no workflow engine.
CREATE TABLE case_task (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  task_type text NOT NULL, headline text NOT NULL, description text, owner uuid, team text,
  due_at timestamptz, priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'open',
  mandatory boolean NOT NULL DEFAULT false, completion_criteria text, depends_on uuid,
  workflow_task_ref uuid, escalation_policy_code text, document_refs jsonb,
  completed_at timestamptz, completed_by uuid, outcome text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT case_task_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_task_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_task_priority_ck CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT case_task_status_ck CHECK (status IN ('open','in_progress','blocked','completed','cancelled')),
  CONSTRAINT case_task_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_task_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_task FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_task
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_task_by_case ON case_task (tenant_id, case_id);

-- case_issue — issues / allegations (F13). Independent finding + outcome per issue.
CREATE TABLE case_issue (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  issue_code text, category text, description text NOT NULL, severity text, affected_party uuid, respondent uuid,
  rule_reference text, mandatory boolean NOT NULL DEFAULT false, finding text, outcome text, remediation text,
  resolved boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT case_issue_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_issue_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_issue_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_issue_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_issue FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_issue
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_issue_by_case ON case_issue (tenant_id, case_id);

-- case_investigation — one structured investigation per case (F12).
CREATE TABLE case_investigation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  plan text, allegation text, scope text, investigator uuid, started_at timestamptz, target_completion_at timestamptz,
  substantiation text, contributing_factors text, root_cause text, recommended_action text,
  management_review text, completed_at timestamptz, status text NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT case_investigation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_investigation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_investigation_case_key UNIQUE (tenant_id, case_id),
  CONSTRAINT case_investigation_status_ck CHECK (status IN ('open','in_progress','completed','cancelled')),
  CONSTRAINT case_investigation_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_investigation_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_investigation ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_investigation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_investigation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- case_finding — append-only findings, per issue where applicable (F22). History preserved.
CREATE TABLE case_finding (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL, issue_id uuid,
  finding_type text NOT NULL, summary text, evidence_considered text, substantiation text,
  basis_reference text, investigator uuid, reviewer uuid, review_status text, confidentiality text NOT NULL DEFAULT 'standard',
  recommended_action text, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT case_finding_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_finding_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_finding_type_ck CHECK (finding_type IN ('substantiated','partially_substantiated','unsubstantiated','inconclusive','withdrawn','outside_scope')),
  CONSTRAINT case_finding_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id),
  CONSTRAINT case_finding_issue_fkey FOREIGN KEY (tenant_id, issue_id) REFERENCES case_issue (tenant_id, id));
ALTER TABLE case_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_finding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_finding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_finding_by_case ON case_finding (tenant_id, case_id);

-- case_document — references to m09 documents + case-document metadata (F10). No bytes stored here.
CREATE TABLE case_document (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  document_ref uuid NOT NULL, document_role text, evidence_category text, filing_date date, received_date date,
  served_date date, confidentiality text NOT NULL DEFAULT 'standard', privileged boolean NOT NULL DEFAULT false,
  verification_status text, source text, related_activity uuid, related_hearing uuid, exhibit_reference text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT case_document_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_document_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_document_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT case_document_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_document_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_document
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_document_by_case ON case_document (tenant_id, case_id);

-- case_evidence — append-only evidence register (F11). Integrity hash + custody STATUS only; no forensic
-- chain-of-custody certification is claimed. Document bytes remain in m09.
CREATE TABLE case_evidence (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  document_ref uuid, evidence_type text NOT NULL, description text, source text, custodian text,
  collected_by uuid, collected_at timestamptz, integrity_hash text, authenticity_status text,
  verification_status text NOT NULL DEFAULT 'unverified', admissibility_status text, custody_status text,
  confidentiality text NOT NULL DEFAULT 'standard', privileged boolean NOT NULL DEFAULT false,
  related_issue uuid, disposition_status text, verified_by uuid, verified_at timestamptz,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT case_evidence_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_evidence_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_evidence_type_ck CHECK (evidence_type IN ('document','physical','digital','testimony','photograph','recording','financial','other')),
  CONSTRAINT case_evidence_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT case_evidence_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_evidence_by_case ON case_evidence (tenant_id, case_id);

-- case_deadline — controlled deadline management (F16). Due dates computed deterministically (ADR-058).
CREATE TABLE case_deadline (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  deadline_type text NOT NULL, start_at timestamptz, due_at timestamptz NOT NULL, calculation_rule text,
  source text, authority text, status text NOT NULL DEFAULT 'open', completed_at timestamptz, breached_at timestamptz,
  extension_to timestamptz, extension_reason text, waived boolean NOT NULL DEFAULT false, waiver_authority uuid,
  linked_activity uuid, linked_task uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT case_deadline_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_deadline_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_deadline_type_ck CHECK (deadline_type IN ('response','filing','service','mention','hearing','appeal','limitation','payment','document_submission','regulatory_reporting','internal_review')),
  CONSTRAINT case_deadline_status_ck CHECK (status IN ('open','completed','breached','waived','extended','cancelled')),
  CONSTRAINT case_deadline_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_deadline_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_deadline ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_deadline FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_deadline
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_deadline_by_case ON case_deadline (tenant_id, case_id);

-- case_hearing — scheduled court / administrative events (F15). Calendar dispatch delegated to m06/m08.
CREATE TABLE case_hearing (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  hearing_type text NOT NULL, title text, scheduled_at timestamptz, venue text, virtual_link_ref text,
  court text, presiding_ref text, attendance_requirement text, attendees jsonb, preparation_tasks jsonb,
  document_refs jsonb, outcome text, next_action text, next_at timestamptz, status text NOT NULL DEFAULT 'scheduled',
  adjournment_reason text, completed_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT case_hearing_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_hearing_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_hearing_type_ck CHECK (hearing_type IN ('mention','hearing','ruling','judgment','mediation','arbitration','tribunal_session','regulatory_hearing','internal_disciplinary_hearing','meeting','filing_deadline','service_deadline')),
  CONSTRAINT case_hearing_status_ck CHECK (status IN ('scheduled','adjourned','completed','cancelled')),
  CONSTRAINT case_hearing_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_hearing_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_hearing ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_hearing FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_hearing
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_hearing_by_case ON case_hearing (tenant_id, case_id);

-- case_decision — append-only controlled decisions (F23). Maker-checker: submitter cannot approve (enforced in
-- the service + a submitted_by <> approved_by CHECK). Remedies/actions are captured on the decision (F24).
CREATE TABLE case_decision (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  decision_type text NOT NULL, summary text, reasons text, conditions text, remedy_type text, remedy_detail text,
  finance_reference text, supporting_documents jsonb, review_available boolean NOT NULL DEFAULT false,
  approval_status text NOT NULL DEFAULT 'submitted', submitted_by uuid, submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid, approved_at timestamptz, confidentiality text NOT NULL DEFAULT 'standard',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_decision_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_decision_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_decision_type_ck CHECK (decision_type IN ('accept','reject','uphold_complaint','dismiss_complaint','approve_settlement','reject_settlement','approve_legal_action','discontinue','approve_recovery','approve_closure','refer_externally')),
  CONSTRAINT case_decision_approval_ck CHECK (approval_status IN ('submitted','approved','rejected')),
  CONSTRAINT case_decision_sod_ck CHECK (approved_by IS NULL OR approved_by <> submitted_by),
  CONSTRAINT case_decision_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_decision_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_decision
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_decision_by_case ON case_decision (tenant_id, case_id);

-- case_settlement — settlement records (F25). Confidential terms are SENSITIVE. No payment execution; finance
-- references only. Maker-checker on approval.
CREATE TABLE case_settlement (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  settlement_type text, proposed_terms text, confidential_terms text, amount_minor bigint, currency text,
  non_monetary_terms text, approval_status text NOT NULL DEFAULT 'proposed', proposed_by uuid, approved_by uuid,
  approved_at timestamptz, effective_date date, payment_reference text, document_ref uuid,
  confidentiality text NOT NULL DEFAULT 'confidential', performance_status text, breach_status text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT case_settlement_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_settlement_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_settlement_approval_ck CHECK (approval_status IN ('proposed','approved','rejected')),
  CONSTRAINT case_settlement_sod_ck CHECK (approved_by IS NULL OR approved_by <> proposed_by),
  CONSTRAINT case_settlement_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_settlement_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_settlement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_settlement
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_settlement_by_case ON case_settlement (tenant_id, case_id);

-- case_note — structured notes (F29). confidential/privileged/legal_advice content is restricted by permission
-- and never emitted in events/audit (ADR-060).
CREATE TABLE case_note (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), case_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general', headline text, content text NOT NULL, author uuid,
  confidentiality text NOT NULL DEFAULT 'standard', privileged boolean NOT NULL DEFAULT false,
  related_activity uuid, related_issue uuid, related_document uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT case_note_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_note_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_note_type_ck CHECK (note_type IN ('general','internal','confidential','privileged','legal_advice')),
  CONSTRAINT case_note_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT case_note_case_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_note FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX case_note_by_case ON case_note (tenant_id, case_id);

-- case_relationship — typed, tenant-scoped case-to-case links (F30). Self-edge rejected; active-unique.
CREATE TABLE case_relationship (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_case_id uuid NOT NULL, to_case_id uuid NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT case_relationship_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT case_relationship_id_key UNIQUE (tenant_id, id),
  CONSTRAINT case_relationship_kind_ck CHECK (kind IN ('duplicate_of','related_to','parent_of','child_of','appeal_of','enforcement_of','investigation_of','complaint_from','consolidated_with')),
  CONSTRAINT case_relationship_noself_ck CHECK (from_case_id <> to_case_id),
  CONSTRAINT case_relationship_optlock_ck CHECK (version >= 1),
  CONSTRAINT case_relationship_from_fkey FOREIGN KEY (tenant_id, from_case_id) REFERENCES case_record (tenant_id, id),
  CONSTRAINT case_relationship_to_fkey FOREIGN KEY (tenant_id, to_case_id) REFERENCES case_record (tenant_id, id));
ALTER TABLE case_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_relationship FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_relationship
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX case_relationship_active_key ON case_relationship (tenant_id, from_case_id, to_case_id, kind) WHERE status = 'active';
