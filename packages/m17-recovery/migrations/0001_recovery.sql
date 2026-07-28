-- ---------------------------------------------------------------------------------------------------
-- M17-recovery — enterprise recovery & enforcement management (Stage 4.3).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No table
-- grants DELETE (recoveries withdraw/close/archive by status; ADR-010). Referral evidence, status history,
-- assignment history, strategy selections, agent reports, receipt references, waivers, outcomes and notes are
-- append-only (INSERT + SELECT only, granted in 0002). RLS FORCE + these access rules are the ethical-walls
-- substrate.
--
-- Recovery types and SLA policies are versioned, immutable-after-publish `spec` JSON with one ACTIVE per
-- code+scope (ADR-069, mirrors m09/m16). Recovery types, jurisdictions, courts, auctioneers, statutes, notices and
-- enforcement methods are NOT hardcoded — they are configurable per tenant. Debtor contacts, negotiation strategy,
-- settlement terms, bank/payment details and security valuations are sensitive: stored under RLS, redacted in
-- APIs, and never placed in events/audit (ADR-072). m17 publishes recovery.lifecycle through the ONE outbox m06
-- owns; it never creates a second outbox. Workflow/rules/escalation/notifications/documents are reached through
-- m06/m07/m08/m09. ALL amounts are REFERENCES only — m17 performs NO cash application, NO general ledger, NO
-- accounts receivable, NO payment execution, NO reconciliation, NO accounting write-off (ADR-071). Write-off is a
-- RECOMMENDATION with maker-checker approval; a human/finance system executes the accounting elsewhere. The M16 ->
-- M17 enforcement referral is idempotent (one recovery per referral key; a proceeding may produce several).
-- m17 never reads m16- or m14-owned tables (matter/proceeding ids are opaque references). M18 knowledge is not
-- owned here.
-- ---------------------------------------------------------------------------------------------------

