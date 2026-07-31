-- ---------------------------------------------------------------------------------------------------
-- M20-glrecon — general-ledger reconciliation (Stage 3). Reconciles GL balances + transactions against a source
-- system, enforces the balance invariant (opening + debits - credits = calculated closing) in INTEGER MINOR UNITS,
-- matches GL lines against source records with a deterministic, explainable engine (REUSES the PURE m15a engine —
-- no duplicated matching logic), manages reconciling items + exceptions with aging, certifies balances, and produces
-- DRAFT journal recommendations handed off to m21. It OWNS the GL-reconciliation data; it NEVER posts a journal,
-- writes to the general ledger, or approves anything. It owns NO chart of accounts (m19 — gl_account_ref/currency_ref
-- are OPAQUE ids, no FK), NO bank reconciliation (m15), NO journal posting (m21), NO approval workflow (m22), NO
-- integration posting (m23), NO AI (m27). Money is INTEGER MINOR UNITS (bigint) — never float (ADR-007, CLAUDE.md).
-- Every tenant-scoped table: composite (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite
-- FKs, a `version` column on mutable aggregates. No DELETE grant (ADR-010); imports/lines/runs/matches/items/
-- exceptions/certifications transition by status. Ruleset/status/certification history, import errors, run balances,
-- match lines, engine candidates, manual decisions, run summaries and notes are append-only (INSERT+SELECT, 0002).
-- Duplicate imports are blocked by a per-account file-hash unique index. m20 publishes glrecon.lifecycle through the
-- ONE m06 outbox; it never creates a second outbox. Recommendations are DRAFT-only (gl_journal_recommendation.is_draft
-- is always true) — the human posts through m21/m22.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('gl_reconciliation.account.read', 'm20-glrecon', 'gl_recon_account', false),
  ('gl_reconciliation.account.manage', 'm20-glrecon', 'gl_recon_account', true),
  ('gl_reconciliation.account.deactivate', 'm20-glrecon', 'gl_recon_account', true),
  ('gl_reconciliation.import.create', 'm20-glrecon', 'gl_import', false),
  ('gl_reconciliation.import.read', 'm20-glrecon', 'gl_line', false),
  ('gl_reconciliation.import.validate', 'm20-glrecon', 'gl_import', false),
  ('gl_reconciliation.import.accept', 'm20-glrecon', 'gl_import', false),
  ('gl_reconciliation.import.reject', 'm20-glrecon', 'gl_import', false),
  ('gl_reconciliation.source.import', 'm20-glrecon', 'gl_source_import', false),
  ('gl_reconciliation.ruleset.read', 'm20-glrecon', 'gl_ruleset', false),
  ('gl_reconciliation.ruleset.manage', 'm20-glrecon', 'gl_ruleset', true),
  ('gl_reconciliation.ruleset.publish', 'm20-glrecon', 'gl_ruleset', true),
  ('gl_reconciliation.run.read', 'm20-glrecon', 'gl_recon_run', false),
  ('gl_reconciliation.run.create', 'm20-glrecon', 'gl_recon_run', false),
  ('gl_reconciliation.run.execute', 'm20-glrecon', 'gl_recon_run', false),
  ('gl_reconciliation.run.reopen', 'm20-glrecon', 'gl_recon_run', true),
  ('gl_reconciliation.match.read', 'm20-glrecon', 'gl_match', false),
  ('gl_reconciliation.match.review', 'm20-glrecon', 'gl_match', false),
  ('gl_reconciliation.match.manual', 'm20-glrecon', 'gl_manual_decision', true),
  ('gl_reconciliation.match.unmatch', 'm20-glrecon', 'gl_match', true),
  ('gl_reconciliation.item.read', 'm20-glrecon', 'gl_reconciling_item', false),
  ('gl_reconciliation.item.manage', 'm20-glrecon', 'gl_reconciling_item', false),
  ('gl_reconciliation.exception.read', 'm20-glrecon', 'gl_exception', false),
  ('gl_reconciliation.exception.assign', 'm20-glrecon', 'gl_exception', false),
  ('gl_reconciliation.exception.resolve', 'm20-glrecon', 'gl_exception', false),
  ('gl_reconciliation.exception.waive', 'm20-glrecon', 'gl_exception', true),
  ('gl_reconciliation.certification.read', 'm20-glrecon', 'gl_certification', false),
  ('gl_reconciliation.certification.create', 'm20-glrecon', 'gl_certification', false),
  ('gl_reconciliation.certification.override', 'm20-glrecon', 'gl_certification', true),
  ('gl_reconciliation.recommendation.read', 'm20-glrecon', 'gl_journal_recommendation', false),
  ('gl_reconciliation.recommendation.create', 'm20-glrecon', 'gl_journal_recommendation', false),
  ('gl_reconciliation.recommendation.withdraw', 'm20-glrecon', 'gl_journal_recommendation', false),
  ('gl_reconciliation.analytics.read', 'm20-glrecon', 'gl_analytics', false),
  ('gl_reconciliation.analytics.export', 'm20-glrecon', 'gl_analytics', true),
  ('gl_reconciliation.platform.administer', 'm20-glrecon', 'gl_engine', true);

-- gl_recon_account — a GL account to reconcile. gl_account_ref/currency_ref are OPAQUE m19 finance ids (no FK).
CREATE TABLE gl_recon_account (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  gl_account_ref uuid, currency_ref uuid, source_system text NOT NULL DEFAULT 'ledger',
  code text NOT NULL, name text NOT NULL, normal_side text NOT NULL DEFAULT 'debit', status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_recon_account_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_recon_account_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_recon_account_code_key UNIQUE (tenant_id, code),
  CONSTRAINT gl_recon_account_side_ck CHECK (normal_side IN ('debit','credit')),
  CONSTRAINT gl_recon_account_status_ck CHECK (status IN ('active','inactive','archived')),
  CONSTRAINT gl_recon_account_optlock_ck CHECK (version >= 1));
ALTER TABLE gl_recon_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_recon_account FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_recon_account
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE gl_recon_account IS 'class=tenant_aggregate; m20 GL reconciliation account';

-- gl_ruleset — a versioned, immutable-after-publish reconciliation ruleset (one active per code).
CREATE TABLE gl_ruleset (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version_number integer NOT NULL DEFAULT 1, name text, status text NOT NULL DEFAULT 'draft',
  date_window_days integer NOT NULL DEFAULT 5, amount_tolerance_minor bigint NOT NULL DEFAULT 0,
  require_opposite_direction boolean NOT NULL DEFAULT true, content_hash text, supersedes_id uuid, superseded_by_id uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_ruleset_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_ruleset_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_ruleset_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT gl_ruleset_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT gl_ruleset_window_ck CHECK (date_window_days >= 0),
  CONSTRAINT gl_ruleset_tol_ck CHECK (amount_tolerance_minor >= 0),
  CONSTRAINT gl_ruleset_optlock_ck CHECK (version >= 1));
ALTER TABLE gl_ruleset ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_ruleset FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_ruleset
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX gl_ruleset_one_active ON gl_ruleset (tenant_id, code) WHERE status = 'active';
COMMENT ON TABLE gl_ruleset IS 'class=tenant_aggregate; m20 GL reconciliation ruleset (versioned)';

-- gl_rule — a rule within a ruleset (kind + integer weight). Consumed by the m15a engine.
CREATE TABLE gl_rule (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), ruleset_id uuid NOT NULL,
  rule_code text NOT NULL, rule_kind text NOT NULL, weight integer NOT NULL DEFAULT 0, priority integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT gl_rule_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_rule_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_rule_key UNIQUE (tenant_id, ruleset_id, rule_code),
  CONSTRAINT gl_rule_kind_ck CHECK (rule_kind IN ('exact_reference','exact_amount','date_window','similarity','composite')),
  CONSTRAINT gl_rule_weight_ck CHECK (weight >= 0 AND weight <= 100),
  CONSTRAINT gl_rule_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_rule_ruleset_fkey FOREIGN KEY (tenant_id, ruleset_id) REFERENCES gl_ruleset (tenant_id, id));
