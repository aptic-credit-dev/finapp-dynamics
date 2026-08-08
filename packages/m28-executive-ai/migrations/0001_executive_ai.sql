-- ---------------------------------------------------------------------------------------------------
-- M28-executive-ai — GOVERNED Executive Copilot (Stage 5, mvp:partial): a READ-ONLY, CITED, RLS-MASKED executive
-- assistant. It answers executive questions and produces cross-domain summaries (operations, finance, legal, feedback,
-- cases, KPIs, trends, risk, exceptions, portfolio) for MD/CEO/COO/CFO. IT NEVER mutates a business record, approves,
-- posts, disburses, reconciles, closes a case, files a matter, sends a notification, changes roles/rules/workflow or
-- executes ANY controlled action — a human decides (CLAUDE.md). It consumes the M24 governed AI pipeline BY CONTRACT
-- (owns NO provider/routing/DLP/prompt/vector engine, NO second outbox, NO new event family — M24 emits the
-- ai.*_lifecycle events). Cross-domain reads go through read-only PORTS (opaque refs only; the UNBUILT m32 analytics is
-- deferred behind a read-only port). THE GOVERNANCE INVARIANTS ARE DB-ENFORCED: the copilot is READ-ONLY (a config can
-- never disable read-only; a query is read-only); every substantive answer is CITED (a completed response must carry at
-- least one citation — no uncited factual answer; config can never disable citations); confidence is an INTEGER
-- basis-points score (0..10000, never a float); there is NO secret/credential column and large question/answer content
-- lives behind OPAQUE m09 document references (never raw restricted content). Every tenant-scoped table: composite
-- (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs (within m28 only), version on mutable
-- aggregates. No DELETE grant (ADR-010). Citations, feedback and the idempotency ledger are append-only (INSERT+SELECT,
-- 0002). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- GAP-4 resolution: the /api/v1/copilot API reuses the SHARED ai.* permission namespace with new three-segment
-- ai.copilot.* codes (naming-map: m28 shares m24's namespace, adds no new one). Every /copilot route authorizes one of
-- these (default deny) — there is NO universal AI/copilot bypass. read/query/feedback are unprivileged; export,
-- sensitive (confidential/restricted data), configure and platform (cross-tenant operator scope) are PRIVILEGED.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('ai.copilot.read', 'm28-executive-ai', 'copilot_query', false),
  ('ai.copilot.query', 'm28-executive-ai', 'copilot_query', false),
  ('ai.copilot.feedback', 'm28-executive-ai', 'copilot_feedback', false),
  ('ai.copilot.export', 'm28-executive-ai', 'copilot_response', true),
  ('ai.copilot.sensitive', 'm28-executive-ai', 'copilot_query', true),
  ('ai.copilot.configure', 'm28-executive-ai', 'copilot_config', true),
  ('ai.copilot.platform', 'm28-executive-ai', 'copilot_session', true);

-- copilot_config — versioned copilot config, one active per scope. READ-ONLY, CITATIONS and human-reviewed export can
-- never be turned off (fail closed — the copilot is advisory only, evidence-backed, and never acts).
CREATE TABLE copilot_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft',
  read_only boolean NOT NULL DEFAULT true, citations_required boolean NOT NULL DEFAULT true,
  require_human_review_for_export boolean NOT NULL DEFAULT true,
  min_confidence_bps integer NOT NULL DEFAULT 0, max_sources integer NOT NULL DEFAULT 20,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT copilot_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT copilot_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT copilot_config_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT copilot_config_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT copilot_config_readonly_ck CHECK (read_only = true),
  CONSTRAINT copilot_config_citations_ck CHECK (citations_required = true),
  CONSTRAINT copilot_config_export_review_ck CHECK (require_human_review_for_export = true),
  CONSTRAINT copilot_config_conf_ck CHECK (min_confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT copilot_config_maxsrc_ck CHECK (max_sources BETWEEN 1 AND 200),
  CONSTRAINT copilot_config_optlock_ck CHECK (version >= 1));
ALTER TABLE copilot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON copilot_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX copilot_config_one_active ON copilot_config (tenant_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX copilot_config_idem ON copilot_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE copilot_config IS 'class=tenant_aggregate; m28 copilot config (read-only + citations always on; export human-reviewed)';

-- copilot_session — an executive assistant session. scope_level 'tenant' (the caller's tenant) or 'platform' (a
-- platform operator; requires ai.copilot.platform). classification drives M24 DLP/routing. A session never holds
-- business data — only opaque labels + counters.
CREATE TABLE copilot_session (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope_level text NOT NULL DEFAULT 'tenant', subject_label text, classification text NOT NULL DEFAULT 'internal',
  status text NOT NULL DEFAULT 'active', query_count integer NOT NULL DEFAULT 0, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT copilot_session_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT copilot_session_id_key UNIQUE (tenant_id, id),
  CONSTRAINT copilot_session_scope_ck CHECK (scope_level IN ('tenant','platform')),
  CONSTRAINT copilot_session_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT copilot_session_status_ck CHECK (status IN ('active','closed')),
  CONSTRAINT copilot_session_qc_ck CHECK (query_count >= 0),
  CONSTRAINT copilot_session_optlock_ck CHECK (version >= 1));
ALTER TABLE copilot_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_session FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON copilot_session
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX copilot_session_idem ON copilot_session (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE copilot_session IS 'class=tenant_aggregate; m28 copilot session (tenant/platform scope; opaque labels only)';

-- copilot_query — a READ-ONLY executive query. THE READ-ONLY INVARIANT is DB-enforced (read_only CHECK = true): a query
-- can never represent a mutating/controlled action. WRAPS an M24 governed request (ai_request_ref is an OPAQUE m24 id,
-- no FK). The full question text is NEVER stored inline — only an opaque m09 reference (question_ref) + a bounded intent
-- class. A HUMAN reads the answer; the copilot never decides. Lifecycle:
--   received -> authorized -> masked -> evidence_resolved -> ai_requested -> generated -> validated -> completed
--                                                                                          |-> refused | failed
CREATE TABLE copilot_query (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), session_id uuid NOT NULL,
  intent_class text NOT NULL, scope_level text NOT NULL DEFAULT 'tenant', classification text NOT NULL DEFAULT 'internal',
  question_ref uuid, read_only boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'received', confidence_bps integer NOT NULL DEFAULT 0, source_count integer NOT NULL DEFAULT 0,
  refusal_reason_code text, ai_request_ref uuid, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT copilot_query_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT copilot_query_id_key UNIQUE (tenant_id, id),
  CONSTRAINT copilot_query_intent_ck CHECK (intent_class IN ('executive_question','operational_summary','finance_summary','legal_summary','feedback_summary','case_summary','kpi_explanation','trend_explanation','risk_summary','exception_summary','portfolio_summary','cross_domain_synthesis','dashboard_narrative','follow_up')),
  CONSTRAINT copilot_query_scope_ck CHECK (scope_level IN ('tenant','platform')),
  CONSTRAINT copilot_query_class_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT copilot_query_readonly_ck CHECK (read_only = true),
  CONSTRAINT copilot_query_status_ck CHECK (status IN ('received','authorized','masked','evidence_resolved','ai_requested','generated','validated','completed','refused','failed')),
  CONSTRAINT copilot_query_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT copilot_query_srccount_ck CHECK (source_count >= 0),
  CONSTRAINT copilot_query_optlock_ck CHECK (version >= 1),
  CONSTRAINT copilot_query_session_fkey FOREIGN KEY (tenant_id, session_id) REFERENCES copilot_session (tenant_id, id));
ALTER TABLE copilot_query ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_query FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON copilot_query
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX copilot_query_by_session ON copilot_query (tenant_id, session_id, status);
CREATE UNIQUE INDEX copilot_query_idem ON copilot_query (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE copilot_query IS 'class=tenant_aggregate; m28 read-only executive query (read_only CHECK; wraps opaque m24 request; question behind m09 ref)';

-- copilot_response — the CITED answer to a query. THE CITATION INVARIANT is DB-enforced: a completed response must carry
-- at least one citation (copilot_response_cited_ck — no uncited factual executive answer); a response that cannot be
-- cited/policy-cleared is review_required, never silently completed. The full answer text is NEVER stored inline — only
-- an opaque m09 reference (answer_ref). ai_output_ref is an OPAQUE m24 output id (no FK). Lifecycle:
--   draft -> citation_validated -> policy_validated -> complete | review_required | rejected
CREATE TABLE copilot_response (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), query_id uuid NOT NULL,
  answer_ref uuid, ai_output_ref uuid,
  status text NOT NULL DEFAULT 'draft', confidence_bps integer NOT NULL DEFAULT 0,
  citation_count integer NOT NULL DEFAULT 0, citations_required boolean NOT NULL DEFAULT true,
  review_required boolean NOT NULL DEFAULT false, reason_code text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT copilot_response_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT copilot_response_id_key UNIQUE (tenant_id, id),
  CONSTRAINT copilot_response_query_uk UNIQUE (tenant_id, query_id),
  CONSTRAINT copilot_response_status_ck CHECK (status IN ('draft','citation_validated','policy_validated','complete','review_required','rejected')),
  CONSTRAINT copilot_response_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  CONSTRAINT copilot_response_citcount_ck CHECK (citation_count >= 0),
  CONSTRAINT copilot_response_citations_ck CHECK (citations_required = true),
  -- CITATION-REQUIRED: a completed response must be cited (no uncited factual answer; missing citation => review_required).
  CONSTRAINT copilot_response_cited_ck CHECK (status <> 'complete' OR citation_count > 0),
  CONSTRAINT copilot_response_optlock_ck CHECK (version >= 1),
  CONSTRAINT copilot_response_query_fkey FOREIGN KEY (tenant_id, query_id) REFERENCES copilot_query (tenant_id, id));
ALTER TABLE copilot_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_response FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON copilot_response
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX copilot_response_by_query ON copilot_response (tenant_id, query_id, status);
COMMENT ON TABLE copilot_response IS 'class=tenant_aggregate; m28 cited response (completed => cited CHECK; answer behind m09 ref; opaque m24 output ref)';

-- copilot_citation — APPEND-ONLY citation evidence for a response. Only entitlement-GRANTED evidence is ever persisted
-- (the caller was proven entitled to the referenced record) — masked evidence is NEVER cited, so a citation can never
-- leak a row the caller cannot see. A citation carries a REFERENCE only (opaque m09 document ref / underlying-module
-- record ref, version/hash, location, retrieval time, confidence) — never copied restricted content. entitlement_result
-- records the proven access decision for audit.
CREATE TABLE copilot_citation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), response_id uuid NOT NULL,
  source_type text NOT NULL, source_module text NOT NULL,
  record_ref uuid, document_ref uuid, document_version text, location text,
  retrieved_at timestamptz NOT NULL DEFAULT now(), confidence_bps integer NOT NULL DEFAULT 0,
  entitlement_result text NOT NULL DEFAULT 'granted', by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_citation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT copilot_citation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT copilot_citation_source_ck CHECK (source_type IN ('record','document','metric','aggregate','timeline','report')),
  CONSTRAINT copilot_citation_ent_ck CHECK (entitlement_result IN ('granted','masked','redacted')),
  CONSTRAINT copilot_citation_conf_ck CHECK (confidence_bps BETWEEN 0 AND 10000),
  -- A persisted citation MUST reference something (opaque record or document ref) — no free-text/fabricated source.
  CONSTRAINT copilot_citation_ref_ck CHECK (record_ref IS NOT NULL OR document_ref IS NOT NULL),
  -- Only entitlement-GRANTED evidence is cited (no citation to data the caller cannot access).
  CONSTRAINT copilot_citation_granted_ck CHECK (entitlement_result = 'granted'),
  CONSTRAINT copilot_citation_resp_fkey FOREIGN KEY (tenant_id, response_id) REFERENCES copilot_response (tenant_id, id));
ALTER TABLE copilot_citation ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_citation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON copilot_citation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX copilot_citation_by_resp ON copilot_citation (tenant_id, response_id);
COMMENT ON TABLE copilot_citation IS 'class=tenant_ledger_append_only; m28 citation evidence (granted-only refs; never restricted content)';

-- copilot_feedback — APPEND-ONLY human feedback on a response (helpful / not_helpful / inaccurate / incomplete). Free
-- text lives behind an opaque m09 reference (comment_ref), never inline. Idempotency-keyed (a duplicate submission is
-- suppressed).
CREATE TABLE copilot_feedback (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), response_id uuid NOT NULL,
  rating text NOT NULL, reason_code text, comment_ref uuid, by_user uuid NOT NULL, idempotency_key text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_feedback_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT copilot_feedback_id_key UNIQUE (tenant_id, id),
  CONSTRAINT copilot_feedback_rating_ck CHECK (rating IN ('helpful','not_helpful','inaccurate','incomplete')),
  CONSTRAINT copilot_feedback_resp_fkey FOREIGN KEY (tenant_id, response_id) REFERENCES copilot_response (tenant_id, id));
ALTER TABLE copilot_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON copilot_feedback
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX copilot_feedback_by_resp ON copilot_feedback (tenant_id, response_id);
CREATE UNIQUE INDEX copilot_feedback_idem ON copilot_feedback (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE copilot_feedback IS 'class=tenant_ledger_append_only; m28 human feedback (comment behind m09 ref; idempotent)';

-- copilot_idempotency — APPEND-ONLY idempotency ledger. THE "no duplicate query / no duplicate M24 handoff" guarantee:
-- unique per tenant+key.
CREATE TABLE copilot_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, query_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT copilot_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT copilot_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT copilot_idempotency_key_uk UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT copilot_idempotency_query_fkey FOREIGN KEY (tenant_id, query_id) REFERENCES copilot_query (tenant_id, id));
ALTER TABLE copilot_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON copilot_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE copilot_idempotency IS 'class=tenant_ledger_append_only; m28 idempotency ledger (no duplicate query / m24 handoff)';
