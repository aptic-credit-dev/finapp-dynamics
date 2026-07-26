-- ---------------------------------------------------------------------------------------------------
-- M12 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides WHICH
-- VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS and must not
-- own these tables. NO DELETE is granted anywhere — feedback cancels/closes by status; questionnaires/SLA
-- policies retire by status (ADR-010). Answers, contact attempts and assignment history are append-only
-- evidence (INSERT + SELECT only). m12 owns no outbox — it INSERTs into m06's.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_source_system TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_category TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_questionnaire TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_sla_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_source_transaction TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_record TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_queue_item TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_activity TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_resolution TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_sla_instance TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_case_handoff TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON feedback_relationship TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/055).
  EXECUTE format('GRANT SELECT, INSERT ON feedback_answer TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON feedback_contact_attempt TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON feedback_assignment_history TO %I', grantee);
END
$$;
