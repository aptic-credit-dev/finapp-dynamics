-- ---------------------------------------------------------------------------------------------------
-- M19-finance — finance operations FOUNDATION (Stage 3.1). The finance reference-data layer that
-- reconciliation (m15), GL reconciliation (m20) and the journal engine (m21) build on. It owns accounting
-- entities, the chart of accounts (account types + ledger accounts), the fiscal calendar (fiscal years +
-- accounting periods with an open/closed/locked state), currencies + FX rates, cost centres, analytical
-- dimensions, tax codes + rates, payment terms, and versioned finance configuration.
--
-- It OWNS NO journals, NO journal lines, NO postings, NO reconciliation and NO approval workflow — those are
-- m21/m15/m20/m22. It carries NO monetary amounts or balances; the only money-adjacent values are EXACT-decimal
-- FX rates and tax rates stored as NUMERIC (never float; ADR-007, CLAUDE.md). Period close/lock is the
-- cross-module gate downstream posting (m21) reads to honour "no posting into a closed period" (ADR-007) — m19
-- never posts a ledger entry.
--
-- Every tenant-scoped table: composite (tenant_id, id) primary key, UNIQUE (tenant_id, id) so composite FKs can
-- reference it, RLS ENABLE + FORCE with the standard `tenant_isolation` policy, and a `version` column for
-- optimistic concurrency on mutable aggregates. No table grants DELETE (accounts/entities/cost-centres archive by
-- status; reference data deactivates; 0002, ADR-010). Account/period/config history are append-only (INSERT +
-- SELECT only, granted in 0002). m19 publishes finance.lifecycle through the ONE outbox m06 owns; it never
-- creates a second outbox. Consumes m02 (authz) / m03 (audit) / m06 (workflow + outbox) only.
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('finance.entity.read', 'm19-finance', 'finance_entity', false),
  ('finance.entity.manage', 'm19-finance', 'finance_entity', true),
  ('finance.entity.activate', 'm19-finance', 'finance_entity', false),
  ('finance.entity.deactivate', 'm19-finance', 'finance_entity', false),
  ('finance.account_type.read', 'm19-finance', 'finance_account_type', false),
  ('finance.account_type.manage', 'm19-finance', 'finance_account_type', true),
  ('finance.account.read', 'm19-finance', 'finance_account', false),
  ('finance.account.create', 'm19-finance', 'finance_account', false),
  ('finance.account.update', 'm19-finance', 'finance_account', false),
  ('finance.account.activate', 'm19-finance', 'finance_account', false),
  ('finance.account.deactivate', 'm19-finance', 'finance_account', false),
  ('finance.account.archive', 'm19-finance', 'finance_account', true),
  ('finance.fiscal_year.read', 'm19-finance', 'finance_fiscal_year', false),
  ('finance.fiscal_year.manage', 'm19-finance', 'finance_fiscal_year', false),
  ('finance.fiscal_year.close', 'm19-finance', 'finance_fiscal_year', true),
  ('finance.fiscal_year.reopen', 'm19-finance', 'finance_fiscal_year', true),
  ('finance.period.read', 'm19-finance', 'finance_fiscal_period', false),
  ('finance.period.manage', 'm19-finance', 'finance_fiscal_period', false),
  ('finance.period.open', 'm19-finance', 'finance_fiscal_period', false),
  ('finance.period.close', 'm19-finance', 'finance_fiscal_period', true),
  ('finance.period.lock', 'm19-finance', 'finance_fiscal_period', true),
  ('finance.period.reopen', 'm19-finance', 'finance_fiscal_period', true),
  ('finance.currency.read', 'm19-finance', 'finance_currency', false),
  ('finance.currency.manage', 'm19-finance', 'finance_currency', true),
  ('finance.exchange_rate.read', 'm19-finance', 'finance_exchange_rate', false),
  ('finance.exchange_rate.manage', 'm19-finance', 'finance_exchange_rate', true),
  ('finance.entity_currency.read', 'm19-finance', 'finance_entity_currency', false),
  ('finance.entity_currency.manage', 'm19-finance', 'finance_entity_currency', false),
  ('finance.cost_center.read', 'm19-finance', 'finance_cost_center', false),
  ('finance.cost_center.manage', 'm19-finance', 'finance_cost_center', false),
  ('finance.cost_center.archive', 'm19-finance', 'finance_cost_center', false),
  ('finance.dimension.read', 'm19-finance', 'finance_dimension', false),
  ('finance.dimension.manage', 'm19-finance', 'finance_dimension', false),
  ('finance.dimension_value.manage', 'm19-finance', 'finance_dimension_value', false),
  ('finance.tax_code.read', 'm19-finance', 'finance_tax_code', false),
  ('finance.tax_code.manage', 'm19-finance', 'finance_tax_code', true),
  ('finance.tax_rate.manage', 'm19-finance', 'finance_tax_rate', true),
  ('finance.payment_term.read', 'm19-finance', 'finance_payment_term', false),
  ('finance.payment_term.manage', 'm19-finance', 'finance_payment_term', false),
  ('finance.config.read', 'm19-finance', 'finance_config', false),
  ('finance.config.manage', 'm19-finance', 'finance_config', true),
  ('finance.config.publish', 'm19-finance', 'finance_config', true),
  ('finance.analytics.read', 'm19-finance', 'finance_analytics', false),
  ('finance.analytics.export', 'm19-finance', 'finance_analytics', true),
  ('finance.platform.administer', 'm19-finance', 'finance_engine', true);

