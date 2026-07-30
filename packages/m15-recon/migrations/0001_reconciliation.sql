-- ---------------------------------------------------------------------------------------------------
-- M15-recon — bank reconciliation + the matching engine (Stage 3). Matches bank statement lines against book/
-- ledger entries with a deterministic, explainable rule engine (m15a); manages exceptions, manual review/override,
-- confidence bands + colour status, and audit-ready run summaries. It OWNS the reconciliation data + the matching
-- RULESETS; the matching LOGIC is the PURE m15a-matching engine (no tables). It owns NO chart of accounts (m19 —
-- referenced by opaque id), NO GL reconciliation (m20), NO journals/postings (m21), NO approval workflow (m22), NO
-- integration posting (m23), NO AI models (m27 — optional, separate). Money is INTEGER MINOR UNITS (bigint) — never
-- float (ADR-007, CLAUDE.md). Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE +
-- tenant_isolation, composite FKs, a `version` column on mutable aggregates. No DELETE grant (ADR-010); statement/
-- ledger lines + matches + exceptions transition by status. Match lines, candidates, manual decisions, status +
-- ruleset history, run summaries, notes and import errors are append-only (INSERT+SELECT, 0002). Duplicate imports
-- are blocked by a per-account file-hash unique index. m15 publishes reconciliation.lifecycle through the ONE m06
-- outbox; it never creates a second outbox. AI suggestions (m27) are optional — deterministic matching stands alone.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('reconciliation.bank_account.read', 'm15-recon', 'recon_bank_account', false),
  ('reconciliation.bank_account.manage', 'm15-recon', 'recon_bank_account', true),
  ('reconciliation.bank_account.deactivate', 'm15-recon', 'recon_bank_account', true),
  ('reconciliation.statement.import', 'm15-recon', 'recon_statement_import', false),
  ('reconciliation.statement.read', 'm15-recon', 'recon_statement_line', false),
  ('reconciliation.ledger.import', 'm15-recon', 'recon_ledger_import', false),
  ('reconciliation.ledger.read', 'm15-recon', 'recon_ledger_entry', false),
  ('reconciliation.run.read', 'm15-recon', 'recon_run', false),
  ('reconciliation.run.create', 'm15-recon', 'recon_run', false),
  ('reconciliation.run.start', 'm15-recon', 'recon_run', false),
  ('reconciliation.run.review', 'm15-recon', 'recon_run', false),
  ('reconciliation.run.complete', 'm15-recon', 'recon_run', false),
  ('reconciliation.run.reopen', 'm15-recon', 'recon_run', true),
  ('reconciliation.match.read', 'm15-recon', 'recon_match', false),
  ('reconciliation.match.run', 'm15-recon', 'recon_match', false),
  ('reconciliation.match.confirm', 'm15-recon', 'recon_match', false),
  ('reconciliation.match.reject', 'm15-recon', 'recon_match', false),
  ('reconciliation.match.unmatch', 'm15-recon', 'recon_match', true),
  ('reconciliation.ruleset.read', 'm15-recon', 'recon_matching_ruleset', false),
  ('reconciliation.ruleset.manage', 'm15-recon', 'recon_matching_ruleset', true),
  ('reconciliation.ruleset.publish', 'm15-recon', 'recon_matching_ruleset', true),
  ('reconciliation.exception.read', 'm15-recon', 'recon_exception', false),
  ('reconciliation.exception.resolve', 'm15-recon', 'recon_exception', false),
  ('reconciliation.exception.waive', 'm15-recon', 'recon_exception', true),
  ('reconciliation.manual.match', 'm15-recon', 'recon_manual_decision', true),
  ('reconciliation.manual.group', 'm15-recon', 'recon_manual_decision', true),
  ('reconciliation.analytics.read', 'm15-recon', 'recon_analytics', false),
  ('reconciliation.analytics.export', 'm15-recon', 'recon_analytics', true),
  ('reconciliation.platform.administer', 'm15-recon', 'recon_engine', true);

-- recon_bank_account — a bank account to reconcile. entity_ref/currency_ref are OPAQUE m19 finance ids (no FK).
CREATE TABLE recon_bank_account (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_ref uuid, currency_ref uuid, bank_name text NOT NULL, account_label text NOT NULL,
  account_ref_masked text, branch text, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recon_bank_account_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_bank_account_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_bank_account_status_ck CHECK (status IN ('active','inactive','archived')),
  CONSTRAINT recon_bank_account_optlock_ck CHECK (version >= 1));
