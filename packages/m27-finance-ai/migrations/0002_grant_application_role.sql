-- ---------------------------------------------------------------------------------------------------
-- M27 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — config/subject/analysis/
-- suggestion transition by status (ADR-010). Histories, model results, exception classifications, features, evidence,
-- reviews and the idempotency ledger are append-only (INSERT+SELECT only). m27 owns NO outbox — the AI request/output
-- lifecycle is emitted by m06 via m24. It NEVER auto-posts, auto-matches, approves or mutates a finance record.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_ai_config TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_ai_subject TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_ai_analysis TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON finance_ai_suggestion TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON finance_ai_analysis_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON finance_ai_model_result TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON finance_ai_exception_classification TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON finance_ai_suggestion_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON finance_ai_feature TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON finance_ai_evidence TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON finance_ai_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON finance_ai_idempotency TO %I', grantee);
END
$$;
