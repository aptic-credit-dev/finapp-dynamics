-- ---------------------------------------------------------------------------------------------------
-- M12-feedback — enterprise feedback management (Stage 3.1).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No table
-- grants DELETE (records cancel/close by status; ADR-010). Contact attempts, answers, assignment history and
-- case-handoff evidence are append-only (INSERT + SELECT only, granted in 0002).
--
-- Questionnaires and SLA policies are versioned, immutable-after-publish `spec` JSON with one ACTIVE per code
-- (ADR-053/054, mirrors m09). Source transactions store NORMALIZED fields + a payload HASH — never the raw
-- external payload (ADR-055). Customer contacts + narratives are sensitive: stored under RLS, redacted in APIs,
-- and never placed in events/audit. m12 publishes feedback.lifecycle through the ONE outbox m06 owns; it never
-- creates a second outbox. Escalation/notifications/documents/workflow/rules are reached through m08/m09/m06/m07.
-- ---------------------------------------------------------------------------------------------------

-- Seed m12's permissions into the global permission catalogue (owned by m02). Privileged: queue assignment,
-- classification, close/reopen, assignment mgmt, resolution approval, SLA mgmt, escalation trigger,
-- questionnaire/category/SLA-policy/source admin, ingestion, case-handoff request, export, customer-contact
-- read, and the platform authority. There is no vague `feedback.admin` (ADR-052).
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('feedback.queue.read', 'm12-feedback', 'feedback_queue_item', false),
  ('feedback.queue.claim', 'm12-feedback', 'feedback_queue_item', false),
  ('feedback.queue.assign', 'm12-feedback', 'feedback_queue_item', true),
  ('feedback.record.read', 'm12-feedback', 'feedback_record', false),
  ('feedback.record.create', 'm12-feedback', 'feedback_record', false),
  ('feedback.record.capture', 'm12-feedback', 'feedback_record', false),
  ('feedback.record.update', 'm12-feedback', 'feedback_record', false),
  ('feedback.record.classify', 'm12-feedback', 'feedback_record', true),
  ('feedback.record.close', 'm12-feedback', 'feedback_record', true),
  ('feedback.record.reopen', 'm12-feedback', 'feedback_record', true),
  ('feedback.activity.read', 'm12-feedback', 'feedback_activity', false),
  ('feedback.activity.create', 'm12-feedback', 'feedback_activity', false),
  ('feedback.activity.complete', 'm12-feedback', 'feedback_activity', false),
  ('feedback.assignment.read', 'm12-feedback', 'feedback_assignment', false),
  ('feedback.assignment.manage', 'm12-feedback', 'feedback_assignment', true),
  ('feedback.response.read', 'm12-feedback', 'feedback_resolution', false),
  ('feedback.response.submit', 'm12-feedback', 'feedback_resolution', false),
  ('feedback.root_cause.manage', 'm12-feedback', 'feedback_resolution', false),
  ('feedback.resolution.submit', 'm12-feedback', 'feedback_resolution', false),
  ('feedback.resolution.approve', 'm12-feedback', 'feedback_resolution', true),
  ('feedback.confirmation.record', 'm12-feedback', 'feedback_record', false),
  ('feedback.sla.read', 'm12-feedback', 'feedback_sla_instance', false),
  ('feedback.sla.manage', 'm12-feedback', 'feedback_sla_instance', true),
  ('feedback.escalation.read', 'm12-feedback', 'feedback_record', false),
  ('feedback.escalation.trigger', 'm12-feedback', 'feedback_record', true),
  ('feedback.questionnaire.read', 'm12-feedback', 'feedback_questionnaire', false),
  ('feedback.questionnaire.manage', 'm12-feedback', 'feedback_questionnaire', true),
  ('feedback.category.manage', 'm12-feedback', 'feedback_category', true),
  ('feedback.sla_policy.manage', 'm12-feedback', 'feedback_sla_policy', true),
  ('feedback.source.manage', 'm12-feedback', 'feedback_source_system', true),
  ('feedback.source.ingest', 'm12-feedback', 'feedback_source_transaction', true),
  ('feedback.case_handoff.read', 'm12-feedback', 'feedback_case_handoff', false),
  ('feedback.case_handoff.request', 'm12-feedback', 'feedback_case_handoff', true),
  ('feedback.analytics.read', 'm12-feedback', 'feedback_analytics', false),
  ('feedback.analytics.export', 'm12-feedback', 'feedback_analytics', true),
  ('feedback.customer_contact.read', 'm12-feedback', 'feedback_record', true),
  ('feedback.platform.administer', 'm12-feedback', 'feedback_engine', true);

