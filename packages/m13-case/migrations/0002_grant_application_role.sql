-- ---------------------------------------------------------------------------------------------------
-- M13 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides WHICH
-- VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS and must not
-- own these tables. NO DELETE is granted anywhere — cases cancel/close/archive by status; case types / SLA
-- policies retire by status (ADR-010). Status history, assignment history, findings, notes and handoff-intake
-- evidence are append-only (INSERT + SELECT only). m13 owns no outbox — it INSERTs into m06's.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_type TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_sla_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_record TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_party TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_activity TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_task TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_issue TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_investigation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_document TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_evidence TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_deadline TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_hearing TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_decision TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_settlement TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON case_relationship TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/060).
  EXECUTE format('GRANT SELECT, INSERT ON case_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON case_assignment_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON case_finding TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON case_note TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON case_handoff_intake TO %I', grantee);
END
$$;