-- finance_entity — the accounting entity / company / book (distinct from the m01 tenant org unit).
CREATE TABLE finance_entity (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, name text NOT NULL, parent_entity_id uuid, functional_currency_code text,
  description text, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_entity_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_entity_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_entity_code_key UNIQUE (tenant_id, code),
  CONSTRAINT finance_entity_status_ck CHECK (status IN ('active','inactive','archived')),
  CONSTRAINT finance_entity_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_entity_parent_fkey FOREIGN KEY (tenant_id, parent_entity_id) REFERENCES finance_entity (tenant_id, id));
ALTER TABLE finance_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_entity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_entity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE finance_entity IS 'class=tenant_aggregate; m19 accounting entity';

-- finance_account_type — account classification (asset/liability/equity/income/expense) + normal balance side.
CREATE TABLE finance_account_type (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, name text NOT NULL, account_class text NOT NULL, normal_side text NOT NULL,
  description text, active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_account_type_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_account_type_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_account_type_code_key UNIQUE (tenant_id, code),
  CONSTRAINT finance_account_type_class_ck CHECK (account_class IN ('asset','liability','equity','income','expense')),
  CONSTRAINT finance_account_type_side_ck CHECK (normal_side IN ('debit','credit')),
  CONSTRAINT finance_account_type_optlock_ck CHECK (version >= 1));
ALTER TABLE finance_account_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_account_type FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_account_type
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE finance_account_type IS 'class=tenant_reference; m19 account type';

-- finance_currency — currency reference (ISO-4217-style code + minor-unit exponent). Tenant-scoped (ADR: not
-- promoted to the global set; a tenant curates its own currency list).
CREATE TABLE finance_currency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, name text NOT NULL, minor_units integer NOT NULL DEFAULT 2, symbol text,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_currency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_currency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_currency_code_key UNIQUE (tenant_id, code),
  CONSTRAINT finance_currency_code_ck CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_currency_minor_ck CHECK (minor_units >= 0 AND minor_units <= 6),
  CONSTRAINT finance_currency_status_ck CHECK (status IN ('active','inactive')),
  CONSTRAINT finance_currency_optlock_ck CHECK (version >= 1));
ALTER TABLE finance_currency ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_currency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_currency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE finance_currency IS 'class=tenant_reference; m19 currency';

-- finance_exchange_rate — an EXACT-decimal FX rate for a currency pair on a date (NUMERIC, never float; ADR-007).
-- Idempotent: one rate per (base, quote, type, date).
CREATE TABLE finance_exchange_rate (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  base_currency_id uuid NOT NULL, quote_currency_id uuid NOT NULL, rate numeric(30,12) NOT NULL,
  rate_type text NOT NULL DEFAULT 'spot', rate_date date NOT NULL, source text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_exchange_rate_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_exchange_rate_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_exchange_rate_type_ck CHECK (rate_type IN ('spot','closing','average','historical','budget')),
  CONSTRAINT finance_exchange_rate_positive_ck CHECK (rate > 0),
  CONSTRAINT finance_exchange_rate_distinct_ck CHECK (base_currency_id <> quote_currency_id),
  CONSTRAINT finance_exchange_rate_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_exchange_rate_base_fkey FOREIGN KEY (tenant_id, base_currency_id) REFERENCES finance_currency (tenant_id, id),
  CONSTRAINT finance_exchange_rate_quote_fkey FOREIGN KEY (tenant_id, quote_currency_id) REFERENCES finance_currency (tenant_id, id));