ALTER TABLE gl_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_rule
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE gl_rule IS 'class=tenant_reference; m20 reconciliation rule';

-- gl_ruleset_history — append-only ruleset lifecycle evidence.
CREATE TABLE gl_ruleset_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), ruleset_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_ruleset_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_ruleset_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_ruleset_history_rs_fkey FOREIGN KEY (tenant_id, ruleset_id) REFERENCES gl_ruleset (tenant_id, id));
ALTER TABLE gl_ruleset_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_ruleset_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_ruleset_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE gl_ruleset_history IS 'class=tenant_ledger_append_only; m20 ruleset history';

-- gl_import — a GL import batch (balances + transactions). Duplicate-protected by (account, file_hash).
CREATE TABLE gl_import (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), gl_account_id uuid NOT NULL,
  source_format text NOT NULL, file_hash text NOT NULL, file_name text, document_ref uuid,
  status text NOT NULL DEFAULT 'created', line_count integer NOT NULL DEFAULT 0, period_start date, period_end date,
  idempotency_key text, version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_import_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_import_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_import_format_ck CHECK (source_format IN ('csv','excel','pdf','api','manual')),
  CONSTRAINT gl_import_status_ck CHECK (status IN ('created','validated','accepted','rejected')),
  CONSTRAINT gl_import_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_import_acct_fkey FOREIGN KEY (tenant_id, gl_account_id) REFERENCES gl_recon_account (tenant_id, id));
