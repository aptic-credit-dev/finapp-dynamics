-- ---------------------------------------------------------------------------------------------------
-- M21-journal — the journal engine (Stage 3, DRAFT-first MVP). Turns m20 DRAFT reconciliation recommendations (and
-- operational inputs) into BALANCED, decimal-safe journal DRAFTS: debits == credits in INTEGER MINOR UNITS (bigint,
-- never float — ADR-007). Runs deterministic + explainable validation (reason codes), manages the draft lifecycle up
-- to submit-for-approval, and PREPARES approval-gated posting requests + records posting-result evidence. It OWNS the
-- journal-engine data; it NEVER approves (m22 owns maker-checker + SoD), NEVER posts to a ledger/ERP/core system,
-- NEVER auto-posts, NEVER posts into a closed/locked period (reads m19's period open/closed/locked state — ADR-078),
-- and NEVER duplicate-posts (idempotency ledger). It owns NO chart of accounts / fiscal periods (m19 — entity_ref/
-- period_ref/account_ref/currency_ref/cost_centre_ref/dimension_ref/tax_code_ref are OPAQUE m19 ids, no FK), NO GL
-- reconciliation (m20 — source_ref/handoff_ref opaque), NO approval workflow (m22 — approval_ref/approved_by opaque),
-- NO integration/posting push (m23/m33), NO AI (m27). Every tenant-scoped table: composite (tenant_id, id) PK +
-- UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs, a `version` column on mutable aggregates. No DELETE
-- grant (ADR-010); types/config/reason-codes/recommendations/drafts/lines/posting-requests/posting-results transition
-- by status. Recommendation lines/history, status history, draft-balance evidence, notes, validation + findings,
-- posting-request/result history and the posting idempotency ledger are append-only (INSERT+SELECT, 0002). m21
-- publishes journal.lifecycle + posting_request.lifecycle through the ONE m06 outbox; it never creates a second
-- outbox. Posting is DEFERRED (draft-first MVP) — the human approves through m22 and posts via m23/m33 later.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('journals.recommendation.read', 'm21-journal', 'journal_recommendation', false),
  ('journals.recommendation.ingest', 'm21-journal', 'journal_recommendation', false),
  ('journals.recommendation.manage', 'm21-journal', 'journal_recommendation', false),
  ('journals.draft.read', 'm21-journal', 'journal_draft', false),
  ('journals.draft.create', 'm21-journal', 'journal_draft', false),
  ('journals.draft.edit', 'm21-journal', 'journal_draft', false),
  ('journals.draft.submit', 'm21-journal', 'journal_draft', false),
  ('journals.draft.withdraw', 'm21-journal', 'journal_draft', false),
  ('journals.line.manage', 'm21-journal', 'journal_line', false),
  ('journals.validation.read', 'm21-journal', 'journal_validation', false),
  ('journals.validation.run', 'm21-journal', 'journal_validation', false),
  ('journals.type.read', 'm21-journal', 'journal_type', false),
  ('journals.type.manage', 'm21-journal', 'journal_type', true),
  ('journals.config.read', 'm21-journal', 'journal_config', false),
  ('journals.config.manage', 'm21-journal', 'journal_config', true),
  ('journals.config.publish', 'm21-journal', 'journal_config', true),
  ('journals.posting_request.read', 'm21-journal', 'posting_request', false),
  ('journals.posting_request.create', 'm21-journal', 'posting_request', true),
  ('journals.posting_request.authorize', 'm21-journal', 'posting_request', true),
  ('journals.posting_request.cancel', 'm21-journal', 'posting_request', true),
  ('journals.posting_result.read', 'm21-journal', 'posting_result', false),
  ('journals.posting_result.record', 'm21-journal', 'posting_result', true),
  ('journals.reason_code.read', 'm21-journal', 'journal_reason_code', false),
  ('journals.reason_code.manage', 'm21-journal', 'journal_reason_code', true),
  ('journals.note.add', 'm21-journal', 'journal_note', false),
  ('journals.analytics.read', 'm21-journal', 'journal_analytics', false),
  ('journals.platform.administer', 'm21-journal', 'journal_engine', true);

-- journal_type — a versioned journal type (one active per code). Immutable-after-publish; change = a new version.
CREATE TABLE journal_type (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text, kind text NOT NULL DEFAULT 'standard',
  status text NOT NULL DEFAULT 'draft', requires_balance boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT journal_type_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_type_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_type_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT journal_type_kind_ck CHECK (kind IN ('standard','accrual','reversal','correction','adjustment')),
  CONSTRAINT journal_type_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT journal_type_optlock_ck CHECK (version >= 1));
ALTER TABLE journal_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_type FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_type
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX journal_type_one_active ON journal_type (tenant_id, code) WHERE status = 'active';
COMMENT ON TABLE journal_type IS 'class=tenant_aggregate; m21 journal type (versioned)';

-- journal_config — versioned journal-engine config, immutable-after-publish (one active per scope), idempotency-keyed.
CREATE TABLE journal_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, name text,
  status text NOT NULL DEFAULT 'draft', require_balanced boolean NOT NULL DEFAULT true,
  allow_manual_draft boolean NOT NULL DEFAULT true, max_lines integer NOT NULL DEFAULT 1000,
  content_hash text, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT journal_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_config_ver_key UNIQUE (tenant_id, scope, version_number),
  CONSTRAINT journal_config_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT journal_config_maxlines_ck CHECK (max_lines > 0),
  -- require_balanced can never be turned off — journals ALWAYS balance before advancing (ADR-007).
  CONSTRAINT journal_config_balanced_ck CHECK (require_balanced = true),
  CONSTRAINT journal_config_optlock_ck CHECK (version >= 1));
