-- ---------------------------------------------------------------------------------------------------
-- M30 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — metadata/config/feature/
-- secret-reference transition by status (ADR-010). Config/feature/secret-reference histories and the idempotency ledger
-- are append-only (INSERT+SELECT only). m30 owns NO outbox — it emits platform.lifecycle through the ONE m06 outbox. It
-- has NO grant on any other module's table (it consumes m01/m02/m03/m06 BY CONTRACT) and stores NO secret VALUE (the
-- secret-reference columns hold opaque secretref: pointers only; real key management is m41).
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON platform_metadata TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON platform_config_definition TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON platform_config_value TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON platform_feature_definition TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON platform_feature_assignment TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON platform_secret_reference TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON platform_config_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON platform_feature_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON platform_secret_reference_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON platform_idempotency TO %I', grantee);
END
$$;
