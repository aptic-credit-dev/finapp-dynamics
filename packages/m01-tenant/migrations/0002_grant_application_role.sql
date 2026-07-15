-- ---------------------------------------------------------------------------------------------------
-- M01 — privileges for the application role.
--
-- Grants live in a migration rather than in deployment scripts so that the privilege model is versioned,
-- reviewed and reproducible alongside the tables it protects. RLS decides WHICH ROWS a role may touch;
-- GRANT decides WHICH VERBS it may use at all. Both are needed: a policy cannot stop a DELETE that was
-- never supposed to be possible.
--
-- The role name comes from the `app.grantee_role` GUC when set, else `finapp_app` (matching
-- .env.example and .github/workflows/ci.yml). It must be NOLOGIN/NOBYPASSRLS and must NOT own these
-- tables: an owner is exempt from RLS unless FORCE is set, and a BYPASSRLS role ignores policies
-- outright.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Reference data: read-only. The type catalogue changes by migration, never by the application.
  EXECUTE format('GRANT SELECT ON tenant_type_catalogue TO %I', grantee);

  -- The control plane and the org tree: no DELETE anywhere. Records are retired via status +
  -- removed_at/removed_by (ADR-010); withholding the DELETE privilege is what makes that a guarantee
  -- rather than a coding convention that one forgotten query can break.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenants TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant_environments TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant_entities TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant_departments TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant_branches TO %I', grantee);

  -- Append-only, enforced by privilege: INSERT and SELECT only, no UPDATE, no DELETE. The lifecycle
  -- history is evidence — the application literally cannot rewrite it (ADR-005).
  EXECUTE format('GRANT SELECT, INSERT ON tenant_status_history TO %I', grantee);
END
$$;
