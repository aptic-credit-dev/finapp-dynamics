-- ---------------------------------------------------------------------------------------------------
-- M24-ai-foundation — the GOVERNED AI layer (Stage 5, MVP: gateway + registries + governed summaries/classifications,
-- human-reviewed). It runs the AI request -> output lifecycle with DLP, approved-provider routing per data
-- classification, confidence, source citations, MANDATORY human review and usage/cost metering. AI ASSISTS ONLY: an
-- output is a RECOMMENDATION — it is NEVER a controlled action. THE GOVERNANCE INVARIANTS ARE DB-ENFORCED: an output
-- can only be 'approved' by a HUMAN reviewer (no autonomous action) and, where citations are required, only with a
-- citation; a request cannot route/generate before DLP clears; a request handling restricted/confidential data can only
-- proceed once bound to an APPROVED provider. Providers hold a SECRET REFERENCE only (secretref: pointer) — there is
-- ZERO credential/secret column. Large inputs/outputs/evidence are referenced through m09 DOCUMENTS (opaque ids, no
-- FK) — never stored inline. Money (cost) is bigint minor units (never float, ADR-007); confidence is an INTEGER
-- basis-points score (0..10000). Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE +
-- tenant_isolation, composite FKs, version on mutable aggregates. No DELETE grant (ADR-010). Histories, citations,
-- human reviews, DLP findings, usage, governance events and the idempotency ledger are append-only (INSERT+SELECT,
-- 0002). m24 publishes ai.request_lifecycle / ai.output_lifecycle / ai.governance_lifecycle through the ONE m06 outbox;
-- it owns NO outbox and NO controlled-action execution. No production provider adapter exists (deterministic doubles
-- only). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('ai.provider.read', 'm24-ai-foundation', 'ai_provider', false),
  ('ai.provider.manage', 'm24-ai-foundation', 'ai_provider', true),
  ('ai.provider.approve', 'm24-ai-foundation', 'ai_provider', true),
  ('ai.model.read', 'm24-ai-foundation', 'ai_model', false),
  ('ai.model.manage', 'm24-ai-foundation', 'ai_model', true),
  ('ai.prompt.read', 'm24-ai-foundation', 'ai_prompt', false),
  ('ai.prompt.manage', 'm24-ai-foundation', 'ai_prompt', true),
  ('ai.prompt.publish', 'm24-ai-foundation', 'ai_prompt', true),
  ('ai.config.read', 'm24-ai-foundation', 'ai_config', false),
  ('ai.config.manage', 'm24-ai-foundation', 'ai_config', true),
  ('ai.dlp.read', 'm24-ai-foundation', 'ai_dlp_policy', false),
  ('ai.dlp.manage', 'm24-ai-foundation', 'ai_dlp_policy', true),
  ('ai.request.read', 'm24-ai-foundation', 'ai_request', false),
  ('ai.request.create', 'm24-ai-foundation', 'ai_request', false),
  ('ai.request.cancel', 'm24-ai-foundation', 'ai_request', false),
  ('ai.output.read', 'm24-ai-foundation', 'ai_output', false),
  ('ai.output.review', 'm24-ai-foundation', 'ai_output', true),
  ('ai.citation.add', 'm24-ai-foundation', 'ai_citation', false),
  ('ai.usage.read', 'm24-ai-foundation', 'ai_usage', false),
  ('ai.governance.read', 'm24-ai-foundation', 'ai_governance', false),
  ('ai.governance.manage', 'm24-ai-foundation', 'ai_governance', true),
  ('ai.analytics.read', 'm24-ai-foundation', 'ai_analytics', false),
  ('ai.platform.administer', 'm24-ai-foundation', 'ai_foundation', true);

-- ai_provider — a configured, provider-AGNOSTIC AI provider (versioned; one active per code). `approved` + the
-- `classifications` allow-list gate restricted-data routing. Holds a SECRET REFERENCE only (secretref: pointer) — NO
-- credential/secret column. No endpoint/URL column (no network call is made in the MVP).
CREATE TABLE ai_provider (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text, kind text NOT NULL DEFAULT 'local',
  status text NOT NULL DEFAULT 'draft', approved boolean NOT NULL DEFAULT false,
  classifications text[] NOT NULL DEFAULT ARRAY[]::text[], secret_reference text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_provider_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_provider_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_provider_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT ai_provider_kind_ck CHECK (kind IN ('local','cloud','hybrid')),
  CONSTRAINT ai_provider_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT ai_provider_secretref_ck CHECK (secret_reference IS NULL OR secret_reference ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT ai_provider_optlock_ck CHECK (version >= 1));
ALTER TABLE ai_provider ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_provider
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX ai_provider_one_active ON ai_provider (tenant_id, code) WHERE status = 'active';
COMMENT ON TABLE ai_provider IS 'class=tenant_aggregate; m24 AI provider (secret reference only; approved-provider routing)';

-- ai_provider_history — append-only provider lifecycle evidence.
CREATE TABLE ai_provider_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), provider_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_provider_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_provider_history_prov_fkey FOREIGN KEY (tenant_id, provider_id) REFERENCES ai_provider (tenant_id, id));
ALTER TABLE ai_provider_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_provider_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE ai_provider_history IS 'class=tenant_ledger_append_only; m24 provider history';