ALTER TABLE gl_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_import FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_import
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX gl_import_dedup ON gl_import (tenant_id, gl_account_id, file_hash);
CREATE UNIQUE INDEX gl_import_idem ON gl_import (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE gl_import IS 'class=tenant_aggregate; m20 GL import (dup-protected)';

-- gl_import_error — append-only import validation errors (GL or source import).
CREATE TABLE gl_import_error (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), import_id uuid NOT NULL, import_kind text NOT NULL,
  line_no integer, error_code text NOT NULL, detail text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_import_error_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_import_error_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_import_error_kind_ck CHECK (import_kind IN ('gl','source')));
ALTER TABLE gl_import_error ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_import_error FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_import_error
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_import_error_by_import ON gl_import_error (tenant_id, import_id);
COMMENT ON TABLE gl_import_error IS 'class=tenant_ledger_append_only; m20 import error';

-- gl_balance — an imported GL balance snapshot for an account + period. Holds the balance-invariant inputs; the
-- calculated closing MUST equal opening + debits - credits (enforced by CHECK). All amounts are INTEGER MINOR UNITS.
CREATE TABLE gl_balance (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  gl_account_id uuid NOT NULL, import_id uuid, currency_ref uuid, period_start date NOT NULL, period_end date NOT NULL,
  opening_balance_minor bigint NOT NULL DEFAULT 0, debits_minor bigint NOT NULL DEFAULT 0,
  credits_minor bigint NOT NULL DEFAULT 0, closing_balance_minor bigint NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'imported',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_balance_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_balance_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_balance_period_key UNIQUE (tenant_id, gl_account_id, period_start, period_end),
  CONSTRAINT gl_balance_status_ck CHECK (status IN ('imported','reconciled','certified')),
  -- THE BALANCE INVARIANT (deterministic, DB-enforced): closing = opening + debits - credits (ADR-088).
  CONSTRAINT gl_balance_invariant_ck CHECK (closing_balance_minor = opening_balance_minor + debits_minor - credits_minor),
  CONSTRAINT gl_balance_debits_ck CHECK (debits_minor >= 0),
  CONSTRAINT gl_balance_credits_ck CHECK (credits_minor >= 0),
  CONSTRAINT gl_balance_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_balance_acct_fkey FOREIGN KEY (tenant_id, gl_account_id) REFERENCES gl_recon_account (tenant_id, id),
  CONSTRAINT gl_balance_import_fkey FOREIGN KEY (tenant_id, import_id) REFERENCES gl_import (tenant_id, id));
ALTER TABLE gl_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_balance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_balance
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE gl_balance IS 'class=tenant_aggregate; m20 GL balance snapshot (invariant-checked, minor units)';

-- gl_line — a GL transaction line. amount_minor is INTEGER minor units.
CREATE TABLE gl_line (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL, gl_account_id uuid NOT NULL, line_no integer NOT NULL,
  txn_date date NOT NULL, amount_minor bigint NOT NULL, direction text NOT NULL,
  reference text, description text, source_ref text, status text NOT NULL DEFAULT 'unmatched',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_line_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_line_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_line_no_key UNIQUE (tenant_id, import_id, line_no),
  CONSTRAINT gl_line_dir_ck CHECK (direction IN ('debit','credit')),
  CONSTRAINT gl_line_status_ck CHECK (status IN ('unmatched','matched','partially_matched','excepted')),
  CONSTRAINT gl_line_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_line_import_fkey FOREIGN KEY (tenant_id, import_id) REFERENCES gl_import (tenant_id, id),
  CONSTRAINT gl_line_acct_fkey FOREIGN KEY (tenant_id, gl_account_id) REFERENCES gl_recon_account (tenant_id, id));
