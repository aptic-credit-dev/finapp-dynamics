-- ---------------------------------------------------------------------------------------------------
-- M16-litigation — enterprise litigation & adjudicative proceedings management (Stage 4.2).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No table
-- grants DELETE (proceedings withdraw/dismiss/conclude/close/archive by status; ADR-010). Referral evidence,
-- status history, assignment history, proceeding records, orders, outcomes and notes are append-only (INSERT +
-- SELECT only, granted in 0002). RLS FORCE + these access rules are the ethical-walls substrate.
--
-- Proceeding types and SLA policies are versioned, immutable-after-publish `spec` JSON with one ACTIVE per
-- code+scope (ADR-065, mirrors m09/m14). Proceeding types, jurisdictions, courts/tribunals/forums, statutes and
-- procedural rules are NOT hardcoded — they are configurable per tenant. Legal strategy, full pleadings, witness
-- statements, full submissions, private witness/party contacts and confidential order/outcome terms are
-- sensitive: stored under RLS, redacted in APIs, and never placed in events/audit (ADR-068). m16 publishes
-- litigation.lifecycle through the ONE outbox m06 owns; it never creates a second outbox. Workflow/rules/
-- escalation/notifications/documents are reached through m06/m07/m08/m09. Costs store court + finance REFERENCES
-- only — no ledger, posting, payment, tax or reconciliation (ADR-067). Recovery/enforcement internals are m17;
-- legal knowledge is m18: NOT owned here (m16 emits only safe boundary signals). The M14 -> M16 referral is
-- idempotent (one proceeding per referral key; a matter may have several proceedings). m16 never reads m14 tables.
-- ---------------------------------------------------------------------------------------------------

