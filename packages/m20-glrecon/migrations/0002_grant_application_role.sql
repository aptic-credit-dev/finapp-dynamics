-- ---------------------------------------------------------------------------------------------------
-- M20 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes
-- from `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — accounts
-- archive by status; GL/source lines, matches, items, exceptions and certifications transition by status; rulesets
-- supersede/retire (ADR-010). Ruleset/status/certification history, import errors, run balances, match lines, engine
-- candidates, manual decisions, run summaries and notes are append-only (INSERT+SELECT only). m20 owns no outbox —
-- it INSERTs into m06's. It NEVER posts a journal or writes to the general ledger.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_recon_account TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_ruleset TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_rule TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_import TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_balance TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_line TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_source_import TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_source_line TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_recon_run TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_match TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_reconciling_item TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_exception TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_certification TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON gl_journal_recommendation TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON gl_ruleset_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON gl_import_error TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON gl_run_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON gl_run_balance TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON gl_match_line TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON gl_match_candidate TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON gl_manual_decision TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON gl_certification_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON gl_run_summary TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON gl_note TO %I', grantee);
END
$$;
