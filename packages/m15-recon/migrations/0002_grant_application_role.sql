-- ---------------------------------------------------------------------------------------------------
-- M15 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes
-- from `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — accounts
-- archive by status; statement/ledger lines, matches and exceptions transition by status; rulesets supersede/
-- retire (ADR-010). Ruleset/status history, match lines, engine candidates, manual decisions, run summaries, notes
-- and import errors are append-only (INSERT+SELECT only). m15 owns no outbox — it INSERTs into m06's.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_bank_account TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_matching_ruleset TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_matching_rule TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_statement_import TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_statement_line TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_ledger_import TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_ledger_entry TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_run TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_match TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON recon_exception TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON recon_ruleset_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recon_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recon_match_line TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recon_match_candidate TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recon_manual_decision TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recon_run_summary TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recon_note TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON recon_import_error TO %I', grantee);
END
$$;