-- Seed m16's permissions into the global permission catalogue (owned by m02). No vague `litigation.admin`;
-- sensitive reads + approvals + configuration are individually privileged (ADR-065).
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('litigation.proceeding.read', 'm16-litigation', 'litigation_proceeding', false),
  ('litigation.proceeding.create', 'm16-litigation', 'litigation_proceeding', false),
  ('litigation.proceeding.update', 'm16-litigation', 'litigation_proceeding', false),
  ('litigation.proceeding.assign', 'm16-litigation', 'litigation_proceeding', false),
  ('litigation.proceeding.reassign', 'm16-litigation', 'litigation_proceeding', false),
  ('litigation.proceeding.conclude', 'm16-litigation', 'litigation_proceeding', false),
  ('litigation.proceeding.close', 'm16-litigation', 'litigation_proceeding', false),
  ('litigation.proceeding.reopen', 'm16-litigation', 'litigation_proceeding', true),
  ('litigation.proceeding.archive', 'm16-litigation', 'litigation_proceeding', true),
  ('litigation.referral.accept', 'm16-litigation', 'litigation_referral', false),
  ('litigation.proceeding_type.read', 'm16-litigation', 'litigation_proceeding_type', false),
  ('litigation.proceeding_type.manage', 'm16-litigation', 'litigation_proceeding_type', true),
  ('litigation.sla_policy.read', 'm16-litigation', 'litigation_sla_policy', false),
  ('litigation.sla_policy.manage', 'm16-litigation', 'litigation_sla_policy', true),
  ('litigation.party.read', 'm16-litigation', 'litigation_party', false),
  ('litigation.party.manage', 'm16-litigation', 'litigation_party', false),
  ('litigation.party_contact.read', 'm16-litigation', 'litigation_party', true),
  ('litigation.claim.read', 'm16-litigation', 'litigation_claim', false),
  ('litigation.claim.manage', 'm16-litigation', 'litigation_claim', false),
  ('litigation.filing.read', 'm16-litigation', 'litigation_filing', false),
  ('litigation.filing.manage', 'm16-litigation', 'litigation_filing', false),
  ('litigation.filing.approve', 'm16-litigation', 'litigation_filing', true),
  ('litigation.service.read', 'm16-litigation', 'litigation_service', false),
  ('litigation.service.manage', 'm16-litigation', 'litigation_service', false),
  ('litigation.service.verify', 'm16-litigation', 'litigation_service', true),
  ('litigation.appearance.read', 'm16-litigation', 'litigation_appearance', false),
  ('litigation.appearance.manage', 'm16-litigation', 'litigation_appearance', false),
  ('litigation.appearance.complete', 'm16-litigation', 'litigation_appearance', false),
  ('litigation.witness.read', 'm16-litigation', 'litigation_witness', false),
  ('litigation.witness.manage', 'm16-litigation', 'litigation_witness', false),
  ('litigation.witness_contact.read', 'm16-litigation', 'litigation_witness', true),
  ('litigation.expert.read', 'm16-litigation', 'litigation_expert', false),
  ('litigation.expert.manage', 'm16-litigation', 'litigation_expert', true),
  ('litigation.exhibit.read', 'm16-litigation', 'litigation_exhibit', false),
  ('litigation.exhibit.manage', 'm16-litigation', 'litigation_exhibit', false),
  ('litigation.bundle.read', 'm16-litigation', 'litigation_bundle', false),
  ('litigation.bundle.manage', 'm16-litigation', 'litigation_bundle', false),
  ('litigation.bundle.approve', 'm16-litigation', 'litigation_bundle', true),
  ('litigation.order.read', 'm16-litigation', 'litigation_order', false),
  ('litigation.order.manage', 'm16-litigation', 'litigation_order', true),
  ('litigation.compliance.read', 'm16-litigation', 'litigation_compliance_obligation', false),
  ('litigation.compliance.manage', 'm16-litigation', 'litigation_compliance_obligation', true),
  ('litigation.outcome.read', 'm16-litigation', 'litigation_outcome', false),
  ('litigation.outcome.manage', 'm16-litigation', 'litigation_outcome', true),
  ('litigation.appeal.read', 'm16-litigation', 'litigation_appeal', false),
  ('litigation.appeal.manage', 'm16-litigation', 'litigation_appeal', true),
  ('litigation.deadline.read', 'm16-litigation', 'litigation_deadline', false),
  ('litigation.deadline.manage', 'm16-litigation', 'litigation_deadline', false),
  ('litigation.cost.read', 'm16-litigation', 'litigation_cost_reference', false),
  ('litigation.cost.manage', 'm16-litigation', 'litigation_cost_reference', true),
  ('litigation.confidential.read', 'm16-litigation', 'litigation_proceeding', true),
  ('litigation.privileged.read', 'm16-litigation', 'litigation_note', true),
  ('litigation.privileged.create', 'm16-litigation', 'litigation_note', true),
  ('litigation.analytics.read', 'm16-litigation', 'litigation_analytics', false),
  ('litigation.analytics.export', 'm16-litigation', 'litigation_analytics', true),
  ('litigation.platform.administer', 'm16-litigation', 'litigation_engine', true);

-- litigation_proceeding_type — versioned, immutable-after-publish proceeding-type spec (one ACTIVE per code+scope).
CREATE TABLE litigation_proceeding_type (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT litigation_proceeding_type_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_proceeding_type_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_proceeding_type_ver_key UNIQUE (tenant_id, code, scope, version_number),
  CONSTRAINT litigation_proceeding_type_scope_ck CHECK (scope IN ('tenant','platform')),
  CONSTRAINT litigation_proceeding_type_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT litigation_proceeding_type_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT litigation_proceeding_type_optlock_ck CHECK (version >= 1));
ALTER TABLE litigation_proceeding_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_proceeding_type FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_proceeding_type
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX litigation_proceeding_type_one_active ON litigation_proceeding_type (tenant_id, code, scope) WHERE status = 'ACTIVE';

-- litigation_sla_policy — versioned, immutable-after-publish SLA policy spec (one ACTIVE per code+scope).
CREATE TABLE litigation_sla_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT litigation_sla_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_sla_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_sla_policy_ver_key UNIQUE (tenant_id, code, scope, version_number),
  CONSTRAINT litigation_sla_policy_scope_ck CHECK (scope IN ('tenant','platform')),
  CONSTRAINT litigation_sla_policy_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT litigation_sla_policy_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT litigation_sla_policy_optlock_ck CHECK (version >= 1));
ALTER TABLE litigation_sla_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_sla_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_sla_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX litigation_sla_policy_one_active ON litigation_sla_policy (tenant_id, code, scope) WHERE status = 'ACTIVE';

