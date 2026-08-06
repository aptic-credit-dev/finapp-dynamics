-- ---------------------------------------------------------------------------------------------------
-- M26 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — config/subject/analysis/
-- suggestion transition by status (ADR-010). Findings, citations, evidence, reviews, histories and the idempotency
-- ledger are append-only (INSERT+SELECT only). m26 owns NO outbox — the AI request/output lifecycle is emitted by m06
-- via m24. It NEVER files/settles/enforces/mutates a matter.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_ai_config TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_ai_subject TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_ai_analysis TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON legal_ai_suggestion TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON legal_ai_analysis_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_ai_finding TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_ai_citation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_ai_suggestion_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_ai_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_ai_evidence TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON legal_ai_idempotency TO %I', grantee);
END
$$;
