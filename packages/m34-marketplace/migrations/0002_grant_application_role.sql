-- ---------------------------------------------------------------------------------------------------
-- M34 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — listings/installations/
-- consent/secrets transition by status (ADR-010). Capability/upgrade/review/history + the idempotency ledger are
-- append-only (INSERT+SELECT only); a published listing is additionally frozen by its immutability trigger. m34 owns NO
-- outbox — it emits marketplace.lifecycle through the ONE m06 outbox. It has NO grant on any other module's table (it
-- consumes m02/m03/m06/m30/m33 BY CONTRACT) and stores NO secret VALUE (marketplace_install_secret holds opaque secretref:
-- pointers only; real key management is m41). No float; no arbitrary code; no external network.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (published listing further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON marketplace_listing TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON marketplace_installation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON marketplace_consent TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON marketplace_install_secret TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON marketplace_listing_capability TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON marketplace_upgrade TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON marketplace_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON marketplace_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON marketplace_idempotency TO %I', grantee);
END
$$;