ALTER TABLE recon_bank_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_bank_account FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_bank_account
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE recon_bank_account IS 'class=tenant_aggregate; m15 bank account';

-- recon_matching_ruleset — a versioned, immutable-after-publish matching ruleset (one active per code).
CREATE TABLE recon_matching_ruleset (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text, status text NOT NULL DEFAULT 'draft',
  date_window_days integer NOT NULL DEFAULT 5, amount_tolerance_minor bigint NOT NULL DEFAULT 0,
  require_opposite_direction boolean NOT NULL DEFAULT true, content_hash text, supersedes_id uuid, superseded_by_id uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recon_matching_ruleset_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_matching_ruleset_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_matching_ruleset_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT recon_matching_ruleset_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT recon_matching_ruleset_window_ck CHECK (date_window_days >= 0),
  CONSTRAINT recon_matching_ruleset_tol_ck CHECK (amount_tolerance_minor >= 0),
  CONSTRAINT recon_matching_ruleset_optlock_ck CHECK (version >= 1));
ALTER TABLE recon_matching_ruleset ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_matching_ruleset FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_matching_ruleset
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX recon_matching_ruleset_one_active ON recon_matching_ruleset (tenant_id, code) WHERE status = 'active';
COMMENT ON TABLE recon_matching_ruleset IS 'class=tenant_aggregate; m15 matching ruleset (versioned)';

-- recon_matching_rule — a rule within a ruleset (kind + integer weight). Consumed by the m15a engine.
CREATE TABLE recon_matching_rule (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), ruleset_id uuid NOT NULL,
  rule_code text NOT NULL, rule_kind text NOT NULL, weight integer NOT NULL DEFAULT 0, priority integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recon_matching_rule_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_matching_rule_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_matching_rule_key UNIQUE (tenant_id, ruleset_id, rule_code),
  CONSTRAINT recon_matching_rule_kind_ck CHECK (rule_kind IN ('exact_reference','exact_amount','date_window','similarity','composite')),
  CONSTRAINT recon_matching_rule_weight_ck CHECK (weight >= 0 AND weight <= 100),
  CONSTRAINT recon_matching_rule_optlock_ck CHECK (version >= 1),
  CONSTRAINT recon_matching_rule_ruleset_fkey FOREIGN KEY (tenant_id, ruleset_id) REFERENCES recon_matching_ruleset (tenant_id, id));
ALTER TABLE recon_matching_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_matching_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_matching_rule
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE recon_matching_rule IS 'class=tenant_reference; m15 matching rule';

-- recon_ruleset_history — append-only ruleset lifecycle evidence.
CREATE TABLE recon_ruleset_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), ruleset_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_ruleset_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_ruleset_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_ruleset_history_rs_fkey FOREIGN KEY (tenant_id, ruleset_id) REFERENCES recon_matching_ruleset (tenant_id, id));
ALTER TABLE recon_ruleset_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_ruleset_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_ruleset_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE recon_ruleset_history IS 'class=tenant_ledger_append_only; m15 ruleset history';

-- recon_statement_import — a bank statement import batch. Duplicate-protected by (bank_account, file_hash).
CREATE TABLE recon_statement_import (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), bank_account_id uuid NOT NULL,
  source_format text NOT NULL, file_hash text NOT NULL, file_name text, document_ref uuid,
  status text NOT NULL DEFAULT 'pending', line_count integer NOT NULL DEFAULT 0, period_start date, period_end date,
  idempotency_key text, version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recon_statement_import_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_statement_import_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_statement_import_format_ck CHECK (source_format IN ('csv','excel','pdf','api','manual')),
  CONSTRAINT recon_statement_import_status_ck CHECK (status IN ('pending','validated','imported','rejected')),
  CONSTRAINT recon_statement_import_optlock_ck CHECK (version >= 1),
  CONSTRAINT recon_statement_import_acct_fkey FOREIGN KEY (tenant_id, bank_account_id) REFERENCES recon_bank_account (tenant_id, id));