ALTER TABLE journal_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX journal_config_one_active ON journal_config (tenant_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX journal_config_idem ON journal_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE journal_config IS 'class=tenant_aggregate; m21 journal-engine config (versioned, immutable-after-publish)';

-- journal_reason_code — configurable registry of deterministic validation reason codes (explainable + machine-readable).
CREATE TABLE journal_reason_code (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, category text NOT NULL DEFAULT 'structure', severity text NOT NULL DEFAULT 'error',
  description text, active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT journal_reason_code_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_reason_code_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_reason_code_code_key UNIQUE (tenant_id, code),
  CONSTRAINT journal_reason_code_cat_ck CHECK (category IN ('balance','period','account','currency','posting','structure')),
  CONSTRAINT journal_reason_code_sev_ck CHECK (severity IN ('error','warning','info')),
  CONSTRAINT journal_reason_code_optlock_ck CHECK (version >= 1));
ALTER TABLE journal_reason_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_reason_code FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_reason_code
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE journal_reason_code IS 'class=tenant_reference; m21 validation reason-code registry';

-- journal_recommendation — a DRAFT journal recommendation ingested from m20 (handoff), AI or operations. amount_minor
-- is INTEGER minor units. Debit/credit account suggestions live on journal_recommendation_line. Idempotent intake:
-- one recommendation per m20 handoff_ref. m21 copies under its OWN controls — it never reads m20/m19 tables.
CREATE TABLE journal_recommendation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_type text NOT NULL DEFAULT 'gl_reconciliation', source_ref uuid, handoff_ref uuid,
  entity_ref uuid, currency_ref uuid, amount_minor bigint NOT NULL DEFAULT 0, description text, reason_code text,
  confidence_band text, status text NOT NULL DEFAULT 'proposed', draft_id uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT journal_recommendation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_recommendation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_recommendation_source_ck CHECK (source_type IN ('gl_reconciliation','ai','operational','manual')),
  CONSTRAINT journal_recommendation_status_ck CHECK (status IN ('proposed','accepted','dismissed','converted')),
  CONSTRAINT journal_recommendation_band_ck CHECK (confidence_band IS NULL OR confidence_band IN ('exact','strong','partial','review','unmatched')),
  CONSTRAINT journal_recommendation_amount_ck CHECK (amount_minor >= 0),
  CONSTRAINT journal_recommendation_optlock_ck CHECK (version >= 1));