-- litigation_proceeding — the core aggregate. A first-class litigation/adjudicative proceeding linked to an M14
-- matter (opaque reference; m16 never reads m14 tables). 30-state lifecycle. SENSITIVE summary/description.
CREATE TABLE litigation_proceeding (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  proceeding_number text NOT NULL, proceeding_type_code text NOT NULL, proceeding_type_version integer,
  source text NOT NULL DEFAULT 'direct_instruction', source_matter_id uuid, source_reference text, originating_module text,
  title text NOT NULL, summary text, description text,
  jurisdiction text, forum text, forum_type text, court text, station text, division text, external_case_number text,
  organization_role text, claim_amount_minor bigint, currency text,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  litigation_risk text, priority text NOT NULL DEFAULT 'normal',
  legal_owner uuid, litigation_team text, business_owner uuid, external_counsel_ref uuid,
  workflow_instance_ref uuid, sla_policy_code text, escalation_ref uuid,
  status text NOT NULL DEFAULT 'draft', procedural_stage text,
  legal_hold boolean NOT NULL DEFAULT false, matter_update_emitted boolean NOT NULL DEFAULT false,
  limitation_at timestamptz, appeal_status text, enforcement_referral_ready boolean NOT NULL DEFAULT false,
  final_outcome text, residual_obligations text,
  filed_at timestamptz, served_at timestamptz, commenced_at timestamptz, concluded_at timestamptz,
  closed_at timestamptz, reopened_at timestamptz, archived_at timestamptz,
  correlation_id uuid NOT NULL, causation_id uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_proceeding_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_proceeding_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_proceeding_number_key UNIQUE (tenant_id, proceeding_number),
  CONSTRAINT litigation_proceeding_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_proceeding_priority_ck CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT litigation_proceeding_status_ck CHECK (status IN ('draft','referred','under_review','approved_to_file',
    'awaiting_filing','filed','awaiting_service','served','awaiting_response','pleadings_open','case_management',
    'directions','pre_trial','hearing_scheduled','hearing','submissions','decision_pending','ruling_delivered',
    'judgment_delivered','appeal_pending','on_appeal','compliance','stayed','settled','withdrawn','dismissed',
    'concluded','closed','reopened','archived')),
  CONSTRAINT litigation_proceeding_optlock_ck CHECK (version >= 1));
