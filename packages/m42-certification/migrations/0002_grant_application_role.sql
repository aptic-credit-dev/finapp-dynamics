-- ---------------------------------------------------------------------------------------------------
-- M42 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — programmes/findings/waivers/
-- readiness transition by status (ADR-010); sign-offs, decisions, conditions, evidence, reviews, history, closure + the
-- idempotency ledger are append-only (INSERT+SELECT only); an ISSUED decision + a closure artifact are additionally frozen by
-- their immutability triggers. m42 owns NO outbox — it emits the certification.* families through the ONE m06 outbox, owns NO
-- second audit/workflow/approval/security/analytics/scheduler/secrets engine, and executes NO release/deployment/migration/DR/
-- journal/secret operation (it RECORDS certification evidence + governance state only). Evidence is opaque references only —
-- never a secret, credential, full log, raw report body or restricted payload.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (version CAS; state transitions only).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON certification_programme TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON certification_assessment TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON certification_finding TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON certification_waiver TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON certification_readiness TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072). Decision + closure are additionally trigger-immutable.
  EXECUTE format('GRANT SELECT, INSERT ON certification_signoff TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON certification_decision TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON certification_condition TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON certification_evidence TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON certification_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON certification_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON certification_closure TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON certification_idempotency TO %I', grantee);
END
$$;