ALTER TABLE gl_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_line
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_line_by_acct ON gl_line (tenant_id, gl_account_id, status);
COMMENT ON TABLE gl_line IS 'class=tenant_aggregate; m20 GL line (minor units)';

-- gl_source_import — a source-system import batch (the records the GL is reconciled against).
CREATE TABLE gl_source_import (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), gl_account_id uuid NOT NULL,
  source_system text NOT NULL DEFAULT 'source', source_format text NOT NULL DEFAULT 'api', file_hash text, document_ref uuid,
  status text NOT NULL DEFAULT 'created', entry_count integer NOT NULL DEFAULT 0, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_source_import_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_source_import_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_source_import_format_ck CHECK (source_format IN ('csv','excel','api','manual')),
  CONSTRAINT gl_source_import_status_ck CHECK (status IN ('created','validated','accepted','rejected')),
  CONSTRAINT gl_source_import_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_source_import_acct_fkey FOREIGN KEY (tenant_id, gl_account_id) REFERENCES gl_recon_account (tenant_id, id));
ALTER TABLE gl_source_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_source_import FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_source_import
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX gl_source_import_dedup ON gl_source_import (tenant_id, gl_account_id, file_hash) WHERE file_hash IS NOT NULL;
COMMENT ON TABLE gl_source_import IS 'class=tenant_aggregate; m20 source import';

-- gl_source_line — a source-system record to match against. amount_minor is INTEGER minor units.
CREATE TABLE gl_source_line (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_import_id uuid NOT NULL, gl_account_id uuid NOT NULL, line_no integer,
  entry_date date NOT NULL, amount_minor bigint NOT NULL, direction text NOT NULL,
  reference text, description text, source_ref text, status text NOT NULL DEFAULT 'unmatched',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_source_line_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_source_line_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_source_line_dir_ck CHECK (direction IN ('debit','credit')),
  CONSTRAINT gl_source_line_status_ck CHECK (status IN ('unmatched','matched','partially_matched','excepted')),
  CONSTRAINT gl_source_line_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_source_line_import_fkey FOREIGN KEY (tenant_id, source_import_id) REFERENCES gl_source_import (tenant_id, id),
  CONSTRAINT gl_source_line_acct_fkey FOREIGN KEY (tenant_id, gl_account_id) REFERENCES gl_recon_account (tenant_id, id));
ALTER TABLE gl_source_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_source_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_source_line
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_source_line_by_acct ON gl_source_line (tenant_id, gl_account_id, status);
COMMENT ON TABLE gl_source_line IS 'class=tenant_aggregate; m20 source line (minor units)';

-- gl_recon_run — a reconciliation run over a GL account + period, using a ruleset. Balances are REFERENCES only.
CREATE TABLE gl_recon_run (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  gl_account_id uuid NOT NULL, ruleset_id uuid, period_start date, period_end date,
  opening_balance_minor bigint, closing_balance_minor bigint, status text NOT NULL DEFAULT 'draft',
  matched_count integer NOT NULL DEFAULT 0, unmatched_count integer NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0, item_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_recon_run_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_recon_run_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_recon_run_status_ck CHECK (status IN ('draft','running','review_required','completed','failed','reopened')),
  CONSTRAINT gl_recon_run_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_recon_run_acct_fkey FOREIGN KEY (tenant_id, gl_account_id) REFERENCES gl_recon_account (tenant_id, id),
  CONSTRAINT gl_recon_run_ruleset_fkey FOREIGN KEY (tenant_id, ruleset_id) REFERENCES gl_ruleset (tenant_id, id));
ALTER TABLE gl_recon_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_recon_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_recon_run
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_recon_run_by_acct ON gl_recon_run (tenant_id, gl_account_id, status);
COMMENT ON TABLE gl_recon_run IS 'class=tenant_aggregate; m20 GL reconciliation run';

-- gl_run_status_history — append-only run lifecycle evidence.
CREATE TABLE gl_run_status_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_run_status_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_run_status_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_run_status_history_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id));
ALTER TABLE gl_run_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_run_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_run_status_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_run_status_history_by_run ON gl_run_status_history (tenant_id, run_id);
COMMENT ON TABLE gl_run_status_history IS 'class=tenant_ledger_append_only; m20 run status history';

