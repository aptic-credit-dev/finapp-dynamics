-- ---------------------------------------------------------------------------------------------------
-- M21 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes
-- from `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — types/config/
-- reason-codes/recommendations/drafts/lines/posting-requests/posting-results transition by status; a removed line
-- flips status 'active' -> 'removed' (ADR-010). Recommendation lines/history, draft status history, draft-balance
-- evidence, notes, validation + findings, posting-request/result history and the posting idempotency ledger are
-- append-only (INSERT+SELECT only). m21 owns no outbox — it INSERTs into m06's. It NEVER posts a journal, approves
-- one, or writes to a ledger/ERP/core system.
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON journal_type TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON journal_config TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON journal_reason_code TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON journal_recommendation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON journal_draft TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON journal_line TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON posting_request TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON posting_result TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON journal_recommendation_line TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON journal_recommendation_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON journal_status_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON journal_draft_balance TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON journal_note TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON journal_validation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON journal_validation_finding TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON posting_request_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON posting_result_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON posting_idempotency TO %I', grantee);
END
$$;
