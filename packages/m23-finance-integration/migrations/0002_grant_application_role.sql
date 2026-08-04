-- ---------------------------------------------------------------------------------------------------
-- M23 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — destinations/config/
-- executions transition by status (ADR-010). Destination + execution history, attempts, external references and the
-- idempotency ledger are append-only (INSERT+SELECT only). M23 owns NO outbox (it publishes no events at all — FRAMEWORK
-- ONLY) and reaches no external system. It NEVER approves, posts, or exposes credentials.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates + status-transitioned records: SELECT/INSERT/UPDATE, never DELETE.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON integration_destination TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON integration_config TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON integration_execution TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072). No UPDATE, no DELETE.
  EXECUTE format('GRANT SELECT, INSERT ON integration_destination_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON integration_execution_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON integration_attempt TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON external_reference TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON integration_idempotency TO %I', grantee);
END
$$;
