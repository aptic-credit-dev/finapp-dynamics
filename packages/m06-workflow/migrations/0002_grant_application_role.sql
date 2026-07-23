-- ---------------------------------------------------------------------------------------------------
-- M06 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides
-- WHICH VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS
-- and must not own these tables. NO DELETE is granted anywhere — instances/tasks/definitions retire by
-- status (ADR-010). History tables get INSERT + SELECT only, so the application literally cannot rewrite
-- the evidence (ADR-005). The outbox gets UPDATE so the dispatcher can mark rows dispatched/dead_letter.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON workflow_definition TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON workflow_definition_version TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON workflow_instance TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON workflow_token TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON workflow_task TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON workflow_timer TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON workflow_sla_clock TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON workflow_incident TO %I', grantee);

  -- The one outbox: INSERT in the business tx, UPDATE by the dispatcher. No DELETE (dead-letter is a status).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON workflow_event_outbox TO %I', grantee);

  -- Append-only history: INSERT + SELECT only. The evidence cannot be rewritten (ADR-005).
  EXECUTE format('GRANT SELECT, INSERT ON workflow_instance_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON workflow_task_history TO %I', grantee);
END
$$;
