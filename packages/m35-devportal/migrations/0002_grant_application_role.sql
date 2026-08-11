-- ---------------------------------------------------------------------------------------------------
-- M35 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — apps/products/credentials/
-- subscriptions transition by status (ADR-010). Product scope/review/credential_event/history + the idempotency ledger are
-- append-only (INSERT+SELECT only); a published product is additionally frozen by its immutability trigger. m35 owns NO
-- outbox — it emits devportal.lifecycle through the ONE m06 outbox. It has NO grant on any other module's table (it consumes
-- m02/m03/m06/m30/m33/m34 BY CONTRACT) and stores NO secret VALUE (devportal_credential holds a one-way sha256: hash XOR an
-- opaque secretref: pointer only; real key management is m41). No float; no arbitrary code; no external network.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (published product further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON devportal_app TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON devportal_api_product TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON devportal_credential TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON devportal_subscription TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON devportal_product_scope TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON devportal_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON devportal_credential_event TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON devportal_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON devportal_idempotency TO %I', grantee);
END
$$;