ALTER TABLE finance_exchange_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_exchange_rate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_exchange_rate
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX finance_exchange_rate_key ON finance_exchange_rate (tenant_id, base_currency_id, quote_currency_id, rate_type, rate_date);
COMMENT ON TABLE finance_exchange_rate IS 'class=tenant_reference; m19 fx rate (exact decimal)';

-- finance_entity_currency — an entity's functional/presentation/allowed-transaction currency configuration.
CREATE TABLE finance_entity_currency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL, currency_id uuid NOT NULL, currency_role text NOT NULL,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT finance_entity_currency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_entity_currency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_entity_currency_role_ck CHECK (currency_role IN ('functional','presentation','transaction')),
  CONSTRAINT finance_entity_currency_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_entity_currency_entity_fkey FOREIGN KEY (tenant_id, entity_id) REFERENCES finance_entity (tenant_id, id),
  CONSTRAINT finance_entity_currency_cur_fkey FOREIGN KEY (tenant_id, currency_id) REFERENCES finance_currency (tenant_id, id));
ALTER TABLE finance_entity_currency ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_entity_currency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_entity_currency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX finance_entity_currency_key ON finance_entity_currency (tenant_id, entity_id, currency_id, currency_role);
COMMENT ON TABLE finance_entity_currency IS 'class=tenant_reference; m19 entity currency config';

-- finance_account — the chart of accounts / ledger account. Tree via parent_account_id; postable flag; lifecycle.
CREATE TABLE finance_account (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL, account_type_id uuid NOT NULL, parent_account_id uuid,
  code text NOT NULL, name text NOT NULL, description text, currency_id uuid,
  postable boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_account_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_account_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_account_code_key UNIQUE (tenant_id, entity_id, code),
  CONSTRAINT finance_account_status_ck CHECK (status IN ('draft','active','inactive','archived')),
  CONSTRAINT finance_account_noselfparent_ck CHECK (parent_account_id IS NULL OR parent_account_id <> id),
  CONSTRAINT finance_account_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_account_entity_fkey FOREIGN KEY (tenant_id, entity_id) REFERENCES finance_entity (tenant_id, id),
  CONSTRAINT finance_account_type_fkey FOREIGN KEY (tenant_id, account_type_id) REFERENCES finance_account_type (tenant_id, id),
  CONSTRAINT finance_account_parent_fkey FOREIGN KEY (tenant_id, parent_account_id) REFERENCES finance_account (tenant_id, id),
  CONSTRAINT finance_account_cur_fkey FOREIGN KEY (tenant_id, currency_id) REFERENCES finance_currency (tenant_id, id));
ALTER TABLE finance_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_account FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_account
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_account_by_entity ON finance_account (tenant_id, entity_id, status);
COMMENT ON TABLE finance_account IS 'class=tenant_aggregate; m19 ledger account';

-- finance_account_history — append-only account lifecycle transition evidence.
CREATE TABLE finance_account_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_account_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_account_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_account_history_acct_fkey FOREIGN KEY (tenant_id, account_id) REFERENCES finance_account (tenant_id, id));
ALTER TABLE finance_account_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_account_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_account_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_account_history_by_acct ON finance_account_history (tenant_id, account_id);
COMMENT ON TABLE finance_account_history IS 'class=tenant_ledger_append_only; m19 account history';

-- finance_fiscal_year — a fiscal year for an entity (open/closed).
CREATE TABLE finance_fiscal_year (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), entity_id uuid NOT NULL,
  code text NOT NULL, name text, start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_fiscal_year_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_fiscal_year_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_fiscal_year_code_key UNIQUE (tenant_id, entity_id, code),
  CONSTRAINT finance_fiscal_year_status_ck CHECK (status IN ('open','closed')),
  CONSTRAINT finance_fiscal_year_dates_ck CHECK (end_date >= start_date),
  CONSTRAINT finance_fiscal_year_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_fiscal_year_entity_fkey FOREIGN KEY (tenant_id, entity_id) REFERENCES finance_entity (tenant_id, id));
ALTER TABLE finance_fiscal_year ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_fiscal_year FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_fiscal_year
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE finance_fiscal_year IS 'class=tenant_aggregate; m19 fiscal year';

