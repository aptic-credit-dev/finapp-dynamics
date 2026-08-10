-- ---------------------------------------------------------------------------------------------------
-- M33 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — connectors/connections/
-- secrets/runs transition by status (ADR-010). Run-attempt/review/history + the idempotency ledger are append-only
-- (INSERT+SELECT only); a published connector is additionally frozen by its immutability trigger. m33 owns NO outbox — it
-- emits connector.lifecycle through the ONE m06 outbox. It has NO grant on any other module's table (it consumes m02/m03/
-- m06/m30 BY CONTRACT) and stores NO secret VALUE (connection_secret holds opaque secretref: pointers only; real key
-- management is m41). No float; no arbitrary code; no production network.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (published connector further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON connector_definition TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON connector_capability TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON connection TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON connection_secret TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON connector_run TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON connector_run_attempt TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON connector_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON connector_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON connector_idempotency TO %I', grantee);
END
$$;