-- feedback_source_system — configurable source systems (ApticOne, AutoBonds, BimaPro, Imarisha, future). No
-- Aptic-only product is hardcoded; sources, products, types are configurable (F-C).
CREATE TABLE feedback_source_system (
  tenant_id  uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT feedback_source_system_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_source_system_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_source_system_code_key UNIQUE (tenant_id, code),
  CONSTRAINT feedback_source_system_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_source_system ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_source_system FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_source_system
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- feedback_category — configurable feedback categories (F8). Mutable config, one row per code.
CREATE TABLE feedback_category (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, name text NOT NULL, default_sentiment text, active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT feedback_category_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_category_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_category_code_key UNIQUE (tenant_id, code),
  CONSTRAINT feedback_category_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_category FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_category
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- feedback_questionnaire — versioned, immutable-after-publish questionnaire spec (one ACTIVE per code).
CREATE TABLE feedback_questionnaire (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT feedback_questionnaire_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_questionnaire_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_questionnaire_code_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT feedback_questionnaire_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT feedback_questionnaire_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT feedback_questionnaire_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_questionnaire ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_questionnaire FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_questionnaire
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX feedback_questionnaire_one_active ON feedback_questionnaire (tenant_id, code) WHERE status = 'ACTIVE';

-- feedback_sla_policy — versioned, immutable-after-publish SLA policy spec (one ACTIVE per code).
CREATE TABLE feedback_sla_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT feedback_sla_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_sla_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_sla_policy_code_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT feedback_sla_policy_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT feedback_sla_policy_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT feedback_sla_policy_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_sla_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_sla_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_sla_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX feedback_sla_policy_one_active ON feedback_sla_policy (tenant_id, code) WHERE status = 'ACTIVE';

-- feedback_source_transaction — a normalized, ingested feedback-eligible transaction. External-transaction
-- uniqueness + idempotency are DB-enforced; only a payload HASH is stored, never the raw source payload.
CREATE TABLE feedback_source_transaction (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_system text NOT NULL, external_transaction_id text NOT NULL, transaction_type text NOT NULL,
  product text NOT NULL, product_category text, branch text, department text, relationship_officer text,
  transaction_date timestamptz, amount_minor bigint, currency text, customer_ref text NOT NULL,
  transaction_status text, payload_hash text, status text NOT NULL DEFAULT 'ingested',
  idempotency_key text, correlation_id uuid NOT NULL, ingested_at timestamptz NOT NULL DEFAULT now(), ingested_by uuid,
  CONSTRAINT feedback_source_transaction_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_source_transaction_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_source_transaction_ext_key UNIQUE (tenant_id, source_system, external_transaction_id),
  CONSTRAINT feedback_source_transaction_status_ck CHECK (status IN ('ingested','rejected','queued','feedback_created')),
  CONSTRAINT feedback_source_transaction_idem_key UNIQUE (tenant_id, idempotency_key));
ALTER TABLE feedback_source_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_source_transaction FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_source_transaction
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX feedback_source_transaction_dim_idx ON feedback_source_transaction (tenant_id, source_system, product, branch);

-- feedback_record — the core aggregate. Carries source/customer/product/service context, classification,
-- workflow/SLA/escalation references, lifecycle status, and analytics dimensions. `customer_contact` and
-- `narrative` are SENSITIVE (redacted in APIs, never in events/audit).
CREATE TABLE feedback_record (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, source_transaction_id uuid, customer_ref text, customer_contact text,
  product text, product_category text, branch text, department text, responsible_officer text,
  channel text, feedback_type text NOT NULL DEFAULT 'general', contact_attempt_ref uuid,
  feedback_at timestamptz, rating integer, rating_scale integer, sentiment text, category text, subcategory text,
  severity text, narrative text, csat numeric(6,2), nps integer, root_cause_status text,
  questionnaire_code text, questionnaire_version integer, severity_rule_eval_id text,
  workflow_instance_ref uuid, sla_policy_code text, escalation_ref uuid, current_owner uuid,
  status text NOT NULL DEFAULT 'pending_contact', resolution_status text, closure_status text, case_handoff_status text,
  customer_confirmed boolean NOT NULL DEFAULT false, customer_informed boolean NOT NULL DEFAULT false,
  origin_module text, correlation_id uuid NOT NULL, causation_id uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT feedback_record_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_record_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_record_code_key UNIQUE (tenant_id, code),
  CONSTRAINT feedback_record_source_fkey FOREIGN KEY (tenant_id, source_transaction_id) REFERENCES feedback_source_transaction (tenant_id, id),
  CONSTRAINT feedback_record_type_ck CHECK (feedback_type IN ('general','complaint','critical_complaint','suggestion','compliment','service_issue','potential_fraud','potential_legal')),
  CONSTRAINT feedback_record_sentiment_ck CHECK (sentiment IS NULL OR sentiment IN ('positive','neutral','negative','critical')),
  CONSTRAINT feedback_record_severity_ck CHECK (severity IS NULL OR severity IN ('low','medium','high','critical')),
  CONSTRAINT feedback_record_status_ck CHECK (status IN ('pending_contact','contact_attempted','feedback_captured','under_review','assigned','investigation_required','awaiting_internal_response','awaiting_customer_confirmation','resolved','closed','reopened','converted_to_case','cancelled','unreachable','expired')),
  CONSTRAINT feedback_record_rating_ck CHECK (rating IS NULL OR (rating >= 0 AND rating_scale IS NOT NULL AND rating <= rating_scale)),
  CONSTRAINT feedback_record_idem_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT feedback_record_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_record
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX feedback_record_dim_idx ON feedback_record (tenant_id, product, branch, department, status);
CREATE INDEX feedback_record_class_idx ON feedback_record (tenant_id, sentiment, severity, category);

-- feedback_answer — APPEND-ONLY structured answers pinned to a questionnaire version.
CREATE TABLE feedback_answer (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), feedback_id uuid NOT NULL,
  question_key text NOT NULL, answer_type text NOT NULL, value_text text, value_number numeric, value_bool boolean,
  value_choices jsonb, questionnaire_code text NOT NULL, questionnaire_version integer NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_answer_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_answer_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_answer_key_key UNIQUE (tenant_id, feedback_id, question_key),
  CONSTRAINT feedback_answer_feedback_fkey FOREIGN KEY (tenant_id, feedback_id) REFERENCES feedback_record (tenant_id, id));
ALTER TABLE feedback_answer ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_answer FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_answer
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- feedback_queue_item — the contact queue. Single-winner claim via a CAS lease (locked_by/locked_until +
-- assigned_officer). Customer contact is NOT stored here (kept on the record, redacted).
CREATE TABLE feedback_queue_item (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_transaction_id uuid, feedback_id uuid, product text, branch text, department text,
  priority text NOT NULL DEFAULT 'normal', due_at timestamptz, contact_status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0, last_attempt_at timestamptz, next_attempt_at timestamptz,
  preferred_channel text, assigned_officer uuid, locked_by uuid, locked_until timestamptz,
  status text NOT NULL DEFAULT 'open', correlation_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT feedback_queue_item_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_queue_item_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_queue_item_source_fkey FOREIGN KEY (tenant_id, source_transaction_id) REFERENCES feedback_source_transaction (tenant_id, id),
  CONSTRAINT feedback_queue_item_status_ck CHECK (status IN ('open','claimed','done','cancelled')),
  CONSTRAINT feedback_queue_item_priority_ck CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT feedback_queue_item_attempts_ck CHECK (attempts >= 0),
  CONSTRAINT feedback_queue_item_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_queue_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_queue_item FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_queue_item
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- One open queue item per source transaction (a source tx is queued once).
CREATE UNIQUE INDEX feedback_queue_item_source_open ON feedback_queue_item (tenant_id, source_transaction_id) WHERE status IN ('open','claimed') AND source_transaction_id IS NOT NULL;
CREATE INDEX feedback_queue_item_work_idx ON feedback_queue_item (tenant_id, status, branch, department, due_at);

-- feedback_contact_attempt — APPEND-ONLY contact evidence. Safe notes only; no call recordings; no full contact.
CREATE TABLE feedback_contact_attempt (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), queue_item_id uuid, feedback_id uuid,
  attempt_number integer NOT NULL, officer uuid, channel text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  outcome text NOT NULL, reached boolean NOT NULL DEFAULT false, callback_requested boolean NOT NULL DEFAULT false,
  next_contact_at timestamptz, failure_category text, identity_verified boolean, notes text, correlation_id uuid NOT NULL,
  CONSTRAINT feedback_contact_attempt_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_contact_attempt_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_contact_attempt_queue_fkey FOREIGN KEY (tenant_id, queue_item_id) REFERENCES feedback_queue_item (tenant_id, id),
  CONSTRAINT feedback_contact_attempt_outcome_ck CHECK (outcome IN ('reached','no_answer','busy','wrong_number','unreachable','callback_requested','declined','completed','failed')),
  CONSTRAINT feedback_contact_attempt_num_ck CHECK (attempt_number >= 1),
  CONSTRAINT feedback_contact_attempt_key UNIQUE (tenant_id, queue_item_id, attempt_number));
ALTER TABLE feedback_contact_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_contact_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_contact_attempt
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- feedback_assignment_history — APPEND-ONLY assignment trail.
CREATE TABLE feedback_assignment_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), feedback_id uuid NOT NULL,
  assigned_to_kind text NOT NULL, assigned_to_ref text NOT NULL, assigned_by uuid, assigned_at timestamptz NOT NULL DEFAULT now(),
  reason text, rule_eval_id text, correlation_id uuid NOT NULL,
  CONSTRAINT feedback_assignment_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_assignment_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_assignment_history_feedback_fkey FOREIGN KEY (tenant_id, feedback_id) REFERENCES feedback_record (tenant_id, id));
ALTER TABLE feedback_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_assignment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_assignment_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- feedback_activity — activities on a feedback record. Document references only (m09 owns content).
CREATE TABLE feedback_activity (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), feedback_id uuid NOT NULL,
  activity_type text NOT NULL, headline text NOT NULL, description text, due_at timestamptz, assigned_to uuid,
  mandatory boolean NOT NULL DEFAULT false, completed boolean NOT NULL DEFAULT false, completed_at timestamptz, outcome text,
  confidentiality text NOT NULL DEFAULT 'internal', document_refs jsonb, correlation_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT feedback_activity_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_activity_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_activity_feedback_fkey FOREIGN KEY (tenant_id, feedback_id) REFERENCES feedback_record (tenant_id, id),
  CONSTRAINT feedback_activity_conf_ck CHECK (confidentiality IN ('internal','confidential','customer_facing')),
  CONSTRAINT feedback_activity_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_activity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX feedback_activity_open_idx ON feedback_activity (tenant_id, feedback_id, completed, mandatory);

-- feedback_resolution — one resolution per feedback (internal response + root cause + resolution folded).
-- `response_confidential` is NEVER exposed to customer-facing channels; `response_customer_facing` is.
CREATE TABLE feedback_resolution (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), feedback_id uuid NOT NULL,
  resolution_type text, summary text, action_taken text, responsible_party text, completion_date timestamptz,
  customer_informed boolean NOT NULL DEFAULT false, customer_response text, compensation boolean NOT NULL DEFAULT false,
  approval_status text NOT NULL DEFAULT 'proposed', responsible_department text, investigation_findings text,
  root_cause_category text, contributing_factors text, corrective_action text, preventive_action text,
  response_confidential text, response_customer_facing text, submitted_by uuid, submitted_at timestamptz, approved_by uuid, approved_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT feedback_resolution_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_resolution_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_resolution_feedback_key UNIQUE (tenant_id, feedback_id),
  CONSTRAINT feedback_resolution_feedback_fkey FOREIGN KEY (tenant_id, feedback_id) REFERENCES feedback_record (tenant_id, id),
  CONSTRAINT feedback_resolution_approval_ck CHECK (approval_status IN ('proposed','approved','rejected')),
  CONSTRAINT feedback_resolution_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_resolution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_resolution
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- feedback_sla_instance — SLA tracking per feedback (one instance). Due dates computed deterministically.
CREATE TABLE feedback_sla_instance (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), feedback_id uuid NOT NULL,
  sla_policy_code text NOT NULL, sla_policy_version integer NOT NULL, started_at timestamptz NOT NULL,
  ack_due_at timestamptz, assign_due_at timestamptz, response_due_at timestamptz, resolution_due_at timestamptz, closure_due_at timestamptz,
  paused_ms bigint NOT NULL DEFAULT 0, pause_reason text, paused_at timestamptz,
  breached boolean NOT NULL DEFAULT false, breach_stage text, breach_at timestamptz,
  waived boolean NOT NULL DEFAULT false, waiver_reason text, waiver_authority uuid,
  disposition_recorded boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
  CONSTRAINT feedback_sla_instance_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_sla_instance_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_sla_instance_feedback_key UNIQUE (tenant_id, feedback_id),
  CONSTRAINT feedback_sla_instance_feedback_fkey FOREIGN KEY (tenant_id, feedback_id) REFERENCES feedback_record (tenant_id, id),
  CONSTRAINT feedback_sla_instance_paused_ck CHECK (paused_ms >= 0),
  CONSTRAINT feedback_sla_instance_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_sla_instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_sla_instance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_sla_instance
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- feedback_case_handoff — APPEND-ONLY handoff to M13 (which does not exist yet). A pending record + a versioned
-- event + a port; m12 does NOT create a fake case table (F26). Idempotent; one pending handoff per feedback.
CREATE TABLE feedback_case_handoff (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), feedback_id uuid NOT NULL,
  recommended_case_type text, severity text, category text, summary text, customer_ref text, product text,
  source_transaction_id uuid, status text NOT NULL DEFAULT 'pending', case_ref text, idempotency_key text,
  correlation_id uuid NOT NULL, requested_by uuid, requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT feedback_case_handoff_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_case_handoff_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_case_handoff_feedback_fkey FOREIGN KEY (tenant_id, feedback_id) REFERENCES feedback_record (tenant_id, id),
  CONSTRAINT feedback_case_handoff_status_ck CHECK (status IN ('pending','completed','cancelled')),
  CONSTRAINT feedback_case_handoff_idem_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT feedback_case_handoff_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_case_handoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_case_handoff FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_case_handoff
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX feedback_case_handoff_pending ON feedback_case_handoff (tenant_id, feedback_id) WHERE status = 'pending';

-- feedback_relationship — duplicate/related/repeat links between feedback records. Tenant-consistent, no self.
CREATE TABLE feedback_relationship (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_feedback_id uuid NOT NULL, to_feedback_id uuid NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'active',
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), removed_by uuid, removed_at timestamptz, version integer NOT NULL DEFAULT 1,
  CONSTRAINT feedback_relationship_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT feedback_relationship_id_key UNIQUE (tenant_id, id),
  CONSTRAINT feedback_relationship_from_fkey FOREIGN KEY (tenant_id, from_feedback_id) REFERENCES feedback_record (tenant_id, id),
  CONSTRAINT feedback_relationship_to_fkey FOREIGN KEY (tenant_id, to_feedback_id) REFERENCES feedback_record (tenant_id, id),
  CONSTRAINT feedback_relationship_kind_ck CHECK (kind IN ('duplicate','related','repeat_complaint')),
  CONSTRAINT feedback_relationship_status_ck CHECK (status IN ('active','removed')),
  CONSTRAINT feedback_relationship_noself_ck CHECK (from_feedback_id <> to_feedback_id),
  CONSTRAINT feedback_relationship_optlock_ck CHECK (version >= 1));
ALTER TABLE feedback_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_relationship FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_relationship
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX feedback_relationship_active_key ON feedback_relationship (tenant_id, from_feedback_id, to_feedback_id, kind) WHERE status = 'active';