ALTER TABLE recon_statement_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_statement_import FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_statement_import
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX recon_statement_import_dedup ON recon_statement_import (tenant_id, bank_account_id, file_hash);
CREATE UNIQUE INDEX recon_statement_import_idem ON recon_statement_import (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE recon_statement_import IS 'class=tenant_aggregate; m15 statement import (dup-protected)';

-- recon_statement_line — a normalized bank statement line. amount_minor is INTEGER minor units.
CREATE TABLE recon_statement_line (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL, bank_account_id uuid NOT NULL, line_no integer NOT NULL,
  txn_date date NOT NULL, value_date date, amount_minor bigint NOT NULL, direction text NOT NULL,
  reference text, description text, counterparty_ref text, status text NOT NULL DEFAULT 'unmatched',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recon_statement_line_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_statement_line_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_statement_line_no_key UNIQUE (tenant_id, import_id, line_no),
  CONSTRAINT recon_statement_line_dir_ck CHECK (direction IN ('debit','credit')),
  CONSTRAINT recon_statement_line_status_ck CHECK (status IN ('unmatched','matched','partially_matched','excepted')),
  CONSTRAINT recon_statement_line_optlock_ck CHECK (version >= 1),
  CONSTRAINT recon_statement_line_import_fkey FOREIGN KEY (tenant_id, import_id) REFERENCES recon_statement_import (tenant_id, id),
  CONSTRAINT recon_statement_line_acct_fkey FOREIGN KEY (tenant_id, bank_account_id) REFERENCES recon_bank_account (tenant_id, id));
ALTER TABLE recon_statement_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_statement_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_statement_line
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_statement_line_by_acct ON recon_statement_line (tenant_id, bank_account_id, status);
COMMENT ON TABLE recon_statement_line IS 'class=tenant_aggregate; m15 statement line (minor units)';

-- recon_ledger_import — a book/ledger-side import batch (the records the statement is reconciled against).
CREATE TABLE recon_ledger_import (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), bank_account_id uuid NOT NULL,
  source_format text NOT NULL DEFAULT 'api', file_hash text, document_ref uuid, status text NOT NULL DEFAULT 'pending',
  entry_count integer NOT NULL DEFAULT 0, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recon_ledger_import_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_ledger_import_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_ledger_import_format_ck CHECK (source_format IN ('csv','excel','api','manual')),
  CONSTRAINT recon_ledger_import_status_ck CHECK (status IN ('pending','validated','imported','rejected')),
  CONSTRAINT recon_ledger_import_optlock_ck CHECK (version >= 1),
  CONSTRAINT recon_ledger_import_acct_fkey FOREIGN KEY (tenant_id, bank_account_id) REFERENCES recon_bank_account (tenant_id, id));
ALTER TABLE recon_ledger_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_ledger_import FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_ledger_import
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX recon_ledger_import_dedup ON recon_ledger_import (tenant_id, bank_account_id, file_hash) WHERE file_hash IS NOT NULL;
COMMENT ON TABLE recon_ledger_import IS 'class=tenant_aggregate; m15 ledger import';

-- recon_ledger_entry — a book/ledger record to match against. amount_minor is INTEGER minor units.
CREATE TABLE recon_ledger_entry (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  ledger_import_id uuid NOT NULL, bank_account_id uuid NOT NULL, entry_no integer,
  entry_date date NOT NULL, amount_minor bigint NOT NULL, direction text NOT NULL,
  reference text, description text, source_ref text, status text NOT NULL DEFAULT 'unmatched',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recon_ledger_entry_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_ledger_entry_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_ledger_entry_dir_ck CHECK (direction IN ('debit','credit')),
  CONSTRAINT recon_ledger_entry_status_ck CHECK (status IN ('unmatched','matched','partially_matched','excepted')),
  CONSTRAINT recon_ledger_entry_optlock_ck CHECK (version >= 1),
  CONSTRAINT recon_ledger_entry_import_fkey FOREIGN KEY (tenant_id, ledger_import_id) REFERENCES recon_ledger_import (tenant_id, id),
  CONSTRAINT recon_ledger_entry_acct_fkey FOREIGN KEY (tenant_id, bank_account_id) REFERENCES recon_bank_account (tenant_id, id));
ALTER TABLE recon_ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_ledger_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_ledger_entry
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_ledger_entry_by_acct ON recon_ledger_entry (tenant_id, bank_account_id, status);
COMMENT ON TABLE recon_ledger_entry IS 'class=tenant_aggregate; m15 ledger entry (minor units)';

