-- ---------------------------------------------------------------------------------------------------
-- M18 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides WHICH
-- VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS and must not
-- own these tables. NO DELETE is granted anywhere — knowledge records / templates / clauses
-- withdraw/supersede/archive by status; taxonomy retires by `active` (ADR-010). Status history, assignment
-- history, authority treatments, approval history, notes and usage are append-only (INSERT + SELECT only). m18
-- owns no outbox — it INSERTs into m06's.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_taxonomy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_knowledge TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_authority TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_precedent TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_opinion TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_research TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_template TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_clause TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_clause_relation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_reference TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_relationship TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_tag TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legaldoc_citation TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON legaldoc_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legaldoc_assignment_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legaldoc_authority_treatment TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legaldoc_note TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legaldoc_usage TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legaldoc_approval_history TO %I', grantee);
END
$$;