-- gl_run_balance — append-only balance-invariant evidence for a run. calculated_closing MUST equal opening + debits
-- - credits (DB-enforced); `balanced` records whether the calculated closing equals the source closing (exact).
CREATE TABLE gl_run_balance (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  opening_minor bigint NOT NULL, debits_minor bigint NOT NULL, credits_minor bigint NOT NULL,
  calculated_closing_minor bigint NOT NULL, source_closing_minor bigint, variance_minor bigint NOT NULL DEFAULT 0, balanced boolean NOT NULL DEFAULT false,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT gl_run_balance_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_run_balance_id_key UNIQUE (tenant_id, id),
  -- THE BALANCE INVARIANT (deterministic, DB-enforced): calculated closing = opening + debits - credits (ADR-088).
  CONSTRAINT gl_run_balance_invariant_ck CHECK (calculated_closing_minor = opening_minor + debits_minor - credits_minor),
  CONSTRAINT gl_run_balance_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id));
ALTER TABLE gl_run_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_run_balance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_run_balance
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_run_balance_by_run ON gl_run_balance (tenant_id, run_id);
COMMENT ON TABLE gl_run_balance IS 'class=tenant_ledger_append_only; m20 run balance invariant evidence (minor units)';

-- gl_match — a reconciliation match (1:1 / 1:many / many:1 / grouped / split). Idempotency-keyed.
CREATE TABLE gl_match (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  match_type text NOT NULL, status text NOT NULL DEFAULT 'proposed', confidence_band text, colour_status text,
  score integer, amount_variance_minor bigint NOT NULL DEFAULT 0, matched_by text NOT NULL DEFAULT 'system',
  ruleset_id uuid, ruleset_version integer, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_match_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_match_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_match_type_ck CHECK (match_type IN ('one_to_one','one_to_many','many_to_one','many_to_many','split','grouped')),
  CONSTRAINT gl_match_status_ck CHECK (status IN ('proposed','confirmed','rejected','unmatched')),
  CONSTRAINT gl_match_band_ck CHECK (confidence_band IS NULL OR confidence_band IN ('exact','strong','partial','review','unmatched')),
  CONSTRAINT gl_match_by_ck CHECK (matched_by IN ('system','manual')),
  CONSTRAINT gl_match_score_ck CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  CONSTRAINT gl_match_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_match_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id),
  CONSTRAINT gl_match_ruleset_fkey FOREIGN KEY (tenant_id, ruleset_id) REFERENCES gl_ruleset (tenant_id, id));
ALTER TABLE gl_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_match FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_match
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX gl_match_idem ON gl_match (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX gl_match_by_run ON gl_match (tenant_id, run_id, status);
COMMENT ON TABLE gl_match IS 'class=tenant_aggregate; m20 match';

-- gl_match_line — append-only members of a match (which GL lines + source lines; minor units).
CREATE TABLE gl_match_line (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), match_id uuid NOT NULL,
  side text NOT NULL, gl_line_id uuid, source_line_id uuid, amount_minor bigint NOT NULL,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT gl_match_line_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_match_line_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_match_line_side_ck CHECK (side IN ('gl','source')),
  CONSTRAINT gl_match_line_ref_ck CHECK ((side='gl' AND gl_line_id IS NOT NULL) OR (side='source' AND source_line_id IS NOT NULL)),
  CONSTRAINT gl_match_line_match_fkey FOREIGN KEY (tenant_id, match_id) REFERENCES gl_match (tenant_id, id));
ALTER TABLE gl_match_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_match_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_match_line
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_match_line_by_match ON gl_match_line (tenant_id, match_id);
COMMENT ON TABLE gl_match_line IS 'class=tenant_ledger_append_only; m20 match member';

-- gl_match_candidate — append-only engine evidence (explainable score/variances/reason codes; reproducible).
CREATE TABLE gl_match_candidate (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  gl_line_id uuid, source_line_id uuid, score integer NOT NULL, confidence_band text NOT NULL, colour_status text,
  amount_variance_minor bigint NOT NULL, date_variance_days integer, reference_match text, description_score numeric(4,3),
  direction_compatible boolean, reason_codes text[] NOT NULL DEFAULT '{}', rule_codes text[] NOT NULL DEFAULT '{}',
  ruleset_id uuid, ruleset_version integer, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_match_candidate_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_match_candidate_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_match_candidate_band_ck CHECK (confidence_band IN ('exact','strong','partial','review','unmatched')),
  CONSTRAINT gl_match_candidate_score_ck CHECK (score >= 0 AND score <= 100),
  CONSTRAINT gl_match_candidate_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id));
