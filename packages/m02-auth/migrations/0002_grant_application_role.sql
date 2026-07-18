-- ---------------------------------------------------------------------------------------------------
-- M02-auth — privileges for the application role. Same model as m01/m02 0002.
--
-- RLS decides WHICH ROWS a role may touch; GRANT decides WHICH VERBS it may use at all. No DELETE
-- anywhere: sessions and credentials are retired by status (ADR-010); histories are INSERT + SELECT only,
-- so the application literally cannot rewrite a session's history (ADR-005).
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON authentication_credentials TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON sessions TO %I', grantee);
  -- consumed_at is the only mutation; a consumed refresh token is never un-consumed.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON session_refresh_tokens TO %I', grantee);
  -- login_attempts is append-only (pre-auth telemetry); the app inserts and reads, never mutates.
  EXECUTE format('GRANT SELECT, INSERT ON login_attempts TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON session_status_history TO %I', grantee);
END
$$;