-- Seed m17's permissions into the global permission catalogue (owned by m02). No vague `recovery.admin`;
-- sensitive reads + approvals + configuration are individually privileged (ADR-069).
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('recovery.case.read', 'm17-recovery', 'recovery_case', false),
  ('recovery.case.create', 'm17-recovery', 'recovery_case', false),
  ('recovery.case.update', 'm17-recovery', 'recovery_case', false),
  ('recovery.case.assign', 'm17-recovery', 'recovery_case', false),
  ('recovery.case.reassign', 'm17-recovery', 'recovery_case', false),
  ('recovery.case.resolve', 'm17-recovery', 'recovery_case', false),
  ('recovery.case.close', 'm17-recovery', 'recovery_case', false),
  ('recovery.case.reopen', 'm17-recovery', 'recovery_case', true),
  ('recovery.case.archive', 'm17-recovery', 'recovery_case', true),
  ('recovery.referral.accept', 'm17-recovery', 'recovery_referral', false),
  ('recovery.recovery_type.read', 'm17-recovery', 'recovery_type', false),
  ('recovery.recovery_type.manage', 'm17-recovery', 'recovery_type', true),
  ('recovery.sla_policy.read', 'm17-recovery', 'recovery_sla_policy', false),
  ('recovery.sla_policy.manage', 'm17-recovery', 'recovery_sla_policy', true),
  ('recovery.party.read', 'm17-recovery', 'recovery_party', false),
  ('recovery.party.manage', 'm17-recovery', 'recovery_party', false),
  ('recovery.party_contact.read', 'm17-recovery', 'recovery_party', true),
  ('recovery.instrument.read', 'm17-recovery', 'recovery_instrument', false),
  ('recovery.instrument.manage', 'm17-recovery', 'recovery_instrument', true),
  ('recovery.strategy.read', 'm17-recovery', 'recovery_strategy', false),
  ('recovery.strategy.manage', 'm17-recovery', 'recovery_strategy', false),
  ('recovery.demand.read', 'm17-recovery', 'recovery_demand', false),
  ('recovery.demand.manage', 'm17-recovery', 'recovery_demand', false),
  ('recovery.negotiation.read', 'm17-recovery', 'recovery_negotiation', false),
  ('recovery.negotiation.manage', 'm17-recovery', 'recovery_negotiation', false),
  ('recovery.arrangement.read', 'm17-recovery', 'recovery_arrangement', false),
  ('recovery.arrangement.manage', 'm17-recovery', 'recovery_arrangement', false),
  ('recovery.arrangement.approve', 'm17-recovery', 'recovery_arrangement', true),
  ('recovery.installment.read', 'm17-recovery', 'recovery_installment', false),
  ('recovery.installment.manage', 'm17-recovery', 'recovery_installment', false),
  ('recovery.enforcement.read', 'm17-recovery', 'recovery_enforcement_action', false),
  ('recovery.enforcement.manage', 'm17-recovery', 'recovery_enforcement_action', true),
  ('recovery.security.read', 'm17-recovery', 'recovery_security', false),
  ('recovery.security.manage', 'm17-recovery', 'recovery_security', false),
  ('recovery.security.realize', 'm17-recovery', 'recovery_security', true),
  ('recovery.agent.read', 'm17-recovery', 'recovery_agent', false),
  ('recovery.agent.manage', 'm17-recovery', 'recovery_agent', true),
  ('recovery.agent_report.read', 'm17-recovery', 'recovery_agent_report', false),
  ('recovery.agent_report.manage', 'm17-recovery', 'recovery_agent_report', false),
  ('recovery.receipt.read', 'm17-recovery', 'recovery_receipt', false),
  ('recovery.receipt.manage', 'm17-recovery', 'recovery_receipt', false),
  ('recovery.cost.read', 'm17-recovery', 'recovery_cost_reference', false),
  ('recovery.cost.manage', 'm17-recovery', 'recovery_cost_reference', true),
  ('recovery.waiver.read', 'm17-recovery', 'recovery_waiver', false),
  ('recovery.waiver.grant', 'm17-recovery', 'recovery_waiver', true),
  ('recovery.writeoff.read', 'm17-recovery', 'recovery_writeoff_recommendation', false),
  ('recovery.writeoff.recommend', 'm17-recovery', 'recovery_writeoff_recommendation', true),
  ('recovery.writeoff.approve', 'm17-recovery', 'recovery_writeoff_recommendation', true),
  ('recovery.outcome.read', 'm17-recovery', 'recovery_outcome', false),
  ('recovery.outcome.manage', 'm17-recovery', 'recovery_outcome', true),
  ('recovery.deadline.read', 'm17-recovery', 'recovery_deadline', false),
  ('recovery.deadline.manage', 'm17-recovery', 'recovery_deadline', false),
  ('recovery.confidential.read', 'm17-recovery', 'recovery_case', true),
  ('recovery.privileged.read', 'm17-recovery', 'recovery_note', true),
  ('recovery.privileged.create', 'm17-recovery', 'recovery_note', true),
  ('recovery.analytics.read', 'm17-recovery', 'recovery_analytics', false),
  ('recovery.analytics.export', 'm17-recovery', 'recovery_analytics', true),
  ('recovery.platform.administer', 'm17-recovery', 'recovery_engine', true);

-- recovery_type — versioned, immutable-after-publish recovery-type spec (one ACTIVE per code+scope).
CREATE TABLE recovery_type (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT recovery_type_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_type_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_type_ver_key UNIQUE (tenant_id, code, scope, version_number),
  CONSTRAINT recovery_type_scope_ck CHECK (scope IN ('tenant','platform')),
  CONSTRAINT recovery_type_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT recovery_type_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT recovery_type_optlock_ck CHECK (version >= 1));
ALTER TABLE recovery_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_type FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_type
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX recovery_type_one_active ON recovery_type (tenant_id, code, scope) WHERE status = 'ACTIVE';

-- recovery_sla_policy — versioned, immutable-after-publish SLA policy spec (one ACTIVE per code+scope).
CREATE TABLE recovery_sla_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text NOT NULL, scope text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'DRAFT', spec jsonb NOT NULL, content_hash text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  published_at timestamptz, published_by uuid,
  CONSTRAINT recovery_sla_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_sla_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_sla_policy_ver_key UNIQUE (tenant_id, code, scope, version_number),
  CONSTRAINT recovery_sla_policy_scope_ck CHECK (scope IN ('tenant','platform')),
  CONSTRAINT recovery_sla_policy_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT recovery_sla_policy_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT recovery_sla_policy_optlock_ck CHECK (version >= 1));