-- finance_fiscal_period — an accounting period within a fiscal year. open -> closed <-> reopen; -> locked (sealed).
CREATE TABLE finance_fiscal_period (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL, fiscal_year_id uuid NOT NULL, period_number integer NOT NULL, name text,
  start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL DEFAULT 'open',
  closed_at timestamptz, locked_at timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_fiscal_period_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_fiscal_period_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_fiscal_period_num_key UNIQUE (tenant_id, fiscal_year_id, period_number),
  CONSTRAINT finance_fiscal_period_status_ck CHECK (status IN ('open','closed','locked')),
  CONSTRAINT finance_fiscal_period_num_ck CHECK (period_number >= 1 AND period_number <= 24),
  CONSTRAINT finance_fiscal_period_dates_ck CHECK (end_date >= start_date),
  CONSTRAINT finance_fiscal_period_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_fiscal_period_entity_fkey FOREIGN KEY (tenant_id, entity_id) REFERENCES finance_entity (tenant_id, id),
  CONSTRAINT finance_fiscal_period_fy_fkey FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES finance_fiscal_year (tenant_id, id));
ALTER TABLE finance_fiscal_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_fiscal_period FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_fiscal_period
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_fiscal_period_by_fy ON finance_fiscal_period (tenant_id, fiscal_year_id, status);
COMMENT ON TABLE finance_fiscal_period IS 'class=tenant_aggregate; m19 accounting period (postability gate)';

-- finance_period_history — append-only period open/close/lock/reopen evidence.
CREATE TABLE finance_period_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), period_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_period_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_period_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_period_history_period_fkey FOREIGN KEY (tenant_id, period_id) REFERENCES finance_fiscal_period (tenant_id, id));
ALTER TABLE finance_period_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_period_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_period_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_period_history_by_period ON finance_period_history (tenant_id, period_id);
COMMENT ON TABLE finance_period_history IS 'class=tenant_ledger_append_only; m19 period history';

-- finance_cost_center — a cost centre (tree via parent).
CREATE TABLE finance_cost_center (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), entity_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, parent_cost_center_id uuid, description text, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_cost_center_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_cost_center_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_cost_center_code_key UNIQUE (tenant_id, entity_id, code),
  CONSTRAINT finance_cost_center_status_ck CHECK (status IN ('active','inactive','archived')),
  CONSTRAINT finance_cost_center_noselfparent_ck CHECK (parent_cost_center_id IS NULL OR parent_cost_center_id <> id),
  CONSTRAINT finance_cost_center_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_cost_center_entity_fkey FOREIGN KEY (tenant_id, entity_id) REFERENCES finance_entity (tenant_id, id),
  CONSTRAINT finance_cost_center_parent_fkey FOREIGN KEY (tenant_id, parent_cost_center_id) REFERENCES finance_cost_center (tenant_id, id));
ALTER TABLE finance_cost_center ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_cost_center FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_cost_center
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE finance_cost_center IS 'class=tenant_aggregate; m19 cost centre';

-- finance_dimension — an analytical dimension definition (project/department/product/region/segment/custom).
CREATE TABLE finance_dimension (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), entity_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_dimension_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_dimension_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_dimension_code_key UNIQUE (tenant_id, entity_id, code),
  CONSTRAINT finance_dimension_kind_ck CHECK (kind IN ('project','department','product','region','segment','custom')),
  CONSTRAINT finance_dimension_status_ck CHECK (status IN ('active','inactive','archived')),
  CONSTRAINT finance_dimension_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_dimension_entity_fkey FOREIGN KEY (tenant_id, entity_id) REFERENCES finance_entity (tenant_id, id));
ALTER TABLE finance_dimension ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_dimension FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_dimension
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE finance_dimension IS 'class=tenant_aggregate; m19 analytical dimension';

-- finance_dimension_value — a value within a dimension.
CREATE TABLE finance_dimension_value (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), dimension_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, parent_value_id uuid, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_dimension_value_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_dimension_value_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_dimension_value_code_key UNIQUE (tenant_id, dimension_id, code),
  CONSTRAINT finance_dimension_value_status_ck CHECK (status IN ('active','inactive','archived')),
  CONSTRAINT finance_dimension_value_noselfparent_ck CHECK (parent_value_id IS NULL OR parent_value_id <> id),
  CONSTRAINT finance_dimension_value_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_dimension_value_dim_fkey FOREIGN KEY (tenant_id, dimension_id) REFERENCES finance_dimension (tenant_id, id),
  CONSTRAINT finance_dimension_value_parent_fkey FOREIGN KEY (tenant_id, parent_value_id) REFERENCES finance_dimension_value (tenant_id, id));
ALTER TABLE finance_dimension_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_dimension_value FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_dimension_value
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_dimension_value_by_dim ON finance_dimension_value (tenant_id, dimension_id);
COMMENT ON TABLE finance_dimension_value IS 'class=tenant_reference; m19 dimension value';

