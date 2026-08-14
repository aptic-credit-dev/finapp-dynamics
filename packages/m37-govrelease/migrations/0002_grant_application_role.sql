-- ---------------------------------------------------------------------------------------------------
-- M37 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — artifacts/environments/
-- releases/gates transition by status (ADR-010). Check/review/evidence/history + the idempotency ledger are append-only
-- (INSERT+SELECT only); a released record is additionally frozen by its immutability trigger. m37 owns NO outbox — it emits
-- govrelease.lifecycle through the ONE m06 outbox. It has NO grant on any other module's table (it consumes m33/m34/m35/m36
-- + m30 BY CONTRACT) and stores NO secret VALUE (govrelease_evidence holds an opaque secretref: signature pointer only; real
-- key management is m41). No float; no arbitrary code; no external network (m37 executes no release).
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (released record further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON govrelease_artifact TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON govrelease_environment TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON govrelease_release TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON govrelease_gate TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON govrelease_check TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON govrelease_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON govrelease_evidence TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON govrelease_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON govrelease_idempotency TO %I', grantee);
END
$$;