ALTER TABLE recovery_sla_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_sla_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_sla_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX recovery_sla_policy_one_active ON recovery_sla_policy (tenant_id, code, scope) WHERE status = 'ACTIVE';

-- recovery_case — the core aggregate. A recovery/enforcement case linked to an M14 matter + M16 proceeding
-- (opaque references; m17 never reads m14/m16 tables). 29-state lifecycle. SENSITIVE fields. Amounts are refs.
CREATE TABLE recovery_case (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  recovery_number text NOT NULL, recovery_type_code text NOT NULL, recovery_type_version integer,
  source text NOT NULL DEFAULT 'direct_instruction', source_proceeding_id uuid, source_matter_id uuid, source_reference text, originating_module text,
  title text NOT NULL, summary text, description text,
  instrument_type text, jurisdiction text, forum text,
  principal_amount_minor bigint, interest_amount_minor bigint, cost_amount_minor bigint,
  recoverable_amount_minor bigint, recovered_amount_minor bigint, outstanding_amount_minor bigint, currency text,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  recovery_risk text, priority text NOT NULL DEFAULT 'normal', strategy text,
  legal_owner uuid, recovery_team text, business_owner uuid, external_agent_ref uuid,
  workflow_instance_ref uuid, sla_policy_code text, escalation_ref uuid,
  status text NOT NULL DEFAULT 'draft', enforcement_stage text,
  legal_hold boolean NOT NULL DEFAULT false, source_update_emitted boolean NOT NULL DEFAULT false,
  write_off_recommended boolean NOT NULL DEFAULT false, limitation_at timestamptz,
  final_outcome text, residual_note text,
  referred_at timestamptz, resolved_at timestamptz, closed_at timestamptz, reopened_at timestamptz, archived_at timestamptz,
  correlation_id uuid NOT NULL, causation_id uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_case_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_case_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_case_number_key UNIQUE (tenant_id, recovery_number),
  CONSTRAINT recovery_case_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_case_priority_ck CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT recovery_case_status_ck CHECK (status IN ('draft','referred','under_review','strategy_selection',
    'demand_issued','awaiting_response','negotiation','arrangement_pending','arrangement_active','arrangement_default',
    'enforcement_pending','enforcement_active','attachment','execution','auction','security_realization',
    'agent_recovery','partial_recovery','recovered','write_off_recommended','written_off','uncollectible','settled',
    'suspended','resolved','closed','reopened','withdrawn','archived')),
  CONSTRAINT recovery_case_optlock_ck CHECK (version >= 1));