-- finance_tax_code — a tax code (VAT/GST/withholding/...).
CREATE TABLE finance_tax_code (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), entity_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, tax_type text NOT NULL, description text, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_tax_code_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_tax_code_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_tax_code_code_key UNIQUE (tenant_id, entity_id, code),
  CONSTRAINT finance_tax_code_type_ck CHECK (tax_type IN ('vat','gst','sales','withholding','excise','income','other')),
  CONSTRAINT finance_tax_code_status_ck CHECK (status IN ('active','inactive','archived')),
  CONSTRAINT finance_tax_code_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_tax_code_entity_fkey FOREIGN KEY (tenant_id, entity_id) REFERENCES finance_entity (tenant_id, id));
ALTER TABLE finance_tax_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_tax_code FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_tax_code
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE finance_tax_code IS 'class=tenant_aggregate; m19 tax code';

-- finance_tax_rate — an EXACT-decimal, effective-dated tax rate for a tax code (percentage; NUMERIC, never float).
CREATE TABLE finance_tax_rate (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), tax_code_id uuid NOT NULL,
  rate_percent numeric(9,6) NOT NULL, effective_from date NOT NULL, effective_to date,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT finance_tax_rate_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_tax_rate_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_tax_rate_key UNIQUE (tenant_id, tax_code_id, effective_from),
  CONSTRAINT finance_tax_rate_nonneg_ck CHECK (rate_percent >= 0),
  CONSTRAINT finance_tax_rate_range_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT finance_tax_rate_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_tax_rate_code_fkey FOREIGN KEY (tenant_id, tax_code_id) REFERENCES finance_tax_code (tenant_id, id));
ALTER TABLE finance_tax_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_tax_rate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_tax_rate
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_tax_rate_by_code ON finance_tax_rate (tenant_id, tax_code_id);
COMMENT ON TABLE finance_tax_rate IS 'class=tenant_reference; m19 tax rate (exact decimal)';

-- finance_payment_term — a payment term (net days / EOM / ...).
CREATE TABLE finance_payment_term (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, name text NOT NULL, basis text NOT NULL DEFAULT 'net_days', net_days integer, day_of_month integer,
  description text, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_payment_term_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_payment_term_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_payment_term_code_key UNIQUE (tenant_id, code),
  CONSTRAINT finance_payment_term_basis_ck CHECK (basis IN ('net_days','end_of_month','day_of_month','immediate')),
  CONSTRAINT finance_payment_term_status_ck CHECK (status IN ('active','inactive','archived')),
  CONSTRAINT finance_payment_term_netdays_ck CHECK (net_days IS NULL OR net_days >= 0),
  CONSTRAINT finance_payment_term_optlock_ck CHECK (version >= 1));
ALTER TABLE finance_payment_term ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_payment_term FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_payment_term
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE finance_payment_term IS 'class=tenant_reference; m19 payment term';

-- finance_config — versioned finance configuration per entity (default accounts, posting rules metadata — NOT
-- posting itself). Immutable-after-publish; one active version per entity+scope; idempotency-keyed.
CREATE TABLE finance_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), entity_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'default', version_number integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'draft',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb, content_hash text, supersedes_id uuid, superseded_by_id uuid,
  submitted_by uuid, submitted_at timestamptz, published_at timestamptz, idempotency_key text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT finance_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_config_ver_key UNIQUE (tenant_id, entity_id, scope, version_number),
  CONSTRAINT finance_config_status_ck CHECK (status IN ('draft','active','superseded','retired')),
  CONSTRAINT finance_config_optlock_ck CHECK (version >= 1),
  CONSTRAINT finance_config_entity_fkey FOREIGN KEY (tenant_id, entity_id) REFERENCES finance_entity (tenant_id, id));
ALTER TABLE finance_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX finance_config_one_active ON finance_config (tenant_id, entity_id, scope) WHERE status = 'active';
CREATE UNIQUE INDEX finance_config_idem_key ON finance_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE finance_config IS 'class=tenant_aggregate; m19 finance config (versioned)';

-- finance_config_history — append-only config lifecycle evidence.
CREATE TABLE finance_config_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), config_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, reason text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_config_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT finance_config_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_config_history_cfg_fkey FOREIGN KEY (tenant_id, config_id) REFERENCES finance_config (tenant_id, id));
ALTER TABLE finance_config_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_config_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_config_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX finance_config_history_by_cfg ON finance_config_history (tenant_id, config_id);
COMMENT ON TABLE finance_config_history IS 'class=tenant_ledger_append_only; m19 config history';