ALTER TABLE journal_recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_recommendation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_recommendation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX journal_recommendation_handoff ON journal_recommendation (tenant_id, handoff_ref) WHERE handoff_ref IS NOT NULL;
CREATE INDEX journal_recommendation_by_status ON journal_recommendation (tenant_id, status);
COMMENT ON TABLE journal_recommendation IS 'class=tenant_aggregate; m21 DRAFT journal recommendation intake (minor units)';

-- journal_recommendation_line — append-only proposed legs of a recommendation (opaque account_ref; minor units).
CREATE TABLE journal_recommendation_line (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recommendation_id uuid NOT NULL,
  line_no integer NOT NULL, account_ref uuid, direction text NOT NULL, amount_minor bigint NOT NULL,
  currency_ref uuid, description text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT journal_recommendation_line_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_recommendation_line_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_recommendation_line_no_key UNIQUE (tenant_id, recommendation_id, line_no),
  CONSTRAINT journal_recommendation_line_dir_ck CHECK (direction IN ('debit','credit')),
  CONSTRAINT journal_recommendation_line_amt_ck CHECK (amount_minor > 0),
  CONSTRAINT journal_recommendation_line_rec_fkey FOREIGN KEY (tenant_id, recommendation_id) REFERENCES journal_recommendation (tenant_id, id));
ALTER TABLE journal_recommendation_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_recommendation_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_recommendation_line
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX journal_recommendation_line_by_rec ON journal_recommendation_line (tenant_id, recommendation_id);
COMMENT ON TABLE journal_recommendation_line IS 'class=tenant_ledger_append_only; m21 recommendation leg (minor units)';

-- journal_recommendation_history — append-only recommendation lifecycle evidence.
CREATE TABLE journal_recommendation_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), recommendation_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_recommendation_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_recommendation_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_recommendation_history_rec_fkey FOREIGN KEY (tenant_id, recommendation_id) REFERENCES journal_recommendation (tenant_id, id));
ALTER TABLE journal_recommendation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_recommendation_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_recommendation_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX journal_recommendation_history_by_rec ON journal_recommendation_history (tenant_id, recommendation_id);
COMMENT ON TABLE journal_recommendation_history IS 'class=tenant_ledger_append_only; m21 recommendation history';

-- journal_draft — a DRAFT journal header. THE BALANCED-BEFORE-ADVANCE INVARIANT is DB-enforced: a draft may only
-- leave 'draft' once total debits == total credits (CHECK). is_balanced mirrors that equality exactly. entity_ref/
-- period_ref/currency_ref are OPAQUE m19 ids (no FK). period_status is the m19 period open/closed/locked state the
-- caller asserts and validation re-checks — the "no posting into a closed period" gate (ADR-078). Money is bigint
-- minor units — never float (ADR-007). A draft is NEVER approved or posted here (m22 approves; m23/m33 posts).
CREATE TABLE journal_draft (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  journal_type_id uuid, entity_ref uuid, period_ref uuid, period_status text NOT NULL DEFAULT 'open',
  currency_ref uuid, journal_date date, description text, source_type text NOT NULL DEFAULT 'manual', source_ref uuid,
  recommendation_id uuid, reference text,
  total_debits_minor bigint NOT NULL DEFAULT 0, total_credits_minor bigint NOT NULL DEFAULT 0,
  -- A fresh draft has 0 debits and 0 credits, which is arithmetically balanced (0 = 0); is_balanced therefore
  -- defaults true so the is_balanced = (debits = credits) invariant holds from insert. An empty draft still cannot
  -- advance (validation raises no_lines), so "balanced" here never means "postable".
  is_balanced boolean NOT NULL DEFAULT true, line_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft', requested_by uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT journal_draft_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_draft_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_draft_status_ck CHECK (status IN ('draft','validated','submitted','posted','withdrawn')),
  CONSTRAINT journal_draft_period_ck CHECK (period_status IN ('open','closed','locked')),
  CONSTRAINT journal_draft_source_ck CHECK (source_type IN ('gl_reconciliation','ai','operational','manual')),
  CONSTRAINT journal_draft_debits_ck CHECK (total_debits_minor >= 0),
  CONSTRAINT journal_draft_credits_ck CHECK (total_credits_minor >= 0),
  -- BALANCED BEFORE ADVANCE: a draft can only leave 'draft' when debits == credits (ADR-007, CLAUDE.md).
  CONSTRAINT journal_draft_balanced_ck CHECK (status = 'draft' OR total_debits_minor = total_credits_minor),
  -- is_balanced is the exact truth of debits == credits (deterministic).
  CONSTRAINT journal_draft_isbalanced_ck CHECK (is_balanced = (total_debits_minor = total_credits_minor)),
  CONSTRAINT journal_draft_optlock_ck CHECK (version >= 1),
  CONSTRAINT journal_draft_type_fkey FOREIGN KEY (tenant_id, journal_type_id) REFERENCES journal_type (tenant_id, id),
  CONSTRAINT journal_draft_rec_fkey FOREIGN KEY (tenant_id, recommendation_id) REFERENCES journal_recommendation (tenant_id, id));
