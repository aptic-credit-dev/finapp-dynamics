-- ---------------------------------------------------------------------------------------------------
-- M17 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides WHICH
-- VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS and must not
-- own these tables. NO DELETE is granted anywhere — recoveries withdraw/close/archive by status; recovery types /
-- SLA policies retire by status (ADR-010). Referral evidence, status history, assignment history, strategy
-- selections, agent reports, receipt references, waivers, outcomes and notes are append-only (INSERT + SELECT
-- only). m17 owns no outbox — it INSERTs into m06's.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_type TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_sla_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_case TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_party TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_instrument TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_demand TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_negotiation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_arrangement TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_installment TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_enforcement_action TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_security TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_agent TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_writeoff_recommendation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_deadline TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_cost_reference TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recovery_relationship TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON recovery_referral TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recovery_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recovery_assignment_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recovery_strategy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recovery_agent_report TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recovery_receipt TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recovery_waiver TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recovery_outcome TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recovery_note TO %I', grantee);
END
$$;
