-- ---------------------------------------------------------------------------------------------------
-- M07 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides
-- WHICH VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS
-- and must not own these tables. NO DELETE is granted anywhere — rule sets/versions retire by status
-- (ADR-010). Evidence and history get INSERT + SELECT only, so the application literally cannot rewrite the
-- decision record or the lifecycle trail (ADR-005/035). m07 owns no outbox — it INSERTs into m06's.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE. Rule sets and versions retire by status; a
  -- PUBLISHED version's spec is frozen by the service + content_hash, not by revoking UPDATE (activate/retire
  -- are themselves UPDATEs of the status column).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON rule_set TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON rule_set_version TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON rule_test_case TO %I', grantee);

  -- Append-only evidence + lifecycle history: INSERT + SELECT only. The decision record and the lifecycle
  -- trail cannot be rewritten (ADR-005/035).
  EXECUTE format('GRANT SELECT, INSERT ON rule_evaluation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON rule_set_history TO %I', grantee);
END
$$;