-- ai_model — a registered model belonging to a provider (versioned; one active per code).
CREATE TABLE ai_model (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), provider_id uuid,
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text, capability text NOT NULL DEFAULT 'text',
  status text NOT NULL DEFAULT 'draft', rate_per_1k_minor bigint NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_model_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_model_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_model_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT ai_model_capability_ck CHECK (capability IN ('text','embedding','classification','vision')),
  CONSTRAINT ai_model_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT ai_model_rate_ck CHECK (rate_per_1k_minor >= 0),
  CONSTRAINT ai_model_optlock_ck CHECK (version >= 1),
  CONSTRAINT ai_model_prov_fkey FOREIGN KEY (tenant_id, provider_id) REFERENCES ai_provider (tenant_id, id));
ALTER TABLE ai_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_model
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX ai_model_one_active ON ai_model (tenant_id, code) WHERE status = 'active';
COMMENT ON TABLE ai_model IS 'class=tenant_aggregate; m24 AI model (versioned; bigint rate)';

-- ai_prompt — a versioned prompt template, immutable-after-publish (content_hash freezes it). Template is a CONFIG
-- template (not user/restricted data); user input is referenced via m09 documents on the request.
CREATE TABLE ai_prompt (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text, template text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft', content_hash text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_prompt_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_prompt_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_prompt_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT ai_prompt_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT ai_prompt_optlock_ck CHECK (version >= 1));
ALTER TABLE ai_prompt ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_prompt
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX ai_prompt_one_active ON ai_prompt (tenant_id, code) WHERE status = 'active';
COMMENT ON TABLE ai_prompt IS 'class=tenant_aggregate; m24 prompt template (versioned, immutable-after-publish)';

-- ai_prompt_history — append-only prompt lifecycle evidence.
CREATE TABLE ai_prompt_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), prompt_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_prompt_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_prompt_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_prompt_history_pr_fkey FOREIGN KEY (tenant_id, prompt_id) REFERENCES ai_prompt (tenant_id, id));
ALTER TABLE ai_prompt_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompt_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_prompt_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE ai_prompt_history IS 'class=tenant_ledger_append_only; m24 prompt history';

-- ai_dlp_policy — versioned DLP policy, one active per scope. DLP applies to AI requests + outputs (enforced in-service
-- via the DlpPolicyEvaluator port; m41 integrates behind it later).
CREATE TABLE ai_dlp_policy (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft', block_restricted boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_dlp_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_dlp_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_dlp_policy_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT ai_dlp_policy_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  -- DLP can never be turned off for restricted data (fail closed).
  CONSTRAINT ai_dlp_policy_block_ck CHECK (block_restricted = true),
  CONSTRAINT ai_dlp_policy_optlock_ck CHECK (version >= 1));
ALTER TABLE ai_dlp_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_dlp_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_dlp_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX ai_dlp_policy_one_active ON ai_dlp_policy (tenant_id, scope) WHERE status = 'active';
COMMENT ON TABLE ai_dlp_policy IS 'class=tenant_aggregate; m24 DLP policy (block_restricted always on)';

