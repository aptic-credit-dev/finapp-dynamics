-- ---------------------------------------------------------------------------------------------------
-- M14 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides WHICH
-- VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS and must not
-- own these tables. NO DELETE is granted anywhere — matters withdraw/close/archive by status; matter types / SLA
-- policies retire by status (ADR-010). Status history, assignment history, case-conversion evidence, counsel
-- reports, outcomes and notes are append-only (INSERT + SELECT only). m14 owns no outbox — it INSERTs into m06's.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_matter_type TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_sla_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_jurisdiction TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_matter TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_instruction TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_party TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_activity TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_task TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_issue TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_position TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_opinion TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_research_reference TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_pleading TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_court_event TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_deadline TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_external_counsel TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_cost_reference TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_settlement TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_relationship TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/064).
  EXECUTE format('GRANT SELECT, INSERT ON legal_matter_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_assignment_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_case_conversion TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_counsel_report TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_outcome TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_note TO %I', grantee);
END
$$;
