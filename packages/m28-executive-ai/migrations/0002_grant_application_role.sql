-- ---------------------------------------------------------------------------------------------------
-- M28 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — config/session/query/
-- response transition by status (ADR-010). Citations, feedback and the idempotency ledger are append-only (INSERT+SELECT
-- only). m28 owns NO outbox — the AI request/output lifecycle is emitted by m06 via m24. THE COPILOT IS READ-ONLY: it
-- holds SELECT/INSERT/UPDATE only on its OWN copilot_* assistance records and has NO grant of any kind on any business
-- table (finance/legal/ops/case/document/workflow) — it cannot post, approve, reconcile, close, file, send or mutate a
-- business record even if asked. It never auto-approves an M24 output (that is a human decision through M24).
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
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON copilot_config TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON copilot_session TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON copilot_query TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON copilot_response TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON copilot_citation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON copilot_feedback TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON copilot_idempotency TO %I', grantee);
END
$$;
