-- ---------------------------------------------------------------------------------------------------
-- M09 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides WHICH
-- VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS and must not
-- own these tables. NO DELETE is granted anywhere — records dispose through an authorized disposition that
-- leaves a tombstone row; documents withdraw/archive by status (ADR-010/050). Scan evidence is append-only
-- (INSERT + SELECT only). Committed version content columns and legal-hold/disposition evidence columns are
-- immutable by the service (status promotion is the only permitted UPDATE); no DELETE means the trail survives.
-- m09 owns no outbox — it INSERTs into m06's.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON document_type TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON retention_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON document TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON document_version TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON document_access_grant TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON document_checkout TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON document_relationship TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON document_legal_hold TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON document_disposition TO %I', grantee);

  -- Append-only scan evidence: INSERT + SELECT only. A scan result can never be rewritten (ADR-005/046).
  EXECUTE format('GRANT SELECT, INSERT ON document_scan_result TO %I', grantee);
END
$$;
