-- ---------------------------------------------------------------------------------------------------
-- M02 — privileges for the application role. Same model as m01/0002.
--
-- RLS decides WHICH ROWS a role may touch; GRANT decides WHICH VERBS it may use at all. Both are needed:
-- a policy cannot stop a DELETE that should never have been possible.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Reference data: read-only. Type lists change by migration, never by the application.
  EXECUTE format('GRANT SELECT ON identity_type_catalogue TO %I', grantee);
  EXECUTE format('GRANT SELECT ON account_type_catalogue TO %I', grantee);
  EXECUTE format('GRANT SELECT ON membership_type_catalogue TO %I', grantee);

  -- No DELETE anywhere. People and their memberships are retired by status, never removed (ADR-010) —
  -- withholding the privilege makes that a guarantee rather than a convention one query can break. It
  -- also means a "delete this person" bug cannot destroy the evidence of what they did.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON identities TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON user_accounts TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON authentication_subjects TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant_memberships TO %I', grantee);

  -- Append-only, enforced by privilege: INSERT and SELECT only. The application literally cannot rewrite
  -- an identity's history (ADR-005).
  EXECUTE format('GRANT SELECT, INSERT ON identity_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON account_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON membership_status_history TO %I', grantee);
END
$$;