ALTER TABLE recovery_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_case FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_case
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX recovery_case_idem_key ON recovery_case (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX recovery_case_search ON recovery_case (tenant_id, status, recovery_type_code);
CREATE INDEX recovery_case_owner ON recovery_case (tenant_id, legal_owner);
CREATE INDEX recovery_case_proceeding ON recovery_case (tenant_id, source_proceeding_id);
CREATE INDEX recovery_case_matter ON recovery_case (tenant_id, source_matter_id);

-- recovery_referral — idempotency ledger for the M16 enforcement referral: exactly one recovery per referral key
-- (a proceeding may produce several referrals, so the KEY is unique, not the proceeding id). Append-only.
CREATE TABLE recovery_referral (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  referral_key text NOT NULL, source_proceeding_id uuid NOT NULL, source_matter_id uuid, recovery_id uuid NOT NULL,
  recovery_type_code text, safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL, causation_id uuid, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recovery_referral_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_referral_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_referral_key_key UNIQUE (tenant_id, referral_key),
  CONSTRAINT recovery_referral_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_referral ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_referral FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_referral
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- recovery_status_history — append-only lifecycle transition evidence.
CREATE TABLE recovery_status_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_status_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_status_history_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_status_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_status_history_by_rec ON recovery_status_history (tenant_id, recovery_id);

-- recovery_assignment_history — append-only assignment / reassignment evidence.
CREATE TABLE recovery_assignment_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  kind text NOT NULL, ref uuid, reason text, rule_evaluation_id text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_assignment_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_assignment_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_assignment_history_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_assignment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_assignment_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_assignment_history_by_rec ON recovery_assignment_history (tenant_id, recovery_id);

-- recovery_party — a debtor / liable party (reference to master data; contact redacted).
CREATE TABLE recovery_party (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  party_role text NOT NULL, entity_ref text, display_label text, liability_basis text, liability_amount_minor bigint,
  contact_ref text, address_ref text, authority text, confidentiality text NOT NULL DEFAULT 'standard',
  active boolean NOT NULL DEFAULT true, active_from timestamptz, active_to timestamptz,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_party_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_party_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_party_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_party_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_party_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_party FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_party
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_party_by_rec ON recovery_party (tenant_id, recovery_id);

-- recovery_instrument — an enforceable instrument (reference metadata; full document in m09).
CREATE TABLE recovery_instrument (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  instrument_type text NOT NULL, reference text, issuing_forum text, issue_date date, maturity_date date,
  face_amount_minor bigint, currency text, enforceable boolean NOT NULL DEFAULT true, enforceability_note text,
  document_ref uuid, source_proceeding_id uuid, confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_instrument_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_instrument_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_instrument_type_ck CHECK (instrument_type IN ('judgment','decree','court_order','arbitral_award','settlement_agreement','consent_order','promissory_note','guarantee','indemnity','debenture','charge','mortgage','lien','bond','contract','statutory_demand','regulatory_order','other')),
  CONSTRAINT recovery_instrument_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_instrument_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_instrument_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_instrument ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_instrument FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_instrument
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_instrument_by_rec ON recovery_instrument (tenant_id, recovery_id);

-- recovery_strategy — append-only strategy-selection history. Full strategy narrative is SENSITIVE.
CREATE TABLE recovery_strategy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  strategy text NOT NULL, rationale text, selected_by uuid, rule_evaluation_id text, rule_version text,
  confidentiality text NOT NULL DEFAULT 'confidential',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_strategy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_strategy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_strategy_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_strategy_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_strategy ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_strategy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_strategy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_strategy_by_rec ON recovery_strategy (tenant_id, recovery_id);

-- recovery_demand — a demand issued to a debtor. Full letter in m09.
CREATE TABLE recovery_demand (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  demand_type text NOT NULL, party_ref uuid, amount_demanded_minor bigint, currency text, issued_date date,
  response_due date, delivery_method text, document_ref uuid, status text NOT NULL DEFAULT 'issued',
  response_status text, response_date date, response_summary text, confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_demand_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_demand_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_demand_type_ck CHECK (demand_type IN ('informal_demand','formal_demand','statutory_demand','final_demand','letter_before_action','notice_to_pay','notice_of_default')),
  CONSTRAINT recovery_demand_status_ck CHECK (status IN ('draft','issued','served','responded','expired','withdrawn')),
  CONSTRAINT recovery_demand_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_demand_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_demand_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_demand ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_demand FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_demand
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_demand_by_rec ON recovery_demand (tenant_id, recovery_id);

-- recovery_negotiation — a negotiation episode. Strategy + positions are SENSITIVE.
CREATE TABLE recovery_negotiation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  party_ref uuid, opened_date date, closed_date date, position_summary text, counter_position text,
  offered_amount_minor bigint, currency text, status text NOT NULL DEFAULT 'open', outcome text,
  confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_negotiation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_negotiation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_negotiation_status_ck CHECK (status IN ('open','on_hold','agreed','failed','closed')),
  CONSTRAINT recovery_negotiation_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_negotiation_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_negotiation_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_negotiation ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_negotiation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_negotiation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_negotiation_by_rec ON recovery_negotiation (tenant_id, recovery_id);

-- recovery_arrangement — an operational repayment arrangement (schedule metadata only; no cash application).
-- Maker-checker: approver <> proposer.
CREATE TABLE recovery_arrangement (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  arrangement_type text NOT NULL, total_amount_minor bigint, currency text, installment_count integer,
  installment_amount_minor bigint, frequency text, start_date date, end_date date, terms_summary text,
  approval_status text NOT NULL DEFAULT 'proposed', proposed_by uuid, approved_by uuid, approved_at timestamptz,
  status text NOT NULL DEFAULT 'proposed', default_reason text, document_ref uuid, confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_arrangement_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_arrangement_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_arrangement_type_ck CHECK (arrangement_type IN ('lump_sum','installment','structured_settlement','moratorium','restructure','standstill')),
  CONSTRAINT recovery_arrangement_approval_ck CHECK (approval_status IN ('proposed','approved','rejected')),
  CONSTRAINT recovery_arrangement_status_ck CHECK (status IN ('proposed','active','completed','defaulted','cancelled')),
  CONSTRAINT recovery_arrangement_sod_ck CHECK (approved_by IS NULL OR proposed_by IS NULL OR approved_by <> proposed_by),
  CONSTRAINT recovery_arrangement_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_arrangement_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_arrangement_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_arrangement ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_arrangement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_arrangement
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_arrangement_by_rec ON recovery_arrangement (tenant_id, recovery_id);

-- recovery_installment — installment schedule METADATA within an arrangement (composite FK). No cash application.
CREATE TABLE recovery_installment (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), arrangement_id uuid NOT NULL, recovery_id uuid NOT NULL,
  sequence_number integer NOT NULL, due_date date, expected_amount_minor bigint, currency text,
  status text NOT NULL DEFAULT 'scheduled', receipt_ref uuid, paid_date date, note text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_installment_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_installment_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_installment_status_ck CHECK (status IN ('scheduled','due','met','missed','waived','cancelled')),
  CONSTRAINT recovery_installment_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_installment_arr_fkey FOREIGN KEY (tenant_id, arrangement_id) REFERENCES recovery_arrangement (tenant_id, id),
  CONSTRAINT recovery_installment_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_installment ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_installment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_installment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_installment_by_arr ON recovery_installment (tenant_id, arrangement_id);

-- recovery_enforcement_action — attachment/garnishee/execution/auction/repossession metadata (references only).
CREATE TABLE recovery_enforcement_action (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  action_type text NOT NULL, forum text, reference text, initiated_date date, target_asset_ref text,
  target_party_ref uuid, expected_amount_minor bigint, currency text, agent_ref uuid, status text NOT NULL DEFAULT 'initiated',
  outcome text, completed_date date, document_ref uuid, confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_enforcement_action_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_enforcement_action_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_enforcement_action_type_ck CHECK (action_type IN ('attachment','garnishee','execution','warrant_of_execution','proclamation','auction','repossession','eviction','receivership','charging_order','stop_order','committal','statutory_demand','winding_up','bankruptcy_petition','other')),
  CONSTRAINT recovery_enforcement_action_status_ck CHECK (status IN ('initiated','pending','active','completed','stayed','failed','cancelled')),
  CONSTRAINT recovery_enforcement_action_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_enforcement_action_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_enforcement_action_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_enforcement_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_enforcement_action FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_enforcement_action
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_enforcement_action_by_rec ON recovery_enforcement_action (tenant_id, recovery_id);

-- recovery_security — collateral / security references + valuation references (no valuation engine).
CREATE TABLE recovery_security (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  security_type text NOT NULL, description text, asset_ref text, registration_reference text, charge_priority text,
  estimated_value_minor bigint, forced_sale_value_minor bigint, currency text, valuation_date date, valuation_ref uuid,
  status text NOT NULL DEFAULT 'held', realized_amount_minor bigint, realized_date date, document_ref uuid,
  confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_security_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_security_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_security_type_ck CHECK (security_type IN ('real_property','motor_vehicle','chattel','shares','deposit','guarantee','debenture','lien','cash_cover','insurance','other')),
  CONSTRAINT recovery_security_status_ck CHECK (status IN ('held','perfected','realizing','realized','released','discharged')),
  CONSTRAINT recovery_security_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_security_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_security_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_security FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_security
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_security_by_rec ON recovery_security (tenant_id, recovery_id);

-- recovery_agent — an external recovery agent engagement (reference; no vendor-management platform).
CREATE TABLE recovery_agent (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  agent_ref text, agent_type text, engagement_reference text, instruction_scope text, fee_arrangement_reference text,
  reporting_frequency text, next_report_due date, internal_owner uuid, status text NOT NULL DEFAULT 'instructed',
  performance_note text, confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_agent_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_agent_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_agent_status_ck CHECK (status IN ('instructed','active','reporting','suspended','terminated')),
  CONSTRAINT recovery_agent_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_agent_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_agent_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_agent ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_agent FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_agent
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_agent_by_rec ON recovery_agent (tenant_id, recovery_id);

-- recovery_agent_report — append-only external-agent report. Full report in m09.
CREATE TABLE recovery_agent_report (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL, agent_id uuid,
  reporting_period text, status_summary text, action_taken text, next_action text, amount_collected_minor bigint,
  currency text, report_date date, document_ref uuid, confidentiality text NOT NULL DEFAULT 'confidential',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recovery_agent_report_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_agent_report_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_agent_report_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_agent_report_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_agent_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_agent_report FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_agent_report
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_agent_report_by_rec ON recovery_agent_report (tenant_id, recovery_id);

-- recovery_receipt — append-only recovery receipt REFERENCE. m17 records a reference only — NO cash application,
-- NO ledger posting, NO reconciliation (ADR-071). The authoritative money movement lives in finance/AR.
CREATE TABLE recovery_receipt (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  receipt_type text NOT NULL, external_reference text, amount_minor bigint, currency text, received_date date,
  party_ref uuid, arrangement_ref uuid, enforcement_action_ref uuid, security_ref uuid, finance_reference text,
  document_ref uuid, confidentiality text NOT NULL DEFAULT 'confidential',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recovery_receipt_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_receipt_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_receipt_type_ck CHECK (receipt_type IN ('cash','cheque','bank_transfer','mobile_money','security_realization','auction_proceeds','agent_remittance','court_deposit','set_off','other')),
  CONSTRAINT recovery_receipt_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_receipt_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_receipt
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_receipt_by_rec ON recovery_receipt (tenant_id, recovery_id);

-- recovery_waiver — append-only waiver of interest/costs/portion. A human authority grants; no accounting posting.
CREATE TABLE recovery_waiver (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  waiver_type text, amount_minor bigint, currency text, reason text, granted_by uuid, authority text, granted_date date,
  document_ref uuid, confidentiality text NOT NULL DEFAULT 'confidential',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recovery_waiver_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_waiver_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_waiver_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_waiver_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_waiver ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_waiver FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_waiver
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_waiver_by_rec ON recovery_waiver (tenant_id, recovery_id);

-- recovery_writeoff_recommendation — a write-off RECOMMENDATION with maker-checker approval. m17 recommends;
-- the accounting write-off is executed by finance/AR elsewhere. Maker-checker: approver <> recommender.
CREATE TABLE recovery_writeoff_recommendation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  reason_code text NOT NULL, amount_minor bigint, currency text, narrative text, recommended_by uuid, recommended_date date,
  approval_status text NOT NULL DEFAULT 'recommended', approved_by uuid, approved_at timestamptz, finance_reference text,
  document_ref uuid, confidentiality text NOT NULL DEFAULT 'confidential',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_writeoff_recommendation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_writeoff_recommendation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_writeoff_recommendation_reason_ck CHECK (reason_code IN ('uncollectible','deceased_debtor','insolvent_debtor','untraceable','statute_barred','commercial_decision','cost_exceeds_recovery','settled_partial','security_shortfall','other')),
  CONSTRAINT recovery_writeoff_recommendation_approval_ck CHECK (approval_status IN ('recommended','approved','rejected')),
  CONSTRAINT recovery_writeoff_recommendation_sod_ck CHECK (approved_by IS NULL OR recommended_by IS NULL OR approved_by <> recommended_by),
  CONSTRAINT recovery_writeoff_recommendation_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_writeoff_recommendation_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_writeoff_recommendation_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_writeoff_recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_writeoff_recommendation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_writeoff_recommendation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_writeoff_recommendation_by_rec ON recovery_writeoff_recommendation (tenant_id, recovery_id);

-- recovery_outcome — append-only recovery outcome. Full detail/finance movement lives elsewhere.
CREATE TABLE recovery_outcome (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  outcome_type text NOT NULL, outcome_date date, summary text, recovered_amount_minor bigint, waived_amount_minor bigint,
  written_off_amount_minor bigint, outstanding_amount_minor bigint, currency text, document_ref uuid,
  confidentiality text NOT NULL DEFAULT 'confidential',
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recovery_outcome_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_outcome_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_outcome_type_ck CHECK (outcome_type IN ('fully_recovered','partially_recovered','settled','written_off','uncollectible','withdrawn','referred_out','other')),
  CONSTRAINT recovery_outcome_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_outcome_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_outcome FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_outcome
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_outcome_by_rec ON recovery_outcome (tenant_id, recovery_id);

-- recovery_deadline — deterministic recovery deadlines (incl. limitation). Breach dispatch delegated to m06/m08.
CREATE TABLE recovery_deadline (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  deadline_type text NOT NULL, source text, authority text, start_at timestamptz, due_at timestamptz NOT NULL,
  rule jsonb NOT NULL DEFAULT '{}'::jsonb, business_calendar_ref text, warn_window_ms bigint,
  status text NOT NULL DEFAULT 'open', waived boolean NOT NULL DEFAULT false, completed_at timestamptz,
  related_demand uuid, related_arrangement uuid, related_enforcement uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_deadline_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_deadline_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_deadline_type_ck CHECK (deadline_type IN ('demand_response','arrangement_review','installment_due','enforcement_filing','enforcement_action','security_realization','agent_report','statutory_period','limitation','review','closure','internal_action')),
  CONSTRAINT recovery_deadline_status_ck CHECK (status IN ('open','completed','breached','waived','extended','cancelled')),
  CONSTRAINT recovery_deadline_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_deadline_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_deadline ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_deadline FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_deadline
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_deadline_by_rec ON recovery_deadline (tenant_id, recovery_id);

-- recovery_cost_reference — enforcement/recovery cost REFERENCES only. No AP/GL/posting/payment/reconciliation.
CREATE TABLE recovery_cost_reference (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  cost_type text, description text, amount_minor bigint, currency text, incurred_date date, agent_reference text,
  invoice_reference text, approval_status text NOT NULL DEFAULT 'recorded', payment_reference text,
  recoverable boolean NOT NULL DEFAULT false, document_ref uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recovery_cost_reference_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_cost_reference_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_cost_reference_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_cost_reference_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_cost_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_cost_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_cost_reference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_cost_reference_by_rec ON recovery_cost_reference (tenant_id, recovery_id);

-- recovery_note — append-only recovery note; confidential/privileged/strategy/agent require privilege.
CREATE TABLE recovery_note (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general', headline text, content text NOT NULL,
  confidentiality text NOT NULL DEFAULT 'confidential', privileged boolean NOT NULL DEFAULT false,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recovery_note_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_note_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_note_type_ck CHECK (note_type IN ('general','confidential','privileged','strategy','agent','management')),
  CONSTRAINT recovery_note_conf_ck CHECK (confidentiality IN ('standard','confidential','restricted','privileged')),
  CONSTRAINT recovery_note_rec_fkey FOREIGN KEY (tenant_id, recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_note FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recovery_note_by_rec ON recovery_note (tenant_id, recovery_id);

-- recovery_relationship — typed recovery relationships. Self-edge rejected; active-unique.
CREATE TABLE recovery_relationship (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_recovery_id uuid NOT NULL, to_recovery_id uuid NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recovery_relationship_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recovery_relationship_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recovery_relationship_kind_ck CHECK (kind IN ('referred_from_proceeding','related_to','parent_of','child_of','consolidated_with','duplicate_of','guarantor_of','co_debtor_of','security_for','successor_of','split_from')),
  CONSTRAINT recovery_relationship_noself_ck CHECK (from_recovery_id <> to_recovery_id),
  CONSTRAINT recovery_relationship_optlock_ck CHECK (version >= 1),
  CONSTRAINT recovery_relationship_from_fkey FOREIGN KEY (tenant_id, from_recovery_id) REFERENCES recovery_case (tenant_id, id),
  CONSTRAINT recovery_relationship_to_fkey FOREIGN KEY (tenant_id, to_recovery_id) REFERENCES recovery_case (tenant_id, id));
ALTER TABLE recovery_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_relationship FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recovery_relationship
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX recovery_relationship_active_key ON recovery_relationship (tenant_id, from_recovery_id, to_recovery_id, kind) WHERE status = 'active';