ALTER TABLE journal_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_draft FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_draft
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX journal_draft_by_status ON journal_draft (tenant_id, status);
COMMENT ON TABLE journal_draft IS 'class=tenant_aggregate; m21 draft journal (balanced-before-advance, minor units)';

-- journal_line — a line of a draft journal. amount_minor is INTEGER minor units (> 0); direction is debit/credit.
-- No DELETE (ADR-010): a removed line transitions status 'active' -> 'removed' and drops out of the balance.
CREATE TABLE journal_line (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), draft_id uuid NOT NULL, line_no integer NOT NULL,
  account_ref uuid, direction text NOT NULL, amount_minor bigint NOT NULL, currency_ref uuid,
  cost_centre_ref uuid, dimension_ref uuid, tax_code_ref uuid, description text, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT journal_line_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_line_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_line_no_key UNIQUE (tenant_id, draft_id, line_no),
  CONSTRAINT journal_line_dir_ck CHECK (direction IN ('debit','credit')),
  CONSTRAINT journal_line_amt_ck CHECK (amount_minor > 0),
  CONSTRAINT journal_line_status_ck CHECK (status IN ('active','removed')),
  CONSTRAINT journal_line_optlock_ck CHECK (version >= 1),
  CONSTRAINT journal_line_draft_fkey FOREIGN KEY (tenant_id, draft_id) REFERENCES journal_draft (tenant_id, id));
ALTER TABLE journal_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_line
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX journal_line_by_draft ON journal_line (tenant_id, draft_id, status);
COMMENT ON TABLE journal_line IS 'class=tenant_aggregate; m21 journal line (minor units)';

-- journal_status_history — append-only draft lifecycle evidence.
CREATE TABLE journal_status_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), draft_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_status_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_status_history_draft_fkey FOREIGN KEY (tenant_id, draft_id) REFERENCES journal_draft (tenant_id, id));
ALTER TABLE journal_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_status_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX journal_status_history_by_draft ON journal_status_history (tenant_id, draft_id);
COMMENT ON TABLE journal_status_history IS 'class=tenant_ledger_append_only; m21 draft status history';

-- journal_draft_balance — append-only balance-invariant evidence for a draft. `balanced` records whether debits ==
-- credits (exact); variance is the exact integer difference (DB-enforced). Minor units — never float.
CREATE TABLE journal_draft_balance (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), draft_id uuid NOT NULL,
  debits_minor bigint NOT NULL, credits_minor bigint NOT NULL, variance_minor bigint NOT NULL DEFAULT 0,
  balanced boolean NOT NULL DEFAULT false, line_count integer NOT NULL DEFAULT 0,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT journal_draft_balance_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_draft_balance_id_key UNIQUE (tenant_id, id),
  -- THE BALANCE INVARIANT (deterministic, DB-enforced): balanced iff debits == credits; variance is exact (ADR-007).
  CONSTRAINT journal_draft_balance_balanced_ck CHECK (balanced = (debits_minor = credits_minor)),
  CONSTRAINT journal_draft_balance_var_ck CHECK (variance_minor = debits_minor - credits_minor),
  CONSTRAINT journal_draft_balance_draft_fkey FOREIGN KEY (tenant_id, draft_id) REFERENCES journal_draft (tenant_id, id));