ALTER TABLE gl_match_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_match_candidate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_match_candidate
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_match_candidate_by_run ON gl_match_candidate (tenant_id, run_id);
COMMENT ON TABLE gl_match_candidate IS 'class=tenant_ledger_append_only; m20 engine candidate evidence';

-- gl_reconciling_item — a reconciling item (timing/unposted/etc.) with aging + clearance status.
CREATE TABLE gl_reconciling_item (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  item_type text NOT NULL, gl_line_id uuid, source_line_id uuid, amount_minor bigint NOT NULL, direction text,
  status text NOT NULL DEFAULT 'open', age_days integer NOT NULL DEFAULT 0, reason text, cleared_by uuid, cleared_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_reconciling_item_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_reconciling_item_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_reconciling_item_type_ck CHECK (item_type IN ('timing_difference','unposted_gl','unposted_source','fx_difference','error_correction','other')),
  CONSTRAINT gl_reconciling_item_status_ck CHECK (status IN ('open','cleared','waived')),
  CONSTRAINT gl_reconciling_item_dir_ck CHECK (direction IS NULL OR direction IN ('debit','credit')),
  CONSTRAINT gl_reconciling_item_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_reconciling_item_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id));
ALTER TABLE gl_reconciling_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_reconciling_item FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_reconciling_item
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_reconciling_item_by_run ON gl_reconciling_item (tenant_id, run_id, status);
COMMENT ON TABLE gl_reconciling_item IS 'class=tenant_aggregate; m20 reconciling item (minor units)';

-- gl_exception — an exception with aging + review/resolution status.
CREATE TABLE gl_exception (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  gl_line_id uuid, source_line_id uuid, exception_type text NOT NULL, status text NOT NULL DEFAULT 'open',
  assigned_to uuid, age_days integer NOT NULL DEFAULT 0, reason text, required boolean NOT NULL DEFAULT true, resolved_by uuid, resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_exception_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_exception_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_exception_type_ck CHECK (exception_type IN ('opening_balance_mismatch','closing_balance_mismatch','unmatched_gl','unmatched_source','amount_mismatch','date_out_of_window','duplicate_suspect','out_of_period','currency_mismatch','unsupported_type','unresolved_variance')),
  CONSTRAINT gl_exception_status_ck CHECK (status IN ('open','under_review','resolved','waived')),
  CONSTRAINT gl_exception_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_exception_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id));
ALTER TABLE gl_exception ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_exception FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_exception
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_exception_by_run ON gl_exception (tenant_id, run_id, status);
COMMENT ON TABLE gl_exception IS 'class=tenant_aggregate; m20 exception';

-- gl_manual_decision — append-only manual review/override evidence (never overwrites system evidence).
CREATE TABLE gl_manual_decision (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  decision_type text NOT NULL, match_id uuid, gl_line_id uuid, source_line_id uuid, exception_id uuid, item_id uuid,
  by_user uuid, reason text, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_manual_decision_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_manual_decision_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_manual_decision_type_ck CHECK (decision_type IN ('manual_match','unmatch','tick','group','split','clear_item','waive','reopen','assign')),
  CONSTRAINT gl_manual_decision_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id));
ALTER TABLE gl_manual_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_manual_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_manual_decision
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_manual_decision_by_run ON gl_manual_decision (tenant_id, run_id);
COMMENT ON TABLE gl_manual_decision IS 'class=tenant_ledger_append_only; m20 manual decision evidence';

-- gl_certification — a balance certification. A balance with unresolved blocking exceptions may only be certified
-- through a privileged override (is_override + override_reason, gl_reconciliation.certification.override).
CREATE TABLE gl_certification (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL, gl_account_id uuid NOT NULL,
  period_start date, period_end date, currency_ref uuid,
  calculated_balance_minor bigint NOT NULL DEFAULT 0, source_balance_minor bigint NOT NULL DEFAULT 0, variance_minor bigint NOT NULL DEFAULT 0,
  unresolved_exception_count integer NOT NULL DEFAULT 0, open_item_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft', is_override boolean NOT NULL DEFAULT false, override_reason text,
  certified_by uuid, certified_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_certification_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_certification_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_certification_status_ck CHECK (status IN ('draft','certified','rejected')),
  -- An override MUST carry a reason (fail closed) — no silent certification over open blockers (ADR-089).
  CONSTRAINT gl_certification_override_ck CHECK (is_override = false OR override_reason IS NOT NULL),
  CONSTRAINT gl_certification_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_certification_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id),
  CONSTRAINT gl_certification_acct_fkey FOREIGN KEY (tenant_id, gl_account_id) REFERENCES gl_recon_account (tenant_id, id));