ALTER TABLE litigation_proceeding ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_proceeding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_proceeding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX litigation_proceeding_idem_key ON litigation_proceeding (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX litigation_proceeding_search ON litigation_proceeding (tenant_id, status, proceeding_type_code);
CREATE INDEX litigation_proceeding_owner ON litigation_proceeding (tenant_id, legal_owner);
CREATE INDEX litigation_proceeding_matter ON litigation_proceeding (tenant_id, source_matter_id);

-- litigation_referral — idempotency ledger for the M14 matter referral: exactly one proceeding per referral key
-- (a matter may be referred several times, so the KEY is unique, not the matter id). Append-only.
CREATE TABLE litigation_referral (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  referral_key text NOT NULL, source_matter_id uuid NOT NULL, proceeding_id uuid NOT NULL,
  proceeding_type_code text, safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL, causation_id uuid, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT litigation_referral_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_referral_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_referral_key_key UNIQUE (tenant_id, referral_key),
  CONSTRAINT litigation_referral_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_referral ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_referral FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_referral
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- litigation_status_history — append-only lifecycle transition evidence.
CREATE TABLE litigation_status_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT litigation_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_status_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_status_history_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_status_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_status_history_by_proc ON litigation_status_history (tenant_id, proceeding_id);

-- litigation_assignment_history — append-only assignment / reassignment evidence.
CREATE TABLE litigation_assignment_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  kind text NOT NULL, ref uuid, reason text, rule_evaluation_id text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT litigation_assignment_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_assignment_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_assignment_history_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_assignment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_assignment_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_assignment_history_by_proc ON litigation_assignment_history (tenant_id, proceeding_id);

-- litigation_party — a party in the proceeding (reference to master data; contact redacted).
CREATE TABLE litigation_party (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  party_role text NOT NULL, entity_ref text, display_label text, representation_ref text, advocate_ref text,
  law_firm_ref text, lead_counsel_ref text, service_address_ref text, service_status text, authority text,
  contact_ref text, confidentiality text NOT NULL DEFAULT 'standard', active boolean NOT NULL DEFAULT true,
  active_from timestamptz, active_to timestamptz,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_party_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_party_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_party_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_party_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_party_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_party FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_party
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_party_by_proc ON litigation_party (tenant_id, proceeding_id);

-- litigation_claim — structured claim / prayer / defence. Full argument stays out of events/audit.
CREATE TABLE litigation_claim (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  claim_type text NOT NULL, statement text, cause_reference text, relief_sought text, amount_minor bigint, currency text,
  non_monetary_relief text, counterclaim boolean NOT NULL DEFAULT false, defence text, admission_status text,
  related_matter_issue uuid, risk text, status text NOT NULL DEFAULT 'open', outcome text,
  confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_claim_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_claim_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_claim_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_claim_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_claim_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_claim FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_claim
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_claim_by_proc ON litigation_claim (tenant_id, proceeding_id);

-- litigation_filing — filing metadata linked to m09 (no bytes). Maker-checker: approver <> preparer.
CREATE TABLE litigation_filing (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  filing_role text NOT NULL, document_ref uuid, document_version integer, filing_status text NOT NULL DEFAULT 'draft',
  filed_date date, filed_by uuid, prepared_by uuid, approved_by uuid, approved_at timestamptz,
  receiving_registry text, filing_reference text, court_stamp_reference text, rejection_reason text,
  related_deadline uuid, related_appearance uuid, privileged boolean NOT NULL DEFAULT false,
  confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_filing_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_filing_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_filing_status_ck CHECK (filing_status IN ('draft','review','approved','ready','filed','served','rejected','withdrawn')),
  CONSTRAINT litigation_filing_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_filing_sod_ck CHECK (approved_by IS NULL OR prepared_by IS NULL OR approved_by <> prepared_by),
  CONSTRAINT litigation_filing_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_filing_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_filing ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_filing FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_filing
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_filing_by_proc ON litigation_filing (tenant_id, proceeding_id);

-- litigation_service — service-of-process record; controlled single-winner verification.
CREATE TABLE litigation_service (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  item_served text, party_ref uuid, service_method text, service_date date, location_reference text, served_by uuid,
  recipient text, acknowledgment text, certificate_document_ref uuid, deemed_basis text,
  service_status text NOT NULL DEFAULT 'pending', failure_reason text, next_attempt_at timestamptz,
  service_deadline uuid, verification_status text NOT NULL DEFAULT 'unverified', verified_by uuid, verified_at timestamptz,
  confidentiality text NOT NULL DEFAULT 'standard',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_service_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_service_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_service_status_ck CHECK (service_status IN ('pending','attempted','served','failed','deemed','waived')),
  CONSTRAINT litigation_service_verif_ck CHECK (verification_status IN ('unverified','verified','rejected')),
  CONSTRAINT litigation_service_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_service_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_service_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_service FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_service
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_service_by_proc ON litigation_service (tenant_id, proceeding_id);

-- litigation_appearance — structured proceeding appearance / diary event.
CREATE TABLE litigation_appearance (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  appearance_type text NOT NULL, scheduled_at timestamptz, forum text, venue text, virtual_link_ref text,
  presiding_ref text, panel_members text, attendance_requirements text, purpose text,
  status text NOT NULL DEFAULT 'scheduled', outcome text, directions text, next_action text, next_at timestamptz,
  adjournment_reason text, document_refs jsonb NOT NULL DEFAULT '[]'::jsonb, confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_appearance_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_appearance_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_appearance_type_ck CHECK (appearance_type IN ('mention','directions','case_management_conference','pre_trial_conference','hearing','ruling','judgment','mediation','arbitration_session','settlement_conference','compliance_review','appeal_hearing')),
  CONSTRAINT litigation_appearance_status_ck CHECK (status IN ('scheduled','adjourned','completed','cancelled')),
  CONSTRAINT litigation_appearance_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_appearance_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_appearance_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_appearance ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_appearance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_appearance
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_appearance_by_proc ON litigation_appearance (tenant_id, proceeding_id);

-- litigation_proceeding_record — append-only record of what occurred at an appearance/hearing. Detail in m09.
CREATE TABLE litigation_proceeding_record (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL, appearance_id uuid,
  attendance text, submissions_summary text, evidence_taken text, applications_made text, objections text,
  directions text, orders_summary text, adjournment text, next_at timestamptz, legal_officer uuid,
  counsel_report_ref uuid, document_ref uuid, privileged boolean NOT NULL DEFAULT false,
  confidentiality text NOT NULL DEFAULT 'confidential', approval_status text NOT NULL DEFAULT 'draft',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT litigation_proceeding_record_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_proceeding_record_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_proceeding_record_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_proceeding_record_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_proceeding_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_proceeding_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_proceeding_record
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_proceeding_record_by_proc ON litigation_proceeding_record (tenant_id, proceeding_id);

-- litigation_witness — witness references + litigation-specific status. Private contacts separately permissioned.
CREATE TABLE litigation_witness (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  witness_ref text, witness_type text NOT NULL DEFAULT 'fact', role text, relevance text, statement_document_ref uuid,
  availability text, contact_ref text, attendance_status text, summons_status text, preparation_status text,
  examination_status text, protection_flag boolean NOT NULL DEFAULT false, assigned_counsel_ref uuid,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_witness_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_witness_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_witness_type_ck CHECK (witness_type IN ('fact','expert','character','hostile','rebuttal','corporate_representative')),
  CONSTRAINT litigation_witness_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_witness_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_witness_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_witness ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_witness FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_witness
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_witness_by_proc ON litigation_witness (tenant_id, proceeding_id);

-- litigation_expert — expert-witness metadata. No vendor management / payment.
CREATE TABLE litigation_expert (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  expert_ref text, expertise text, engagement_reference text, instruction_scope text, report_document_ref uuid,
  conflicts_confirmation_ref uuid, independence_declaration_ref uuid, report_due_date date, report_status text,
  attendance_status text, cost_reference text, internal_owner uuid,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_expert_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_expert_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_expert_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_expert_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_expert_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_expert ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_expert FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_expert
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_expert_by_proc ON litigation_expert (tenant_id, proceeding_id);

-- litigation_exhibit — exhibit metadata linked to m09/evidence references. No binary storage; no forensic claim.
CREATE TABLE litigation_exhibit (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  exhibit_number text, description text, source text, related_witness uuid, document_ref uuid, evidence_ref uuid,
  marked_status text, admitted_status text NOT NULL DEFAULT 'pending', admission_date date, chain_of_custody_ref uuid,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_exhibit_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_exhibit_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_exhibit_admitted_ck CHECK (admitted_status IN ('pending','marked','admitted','rejected','withdrawn')),
  CONSTRAINT litigation_exhibit_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_exhibit_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_exhibit_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_exhibit ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_exhibit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_exhibit
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_exhibit_by_proc ON litigation_exhibit (tenant_id, proceeding_id);

-- litigation_bundle — hearing-bundle metadata (contents remain in m09). Maker-checker: approver <> preparer.
CREATE TABLE litigation_bundle (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  bundle_type text, title text, bundle_version integer NOT NULL DEFAULT 1, index_document_ref uuid,
  compilation_status text NOT NULL DEFAULT 'draft', review_status text, approval_status text NOT NULL DEFAULT 'draft',
  filing_status text, service_status text, appearance_ref uuid, prepared_by uuid, reviewed_by uuid,
  approved_by uuid, approved_at timestamptz, privileged boolean NOT NULL DEFAULT false,
  confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_bundle_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_bundle_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_bundle_approval_ck CHECK (approval_status IN ('draft','review','approved','rejected')),
  CONSTRAINT litigation_bundle_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_bundle_sod_ck CHECK (approved_by IS NULL OR prepared_by IS NULL OR approved_by <> prepared_by),
  CONSTRAINT litigation_bundle_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_bundle_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_bundle FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_bundle
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_bundle_by_proc ON litigation_bundle (tenant_id, proceeding_id);

-- litigation_bundle_item — a document reference within a bundle (composite FK to the bundle).
CREATE TABLE litigation_bundle_item (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), bundle_id uuid NOT NULL,
  document_ref uuid, tab text, page_from integer, page_to integer, description text, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT litigation_bundle_item_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_bundle_item_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_bundle_item_bundle_fkey FOREIGN KEY (tenant_id, bundle_id) REFERENCES litigation_bundle (tenant_id, id));
ALTER TABLE litigation_bundle_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_bundle_item FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_bundle_item
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_bundle_item_by_bundle ON litigation_bundle_item (tenant_id, bundle_id);

-- litigation_order — append-only court order (operative terms metadata; full order in m09).
CREATE TABLE litigation_order (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  order_type text NOT NULL, order_date date, issuing_forum text, presiding_ref text, summary text, operative_terms text,
  affected_parties text, effective_date date, expiry_date date, compliance_deadline uuid, appeal_status text,
  document_ref uuid, status text NOT NULL DEFAULT 'active', privileged boolean NOT NULL DEFAULT false,
  confidentiality text NOT NULL DEFAULT 'confidential',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT litigation_order_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_order_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_order_type_ck CHECK (order_type IN ('interim_order','injunction','conservatory_order','stay','directions_order','disclosure_order','production_order','consent_order','costs_order','decree','warrant','final_order')),
  CONSTRAINT litigation_order_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_order_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_order FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_order
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_order_by_proc ON litigation_order (tenant_id, proceeding_id);

-- litigation_compliance_obligation — one or more obligations per order. Deterministic deadlines + m08 escalation.
CREATE TABLE litigation_compliance_obligation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL, order_id uuid,
  obligation text, responsible_ref uuid, affected_party text, due_date date, status text NOT NULL DEFAULT 'open',
  evidence_reference uuid, completion_date date, breach_date date, extension_to date, waiver text, waiver_authority uuid,
  escalation_ref uuid, outcome text, reviewer uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_compliance_obligation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_compliance_obligation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_compliance_obligation_status_ck CHECK (status IN ('open','in_progress','completed','breached','waived','extended')),
  CONSTRAINT litigation_compliance_obligation_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_compliance_obligation_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id),
  CONSTRAINT litigation_compliance_obligation_order_fkey FOREIGN KEY (tenant_id, order_id) REFERENCES litigation_order (tenant_id, id));
ALTER TABLE litigation_compliance_obligation ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_compliance_obligation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_compliance_obligation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_compliance_obligation_by_proc ON litigation_compliance_obligation (tenant_id, proceeding_id);

-- litigation_outcome — append-only ruling / judgment / award. Full decision in m09.
CREATE TABLE litigation_outcome (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  outcome_type text NOT NULL, outcome_date date, forum text, presiding_ref text, summary text, disposition text,
  amount_awarded_minor bigint, currency text, costs_awarded_minor bigint, orders_summary text,
  appealable boolean NOT NULL DEFAULT false, appeal_deadline timestamptz, document_ref uuid, status text NOT NULL DEFAULT 'recorded',
  privileged boolean NOT NULL DEFAULT false, confidentiality text NOT NULL DEFAULT 'confidential',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT litigation_outcome_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_outcome_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_outcome_type_ck CHECK (outcome_type IN ('ruling','interim_order','final_judgment','award','consent','dismissal','withdrawal','settlement','struck_out','regulatory_determination')),
  CONSTRAINT litigation_outcome_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_outcome_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_outcome FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_outcome
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_outcome_by_proc ON litigation_outcome (tenant_id, proceeding_id);

-- litigation_appeal — controlled appeal / review. One controlled relationship where required (no duplicate).
CREATE TABLE litigation_appeal (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  appeal_type text, forum text, approval_status text NOT NULL DEFAULT 'proposed', approved_by uuid, deadline timestamptz,
  filing_status text, appeal_number text, grounds_summary text, counsel_ref uuid, record_reference uuid,
  status text NOT NULL DEFAULT 'open', outcome text, linked_proceeding_id uuid, source_matter_id uuid,
  confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_appeal_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_appeal_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_appeal_approval_ck CHECK (approval_status IN ('proposed','approved','rejected')),
  CONSTRAINT litigation_appeal_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_appeal_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_appeal_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_appeal ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_appeal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_appeal
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX litigation_appeal_one_active ON litigation_appeal (tenant_id, proceeding_id) WHERE status IN ('open','proposed');
CREATE INDEX litigation_appeal_by_proc ON litigation_appeal (tenant_id, proceeding_id);

-- litigation_deadline — deterministic litigation deadlines (incl. limitation). Breach dispatch delegated to m06/m08.
CREATE TABLE litigation_deadline (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  deadline_type text NOT NULL, source text, authority text, start_at timestamptz, due_at timestamptz NOT NULL,
  rule jsonb NOT NULL DEFAULT '{}'::jsonb, business_calendar_ref text, warn_window_ms bigint,
  status text NOT NULL DEFAULT 'open', waived boolean NOT NULL DEFAULT false, completed_at timestamptz,
  related_filing uuid, related_service uuid, related_appearance uuid, related_order uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_deadline_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_deadline_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_deadline_type_ck CHECK (deadline_type IN ('filing','service','response','disclosure','witness_statement','expert_report','bundle','submissions','hearing','ruling','judgment','appeal','review','order_compliance','limitation','internal_preparation')),
  CONSTRAINT litigation_deadline_status_ck CHECK (status IN ('open','completed','breached','waived','extended','cancelled')),
  CONSTRAINT litigation_deadline_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_deadline_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_deadline ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_deadline FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_deadline
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_deadline_by_proc ON litigation_deadline (tenant_id, proceeding_id);

-- litigation_cost_reference — litigation cost REFERENCES only. No AP/GL/posting/payment/tax/reconciliation.
CREATE TABLE litigation_cost_reference (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  cost_type text, description text, amount_minor bigint, currency text, incurred_date date, counsel_reference text,
  invoice_reference text, approval_status text NOT NULL DEFAULT 'recorded', payment_reference text,
  recoverable boolean NOT NULL DEFAULT false, taxed boolean NOT NULL DEFAULT false, document_ref uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT litigation_cost_reference_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_cost_reference_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_cost_reference_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_cost_reference_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_cost_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_cost_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_cost_reference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_cost_reference_by_proc ON litigation_cost_reference (tenant_id, proceeding_id);

-- litigation_note — append-only litigation note; confidential/privileged/counsel/strategy require privilege.
CREATE TABLE litigation_note (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), proceeding_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general', headline text, content text NOT NULL, related_appearance uuid,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT litigation_note_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_note_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_note_type_ck CHECK (note_type IN ('general','confidential','privileged','counsel','strategy','management')),
  CONSTRAINT litigation_note_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT litigation_note_proc_fkey FOREIGN KEY (tenant_id, proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_note FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX litigation_note_by_proc ON litigation_note (tenant_id, proceeding_id);

-- litigation_relationship — typed proceeding relationships. Self-edge rejected; active-unique.
CREATE TABLE litigation_relationship (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_proceeding_id uuid NOT NULL, to_proceeding_id uuid NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT litigation_relationship_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT litigation_relationship_id_key UNIQUE (tenant_id, id),
  CONSTRAINT litigation_relationship_kind_ck CHECK (kind IN ('referred_from_matter','related_to','parent_of','child_of','appeal_of','review_of','consolidated_with','precedent_for','duplicate_of','counterclaim_in','enforcement_referral_of')),
  CONSTRAINT litigation_relationship_noself_ck CHECK (from_proceeding_id <> to_proceeding_id),
  CONSTRAINT litigation_relationship_optlock_ck CHECK (version >= 1),
  CONSTRAINT litigation_relationship_from_fkey FOREIGN KEY (tenant_id, from_proceeding_id) REFERENCES litigation_proceeding (tenant_id, id),
  CONSTRAINT litigation_relationship_to_fkey FOREIGN KEY (tenant_id, to_proceeding_id) REFERENCES litigation_proceeding (tenant_id, id));
ALTER TABLE litigation_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE litigation_relationship FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON litigation_relationship
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX litigation_relationship_active_key ON litigation_relationship (tenant_id, from_proceeding_id, to_proceeding_id, kind) WHERE status = 'active';