ALTER TABLE journal_draft_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_draft_balance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_draft_balance
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX journal_draft_balance_by_draft ON journal_draft_balance (tenant_id, draft_id);
COMMENT ON TABLE journal_draft_balance IS 'class=tenant_ledger_append_only; m21 draft balance invariant evidence (minor units)';

-- journal_note — append-only note / evidence annotation on a draft.
CREATE TABLE journal_note (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), draft_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general', content text NOT NULL, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_note_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_note_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_note_type_ck CHECK (note_type IN ('general','review','validation','submission','posting')),
  CONSTRAINT journal_note_draft_fkey FOREIGN KEY (tenant_id, draft_id) REFERENCES journal_draft (tenant_id, id));
ALTER TABLE journal_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_note FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX journal_note_by_draft ON journal_note (tenant_id, draft_id);
COMMENT ON TABLE journal_note IS 'class=tenant_ledger_append_only; m21 note';

-- journal_validation — append-only deterministic validation-run evidence for a draft (balance/period/account/etc.).
CREATE TABLE journal_validation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), draft_id uuid NOT NULL,
  is_valid boolean NOT NULL, debits_minor bigint NOT NULL DEFAULT 0, credits_minor bigint NOT NULL DEFAULT 0,
  balanced boolean NOT NULL DEFAULT false, error_count integer NOT NULL DEFAULT 0, warning_count integer NOT NULL DEFAULT 0,
  by_user uuid, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_validation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_validation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_validation_balanced_ck CHECK (balanced = (debits_minor = credits_minor)),
  CONSTRAINT journal_validation_draft_fkey FOREIGN KEY (tenant_id, draft_id) REFERENCES journal_draft (tenant_id, id));
ALTER TABLE journal_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_validation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_validation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX journal_validation_by_draft ON journal_validation (tenant_id, draft_id);
COMMENT ON TABLE journal_validation IS 'class=tenant_ledger_append_only; m21 validation run evidence (minor units)';

-- journal_validation_finding — append-only per-reason validation findings (severity + machine-readable reason code).
CREATE TABLE journal_validation_finding (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), validation_id uuid NOT NULL, draft_id uuid NOT NULL,
  line_ref uuid, severity text NOT NULL DEFAULT 'error', reason_code text NOT NULL, detail text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_validation_finding_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_validation_finding_id_key UNIQUE (tenant_id, id),
  CONSTRAINT journal_validation_finding_sev_ck CHECK (severity IN ('error','warning','info')),
  CONSTRAINT journal_validation_finding_val_fkey FOREIGN KEY (tenant_id, validation_id) REFERENCES journal_validation (tenant_id, id),
  CONSTRAINT journal_validation_finding_draft_fkey FOREIGN KEY (tenant_id, draft_id) REFERENCES journal_draft (tenant_id, id));
ALTER TABLE journal_validation_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_validation_finding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_validation_finding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX journal_validation_finding_by_val ON journal_validation_finding (tenant_id, validation_id);
COMMENT ON TABLE journal_validation_finding IS 'class=tenant_ledger_append_only; m21 validation finding (reason codes)';

-- posting_request — an approval-gated request to post an approved draft (DRAFT-first MVP: PREPARED, never pushed).
-- The absolute posting controls are DB-enforced: no advance past 'prepared' without an opaque m22 approval_ref (no
-- posting without approval); no 'ready'/'submitted'/'succeeded' unless the period is open (no closed-period post);
-- the approver must not be the requester (maker != checker / SoD); idempotency-keyed (no duplicate posting).
CREATE TABLE posting_request (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), draft_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'prepared', approval_ref uuid, approved_by uuid, requested_by uuid,
  period_status text NOT NULL DEFAULT 'open', amount_minor bigint NOT NULL DEFAULT 0, external_system text,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT posting_request_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT posting_request_id_key UNIQUE (tenant_id, id),
  CONSTRAINT posting_request_status_ck CHECK (status IN ('prepared','ready','submitted','succeeded','failed','cancelled')),
  CONSTRAINT posting_request_period_ck CHECK (period_status IN ('open','closed','locked')),
  CONSTRAINT posting_request_amount_ck CHECK (amount_minor >= 0),
  -- NO POSTING WITHOUT APPROVAL: a request can only leave 'prepared' (except to cancel) with an m22 approval_ref.
  CONSTRAINT posting_request_approval_ck CHECK (status IN ('prepared','cancelled') OR approval_ref IS NOT NULL),
  -- NO POSTING INTO A CLOSED PERIOD: a request cannot become postable while the period is not open (ADR-078).
  CONSTRAINT posting_request_closedperiod_ck CHECK (status NOT IN ('ready','submitted','succeeded') OR period_status = 'open'),
  -- MAKER != CHECKER (SoD): the approver is never the requester (ADR-007, CLAUDE.md).
  CONSTRAINT posting_request_sod_ck CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT posting_request_optlock_ck CHECK (version >= 1),
  CONSTRAINT posting_request_draft_fkey FOREIGN KEY (tenant_id, draft_id) REFERENCES journal_draft (tenant_id, id));