ALTER TABLE gl_certification ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_certification FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_certification
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_certification_by_run ON gl_certification (tenant_id, run_id, status);
COMMENT ON TABLE gl_certification IS 'class=tenant_aggregate; m20 balance certification (minor units)';

-- gl_certification_history — append-only certification lifecycle evidence.
CREATE TABLE gl_certification_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), certification_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, is_override boolean NOT NULL DEFAULT false, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_certification_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_certification_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_certification_history_cert_fkey FOREIGN KEY (tenant_id, certification_id) REFERENCES gl_certification (tenant_id, id));
ALTER TABLE gl_certification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_certification_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_certification_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_certification_history_by_cert ON gl_certification_history (tenant_id, certification_id);
COMMENT ON TABLE gl_certification_history IS 'class=tenant_ledger_append_only; m20 certification history';

-- gl_journal_recommendation — a DRAFT journal recommendation handed off to m21. It NEVER posts or approves:
-- is_draft is always true (CHECK). debit/credit account suggestions are OPAQUE m19 refs (no FK). Money is minor units.
CREATE TABLE gl_journal_recommendation (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  exception_id uuid, reconciling_item_id uuid, debit_account_ref uuid, credit_account_ref uuid,
  amount_minor bigint NOT NULL, currency_ref uuid, description text, reason_code text, confidence_band text,
  status text NOT NULL DEFAULT 'proposed', is_draft boolean NOT NULL DEFAULT true, handoff_ref uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT gl_journal_recommendation_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_journal_recommendation_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_journal_recommendation_status_ck CHECK (status IN ('proposed','withdrawn','handed_off')),
  CONSTRAINT gl_journal_recommendation_band_ck CHECK (confidence_band IS NULL OR confidence_band IN ('exact','strong','partial','review','unmatched')),
  CONSTRAINT gl_journal_recommendation_amount_ck CHECK (amount_minor >= 0),
  -- DRAFT ONLY: m20 recommends; it NEVER posts a journal or writes to the GL (CLAUDE.md, ADR-090).
  CONSTRAINT gl_journal_recommendation_draft_ck CHECK (is_draft = true),
  CONSTRAINT gl_journal_recommendation_optlock_ck CHECK (version >= 1),
  CONSTRAINT gl_journal_recommendation_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id));
ALTER TABLE gl_journal_recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_journal_recommendation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_journal_recommendation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_journal_recommendation_by_run ON gl_journal_recommendation (tenant_id, run_id, status);
COMMENT ON TABLE gl_journal_recommendation IS 'class=tenant_aggregate; m20 DRAFT journal recommendation (minor units; never posts)';

-- gl_run_summary — append-only run-completion summary (matched/unmatched/exception/item counts + balance variance).
CREATE TABLE gl_run_summary (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  matched_count integer NOT NULL DEFAULT 0, unmatched_count integer NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0, item_count integer NOT NULL DEFAULT 0,
  matched_amount_minor bigint NOT NULL DEFAULT 0, unmatched_amount_minor bigint NOT NULL DEFAULT 0,
  balance_variance_minor bigint NOT NULL DEFAULT 0, balanced boolean NOT NULL DEFAULT false, colour_status text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT gl_run_summary_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_run_summary_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_run_summary_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id));
ALTER TABLE gl_run_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_run_summary FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_run_summary
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_run_summary_by_run ON gl_run_summary (tenant_id, run_id);
COMMENT ON TABLE gl_run_summary IS 'class=tenant_ledger_append_only; m20 run summary';

-- gl_note — append-only reconciliation note / evidence annotation.
CREATE TABLE gl_note (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'general', content text NOT NULL, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_note_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT gl_note_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gl_note_type_ck CHECK (note_type IN ('general','review','exception','certification','escalation')),
  CONSTRAINT gl_note_run_fkey FOREIGN KEY (tenant_id, run_id) REFERENCES gl_recon_run (tenant_id, id));
ALTER TABLE gl_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_note FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX gl_note_by_run ON gl_note (tenant_id, run_id);
COMMENT ON TABLE gl_note IS 'class=tenant_ledger_append_only; m20 note';