-- recon_run — a reconciliation run over a bank account + period, using a ruleset. Balances are REFERENCES only.
CREATE TABLE recon_run (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL, ruleset_id uuid, period_start date, period_end date,
  opening_balance_minor bigint, closing_balance_minor bigint, status text NOT NULL DEFAULT 'draft',
  matched_count integer NOT NULL DEFAULT 0, unmatched_count integer NOT NULL DEFAULT 0, exception_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recon_run_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_run_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_run_status_ck CHECK (status IN ('draft','matching','review','completed','reopened')),
  CONSTRAINT recon_run_optlock_ck CHECK (version >= 1),
  CONSTRAINT recon_run_acct_fkey FOREIGN KEY (tenant_id, bank_account_id) REFERENCES recon_bank_account (tenant_id, id),
  CONSTRAINT recon_run_ruleset_fkey FOREIGN KEY (tenant_id, ruleset_id) REFERENCES recon_matching_ruleset (tenant_id, id));
ALTER TABLE recon_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_run
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_run_by_acct ON recon_run (tenant_id, bank_account_id, status);
COMMENT ON TABLE recon_run IS 'class=tenant_aggregate; m15 reconciliation run';

-- recon_status_history — append-only run lifecycle evidence.
CREATE TABLE recon_status_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_status_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_status_history_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES recon_run (tenant_id, id));
ALTER TABLE recon_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_status_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_status_history_by_run ON recon_status_history (tenant_id, run_id);
COMMENT ON TABLE recon_status_history IS 'class=tenant_ledger_append_only; m15 run status history';

-- recon_match — a reconciliation match (1:1 / 1:many / many:1 / split / grouped). Idempotency-keyed.
CREATE TABLE recon_match (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  match_type text NOT NULL, status text NOT NULL DEFAULT 'proposed', confidence_band text, colour_status text,
  score integer, amount_variance_minor bigint NOT NULL DEFAULT 0, matched_by text NOT NULL DEFAULT 'system',
  ruleset_id uuid, ruleset_version integer, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recon_match_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_match_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_match_type_ck CHECK (match_type IN ('one_to_one','one_to_many','many_to_one','many_to_many','split','grouped')),
  CONSTRAINT recon_match_status_ck CHECK (status IN ('proposed','confirmed','rejected','unmatched')),
  CONSTRAINT recon_match_band_ck CHECK (confidence_band IS NULL OR confidence_band IN ('exact','strong','partial','review','unmatched')),
  CONSTRAINT recon_match_by_ck CHECK (matched_by IN ('system','manual')),
  CONSTRAINT recon_match_score_ck CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  CONSTRAINT recon_match_optlock_ck CHECK (version >= 1),
  CONSTRAINT recon_match_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES recon_run (tenant_id, id),
  CONSTRAINT recon_match_ruleset_fkey FOREIGN KEY (tenant_id, ruleset_id) REFERENCES recon_matching_ruleset (tenant_id, id));
ALTER TABLE recon_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_match FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_match
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX recon_match_idem ON recon_match (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX recon_match_by_run ON recon_match (tenant_id, run_id, status);
COMMENT ON TABLE recon_match IS 'class=tenant_aggregate; m15 match';

-- recon_match_line — append-only members of a match (which statement lines + ledger entries; minor units).
CREATE TABLE recon_match_line (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), match_id uuid NOT NULL,
  side text NOT NULL, statement_line_id uuid, ledger_entry_id uuid, amount_minor bigint NOT NULL,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recon_match_line_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_match_line_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_match_line_side_ck CHECK (side IN ('statement','ledger')),
  CONSTRAINT recon_match_line_ref_ck CHECK ((side='statement' AND statement_line_id IS NOT NULL) OR (side='ledger' AND ledger_entry_id IS NOT NULL)),
  CONSTRAINT recon_match_line_match_fkey FOREIGN KEY (tenant_id, match_id) REFERENCES recon_match (tenant_id, id));
ALTER TABLE recon_match_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_match_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_match_line
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_match_line_by_match ON recon_match_line (tenant_id, match_id);
COMMENT ON TABLE recon_match_line IS 'class=tenant_ledger_append_only; m15 match member';

-- recon_match_candidate — append-only engine evidence (explainable score/variances/reason codes; reproducible).
CREATE TABLE recon_match_candidate (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  statement_line_id uuid, ledger_entry_id uuid, score integer NOT NULL, confidence_band text NOT NULL, colour_status text,
  amount_variance_minor bigint NOT NULL, date_variance_days integer, reference_match text, description_score numeric(4,3),
  direction_compatible boolean, reason_codes text[] NOT NULL DEFAULT '{}', rule_codes text[] NOT NULL DEFAULT '{}',
  ruleset_id uuid, ruleset_version integer, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_match_candidate_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_match_candidate_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_match_candidate_band_ck CHECK (confidence_band IN ('exact','strong','partial','review','unmatched')),
  CONSTRAINT recon_match_candidate_score_ck CHECK (score >= 0 AND score <= 100),
  CONSTRAINT recon_match_candidate_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES recon_run (tenant_id, id));