ALTER TABLE posting_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON posting_request
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX posting_request_idem ON posting_request (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX posting_request_by_draft ON posting_request (tenant_id, draft_id, status);
COMMENT ON TABLE posting_request IS 'class=tenant_aggregate; m21 approval-gated posting request (DRAFT-first; posting deferred)';

-- posting_request_history — append-only posting-request lifecycle evidence.
CREATE TABLE posting_request_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), posting_request_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posting_request_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT posting_request_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT posting_request_history_req_fkey FOREIGN KEY (tenant_id, posting_request_id) REFERENCES posting_request (tenant_id, id));
ALTER TABLE posting_request_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_request_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON posting_request_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX posting_request_history_by_req ON posting_request_history (tenant_id, posting_request_id);
COMMENT ON TABLE posting_request_history IS 'class=tenant_ledger_append_only; m21 posting-request history';

-- posting_result — evidence of a posting attempt/outcome (DRAFT-first MVP: recorded, never produced by an external
-- push). external_ref is the confirmation id from a core system when posting is enabled later (m23/m33).
CREATE TABLE posting_result (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), posting_request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', external_system text, external_ref text, idempotency_key text,
  message text, reason_code text, recorded_by uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT posting_result_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT posting_result_id_key UNIQUE (tenant_id, id),
  CONSTRAINT posting_result_status_ck CHECK (status IN ('pending','succeeded','failed')),
  CONSTRAINT posting_result_optlock_ck CHECK (version >= 1),
  CONSTRAINT posting_result_req_fkey FOREIGN KEY (tenant_id, posting_request_id) REFERENCES posting_request (tenant_id, id));
ALTER TABLE posting_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_result FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON posting_result
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX posting_result_idem ON posting_result (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX posting_result_by_req ON posting_result (tenant_id, posting_request_id, status);
COMMENT ON TABLE posting_result IS 'class=tenant_aggregate; m21 posting-result evidence (DRAFT-first; posting deferred)';

-- posting_result_history — append-only posting-result lifecycle evidence.
CREATE TABLE posting_result_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), posting_result_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posting_result_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT posting_result_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT posting_result_history_res_fkey FOREIGN KEY (tenant_id, posting_result_id) REFERENCES posting_result (tenant_id, id));
ALTER TABLE posting_result_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_result_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON posting_result_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX posting_result_history_by_res ON posting_result_history (tenant_id, posting_result_id);
COMMENT ON TABLE posting_result_history IS 'class=tenant_ledger_append_only; m21 posting-result history';

-- posting_idempotency — append-only idempotency/command ledger. THE "no duplicate posting" guarantee (CLAUDE.md):
-- a posting idempotency key is unique per tenant, so a retried posting command is a safe no-op, never a double post.
CREATE TABLE posting_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, posting_request_id uuid, draft_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT posting_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT posting_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT posting_idempotency_key_uk UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT posting_idempotency_req_fkey FOREIGN KEY (tenant_id, posting_request_id) REFERENCES posting_request (tenant_id, id));
ALTER TABLE posting_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON posting_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE posting_idempotency IS 'class=tenant_ledger_append_only; m21 posting idempotency ledger (no duplicate posting)';