-- ai_config — versioned engine config, one active per scope, idempotency-keyed.
CREATE TABLE ai_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft', require_human_review boolean NOT NULL DEFAULT true,
  min_confidence_bps integer NOT NULL DEFAULT 0, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_config_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT ai_config_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  -- human review can never be turned off — AI outputs are always human-approved (no autonomous action).
  CONSTRAINT ai_config_review_ck CHECK (require_human_review = true),
  CONSTRAINT ai_config_conf_ck CHECK (min_confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT ai_config_optlock_ck CHECK (version >= 1));
ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX ai_config_one_active ON ai_config (tenant_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX ai_config_idem ON ai_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE ai_config IS 'class=tenant_aggregate; m24 config (require_human_review always on)';

-- ai_request — the AI request aggregate. subject_ref/module_ref/input_document_ref are OPAQUE ids (m09 doc ref for the
-- input; no FK). THE GOVERNANCE INVARIANTS: a request cannot route/generate before DLP clears; a request handling
-- restricted/confidential data can only proceed once bound to an APPROVED provider. Confidence is integer basis points.
CREATE TABLE ai_request (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_type text NOT NULL DEFAULT 'generic', subject_ref uuid, module_ref text, classification text NOT NULL DEFAULT 'internal',
  provider_id uuid, model_id uuid, prompt_id uuid, input_document_ref uuid,
  status text NOT NULL DEFAULT 'received', dlp_checked boolean NOT NULL DEFAULT false, dlp_action text,
  provider_approved boolean NOT NULL DEFAULT false, confidence_bps integer NOT NULL DEFAULT 0,
  requested_by uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_request_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_request_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_request_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT ai_request_status_ck CHECK (status IN ('received','dlp_checked','routed','generating','generated','review_pending','completed','rejected','failed','cancelled')),
  CONSTRAINT ai_request_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  -- DLP BEFORE ROUTING: a request cannot advance to routed/generating/... without DLP having cleared.
  CONSTRAINT ai_request_dlp_ck CHECK (status NOT IN ('routed','generating','generated','review_pending','completed') OR dlp_checked = true),
  -- APPROVED-PROVIDER ROUTING: restricted/confidential data cannot route/proceed without an approved-provider binding.
  CONSTRAINT ai_request_approved_ck CHECK (classification NOT IN ('restricted','confidential') OR status NOT IN ('routed','generating','generated','review_pending','completed') OR provider_approved = true),
  CONSTRAINT ai_request_optlock_ck CHECK (version >= 1),
  CONSTRAINT ai_request_prov_fkey FOREIGN KEY (tenant_id, provider_id) REFERENCES ai_provider (tenant_id, id),
  CONSTRAINT ai_request_model_fkey FOREIGN KEY (tenant_id, model_id) REFERENCES ai_model (tenant_id, id),
  CONSTRAINT ai_request_prompt_fkey FOREIGN KEY (tenant_id, prompt_id) REFERENCES ai_prompt (tenant_id, id));
ALTER TABLE ai_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_request
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX ai_request_idem ON ai_request (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ai_request_by_status ON ai_request (tenant_id, status);
COMMENT ON TABLE ai_request IS 'class=tenant_aggregate; m24 AI request (DLP-before-routing + approved-provider CHECKs; m09 input ref)';

-- ai_request_history — append-only request lifecycle evidence.
CREATE TABLE ai_request_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_request_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_request_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_request_history_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES ai_request (tenant_id, id));
ALTER TABLE ai_request_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_request_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_request_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_request_history_by_req ON ai_request_history (tenant_id, request_id);
COMMENT ON TABLE ai_request_history IS 'class=tenant_ledger_append_only; m24 request history';

-- ai_output — the AI output aggregate (a RECOMMENDATION, never a controlled action). output_document_ref is an OPAQUE
-- m09 doc ref (large content is NOT stored inline). THE NO-AUTONOMOUS-ACTION INVARIANTS: an output can only be
-- 'approved' by a HUMAN reviewer, and — where citations are required — only with at least one citation.
CREATE TABLE ai_output (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  output_kind text NOT NULL DEFAULT 'summary', output_document_ref uuid, confidence_bps integer NOT NULL DEFAULT 0,
  citations_required boolean NOT NULL DEFAULT false, citation_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft', reviewed_by uuid, review_reason_code text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT ai_output_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_output_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_output_kind_ck CHECK (output_kind IN ('summary','classification','extraction','recommendation','answer')),
  CONSTRAINT ai_output_status_ck CHECK (status IN ('draft','validated','review_pending','approved','rejected')),
  CONSTRAINT ai_output_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT ai_output_citecount_ck CHECK (citation_count >= 0),
  -- NO AUTONOMOUS ACTION: an output can only be 'approved' by a HUMAN reviewer (human accountability).
  CONSTRAINT ai_output_human_ck CHECK (status <> 'approved' OR reviewed_by IS NOT NULL),
  -- CITATIONS WHERE REQUIRED: an approved output that requires citations has at least one.
  CONSTRAINT ai_output_cite_ck CHECK (status <> 'approved' OR citations_required = false OR citation_count > 0),
  CONSTRAINT ai_output_optlock_ck CHECK (version >= 1),
  CONSTRAINT ai_output_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES ai_request (tenant_id, id));
ALTER TABLE ai_output ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_output FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_output
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_output_by_req ON ai_output (tenant_id, request_id, status);
COMMENT ON TABLE ai_output IS 'class=tenant_aggregate; m24 AI output (human-approved-only + citations CHECKs; m09 output ref)';

-- ai_output_history — append-only output lifecycle evidence.
CREATE TABLE ai_output_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), output_id uuid NOT NULL, request_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_output_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_output_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_output_history_out_fkey FOREIGN KEY (tenant_id, output_id) REFERENCES ai_output (tenant_id, id));
ALTER TABLE ai_output_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_output_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_output_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_output_history_by_out ON ai_output_history (tenant_id, output_id);
COMMENT ON TABLE ai_output_history IS 'class=tenant_ledger_append_only; m24 output history';

