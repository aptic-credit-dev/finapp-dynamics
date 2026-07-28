-- ---------------------------------------------------------------------------------------------------
-- M16 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides WHICH
-- VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS and must not
-- own these tables. NO DELETE is granted anywhere — proceedings withdraw/dismiss/conclude/close/archive by status;
-- proceeding types / SLA policies retire by status (ADR-010). Referral evidence, status history, assignment
-- history, proceeding records, orders, outcomes and notes are append-only (INSERT + SELECT only). m16 owns no
-- outbox — it INSERTs into m06's.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_proceeding_type TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_sla_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_proceeding TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_party TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_claim TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_filing TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_service TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_appearance TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_witness TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_expert TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_exhibit TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_bundle TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_bundle_item TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_compliance_obligation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_appeal TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_deadline TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_cost_reference TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON litigation_relationship TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/068).
  EXECUTE format('GRANT SELECT, INSERT ON litigation_referral TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON litigation_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON litigation_assignment_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON litigation_proceeding_record TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON litigation_order TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON litigation_outcome TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON litigation_note TO %I', grantee);
END
$$;
