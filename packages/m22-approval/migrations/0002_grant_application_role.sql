-- ---------------------------------------------------------------------------------------------------
-- M22 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — policies/config/reason-
-- codes/requests/steps/delegations transition by status (ADR-010). Policy steps, all *_history, the decision ledger,
-- assignments, SoD checks, participants, escalations, timers, notifications, workflow links, the idempotency ledger,
-- notes, evidence, outcomes and overrides are append-only (INSERT+SELECT only). m22 owns no outbox — it INSERTs into
-- m06's. It NEVER approves on behalf of a human and NEVER posts to a ledger.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON approval_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON approval_config TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON approval_reason_code TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON approval_request TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON approval_request_step TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON approval_delegation TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072). No UPDATE, no DELETE.
  EXECUTE format('GRANT SELECT, INSERT ON approval_policy_step TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_policy_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_step_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_decision TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_assignment TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_delegation_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_sod_check TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_participant TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_escalation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_timer TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_notification TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_workflow_link TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_idempotency TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_note TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_evidence TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_outcome TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON approval_override TO %I', grantee);
END
$$;
