-- ---------------------------------------------------------------------------------------------------
-- M03-audit — privileges for the application role. Same model as m01/m02 0002.
--
-- audit_events is INSERT + SELECT ONLY — never UPDATE, never DELETE. The append-only guarantee is thus
-- doubly held: the app role has no verb to mutate evidence, and the triggers reject it even if it did.
-- The retention policy and legal-hold tables are configuration/state, so they take UPDATE as well.
-- ---------------------------------------------------------------------------------------------------
DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- The spine: append and read, nothing else.
  EXECUTE format('GRANT SELECT, INSERT ON audit_events TO %I', grantee);

  -- Retention policy + legal holds: configuration/state the application maintains.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON audit_retention_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON audit_legal_hold TO %I', grantee);
END
$$;