-- ai_citation — append-only source citation for an output (m09 document ref + span). "cite source evidence where required".
CREATE TABLE ai_citation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), output_id uuid NOT NULL,
  document_ref uuid, span text, confidence_bps integer NOT NULL DEFAULT 0, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_citation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_citation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_citation_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT ai_citation_out_fkey FOREIGN KEY (tenant_id, output_id) REFERENCES ai_output (tenant_id, id));
ALTER TABLE ai_citation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_citation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_citation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_citation_by_out ON ai_citation (tenant_id, output_id);
COMMENT ON TABLE ai_citation IS 'class=tenant_ledger_append_only; m24 citation (m09 doc ref + span)';

-- ai_human_review — append-only HUMAN review evidence on an output (human accountability). decision by a person.
CREATE TABLE ai_human_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), output_id uuid NOT NULL, request_id uuid NOT NULL,
  reviewer uuid NOT NULL, decision text NOT NULL, reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_human_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_human_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_human_review_decision_ck CHECK (decision IN ('approved','rejected','edited')),
  CONSTRAINT ai_human_review_out_fkey FOREIGN KEY (tenant_id, output_id) REFERENCES ai_output (tenant_id, id));
ALTER TABLE ai_human_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_human_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_human_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_human_review_by_out ON ai_human_review (tenant_id, output_id);
COMMENT ON TABLE ai_human_review IS 'class=tenant_ledger_append_only; m24 human review (human accountability)';

-- ai_dlp_finding — append-only DLP finding on a request. DLP applies to AI requests + outputs.
CREATE TABLE ai_dlp_finding (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  classification text NOT NULL, action text NOT NULL, reason_code text, finding_count integer NOT NULL DEFAULT 0,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_dlp_finding_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_dlp_finding_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_dlp_finding_action_ck CHECK (action IN ('allow','redact','block')),
  CONSTRAINT ai_dlp_finding_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES ai_request (tenant_id, id));
ALTER TABLE ai_dlp_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_dlp_finding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_dlp_finding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_dlp_finding_by_req ON ai_dlp_finding (tenant_id, request_id);
COMMENT ON TABLE ai_dlp_finding IS 'class=tenant_ledger_append_only; m24 DLP finding';

-- ai_usage — append-only usage + cost evidence. Cost is bigint minor units (never float, ADR-007).
CREATE TABLE ai_usage (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0, completion_tokens integer NOT NULL DEFAULT 0, total_tokens integer NOT NULL DEFAULT 0,
  cost_minor bigint NOT NULL DEFAULT 0, latency_ms integer NOT NULL DEFAULT 0, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_usage_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_usage_cost_ck CHECK (cost_minor >= 0),
  CONSTRAINT ai_usage_tokens_ck CHECK (prompt_tokens >= 0 AND completion_tokens >= 0 AND total_tokens >= 0),
  CONSTRAINT ai_usage_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES ai_request (tenant_id, id));
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_usage
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_usage_by_req ON ai_usage (tenant_id, request_id);
COMMENT ON TABLE ai_usage IS 'class=tenant_ledger_append_only; m24 usage + cost (bigint minor units)';

-- ai_governance_event — append-only AI governance ledger (DLP block, provider approval, control update, usage).
CREATE TABLE ai_governance_event (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type text NOT NULL, subject_type text, subject_ref uuid, reason_code text, actor uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_governance_event_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_governance_event_id_key UNIQUE (tenant_id, id));
ALTER TABLE ai_governance_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_governance_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_governance_event
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX ai_governance_event_by_type ON ai_governance_event (tenant_id, event_type);
COMMENT ON TABLE ai_governance_event IS 'class=tenant_ledger_append_only; m24 governance event ledger';

-- ai_idempotency — append-only idempotency ledger. THE "no duplicate AI request" guarantee: unique per tenant+key.
CREATE TABLE ai_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, request_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT ai_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT ai_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ai_idempotency_key_uk UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ai_idempotency_req_fkey FOREIGN KEY (tenant_id, request_id) REFERENCES ai_request (tenant_id, id));
ALTER TABLE ai_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE ai_idempotency IS 'class=tenant_ledger_append_only; m24 idempotency ledger (no duplicate request)';
