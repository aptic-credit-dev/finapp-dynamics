-- ---------------------------------------------------------------------------------------------------
-- M04 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — saved views/preferences/
-- operations transition/replace by status/version (ADR-010). admin_operation_history is append-only (INSERT+SELECT
-- only). M04 owns NO outbox and NO business tables — it orchestrates m01/m02/m03/m06/m07/m08 through their public
-- services and audits via m03. It NEVER writes another module's tables directly.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON admin_saved_view TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON admin_preference TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON admin_operation_request TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON admin_operation_history TO %I', grantee);
END
$$;
