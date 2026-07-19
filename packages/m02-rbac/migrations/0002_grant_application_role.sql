-- ---------------------------------------------------------------------------------------------------
-- M02-rbac — privileges for the application role. Same model as m01/m02 0002.
--
-- No DELETE anywhere: roles are retired and assignments revoked by status (ADR-010); histories are
-- INSERT + SELECT only (ADR-005). `permissions` is read-only reference data — the catalogue changes by
-- migration, never by the application.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  EXECUTE format('GRANT SELECT ON permissions TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON roles TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON role_permissions TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON role_assignments TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON platform_role_assignments TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON sod_rules TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON role_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON assignment_status_history TO %I', grantee);
END
$$;