ALTER TABLE recon_match_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_match_candidate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_match_candidate
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_match_candidate_by_run ON recon_match_candidate (tenant_id, run_id);
COMMENT ON TABLE recon_match_candidate IS 'class=tenant_ledger_append_only; m15 engine candidate evidence';

-- recon_exception — an unmatched/exception item with aging + resolution status.
CREATE TABLE recon_exception (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  statement_line_id uuid, ledger_entry_id uuid, exception_type text NOT NULL, status text NOT NULL DEFAULT 'open',
  age_days integer NOT NULL DEFAULT 0, reason text, required boolean NOT NULL DEFAULT true, resolved_by uuid, resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT recon_exception_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_exception_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_exception_type_ck CHECK (exception_type IN ('unmatched_statement','unmatched_ledger','amount_mismatch','date_out_of_window','duplicate_suspect','ambiguous_match')),
  CONSTRAINT recon_exception_status_ck CHECK (status IN ('open','resolved','waived')),
  CONSTRAINT recon_exception_optlock_ck CHECK (version >= 1),
  CONSTRAINT recon_exception_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES recon_run (tenant_id, id));
ALTER TABLE recon_exception ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_exception FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_exception
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_exception_by_run ON recon_exception (tenant_id, run_id, status);
COMMENT ON TABLE recon_exception IS 'class=tenant_aggregate; m15 exception';

-- recon_manual_decision — append-only manual review/override evidence (never overwrites system evidence).
CREATE TABLE recon_manual_decision (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  decision_type text NOT NULL, match_id uuid, statement_line_id uuid, ledger_entry_id uuid, exception_id uuid,
  by_user uuid, reason text, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_manual_decision_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_manual_decision_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_manual_decision_type_ck CHECK (decision_type IN ('manual_match','unmatch','tick','group','split','waive','reopen')),
  CONSTRAINT recon_manual_decision_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES recon_run (tenant_id, id));
ALTER TABLE recon_manual_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_manual_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_manual_decision
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_manual_decision_by_run ON recon_manual_decision (tenant_id, run_id);
COMMENT ON TABLE recon_manual_decision IS 'class=tenant_ledger_append_only; m15 manual decision evidence';

-- recon_run_summary — append-only run-completion summary (matched/unmatched/exception counts + colour status).
CREATE TABLE recon_run_summary (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  matched_count integer NOT NULL DEFAULT 0, unmatched_count integer NOT NULL DEFAULT 0, exception_count integer NOT NULL DEFAULT 0,
  matched_amount_minor bigint NOT NULL DEFAULT 0, unmatched_amount_minor bigint NOT NULL DEFAULT 0, colour_status text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT recon_run_summary_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_run_summary_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_run_summary_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES recon_run (tenant_id, id));
ALTER TABLE recon_run_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_run_summary FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_run_summary
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_run_summary_by_run ON recon_run_summary (tenant_id, run_id);
COMMENT ON TABLE recon_run_summary IS 'class=tenant_ledger_append_only; m15 run summary';

-- recon_note — append-only reconciliation note / evidence annotation.
CREATE TABLE recon_note (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general', content text NOT NULL, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_note_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_note_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_note_type_ck CHECK (note_type IN ('general','review','exception','escalation')),
  CONSTRAINT recon_note_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES recon_run (tenant_id, id));
ALTER TABLE recon_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_note FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_note_by_run ON recon_note (tenant_id, run_id);
COMMENT ON TABLE recon_note IS 'class=tenant_ledger_append_only; m15 note';

-- recon_import_error — append-only import validation errors (statement or ledger import).
CREATE TABLE recon_import_error (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), import_id uuid NOT NULL, import_kind text NOT NULL,
  line_no integer, error_code text NOT NULL, detail text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_import_error_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT recon_import_error_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recon_import_error_kind_ck CHECK (import_kind IN ('statement','ledger')));
ALTER TABLE recon_import_error ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_import_error FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recon_import_error
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX recon_import_error_by_import ON recon_import_error (tenant_id, import_id);
COMMENT ON TABLE recon_import_error IS 'class=tenant_ledger_append_only; m15 import error';
