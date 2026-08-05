-- ---------------------------------------------------------------------------------------------------
-- M24 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — providers/models/prompts/
-- policies/config/requests/outputs transition by status (ADR-010). All *_history, citations, human reviews, DLP
-- findings, usage, governance events and the idempotency ledger are append-only (INSERT+SELECT only). m24 owns NO
-- outbox — it INSERTs into m06's. It NEVER approves/posts/executes a controlled action.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_provider TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_model TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_prompt TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_dlp_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_config TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_request TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_output TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON ai_provider_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_prompt_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_request_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_output_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_citation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_human_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_dlp_finding TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_usage TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_governance_event TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_idempotency TO %I', grantee);
END
$$;
