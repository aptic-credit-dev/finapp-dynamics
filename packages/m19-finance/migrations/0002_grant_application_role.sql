-- ---------------------------------------------------------------------------------------------------
-- M19 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides WHICH
-- VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS and must not
-- own these tables. NO DELETE is granted anywhere — accounts/entities/cost-centres/dimensions archive by status;
-- reference data deactivates; config supersedes/retires by status (ADR-010). Account/period/config history are
-- append-only (INSERT + SELECT only). m19 owns no outbox — it INSERTs into m06's.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates + reference data: SELECT/INSERT/UPDATE, never DELETE.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_entity TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_account_type TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_currency TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_exchange_rate TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_entity_currency TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_account TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_fiscal_year TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_fiscal_period TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_cost_center TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_dimension TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_dimension_value TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_tax_code TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_tax_rate TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_payment_term TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_config TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON finance_account_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON finance_period_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON finance_config_history TO %I', grantee);
END
$$;
