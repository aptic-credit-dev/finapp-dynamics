-- ---------------------------------------------------------------------------------------------------
-- M31 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — projects/artifacts/versions
-- transition by status (ADR-010). Dependency/validation/review/binding/history + the idempotency ledger are append-only
-- (INSERT+SELECT only). A published artifact version is additionally frozen by the studio_artifact_version_immutable
-- trigger. m31 owns NO outbox — it emits studio.lifecycle through the ONE m06 outbox. It has NO grant on any other
-- module's table (it consumes m01/m02/m03/m06/m07/m30 BY CONTRACT) and stores NO secret VALUE (secret-bearing design
-- values are opaque secretref: pointers inside the declarative spec; real key management is m41).
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (published versions further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON studio_project TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON studio_artifact TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON studio_artifact_version TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON studio_dependency TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON studio_validation_result TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON studio_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON studio_binding TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON studio_artifact_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON studio_idempotency TO %I', grantee);
END
$$;
